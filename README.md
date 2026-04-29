# chat-exporter-extension

Chrome Manifest V3 插件，用于把当前 ChatGPT / Gemini / Claude 对话导出为本地 JSON 和 Markdown 文件。

## v0.1 scope

- 支持当前对话页：
  - `https://chatgpt.com/c/<conversation_id>`
  - `https://gemini.google.com/app/<conversation_id>`
  - `https://claude.ai/chat/<conversation_id>`
- 导出 rich JSON v2 和 Markdown transcript。
- 完全本地处理，不依赖 MCP，不调用远端服务，不采集分析数据。

## Development

```bash
npm install
npm run typecheck
npm run lint
npm run test
npm run build
```

构建产物位于 `dist/`。在 Chrome 扩展管理页面开启 Developer mode 后，选择 `dist/` 作为 unpacked extension。
