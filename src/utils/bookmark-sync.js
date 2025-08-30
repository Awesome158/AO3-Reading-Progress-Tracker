// Bookmark synchronization module for AO3 Reading Progress Tracker - Fixed Version
(function () {
  'use strict';

  class BookmarkSync {
    constructor() {
      this.baseUrl = 'https://archiveofourown.org';
      this.settings = null;
      this.initPromise = this.init();
      this.debug = localStorage.getItem('ao3_debug') === 'true';
      this.rateLimitDelay = 2000; // Default 2 seconds, configurable
      this.lastRequestTime = 0;
      this.syncedChapters = new Map(); // Use Map for better control
      this.cachedTokens = new Map(); // Cache CSRF tokens with expiry
      this.tokenCacheDuration = 1800000; // 30 minutes
      this.username = null;
      this.syncIntervals = [5, 25, 50, 75, 100]; // Sync at these percentages
    }

    async init() {
      try {
        // Load settings
        const result = await chrome.storage.local.get(['ao3_settings', 'ao3_synced_chapters']);
        this.settings = result.ao3_settings || {};

        // Load persistent synced chapters data
        if (result.ao3_synced_chapters) {
          this.syncedChapters = new Map(result.ao3_synced_chapters);
          // Clean up old entries (older than 7 days)
          this.cleanupSyncedChapters();
        }

        // Allow custom rate limit from settings
        if (this.settings.rateLimitDelay) {
          this.rateLimitDelay = this.settings.rateLimitDelay;
        }

        // Get username
        this.username = this.getCurrentUsername();

        this.log('BookmarkSync initialized with settings:', this.settings);
        this.log('Username:', this.username);
      } catch (e) {
        console.error('[AO3 BookmarkSync] Failed to initialize:', e);
        this.settings = {};
      }
    }

    log(...args) {
      if (this.debug) {
        console.log('[AO3 BookmarkSync]', ...args);
      }
    }

    // Get current username from page
    getCurrentUsername() {
      const greetingLink = document.querySelector('#greeting a[href^="/users/"]');
      if (greetingLink) {
        const match = greetingLink.href.match(/\/users\/([^\/]+)/);
        return match ? match[1] : null;
      }
      return null;
    }

    // Check if user is logged in
    isLoggedIn() {
      return !!this.username || !!document.querySelector('#greeting .dropdown-toggle');
    }

    // Save synced chapters to persistent storage
    async saveSyncedChapters() {
      try {
        await chrome.storage.local.set({
          'ao3_synced_chapters': Array.from(this.syncedChapters.entries())
        });
      } catch (e) {
        this.log('Error saving synced chapters:', e);
      }
    }

    // Clean up old synced chapter entries
    cleanupSyncedChapters() {
      const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      let cleaned = false;

      for (const [key, data] of this.syncedChapters.entries()) {
        if (data.timestamp < oneWeekAgo) {
          this.syncedChapters.delete(key);
          cleaned = true;
        }
      }

      if (cleaned) {
        this.saveSyncedChapters();
      }
    }

    // Rate limiting helper
    async waitForRateLimit() {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      if (timeSinceLastRequest < this.rateLimitDelay) {
        const waitTime = this.rateLimitDelay - timeSinceLastRequest;
        this.log(`Rate limiting: waiting ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      this.lastRequestTime = Date.now();
    }

    // Get the authenticity token with caching
    async getAuthenticityToken(forceRefresh = false) {
      // Check if we have a cached token
      const cacheKey = 'csrf_token';
      const cached = this.cachedTokens.get(cacheKey);

      if (!forceRefresh && cached && cached.expiry > Date.now()) {
        this.log('Using cached CSRF token');
        return cached.token;
      }

      // Try to get token from current page first
      const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
      if (token) {
        this.log('Found token on current page');
        this.cachedTokens.set(cacheKey, {
          token: token,
          expiry: Date.now() + this.tokenCacheDuration
        });
        return token;
      }

      // If not found, fetch from bookmarks page
      try {
        await this.waitForRateLimit();

        const response = await fetch(`${this.baseUrl}/users/${this.username}/bookmarks`, {
          credentials: 'include',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Cache-Control': 'no-cache'
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch bookmarks page: ${response.status}`);
        }

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const fetchedToken = doc.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

        if (fetchedToken) {
          this.cachedTokens.set(cacheKey, {
            token: fetchedToken,
            expiry: Date.now() + this.tokenCacheDuration
          });
        }

        this.log('Fetched token from bookmarks page:', fetchedToken ? 'yes' : 'no');
        return fetchedToken;
      } catch (error) {
        this.log('Error getting authenticity token:', error);
        return null;
      }
    }

    // Parse work ID from URL or element
    getWorkId(urlOrElement) {
      if (typeof urlOrElement === 'string') {
        const match = urlOrElement.match(/works\/(\d+)/);
        return match ? match[1] : null;
      } else {
        const link = urlOrElement.querySelector('a[href*="/works/"]');
        if (link) {
          const match = link.href.match(/works\/(\d+)/);
          return match ? match[1] : null;
        }
      }
      return null;
    }

    // Format progress tag - FIXED version
    formatProgressTag(readChapters, totalChapters, percentComplete) {
      const prefix = this.settings.bookmarkTagPrefix || 'Reading Progress:';

      // Convert to numbers to ensure proper comparison
      const readNum = parseInt(readChapters) || 0;
      // IMPORTANT: Don't compare with ? chapters - they're ongoing!
      const totalNum = (totalChapters === '?' || totalChapters === null) ? null : parseInt(totalChapters);
      const percentNum = parseInt(percentComplete) || 0;

      this.log('formatProgressTag called with:', {
        readChapters, totalChapters, percentComplete,
        parsed: { readNum, totalNum, percentNum },
        types: {
          readChapters: typeof readChapters,
          totalChapters: typeof totalChapters,
          percentComplete: typeof percentComplete
        }
      });

      if (readNum === 0 && percentNum === 0) {
        return `${prefix} Not started`;
      } else if (totalNum !== null && readNum >= totalNum) {
        // Only mark complete if we have a known total and we've read all chapters
        return `${prefix} Complete`;
      } else {
        const totalStr = totalChapters || '?';
        return `${prefix} ${readNum}/${totalStr} chapters (${percentNum} Percent)`;
      }
    }

    // Check if bookmark exists by checking current page first
    async checkBookmarkExists(workId) {
      // Check if we're on the work page
      const currentPageBookmark = document.querySelector('a.bookmark_form_placement_open[href="#bookmark-form"]');
      if (currentPageBookmark) {
        const isEdit = currentPageBookmark.textContent.includes('Edit');
        return isEdit;
      }

      // Otherwise fetch from bookmarks page
      return await this.fetchBookmarkExists(workId);
    }

    // Fetch bookmark existence from bookmarks page (more efficient)
    async fetchBookmarkExists(workId) {
      try {
        await this.waitForRateLimit();

        const response = await fetch(
          `${this.baseUrl}/users/${this.username}/bookmarks?work_ids=${workId}`,
          {
            credentials: 'include',
            headers: {
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch bookmarks: ${response.status}`);
        }

        const html = await response.text();
        return html.includes(`work-${workId}`);
      } catch (error) {
        this.log('Error checking bookmark existence:', error);
        return false;
      }
    }

    // Fetch bookmark data more efficiently
    async fetchBookmarkData(workId) {
      try {
        this.log(`Fetching bookmark data for work ${workId}`);

        // First check if bookmark exists
        const exists = await this.checkBookmarkExists(workId);

        if (!exists) {
          // No bookmark exists, return structure for creating new one
          return {
            bookmarkId: null,
            workId: workId,
            tags: [],
            notes: '',
            isPrivate: this.settings.bookmarkPrivate !== false,
            isRec: false,
            pseudId: await this.getPseudId()
          };
        }

        // Fetch bookmark edit page
        await this.waitForRateLimit();

        const response = await fetch(
          `${this.baseUrl}/users/${this.username}/bookmarks?work_ids=${workId}`,
          {
            credentials: 'include',
            headers: {
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch bookmark: ${response.status}`);
        }

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Find the bookmark item
        const bookmarkItem = doc.querySelector(`.work-${workId}`);
        if (!bookmarkItem) {
          throw new Error('Bookmark not found in list');
        }

        // Get bookmark ID from edit link
        const editLink = bookmarkItem.querySelector('a[href*="/bookmarks/"][href$="/edit"]');
        const bookmarkId = editLink ? editLink.href.match(/bookmarks\/(\d+)/)?.[1] : null;

        // Get tags
        const tagLinks = bookmarkItem.querySelectorAll('.user.module .tags a.tag');
        const tags = Array.from(tagLinks).map(link => link.textContent.trim());

        // Get privacy status
        const isPrivate = !!bookmarkItem.querySelector('.status .private');

        const bookmarkData = {
          bookmarkId: bookmarkId,
          workId: workId,
          tags: tags,
          notes: '', // Can't get notes from list view
          isPrivate: isPrivate,
          isRec: false, // Can't determine from list view
          pseudId: await this.getPseudId()
        };

        this.log('Parsed bookmark data:', bookmarkData);
        return bookmarkData;

      } catch (error) {
        this.log('Error fetching bookmark data:', error);
        throw error;
      }
    }

    // Get pseud ID
    async getPseudId() {
      // Try from current page first
      const pseudInput = document.querySelector('input#bookmark_pseud_id, select#bookmark_pseud_id');
      if (pseudInput?.value) {
        return pseudInput.value;
      }

      // If not found, we'll let the server use default
      return null;
    }

    // Create FormData for bookmark operations
    createFormData(authenticityToken, bookmarkData, method = 'create') {
      const formData = new FormData();

      formData.append('authenticity_token', authenticityToken);

      if (method === 'update') {
        formData.append('_method', 'put');
      }

      if (bookmarkData.pseudId) {
        formData.append('bookmark[pseud_id]', bookmarkData.pseudId);
      }

      formData.append('bookmark[bookmarker_notes]', bookmarkData.notes || '');
      formData.append('bookmark[tag_string]', bookmarkData.tags.join(', '));

      // Fixed: ensure private status is preserved
      if (method === 'update' && bookmarkData.isPrivate === null) {
        // Don't send private field if we don't know the current state
      } else {
        formData.append('bookmark[private]', bookmarkData.isPrivate ? '1' : '0');
      }

      formData.append('bookmark[rec]', bookmarkData.isRec ? '1' : '0');
      formData.append('bookmark[collection_names]', '');
      formData.append('commit', method === 'create' ? 'Create' : 'Update');

      if (this.debug) {
        console.log('[AO3 BookmarkSync] FormData contents:');
        for (let [key, value] of formData.entries()) {
          console.log(`  ${key}: ${value}`);
        }
      }

      return formData;
    }

    // Send request to AO3 with rate limiting
    async sendRequest(url, formData, method = 'POST') {
      await this.waitForRateLimit();

      const options = {
        method: method,
        mode: 'cors',
        credentials: 'include',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      };

      if (formData) {
        options.body = formData;
      }

      this.log(`Sending ${method} request to:`, url);

      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Request failed (${response.status}): ${response.statusText}. ${errorText}`);
      }

      return response;
    }

    // Find the next sync interval
    getNextSyncInterval(currentProgress) {
      for (const interval of this.syncIntervals) {
        if (currentProgress < interval) {
          return interval;
        }
      }
      return null;
    }

    // Check if we should sync this chapter
    shouldSyncChapter(workId, chapterNum, chapterProgress) {
      const chapterKey = `${workId}-${chapterNum}`;
      const syncData = this.syncedChapters.get(chapterKey);

      if (!syncData) {
        // Never synced this chapter
        if (chapterProgress >= this.syncIntervals[0]) {
          return true;
        }
        return false;
      }

      // Find next sync point
      const nextInterval = this.getNextSyncInterval(syncData.lastProgress);

      if (nextInterval && chapterProgress >= nextInterval) {
        return true;
      }

      // Always sync at 100% even if we already did
      if (chapterProgress === 100 && syncData.lastProgress < 100) {
        return true;
      }

      return false;
    }

    // Record that we synced a chapter
    recordChapterSync(workId, chapterNum, progress) {
      const chapterKey = `${workId}-${chapterNum}`;
      this.syncedChapters.set(chapterKey, {
        lastProgress: progress,
        timestamp: Date.now()
      });
      this.saveSyncedChapters();
    }

    // Update or create bookmark with progress tag
    async updateBookmarkProgress(workId, readChapters, totalChapters, percentComplete, chapterNum = null, currentChapterProgress = null) {
      await this.initPromise;

      // Check if logged in
      if (!this.isLoggedIn()) {
        this.log('User not logged in, skipping bookmark sync');
        return { success: false, error: 'Not logged in' };
      }

      if (!this.settings.syncWithBookmarks) {
        this.log('Bookmark sync disabled');
        return { success: false, error: 'Sync disabled' };
      }

      // Ensure we have a username
      if (!this.username) {
        this.username = this.getCurrentUsername();
        if (!this.username) {
          return { success: false, error: 'Could not determine username' };
        }
      }

      // Check if we should sync this update
      if (chapterNum !== null && currentChapterProgress !== null) {
        if (!this.shouldSyncChapter(workId, chapterNum, currentChapterProgress)) {
          this.log(`Skipping sync for chapter ${chapterNum} at ${currentChapterProgress} Percent`);
          return { success: false, error: 'Not at sync interval' };
        }
      }

      try {
        this.log(`Updating bookmark progress for work ${workId}: ${readChapters}/${totalChapters} (${percentComplete}%)`);

        // Get authenticity token
        const token = await this.getAuthenticityToken();
        if (!token) {
          throw new Error('Could not obtain authenticity token');
        }

        // Get current bookmark data
        let bookmarkData = await this.fetchBookmarkData(workId);

        const progressTag = this.formatProgressTag(readChapters, totalChapters, percentComplete);
        this.log('Progress tag:', progressTag);

        // Remove old progress tags
        const prefix = this.settings.bookmarkTagPrefix || 'Reading Progress:';
        bookmarkData.tags = bookmarkData.tags.filter(tag => !tag.startsWith(prefix));

        // Add new progress tag
        bookmarkData.tags.push(progressTag);

        let result;
        if (!bookmarkData.bookmarkId) {
          // Create new bookmark
          if (!this.settings.bookmarkAutoCreate) {
            this.log('No bookmark exists and auto-create is disabled');
            return { success: false, error: 'Auto-create disabled' };
          }

          this.log('Creating new bookmark');
          result = await this.createBookmark(workId, bookmarkData, token);
        } else {
          // Update existing bookmark
          this.log('Updating existing bookmark');
          result = await this.updateBookmark(bookmarkData.bookmarkId, bookmarkData, token);
        }

        // Record successful sync
        if (result && chapterNum !== null && currentChapterProgress !== null) {
          this.recordChapterSync(workId, chapterNum, currentChapterProgress);
        }

        return { success: result };

      } catch (error) {
        this.log('Error updating bookmark progress:', error);
        return { success: false, error: error.message };
      }
    }

    // Create a new bookmark
    async createBookmark(workId, bookmarkData, token) {
      try {
        const formData = this.createFormData(token, bookmarkData, 'create');
        const response = await this.sendRequest(
          `${this.baseUrl}/works/${workId}/bookmarks`,
          formData,
          'POST'
        );

        this.log('Bookmark created successfully');
        return true;

      } catch (error) {
        this.log('Error creating bookmark:', error);
        throw error;
      }
    }

    // Update an existing bookmark
    async updateBookmark(bookmarkId, bookmarkData, token) {
      try {
        const formData = this.createFormData(token, bookmarkData, 'update');
        const response = await this.sendRequest(
          `${this.baseUrl}/bookmarks/${bookmarkId}`,
          formData,
          'POST'
        );

        this.log('Bookmark updated successfully');
        return true;

      } catch (error) {
        this.log('Error updating bookmark:', error);
        throw error;
      }
    }

    // Remove progress tags from a bookmark
    async removeProgressTags(workId) {
      await this.initPromise;

      if (!this.isLoggedIn()) {
        return { success: false, error: 'Not logged in' };
      }

      try {
        const token = await this.getAuthenticityToken();
        if (!token) {
          throw new Error('Could not obtain authenticity token');
        }

        const bookmarkData = await this.fetchBookmarkData(workId);
        if (!bookmarkData || !bookmarkData.bookmarkId) {
          this.log('No bookmark found to remove tags from');
          return { success: false, error: 'No bookmark found' };
        }

        // Remove progress tags
        const prefix = this.settings.bookmarkTagPrefix || 'Reading Progress:';
        bookmarkData.tags = bookmarkData.tags.filter(tag => !tag.startsWith(prefix));

        const result = await this.updateBookmark(bookmarkData.bookmarkId, bookmarkData, token);
        return { success: result };
      } catch (error) {
        this.log('Error removing progress tags:', error);
        return { success: false, error: error.message };
      }
    }

    // Clear synced chapters for a work
    clearSyncedChapters(workId) {
      const keysToRemove = [];
      for (const [key, data] of this.syncedChapters.entries()) {
        if (key.startsWith(`${workId}-`)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => this.syncedChapters.delete(key));
      if (keysToRemove.length > 0) {
        this.saveSyncedChapters();
      }
      this.log(`Cleared ${keysToRemove.length} synced chapters for work ${workId}`);
    }

    // Check if a work is bookmarked
    async isWorkBookmarked(workId) {
      if (!this.isLoggedIn()) {
        return false;
      }
      return await this.checkBookmarkExists(workId);
    }
  }

  // Create global instance
  window.ao3BookmarkSync = new BookmarkSync();

  // Testing and debugging functions
  window.testAO3Bookmarks = async function (workId) {
    if (!workId) {
      workId = window.location.pathname.match(/works\/(\d+)/)?.[1];
    }

    if (!workId) {
      console.log('No work ID provided or found in URL');
      return;
    }

    const result = await window.ao3BookmarkSync.fetchBookmarkData(workId);
    console.log('Bookmark data:', result);
    return result;
  };

  window.enableBookmarkDebug = function () {
    localStorage.setItem('ao3_debug', 'true');
    window.ao3BookmarkSync.debug = true;
    console.log('Bookmark debug mode enabled');
  };

  window.disableBookmarkDebug = function () {
    localStorage.removeItem('ao3_debug');
    window.ao3BookmarkSync.debug = false;
    console.log('Bookmark debug mode disabled');
  };

  // Manual sync trigger for testing
  window.testBookmarkSync = async function (workId, readChapters, totalChapters, percentComplete) {
    if (!workId) {
      console.log('Usage: testBookmarkSync(workId, readChapters, totalChapters, percentComplete)');
      return;
    }

    const result = await window.ao3BookmarkSync.updateBookmarkProgress(
      workId,
      parseInt(readChapters) || 0,
      totalChapters || '?',
      parseInt(percentComplete) || 0
    );
    console.log('Sync result:', result);
    return result;
  };

})();