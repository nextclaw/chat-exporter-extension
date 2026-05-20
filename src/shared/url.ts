import { SITE_LABELS, type Service } from "./types";

export interface SiteDefinition {
  service: Service;
  siteLabel: string;
  origins: readonly string[];
  conversationPrefix: string;
  conversationPageLabel: string;
}

export const SITE_DEFINITIONS: readonly SiteDefinition[] = [
  {
    service: "chatgpt",
    siteLabel: SITE_LABELS.chatgpt,
    origins: ["https://chatgpt.com"],
    conversationPrefix: "c",
    conversationPageLabel: "ChatGPT conversation page",
  },
  {
    service: "gemini",
    siteLabel: SITE_LABELS.gemini,
    origins: ["https://gemini.google.com"],
    conversationPrefix: "app",
    conversationPageLabel: "Gemini conversation page",
  },
  {
    service: "claude",
    siteLabel: SITE_LABELS.claude,
    origins: ["https://claude.ai", "https://app.claude.ai"],
    conversationPrefix: "chat",
    conversationPageLabel: "Claude conversation page",
  },
] as const;

export interface ParsedConversationUrl {
  ok: true;
  service: Service;
  siteLabel: string;
  origin: string;
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

function siteForOrigin(origin: string): SiteDefinition | undefined {
  return SITE_DEFINITIONS.find((site) => site.origins.includes(origin));
}

export function isSupportedOrigin(value: string): boolean {
  try {
    return Boolean(siteForOrigin(new URL(value).origin));
  } catch {
    return false;
  }
}

export function parseConversationUrl(value: string): ConversationUrlResult {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: "Current tab URL is not valid.", url: value };
  }

  const site = siteForOrigin(parsed.origin);
  if (!site) {
    return {
      ok: false,
      reason: "Current tab is not a supported chat service.",
      url: parsed.href,
    };
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const conversationId = segments[0] === site.conversationPrefix ? (segments[1] ?? "") : "";

  if (!conversationId || conversationId === "." || conversationId === "..") {
    return {
      ok: false,
      reason: `Current page is not a ${site.conversationPageLabel}.`,
      url: parsed.href,
    };
  }

  return {
    ok: true,
    service: site.service,
    siteLabel: site.siteLabel,
    origin: parsed.origin,
    conversationId,
    url: parsed.href.split("#", 1)[0],
  };
}

export function parseChatGptConversationUrl(value: string): ConversationUrlResult {
  const parsed = parseConversationUrl(value);
  if (!parsed.ok || parsed.service === "chatgpt") {
    return parsed;
  }
  return {
    ok: false,
    reason: "Current tab is not a supported ChatGPT origin.",
    url: parsed.url,
  };
}
