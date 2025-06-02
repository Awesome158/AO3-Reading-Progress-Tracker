#!/usr/bin/env node

/**
 * Simple build script for AO3 Reading Progress Tracker
 * Usage: node build-simple.js [chrome|firefox|all]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const CONFIG = {
  name: 'ao3-reading-progress-tracker',
  version: '1.0.0',
  src: './', // Current directory structure
  dist: './dist'
};

// Files to copy (relative to src)
const FILES_TO_COPY = [
  'manifest.json',
  'background.js',
  'content.js',
  'content.css',
  'popup/popup.html',
  'popup/popup.js',
  'popup/popup.css',
  'settings/settings.html',
  'settings/settings.js',
  'settings/style.css',
  'utils/storage-v2.js',
  'utils/bookmark-sync.js',
  'icons/icon-16.png',
  'icons/icon-42.png',
  'icons/icon-128.png'
];

// Ensure directory exists
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Copy file with directory creation
function copyFile(src, dest) {
  const destDir = path.dirname(dest);
  ensureDir(destDir);
  fs.copyFileSync(src, dest);
}

// Clean dist directory
function cleanDist(browser = null) {
  if (browser) {
    const browserDir = path.join(CONFIG.dist, browser);
    if (fs.existsSync(browserDir)) {
      fs.rmSync(browserDir, { recursive: true, force: true });
    }
  } else {
    if (fs.existsSync(CONFIG.dist)) {
      fs.rmSync(CONFIG.dist, { recursive: true, force: true });
    }
  }
}

// Generate Firefox manifest (Manifest V2)
function generateFirefoxManifest(chromeManifest) {
  return {
    manifest_version: 2,
    name: chromeManifest.name,
    version: chromeManifest.version,
    description: chromeManifest.description,

    permissions: [
      ...chromeManifest.permissions,
      ...chromeManifest.host_permissions
    ],

    background: {
      scripts: ["background-firefox.js"],
      persistent: false
    },

    content_scripts: chromeManifest.content_scripts,

    browser_action: {
      default_title: chromeManifest.action.default_title,
      default_popup: chromeManifest.action.default_popup
    },

    options_ui: {
      page: chromeManifest.options_page,
      open_in_tab: true
    },

    icons: chromeManifest.icons,

    browser_specific_settings: {
      gecko: {
        id: "ao3-progress-tracker@example.com",
        strict_min_version: "89.0"
      }
    }
  };
}

// Create Firefox-compatible background script
function createFirefoxBackground(content) {
  // Add polyfill at the beginning
  const polyfill = `// Firefox polyfill
if (typeof browser !== 'undefined' && typeof chrome === 'undefined') {
  window.chrome = browser;
}

`;
  
  // Simple replacements for Firefox compatibility
  return polyfill + content
    .replace(/chrome\.tabs\.create/g, 'browser.tabs.create')
    .replace(/chrome\.runtime\./g, 'browser.runtime.')
    .replace(/chrome\.storage\./g, 'browser.storage.')
    .replace(/chrome\.downloads\./g, 'browser.downloads.')
    .replace(/chrome\.alarms\./g, 'browser.alarms.');
}

// Build for Chrome/Edge
async function buildChrome() {
  console.log('Building for Chrome/Edge...');
  
  const browserDir = path.join(CONFIG.dist, 'chrome');
  cleanDist('chrome');
  ensureDir(browserDir);
  
  // Copy all files
  for (const file of FILES_TO_COPY) {
    const srcPath = path.join(CONFIG.src, file);
    const destPath = path.join(browserDir, file);
    
    if (fs.existsSync(srcPath)) {
      copyFile(srcPath, destPath);
      console.log(`  ✓ ${file}`);
    } else {
      console.warn(`  ⚠ Missing: ${file}`);
    }
  }
  
  console.log('Chrome build complete!\n');
  return browserDir;
}

// Build for Firefox
async function buildFirefox() {
  console.log('Building for Firefox...');
  
  const browserDir = path.join(CONFIG.dist, 'firefox');
  cleanDist('firefox');
  ensureDir(browserDir);
  
  // Read Chrome manifest
  const chromeManifest = JSON.parse(
    fs.readFileSync(path.join(CONFIG.src, 'manifest.json'), 'utf8')
  );
  
  // Generate and write Firefox manifest
  const firefoxManifest = generateFirefoxManifest(chromeManifest);
  fs.writeFileSync(
    path.join(browserDir, 'manifest.json'),
    JSON.stringify(firefoxManifest, null, 2)
  );
  console.log('  ✓ manifest.json (converted to v2)');
  
  // Copy files with modifications
  for (const file of FILES_TO_COPY) {
    if (file === 'manifest.json') continue; // Already handled

    const srcPath = path.join(CONFIG.src, file);
    const destPath = path.join(browserDir, file);

    if (!fs.existsSync(srcPath)) {
      console.warn(`  ⚠ Missing: ${file}`);
      continue;
    }

    if (file === 'background.js') {
      // Create Firefox-compatible background script
      const content = fs.readFileSync(srcPath, 'utf8');
      const firefoxContent = createFirefoxBackground(content);

      ensureDir(path.dirname(destPath));
      fs.writeFileSync(
        path.join(browserDir, 'background-firefox.js'),
        firefoxContent
      );
      console.log('  ✓ background-firefox.js (converted)');
    } else if (file.endsWith('.js')) {
      // Add browser polyfill to other JS files
      let content = fs.readFileSync(srcPath, 'utf8');

      // Only add polyfill if file uses chrome APIs
      if (content.includes('chrome.')) {
        content = `// Firefox compatibility
if (typeof browser !== 'undefined' && typeof chrome === 'undefined') {
  window.chrome = browser;
}

` + content;
      }

      ensureDir(path.dirname(destPath));
      fs.writeFileSync(destPath, content);
      console.log(`  ✓ ${file} (with polyfill)`);
    } else {
      // Copy other files as-is
      copyFile(srcPath, destPath);
      console.log(`  ✓ ${file}`);
    }
  }
  
  console.log('Firefox build complete!\n');
  return browserDir;
}

// Create zip file
function createZip(sourceDir, outputName) {
  const zipPath = path.join(CONFIG.dist, outputName);
  
  try {
    // Try using native zip command (cross-platform)
    if (process.platform === 'win32') {
      // Windows PowerShell
      execSync(
        `powershell Compress-Archive -Path "${sourceDir}/*" -DestinationPath "${zipPath}" -Force`,
        { stdio: 'inherit' }
      );
    } else {
      // macOS/Linux
      execSync(
        `cd "${sourceDir}" && zip -r "${path.resolve(zipPath)}" .`,
        { stdio: 'inherit' }
      );
    }
    
    const stats = fs.statSync(zipPath);
    console.log(`Created ${outputName} (${(stats.size / 1024).toFixed(2)} KB)`);
    return true;
  } catch (e) {
    console.warn(`Could not create zip file: ${e.message}`);
    console.log(`Extension files are in: ${sourceDir}`);
    return false;
  }
}

// Validate build
function validateBuild(browserDir, browser) {
  console.log(`Validating ${browser} build...`);
  const errors = [];
  
  // Check manifest
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(browserDir, 'manifest.json'), 'utf8')
    );
    console.log(`  ✓ Valid manifest v${manifest.manifest_version}`);
  } catch (e) {
    errors.push(`Invalid manifest: ${e.message}`);
  }

  // Check required files
  const requiredFiles = [
    'content.js',
    browser === 'firefox' ? 'background-firefox.js' : 'background.js',
    'popup/popup.html',
    'settings/settings.html'
  ];
  
  for (const file of requiredFiles) {
    const filePath = path.join(browserDir, file);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        errors.push(`Empty file: ${file}`);
      } else {
        console.log(`  ✓ ${file} (${(stats.size / 1024).toFixed(2)} KB)`);
      }
    } else {
      errors.push(`Missing required file: ${file}`);
    }
  }
  
  if (errors.length > 0) {
    console.error('\n❌ Validation errors:');
    errors.forEach(e => console.error(`  - ${e}`));
    return false;
  }
  
  console.log('  ✓ Validation passed!\n');
  return true;
}

// Main build function
async function build() {
  const target = process.argv[2] || 'all';
  
  console.log('AO3 Reading Progress Tracker - Simple Build Script');
  console.log('================================================\n');
  
  // Check if source files exist
  const missingFiles = FILES_TO_COPY.filter(
    file => !fs.existsSync(path.join(CONFIG.src, file))
  );

  if (missingFiles.length > 0) {
    console.error('❌ Missing source files:');
    missingFiles.forEach(file => console.error(`  - ${file}`));
    console.log('\nPlease ensure all source files are present before building.');
    process.exit(1);
  }
  
  // Clean dist directory
  cleanDist();
  ensureDir(CONFIG.dist);
  
  let chromeDir, firefoxDir;

  // Build based on target
  if (target === 'chrome' || target === 'all') {
    chromeDir = await buildChrome();
    if (validateBuild(chromeDir, 'chrome')) {
      createZip(chromeDir, `${CONFIG.name}-chrome-v${CONFIG.version}.zip`);
    }
  }
  
  if (target === 'firefox' || target === 'all') {
    firefoxDir = await buildFirefox();
    if (validateBuild(firefoxDir, 'firefox')) {
      createZip(firefoxDir, `${CONFIG.name}-firefox-v${CONFIG.version}.zip`);
    }
  }
  
  if (target !== 'chrome' && target !== 'firefox' && target !== 'all') {
    console.error(`Unknown target: ${target}`);
    console.log('Usage: node build-simple.js [chrome|firefox|all]');
    process.exit(1);
  }
  
  // Final instructions
  console.log('\n✨ Build complete!\n');
  console.log('Next steps:');
  console.log('1. Test the extensions:');
  if (chromeDir) {
    console.log(`   - Chrome: Load unpacked from ${chromeDir}`);
  }
  if (firefoxDir) {
    console.log(`   - Firefox: Load temporary add-on from ${firefoxDir}`);
  }
  console.log('\n2. Upload to stores:');
  console.log('   - Chrome Web Store: https://chrome.google.com/webstore/devconsole');
  console.log('   - Firefox Add-ons: https://addons.mozilla.org/developers/');
  console.log('   - Edge Add-ons: Use the Chrome version');
}

// Run build
if (require.main === module) {
  build().catch(err => {
    console.error('\n❌ Build failed:', err);
    process.exit(1);
  });
}