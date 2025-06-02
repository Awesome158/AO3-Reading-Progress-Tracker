// Storage utility for managing NDJSON data
class AO3Storage {
  constructor() {
    this.cache = new Map();
    this.isDirty = false;
    this.flushInterval = 5000; // 5 seconds
    this.ready = false;
    this.init();
  }

  async init() {
    console.log('[AO3 Storage] Initializing...');
    await this.loadFromStorage();
    this.startAutoFlush();
    this.ready = true;
    console.log('[AO3 Storage] Ready with', this.cache.size, 'works');
  }

  // Load data from chrome.storage.local
  async loadFromStorage() {
    try {
      const result = await chrome.storage.local.get(['ao3_progress']);
      if (result.ao3_progress) {
        const lines = result.ao3_progress.split('\n').filter(line => line.trim());
        lines.forEach(line => {
          try {
            const data = JSON.parse(line);
            this.cache.set(data.wid, data);
          } catch (e) {
            console.error('Failed to parse line:', line, e);
          }
        });
      }
    } catch (e) {
      console.error('Failed to load storage:', e);
    }
  }

  // Save cache to storage as NDJSON
  async flush() {
    if (!this.isDirty) return;

    try {
      const ndjson = Array.from(this.cache.values())
        .map(data => JSON.stringify(data))
        .join('\n');

      await chrome.storage.local.set({ ao3_progress: ndjson });
      this.isDirty = false;
    } catch (e) {
      console.error('Failed to save storage:', e);
    }
  }

  // Auto-flush periodically
  startAutoFlush() {
    setInterval(() => this.flush(), this.flushInterval);
  }

  // Get work progress
  getWork(wid) {
    return this.cache.get(wid) || null;
  }

  // Update chapter progress
  updateProgress(wid, chapterNum, cid, progress, title = null, lastParagraph = null) {
    let work = this.cache.get(wid) || {
      wid,
      title: title || `Work ${wid}`,
      chapters: {},
      lastUpdated: Date.now()
    };

    // Update title if provided
    if (title && title !== work.title) {
      work.title = title;
    }

    // Update chapter progress
    work.chapters[chapterNum] = {
      cid,
      p: Math.min(100, Math.max(0, Math.round(progress))),
      lastParagraph: lastParagraph
    };

    work.lastUpdated = Date.now();

    this.cache.set(wid, work);
    this.isDirty = true;
  }

  // Get all works
  getAllWorks() {
    return Array.from(this.cache.values());
  }

  // Delete a work
  deleteWork(wid) {
    if (this.cache.delete(wid)) {
      this.isDirty = true;
      return true;
    }
    return false;
  }

  // Check if work is completed
  isWorkCompleted(wid) {
    const work = this.cache.get(wid);
    if (!work) return false;

    const chapters = Object.values(work.chapters);
    return chapters.length > 0 && chapters.every(ch => ch.p === 100);
  }

  // Mark work as completed
  markCompleted(wid) {
    const work = this.cache.get(wid);
    if (!work) return false;

    // Set all chapters to 100%
    Object.keys(work.chapters).forEach(chNum => {
      work.chapters[chNum].p = 100;
    });

    work.completedAt = Date.now();
    work.lastUpdated = Date.now();
    this.cache.set(wid, work);
    this.isDirty = true;
    return true;
  }

  // Delete completed works based on settings
  async cleanupCompleted(settings) {
    if (!settings.autoDeleteCompleted) return;

    const now = Date.now();
    const deletionDelay = this.parseDeletionDelay(settings.deletionTiming);

    for (const [wid, work] of this.cache) {
      if (work.completedAt && (now - work.completedAt) > deletionDelay) {
        this.cache.delete(wid);
        this.isDirty = true;
      }
    }
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

  // Export data as NDJSON
  exportData() {
    return Array.from(this.cache.values())
      .map(data => JSON.stringify(data))
      .join('\n');
  }

  // Import NDJSON data
  async importData(ndjsonString) {
    const lines = ndjsonString.split('\n').filter(line => line.trim());
    let imported = 0;

    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        if (data.wid) {
          this.cache.set(data.wid, data);
          imported++;
        }
      } catch (e) {
        console.error('Failed to import line:', line, e);
      }
    }

    if (imported > 0) {
      this.isDirty = true;
      await this.flush();
    }

    return imported;
  }
}

// Create global instance
window.ao3Storage = new AO3Storage();