import { sanitizeHtmlFragment } from "./markdown";
import { SITE_LABELS, type ChatMessage, type ConversationExport } from "./types";

const STYLE = `:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  line-height: 1.6;
  max-width: 760px;
  margin: 2rem auto;
  padding: 0 1.25rem;
  color: #15181e;
  background: #fff;
}
header { border-bottom: 1px solid #e2e6ec; margin-bottom: 1.5rem; padding-bottom: 1rem; }
h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
.meta { color: #5b6472; font-size: 0.85rem; margin: 0; word-break: break-all; }
.meta a { color: inherit; }
.turn { border-top: 1px dashed #d6dae1; margin-top: 1.5rem; padding-top: 1rem; }
.turn:first-of-type { border-top: 0; margin-top: 0; padding-top: 0; }
.turn-label { color: #5b6472; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.message { margin: 0.75rem 0; }
.message .role { color: #5b6472; font-size: 0.85rem; font-weight: 600; margin: 0 0 0.35rem; }
.message.user .role::before { content: "🧑 "; }
.message.assistant .role::before { content: "🤖 "; }
.message.user .body {
  background: #f1f6ff;
  border-left: 3px solid #1f6feb;
  border-radius: 6px;
  padding: 0.65rem 0.9rem;
}
.message .body pre {
  background: #0d1117;
  color: #f0f6fc;
  border-radius: 6px;
  overflow-x: auto;
  padding: 0.75rem 1rem;
}
.message .body code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; }
.message .body img { max-width: 100%; height: auto; border-radius: 6px; }
.message .body table { border-collapse: collapse; }
.message .body table th, .message .body table td { border: 1px solid #d6dae1; padding: 0.25rem 0.5rem; }
.message .body blockquote { border-left: 3px solid #d6dae1; color: #5b6472; margin: 0.5rem 0; padding: 0 0.75rem; }
footer { color: #5b6472; font-size: 0.8rem; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e2e6ec; }
@media (prefers-color-scheme: dark) {
  body { background: #15181e; color: #f7f8fb; }
  header, footer { border-color: #353b46; }
  .turn { border-color: #353b46; }
  .meta, .turn-label, .message .role, footer { color: #b8c0cc; }
  .message.user .body { background: #1f2933; border-left-color: #1f6feb; }
  .message .body blockquote { border-color: #353b46; color: #b8c0cc; }
}
@media print {
  body { margin: 0; padding: 1rem; max-width: none; }
  .turn { break-inside: avoid; }
  .message { break-inside: avoid; }
  @page { margin: 18mm; }
}`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMessageBody(message: ChatMessage): string {
  const cleaned = sanitizeHtmlFragment(message.dom_html);
  if (cleaned) {
    return cleaned;
  }
  const text = message.final_markdown || message.dom_text;
  if (!text) {
    return "";
  }
  return `<p>${escapeHtml(text).replace(/\n+/g, "<br />")}</p>`;
}

export function renderConversationHtml(conversation: ConversationExport): string {
  const siteLabel = SITE_LABELS[conversation.service] ?? "Chat";
  const title = conversation.title.trim() || `${siteLabel} Conversation`;

  const sections: string[] = [];
  let turnIndex = 0;
  let currentTurnOpen = false;
  let turnParts: string[] = [];

  const flushTurn = (): void => {
    if (!currentTurnOpen || !turnParts.length) {
      return;
    }
    sections.push(
      `<section class="turn">\n` +
        `  <p class="turn-label">Turn ${turnIndex}</p>\n` +
        turnParts.join("\n") +
        `\n</section>`,
    );
    turnParts = [];
    currentTurnOpen = false;
  };

  for (const message of conversation.messages) {
    const body = renderMessageBody(message);
    if (!body || (message.role !== "user" && message.role !== "assistant")) {
      continue;
    }
    if (message.role === "user" || !currentTurnOpen) {
      flushTurn();
      turnIndex += 1;
      currentTurnOpen = true;
    }
    const roleName = message.role === "user" ? "You" : siteLabel;
    turnParts.push(
      `  <article class="message ${message.role}">\n` +
        `    <p class="role">${escapeHtml(roleName)}</p>\n` +
        `    <div class="body">${body}</div>\n` +
        `  </article>`,
    );
  }
  flushTurn();

  const metaParts: string[] = [];
  metaParts.push(`Source: <a href="${escapeHtml(conversation.url)}">${escapeHtml(conversation.url)}</a>`);
  metaParts.push(`Exported: ${escapeHtml(conversation.exported_at)}`);
  metaParts.push(`Messages: ${conversation.message_count}`);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${STYLE}</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p class="meta">${metaParts.join(" · ")}</p>
  </header>
  <main>
${sections.join("\n")}
  </main>
  <footer>Exported via Chat Exporter. To save as PDF, open this file in a browser and use Print → Save as PDF.</footer>
</body>
</html>
`;
}
