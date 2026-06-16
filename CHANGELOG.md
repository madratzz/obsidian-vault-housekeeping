# Changelog

## 0.3.1

- **Fix**: The v0.3.1 startup freeze now guards **both** `create` and `editor-change` listeners. v0.3.0's switch to `editor-change` caused `updated:` to bump on every file open in an editor at startup (initial content load fires the event). The initial v0.3.1 fix only guarded `editor-change`, but `vault.on('create')` also fires for every file when Obsidian's metadata cache is rebuilt. Now neither listener fires during the 2-second settle window after layout-ready. (Commit b338278)

## 0.3.0

- **Fix**: Stop bumping `updated:` on file-system `modify` events. The v0.2.0 plugin still listened to `vault.on("modify", ...)`, which fires whenever *any* process writes to a file — including sync tools like OneDrive, Obsidian Sync, and `obsidian-git` auto-commit. On Windows especially, this caused `updated:` to be bumped on every file at Obsidian startup.
- **Change**: Now listens to `workspace.on("editor-change", ...)` instead. This fires only when text in the editor changes (user typing, Templater insertion, linter edits) — not on raw file-system writes. The net effect: `updated:` only changes when you actually edit a note.
- **New setting**: "Bump on external file changes" (default OFF). When ON, also listens to raw `modify` events (reverts to the v0.2.0 behavior). Requires a plugin reload to take effect.
- **Change**: Write path now uses `vault.process(file, fn)` instead of `vault.modify(file, content)`. The `process` API acquires an editor lock and re-injects the updated content into any open editor, so a note that's currently open stays in sync. Avoids stale-display issues that the older `modify` API could cause.
- **Internal**: `created:` and `updated:` are still preserved when set to Templater (`<% tp.date.now(...) %>`) or Core Templates / QuickAdd (`{{date}}`) placeholders. Templates remain untouched by default (controlled by `ignorePaths`).

## 0.2.0

- **Fix**: Preserve `{{...}}` (Core Templates, QuickAdd) and `<%...%>` (Templater) placeholders in both `created:` and `updated:` frontmatter fields. Previously, the plugin unconditionally rewrote `updated:` to today's date, clobbering `tp.date.now(...)` and similar dynamic-date syntax in templates.
- **New**: Settings tab with configurable `ignorePaths` (regex or substring, one per line) — defaults include the templates folder.
- **New**: Optional one-shot backfill that walks the vault on first load after an update and adds `created`/`updated` to markdown files missing them (skips ignored paths). Toggle in settings or trigger manually with the "Run backfill" button.
- **New**: Plugin now persists its installed version so the backfill only runs once per upgrade.

## 0.1.1

- Removed a `metadata-changed` listener that was causing unnecessary `updated` timestamp bumps when files were opened.

## 0.1.0

- Initial release.
