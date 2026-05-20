# Chat Exporter 开发上下文

最后更新：2026-05-21

## 项目定位

Chat Exporter 是 Chrome Manifest V3 插件，用于把当前打开的 ChatGPT、Gemini 或 Claude 对话导出为本地 JSON、Markdown 和资产文件。插件只读取当前受支持页面的 DOM，通过 Chrome Downloads API 保存文件；不使用 MCP，不调用远端服务，不读取剪贴板，不上传对话内容。

## 当前核心能力

- 文件命名：导出基础名保持 `service__title__conversation_id`，标题使用 Unicode-safe slug，service/id 使用 identifier-safe 清理。
- 输出文件：每次导出生成 rich JSON v2、Markdown transcript；图片和静态 URL 型附件保存到同名 `${baseName}_assets/` 目录。
- ChatGPT 长对话：ChatGPT 网页使用虚拟列表，不能只读取当前可见 DOM。当前实现优先遍历 `[data-testid^="conversation-turn-"]` 占位节点，逐个滚入视口采集已挂载消息，并在结束后恢复原滚动位置。
- ChatGPT media-only turn：图片生成结果可能只存在于 `.agent-turn` / `.group/imagegen-image`，不一定在 `.markdown` 正文中；需要单独识别并去重同一卡片里的重复图片 URL。
- Gemini / Claude：当前仍以当前页面 DOM 抽取为主，不做历史遍历，不点击用户上传附件预览，不做后台下载捕获。
- 导出流水线驻 service worker：popup 仅作 UI，点击 Export 后通过 `chrome.runtime.connect` 端口把请求交给 `src/background/index.ts`；SW 负责拉取 bundle、把文本文件编码成 base64 `data:` URL、调度 `chrome.downloads.download`，并用 `chrome.downloads.onChanged` 跟踪每个下载到 complete/interrupted。popup 中途关闭不会打断导出。

## 附件边界

- 自动下载范围仅限静态可见 URL：`a[download]`，或在 file/attachment/document/download 上下文里的 `.md/.pdf/.csv/.txt/.json/.docx/.xlsx/.zip` 等普通文件链接。
- 无 `href` 的上传文件卡片只渲染为 `[Attachment: name.ext]` 占位，不点击页面元素，不尝试打开 provider popup。
- 不支持 click-download、`chrome.downloads.onDeterminingFilename`、background capture 或 Claude Download button 捕获；这些能力如需实现，必须作为独立功能分支重新设计。

## 发布边界

- 当前准备发布版本：`0.1.3`。
- 版本号需要同步更新 `package.json`、`package-lock.json` 和 `public/manifest.json`。
- 发布前本地验证固定执行：

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run package
git diff --check
```

- GitHub Actions 的 `CI` workflow 会在 push、pull request 和手动触发时运行验证并上传 `release/chat-exporter-extension-v<version>.zip` artifact。

## 回归风险与验收口径

- 长 ChatGPT 对话验收重点看 JSON `scroll_debug.harvest_strategy` 是否为 `turn-anchor`，`visited_turn_count` 是否覆盖页面中的 turn placeholders，`missing_turn_indices` 是否为空或可解释。
- 文件名和 assets 目录不得回退为 provider UUID 平铺下载；所有插件生成的文本文件和 URL asset 都应使用 `${baseName}` 和 `${baseName}_assets/`。
- 禁止把 ChatGPT/Gemini/Claude 用户上传文件的无 href 卡片纳入默认自动点击下载流程。
