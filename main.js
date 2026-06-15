const { Plugin, TFile } = require("obsidian");

const UPDATE_DELAY_MS = 250;
const RECENT_WRITE_WINDOW_MS = 1500;

module.exports = class ObsidianVaultHousekeepingPlugin extends Plugin {
  async onload() {
    this.pendingTimers = new Map();
    this.processing = new Set();
    this.recentWrites = new Map();

    this.registerEvent(this.app.vault.on("create", (file) => this.queueTimestampRefresh(file)));
    this.registerEvent(this.app.vault.on("modify", (file) => this.queueTimestampRefresh(file)));
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
      const original = await this.app.vault.cachedRead(file);
      const updated = upsertTimestampFrontmatter(original, todayIso());
      if (updated !== original) {
        this.markRecentlyWritten(file.path);
        await this.app.vault.modify(file, updated);
      }
    } finally {
      this.processing.delete(file.path);
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
      return hasValue(line) ? line : `created: ${isoDate}`;
    }
    if (/^updated\s*:/i.test(line)) {
      hasUpdated = true;
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

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
