# Chrome Web Store Listing Notes

Use this file as the prepared copy for the Chrome Developer Dashboard.

Chinese version: [STORE-LISTING-cn.md](STORE-LISTING-cn.md)

## Listing

Name:

```text
Chat Exporter
```

Short description:

```text
Export the current ChatGPT, Gemini, or Claude conversation to local JSON, Markdown, and image files.
```

Detailed description:

```text
Chat Exporter saves the currently open ChatGPT, Gemini, or Claude conversation as local files.

It creates a rich JSON export, a readable Markdown transcript, and local image asset files when the conversation contains images.

The extension is local-only: it does not call a remote service, does not use analytics, does not read the clipboard, and does not upload conversation content anywhere.

Supported pages:
- ChatGPT conversation pages under chatgpt.com/c/
- Gemini conversation pages under gemini.google.com/app/
- Claude conversation pages under claude.ai/chat/ and app.claude.ai/chat/
```

Category:

```text
Productivity
```

Language:

```text
English
```

## Privacy Practices

Single purpose:

```text
Export the current supported AI chat conversation page to local JSON, Markdown, and image asset files.
```

Remote code:

```text
No. The extension does not load or execute remote code.
```

Data collection:

```text
The extension handles conversation page content locally only after the user clicks Export. It does not transmit, collect, sell, or share user data.
```

Privacy policy URL:

```text
https://github.com/nextclaw/chat-exporter-extension/blob/main/PRIVACY.md
```

## Permission Justifications

`activeTab`:

```text
Used to identify and work with the active supported conversation tab after the user opens the extension popup.
```

`scripting`:

```text
Used to inject the packaged content script into an already-open supported conversation tab when Chrome has not injected it yet.
```

`downloads`:

```text
Used to save the generated JSON, Markdown, and image asset files locally.
```

Host permissions / content script matches:

```text
Limited to ChatGPT, Gemini, and Claude conversation pages so the extension can read the current conversation DOM for the export requested by the user.
```

## Test Instructions

```text
1. Open a supported conversation page:
   - https://chatgpt.com/c/<conversation_id>
   - https://gemini.google.com/app/<conversation_id>
   - https://claude.ai/chat/<conversation_id>
2. Open the Chat Exporter extension popup.
3. Click Export.
4. Confirm that JSON and Markdown files are downloaded locally, plus image asset files when the conversation contains images.

No test account is provided. Reviewers can use any account that can access a supported conversation page.
```

## Official References

- Publish: https://developer.chrome.com/docs/webstore/publish/
- Privacy fields: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/
- Program policies: https://developer.chrome.com/docs/webstore/program-policies/policies
