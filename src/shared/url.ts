export const CHATGPT_ORIGINS = [
  "https://chatgpt.com",
  "https://chat.openai.com",
] as const;

export interface ParsedConversationUrl {
  ok: true;
  origin: (typeof CHATGPT_ORIGINS)[number];
  conversationId: string;
  url: string;
}

export interface UnsupportedConversationUrl {
  ok: false;
  reason: string;
  url: string;
}

export type ConversationUrlResult =
  | ParsedConversationUrl
  | UnsupportedConversationUrl;

export function isAllowedChatGptOrigin(value: string): boolean {
  try {
    return CHATGPT_ORIGINS.includes(new URL(value).origin as (typeof CHATGPT_ORIGINS)[number]);
  } catch {
    return false;
  }
}

export function parseChatGptConversationUrl(value: string): ConversationUrlResult {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: "Current tab URL is not valid.", url: value };
  }

  const origin = parsed.origin as (typeof CHATGPT_ORIGINS)[number];
  if (!CHATGPT_ORIGINS.includes(origin)) {
    return {
      ok: false,
      reason: "Current tab is not a supported ChatGPT origin.",
      url: parsed.href,
    };
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const conversationId = segments[0] === "c" ? (segments[1] ?? "") : "";

  if (!conversationId || conversationId === "." || conversationId === "..") {
    return {
      ok: false,
      reason: "Current page is not a ChatGPT conversation page.",
      url: parsed.href,
    };
  }

  return {
    ok: true,
    origin,
    conversationId,
    url: parsed.href.split("#", 1)[0],
  };
}
