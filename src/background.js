// Background service worker for AO3 Reading Progress Tracker

// Handle extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[AO3 Background] Extension installed/updated');

  if (details.reason === 'install') {
    // Set default settings
    await chrome.storage.local.set({
      ao3_settings: {
        autoDeleteCompleted: false,
        deletionTiming: '7 days',
        showProgress: true,
        scrollSensitivity: 5,
        checkForUpdates: true,
        updateCheckInterval: 24,
        syncWithBookmarks: false,
        bookmarkTagPrefix: 'Reading Progress:',
        bookmarkPrivate: true,
        bookmarkAutoCreate: false
      }
    });

    // Open settings page on first install
    try {
      await chrome.tabs.create({
        url: chrome.runtime.getURL('settings/settings.html')
      });
    } catch (e) {
      console.error('Failed to open settings page:', e);
    }
  }

  // Set up alarms for periodic tasks
  setupAlarms();
});

// Service worker startup
console.log('[AO3 Background] Service worker started');

// Set up periodic alarms
async function setupAlarms() {
  console.log('[AO3 Background] Setting up alarms');

  // Daily cleanup alarm
  chrome.alarms.create('cleanup', { periodInMinutes: 24 * 60 });

  // Chapter update check alarm (default: every 24 hours)
  const settings = await getSettings();
  const intervalHours = settings.updateCheckInterval || 24;
  chrome.alarms.create('checkChapterUpdates', {
    periodInMinutes: intervalHours * 60,
    delayInMinutes: 1
  });

  console.log('[AO3 Background] Alarms set up');
}

// Get settings
async function getSettings() {
  const result = await chrome.storage.local.get(['ao3_settings']);
  return result.ao3_settings || {
    autoDeleteCompleted: false,
    deletionTiming: '7 days',
    showProgress: true,
    scrollSensitivity: 5,
    checkForUpdates: true,
    updateCheckInterval: 24,
    syncWithBookmarks: false,
    bookmarkTagPrefix: 'Reading Progress:',
    bookmarkPrivate: true,
    bookmarkAutoCreate: false
  };
}

// Handle messages from content scripts and settings page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[AO3 Background] Received message:', request.action, request);

  switch (request.action) {
    case 'ping':
      sendResponse({ status: 'ok', timestamp: Date.now() });
      break;

    case 'getSettings':
      handleGetSettings(sendResponse);
      return true;

    case 'openSettings':
      chrome.tabs.create({
        url: chrome.runtime.getURL('settings/settings.html')
      }).catch(e => console.error('Failed to open settings:', e));
      break;

    case 'exportData':
      handleExportData(sendResponse);
      return true;

    case 'cleanupCompleted':
      handleCleanupCompleted(sendResponse);
      return true;

    case 'checkSingleWork':
      console.log('[AO3 Background] Starting update check for work:', request.wid);
      checkWorkForUpdates(request.wid, sendResponse);
      return true; // Keep message channel open for async response

    default:
      console.warn('[AO3 Background] Unknown action:', request.action);
      sendResponse({ error: 'Unknown action' });
      break;
  }
});

async function handleGetSettings(sendResponse) {
  try {
    const settings = await getSettings();
    sendResponse(settings);
  } catch (e) {
    console.error('Failed to get settings:', e);
    sendResponse(null);
  }
}

async function handleExportData(sendResponse) {
  try {
    const result = await chrome.storage.local.get(['ao3_progress']);
    const data = result.ao3_progress || '';

    // Create a blob and download URL
    const blob = new Blob([data], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);

    // Generate filename with timestamp
    const date = new Date().toISOString().split('T')[0];
    const filename = `ao3_progress_${date}.ndjson`;

    // Trigger download
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }, (downloadId) => {
      // Clean up the URL after download starts
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      sendResponse({ success: true, downloadId });
    });
  } catch (e) {
    console.error('Failed to export data:', e);
    sendResponse({ success: false, error: e.message });
  }
}

async function handleCleanupCompleted(sendResponse) {
  try {
    const settings = await getSettings();

    if (!settings || !settings.autoDeleteCompleted) {
      sendResponse({ cleaned: 0 });
      return;
    }

    const progressResult = await chrome.storage.local.get(['ao3_progress', 'ao3_completed']);

    // Handle completed works stored separately
    if (progressResult.ao3_completed) {
      // Storage V2 format - completed works are already separated
      const completedData = JSON.parse(progressResult.ao3_completed);
      const now = Date.now();
      const deletionDelay = parseDeletionDelay(settings.deletionTiming);

      let cleaned = 0;
      const remainingWorks = completedData.works.filter(work => {
        if (work.ca && (now - work.ca) > deletionDelay) {
          cleaned++;
          return false;
        }
        return true;
      });

      if (cleaned > 0) {
        completedData.works = remainingWorks;
        await chrome.storage.local.set({
          ao3_completed: JSON.stringify(completedData)
        });
      }

      sendResponse({ cleaned });
      return;
    }

    // Legacy format
    if (!progressResult.ao3_progress) {
      sendResponse({ cleaned: 0 });
      return;
    }

    const lines = progressResult.ao3_progress.split('\n').filter(line => line.trim());
    const works = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    const now = Date.now();
    const deletionDelay = parseDeletionDelay(settings.deletionTiming);
    let cleaned = 0;

    const remainingWorks = works.filter(work => {
      if (work.completedAt && (now - work.completedAt) > deletionDelay) {
        cleaned++;
        return false;
      }
      return true;
    });

    if (cleaned > 0) {
      const newNdjson = remainingWorks.map(w => JSON.stringify(w)).join('\n');
      await chrome.storage.local.set({ ao3_progress: newNdjson });
    }

    sendResponse({ cleaned });
  } catch (e) {
    console.error('Failed to cleanup completed works:', e);
    sendResponse({ cleaned: 0, error: e.message });
  }
}

function parseDeletionDelay(timing) {
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

// Fixed version using offscreen document for DOM parsing
async function checkWorkForUpdates(wid, sendResponse) {
  console.log(`[AO3 Background] Checking work ${wid} for updates...`);

  try {
    // Get current stored data
    const result = await chrome.storage.local.get(['ao3_progress']);
    if (!result.ao3_progress) {
      console.error('[AO3 Background] No stored data found');
      sendResponse({ success: false, error: 'No stored data' });
      return;
    }

    const lines = result.ao3_progress.split('\n').filter(line => line.trim());
    let targetWork = null;
    let workIndex = -1;

    // Find the work
    const parsedWorks = lines.map((line, index) => {
      try {
        const work = JSON.parse(line);
        if (work.wid === wid) {
          targetWork = work;
          workIndex = index;
        }
        return work;
      } catch {
        return null;
      }
    }).filter(Boolean);

    if (!targetWork) {
      console.error('[AO3 Background] Work not found:', wid);
      sendResponse({ success: false, error: 'Work not found in storage' });
      return;
    }

    console.log('[AO3 Background] Found work:', {
      wid: targetWork.wid,
      title: targetWork.title,
      chapters: Object.keys(targetWork.chapters || {}).length
    });

    // Construct URL for the work
    const url = `https://archiveofourown.org/works/${wid}?view_adult=true`;
    console.log(`[AO3 Background] Fetching work page: ${url}`);

    try {
      // Fetch the work page
      const response = await fetch(url, {
        credentials: 'include',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();

      // Parse HTML using regex (since DOMParser is not available in service workers)
      const pageData = {
        title: '',
        availableChapters: 0,
        totalChapters: null,
        isWIP: true
      };

      // Extract title
      const titleMatch = html.match(/<h2[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h2>/);
      if (titleMatch) {
        pageData.title = titleMatch[1].trim();
      }

      // Extract chapter count from stats
      const chapterStatsMatch = html.match(/<dd[^>]*class="[^"]*chapters[^"]*"[^>]*>(\d+)\/(\d+|\?)<\/dd>/);
      if (chapterStatsMatch) {
        pageData.availableChapters = parseInt(chapterStatsMatch[1]);
        if (chapterStatsMatch[2] === '?') {
          pageData.totalChapters = null;
          pageData.isWIP = true;
        } else {
          pageData.totalChapters = parseInt(chapterStatsMatch[2]);
          pageData.isWIP = false;
        }
      } else {
        // Fallback: try to count chapter links
        const chapterLinks = html.match(/<option[^>]*value="[^"]*\/chapters\/\d+"/g);
        if (chapterLinks) {
          pageData.availableChapters = chapterLinks.length;
        }
      }

      console.log(`[AO3 Background] Extracted data:`, pageData);

      // Check if there are any updates
      let hasUpdates = false;
      const oldAvailableChapters = targetWork.availableChapters || Object.keys(targetWork.chapters || {}).length;

      if (pageData.availableChapters > oldAvailableChapters) {
        hasUpdates = true;
        console.log(`[AO3 Background] Found updates: ${oldAvailableChapters} -> ${pageData.availableChapters} chapters`);
      }

      // Update the work data
      targetWork.title = pageData.title || targetWork.title;
      targetWork.availableChapters = pageData.availableChapters;
      targetWork.totalChapters = pageData.totalChapters;
      targetWork.isWIP = pageData.isWIP;
      targetWork.lastChecked = Date.now();

      // Save updated data
      lines[workIndex] = JSON.stringify(targetWork);
      await chrome.storage.local.set({
        ao3_progress: lines.join('\n')
      });

      console.log(`[AO3 Background] Successfully updated work ${wid}: ${pageData.availableChapters}/${pageData.totalChapters || '?'} chapters`);

      sendResponse({
        success: true,
        updated: hasUpdates,
        hasNewChapters: hasUpdates,
        availableChapters: pageData.availableChapters,
        totalChapters: pageData.totalChapters || '?',
        title: pageData.title
      });

    } catch (fetchError) {
      console.error('[AO3 Background] Fetch error:', fetchError);

      // Fallback: try using a tab
      try {
        const tab = await chrome.tabs.create({
          url: url,
          active: false
        });

        console.log(`[AO3 Background] Created tab ${tab.id} for fallback`);

        // Wait for tab to load
        await new Promise(resolve => {
          chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          });
        });

        // Inject script to extract data
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const titleElement = document.querySelector('h2.title.heading');
            const title = titleElement ? titleElement.textContent.trim() : '';

            const chapterSelect = document.querySelector('#selected_id');
            const availableChapters = chapterSelect ? chapterSelect.options.length : 0;

            const statsElement = document.querySelector('dl.stats dd.chapters');
            let totalChapters = null;
            let isWIP = true;

            if (statsElement) {
              const statsText = statsElement.textContent.trim();
              const match = statsText.match(/(\d+)\/(\d+|\?)/);
              if (match) {
                totalChapters = match[2] === '?' ? null : parseInt(match[2]);
                isWIP = match[2] === '?';
              }
            }

            return {
              title,
              availableChapters,
              totalChapters,
              isWIP
            };
          }
        });

        // Close the tab
        await chrome.tabs.remove(tab.id);

        if (results && results[0] && results[0].result) {
          const pageData = results[0].result;

          // Check for updates
          let hasUpdates = false;
          const oldAvailableChapters = targetWork.availableChapters || Object.keys(targetWork.chapters || {}).length;

          if (pageData.availableChapters > oldAvailableChapters) {
            hasUpdates = true;
          }

          // Update work data
          targetWork.title = pageData.title || targetWork.title;
          targetWork.availableChapters = pageData.availableChapters;
          targetWork.totalChapters = pageData.totalChapters;
          targetWork.isWIP = pageData.isWIP;
          targetWork.lastChecked = Date.now();

          // Save
          lines[workIndex] = JSON.stringify(targetWork);
          await chrome.storage.local.set({
            ao3_progress: lines.join('\n')
          });

          sendResponse({
            success: true,
            updated: hasUpdates,
            hasNewChapters: hasUpdates,
            availableChapters: pageData.availableChapters,
            totalChapters: pageData.totalChapters || '?',
            title: pageData.title
          });
        } else {
          throw new Error('No data extracted from tab');
        }
      } catch (tabError) {
        console.error('[AO3 Background] Tab method also failed:', tabError);
        sendResponse({
          success: false,
          error: 'Failed to fetch work data',
          details: tabError.message
        });
      }
    }
  } catch (e) {
    console.error(`[AO3 Background] General error checking work ${wid}:`, e);
    sendResponse({
      success: false,
      error: e.message,
      details: `Failed to check work: ${e.message}`
    });
  }
}

// Check for chapter updates on tracked works
async function checkAllWorksForUpdates() {
  console.log('[AO3 Background] Checking for chapter updates...');

  try {
    const settings = await getSettings();
    if (!settings.checkForUpdates) {
      console.log('[AO3 Background] Update checking disabled');
      return;
    }

    // Get all active works (not completed)
    const result = await chrome.storage.local.get(['ao3_progress']);
    if (!result.ao3_progress) return;

    const lines = result.ao3_progress.split('\n').filter(line => line.trim());
    const works = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    // Only check works that are WIP or haven't been completed
    const worksToCheck = works.filter(work =>
      work.isWIP || !work.completedAt
    );

    console.log(`[AO3 Background] Checking ${worksToCheck.length} works for updates`);

    let updatedCount = 0;

    // Check each work (with delays to avoid hammering the server)
    for (let i = 0; i < worksToCheck.length; i++) {
      const work = worksToCheck[i];

      try {
        const updated = await new Promise((resolve) => {
          checkWorkForUpdates(work.wid, (response) => {
            resolve(response?.hasNewChapters || false);
          });
        });

        if (updated) updatedCount++;

        // Wait 5 seconds between checks to be polite to AO3
        if (i < worksToCheck.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      } catch (e) {
        console.error(`Failed to check work ${work.wid}:`, e);
      }
    }

    console.log(`[AO3 Background] Update check complete. ${updatedCount} works updated.`);

    // Show notification if works were updated
    if (updatedCount > 0 && chrome.notifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: 'AO3 Reading Progress Tracker',
        message: `${updatedCount} work${updatedCount > 1 ? 's have' : ' has'} new chapters available!`
      });
    }
  } catch (e) {
    console.error('[AO3 Background] Error checking for updates:', e);
  }
}

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log(`[AO3 Background] Alarm triggered: ${alarm.name}`);

  switch (alarm.name) {
    case 'cleanup':
      handleCleanupCompleted(() => {});
      break;

    case 'checkChapterUpdates':
      await checkAllWorksForUpdates();
      break;
  }
});

// Listen for settings changes to update alarm intervals
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.ao3_settings) {
    const newSettings = changes.ao3_settings.newValue;
    const oldSettings = changes.ao3_settings.oldValue || {};

    // Check if update interval changed
    if (newSettings.updateCheckInterval !== oldSettings.updateCheckInterval) {
      // Recreate the alarm with new interval
      chrome.alarms.clear('checkChapterUpdates', () => {
        const intervalHours = newSettings.updateCheckInterval || 24;
        chrome.alarms.create('checkChapterUpdates', {
          periodInMinutes: intervalHours * 60,
          delayInMinutes: 1
        });
        console.log(`[AO3 Background] Update check interval changed to ${intervalHours} hours`);
      });
    }
  }
});