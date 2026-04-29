# Privacy Policy

Last updated: 2026-04-30

Chat Exporter is a local-only Chrome extension for exporting the currently open ChatGPT, Gemini, or Claude conversation to JSON and Markdown files.

## Single Purpose

The extension's single purpose is to export the current supported AI chat conversation page to local files selected by the user through the browser download flow.

## Data The Extension Handles

When the user clicks Export on a supported conversation page, the extension reads the page DOM for that current tab. This may include the conversation text and rendered message HTML visible in the browser.

The extension does not collect browsing history, account credentials, cookies, payment information, personal profile information, or analytics data.

## How Data Is Used

Conversation content is processed locally in the browser to create:

- a rich JSON export, and
- a Markdown transcript.

The generated files are saved locally using the Chrome Downloads API.

## Data Sharing

Chat Exporter does not transmit conversation content to the developer, third parties, analytics providers, or remote servers. It does not sell, rent, or share user data.

## Remote Code

The extension does not load or execute remotely hosted code. All runtime code is included in the packaged extension.

## Permissions

- `activeTab`: lets the extension identify and work with the active tab after the user opens the popup.
- `scripting`: lets the extension inject its packaged content script into an already-open supported conversation tab when Chrome has not injected it yet.
- `downloads`: saves the generated JSON and Markdown files locally.

Host access is limited to supported conversation providers: ChatGPT, Gemini, and Claude.

## Data Retention

The extension does not store exported conversation content internally. Exported files remain wherever the user saves them.

## Contact

For issues, use the project repository: `https://github.com/nextclaw/chat-exporter-extension`.
