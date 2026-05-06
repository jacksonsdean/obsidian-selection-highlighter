# Obsidian Selection Highlighter

> **Highlight text in one gesture** — select and it's highlighted. No buttons, no menus.

---

## What it does

When **selection highlighting** is enabled the plugin watches for text selections in the Obsidian editor. As soon as you release the pointer (mouse button, finger, or stylus) the selected text is automatically wrapped in Obsidian's `==highlight==` markers.

```
Before: The quick brown fox jumps over the lazy dog.
After:  The quick ==brown fox== jumps over the lazy dog.
```

This is especially useful on **touch / stylus devices** where swiping across text with a stylus should highlight it — just like a physical highlighter or a PDF reader — reducing the interaction from two steps (select → click toolbar button) to one (select).

---

## Commands

| Command | Description |
|---|---|
| **Enable selection highlighting** | Turn the feature on |
| **Disable selection highlighting** | Turn the feature off |
| **Toggle selection highlighting** | Flip the current state |
| **Change highlight color** | Pick the color used to display highlighted text |

All commands are available in the **Command Palette** (`Ctrl/Cmd + P`) and can be bound to a keyboard shortcut or toolbar button.

---

## Settings

Open *Settings → Community Plugins → Selection Highlighter* to configure:

| Setting | Default | Description |
|---|---|---|
| **Enable on startup** | Off | Whether selection highlighting should be active when Obsidian loads |
| **Highlight delay (ms)** | 300 ms | How long to wait after releasing the pointer before the highlight is applied. A small delay prevents accidental highlights while you are still adjusting the selection. Set to 0 for immediate application. |
| **When selected text is already highlighted** | Remove highlight | Whether selecting highlighted text again removes the markers or expands highlighting over a larger selection |
| **Highlight color** | `#ffff00` | Color used to display `==highlighted==` text |
| **Show toggle button** | Off | Shows a clickable button with the current toggle status |
| **Toggle button location** | Status bar | Where the optional button appears: status bar, ribbon, or tab bar |

---

## Status bar

While the feature is active a small **🖊 Highlight: ON** indicator appears in the status bar so you always know the current state at a glance. You can also enable an optional clickable toggle button in the status bar, ribbon, or tab bar.

---

## How it works

1. The plugin registers a `pointerup` listener (covers mouse, touch, and stylus) on the document.
2. When the pointer is released a configurable timer starts.
3. After the timer fires the plugin reads the current selection from the active Markdown editor or, in Reading Mode, from the rendered document.
4. If the selection is non-empty, the plugin wraps it in `==…==` markers. Re-selecting highlighted text removes the markers by default.
5. Any leading / trailing whitespace in the selection is kept *outside* the markers so the Markdown structure stays valid.

The feature works in **Source Mode**, **Live Preview**, and **Reading Mode**. Reading Mode highlighting works best when the rendered selection can be matched exactly to the note source.

---

## Installation

### From the Obsidian community plugins browser (recommended)

> Once the plugin is listed in the community catalogue you can install it directly from *Settings → Community Plugins → Browse*.

### Manual installation

1. Download the latest release from the [Releases page](../../releases).
2. From the release assets download:
   - `main.js`
   - `manifest.json`
3. In your vault open the plugins folder: `<vault>/.obsidian/plugins/`
4. Create a subfolder named `obsidian-selection-highlighter`.
5. Copy the two downloaded files into that subfolder.
6. Reload Obsidian and enable the plugin in *Settings → Community Plugins*.

---

## Building from source

```bash
git clone https://github.com/jacksonsdean/obsidian-selection-highlighter.git
cd obsidian-selection-highlighter
npm install
npm run build   # produces main.js
```

For a live-rebuilding dev server:

```bash
npm run dev
```

---

## Contributing

Pull requests and issues are welcome! Please open an issue first to discuss larger changes.

---

## License

[MIT](LICENSE)
