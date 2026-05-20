# Changelog

All notable user-visible changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
loosely follows semantic versioning while we remain in the `0.1.x` line —
expect occasional opt-in default changes before `0.2.0`.

中文版本详情见 [`docs/release-and-publishing-cn.md`](docs/release-and-publishing-cn.md).

## [Unreleased]

## [0.1.5] - 2026-05-22

### Added
- Popup now shows the conversation title and turn count above the
  Export button so it is clear which chat is being exported. The turn
  count matches the `turns:` field in the exported file's frontmatter
  even when a turn has multiple assistant retry variants.
- Keyboard shortcut `Ctrl/Cmd+Shift+E` runs the export against the active
  tab without opening the popup.
- "Export this chat" appears in the right-click menu on supported pages.
- HTML output joined Markdown and JSON in the format picker. Open the
  generated `.html` in any browser, then Print → Save as PDF for a
  high-quality local PDF.

### Changed
- Failed asset downloads are now retried up to two more times with
  exponential backoff (500 ms, 1500 ms) before being marked as failed.
- Internal: the 1100+ line `src/content/chatgptExtractor.ts` was split
  into `src/content/extractors/{shared,chatgpt,gemini,claude,index}.ts`
  to make per-service maintenance easier. No user-visible behavior
  change.

## [0.1.4] - 2026-05-21

### Added
- Format picker in the popup with Markdown and JSON checkboxes. The
  selection is remembered in `chrome.storage.local`.

### Changed
- Default export now writes Markdown only. Tick JSON once to bring back
  the previous two-file output; the choice is remembered for next time.
- Asset files always download regardless of the picked text formats so
  Markdown links and the JSON manifest remain consistent.

## [0.1.3] - 2026-05-21

### Added
- Background service worker now owns the export pipeline; closing the
  popup mid-flight no longer aborts long ChatGPT exports.
- Export progress reaches the popup over a runtime port.

### Fixed
- `removeNoise` no longer drops `<button>` elements that wrap `<pre>` /
  `<code>` (ChatGPT/Claude expandable code under buttons stayed in the
  Markdown output).
- ChatGPT harvest in `turn-anchor` mode now samples only the
  freshly-scrolled-into-view turn, dropping the harvest cost from
  O(N²) to O(N) for long conversations.
- Gemini and Claude `compactRecords` gained an exact-match dedup map for
  another O(N²) → O(N) win on long sessions.
- Manifest gains 48/128 toolbar icon sizes; the deprecated
  `chat.openai.com` origin is removed; popup surfaces the real probe
  error instead of a generic message; build validator now catches
  dynamic `import()` and `import.meta` too.

## [0.1.2] - 2026-05-20

### Fixed
- Long ChatGPT conversations are now harvested by visiting
  `conversation-turn-*` anchors so virtualized message lists no longer
  drop older messages.

### Added
- Image assets and static URL attachments are saved alongside the
  Markdown / JSON output under `<baseName>_assets/`.

## [0.1.1] - 2026-05-20

Initial public release on the Chrome Web Store with Markdown + JSON
export of the currently open ChatGPT, Gemini, or Claude conversation.

[Unreleased]: https://github.com/nextclaw/chat-exporter-extension/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/nextclaw/chat-exporter-extension/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/nextclaw/chat-exporter-extension/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/nextclaw/chat-exporter-extension/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/nextclaw/chat-exporter-extension/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/nextclaw/chat-exporter-extension/releases/tag/v0.1.1
