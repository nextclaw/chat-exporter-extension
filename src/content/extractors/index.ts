import { ImageAssetCollector } from "../../shared/assets";
import { buildExportBundle } from "../../shared/exportBundle";
import { buildOutputBaseName } from "../../shared/filename";
import { enrichMessage } from "../../shared/markdown";
import {
  DEFAULT_EXPORT_FORMATS,
  EXPORTER_VERSION,
  FORMAT_VERSION,
  SITE_LABELS,
  type ChatMessage,
  type ConversationExport,
  type ExportBundle,
  type ExportFormat,
  type PageStatus,
  type Service,
} from "../../shared/types";
import { parseConversationUrl, type ParsedConversationUrl } from "../../shared/url";
import { utcTimestamp } from "../../shared/time";

import { extractClaudeRolePayloads } from "./claude";
import { extractGeminiRolePayloads } from "./gemini";
import { extractRolePayloads, harvestChatGptPayloads } from "./chatgpt";
import {
  cleanText,
  findScrollContainer,
  getElementText,
  turnCount,
  wait,
  type RolePayload,
  type ScrollDebug,
} from "./shared";

export { extractRolePayloads, harvestChatGptPayloads } from "./chatgpt";
export { extractGeminiRolePayloads } from "./gemini";
export { extractClaudeRolePayloads } from "./claude";

interface TitleCandidate {
  source: string;
  title: string;
  priority: number;
}

async function extractPayloadsForService(service: Service, assetCollector: ImageAssetCollector): Promise<RolePayload[]> {
  if (service === "gemini") {
    return extractGeminiRolePayloads(document, assetCollector);
  }
  if (service === "claude") {
    return extractClaudeRolePayloads(document, assetCollector);
  }
  return extractRolePayloads(document, assetCollector);
}

function usableTitle(value: string | undefined): string {
  const title = cleanText(value).replace(/\s+(?:[-|]|—)\s+(ChatGPT|Gemini|Google Gemini|Claude)$/i, "");
  if (!title || /^(ChatGPT|Gemini|Google Gemini|Claude|New chat|Temporary chat|Untitled)$/i.test(title)) {
    return "";
  }
  return title;
}

function selectTitle(candidates: TitleCandidate[], service: Service): { title: string; source: string } {
  const usable = candidates
    .map((candidate, index) => ({ ...candidate, title: usableTitle(candidate.title), index }))
    .filter((candidate) => candidate.title)
    .sort((left, right) => right.priority - left.priority || left.index - right.index);
  const best = usable[0];
  return best ? { title: best.title, source: best.source } : { title: `${SITE_LABELS[service]} Conversation`, source: "fallback" };
}

function titleCandidates(url: string, service: Service): TitleCandidate[] {
  const candidates: TitleCandidate[] = [];
  const addCandidate = (source: string, title: string | null | undefined, priority: number): void => {
    const normalized = cleanText(title);
    if (!normalized || /^https?:\/\//i.test(normalized)) {
      return;
    }
    candidates.push({ source, title: normalized, priority });
  };

  let currentPath = "";
  try {
    currentPath = new URL(url).pathname;
  } catch {
    currentPath = "";
  }

  const isCurrentConversationLink = (anchor: HTMLAnchorElement): boolean => {
    try {
      const href = new URL(anchor.getAttribute("href") ?? "", location.origin);
      return href.pathname === currentPath;
    } catch {
      return false;
    }
  };

  const linkPattern = service === "gemini" ? "/app/" : service === "claude" ? "/chat/" : "/c/";
  document.querySelectorAll<HTMLAnchorElement>(`nav a[href*='${linkPattern}'], aside a[href*='${linkPattern}'], a[href*='${linkPattern}']`).forEach((anchor) => {
    if (!isCurrentConversationLink(anchor)) {
      return;
    }
    addCandidate("current_link_title_attr", anchor.getAttribute("title"), 100);
    addCandidate("current_link_text", getElementText(anchor).split(/\n+/).map(cleanText).filter(Boolean)[0], 95);
    addCandidate("current_link_aria", anchor.getAttribute("aria-label"), 90);
  });

  addCandidate("document_title", document.title, 80);
  addCandidate("og_title", document.querySelector("meta[property='og:title']")?.getAttribute("content"), 70);
  addCandidate("twitter_title", document.querySelector("meta[name='twitter:title']")?.getAttribute("content"), 70);
  document.querySelectorAll("[data-testid='conversation-title'], [data-testid='chat-title'], [data-testid*='conversation-title' i]").forEach((heading) => {
    if (heading.closest("[data-message-author-role], button, [role='button']")) {
      return;
    }
    addCandidate("heading", heading.textContent, 40);
  });
  return candidates;
}

export async function scrollConversationToTop(
  service: Service = "chatgpt",
  maxAttempts = 8,
  stableRoundsTarget = 2,
  delayMs = 250,
): Promise<ScrollDebug> {
  const container = findScrollContainer(service);
  const initialTurnCount = turnCount(service);
  let lastTurnCount = initialTurnCount;
  let stableRounds = 0;
  let attempts = 0;
  const isWindow = container === window;

  while (attempts < maxAttempts && stableRounds < stableRoundsTarget) {
    attempts += 1;
    if (isWindow) {
      window.scrollTo(0, 0);
    } else {
      (container as HTMLElement).scrollTop = 0;
    }
    await wait(delayMs);
    const currentTurnCount = turnCount(service);
    if (currentTurnCount === lastTurnCount) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
      lastTurnCount = currentTurnCount;
    }
  }

  return {
    attempts,
    stable_rounds: stableRounds,
    initial_turn_count: initialTurnCount,
    final_turn_count: turnCount(service),
    transport: isWindow ? "window" : "container",
  };
}

function pageStatusFromUrl(url: string): PageStatus {
  const parsed = parseConversationUrl(url);
  if (!parsed.ok) {
    return { ok: false, url: parsed.url, reason: parsed.reason };
  }
  return {
    ok: true,
    url: parsed.url,
    service: parsed.service,
    siteLabel: parsed.siteLabel,
    conversationId: parsed.conversationId,
  };
}

export function probeCurrentPage(): PageStatus {
  return pageStatusFromUrl(location.href);
}

function summaryMessageCount(service: Service): number {
  if (service === "chatgpt") {
    const turns = document.querySelectorAll("[data-testid^='conversation-turn-']").length;
    if (turns > 0) {
      return turns;
    }
    return document.querySelectorAll("[data-message-author-role]").length;
  }
  if (service === "gemini") {
    return document.querySelectorAll(
      "user-query, model-response, [data-test-id*='user-query' i], [data-testid*='user-query' i]",
    ).length;
  }
  const users = document.querySelectorAll(
    "[data-testid='user-message'], [data-testid*='user-message' i]",
  ).length;
  const assistants = document.querySelectorAll(
    ".font-claude-response, [data-testid*='assistant' i]",
  ).length;
  return users + assistants;
}

export function probeCurrentPageSummary(): PageStatus {
  const base = probeCurrentPage();
  if (!base.ok || !base.service) {
    return base;
  }
  try {
    const selectedTitle = selectTitle(titleCandidates(base.url, base.service), base.service);
    const title = selectedTitle.source === "fallback" ? undefined : selectedTitle.title;
    const messageCount = summaryMessageCount(base.service);
    return { ...base, title, messageCount };
  } catch {
    return base;
  }
}

function buildMessage(payload: RolePayload, index: number): ChatMessage {
  const message = {
    id: `${payload.role}-${String(index).padStart(4, "0")}`,
    role: payload.role,
    clipboard_text: "",
    clipboard_html: "",
    dom_markdown: payload.dom_markdown,
    dom_html: payload.dom_html,
    dom_text: payload.dom_text,
  };
  return enrichMessage(message);
}

function buildConversation(
  parsed: ParsedConversationUrl,
  selectedTitle: { title: string; source: string },
  messages: ChatMessage[],
  scrollDebug: ScrollDebug,
  assets: ConversationExport["assets"],
): ConversationExport {
  return {
    service: parsed.service,
    format_version: FORMAT_VERSION,
    exporter_version: EXPORTER_VERSION,
    conversation_id: parsed.conversationId,
    title: selectedTitle.title,
    title_source: selectedTitle.source,
    url: parsed.url,
    exported_at: utcTimestamp(),
    message_count: messages.length,
    scroll_debug: { ...scrollDebug },
    assets,
    messages,
  };
}

export async function exportCurrentConversation(
  formats: readonly ExportFormat[] = DEFAULT_EXPORT_FORMATS,
): Promise<{ status: PageStatus; bundle?: ExportBundle; error?: string }> {
  const parsed = parseConversationUrl(location.href);
  if (!parsed.ok) {
    return {
      status: { ok: false, url: parsed.url, reason: parsed.reason },
      error: parsed.reason,
    };
  }

  const status: PageStatus = {
    ok: true,
    url: parsed.url,
    service: parsed.service,
    siteLabel: parsed.siteLabel,
    conversationId: parsed.conversationId,
  };
  const selectedTitle = selectTitle(titleCandidates(parsed.url, parsed.service), parsed.service);
  const baseName = buildOutputBaseName({
    service: parsed.service,
    title: selectedTitle.title,
    conversation_id: parsed.conversationId,
  });
  const assetCollector = new ImageAssetCollector(baseName);
  let payloads: RolePayload[];
  let scrollDebug: ScrollDebug;
  if (parsed.service === "chatgpt") {
    const harvest = await harvestChatGptPayloads(assetCollector);
    payloads = harvest.payloads;
    scrollDebug = harvest.debug;
  } else {
    scrollDebug = await scrollConversationToTop(parsed.service);
    payloads = await extractPayloadsForService(parsed.service, assetCollector);
  }
  const messages = payloads.map(buildMessage).filter((message) => message.final_markdown.trim());
  if (!messages.length) {
    return {
      status,
      error: `No ${parsed.siteLabel} messages were found on the current conversation page.`,
    };
  }

  const conversation = buildConversation(parsed, selectedTitle, messages, scrollDebug, assetCollector.listAssets());

  return {
    status,
    bundle: buildExportBundle(conversation, formats),
  };
}
