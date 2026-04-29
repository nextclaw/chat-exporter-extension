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
Export the current ChatGPT, Gemini, or Claude conversation to local JSON and Markdown files.
```

详细描述：

```text
Chat Exporter saves the currently open ChatGPT, Gemini, or Claude conversation as local files.

It creates both a rich JSON export and a readable Markdown transcript, making it useful for personal archiving, notes, and local knowledge workflows.

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
Export the current supported AI chat conversation page to local JSON and Markdown files.
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
Used to save the generated JSON and Markdown export files locally.
```

Host permissions / content script matches：

```text
Limited to ChatGPT, Gemini, and Claude conversation pages so the extension can read the current conversation DOM for the export requested by the user.
```

## 测试说明

```text
1. Open a supported conversation page:
   - https://chatgpt.com/c/<conversation_id>
   - https://gemini.google.com/app/<conversation_id>
   - https://claude.ai/chat/<conversation_id>
2. Open the Chat Exporter extension popup.
3. Click Export.
4. Confirm that a JSON file and a Markdown file are downloaded locally.

No test account is provided. Reviewers can use any account that can access a supported conversation page.
```

## 官方参考

- Publish: https://developer.chrome.com/docs/webstore/publish/
- Privacy fields: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/
- Program policies: https://developer.chrome.com/docs/webstore/program-policies/policies
