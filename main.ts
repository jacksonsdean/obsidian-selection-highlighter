import {
	App,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";

interface SelectionHighlighterSettings {
	/** Whether selection-highlighting is currently active. */
	enabled: boolean;
	/** Milliseconds to wait after the pointer is released before applying the highlight. */
	delay: number;
}

const DEFAULT_SETTINGS: SelectionHighlighterSettings = {
	enabled: false,
	delay: 300,
};

export default class SelectionHighlighterPlugin extends Plugin {
	settings: SelectionHighlighterSettings;

	private highlightTimeout: ReturnType<typeof setTimeout> | null = null;
	/** Prevents the selection-change triggered by our own edit from re-firing. */
	private isApplying = false;
	private statusBarItem: HTMLElement;

	async onload() {
		await this.loadSettings();

		// ----- Status bar -----
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar();

		// ----- Commands -----
		this.addCommand({
			id: "enable-selection-highlighting",
			name: "Enable selection highlighting",
			callback: () => {
				this.setEnabled(true);
				new Notice("Selection highlighting enabled");
			},
		});

		this.addCommand({
			id: "disable-selection-highlighting",
			name: "Disable selection highlighting",
			callback: () => {
				this.setEnabled(false);
				new Notice("Selection highlighting disabled");
			},
		});

		this.addCommand({
			id: "toggle-selection-highlighting",
			name: "Toggle selection highlighting",
			callback: () => {
				this.setEnabled(!this.settings.enabled);
				new Notice(
					`Selection highlighting ${this.settings.enabled ? "enabled" : "disabled"}`
				);
			},
		});

		// ----- Pointer events (mouse, touch, and stylus) -----
		// pointerup covers all pointer devices in modern browsers.
		// We also add mouseup/touchend as fallbacks for older environments.
		this.registerDomEvent(document, "pointerup", () => this.scheduleHighlight());
		this.registerDomEvent(document, "mouseup", () => this.scheduleHighlight());
		this.registerDomEvent(document, "touchend", () => this.scheduleHighlight());

		// ----- Settings tab -----
		this.addSettingTab(new SelectionHighlighterSettingTab(this.app, this));
	}

	onunload() {
		this.cancelPending();
	}

	// -----------------------------------------------------------------------
	// Public helpers (used by the settings tab)
	// -----------------------------------------------------------------------

	updateStatusBar() {
		if (this.statusBarItem) {
			this.statusBarItem.setText(
				this.settings.enabled ? "🖊 Highlight: ON" : ""
			);
		}
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	private setEnabled(value: boolean) {
		this.settings.enabled = value;
		this.saveSettings();
		this.updateStatusBar();
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
	 * Wraps the current editor selection in `==…==` highlight markers.
	 *
	 * Edge-cases handled:
	 * - No active MarkdownView → skip.
	 * - Empty or whitespace-only selection → skip.
	 * - Selection already fully wrapped in `==…==` → skip (idempotent).
	 * - Leading / trailing whitespace in the selection is kept outside the
	 *   markers so the markdown structure stays valid.
	 */
	private applyHighlight() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const editor = view.editor;
		const selection = editor.getSelection();

		if (!selection || selection.trim() === "") return;

		// Check if the selection is already a complete highlight marker pair.
		const trimmed = selection.trim();
		if (trimmed.startsWith("==") && trimmed.endsWith("==") && trimmed.length > 4) {
			return;
		}

		// Compute whitespace padding that sits outside the markers.
		const leadLen = selection.length - selection.trimStart().length;
		const trailLen = selection.length - selection.trimEnd().length;
		const leading = selection.slice(0, leadLen);
		const trailing = trailLen > 0 ? selection.slice(-trailLen) : "";

		const highlighted = `${leading}==${trimmed}==${trailing}`;

		this.isApplying = true;
		try {
			editor.replaceSelection(highlighted);
		} finally {
			// Use a micro-task so that any synchronous editor events triggered
			// by replaceSelection are handled before we clear the guard flag.
			Promise.resolve().then(() => {
				this.isApplying = false;
			});
		}
	}

	// -----------------------------------------------------------------------
	// Settings persistence
	// -----------------------------------------------------------------------

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
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
				"When on, selection highlighting is active as soon as Obsidian loads."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enabled)
					.onChange(async (value) => {
						this.plugin.settings.enabled = value;
						await this.plugin.saveSettings();
						this.plugin.updateStatusBar();
					})
			);

		new Setting(containerEl)
			.setName("Highlight delay (ms)")
			.setDesc(
				"How long to wait after you release the pointer before the highlight is applied. " +
					"A small delay (200–500 ms) prevents accidental highlights while you are still " +
					"adjusting the selection. Set to 0 for immediate application."
			)
			.addSlider((slider) =>
				slider
					.setLimits(0, 2000, 50)
					.setValue(this.plugin.settings.delay)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.delay = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
