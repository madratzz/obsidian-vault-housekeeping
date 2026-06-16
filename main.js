const { Plugin, PluginSettingTab, Setting, TFile } = require("obsidian");

const UPDATE_DELAY_MS = 250;
const RECENT_WRITE_WINDOW_MS = 1500;
const PLACEHOLDER_RE = /\{\{[^}]*\}\}|<%[\s\S]*?%>/;
const DEFAULT_SETTINGS = {
  ignorePaths: ["99 - Meta/Templates", "99 - Meta/Templates/"],
  backfillOnLoad: false,
  templateFolderHint: "99 - Meta/Templates",
  bumpOnExternalChanges: false,
};

module.exports = class ObsidianVaultHousekeepingPlugin extends Plugin {
  async onload() {
    this.pendingTimers = new Map();
    this.processing = new Set();
    this.recentWrites = new Map();

    await this.loadSettings();
    this.registerEvent(this.app.vault.on("create", (file) => this.queueTimestampRefresh(file)));

    // Listen to editor changes (real user edits), not file-system modify
    // events. The latter fire for sync tools (OneDrive, Obsidian Sync,
    // git auto-commit, etc.) on Obsidian open, which would bump updated:
    // on every file at startup.
    //
    // IMPORTANT: editor-change fires when an editor is first loaded with
    // content (i.e., every open tab on startup). We must ignore those
    // initial-load events by waiting for layout-ready + a settle delay.
    this.startedAt = Date.now();
    this.layoutSettled = false;
    this.app.workspace.onLayoutReady(() => {
      window.setTimeout(() => { this.layoutSettled = true; }, 2000);
    });
    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor, ctx) => {
        if (!this.layoutSettled) return;
        const file = ctx && ctx.file;
        if (file) this.queueTimestampRefresh(file);
      })
    );
    if (this.settings.bumpOnExternalChanges) {
      // Opt-in: also bump on raw file-system modify events.
      this.registerEvent(this.app.vault.on("modify", (file) => this.queueTimestampRefresh(file)));
    }

    this.addSettingTab(new HousekeepingSettingTab(this.app, this));

    const installedVersion = (await this.loadData())?.installedVersion;
    if (this.settings.backfillOnLoad && installedVersion !== this.manifest.version) {
      // Defer so it doesn't block plugin load.
      window.setTimeout(() => this.runBackfill().catch(() => {}), 1500);
    }
    this.persistInstalledVersion();
  }

  async loadSettings() {
    const stored = (await this.loadData()) || {};
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    merged.ignorePaths = Array.isArray(stored.ignorePaths)
      ? stored.ignorePaths
      : DEFAULT_SETTINGS.ignorePaths.slice();
    this.settings = merged;
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async persistInstalledVersion() {
    const stored = (await this.loadData()) || {};
    stored.installedVersion = this.manifest.version;
    stored.ignorePaths = this.settings.ignorePaths;
    stored.backfillOnLoad = this.settings.backfillOnLoad;
    stored.templateFolderHint = this.settings.templateFolderHint;
    stored.bumpOnExternalChanges = this.settings.bumpOnExternalChanges;
    await this.saveData(stored);
  }

  isIgnored(file) {
    if (!file || !file.path) return true;
    const path = file.path;
    return this.settings.ignorePaths.some((pattern) => {
      if (!pattern) return false;
      try {
        return new RegExp(pattern).test(path);
      } catch {
        return path.includes(pattern);
      }
    });
  }

  onunload() {
    for (const timer of this.pendingTimers.values()) {
      window.clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.processing.clear();
    this.recentWrites.clear();
  }

  queueTimestampRefresh(file) {
    if (!isMarkdownFile(file)) return;
    if (this.isIgnored(file)) return;

    const existingTimer = this.pendingTimers.get(file.path);
    if (existingTimer) window.clearTimeout(existingTimer);

    const timer = window.setTimeout(() => {
      this.pendingTimers.delete(file.path);
      this.ensureTimestamps(file).catch(() => {});
    }, UPDATE_DELAY_MS);

    this.pendingTimers.set(file.path, timer);
  }

  async ensureTimestamps(file) {
    if (!isMarkdownFile(file) || this.processing.has(file.path) || this.wasRecentlyWritten(file.path)) return;

    this.processing.add(file.path);
    try {
      let didChange = false;
      // Use vault.process so the editor (if open) stays in sync with the
      // updated frontmatter. The callback is atomic: read, transform, write.
      await this.app.vault.process(file, (content) => {
        const updated = upsertTimestampFrontmatter(content, todayIso());
        if (updated !== content) {
          didChange = true;
          return updated;
        }
        return content;
      });
      if (didChange) {
        this.markRecentlyWritten(file.path);
      }
    } finally {
      this.processing.delete(file.path);
    }
  }

  async runBackfill() {
    const files = this.app.vault.getMarkdownFiles().filter((f) => !this.isIgnored(f));
    for (const file of files) {
      try {
        const content = await this.app.vault.cachedRead(file);
        if (!needsBackfill(content)) continue;
        const updated = upsertTimestampFrontmatter(content, todayIso());
        if (updated !== content) {
          await this.app.vault.modify(file, updated);
        }
      } catch {
        // Skip unreadable files.
      }
    }
  }

  wasRecentlyWritten(path) {
    const writtenAt = this.recentWrites.get(path);
    if (!writtenAt) return false;
    if (Date.now() - writtenAt > RECENT_WRITE_WINDOW_MS) {
      this.recentWrites.delete(path);
      return false;
    }
    return true;
  }

  markRecentlyWritten(path) {
    this.recentWrites.set(path, Date.now());
  }
};

function isMarkdownFile(file) {
  return file instanceof TFile && file.extension === "md";
}

function upsertTimestampFrontmatter(content, isoDate) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!frontmatterMatch) {
    if (!String(content || "").length) {
      return `---${newline}created: ${isoDate}${newline}updated: ${isoDate}${newline}---${newline}`;
    }
    return `---${newline}created: ${isoDate}${newline}updated: ${isoDate}${newline}---${newline}${newline}${content}`;
  }

  const frontmatterBody = frontmatterMatch[1];
  const frontmatterLines = frontmatterBody.length ? frontmatterBody.split(/\r?\n/) : [];
  let hasCreated = false;
  let hasUpdated = false;

  const nextLines = frontmatterLines.map((line) => {
    if (/^created\s*:/i.test(line)) {
      hasCreated = true;
      // Preserve placeholders (Templater / Core Templates / QuickAdd).
      if (PLACEHOLDER_RE.test(line)) return line;
      return hasValue(line) ? line : `created: ${isoDate}`;
    }
    if (/^updated\s*:/i.test(line)) {
      hasUpdated = true;
      // Preserve placeholders (Templater / Core Templates / QuickAdd).
      if (PLACEHOLDER_RE.test(line)) return line;
      // Bump real values to today.
      return `updated: ${isoDate}`;
    }
    return line;
  });

  if (!hasCreated) nextLines.push(`created: ${isoDate}`);
  if (!hasUpdated) nextLines.push(`updated: ${isoDate}`);

  const rebuiltFrontmatter = `---${newline}${nextLines.join(newline)}${newline}---`;
  const rest = content.slice(frontmatterMatch[0].length);
  const separator = rest && !rest.startsWith("\n") && !rest.startsWith("\r\n") ? newline : "";
  return `${rebuiltFrontmatter}${separator}${rest}`;
}

function hasValue(line) {
  return String(line).split(":").slice(1).join(":").trim() !== "";
}

function needsBackfill(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return true;
  const body = match[1];
  return !/^created\s*:/im.test(body) || !/^updated\s*:/im.test(body);
}

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

class HousekeepingSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Vault Housekeeping" });

    new Setting(containerEl)
      .setName("Ignore paths")
      .setDesc("One regex or substring per line. Matching files are skipped. Defaults include the templates folder.")
      .addTextArea((text) => {
        text
          .setValue(this.plugin.settings.ignorePaths.join("\n"))
          .setPlaceholder("99 - Meta/Templates\n^.*/Templates/")
          .onChange(async (value) => {
            this.plugin.settings.ignorePaths = value
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.style.width = "100%";
      });

    new Setting(containerEl)
      .setName("Backfill on load")
      .setDesc("When enabled, walks the vault on first load after an update and adds created/updated to any markdown file missing them (skips ignored paths).")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.backfillOnLoad)
          .onChange(async (value) => {
            this.plugin.settings.backfillOnLoad = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Bump on external file changes")
      .setDesc("OFF (recommended): only bump `updated:` when you actually edit a note. ON: also bump when sync tools (OneDrive, Obsidian Sync, git auto-commit) write to files — useful if you want every disk-side change to count as an edit. Requires plugin reload to take effect.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.bumpOnExternalChanges)
          .onChange(async (value) => {
            this.plugin.settings.bumpOnExternalChanges = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Run backfill now")
      .setDesc("Manually trigger a one-shot backfill of files missing created/updated.")
      .addButton((button) =>
        button
          .setButtonText("Run backfill")
          .setWarning()
          .onClick(async () => {
            button.setDisabled(true);
            button.setButtonText("Running...");
            await this.plugin.runBackfill();
            button.setDisabled(false);
            button.setButtonText("Done");
            window.setTimeout(() => button.setButtonText("Run backfill"), 1500);
          })
      );
  }
}
