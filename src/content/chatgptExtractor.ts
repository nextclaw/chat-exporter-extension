import { buildExportBundle } from "../shared/exportBundle";
import { convertHtmlToMarkdown, enrichMessage } from "../shared/markdown";
import {
  EXPORTER_VERSION,
  FORMAT_VERSION,
  SERVICE,
  type ChatMessage,
  type ConversationExport,
  type ExportBundle,
  type PageStatus,
  type Role,
} from "../shared/types";
import { parseChatGptConversationUrl } from "../shared/url";
import { utcTimestamp } from "../shared/time";

interface RolePayload {
  role: Role;
  dom_html: string;
  dom_markdown: string;
  dom_text: string;
}

interface TitleCandidate {
  source: string;
  title: string;
  priority: number;
}

interface ScrollDebug {
  attempts: number;
  stable_rounds: number;
  initial_turn_count: number;
  final_turn_count: number;
  transport: string;
}

const NOISE_TEXT_PATTERN =
  /^(Thought for|Reasoned for|Searching the web|Finished thinking|Searching|Open in canvas)$/i;
const NON_LANGUAGE_PATTERN =
  /^(Copy|Edit|Run|Download|Good response|Bad response|Retry|Open in canvas)$/i;

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\u00a0/g, " ").replace(/\s+\n/g, "\n").trim();
}

function getElementText(element: Element): string {
  const innerText = (element as HTMLElement).innerText;
  if (innerText) {
    return cleanText(innerText);
  }
  return cleanText(nodeText(element));
}

function nodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }
  const element = node as Element;
  if (element.tagName.toLowerCase() === "br") {
    return "\n";
  }
  return Array.from(element.childNodes).map(nodeText).join("");
}

function isCodeLanguage(value: string | null | undefined): boolean {
  const text = value ?? "";
  return /^[A-Za-z0-9.+#-]{1,24}$/.test(text) && !NON_LANGUAGE_PATTERN.test(text);
}

function normalizeMath(root: ParentNode): void {
  root.querySelectorAll("[data-math], annotation[encoding='application/x-tex'], .katex-mathml annotation").forEach((node) => {
    const tex = cleanText(node.getAttribute("data-math") ?? node.textContent);
    if (!tex) {
      return;
    }
    const replacement = document.createElement("span");
    replacement.textContent = tex.includes("\n") ? `$$\n${tex}\n$$` : `$${tex}$`;
    if ((node as Element).closest(".katex, .math-display")) {
      replacement.textContent = `$$\n${tex}\n$$`;
    }
    const host = (node as Element).closest(".katex") ?? node;
    host.replaceWith(replacement);
  });
}

function normalizeMedia(root: ParentNode): void {
  root.querySelectorAll("img").forEach((img) => {
    const alt = cleanText(img.getAttribute("alt"));
    const src = img.getAttribute("src") ?? "";
    const replacement = document.createElement(src ? "a" : "span");
    if (src) {
      replacement.setAttribute("href", src);
    }
    replacement.textContent = alt ? `[Image: ${alt}]` : "[Image]";
    img.replaceWith(replacement);
  });
}

function extractLanguage(node: Element): string {
  const directCode = node.querySelector("pre code[class*='language-']");
  if (directCode) {
    const match = directCode.className.match(/language-([A-Za-z0-9.+#-]+)/);
    if (match) {
      return match[1];
    }
  }

  const dataLanguage =
    node.getAttribute("data-language") ?? node.querySelector("[data-language]")?.getAttribute("data-language");
  if (dataLanguage && isCodeLanguage(dataLanguage)) {
    return dataLanguage.trim().toLowerCase();
  }

  const labels = Array.from(node.querySelectorAll("span, div"))
    .map((child) => getElementText(child))
    .filter((text) => text && text.length <= 24);
  return labels.find(isCodeLanguage)?.toLowerCase() ?? "";
}

function normalizeCodeBlocks(root: ParentNode): void {
  root.querySelectorAll("[data-testid='code-block']").forEach((block) => {
    const pre = block.querySelector("pre");
    const source = block.querySelector("pre code, code") ?? pre;
    const code = document.createElement("code");
    const language = extractLanguage(block);
    if (language) {
      code.className = `language-${language}`;
    }
    code.textContent = source?.textContent ?? block.textContent ?? "";
    const normalizedPre = document.createElement("pre");
    normalizedPre.append(code);
    block.replaceWith(normalizedPre);
  });

  root.querySelectorAll("pre").forEach((pre) => {
    if (pre.querySelector("code")) {
      return;
    }
    const code = document.createElement("code");
    code.textContent = pre.textContent ?? "";
    pre.replaceChildren(code);
  });
}

function removeNoise(root: ParentNode): void {
  root.querySelectorAll("button, script, style, noscript, textarea, svg").forEach((node) => node.remove());
  root.querySelectorAll(".sr-only").forEach((node) => {
    if (/^(ChatGPT said|You said)/i.test(getElementText(node))) {
      node.remove();
    }
  });
  root.querySelectorAll("*").forEach((node) => {
    if (!node.children.length && NOISE_TEXT_PATTERN.test(getElementText(node))) {
      node.remove();
    }
  });
}

function pickSourceRoot(roleElement: Element, role: Role): Element {
  const candidates =
    role === "assistant"
      ? [".markdown", ".prose", ".whitespace-pre-wrap"]
      : [".whitespace-pre-wrap", ".markdown", ".prose"];
  for (const selector of candidates) {
    const candidate = roleElement.querySelector(selector);
    if (candidate) {
      return candidate;
    }
  }
  return roleElement;
}

export function extractRolePayloads(root: ParentNode = document): RolePayload[] {
  return Array.from(root.querySelectorAll("[data-message-author-role]"))
    .map((roleElement) => {
      const role = roleElement.getAttribute("data-message-author-role");
      if (role !== "user" && role !== "assistant") {
        return undefined;
      }

      const clone = pickSourceRoot(roleElement, role).cloneNode(true) as Element;
      normalizeMath(clone);
      normalizeMedia(clone);
      normalizeCodeBlocks(clone);
      removeNoise(clone);
      clone.querySelectorAll("a").forEach((anchor) => {
        if (!getElementText(anchor) && anchor.getAttribute("href")) {
          anchor.textContent = anchor.getAttribute("href");
        }
      });

      const domHtml = cleanText(clone.innerHTML);
      return {
        role,
        dom_html: domHtml,
        dom_markdown: convertHtmlToMarkdown(domHtml),
        dom_text: getElementText(clone),
      };
    })
    .filter((payload): payload is RolePayload => Boolean(payload));
}

function usableTitle(value: string | undefined): string {
  const title = cleanText(value).replace(/\s+[-|]\s+ChatGPT$/i, "");
  if (!title || /^(ChatGPT|New chat|Temporary chat|Untitled)$/i.test(title)) {
    return "";
  }
  return title;
}

function selectTitle(candidates: TitleCandidate[]): { title: string; source: string } {
  const usable = candidates
    .map((candidate, index) => ({ ...candidate, title: usableTitle(candidate.title), index }))
    .filter((candidate) => candidate.title)
    .sort((left, right) => right.priority - left.priority || left.index - right.index);
  const best = usable[0];
  return best ? { title: best.title, source: best.source } : { title: "ChatGPT Conversation", source: "fallback" };
}

function titleCandidates(url: string): TitleCandidate[] {
  const candidates: TitleCandidate[] = [];
  const addCandidate = (source: string, title: string | null | undefined, priority: number) => {
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

  document.querySelectorAll<HTMLAnchorElement>("nav a[href*='/c/'], aside a[href*='/c/'], a[href*='/c/']").forEach((anchor) => {
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
  document.querySelectorAll("[data-testid='conversation-title'], [data-testid='chat-title']").forEach((heading) => {
    if (heading.closest("[data-message-author-role], button, [role='button']")) {
      return;
    }
    addCandidate("heading", heading.textContent, 40);
  });
  return candidates;
}

function findScrollContainer(): HTMLElement | Window {
  const turn = document.querySelector("[data-testid^='conversation-turn-']");
  const selectors = [
    "div[data-testid='conversation-turns']",
    "div[aria-label='Chat history']",
    "div.flex.h-full.flex-col.overflow-y-auto",
    "div.flex.h-full.w-full.flex-col.overflow-y-auto",
    "main div.flex-1.overflow-y-auto",
    "main div.overflow-y-auto",
  ];

  for (const selector of selectors) {
    const candidate = document.querySelector<HTMLElement>(selector);
    if (candidate && candidate.scrollHeight > candidate.clientHeight + 80) {
      return candidate;
    }
  }

  let node = turn?.parentElement;
  while (node) {
    const style = window.getComputedStyle(node);
    if ((style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight + 80) {
      return node;
    }
    node = node.parentElement;
  }

  return window;
}

function turnCount(): number {
  return document.querySelectorAll("[data-testid^='conversation-turn-'], [data-message-author-role]").length;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function scrollConversationToTop(maxAttempts = 8, stableRoundsTarget = 2, delayMs = 250): Promise<ScrollDebug> {
  const container = findScrollContainer();
  const initialTurnCount = turnCount();
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
    const currentTurnCount = turnCount();
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
    final_turn_count: turnCount(),
    transport: isWindow ? "window" : "container",
  };
}

function pageStatusFromUrl(url: string): PageStatus {
  const parsed = parseChatGptConversationUrl(url);
  if (!parsed.ok) {
    return { ok: false, url: parsed.url, reason: parsed.reason };
  }
  return { ok: true, url: parsed.url, conversationId: parsed.conversationId };
}

export function probeCurrentPage(): PageStatus {
  return pageStatusFromUrl(location.href);
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

export async function exportCurrentConversation(): Promise<{ status: PageStatus; bundle?: ExportBundle; error?: string }> {
  const parsed = parseChatGptConversationUrl(location.href);
  if (!parsed.ok) {
    return {
      status: { ok: false, url: parsed.url, reason: parsed.reason },
      error: parsed.reason,
    };
  }

  const scrollDebug = await scrollConversationToTop();
  const payloads = extractRolePayloads();
  const messages = payloads.map(buildMessage).filter((message) => message.final_markdown.trim());
  if (!messages.length) {
    return {
      status: { ok: true, url: parsed.url, conversationId: parsed.conversationId },
      error: "No ChatGPT messages were found on the current conversation page.",
    };
  }

  const selectedTitle = selectTitle(titleCandidates(parsed.url));
  const conversation: ConversationExport = {
    service: SERVICE,
    format_version: FORMAT_VERSION,
    exporter_version: EXPORTER_VERSION,
    conversation_id: parsed.conversationId,
    title: selectedTitle.title,
    title_source: selectedTitle.source,
    url: parsed.url,
    exported_at: utcTimestamp(),
    message_count: messages.length,
    scroll_debug: { ...scrollDebug },
    messages,
  };

  return {
    status: { ok: true, url: parsed.url, conversationId: parsed.conversationId },
    bundle: buildExportBundle(conversation),
  };
}
