import {
  App,
  ColorComponent,
  Editor,
  EditorPosition,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TextComponent,
  setIcon,
} from "obsidian";

type RepeatedSelectionBehavior = "remove" | "expand";
type ToggleButtonLocation = "status-bar" | "ribbon" | "tab-bar";

interface SelectionHighlighterSettings {
  /** Whether selection-highlighting is currently active. */
  enabled: boolean;
  /** Milliseconds to wait after the pointer is released before applying the highlight. */
  delay: number;
  /** What to do when the selected text is already highlighted. */
  repeatedSelectionBehavior: RepeatedSelectionBehavior;
  /** Color used for rendered highlight markers. */
  highlightColor: string;
  /** Whether to show a clickable toggle button. */
  showToggleButton: boolean;
  /** Where the optional toggle button should appear. */
  toggleButtonLocation: ToggleButtonLocation;
}

const DEFAULT_SETTINGS: SelectionHighlighterSettings = {
  enabled: false,
  delay: 300,
  repeatedSelectionBehavior: "remove",
  highlightColor: "#ffff00",
  showToggleButton: false,
  toggleButtonLocation: "status-bar",
};

const HIGHLIGHT_ICON = "highlighter";
const DEFAULT_HIGHLIGHT_COLOR = "#ffff00";
const DUPLICATE_OPERATION_THRESHOLD_MS = 1000;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export default class SelectionHighlighterPlugin extends Plugin {
  settings: SelectionHighlighterSettings;

  private highlightTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Prevents the selection-change triggered by our own edit from re-firing. */
  private isApplying = false;
  private statusBarItem: HTMLElement | null = null;
  private ribbonButton: HTMLElement | null = null;
  private tabBarButton: HTMLButtonElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private lastAppliedKey = "";
  private lastAppliedAt = 0;

  async onload() {
    await this.loadSettings();

    // ----- Status / toggle UI -----
    this.statusBarItem = this.addStatusBarItem();
    this.updateHighlightStyles();
    this.updateToggleButton();

    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.updateToggleButton()),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () =>
        this.updateToggleButton(),
      ),
    );

    // ----- Commands -----
    this.addCommand({
      id: "enable-selection-highlighting",
      name: "Enable selection highlighting",
      icon: HIGHLIGHT_ICON,
      callback: () => {
        this.setEnabled(true);
        new Notice("Selection highlighting enabled");
      },
    });

    this.addCommand({
      id: "disable-selection-highlighting",
      name: "Disable selection highlighting",
      icon: "highlighter-off",
      callback: () => {
        this.setEnabled(false);
        new Notice("Selection highlighting disabled");
      },
    });

    this.addCommand({
      id: "toggle-selection-highlighting",
      name: "Toggle selection highlighting",
      icon: HIGHLIGHT_ICON,
      callback: () => {
        this.setEnabled(!this.settings.enabled);
        new Notice(
          `Selection highlighting ${this.settings.enabled ? "enabled" : "disabled"}`,
        );
      },
    });

    this.addCommand({
      id: "change-highlight-color",
      name: "Change highlight color",
      icon: "palette",
      callback: () => {
        new HighlightColorModal(this.app, this).open();
      },
    });

    // ----- Pointer events (mouse, touch, and stylus) -----
    // pointerup covers all pointer devices in modern browsers.
    // We also add mouseup/touchend as fallbacks for older environments.
    this.registerDomEvent(document, "pointerup", () =>
      this.scheduleHighlight(),
    );
    this.registerDomEvent(document, "mouseup", () => this.scheduleHighlight());
    this.registerDomEvent(document, "touchend", () => this.scheduleHighlight());

    // ----- Settings tab -----
    this.addSettingTab(new SelectionHighlighterSettingTab(this.app, this));
  }

  onunload() {
    this.cancelPending();
    this.removeRibbonButton();
    this.removeTabBarButton();
    this.styleEl?.remove();
  }

  // -----------------------------------------------------------------------
  // Public helpers (used by the settings tab / modal)
  // -----------------------------------------------------------------------

  async setEnabled(value: boolean) {
    this.settings.enabled = value;
    await this.saveSettings();
    this.updateToggleButton();
  }

  async setHighlightColor(value: string) {
    this.settings.highlightColor = this.sanitizeColor(value);
    await this.saveSettings();
    this.updateHighlightStyles();
  }

  updateToggleButton() {
    this.updateStatusBar();
    this.updateRibbonButton();
    this.updateTabBarButton();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private updateStatusBar() {
    if (!this.statusBarItem) return;

    this.statusBarItem.empty();
    this.statusBarItem.onclick = null;
    this.statusBarItem.removeClass("mod-clickable");

    const isStatusButton =
      this.settings.showToggleButton &&
      this.settings.toggleButtonLocation === "status-bar";

    if (isStatusButton) {
      this.statusBarItem.setText(this.getToggleLabel());
      this.statusBarItem.addClass("mod-clickable");
      this.statusBarItem.title = "Toggle selection highlighting";
      this.statusBarItem.onclick = () => {
        this.setEnabled(!this.settings.enabled);
      };
      return;
    }

    this.statusBarItem.title = "";
    this.statusBarItem.setText(this.settings.enabled ? "🖊 Highlight: ON" : "");
  }

  private updateRibbonButton() {
    const shouldShow =
      this.settings.showToggleButton &&
      this.settings.toggleButtonLocation === "ribbon";

    if (!shouldShow) {
      this.removeRibbonButton();
      return;
    }

    if (!this.ribbonButton) {
      this.ribbonButton = this.addRibbonIcon(
        HIGHLIGHT_ICON,
        "Toggle selection highlighting",
        () => this.setEnabled(!this.settings.enabled),
      );
    }

    this.ribbonButton.toggleClass("is-active", this.settings.enabled);
    this.ribbonButton.ariaLabel = this.getToggleLabel();
    this.ribbonButton.title = this.getToggleLabel();
  }

  private updateTabBarButton() {
    const shouldShow =
      this.settings.showToggleButton &&
      this.settings.toggleButtonLocation === "tab-bar";

    if (!shouldShow) {
      this.removeTabBarButton();
      return;
    }

    const tabBar = document.querySelector<HTMLElement>(
      ".workspace-tab-header-container",
    );
    if (!tabBar) return;

    if (!this.tabBarButton || this.tabBarButton.parentElement !== tabBar) {
      this.removeTabBarButton();
      this.tabBarButton = document.createElement("button");
      this.tabBarButton.type = "button";
      this.tabBarButton.addClasses([
        "clickable-icon",
        "selection-highlighter-toggle-button",
      ]);
      this.tabBarButton.onclick = () => this.setEnabled(!this.settings.enabled);
      tabBar.appendChild(this.tabBarButton);
    }

    this.tabBarButton.empty();
    setIcon(this.tabBarButton, HIGHLIGHT_ICON);
    this.tabBarButton.toggleClass("is-active", this.settings.enabled);
    this.tabBarButton.ariaLabel = this.getToggleLabel();
    this.tabBarButton.title = this.getToggleLabel();
  }

  private removeRibbonButton() {
    this.ribbonButton?.remove();
    this.ribbonButton = null;
  }

  private removeTabBarButton() {
    this.tabBarButton?.remove();
    this.tabBarButton = null;
  }

  private getToggleLabel() {
    return `Selection highlighting: ${this.settings.enabled ? "ON" : "OFF"}`;
  }

  private cancelPending() {
    if (this.highlightTimeout !== null) {
      clearTimeout(this.highlightTimeout);
      this.highlightTimeout = null;
    }
  }

  /**
   * Called on every pointer-release event. Schedules (or immediately applies)
   * the highlight, debounced by `settings.delay` ms so that rapid pointer
   * events from the same gesture collapse into a single operation.
   */
  private scheduleHighlight() {
    if (!this.settings.enabled || this.isApplying) return;

    this.cancelPending();

    if (this.settings.delay === 0) {
      this.applyHighlight();
    } else {
      this.highlightTimeout = setTimeout(() => {
        this.highlightTimeout = null;
        this.applyHighlight();
      }, this.settings.delay);
    }
  }

  /**
   * Wraps the current editor or reading-mode selection in `==…==` highlight markers.
   * Re-selecting highlighted text removes the markers by default, or expands the
   * markers over a larger selection when configured to do so.
   */
  private applyHighlight() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    const editorSelection = this.getEditorSelection(view.editor);
    if (editorSelection) {
      this.applyEditorHighlight(view, editorSelection);
      return;
    }

    this.applyReadingModeHighlight(view);
  }

  private getEditorSelection(editor: Editor) {
    const selection = editor.listSelections()[0];
    if (!selection) return null;

    const anchorOffset = editor.posToOffset(selection.anchor);
    const headOffset = editor.posToOffset(selection.head);
    const fromOffset = Math.min(anchorOffset, headOffset);
    const toOffset = Math.max(anchorOffset, headOffset);
    if (fromOffset === toOffset) return null;

    const from = editor.offsetToPos(fromOffset);
    const to = editor.offsetToPos(toOffset);
    const text = editor.getRange(from, to);
    if (!text || text.trim() === "") return null;

    return { from, to, fromOffset, toOffset, text };
  }

  private applyEditorHighlight(
    view: MarkdownView,
    selection: {
      from: EditorPosition;
      to: EditorPosition;
      fromOffset: number;
      toOffset: number;
      text: string;
    },
  ) {
    const editor = view.editor;
    const value = editor.getValue();
    const edit = this.getHighlightEdit(
      value,
      selection.fromOffset,
      selection.toOffset,
      selection.text,
    );
    if (!edit) return;

    const key = `${view.file?.path ?? ""}:${edit.fromOffset}:${edit.toOffset}:${edit.replacement}`;
    if (
      key === this.lastAppliedKey &&
      Date.now() - this.lastAppliedAt < DUPLICATE_OPERATION_THRESHOLD_MS
    ) {
      return;
    }

    this.isApplying = true;
    try {
      const from = editor.offsetToPos(edit.fromOffset);
      const to = editor.offsetToPos(edit.toOffset);
      editor.replaceRange(edit.replacement, from, to, "selection-highlighter");
      editor.setCursor(
        editor.offsetToPos(edit.fromOffset + edit.replacement.length),
      );
      this.lastAppliedKey = key;
      this.lastAppliedAt = Date.now();
    } finally {
      Promise.resolve().then(() => {
        this.isApplying = false;
      });
    }
  }

  private async applyReadingModeHighlight(view: MarkdownView) {
    const file = view.file;
    if (!(file instanceof TFile)) return;

    const readingSelection = this.getReadingModeSelection(view);
    if (!readingSelection) return;

    this.isApplying = true;
    try {
      await this.app.vault.process(file, (data) => {
        const match = this.getReadingModeEdit(
          data,
          readingSelection.text,
          readingSelection.selectedHighlight,
          readingSelection.occurrenceIndex,
        );
        if (!match) return data;
        return (
          data.slice(0, match.fromOffset) +
          match.replacement +
          data.slice(match.toOffset)
        );
      });
      window.getSelection()?.removeAllRanges();
    } finally {
      this.isApplying = false;
    }
  }

  private getReadingModeSelection(view: MarkdownView) {
    const selection = window.getSelection();
    if (
      !selection ||
      selection.rangeCount === 0 ||
      selection.toString().trim() === ""
    ) {
      return null;
    }

    const container = view.previewMode?.containerEl;
    if (!container) return null;

    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const element = node instanceof HTMLElement ? node : node.parentElement;
    if (!container.contains(element)) return null;

    const prefixRange = range.cloneRange();
    prefixRange.selectNodeContents(container);
    prefixRange.setEnd(range.startContainer, range.startOffset);

    return {
      text: selection.toString(),
      selectedHighlight: !!element?.closest("mark"),
      occurrenceIndex: this.countOccurrences(
        prefixRange.toString(),
        selection.toString().trim(),
      ),
    };
  }

  private getHighlightEdit(
    value: string,
    fromOffset: number,
    toOffset: number,
    selectedText: string,
  ) {
    const before = value.slice(fromOffset - 2, fromOffset);
    const after = value.slice(toOffset, toOffset + 2);
    const trimmed = selectedText.trim();

    if (this.isMarked(trimmed)) {
      const unwrapped = this.unwrapSelectedText(selectedText);
      if (this.settings.repeatedSelectionBehavior === "remove") {
        return { fromOffset, toOffset, replacement: unwrapped };
      }
      return {
        fromOffset,
        toOffset,
        replacement: this.wrapSelectedText(unwrapped),
      };
    }

    if (before === "==" && after === "==") {
      if (this.settings.repeatedSelectionBehavior === "remove") {
        return {
          fromOffset: fromOffset - 2,
          toOffset: toOffset + 2,
          replacement: selectedText,
        };
      }
      return null;
    }

    return {
      fromOffset,
      toOffset,
      replacement: this.wrapSelectedText(selectedText),
    };
  }

  private getReadingModeEdit(
    value: string,
    selectedText: string,
    selectedHighlight: boolean,
    occurrenceIndex: number,
  ) {
    const text = selectedText.trim();
    const highlightedText = `==${text}==`;
    const highlightedIndex = this.findNthOccurrence(
      value,
      highlightedText,
      occurrenceIndex,
    );

    if (highlightedIndex !== -1 && selectedHighlight) {
      if (this.settings.repeatedSelectionBehavior === "expand") {
        return null;
      }

      return {
        fromOffset: highlightedIndex,
        toOffset: highlightedIndex + highlightedText.length,
        replacement: text,
      };
    }

    const exactIndex = this.findNthUnmarkedOccurrence(
      value,
      selectedText,
      occurrenceIndex,
    );
    if (exactIndex !== -1) {
      return {
        fromOffset: exactIndex,
        toOffset: exactIndex + selectedText.length,
        replacement: this.wrapSelectedText(selectedText),
      };
    }

    const trimmedIndex = this.findNthUnmarkedOccurrence(
      value,
      text,
      occurrenceIndex,
    );
    if (trimmedIndex !== -1) {
      return {
        fromOffset: trimmedIndex,
        toOffset: trimmedIndex + text.length,
        replacement: `==${text}==`,
      };
    }

    new Notice("Could not find the reading-mode selection in the source note.");
    return null;
  }

  private countOccurrences(value: string, needle: string) {
    if (needle === "") return 0;

    let count = 0;
    let fromIndex = 0;
    while (fromIndex < value.length) {
      const index = value.indexOf(needle, fromIndex);
      if (index === -1) break;

      count++;
      fromIndex = index + needle.length;
    }

    return count;
  }

  private findNthOccurrence(
    value: string,
    needle: string,
    occurrenceIndex: number,
  ) {
    if (needle === "") return -1;

    let seen = 0;
    let fromIndex = 0;
    while (fromIndex < value.length) {
      const index = value.indexOf(needle, fromIndex);
      if (index === -1) return -1;
      if (seen === occurrenceIndex) return index;

      seen++;
      fromIndex = index + needle.length;
    }

    return -1;
  }

  private findNthUnmarkedOccurrence(
    value: string,
    needle: string,
    occurrenceIndex: number,
  ) {
    if (needle === "") return -1;

    let seen = 0;
    let fromIndex = 0;
    while (fromIndex < value.length) {
      const index = value.indexOf(needle, fromIndex);
      if (index === -1) return -1;

      const isMarked =
        value.slice(index - 2, index) === "==" &&
        value.slice(index + needle.length, index + needle.length + 2) === "==";
      if (!isMarked) {
        if (seen === occurrenceIndex) return index;
        seen++;
      }

      fromIndex = index + needle.length;
    }

    return -1;
  }

  private wrapSelectedText(selection: string) {
    const leadLen = selection.length - selection.trimStart().length;
    const trailLen = selection.length - selection.trimEnd().length;
    const leading = selection.slice(0, leadLen);
    const trailing = trailLen > 0 ? selection.slice(-trailLen) : "";
    const trimmed = selection.trim().split("==").join("");

    return `${leading}==${trimmed}==${trailing}`;
  }

  private unwrapSelectedText(selection: string) {
    const leadLen = selection.length - selection.trimStart().length;
    const trailLen = selection.length - selection.trimEnd().length;
    const leading = selection.slice(0, leadLen);
    const trailing = trailLen > 0 ? selection.slice(-trailLen) : "";
    const trimmed = selection.trim();

    return `${leading}${trimmed.slice(2, -2)}${trailing}`;
  }

  private isMarked(text: string) {
    return text.startsWith("==") && text.endsWith("==") && text.length > 4;
  }

  private updateHighlightStyles() {
    if (!this.styleEl) {
      this.styleEl = document.createElement("style");
      document.head.appendChild(this.styleEl);
    }

    const color = this.sanitizeColor(this.settings.highlightColor);
    this.styleEl.textContent = `
body .markdown-rendered mark,
body .markdown-preview-view mark,
body .cm-highlight {
background-color: ${color};
color: inherit;
}
`;
  }

  private sanitizeColor(value: string) {
    return HEX_COLOR_PATTERN.test(value) ? value : DEFAULT_HIGHLIGHT_COLOR;
  }

  // -----------------------------------------------------------------------
  // Settings persistence
  // -----------------------------------------------------------------------

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.highlightColor = this.sanitizeColor(
      this.settings.highlightColor,
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// ---------------------------------------------------------------------------
// Color modal
// ---------------------------------------------------------------------------

class HighlightColorModal extends Modal {
  private plugin: SelectionHighlighterPlugin;

  constructor(app: App, plugin: SelectionHighlighterPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl)
      .setName("Highlight color")
      .setDesc("Choose the color used to display ==highlighted== text.")
      .addColorPicker((color: ColorComponent) =>
        color
          .setValue(this.plugin.settings.highlightColor)
          .onChange((value) => this.plugin.setHighlightColor(value)),
      )
      .addText((text: TextComponent) =>
        text
          .setPlaceholder(DEFAULT_HIGHLIGHT_COLOR)
          .setValue(this.plugin.settings.highlightColor)
          .onChange((value) => this.plugin.setHighlightColor(value)),
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

class SelectionHighlighterSettingTab extends PluginSettingTab {
  plugin: SelectionHighlighterPlugin;

  constructor(app: App, plugin: SelectionHighlighterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Selection Highlighter" });

    new Setting(containerEl)
      .setName("Enable on startup")
      .setDesc(
        "When on, selection highlighting is active as soon as Obsidian loads.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enabled)
          .onChange(async (value) => {
            await this.plugin.setEnabled(value);
          }),
      );

    new Setting(containerEl)
      .setName("Highlight delay (ms)")
      .setDesc(
        "How long to wait after you release the pointer before the highlight is applied. " +
          "A small delay (200–500 ms) prevents accidental highlights while you are still " +
          "adjusting the selection. Set to 0 for immediate application.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(0, 2000, 50)
          .setValue(this.plugin.settings.delay)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.delay = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("When selected text is already highlighted")
      .setDesc(
        "Remove matching highlight markers by default, or expand markers over a larger selection.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            remove: "Remove highlight",
            expand: "Expand highlight",
          })
          .setValue(this.plugin.settings.repeatedSelectionBehavior)
          .onChange(async (value: RepeatedSelectionBehavior) => {
            this.plugin.settings.repeatedSelectionBehavior = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Highlight color")
      .setDesc("Color used to display ==highlighted== text.")
      .addColorPicker((color) =>
        color
          .setValue(this.plugin.settings.highlightColor)
          .onChange((value) => this.plugin.setHighlightColor(value)),
      )
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_HIGHLIGHT_COLOR)
          .setValue(this.plugin.settings.highlightColor)
          .onChange((value) => this.plugin.setHighlightColor(value)),
      );

    new Setting(containerEl)
      .setName("Show toggle button")
      .setDesc(
        "Show a clickable button that displays the current selection-highlighter state.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showToggleButton)
          .onChange(async (value) => {
            this.plugin.settings.showToggleButton = value;
            await this.plugin.saveSettings();
            this.plugin.updateToggleButton();
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName("Toggle button location")
      .setDesc("Choose where the optional toggle button appears.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            "status-bar": "Status bar",
            ribbon: "Ribbon",
            "tab-bar": "Tab bar",
          })
          .setValue(this.plugin.settings.toggleButtonLocation)
          .onChange(async (value: ToggleButtonLocation) => {
            this.plugin.settings.toggleButtonLocation = value;
            await this.plugin.saveSettings();
            this.plugin.updateToggleButton();
          }),
      );
  }
}
