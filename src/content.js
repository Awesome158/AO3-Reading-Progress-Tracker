// Main content script for AO3 Reading Progress Tracker
(function () {
  'use strict';

  // Configuration
  const CONFIG = {
    DEBUG: localStorage.getItem('ao3_debug') === 'true',
    RETRY_ATTEMPTS: 5,
    RETRY_DELAY: 1000,
    MUTATION_OBSERVER_DELAY: 100
  };

  // Utility functions
  const log = (...args) => {
    if (CONFIG.DEBUG) {
      console.log('[AO3 Progress Tracker]', ...args);
    }
  };

  const parseWorkId = (url) => {
    const match = url.match(/\/works\/(\d+)/);
    return match ? match[1] : null;
  };

  const parseChapterId = (url) => {
    const match = url.match(/\/chapters\/(\d+)/);
    return match ? match[1] : null;
  };

  const getWorkTitle = () => {
    // Try multiple selectors for robustness
    const selectors = [
      'h2.title.heading',
      'h2.title',
      '.work.meta.group h2.title',
      '[role="article"] h2'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.textContent.trim();
      }
    }

    return null;
  };

  // Safe DOM manipulation helpers
  const safeInsertBefore = (parent, newNode, referenceNode) => {
    try {
      if (parent && newNode && parent.contains(referenceNode)) {
        parent.insertBefore(newNode, referenceNode);
        return true;
      } else if (parent && newNode) {
        parent.appendChild(newNode);
        return true;
      }
    } catch (e) {
      log('Insert failed, appending instead:', e);
      if (parent && newNode) {
        parent.appendChild(newNode);
        return true;
      }
    }
    return false;
  };

  const parseChapterInfo = (chapterText) => {
    if (!chapterText) return { current: null, total: null };

    // Clean the text
    const cleaned = chapterText.trim();

    // Handle different formats: "9/?", "9/9", "9", "9/?"
    const match = cleaned.match(/(\d+)(?:\/(\d+|\?))?/);

    if (match) {
      const current = parseInt(match[1]);
      const total = match[2] === '?' ? null : (match[2] ? parseInt(match[2]) : current);

      return { current, total };
    }

    return { current: null, total: null };
  };

  // Throttle function for scroll events
  const throttle = (func, delay) => {
    let timeout = null;
    let lastRun = 0;

    return function (...args) {
      const now = Date.now();
      if (now - lastRun >= delay) {
        func.apply(this, args);
        lastRun = now;
      } else {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          func.apply(this, args);
          lastRun = Date.now();
        }, delay - (now - lastRun));
      }
    };
  };

  // Progress tracking for reading view
  class ProgressTracker {
    constructor() {
      this.currentWid = parseWorkId(window.location.href);
      this.currentCid = parseChapterId(window.location.href);
      this.lastProgress = 0;
      this.isTracking = false;

      if (this.currentWid) {
        this.init();
      } else {
        log('No work ID found in URL');
      }
    }

    async init() {
      log('Initializing for work', this.currentWid);

      // Wait for storage to be ready
      while (!window.ao3Storage) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Wait for storage to be initialized
      while (!window.ao3Storage.ready) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Check if we're on a chapter page
      const isChapterPage = !!this.currentCid;
      const isFullWork = window.location.search.includes('view_full_work=true');

      log('Page type:', { isChapterPage, isFullWork });

      if (isChapterPage && !isFullWork) {
        this.trackChapter();
      } else if (isFullWork) {
        this.trackFullWork();
      }

      // Inject progress display with retry
      for (let i = 0; i < CONFIG.RETRY_ATTEMPTS; i++) {
        const success = await this.injectProgressDisplay();
        if (success) {
          log('Progress display injected successfully');
          break;
        }

        log(`Progress injection attempt ${i + 1} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
      }

      // Add debug info if enabled
      if (CONFIG.DEBUG) {
        this.addDebugInfo();
      }
    }

    trackChapter() {
      const content = this.findContentElement();
      if (!content) {
        log('No content found for tracking');
        return;
      }

      // Get chapter number from navigation or URL
      const chapterNum = this.getChapterNumber();
      if (!chapterNum) {
        log('Could not determine chapter number');
        return;
      }

      // Ensure we have a valid chapter ID
      let chapterId = this.currentCid;
      if (!chapterId) {
        // Try to extract from navigation
        chapterId = this.extractChapterIdFromNavigation();
      }

      if (!chapterId) {
        log('Could not determine chapter ID');
        return;
      }

      this.isTracking = true;
      log(`Tracking chapter ${chapterNum} (ID: ${chapterId}) of work ${this.currentWid}`);

      // Scroll to last read position
      this.scrollToLastPosition(content, chapterNum);

      // Set up scroll tracking with improved throttling
      const trackScroll = throttle(() => {
        const progress = this.calculateProgress(content);
        if (progress > this.lastProgress) {
          this.lastProgress = progress;
          log(`Progress update: Chapter ${chapterNum} - ${progress}%`);

          // Save last read paragraph index
          const lastParagraph = this.getLastVisibleParagraph(content);

          // Get chapter info
          const chapterInfo = this.getTotalChaptersInfo();

          window.ao3Storage.updateProgress(
            this.currentWid,
            chapterNum,
            chapterId, // Use the proper chapter ID
            progress,
            getWorkTitle(),
            lastParagraph,
            chapterInfo
          );
          const work = window.ao3Storage.getWork(this.currentWid);
          if (work) {
            this.syncBookmarkProgress(work, chapterNum, progress);
          }
        }
      }, 1000);

      // Track initial view
      setTimeout(trackScroll, 500); // Small delay to ensure page is fully loaded

      // Track scrolling
      window.addEventListener('scroll', trackScroll);
      content.addEventListener('scroll', trackScroll);

      // Track visibility changes
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          trackScroll();
        }
      });

      // Track before page unload
      window.addEventListener('beforeunload', () => {
        trackScroll();
      });
    }

    // Extract chapter ID from the navigation menu
    extractChapterIdFromNavigation() {
      // Try the chapter select dropdown
      const chapterSelect = document.querySelector('#selected_id');
      if (chapterSelect) {
        const selectedOption = chapterSelect.options[chapterSelect.selectedIndex];
        if (selectedOption && selectedOption.value) {
          // Extract chapter ID from the option value (usually a URL)
          const cidMatch = selectedOption.value.match(/chapters\/(\d+)/);
          if (cidMatch) {
            return cidMatch[1];
          }
        }
      }

      // Try chapter navigation links
      const navLinks = document.querySelectorAll('.chapter.navigation a[href*="/chapters/"]');
      for (const link of navLinks) {
        if (link.textContent.toLowerCase().includes('current') ||
          link.classList.contains('current') ||
          link.getAttribute('aria-current')) {
          const cidMatch = link.href.match(/chapters\/(\d+)/);
          if (cidMatch) {
            return cidMatch[1];
          }
        }
      }

      // Try chapter heading links
      const chapterHeading = document.querySelector('h3.title a[href*="/chapters/"]');
      if (chapterHeading) {
        const cidMatch = chapterHeading.href.match(/chapters\/(\d+)/);
        if (cidMatch) {
          return cidMatch[1];
        }
      }

      return null;
    }

    async syncBookmarkProgress(work, currentChapterNum = null, currentChapterProgress = null) {
      if (!window.ao3BookmarkSync) {
        return; // Bookmark sync not loaded
      }

      try {
        const chapters = Object.values(work.chapters);
        const readChapters = chapters.filter(ch => ch.p === 100).length;
        const totalChapters = work.totalChapters || work.availableChapters || '?';

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
          currentChapterNum,
          currentChapterProgress
        );
      } catch (e) {
        console.error('Failed to sync bookmark progress:', e);
      }
    }

    findContentElement() {
      // Try multiple selectors for content area
      const selectors = [
        'div.userstuff:not(.summary)',
        '#chapters div.userstuff',
        '[role="article"] div.userstuff',
        '.chapter div.userstuff'
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) return element;
      }

      return null;
    }

    scrollToLastPosition(content, chapterNum) {
      const work = window.ao3Storage.getWork(this.currentWid);
      if (!work || !work.chapters[chapterNum]) {
        return;
      }

      const chapter = work.chapters[chapterNum];
      if (chapter.lastParagraph && chapter.p < 100) {
        const paragraphs = content.querySelectorAll('p');
        if (paragraphs[chapter.lastParagraph]) {
          log(`Scrolling to paragraph ${chapter.lastParagraph}`);

          // Add a visual indicator
          const targetP = paragraphs[chapter.lastParagraph];
          targetP.style.borderLeft = '3px solid #900';
          targetP.style.paddingLeft = '10px';
          targetP.style.transition = 'all 0.3s ease';

          // Scroll to position
          setTimeout(() => {
            targetP.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Remove indicator after a few seconds
            setTimeout(() => {
              targetP.style.borderLeft = '';
              targetP.style.paddingLeft = '';
            }, 3000);
          }, 500);
        }
      }
    }

    getLastVisibleParagraph(content) {
      const paragraphs = content.querySelectorAll('p');
      const windowHeight = window.innerHeight;
      let lastVisible = 0;

      for (let i = 0; i < paragraphs.length; i++) {
        const rect = paragraphs[i].getBoundingClientRect();
        if (rect.top < windowHeight && rect.bottom > 0) {
          lastVisible = i;
        }
      }

      return lastVisible;
    }

    trackFullWork() {
      // Find all chapter containers
      const chapters = document.querySelectorAll('[id^="chapter-"]');

      chapters.forEach((chapter, index) => {
        const chapterNum = index + 1;
        const content = chapter.querySelector('div.userstuff');
        if (!content) return;

        // Extract chapter ID from the chapter's heading link
        const chapterLink = chapter.querySelector('h3.title a');
        if (!chapterLink) return;

        const cid = parseChapterId(chapterLink.href);
        if (!cid) return;

        // Set up intersection observer for this chapter
        const observer = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              const progress = this.calculateProgress(content, entry.boundingClientRect);

              // Get chapter info
              const chapterInfo = this.getTotalChaptersInfo();

              window.ao3Storage.updateProgress(
                this.currentWid,
                chapterNum,
                cid,
                progress,
                getWorkTitle(),
                null,
                chapterInfo
              );

              // Sync bookmarks periodically
              if (progress % 25 === 0) { // Every 25%
                const work = window.ao3Storage.getWork(this.currentWid);
                if (work) {
                  this.syncBookmarkProgress(work, chapterNum, progress);
                }
              }
            }
          });
        }, {
          threshold: Array.from({ length: 21 }, (_, i) => i * 0.05),
          rootMargin: '0px'
        });

        observer.observe(content);
      });
    }

    calculateProgress(element, rect = null) {
      const boundingRect = rect || element.getBoundingClientRect();
      const windowHeight = window.innerHeight;

      // Get all paragraphs
      const paragraphs = element.querySelectorAll('p');
      if (paragraphs.length === 0) return 0;

      let visibleParagraphs = 0;

      paragraphs.forEach((p, index) => {
        const pRect = p.getBoundingClientRect();
        // Check if paragraph is at least 50% visible
        if (pRect.top < windowHeight && pRect.bottom > 0) {
          const visibleHeight = Math.min(pRect.bottom, windowHeight) - Math.max(pRect.top, 0);
          const visiblePercent = visibleHeight / pRect.height;
          if (visiblePercent > 0.5) {
            visibleParagraphs = index + 1;
          }
        }
      });

      // Check if last paragraph is fully visible for 100% completion
      const lastP = paragraphs[paragraphs.length - 1];
      const lastRect = lastP.getBoundingClientRect();
      if (lastRect.bottom <= windowHeight && lastRect.top >= 0) {
        return 100;
      }

      return Math.round((visibleParagraphs / paragraphs.length) * 100);
    }

    getChapterNumber() {
      // Method 1: Chapter select dropdown
      const select = document.querySelector('#selected_id, select[name="selected_id"]');
      if (select) {
        return parseInt(select.selectedIndex) + 1;
      }

      // Method 2: Chapter heading
      const headingSelectors = [
        'h3.title',
        '.chapter h3.title',
        '.chapter-title'
      ];

      for (const selector of headingSelectors) {
        const heading = document.querySelector(selector);
        if (heading) {
          const match = heading.textContent.match(/Chapter\s+(\d+)/i);
          if (match) return parseInt(match[1]);
        }
      }

      // Method 3: Navigation breadcrumbs
      const breadcrumbs = document.querySelectorAll('.navigation.actions a, .chapter.navigation a');
      for (const link of breadcrumbs) {
        const match = link.textContent.match(/Chapter\s+(\d+)/i);
        if (match) return parseInt(match[1]);
      }

      // Method 4: URL pattern
      const urlMatch = window.location.href.match(/chapters\/\d+.*[?&]chapter=(\d+)/);
      if (urlMatch) return parseInt(urlMatch[1]);

      // Default to 1 if can't determine
      return 1;
    }

    async injectProgressDisplay() {
      // Wait for storage to be ready
      while (!window.ao3Storage || !window.ao3Storage.ready) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Wait for work data
      const work = window.ao3Storage.getWork(this.currentWid);
      if (!work) {
        log('No progress data for work:', this.currentWid);
        return false;
      }

      // Find stats dl - try multiple selectors
      const statsSelectors = [
        'dl.stats',
        'dl.work.meta.group.stats',
        '.stats.meta',
        '[class*="stats"]'
      ];

      let statsDl = null;
      for (const selector of statsSelectors) {
        statsDl = document.querySelector(selector);
        if (statsDl && statsDl.tagName === 'DL') break;
      }

      if (!statsDl) {
        log('Stats dl not found');
        return false;
      }

      // Remove existing progress display
      const existingDt = statsDl.querySelector('dt.progress');
      const existingDd = statsDl.querySelector('dd.progress');
      if (existingDt) existingDt.remove();
      if (existingDd) existingDd.remove();

      // Calculate progress
      const chapters = Object.values(work.chapters);
      const chapterInfo = this.getTotalChaptersInfo();
      const availableChapters = work.availableChapters || chapterInfo.current || chapters.length || '?';
      const totalChapters = work.totalChapters || chapterInfo.total || availableChapters;
      const readChapters = chapters.filter(ch => ch.p === 100).length;

      log(`Progress for work ${this.currentWid}: ${readChapters}/${availableChapters} chapters (total: ${totalChapters})`);

      // Create and insert progress display
      const dt = document.createElement('dt');
      dt.className = 'progress';
      dt.textContent = 'Read:';

      const dd = document.createElement('dd');
      dd.className = 'progress';

      // Display format: "readChapters/availableChapters"
      dd.textContent = `${readChapters}/${availableChapters}`;

      // Add visual indicator if completed
      if (availableChapters !== '?' && readChapters === parseInt(availableChapters) && totalChapters !== '?') {
        dd.innerHTML += ' <span style="color: #4CAF50;">✓</span>';
      }

      // Add tooltip with percentage
      const avgProgress = chapters.reduce((sum, ch) => sum + ch.p, 0) / Math.max(chapters.length, 1);
      dd.title = `Average progress: ${Math.round(avgProgress)}%`;

      // Find best insertion point
      const insertionPoints = ['dt.hits', 'dt.kudos', 'dt.comments', 'dt.bookmarks'];
      let inserted = false;

      for (const selector of insertionPoints) {
        const element = statsDl.querySelector(selector);
        if (element && element.parentNode === statsDl) {
          inserted = safeInsertBefore(statsDl, dt, element);
          if (inserted) safeInsertBefore(statsDl, dd, element);
          break;
        }
      }

      // Fallback to appending at end
      if (!inserted) {
        statsDl.appendChild(dt);
        statsDl.appendChild(dd);
      }

      return true;
    }

    getTotalChaptersInfo() {
      // Try multiple selectors for chapter stats
      const selectors = [
        'dd.chapters',
        'dd.stats-chapters',
        '.chapters',
        'dd:has(a[href*="/chapters"])'
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          const text = element.textContent.trim();
          const info = parseChapterInfo(text);

          if (info.current !== null) {
            // If work is complete and total is unknown, use current as total
            if (info.total === null && this.isWorkComplete()) {
              info.total = info.current;
            }

            return info;
          }
        }
      }

      return { current: '?', total: '?' };
    }

    isWorkComplete() {
      // Check for completion indicators
      const completeSelectors = [
        '.required-tags .complete-yes',
        '.completion-yes',
        'span.complete-yes',
        '[class*="complete"][class*="yes"]'
      ];

      for (const selector of completeSelectors) {
        if (document.querySelector(selector)) {
          return true;
        }
      }

      return false;
    }

    addDebugInfo() {
      const work = window.ao3Storage.getWork(this.currentWid);
      const chapterInfo = this.getTotalChaptersInfo();

      const debugDiv = document.createElement('div');
      debugDiv.className = 'ao3-progress-debug';
      debugDiv.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 10px;
        border-radius: 5px;
        font-size: 12px;
        z-index: 10000;
        max-width: 300px;
      `;

      debugDiv.innerHTML = `
        <strong>AO3 Progress Debug</strong><br>
        Work ID: ${this.currentWid}<br>
        Chapter ID: ${this.currentCid || 'N/A'}<br>
        Storage ready: ${!!window.ao3Storage?.ready}<br>
        Stats found: ${!!document.querySelector('dl.stats')}<br>
        Progress shown: ${!!document.querySelector('dd.progress')}<br>
        Chapter info: ${JSON.stringify(chapterInfo)}<br>
        Work data: ${work ? 'Found' : 'Not found'}<br>
        ${work ? `Chapters tracked: ${Object.keys(work.chapters).length}` : ''}
      `;

      document.body.appendChild(debugDiv);

      // Auto-hide after 15 seconds
      setTimeout(() => debugDiv.remove(), 15000);
    }
  }

  // Progress display for work listings (unchanged from original)
  class ListingProgressDisplay {
    constructor() {
      this.init();
    }

    async init() {
      // Wait for storage
      while (!window.ao3Storage || !window.ao3Storage.ready) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Try multiple selectors for work items
      const workSelectors = [
        'li[id^="work_"]',
        'li.work.blurb',
        'article[id^="work_"]',
        '.work.index li[id^="work_"]'
      ];

      let workItems = [];
      for (const selector of workSelectors) {
        workItems = document.querySelectorAll(selector);
        if (workItems.length > 0) break;
      }

      log(`Found ${workItems.length} work items`);

      for (const item of workItems) {
        try {
          const wid = this.extractWorkId(item);
          if (!wid) continue;

          const work = window.ao3Storage.getWork(wid);
          if (work) {
            log(`Injecting progress for work ${wid}`);
            await this.injectProgressIntoListing(item, work);
          }
        } catch (e) {
          log('Error processing work item:', e);
        }
      }
    }

    extractWorkId(item) {
      // Try multiple methods to extract work ID
      if (item.id && item.id.startsWith('work_')) {
        return item.id.replace('work_', '');
      }

      // Try from links
      const link = item.querySelector('a[href*="/works/"]');
      if (link) {
        const wid = parseWorkId(link.href);
        if (wid) return wid;
      }

      return null;
    }

    async injectProgressIntoListing(item, work) {
      // Find stats dl with multiple selectors
      const statsSelectors = [
        'dl.stats',
        'dl.work.meta.group',
        '.stats',
        'dl'
      ];

      let statsDl = null;
      for (const selector of statsSelectors) {
        const elements = item.querySelectorAll(selector);
        for (const el of elements) {
          if (el.tagName === 'DL' && el.querySelector('dt')) {
            statsDl = el;
            break;
          }
        }
        if (statsDl) break;
      }

      if (!statsDl) {
        log('No stats dl found in listing item');
        return false;
      }

      // Remove any existing progress display
      const existingDt = statsDl.querySelector('dt.progress');
      const existingDd = statsDl.querySelector('dd.progress');
      if (existingDt) existingDt.remove();
      if (existingDd) existingDd.remove();

      // Calculate progress
      const chapters = Object.values(work.chapters);
      const readChapters = chapters.filter(ch => ch.p === 100).length;

      // Get total chapters from the listing
      const chapterInfo = this.getChapterInfoFromListing(item);
      const availableChapters = work.availableChapters || chapterInfo.current || chapters.length || '?';
      const totalChapters = work.totalChapters || chapterInfo.total || availableChapters;

      // Create progress elements
      const dt = document.createElement('dt');
      dt.className = 'progress';
      dt.textContent = 'Read:';

      const dd = document.createElement('dd');
      dd.className = 'progress';

      // Display format: "readChapters/availableChapters"
      dd.textContent = `${readChapters}/${availableChapters}`;

      // Add completed indicator
      if (availableChapters !== '?' && readChapters === parseInt(availableChapters) && totalChapters !== '?') {
        dd.classList.add('completed');
        dd.innerHTML += ' <span style="color: #4CAF50;">✓</span>';
      }

      // Add visual progress bar background
      if (readChapters > 0 && availableChapters !== '?') {
        const percent = (readChapters / parseInt(availableChapters)) * 100;
        dd.style.background = `linear-gradient(to right, rgba(0,128,0,0.1) ${percent}%, transparent ${percent}%)`;
      }

      // Add tooltip
      const avgProgress = chapters.reduce((sum, ch) => sum + ch.p, 0) / Math.max(chapters.length, 1);
      dd.title = `Average progress: ${Math.round(avgProgress)}%`;

      // Insert with safe method
      const insertionPoints = ['dt.hits', 'dt.kudos', 'dt.comments', 'dt.bookmarks'];
      let inserted = false;

      for (const selector of insertionPoints) {
        const element = statsDl.querySelector(selector);
        if (element && element.parentNode === statsDl) {
          inserted = safeInsertBefore(statsDl, dt, element);
          if (inserted) safeInsertBefore(statsDl, dd, element);
          break;
        }
      }

      // Fallback to appending at end
      if (!inserted) {
        statsDl.appendChild(dt);
        statsDl.appendChild(dd);
      }

      log(`Injected progress for work ${work.wid}: ${readChapters}/${totalChapters}`);
      return true;
    }

    getChapterInfoFromListing(item) {
      // Try multiple selectors for chapter info
      const selectors = [
        'dd.chapters',
        '.chapters',
        'dd:has(a[href*="/chapters"])',
        'dd'
      ];

      for (const selector of selectors) {
        const elements = item.querySelectorAll(selector);
        for (const element of elements) {
          // Check if this element contains chapter info
          const text = element.textContent;
          if (text && (text.includes('/') || /^\d+$/.test(text.trim()))) {
            const info = parseChapterInfo(text);
            if (info.current !== null) {
              return info;
            }
          }
        }
      }

      return { current: '?', total: '?' };
    }
  }

  // Initialize based on page type
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

  async function initialize() {
    // Check if progress display is enabled
    try {
      const settings = await chrome.storage.local.get(['ao3_settings']);
      const showProgress = settings.ao3_settings?.showProgress !== false; // Default to true

      if (!showProgress) {
        log('Display disabled in settings');
        return;
      }
    } catch (e) {
      log('Failed to load settings:', e);
    }

    const path = window.location.pathname;
    log('Initializing on', path);

    // Use mutation observer to handle dynamic content
    const observer = new MutationObserver(throttle(() => {
      checkAndInitialize();
    }, CONFIG.MUTATION_OBSERVER_DELAY));

    // Start observing
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Initial check
    checkAndInitialize();
  }

  function checkAndInitialize() {
    const path = window.location.pathname;

    if (path.includes('/works/') && !path.includes('/works/search')) {
      // Individual work page
      if (!window.ao3ProgressTracker) {
        window.ao3ProgressTracker = new ProgressTracker();
      }
    } else if (path.includes('/works') || path.includes('/users/') || path.includes('/tags/')) {
      // Listing pages
      if (!window.ao3ListingDisplay) {
        window.ao3ListingDisplay = new ListingProgressDisplay();
      }
    }
  }

  // Handle navigation changes (for single-page navigation)
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      // Reset instances
      window.ao3ProgressTracker = null;
      window.ao3ListingDisplay = null;
      setTimeout(checkAndInitialize, 500); // Small delay for page transition
    }
  });

  urlObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Manual testing helpers
  window.testAO3Progress = function () {
    console.log('=== AO3 Progress Tracker Test ===');
    console.log('Storage ready:', window.ao3Storage?.ready);
    console.log('Current URL:', window.location.href);
    console.log('Work ID:', parseWorkId(window.location.href));
    console.log('Chapter ID:', parseChapterId(window.location.href));
    console.log('Stats element:', document.querySelector('dl.stats'));
    console.log('Progress element:', document.querySelector('dd.progress'));

    if (window.ao3Storage) {
      const wid = parseWorkId(window.location.href);
      const work = window.ao3Storage.getWork(wid);
      console.log('Work data:', work);

      if (!work) {
        console.log('No data stored for this work. Try reading a chapter first.');
      } else {
        console.log('Chapters:', Object.keys(work.chapters));
        console.log('Available chapters:', work.availableChapters);
        console.log('Total chapters:', work.totalChapters);
      }
    } else {
      console.log('Storage not initialized!');
    }

    // Try to inject progress manually
    if (window.ao3Storage && parseWorkId(window.location.href)) {
      const tracker = new ProgressTracker();
      console.log('Manually initialized tracker');
    }
  };

  // Test bookmark functionality
  window.testBookmarkSync = async function () {
    const workId = parseWorkId(window.location.href);
    if (!workId) {
      console.log('No work ID found in current URL');
      return;
    }

    if (!window.ao3BookmarkSync) {
      console.log('Bookmark sync not loaded');
      return;
    }

    console.log('Testing bookmark functionality...');
    const result = await window.ao3BookmarkSync.testBookmarkFunctionality(workId);
    console.log('Bookmark test result:', result);

    if (result.success) {
      console.log('✓ Bookmark system is working');
      console.log('Has existing bookmark:', result.hasBookmark);
      console.log('Can get auth token:', result.hasToken);
    } else {
      console.log('✗ Bookmark system failed:', result.error);
    }
  };

  // Test update checking
  window.testUpdateCheck = function () {
    const workId = parseWorkId(window.location.href);
    if (!workId) {
      console.log('No work ID found in current URL');
      return;
    }

    console.log('Testing update check for work:', workId);

    chrome.runtime.sendMessage({
      action: 'checkSingleWork',
      wid: workId
    }, (response) => {
      if (response && response.success) {
        console.log('✓ Update check successful');
        console.log('Has updates:', response.hasNewChapters);
        console.log('Available chapters:', response.availableChapters);
        console.log('Total chapters:', response.totalChapters);
        console.log('Title:', response.title);
      } else {
        console.log('✗ Update check failed:', response?.error || 'Unknown error');
        if (response?.details) {
          console.log('Details:', response.details);
        }
      }
    });
  };

  // Enable/disable debug mode
  window.enableAO3Debug = function () {
    localStorage.setItem('ao3_debug', 'true');
    CONFIG.DEBUG = true;
    console.log('Debug mode enabled. Reload the page to see debug info.');
  };

  window.disableAO3Debug = function () {
    localStorage.removeItem('ao3_debug');
    CONFIG.DEBUG = false;
    console.log('Debug mode disabled.');
  };

  // Manual progress sync
  window.syncBookmarks = async function () {
    if (!window.ao3ProgressTracker) {
      console.log('No progress tracker active');
      return;
    }

    try {
      await window.ao3ProgressTracker.syncBookmarkProgress();
      console.log('✓ Bookmark progress synced');
    } catch (e) {
      console.log('✗ Failed to sync bookmark progress:', e);
    }
  };

})();