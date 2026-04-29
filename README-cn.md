# Chat Exporter

Chat Exporter 是一个 Chrome Manifest V3 插件，用于把当前 ChatGPT、Gemini 或 Claude 对话导出为本地 JSON 和 Markdown 文件。

插件完全在浏览器本地运行，不依赖 MCP，不调用远端服务，不执行远程代码，也不采集分析数据。

English documentation: [README.md](README.md)

## 支持的页面

- ChatGPT: `https://chatgpt.com/c/<conversation_id>`
- Gemini: `https://gemini.google.com/app/<conversation_id>`
- Claude: `https://claude.ai/chat/<conversation_id>`
- Claude 旧版/app origin: `https://app.claude.ai/chat/<conversation_id>`

插件只导出当前打开的具体对话页，不浏览历史列表，也不会重新加载对话。

## 输出

每次导出会保存两个本地文件：

- rich JSON v2，兼容现有 `chat_export` 数据模型。
- Markdown transcript，包含 frontmatter 和按 turn 分组的角色标题。

消息来源包括 DOM HTML、DOM text、DOM Markdown、feature flags、selected source、quality score 和 candidate scores。剪贴板字段会保留为空，因为插件不会读取剪贴板，也不会点击网页里的复制按钮。

## 隐私

Chat Exporter 只会在用户点击 Export 后读取当前受支持对话页的可见 DOM。提取内容会在本地转换，并通过 Chrome Downloads API 保存。

对话内容不会发送给开发者、第三方或远端服务器。详见 [PRIVACY-cn.md](PRIVACY-cn.md)。

## 开发

```bash
npm install
npm run typecheck
npm run lint
npm run test
npm run build
```

构建产物位于 `dist/`。本地测试时打开 `chrome://extensions`，启用 Developer mode，选择 "Load unpacked"，并加载 `dist/`。

## Chrome Web Store 打包

```bash
npm run package
```

可上传的 ZIP 会生成到 `release/`。

GitHub Actions 会在 push、pull request 和手动触发时运行同样的检查，并把生成的 ZIP 作为 workflow artifact 上传。

Chrome Web Store 发布说明和商店文案见 [STORE-LISTING-cn.md](STORE-LISTING-cn.md)。
