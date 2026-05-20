# Chrome Web Store 商店文案

这份文件用于填写 Chrome Developer Dashboard。

English version: [STORE-LISTING.md](STORE-LISTING.md)

## 商店信息

名称：

```text
Chat Exporter
```

短描述：

```text
Export the current ChatGPT, Gemini, or Claude conversation to local JSON, Markdown, and asset files.
```

详细描述：

```text
Chat Exporter saves the currently open ChatGPT, Gemini, or Claude conversation as local files.

It creates a rich JSON export, a readable Markdown transcript, and local asset files when the conversation contains images or static download links.

Long ChatGPT conversations are harvested turn by turn so virtualized web pages do not drop older messages.

The extension is local-only: it does not call a remote service, does not use analytics, does not read the clipboard, and does not upload conversation content anywhere.

Supported pages:
- ChatGPT conversation pages under chatgpt.com/c/
- Gemini conversation pages under gemini.google.com/app/
- Claude conversation pages under claude.ai/chat/ and app.claude.ai/chat/
```

分类：

```text
Productivity
```

语言：

```text
English
```

## 隐私表单

单一用途：

```text
Export the current supported AI chat conversation page to local JSON, Markdown, and asset files.
```

远程代码：

```text
No. The extension does not load or execute remote code.
```

数据收集：

```text
The extension handles conversation page content locally only after the user clicks Export. It does not transmit, collect, sell, or share user data.
```

隐私政策 URL：

```text
https://github.com/nextclaw/chat-exporter-extension/blob/main/PRIVACY.md
```

## 权限说明

`activeTab`：

```text
Used to identify and work with the active supported conversation tab after the user opens the extension popup.
```

`scripting`：

```text
Used to inject the packaged content script into an already-open supported conversation tab when Chrome has not injected it yet.
```

`downloads`：

```text
Used to save the generated JSON, Markdown, and asset files locally.
```

Host permissions / content script matches：

```text
Limited to ChatGPT, Gemini, and Claude conversation pages so the extension can read the current conversation DOM for the export requested by the user.
```

## Background service worker

```text
The extension registers a Manifest V3 background service worker (assets/background.js) that coordinates the export run after the user clicks Export. It receives the export request from the popup over a runtime port, drives the existing content script over chrome.tabs.sendMessage, encodes the generated text files as data: URLs, and schedules every download through chrome.downloads.download. Tracking each download via chrome.downloads.onChanged is what lets a long export keep running and complete normally even if the popup closes mid-flight. The service worker does not open network connections, does not load remote code, and does not register any persistent listeners that run when the popup is not open.
```

## 测试说明

```text
1. Open a supported conversation page:
   - https://chatgpt.com/c/<conversation_id>
   - https://gemini.google.com/app/<conversation_id>
   - https://claude.ai/chat/<conversation_id>
2. Open the Chat Exporter extension popup.
3. Click Export.
4. Confirm that JSON and Markdown files are downloaded locally, plus asset files when the conversation contains images or static download links.

No test account is provided. Reviewers can use any account that can access a supported conversation page.
```

## 官方参考

- Publish: https://developer.chrome.com/docs/webstore/publish/
- Privacy fields: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/
- Program policies: https://developer.chrome.com/docs/webstore/program-policies/policies
