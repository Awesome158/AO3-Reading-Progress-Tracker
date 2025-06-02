# AO3 Reading Progress Tracker

A browser extension that tracks your reading progress on Archive of Our Own (AO3).

## Features

- 📖 Automatically tracks reading progress for each chapter
- 📊 Shows progress statistics on work listings
- 💾 Stores progress locally in your browser
- 🔄 Syncs across all AO3 pages
- 📱 Works with all AO3 skins and layouts
- 🎯 Remembers your last reading position
- 📈 Visual progress indicators

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/V7V61DJS2R)

## Installation

### For Development

1. Clone this repository
2. Open your browser's extension management page:
   - **Chrome**: `chrome://extensions/`
   - **Firefox**: `about:debugging`
   - **Edge**: `edge://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" (Chrome/Edge) or "Load Temporary Add-on" (Firefox)
5. Select the src directory

## Usage

### Basic Usage

1. Navigate to any work on AO3
2. Start reading - progress is tracked automatically
3. Progress indicators appear in work statistics
4. Click the extension icon to see overall statistics

### Settings

Access settings through:
- Extension popup → "Open Settings"
- Or right-click extension icon → "Options"

Available settings:
- **Show reading progress**: Toggle progress display
- **Auto-delete completed**: Remove completed works after a period
- **Scroll sensitivity**: Adjust progress tracking sensitivity

### Data Management

- **Export**: Save your reading data as JSON
- **Import**: Restore data from a backup
- **Library**: View and manage all tracked works

## Development

### Debug Mode

Enable debug mode in the browser console:
```javascript
enableAO3Debug()
```

### Testing

Open the test page (`test-extension.html`) to verify:
- Extension is loaded correctly
- Storage is working
- Chrome APIs are accessible

### Manual Testing Commands

```javascript
// Check current work data
testAO3Progress()

// View all stored works
window.ao3Storage.getAllWorks()

// Check storage statistics
window.ao3Storage.getStats()

// Clear data for current work
clearWorkProgress()
```

## Browser Compatibility

- ✅ Chrome/Chromium
- ✅ Edge
- ✅ Firefox
- ✅ Opera

## Troubleshooting

### Extension not working?

1. **Check permissions**: Ensure the extension has permission for `archiveofourown.org`
2. **Reload the page**: Some features require a page refresh after installation
3. **Check console**: Press F12 and look for error messages
4. **Disable conflicting extensions**: Some ad blockers may interfere

### Progress not showing?

1. Ensure "Show reading progress" is enabled in settings
2. Check if the work has been tracked (read at least one chapter)
3. Try refreshing the page
4. Enable debug mode to see detailed information

### Storage issues?

1. Check available storage: Chrome allows unlimited storage with permission
2. Export your data regularly as a backup
3. Clear corrupted data through settings if needed

## Privacy

This extension:
- ✅ Stores all data locally on your device
- ✅ Never sends data to external servers
- ✅ Only runs on archiveofourown.org
- ✅ Open source and auditable

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Test thoroughly with different AO3 pages
4. Submit a pull request

## Known Issues

- Progress might not track correctly on very short chapters
- Some custom AO3 skins may require page refresh
- Firefox version requires Manifest V2 (automatic conversion)

## License

MIT License - see LICENSE file for details

## Support

For issues and feature requests, please use the GitHub issue tracker.
