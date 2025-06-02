// Enhanced storage utility with separate completed works storage
(function() {
  'use strict';

  class AO3StorageV2 {
    constructor() {
      this.activeCache = new Map();  // Active/in-progress works
      this.completedCache = new Map(); // Completed works
      this.isDirty = false;
      this.isCompletedDirty = false;
      this.flushInterval = 5000;
      this.ready = false;
      this.init();
    }

    async init() {
      console.log('[AO3 Storage V2] Initializing...');
      await this.loadFromStorage();
      this.startAutoFlush();
      this.ready = true;
      console.log('[AO3 Storage V2] Ready with', this.activeCache.size, 'active works and', this.completedCache.size, 'completed works');
    }

    // Load data from chrome.storage.local
    async loadFromStorage() {
      try {
        const result = await chrome.storage.local.get(['ao3_progress', 'ao3_completed']);

        // Load active works
        if (result.ao3_progress) {
          const lines = result.ao3_progress.split('\n').filter(line => line.trim());
          lines.forEach(line => {
            try {
              const data = JSON.parse(line);
              this.activeCache.set(data.wid, data);
            } catch (e) {
              console.error('Failed to parse active work:', e);
            }
          });
        }

        // Load completed works (compressed format)
        if (result.ao3_completed) {
          const completedData = this.decompressCompleted(result.ao3_completed);
          completedData.forEach(work => {
            this.completedCache.set(work.wid, work);
          });
        }
      } catch (e) {
        console.error('Failed to load storage:', e);
      }
    }

    // Compress completed works data (keeps all necessary info)
    compressCompleted(works) {
      // Create a more efficient format that preserves all needed data
      const compressed = {
        version: 1,
        works: works.map(work => ({
          w: work.wid,
          t: work.title,
          c: Object.keys(work.chapters).length, // chapter count
          ch: Object.entries(work.chapters).reduce((acc, [num, data]) => {
            // Only store chapter IDs for completed works (progress is always 100%)
            acc[num] = data.cid || '';
            return acc;
          }, {}),
          ca: work.completedAt || work.lastUpdated,
          lu: work.lastUpdated
        }))
      };

      return JSON.stringify(compressed);
    }

    // Decompress completed works data
    decompressCompleted(compressed) {
      if (!compressed) return [];
      
      try {
        const data = JSON.parse(compressed);

        // Handle different versions
        if (data.version === 1) {
          return data.works.map(w => ({
            wid: w.w,
            title: w.t,
            chapters: Object.entries(w.ch).reduce((acc, [num, cid]) => {
              acc[num] = {
                cid: cid || `unknown-${num}`,
                p: 100 // All completed
              };
              return acc;
            }, {}),
            completedAt: w.ca,
            lastUpdated: w.lu
          }));
        }
      } catch (e) {
        // Try legacy format (simple string format)
        console.log('Trying legacy completed format...');
        try {
          return compressed.split(';').map(entry => {
            const [wid, title, chapterCount, completedDate] = entry.split('|');

            const work = {
              wid,
              title,
              chapters: {},
              completedAt: parseInt(completedDate),
              lastUpdated: parseInt(completedDate)
            };

            // Create placeholder chapters
            for (let i = 1; i <= parseInt(chapterCount); i++) {
              work.chapters[i] = { p: 100, cid: `unknown-${i}` };
            }

            return work;
          }).filter(work => work.wid);
        } catch (e2) {
          console.error('Failed to parse completed works:', e2);
          return [];
        }
      }

      return [];
    }

    // Save cache to storage
    async flush() {
      const promises = [];

      if (this.isDirty) {
        // Save active works as NDJSON
        const ndjson = Array.from(this.activeCache.values())
          .map(data => JSON.stringify(data))
          .join('\n');

        promises.push(chrome.storage.local.set({ ao3_progress: ndjson }));
        this.isDirty = false;
      }

      if (this.isCompletedDirty) {
        // Save completed works in compressed format
        const compressed = this.compressCompleted(Array.from(this.completedCache.values()));
        promises.push(chrome.storage.local.set({ ao3_completed: compressed }));
        this.isCompletedDirty = false;
      }

      if (promises.length > 0) {
        try {
          await Promise.all(promises);
          console.log('[AO3 Storage V2] Flushed to storage');
        } catch (e) {
          console.error('Failed to save storage:', e);
        }
      }
    }

    // Auto-flush periodically
    startAutoFlush() {
      setInterval(() => this.flush(), this.flushInterval);
    }

    // Get work progress (checks both caches)
    getWork(wid) {
      return this.activeCache.get(wid) || this.completedCache.get(wid) || null;
    }

    // Update chapter progress
    updateProgress(wid, chapterNum, cid, progress, title = null, lastParagraph = null, chapterInfo = null) {
      // Always work with active cache for updates
      let work = this.activeCache.get(wid) || this.completedCache.get(wid) || {
        wid,
        title: title || `Work ${wid}`,
        chapters: {},
        lastUpdated: Date.now()
      };

      // Move from completed to active if updating
      if (this.completedCache.has(wid)) {
        this.completedCache.delete(wid);
        this.isCompletedDirty = true;
        delete work.completedAt; // Remove completed timestamp
      }

      // Update title if provided
      if (title && title !== work.title) {
        work.title = title;
      }

      // Update chapter info if provided (chapterInfo = {current: 9, total: '?'})
      if (chapterInfo) {
        if (chapterInfo.current) {
          work.availableChapters = chapterInfo.current;
        }
        if (chapterInfo.total !== undefined) {
          work.totalChapters = chapterInfo.total;
          work.isWIP = chapterInfo.total === null || chapterInfo.total === '?';
        }
      }

      // Update chapter progress
      work.chapters[chapterNum] = {
        cid,
        p: Math.min(100, Math.max(0, Math.round(progress))),
        lastParagraph: lastParagraph
      };

      work.lastUpdated = Date.now();
      
      // Check if work is now completed
      const chapters = Object.values(work.chapters);
      const allChaptersRead = chapters.length > 0 && chapters.every(ch => ch.p === 100);

      // Work is completed if:
      // 1. All chapters are read AND
      // 2. It's not a WIP (no '?' total) AND
      // 3. We've read all available chapters
      const isCompleted = allChaptersRead &&
        !work.isWIP &&
        work.totalChapters &&
        work.availableChapters &&
        chapters.length >= work.availableChapters;

      if (isCompleted) {
        // Move to completed cache
        work.completedAt = Date.now();
        this.completedCache.set(wid, work);
        this.activeCache.delete(wid);
        this.isCompletedDirty = true;
        this.isDirty = true;
      } else {
        // Keep in active cache
        this.activeCache.set(wid, work);
        this.isDirty = true;
      }

      // Sync with bookmarks if enabled
      this.syncBookmarkProgress(work);
    }
    
// Sync progress with AO3 bookmarks
    async syncBookmarkProgress(work, currentChapterNum = null, currentChapterProgress = null) {
      if (!window.ao3BookmarkSync) {
        return; // Bookmark sync not loaded
      }

      try {
        const chapters = Object.values(work.chapters);
        const readChapters = chapters.filter(ch => ch.p === 100).length;
        const totalChapters = work.totalChapters || work.availableChapters || '?';
        const availableChapters = parseInt(work.availableChapters);

        if ((totalChapters === 0 || totalChapters === '?') && work.availableChapters >= 0) {
          totalChapters = work.availableChapters;
        }


        // Calculate progress based on chapters read, not average progress
        let percentComplete = 0;
        if (totalChapters && totalChapters !== '?') {
          percentComplete = Math.round((readChapters / parseInt(totalChapters)) * 100);
        } else if (work.availableChapters) {
          percentComplete = Math.round((readChapters / work.availableChapters) * 100);
        }

        await window.ao3BookmarkSync.updateBookmarkProgress(
          work.wid,
          readChapters,
          totalChapters,
          percentComplete,
          currentChapterNum
        );
      } catch (e) {
        console.error('Failed to sync bookmark progress:', e);
      }
    }

    // Get all works (combines both caches)
    getAllWorks() {
      const activeWorks = Array.from(this.activeCache.values());
      const completedWorks = Array.from(this.completedCache.values());

      console.log('[AO3 Storage V2] Getting all works:', {
        active: activeWorks.length,
        completed: completedWorks.length,
        completedSample: completedWorks[0]
      });

      const allWorks = [...activeWorks, ...completedWorks];

      // Sort by last updated
      return allWorks.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
    }

    // Delete a work
    deleteWork(wid) {
      let deleted = false;

      if (this.activeCache.delete(wid)) {
        this.isDirty = true;
        deleted = true;
      }

      if (this.completedCache.delete(wid)) {
        this.isCompletedDirty = true;
        deleted = true;
      }

      return deleted;
    }

    // Check if work is completed
    isWorkCompleted(wid) {
      if (this.completedCache.has(wid)) {
        return true;
      }

      const work = this.activeCache.get(wid);
      if (!work) return false;

      const chapters = Object.values(work.chapters);
      return chapters.length > 0 &&
        chapters.every(ch => ch.p === 100) &&
        !work.isWIP && // WIP works are never considered completed
        work.totalChapters &&
        chapters.length >= parseInt(work.totalChapters);
    }

    // Mark work as completed
    markCompleted(wid) {
      let work = this.activeCache.get(wid) || this.completedCache.get(wid);
      if (!work) return false;

      // Set all chapters to 100%
      Object.keys(work.chapters).forEach(chNum => {
        work.chapters[chNum].p = 100;
        delete work.chapters[chNum].lastParagraph; // Remove position data
      });

      work.completedAt = Date.now();
      work.lastUpdated = Date.now();

      // Move to completed cache
      this.completedCache.set(wid, work);
      this.activeCache.delete(wid);

      this.isDirty = true;
      this.isCompletedDirty = true;
      return true;
    }

    // Delete completed works based on settings
    async cleanupCompleted(settings) {
      if (!settings.autoDeleteCompleted) return;

      const now = Date.now();
      const deletionDelay = this.parseDeletionDelay(settings.deletionTiming);
      let cleaned = 0;

      for (const [wid, work] of this.completedCache) {
        if (work.completedAt && (now - work.completedAt) > deletionDelay) {
          this.completedCache.delete(wid);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        this.isCompletedDirty = true;
        await this.flush();
      }

      return cleaned;
    }

    // Parse deletion timing setting
    parseDeletionDelay(timing) {
      if (timing === 'immediate') return 0;

      const match = timing.match(/(\d+)\s*(days?|weeks?|months?)/i);
      if (!match) return 0;

      const value = parseInt(match[1]);
      const unit = match[2].toLowerCase();

      const multipliers = {
        'day': 24 * 60 * 60 * 1000,
        'days': 24 * 60 * 60 * 1000,
        'week': 7 * 24 * 60 * 60 * 1000,
        'weeks': 7 * 24 * 60 * 60 * 1000,
        'month': 30 * 24 * 60 * 60 * 1000,
        'months': 30 * 24 * 60 * 60 * 1000
      };

      return value * (multipliers[unit] || 0);
    }

    // Export data (both active and completed with full information)
    exportData() {
      // Decompress completed works for full export
      const completedWorks = Array.from(this.completedCache.values());

      const exportObj = {
        version: 2,
        exportDate: new Date().toISOString(),
        stats: this.getStats(),
        active: Array.from(this.activeCache.values()),
        completed: completedWorks
      };

      return JSON.stringify(exportObj, null, 2);
    }

    // Export in legacy NDJSON format (for compatibility)
    exportLegacyNDJSON() {
      const allWorks = [
        ...Array.from(this.activeCache.values()),
        ...Array.from(this.completedCache.values())
      ];

      return allWorks
        .map(work => JSON.stringify(work))
        .join('\n');
    }

    // Import data
    async importData(jsonString) {
      try {
        const data = JSON.parse(jsonString);
        
        if (data.version === 2) {
          // Version 2 format
          let imported = 0;

          if (data.active) {
            data.active.forEach(work => {
              this.activeCache.set(work.wid, work);
              imported++;
            });
          }

          if (data.completed) {
            data.completed.forEach(work => {
              this.completedCache.set(work.wid, work);
              imported++;
            });
          }

          this.isDirty = true;
          this.isCompletedDirty = true;
          await this.flush();
          return imported;
        } else {
          // Legacy NDJSON format
          return await this.importLegacyData(jsonString);
        }
      } catch (e) {
        // Try legacy format
        return await this.importLegacyData(jsonString);
      }
    }

    async importLegacyData(ndjsonString) {
      const lines = ndjsonString.split('\n').filter(line => line.trim());
      let imported = 0;

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.wid) {
            // Check if completed
            const chapters = Object.values(data.chapters || {});
            const isCompleted = chapters.length > 0 && chapters.every(ch => ch.p === 100);

            if (isCompleted) {
              data.completedAt = data.lastUpdated || Date.now();
              this.completedCache.set(data.wid, data);
            } else {
              this.activeCache.set(data.wid, data);
            }
            imported++;
          }
        } catch (e) {
          console.error('Failed to import line:', line, e);
        }
      }

      if (imported > 0) {
        this.isDirty = true;
        this.isCompletedDirty = true;
        await this.flush();
      }

      return imported;
    }

    // Get storage statistics
    getStats() {
      const activeWorks = this.activeCache.size;
      const completedWorks = this.completedCache.size;

      // Calculate storage size
      const activeSize = Array.from(this.activeCache.values())
        .map(w => JSON.stringify(w).length)
        .reduce((a, b) => a + b, 0);

      const completedCompressed = this.compressCompleted(Array.from(this.completedCache.values()));
      const completedSize = completedCompressed.length;

      // Calculate uncompressed size for comparison
      const completedUncompressedSize = Array.from(this.completedCache.values())
        .map(w => JSON.stringify(w).length)
        .reduce((a, b) => a + b, 0);

      return {
        activeWorks,
        completedWorks,
        totalWorks: activeWorks + completedWorks,
        activeStorageSize: activeSize,
        completedStorageSize: completedSize,
        completedUncompressedSize: completedUncompressedSize,
        totalStorageSize: activeSize + completedSize,
        compressionRatio: completedUncompressedSize > 0 ?
          ((1 - (completedSize / completedUncompressedSize)) * 100).toFixed(1) + '%' : '0%',
        savedBytes: completedUncompressedSize - completedSize
      };
    }
  }

  // Create global instance
  window.ao3Storage = new AO3StorageV2();

})();