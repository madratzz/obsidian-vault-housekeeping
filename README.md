# Obsidian Vault Housekeeping

BRAT-ready release package for the `obsidian-vault-housekeeping` Obsidian plugin.

## Features

- Ensures markdown notes have `created` and `updated` frontmatter properties.
- Refreshes `updated` when a note is edited.
- Adds frontmatter if it is missing.
- **Preserves Templater (`<% tp.date.now(...) %>`) and Core Templates / QuickAdd (`{{date}}`) placeholders** in template files so dynamic dates still resolve on new-note creation.
- Configurable ignore paths (defaults to the templates folder).
- Optional one-shot backfill on first load after an upgrade.

## Settings

Open Settings → Community Plugins → Obsidian Vault Housekeeping.

- **Ignore paths** — one regex or substring per line. Files matching any pattern are skipped. Defaults to `99 - Meta/Templates`.
- **Backfill on load** — when enabled, walks the vault once per version upgrade and adds `created`/`updated` to markdown files missing them (skips ignored paths).
- **Run backfill now** — manual button to trigger a backfill on demand.

## BRAT Publishing

Use this folder as the root of a dedicated GitHub repository for this plugin.

Release assets should include:

- `manifest.json`
- `main.js`

`versions.json` should stay in the repository root for version mapping.

## License

MIT — see [LICENSE](LICENSE).
