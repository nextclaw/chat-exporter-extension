import type { ConversationExport } from "./types";

const MAX_FILENAME_PART_LENGTH = 80;

function truncateCodePoints(value: string, maxLength = MAX_FILENAME_PART_LENGTH): string {
  return Array.from(value).slice(0, maxLength).join("");
}

function replaceControlCharacters(value: string): string {
  return Array.from(value)
    .map((char) => {
      const codePoint = char.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 ? "_" : char;
    })
    .join("");
}

export function sanitizeFilenamePart(value: string | undefined, fallback: string): string {
  const candidate = replaceControlCharacters(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/[/\\:*?"<>|]+/g, "_")
    .replace(/\s+/gu, "_")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/[._-]{2,}/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");
  const truncated = truncateCodePoints(candidate).replace(/^[._-]+|[._-]+$/g, "");
  return truncated || fallback;
}

export function sanitizeIdentifierPart(value: string | undefined, fallback: string): string {
  const candidate = (value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^0-9A-Za-z._-]+/g, "_")
    .replace(/[._-]{2,}/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");
  const truncated = truncateCodePoints(candidate).replace(/^[._-]+|[._-]+$/g, "");
  return truncated || fallback;
}

export function buildOutputBaseName(conversation: Pick<ConversationExport, "service" | "title" | "conversation_id">): string {
  const service = sanitizeIdentifierPart(conversation.service, "chat");
  const title = sanitizeFilenamePart(conversation.title, service);
  const conversationId = sanitizeIdentifierPart(conversation.conversation_id, "chat");
  return conversationId ? `${service}__${title}__${conversationId}` : `${service}__${title}`;
}
