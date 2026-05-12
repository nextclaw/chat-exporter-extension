# Chat Exporter

Chat Exporter is a Chrome Manifest V3 extension that exports the current ChatGPT, Gemini, or Claude conversation to local JSON, Markdown, and image asset files.

The extension runs entirely in the browser. It does not use MCP, does not call a remote service, does not run remote code, and does not collect analytics.

中文文档: [README-cn.md](README-cn.md)

## Supported Pages

- ChatGPT: `https://chatgpt.com/c/<conversation_id>`
- Gemini: `https://gemini.google.com/app/<conversation_id>`
- Claude: `https://claude.ai/chat/<conversation_id>`
- Claude legacy/app origin: `https://app.claude.ai/chat/<conversation_id>`

Only the currently open conversation page is exported. The extension does not browse history lists or reload the conversation.

## Output

Each export saves local files with a service-prefixed, Unicode-safe base name such as `chatgpt__如何阅读一本书__id`, `gemini__Gemini_图片测试__id`, or `claude__Research_Notes__id`:

- Rich JSON v2, compatible with the existing `chat_export` data model.
- Markdown transcript with frontmatter and turn-based role headings.
- Image assets, when present, under the matching `<baseName>_assets/` download subdirectory.

Message sources include DOM HTML, DOM text, DOM Markdown, feature flags, selected source, quality score, candidate scores, and an asset manifest with original image URLs and local paths. Clipboard fields are intentionally empty because the extension does not read the clipboard or click provider copy buttons.

When a conversation contains many images, the popup shows download progress. If all downloads are accepted by Chrome, the popup closes automatically to avoid accidental duplicate exports. If any image download fails, the popup stays open and offers an explicit "Export again" retry.

## Privacy

Chat Exporter reads the visible DOM of the active supported conversation page only after the user clicks Export. The extracted content is converted locally and saved through the Chrome Downloads API.

No conversation content is sent to the developer, third parties, or remote servers. See [PRIVACY.md](PRIVACY.md).

## Development

```bash
npm install
npm run typecheck
npm run lint
npm run test
npm run build
```

Build output is written to `dist/`. To test locally, open `chrome://extensions`, enable Developer mode, choose "Load unpacked", and select `dist/`.

## Package For Chrome Web Store

```bash
npm run package
```

The uploadable ZIP is written to `release/`.

GitHub Actions runs the same checks and uploads the generated ZIP as a workflow artifact on pushes, pull requests, and manual dispatches.

Chrome Web Store publishing notes and prepared listing copy are in [STORE-LISTING.md](STORE-LISTING.md).
