import type { ConversationExport } from "./types";

export function sanitizeFilenamePart(value: string | undefined, fallback: string): string {
  const candidate = (value ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^0-9A-Za-z._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
  return candidate || fallback;
}

export function buildOutputBaseName(conversation: Pick<ConversationExport, "title" | "conversation_id">): string {
  const title = sanitizeFilenamePart(conversation.title, "chatgpt");
  const conversationId = sanitizeFilenamePart(conversation.conversation_id, "chat");
  return conversationId ? `${title}__${conversationId}` : title;
}
