# Changelog

## 0.2.0

- **Fix**: Preserve `{{...}}` (Core Templates, QuickAdd) and `<%...%>` (Templater) placeholders in both `created:` and `updated:` frontmatter fields. Previously, the plugin unconditionally rewrote `updated:` to today's date, clobbering `tp.date.now(...)` and similar dynamic-date syntax in templates.
- **New**: Settings tab with configurable `ignorePaths` (regex or substring, one per line) — defaults include the templates folder.
- **New**: Optional one-shot backfill that walks the vault on first load after an update and adds `created`/`updated` to markdown files missing them (skips ignored paths). Toggle in settings or trigger manually with the "Run backfill" button.
- **New**: Plugin now persists its installed version so the backfill only runs once per upgrade.

## 0.1.1

- Removed a `metadata-changed` listener that was causing unnecessary `updated` timestamp bumps when files were opened.

## 0.1.0

- Initial release.
