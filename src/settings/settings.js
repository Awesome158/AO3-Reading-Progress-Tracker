// Settings page JavaScript for AO3 Reading Progress Tracker - Updated

// DOM elements
const elements = {
  // General tab
  showProgress: null,
  autoDeleteCompleted: null,
  deletionTiming: null,
  deletionTimingGroup: null,
  scrollSensitivity: null,
  saveSettings: null,
  saveStatus: null,
  exportBtn: null,
  importBtn: null,
  importFile: null,

  // Library tab
  libraryList: null,
  searchLibrary: null,
  filterLibrary: null,
  totalWorks: null,
  totalCompleted: null,
  showCompactView: null,

  // Tab buttons
  tabButtons: null,
  tabPanels: null
};

// Initialize elements after DOM is loaded
function initializeElements() {
  elements.showProgress = document.getElementById('showProgress');
  elements.autoDeleteCompleted = document.getElementById('autoDeleteCompleted');
  elements.deletionTiming = document.getElementById('deletionTiming');
  elements.deletionTimingGroup = document.getElementById('deletionTimingGroup');
  elements.scrollSensitivity = document.getElementById('scrollSensitivity');
  elements.saveSettings = document.getElementById('saveSettings');
  elements.saveStatus = document.getElementById('saveStatus');
  elements.exportBtn = document.getElementById('exportBtn');
  elements.importBtn = document.getElementById('importBtn');
  elements.importFile = document.getElementById('importFile');

  elements.libraryList = document.getElementById('libraryList');
  elements.searchLibrary = document.getElementById('searchLibrary');
  elements.filterLibrary = document.getElementById('filterLibrary');
  elements.totalWorks = document.getElementById('totalWorks');
  elements.totalCompleted = document.getElementById('totalCompleted');
  elements.showCompactView = document.getElementById('showCompactView');

  elements.tabButtons = document.querySelectorAll('.tab-button');
  elements.tabPanels = document.querySelectorAll('.tab-panel');
}

// Settings management
let currentSettings = {};
let worksCache = [];
let expandedWorks = new Set(); // Track expanded works

// Initialize
async function init() {
  try {
    // Initialize DOM elements first
    initializeElements();

    // Set up scroll sensitivity display update
    if (elements.scrollSensitivity) {
      const valueSpans = document.querySelectorAll('.scrollValue');

      if (valueSpans.length > 0) {
        elements.scrollSensitivity.addEventListener('input', () => {
          valueSpans.forEach(span => {
            span.textContent = elements.scrollSensitivity.value;
          });
        });
      }
    }

    // Load settings
    await loadSettings();

    // Set up event listeners
    setupEventListeners();

    // Check if user is logged in to AO3
    checkAO3LoginStatus();

    // Load library if on library tab
    if (document.querySelector('.tab-button[data-tab="library"]')?.classList.contains('active')) {
      await loadLibrary();
    }
  } catch (error) {
    console.error('Initialization error:', error);
  }
}

// Check if user is logged in to AO3
async function checkAO3LoginStatus() {
  try {
    // Send message to content script to check login status
    const tabs = await chrome.tabs.query({ url: '*://archiveofourown.org/*' });
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'checkLoginStatus' }, (response) => {
        if (response && response.isLoggedIn) {
          document.getElementById('bookmarkSyncWarning').style.display = 'none';
        } else {
          document.getElementById('bookmarkSyncWarning').style.display = 'block';
        }
      });
    }
  } catch (e) {
    console.error('Failed to check login status:', e);
  }
}

// Load settings from storage
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(['ao3_settings']);
    currentSettings = result.ao3_settings || {
      autoDeleteCompleted: false,
      deletionTiming: '7 days',
      showProgress: true,
      scrollSensitivity: 5,
      syncWithBookmarks: false,
      bookmarkTagPrefix: 'Reading Progress:',
      bookmarkPrivate: true,
      bookmarkAutoCreate: false,
      checkForUpdates: true,
      updateCheckInterval: 24,
      rateLimitDelay: 2000,
      syncIntervals: [5, 25, 50, 75, 100],
      showDetailedProgress: true,
      trackScrollPosition: true,
      showNotifications: true,
      compactLibraryView: false
    };

    // Apply general settings to UI
    if (elements.showProgress) elements.showProgress.checked = currentSettings.showProgress;
    if (elements.autoDeleteCompleted) elements.autoDeleteCompleted.checked = currentSettings.autoDeleteCompleted;
    if (elements.deletionTiming) elements.deletionTiming.value = currentSettings.deletionTiming;
    if (elements.scrollSensitivity) elements.scrollSensitivity.value = currentSettings.scrollSensitivity;

    // Update scroll value display
    const scrollValueSpans = document.querySelectorAll('.scrollValue');
    scrollValueSpans.forEach(span => {
      span.textContent = currentSettings.scrollSensitivity;
    });

    // Show/hide deletion timing based on auto-delete setting
    if (elements.deletionTimingGroup) {
      elements.deletionTimingGroup.style.display = currentSettings.autoDeleteCompleted ? 'block' : 'none';
    }

    // Bookmark sync settings
    const syncCheckbox = document.getElementById('syncWithBookmarks');
    const bookmarkSettings = document.getElementById('bookmarkSettings');
    if (syncCheckbox) {
      syncCheckbox.checked = currentSettings.syncWithBookmarks || false;
      if (bookmarkSettings) {
        bookmarkSettings.style.display = currentSettings.syncWithBookmarks ? 'block' : 'none';
      }
    }

    const tagPrefix = document.getElementById('bookmarkTagPrefix');
    if (tagPrefix) tagPrefix.value = currentSettings.bookmarkTagPrefix || 'Reading Progress:';

    const bookmarkPrivate = document.getElementById('bookmarkPrivate');
    if (bookmarkPrivate) bookmarkPrivate.checked = currentSettings.bookmarkPrivate !== false;

    const bookmarkAutoCreate = document.getElementById('bookmarkAutoCreate');
    if (bookmarkAutoCreate) bookmarkAutoCreate.checked = currentSettings.bookmarkAutoCreate || false;

    // Advanced bookmark settings
    const rateLimitDelay = document.getElementById('rateLimitDelay');
    if (rateLimitDelay) rateLimitDelay.value = currentSettings.rateLimitDelay || 2000;

    const syncIntervals = document.getElementById('syncIntervals');
    if (syncIntervals) syncIntervals.value = (currentSettings.syncIntervals || [5, 25, 50, 75, 100]).join(', ');

    // Update check settings
    const checkForUpdates = document.getElementById('checkForUpdates');
    if (checkForUpdates) checkForUpdates.checked = currentSettings.checkForUpdates !== false;

    const updateInterval = document.getElementById('updateCheckInterval');
    if (updateInterval) updateInterval.value = currentSettings.updateCheckInterval || 24;

    // Additional settings
    const showDetailedProgress = document.getElementById('showDetailedProgress');
    if (showDetailedProgress) showDetailedProgress.checked = currentSettings.showDetailedProgress !== false;

    const trackScrollPosition = document.getElementById('trackScrollPosition');
    if (trackScrollPosition) trackScrollPosition.checked = currentSettings.trackScrollPosition !== false;

    const showNotifications = document.getElementById('showNotifications');
    if (showNotifications) showNotifications.checked = currentSettings.showNotifications !== false;

    if (elements.showCompactView) elements.showCompactView.checked = currentSettings.compactLibraryView || false;

  } catch (e) {
    console.error('Failed to load settings:', e);
    showStatus('Error loading settings', 'error');
  }
}

// Set up event listeners
function setupEventListeners() {
  // Tab switching
  if (elements.tabButtons) {
    elements.tabButtons.forEach(button => {
      button.addEventListener('click', () => switchTab(button.dataset.tab));
    });
  }

  // Settings changes
  if (elements.autoDeleteCompleted) {
    elements.autoDeleteCompleted.addEventListener('change', (e) => {
      if (elements.deletionTimingGroup) {
        elements.deletionTimingGroup.style.display = e.target.checked ? 'block' : 'none';
      }
    });
  }

  // Update scroll sensitivity display
  if (elements.scrollSensitivity) {
    elements.scrollSensitivity.addEventListener('input', (e) => {
      const scrollValueSpans = document.querySelectorAll('.scrollValue');
      scrollValueSpans.forEach(span => {
        span.textContent = e.target.value;
      });
    });
  }

  // Bookmark sync toggle
  const syncCheckbox = document.getElementById('syncWithBookmarks');
  if (syncCheckbox) {
    syncCheckbox.addEventListener('change', (e) => {
      const bookmarkSettings = document.getElementById('bookmarkSettings');
      if (bookmarkSettings) {
        bookmarkSettings.style.display = e.target.checked ? 'block' : 'none';
      }
    });
  }

  // Save settings
  if (elements.saveSettings) {
    elements.saveSettings.addEventListener('click', saveSettings);
  }

  // Export/Import
  if (elements.exportBtn) {
    elements.exportBtn.addEventListener('click', exportData);
  }
  if (elements.importBtn && elements.importFile) {
    elements.importBtn.addEventListener('click', () => elements.importFile.click());
    elements.importFile.addEventListener('change', importData);
  }

  // Library search and filter
  if (elements.searchLibrary) {
    elements.searchLibrary.addEventListener('input', filterLibrary);
  }
  if (elements.filterLibrary) {
    elements.filterLibrary.addEventListener('change', filterLibrary);
  }

  // Compact view toggle
  if (elements.showCompactView) {
    elements.showCompactView.addEventListener('change', () => {
      displayWorks(worksCache);
    });
  }

  // Test bookmark sync button
  const testBookmarkBtn = document.getElementById('testBookmarkSync');
  if (testBookmarkBtn) {
    testBookmarkBtn.addEventListener('click', async () => {
      testBookmarkBtn.disabled = true;
      testBookmarkBtn.textContent = 'Testing...';

      try {
        // Get current work ID from URL if on a work page
        let workId = window.location.pathname.match(/works\/(\d+)/)?.[1];

        if (!workId && worksCache.length > 0) {
          // Find a work with progress to test
          const workWithProgress = worksCache.find(w => {
            const chapters = Object.values(w.chapters || {});
            return chapters.length > 0 && chapters.some(ch => ch.p > 0);
          });

          if (workWithProgress) {
            workId = workWithProgress.wid;
            const chapters = Object.values(workWithProgress.chapters || {});
            const readChapters = chapters.filter(ch => ch.p === 100).length;
            const totalChapters = workWithProgress.totalChapters || workWithProgress.availableChapters || '?';
            const avgProgress = chapters.reduce((sum, ch) => sum + (ch.p || 0), 0) / chapters.length;

            showStatus(`Testing with work ${workId} from library`, 'info');

            // Test the sync
            const result = await window.ao3BookmarkSync.updateBookmarkProgress(
              workId,
              readChapters,
              totalChapters,
              Math.round(avgProgress)
            );

            if (result.success) {
              showStatus('Bookmark sync successful!', 'success');
            } else {
              showStatus(`Bookmark sync failed: ${result.error}`, 'error');
            }
          } else {
            showStatus('No work with progress found to test. Please read some chapters first.', 'error');
          }
        } else if (!workId) {
          showStatus('No work found to test. Please navigate to a work page or have works in your library.', 'error');
        }
      } catch (error) {
        showStatus('Error during bookmark sync test: ' + error.message, 'error');
      } finally {
        testBookmarkBtn.disabled = false;
        testBookmarkBtn.textContent = 'Test Bookmark Sync';
      }
    });
  }

  // Test update check button
  const testUpdateBtn = document.getElementById('testUpdateCheck');
  if (testUpdateBtn) {
    testUpdateBtn.addEventListener('click', async () => {
      testUpdateBtn.disabled = true;
      testUpdateBtn.textContent = 'Testing...';

      try {
        let workId = window.location.pathname.match(/works\/(\d+)/)?.[1];

        if (!workId && worksCache.length > 0) {
          workId = worksCache[0].wid;
          showStatus(`Testing with work ${workId} from library`, 'info');
        }

        if (!workId) {
          showStatus('No work found to test. Please navigate to a work page or have works in your library.', 'error');
          return;
        }

        chrome.runtime.sendMessage({
          action: 'checkSingleWork',
          wid: workId
        }, (response) => {
          if (chrome.runtime.lastError) {
            showStatus('Error communicating with background script: ' + chrome.runtime.lastError.message, 'error');
            return;
          }

          if (response && response.success) {
            const message = response.hasNewChapters ?
              `Update found! ${response.availableChapters}/${response.totalChapters} chapters available` :
              `No updates found. ${response.availableChapters}/${response.totalChapters} chapters`;
            showStatus(message, response.hasNewChapters ? 'success' : 'info');

            if (response.hasNewChapters && document.getElementById('library')?.classList.contains('active')) {
              loadLibrary();
            }
          } else {
            showStatus('Update check failed: ' + (response?.error || 'Unknown error'), 'error');
          }
        });
      } catch (error) {
        showStatus('Error during update check: ' + error.message, 'error');
      } finally {
        testUpdateBtn.disabled = false;
        testUpdateBtn.textContent = 'Test Update Check';
      }
    });
  }

  // Clear synced chapters button
  const clearSyncedBtn = document.getElementById('clearSyncedChapters');
  if (clearSyncedBtn) {
    clearSyncedBtn.addEventListener('click', async () => {
      if (confirm('This will reset bookmark sync tracking. Continue?')) {
        await chrome.storage.local.remove(['ao3_synced_chapters']);
        showStatus('Sync tracking reset successfully', 'success');
      }
    });
  }
}

// Switch tabs
function switchTab(tabName) {
  if (elements.tabButtons) {
    elements.tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
  }

  if (elements.tabPanels) {
    elements.tabPanels.forEach(panel => {
      panel.classList.toggle('active', panel.id === tabName);
    });
  }

  // Load library when switching to library tab
  if (tabName === 'library') {
    loadLibrary();
  }
}

// Save settings
async function saveSettings() {
  try {
    // Parse sync intervals
    const syncIntervalsInput = document.getElementById('syncIntervals')?.value || '5, 25, 50, 75, 100';
    const syncIntervals = syncIntervalsInput.split(',')
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n) && n >= 0 && n <= 100)
      .sort((a, b) => a - b);

    const newSettings = {
      showProgress: elements.showProgress?.checked ?? true,
      autoDeleteCompleted: elements.autoDeleteCompleted?.checked ?? false,
      deletionTiming: elements.deletionTiming?.value ?? '7 days',
      scrollSensitivity: parseInt(elements.scrollSensitivity?.value ?? '5'),
      syncWithBookmarks: document.getElementById('syncWithBookmarks')?.checked || false,
      bookmarkTagPrefix: document.getElementById('bookmarkTagPrefix')?.value || 'Reading Progress:',
      bookmarkPrivate: document.getElementById('bookmarkPrivate')?.checked !== false,
      bookmarkAutoCreate: document.getElementById('bookmarkAutoCreate')?.checked || false,
      rateLimitDelay: parseInt(document.getElementById('rateLimitDelay')?.value) || 2000,
      syncIntervals: syncIntervals.length > 0 ? syncIntervals : [5, 25, 50, 75, 100],
      checkForUpdates: document.getElementById('checkForUpdates')?.checked !== false,
      updateCheckInterval: parseInt(document.getElementById('updateCheckInterval')?.value) || 24,
      showDetailedProgress: document.getElementById('showDetailedProgress')?.checked !== false,
      trackScrollPosition: document.getElementById('trackScrollPosition')?.checked !== false,
      showNotifications: document.getElementById('showNotifications')?.checked !== false,
      compactLibraryView: elements.showCompactView?.checked || false
    };

    await chrome.storage.local.set({ ao3_settings: newSettings });
    currentSettings = newSettings;

    showStatus('Settings saved successfully!', 'success');

    // Run cleanup if auto-delete is enabled
    if (newSettings.autoDeleteCompleted) {
      chrome.runtime.sendMessage({ action: 'cleanupCompleted' });
    }

    // Update bookmark sync settings if module is loaded
    if (window.ao3BookmarkSync) {
      window.ao3BookmarkSync.settings = newSettings;
      window.ao3BookmarkSync.rateLimitDelay = newSettings.rateLimitDelay;
      window.ao3BookmarkSync.syncIntervals = newSettings.syncIntervals;
    }

  } catch (e) {
    console.error('Failed to save settings:', e);
    showStatus('Error saving settings', 'error');
  }
}

// Show status message
function showStatus(message, type) {
  if (!elements.saveStatus) return;

  elements.saveStatus.textContent = message;
  elements.saveStatus.className = `status-message ${type} show`;

  setTimeout(() => {
    elements.saveStatus.classList.remove('show');
  }, 3000);
}

// Export data
async function exportData() {
  try {
    let data, filename, mimeType;

    if (window.ao3Storage && window.ao3Storage.exportData) {
      while (!window.ao3Storage.ready) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      data = window.ao3Storage.exportData();
      filename = `ao3_progress_v2_${new Date().toISOString().split('T')[0]}.json`;
      mimeType = 'application/json';

      const stats = window.ao3Storage.getStats();
      showStatus(
        `Exported ${stats.totalWorks} works (${stats.activeWorks} active, ${stats.completedWorks} completed)`,
        'success'
      );
    } else {
      const result = await chrome.storage.local.get(['ao3_progress']);
      data = result.ao3_progress || '';
      filename = `ao3_progress_${new Date().toISOString().split('T')[0]}.ndjson`;
      mimeType = 'application/x-ndjson';

      if (!data) {
        showStatus('No data to export', 'error');
        return;
      }

      showStatus('Data exported successfully!', 'success');
    }

    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('Failed to export data:', e);
    showStatus('Error exporting data', 'error');
  }
}

// Import data
async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    let imported = 0;

    if (window.ao3Storage && window.ao3Storage.importData) {
      while (!window.ao3Storage.ready) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      imported = await window.ao3Storage.importData(text);

      if (imported > 0) {
        const stats = window.ao3Storage.getStats();
        showStatus(
          `Imported ${imported} works successfully! ` +
          `(${stats.activeWorks} active, ${stats.completedWorks} completed)`,
          'success'
        );
      } else {
        showStatus('No valid data found in file', 'error');
      }
    } else {
      const lines = text.split('\n').filter(line => line.trim());

      let validLines = 0;
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.wid && data.chapters) {
            validLines++;
          }
        } catch (e) {
          // Skip invalid lines
        }
      }

      if (validLines === 0) {
        showStatus('No valid data found in file', 'error');
        return;
      }

      if (confirm(`Import ${validLines} works? This will merge with existing data.`)) {
        const existingResult = await chrome.storage.local.get(['ao3_progress']);
        const existingData = existingResult.ao3_progress || '';

        const existingWorks = new Map();
        if (existingData) {
          existingData.split('\n').filter(line => line.trim()).forEach(line => {
            try {
              const work = JSON.parse(line);
              existingWorks.set(work.wid, work);
            } catch (e) {
              // Skip invalid lines
            }
          });
        }

        for (const line of lines) {
          try {
            const work = JSON.parse(line);
            if (work.wid && work.chapters) {
              existingWorks.set(work.wid, work);
              imported++;
            }
          } catch (e) {
            // Skip invalid lines
          }
        }

        const mergedData = Array.from(existingWorks.values())
          .map(work => JSON.stringify(work))
          .join('\n');

        await chrome.storage.local.set({ ao3_progress: mergedData });
        showStatus(`Imported ${imported} works successfully!`, 'success');
      }
    }

    if (document.getElementById('library')?.classList.contains('active')) {
      await loadLibrary();
    }
  } catch (e) {
    console.error('Failed to import data:', e);
    showStatus('Error importing data: ' + e.message, 'error');
  }

  event.target.value = '';
}

// Load library
async function loadLibrary() {
  try {
    if (window.ao3Storage && window.ao3Storage.getAllWorks) {
      while (!window.ao3Storage.ready) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      worksCache = window.ao3Storage.getAllWorks();
      console.log('Loaded works from storage v2:', worksCache.length);

      const stats = window.ao3Storage.getStats();
      if (elements.totalWorks) elements.totalWorks.textContent = `${stats.totalWorks} works tracked`;
      if (elements.totalCompleted) elements.totalCompleted.textContent = `${stats.completedWorks} completed`;

      displayWorks(worksCache);
    } else {
      const result = await chrome.storage.local.get(['ao3_progress']);
      const data = result.ao3_progress || '';

      if (!data) {
        if (elements.libraryList) {
          elements.libraryList.innerHTML = '<p style="text-align: center; color: #666;">No works tracked yet</p>';
        }
        if (elements.totalWorks) elements.totalWorks.textContent = '0 works tracked';
        if (elements.totalCompleted) elements.totalCompleted.textContent = '0 completed';
        return;
      }

      worksCache = [];
      const lines = data.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const work = JSON.parse(line);
          worksCache.push(work);
        } catch (e) {
          console.error('Failed to parse work:', e);
        }
      }

      const completed = worksCache.filter(w => isWorkCompleted(w)).length;
      if (elements.totalWorks) elements.totalWorks.textContent = `${worksCache.length} works tracked`;
      if (elements.totalCompleted) elements.totalCompleted.textContent = `${completed} completed`;

      displayWorks(worksCache);
    }
  } catch (e) {
    console.error('Failed to load library:', e);
    showStatus('Error loading library', 'error');
  }
}

// Check if work is completed
function isWorkCompleted(work) {
  const chapters = Object.values(work.chapters || {});

  if (work.isWIP) return false;

  const allChaptersRead = chapters.length > 0 && chapters.every(ch => ch.p === 100);

  if (work.totalChapters && work.totalChapters !== '?') {
    return allChaptersRead && chapters.length >= parseInt(work.totalChapters);
  }

  if (work.availableChapters) {
    return allChaptersRead && chapters.length >= parseInt(work.availableChapters);
  }

  return allChaptersRead;
}

// Display works in library
function displayWorks(works) {
  console.log('Displaying works:', works);

  if (!elements.libraryList) return;

  if (works.length === 0) {
    elements.libraryList.innerHTML = '<p style="text-align: center; color: #666;">No works found</p>';
    return;
  }

  const isCompact = elements.showCompactView?.checked || false;

  const html = works.map(work => {
    if (!work || !work.wid) {
      console.error('Invalid work data:', work);
      return '';
    }

    const chapters = Object.values(work.chapters || {});
    const readChapters = chapters.filter(ch => ch.p === 100).length;
    const isExpanded = expandedWorks.has(work.wid);

    let availableChapters = work.availableChapters;
    if (!availableChapters) {
      const chapterNumbers = Object.keys(work.chapters || {}).map(num => parseInt(num));
      if (chapterNumbers.length > 0) {
        availableChapters = Math.max(...chapterNumbers);
      } else {
        availableChapters = 1;
      }
    }

    const totalChapters = work.totalChapters || availableChapters;
    const avgProgress = chapters.length > 0
      ? chapters.reduce((sum, ch) => sum + (ch.p || 0), 0) / chapters.length
      : 0;
    const isCompleted = isWorkCompleted(work);
    const isWIP = work.isWIP || totalChapters === '?';

    let chapterDisplay = `${readChapters}/${availableChapters}`;
    if (totalChapters !== availableChapters && totalChapters !== '?') {
      chapterDisplay += ` (of ${totalChapters})`;
    } else if (totalChapters === '?') {
      chapterDisplay += ' (ongoing)';
    }

    // Chapter details for expanded view
    let chapterDetailsHtml = '';
    if (!isCompact && isExpanded) {
      const sortedChapters = Object.entries(work.chapters || {})
        .sort(([a], [b]) => parseInt(a) - parseInt(b));

      chapterDetailsHtml = `
        <div class="chapter-details">
          <div class="chapter-header">
            <h4>Chapter Progress</h4>
            <div class="chapter-actions">
              <button class="button button-small mark-all-read" data-wid="${work.wid}">Mark All Read</button>
              <button class="button button-small mark-all-unread" data-wid="${work.wid}">Mark All Unread</button>
            </div>
          </div>
          <div class="chapters-list">
            ${sortedChapters.map(([chNum, chData]) => `
              <div class="chapter-item" data-wid="${work.wid}" data-chapter="${chNum}">
                <div class="chapter-info">
                  <span class="chapter-number">Chapter ${chNum}</span>
                  <div class="chapter-progress-bar">
                    <div class="chapter-progress-fill" style="width: ${chData.p || 0}%"></div>
                  </div>
                  <span class="chapter-percent">${chData.p || 0}%</span>
                </div>
                <div class="chapter-controls">
                  <input type="range" class="chapter-slider" min="0" max="100" value="${chData.p || 0}"
                    data-wid="${work.wid}" data-chapter="${chNum}">
                  <button class="button button-tiny ${chData.p === 100 ? 'button-secondary' : 'button-success'}"
                    data-wid="${work.wid}" data-chapter="${chNum}">
                    ${chData.p === 100 ? 'Unread' : 'Read'}
                  </button>
                </div>
              </div>
            `).join('')}
            ${availableChapters > sortedChapters.length ? `
              <div class="untracked-chapters">
                <p>${availableChapters - sortedChapters.length} untracked chapters</p>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    return `
      <div class="work-item ${isCompact ? 'compact' : ''} ${isExpanded ? 'expanded' : ''}" data-wid="${work.wid}">
        <div class="work-main">
          <div class="work-info">
            <div class="work-header">
              <a href="https://archiveofourown.org/works/${work.wid}" target="_blank" class="work-title">
                ${work.title || work.t || `Work ${work.wid}`}
              </a>
              ${!isCompact ? `
                <button class="expand-toggle" data-wid="${work.wid}" title="${isExpanded ? 'Collapse' : 'Expand'}">
                  ${isExpanded ? '▼' : '▶'}
                </button>
              ` : ''}
            </div>
            <div class="work-progress">
              ${chapterDisplay} chapters read
              ${isCompleted ? '<span class="status-complete">✓ Completed</span>' : ''}
              ${isWIP && !isCompleted ? '<span class="status-wip">WIP</span>' : ''}
              ${work.hasNewChapters ? '<span class="status-new">New!</span>' : ''}
            </div>
            <div class="work-progress-bar">
              <div class="work-progress-fill" style="width: ${avgProgress}%"></div>
            </div>
            <div class="work-meta">
              Last updated: ${new Date(work.lastUpdated).toLocaleDateString()}
            </div>
          </div>
          <div class="work-actions">
            ${!isCompleted ? `<button class="button button-success mark-complete-btn" data-wid="${work.wid}">Mark Complete</button>` : ''}
            <button class="button button-primary refresh-btn" data-wid="${work.wid}" title="Check for new chapters">↻</button>
            <button class="button button-danger delete-work-btn" data-wid="${work.wid}">Delete</button>
          </div>
        </div>
        ${chapterDetailsHtml}
      </div>
    `;
  }).filter(html => html).join('');

  elements.libraryList.innerHTML = html;

  // Add event listeners
  addLibraryEventListeners();
}

// Add event listeners for library controls
function addLibraryEventListeners() {
  // Expand/collapse toggles
  document.querySelectorAll('.expand-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const wid = btn.dataset.wid;
      if (expandedWorks.has(wid)) {
        expandedWorks.delete(wid);
      } else {
        expandedWorks.add(wid);
      }
      displayWorks(worksCache);
    });
  });

  // Mark complete buttons
  document.querySelectorAll('.mark-complete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      markCompleted(btn.dataset.wid);
    });
  });

  // Delete work buttons
  document.querySelectorAll('.delete-work-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      deleteWork(btn.dataset.wid);
    });
  });

  // Refresh buttons
  document.querySelectorAll('.refresh-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const wid = btn.dataset.wid;
      btn.disabled = true;
      btn.textContent = '⏳';

      try {
        chrome.runtime.sendMessage({
          action: 'checkSingleWork',
          wid: wid
        }, async (response) => {
          if (chrome.runtime.lastError) {
            showStatus('Error: ' + chrome.runtime.lastError.message, 'error');
            return;
          }

          if (response && response.success) {
            if (response.updated) {
              showStatus(`Updated! ${response.availableChapters}/${response.totalChapters} chapters available`, 'success');
              await loadLibrary();
            } else {
              showStatus('No new chapters found', 'info');
            }
          } else {
            showStatus('Failed to check for updates', 'error');
          }
          btn.disabled = false;
          btn.textContent = '↻';
        });
      } catch (e) {
        console.error('Failed to check for updates:', e);
        showStatus('Error checking for updates', 'error');
        btn.disabled = false;
        btn.textContent = '↻';
      }
    });
  });

  // Chapter sliders
  document.querySelectorAll('.chapter-slider').forEach(slider => {
    slider.addEventListener('input', (e) => {
      const wid = e.target.dataset.wid;
      const chapter = e.target.dataset.chapter;
      const value = parseInt(e.target.value);

      // Update visual feedback
      const chapterItem = e.target.closest('.chapter-item');
      const progressFill = chapterItem.querySelector('.chapter-progress-fill');
      const percentSpan = chapterItem.querySelector('.chapter-percent');
      const toggleBtn = chapterItem.querySelector('.button-tiny');

      progressFill.style.width = `${value}%`;
      percentSpan.textContent = `${value}%`;
      toggleBtn.textContent = value === 100 ? 'Unread' : 'Read';
      toggleBtn.className = `button button-tiny ${value === 100 ? 'button-secondary' : 'button-success'}`;
    });

    slider.addEventListener('change', async (e) => {
      const wid = e.target.dataset.wid;
      const chapter = parseInt(e.target.dataset.chapter);
      const value = parseInt(e.target.value);

      await updateChapterProgress(wid, chapter, value);
    });
  });

  // Chapter read/unread buttons
  document.querySelectorAll('.chapter-item .button-tiny').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const wid = e.target.dataset.wid;
      const chapter = parseInt(e.target.dataset.chapter);
      const currentProgress = btn.textContent === 'Unread' ? 100 : 0;
      const newProgress = currentProgress === 100 ? 0 : 100;

      await updateChapterProgress(wid, chapter, newProgress);

      // Update UI
      const chapterItem = e.target.closest('.chapter-item');
      const slider = chapterItem.querySelector('.chapter-slider');
      const progressFill = chapterItem.querySelector('.chapter-progress-fill');
      const percentSpan = chapterItem.querySelector('.chapter-percent');

      slider.value = newProgress;
      progressFill.style.width = `${newProgress}%`;
      percentSpan.textContent = `${newProgress}%`;
      btn.textContent = newProgress === 100 ? 'Unread' : 'Read';
      btn.className = `button button-tiny ${newProgress === 100 ? 'button-secondary' : 'button-success'}`;
    });
  });

  // Mark all read/unread buttons
  document.querySelectorAll('.mark-all-read, .mark-all-unread').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const wid = e.target.dataset.wid;
      const markAsRead = e.target.classList.contains('mark-all-read');

      await markAllChapters(wid, markAsRead);
      await loadLibrary();
    });
  });
}

// Update individual chapter progress
async function updateChapterProgress(wid, chapter, progress) {
  try {
    if (window.ao3Storage && window.ao3Storage.updateChapterProgress) {
      const success = window.ao3Storage.updateChapterProgress(wid, chapter, progress);
      if (success) {
        await window.ao3Storage.flush();
        showStatus(`Chapter ${chapter} updated to ${progress}%`, 'success');
      }
    } else {
      // Fallback to v1
      const result = await chrome.storage.local.get(['ao3_progress']);
      const data = result.ao3_progress || '';
      const lines = data.split('\n').filter(line => line.trim());

      const updatedLines = lines.map(line => {
        try {
          const work = JSON.parse(line);
          if (work.wid === wid) {
            if (!work.chapters[chapter]) {
              work.chapters[chapter] = {};
            }
            work.chapters[chapter].p = progress;
            work.lastUpdated = Date.now();
          }
          return JSON.stringify(work);
        } catch (e) {
          return line;
        }
      });

      await chrome.storage.local.set({ ao3_progress: updatedLines.join('\n') });
      showStatus(`Chapter ${chapter} updated to ${progress}%`, 'success');
    }
  } catch (e) {
    console.error('Failed to update chapter progress:', e);
    showStatus('Error updating chapter', 'error');
  }
}

// Mark all chapters as read/unread
async function markAllChapters(wid, markAsRead) {
  try {
    const progress = markAsRead ? 100 : 0;

    if (window.ao3Storage && window.ao3Storage.getWork) {
      const work = window.ao3Storage.getWork(wid);
      if (work) {
        // Update all existing chapters
        Object.keys(work.chapters).forEach(chNum => {
          window.ao3Storage.updateChapterProgress(wid, parseInt(chNum), progress);
        });

        // If marking as read and we know available chapters, fill in missing ones
        if (markAsRead && work.availableChapters) {
          for (let i = 1; i <= work.availableChapters; i++) {
            if (!work.chapters[i]) {
              window.ao3Storage.updateChapterProgress(wid, i, 100);
            }
          }
        }

        await window.ao3Storage.flush();
        showStatus(`All chapters marked as ${markAsRead ? 'read' : 'unread'}`, 'success');
      }
    } else {
      // Fallback to v1
      const result = await chrome.storage.local.get(['ao3_progress']);
      const data = result.ao3_progress || '';
      const lines = data.split('\n').filter(line => line.trim());

      const updatedLines = lines.map(line => {
        try {
          const work = JSON.parse(line);
          if (work.wid === wid) {
            Object.keys(work.chapters).forEach(chNum => {
              work.chapters[chNum].p = progress;
            });

            if (markAsRead && work.availableChapters) {
              for (let i = 1; i <= work.availableChapters; i++) {
                if (!work.chapters[i]) {
                  work.chapters[i] = { p: 100 };
                }
              }
            }

            work.lastUpdated = Date.now();
            if (markAsRead && work.availableChapters) {
              work.completedAt = Date.now();
            }
          }
          return JSON.stringify(work);
        } catch (e) {
          return line;
        }
      });

      await chrome.storage.local.set({ ao3_progress: updatedLines.join('\n') });
      showStatus(`All chapters marked as ${markAsRead ? 'read' : 'unread'}`, 'success');
    }
  } catch (e) {
    console.error('Failed to mark all chapters:', e);
    showStatus('Error updating chapters', 'error');
  }
}

// Mark work as completed
async function markCompleted(wid) {
  try {
    if (window.ao3Storage && window.ao3Storage.markCompleted) {
      const success = window.ao3Storage.markCompleted(wid);
      if (success) {
        await window.ao3Storage.flush();
        showStatus('Work marked as completed!', 'success');
        await loadLibrary();
      } else {
        showStatus('Failed to mark work as completed', 'error');
      }
    } else {
      await markAllChapters(wid, true);
      await loadLibrary();
    }
  } catch (e) {
    console.error('Failed to mark work as completed:', e);
    showStatus('Error updating work', 'error');
  }
}

// Delete work
async function deleteWork(wid) {
  if (!confirm('Are you sure you want to delete this work from your library?')) {
    return;
  }

  try {
    if (window.ao3Storage && window.ao3Storage.deleteWork) {
      const success = window.ao3Storage.deleteWork(wid);
      if (success) {
        await window.ao3Storage.flush();
        showStatus('Work deleted successfully!', 'success');
        await loadLibrary();
      } else {
        showStatus('Failed to delete work', 'error');
      }
    } else {
      const result = await chrome.storage.local.get(['ao3_progress']);
      const data = result.ao3_progress || '';
      const lines = data.split('\n').filter(line => line.trim());

      const updatedLines = lines.filter(line => {
        try {
          const work = JSON.parse(line);
          return work.wid !== wid;
        } catch (e) {
          return true;
        }
      });

      await chrome.storage.local.set({ ao3_progress: updatedLines.join('\n') });
      showStatus('Work deleted successfully!', 'success');
      await loadLibrary();
    }

    // Also remove from expanded works
    expandedWorks.delete(wid);
  } catch (e) {
    console.error('Failed to delete work:', e);
    showStatus('Error deleting work', 'error');
  }
}

// Filter library
function filterLibrary() {
  if (!elements.searchLibrary || !elements.filterLibrary) return;

  const searchTerm = elements.searchLibrary.value.toLowerCase();
  const filterType = elements.filterLibrary.value;

  let filtered = worksCache;

  if (searchTerm) {
    filtered = filtered.filter(work =>
      (work.title || `Work ${work.wid}`).toLowerCase().includes(searchTerm)
    );
  }

  if (filterType === 'reading') {
    filtered = filtered.filter(work => !isWorkCompleted(work));
  } else if (filterType === 'completed') {
    filtered = filtered.filter(work => isWorkCompleted(work));
  }

  displayWorks(filtered);
}

// Test functions for debugging
window.testAO3Settings = function() {
  console.log('=== AO3 Settings Test ===');
  console.log('Current settings:', currentSettings);
  console.log('Works cache length:', worksCache.length);
  console.log('Storage V2:', window.ao3Storage ? 'Loaded' : 'Not loaded');
  console.log('Bookmark sync:', window.ao3BookmarkSync ? 'Loaded' : 'Not loaded');
  console.log('Expanded works:', Array.from(expandedWorks));

  console.log('Testing settings save...');
  saveSettings().then(() => {
    console.log('Settings saved successfully');
  }).catch(e => {
    console.error('Settings save failed:', e);
  });
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}