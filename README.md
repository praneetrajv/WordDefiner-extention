# Word Definer

A lightweight, Manifest V3 Firefox browser extension designed to instantly look up word definitions via double-click on web pages or through a persistent sidebar for local files and PDFs.

## Features

* **Double-Click Lookup:** Highlight or double-click any single word on normal web pages to instantly view its definition in a sleek popup tooltip.
* **Persistent Sidebar Support:** Seamlessly open the extension as a Firefox sidebar to look up words continuously while reading local documents or PDFs without the extension window closing.
* **Context Menu Integration:** Right-click any selected text and select "Define" to look it up on demand.
* **Smart Stemming Fallback:** Automatically handles different verb tenses and word forms (e.g., matching variations like pluralization or past tense) to improve dictionary hit rates.
* **Audio Pronunciations:** Includes pronunciation audio playback buttons directly inside the definition view.

---

## Project Structure

```text
word-definer/
├── manifest.json       # Extension configuration (Manifest V3)
├── background.js       # Background service handling API requests and context menus
├── content.js          # Content script handling text selection, tooltips, and floating UI
├── content.css         # Styling for tooltips and in-page elements
├── popup.html          # UI markup for the extension popup and sidebar panel
├── popup.js            # Logic for manual search and sidebar/popup state management
└── popup.css           # Styling for the sidebar and popup interface
