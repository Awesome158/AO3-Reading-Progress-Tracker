// Popup script for AO3 Reading Progress Tracker
(function () {
  'use strict';

  let worksData = [];
  let isInitialized = false;

  document.addEventListener('DOMContentLoaded', async () => {
    if (isInitialized) return;
    isInitialized = true;

    // Initialize
    await loadStats();
    await loadRecentActivity();

    // Set up event listeners
    setupEventListeners();

    // Check tracking status
    await updateTrackingStatus();
  });

  function setupEventListeners() {
    // Main buttons
    const openSettingsBtn = document.getElementById('openSettings');
    if (openSettingsBtn) {
      openSettingsBtn.addEventListener('click', () => {
        chrome.tabs.create({
          url: chrome.runtime.getURL('settings/settings.html')
        });
        window.close();
      });
    }

    const openLibraryBtn = document.getElementById('openLibrary');
    if (openLibraryBtn) {
      openLibraryBtn.addEventListener('click', () => {
        chrome.tabs.create({
          url: chrome.runtime.getURL('settings/settings.html#library')
        });
        window.close();
      });
    }

    // Quick actions
    const exportDataBtn = document.getElementById('exportData');
    if (exportDataBtn) {
      exportDataBtn.addEventListener('click', handleExportData);
    }

    const refreshDataBtn = document.getElementById('refreshData');
    if (refreshDataBtn) {
      refreshDataBtn.addEventListener('click', async () => {
        // Show loading state
        const icon = document.querySelector('#refreshData .quick-action-icon');
        if (icon) {
          icon.style.animation = 'spin 1s linear infinite';
        }

        await loadStats();
        await loadRecentActivity();

        // Stop spinning
        setTimeout(() => {
          if (icon) {
            icon.style.animation = '';
          }
        }, 500);
      });
    }

    // Toggle tracking
    const toggleTrackingBtn = document.getElementById('toggleTracking');
    if (toggleTrackingBtn) {
      toggleTrackingBtn.addEventListener('click', async (e) => {
        e.preventDefault();

        const settings = await getSettings();
        settings.showProgress = !settings.showProgress;

        await chrome.storage.local.set({ ao3_settings: settings });
        await updateTrackingStatus();
      });
    }
  }

  async function handleExportData() {
    try {
      let data, filename;

      // Check if using v2 storage
      if (window.ao3Storage && window.ao3Storage.exportData) {
        await waitForStorage();
        data = window.ao3Storage.exportData();
        filename = `ao3_progress_v2_${new Date().toISOString().split('T')[0]}.json`;
      } else {
        // Fallback to v1 export
        const result = await chrome.storage.local.get(['ao3_progress']);
        data = result.ao3_progress || '';
        filename = `ao3_progress_${new Date().toISOString().split('T')[0]}.ndjson`;
      }

      if (!data) {
        alert('No data to export');
        return;
      }

      // Create and download file
      const blob = new Blob([data], {
        type: filename.endsWith('.json') ? 'application/json' : 'application/x-ndjson'
      });
      const url = URL.createObjectURL(blob);

      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: true
      });

      window.close();
    } catch (e) {
      console.error('Export failed:', e);
      alert('Export failed: ' + e.message);
    }
  }

  async function loadStats() {
    try {
      // Get storage stats if using v2
      let storageStats = null;
      if (window.ao3Storage && window.ao3Storage.getStats) {
        await waitForStorage();
        storageStats = window.ao3Storage.getStats();
      }

      if (storageStats) {
        // Using v2 storage
        const works = await window.ao3Storage.getAllWorks();
        const completed = storageStats.completedWorks;
        const inProgress = storageStats.activeWorks;
        const total = storageStats.totalWorks;
        const completionRate = total > 0 ? (completed / total) * 100 : 0;

        updateStats(total, completed, inProgress);
        updateProgressBar(completionRate);

        // Add storage info to footer
        if (storageStats.compressionRatio !== '0%') {
          const footerText = document.getElementById('trackingStatus');
          if (footerText) {
            footerText.title = `Storage saved: ${storageStats.compressionRatio} (${formatBytes(storageStats.savedBytes)} saved)`;
          }
        }

        worksData = works;
      } else {
        // Fallback for v1 storage
        const result = await chrome.storage.local.get(['ao3_progress']);
        const data = result.ao3_progress || '';

        if (!data) {
          showEmptyState();
          return;
        }

        // Parse works
        const works = [];
        const lines = data.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const work = JSON.parse(line);
            works.push(work);
          } catch (e) {
            console.error('Failed to parse work:', e);
          }
        }

        if (works.length === 0) {
          showEmptyState();
          return;
        }

        // Calculate stats
        const completed = works.filter(w => {
          const chapters = Object.values(w.chapters);
          return chapters.length > 0 && chapters.every(ch => ch.p === 100);
        }).length;

        const inProgress = works.length - completed;
        const completionRate = works.length > 0 ? (completed / works.length) * 100 : 0;

        // Update UI
        updateStats(works.length, completed, inProgress);
        updateProgressBar(completionRate);

        // Store works for recent activity
        worksData = works;
      }

      // Show/hide appropriate sections
      const emptyState = document.getElementById('emptyState');
      const progressOverview = document.getElementById('progressOverview');
      const actionButtons = document.getElementById('actionButtons');

      if (emptyState) emptyState.style.display = 'none';
      if (progressOverview) progressOverview.style.display = 'block';
      if (actionButtons) actionButtons.style.display = 'flex';

    } catch (e) {
      console.error('Failed to load stats:', e);
      showEmptyState();
    }
  }

  async function waitForStorage() {
    let attempts = 0;
    while ((!window.ao3Storage || !window.ao3Storage.ready) && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    if (attempts >= 50) {
      throw new Error('Storage initialization timeout');
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function updateStats(total, completed, inProgress) {
    const totalEl = document.getElementById('totalWorks');
    const completedEl = document.getElementById('completedWorks');
    const inProgressEl = document.getElementById('inProgressWorks');

    if (totalEl) totalEl.textContent = total;
    if (completedEl) completedEl.textContent = completed;
    if (inProgressEl) inProgressEl.textContent = inProgress;
  }

  function updateProgressBar(percentage) {
    const fill = document.getElementById('overallProgress');
    const text = document.getElementById('progressText');

    if (fill) fill.style.width = `${percentage}%`;
    if (text) text.textContent = `${Math.round(percentage)}% of tracked works completed`;
  }

  async function loadRecentActivity() {
    const recentActivity = document.getElementById('recentActivity');
    if (!recentActivity) return;

    if (!worksData || worksData.length === 0) {
      recentActivity.style.display = 'none';
      return;
    }

    // Sort by last updated
    const recent = worksData
      .filter(w => w.lastUpdated)
      .sort((a, b) => b.lastUpdated - a.lastUpdated)
      .slice(0, 3);

    if (recent.length === 0) {
      recentActivity.style.display = 'none';
      return;
    }

    // Display recent works
    const recentList = document.getElementById('recentList');
    if (recentList) {
      recentList.innerHTML = recent.map(work => {
        const chapters = Object.values(work.chapters);
        const avgProgress = chapters.reduce((sum, ch) => sum + ch.p, 0) / Math.max(chapters.length, 1);

        return `
          <div class="recent-work">
            <div class="recent-work-title" title="${work.title || `Work ${work.wid}`}">
              ${work.title || `Work ${work.wid}`}
            </div>
            <div class="recent-work-progress">
              ${Math.round(avgProgress)}% read
            </div>
          </div>
        `;
      }).join('');
    }

    recentActivity.style.display = 'block';
  }

  function showEmptyState() {
    const emptyState = document.getElementById('emptyState');
    const progressOverview = document.getElementById('progressOverview');
    const recentActivity = document.getElementById('recentActivity');
    const actionButtons = document.getElementById('actionButtons');

    if (emptyState) emptyState.style.display = 'block';
    if (progressOverview) progressOverview.style.display = 'none';
    if (recentActivity) recentActivity.style.display = 'none';
    if (actionButtons) actionButtons.style.display = 'none';

    updateStats(0, 0, 0);
  }

  async function getSettings() {
    try {
      const result = await chrome.storage.local.get(['ao3_settings']);
      return result.ao3_settings || {
        autoDeleteCompleted: false,
        deletionTiming: '7 days',
        showProgress: true,
        scrollSensitivity: 5
      };
    } catch (e) {
      console.error('Failed to get settings:', e);
      return {
        autoDeleteCompleted: false,
        deletionTiming: '7 days',
        showProgress: true,
        scrollSensitivity: 5
      };
    }
  }

  async function updateTrackingStatus() {
    const settings = await getSettings();
    const statusElement = document.getElementById('trackingStatus');
    const toggleLink = document.getElementById('toggleTracking');

    if (statusElement) {
      if (settings.showProgress) {
        statusElement.textContent = 'Tracking enabled';
        statusElement.className = '';
      } else {
        statusElement.textContent = 'Tracking disabled';
        statusElement.className = 'disabled';
      }
    }

    if (toggleLink) {
      toggleLink.textContent = settings.showProgress ? 'Disable' : 'Enable';
    }
  }

  // Handle errors gracefully
  window.addEventListener('error', (e) => {
    console.error('Popup error:', e);
  });

})();