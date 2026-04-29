import { buildExportBundle } from "../shared/exportBundle";
import { convertHtmlToMarkdown, enrichMessage } from "../shared/markdown";
import {
  EXPORTER_VERSION,
  FORMAT_VERSION,
  SITE_LABELS,
  type ChatMessage,
  type ConversationExport,
  type ExportBundle,
  type PageStatus,
  type Role,
  type Service,
} from "../shared/types";
import { parseConversationUrl, type ParsedConversationUrl } from "../shared/url";
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
    if (/^(ChatGPT said|Gemini said|Gemini 说|Claude said|Human said|You said)/i.test(getElementText(node))) {
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

function addRecord(records: Array<{ role: Role; node: Element; text: string }>, role: Role, node: Element | null): void {
  if (!node) {
    return;
  }
  const text = getElementText(node).replace(/\s+/g, " ").trim();
  if (!text || text.length < 2 || /^(Gemini|Gemini 说|Gemini said|Claude|Human|You|Show thinking|显示思路)$/i.test(text)) {
    return;
  }
  records.push({ role, node, text });
}

function compareDocumentOrder(left: Element, right: Element): number {
  if (left === right) {
    return 0;
  }
  if (left.contains(right)) {
    return -1;
  }
  if (right.contains(left)) {
    return 1;
  }
  const position = left.compareDocumentPosition(right);
  return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function compactRecords(records: Array<{ role: Role; node: Element; text: string }>): Array<{ role: Role; node: Element; text: string }> {
  const compact: Array<{ role: Role; node: Element; text: string }> = [];
  for (const record of records.sort((left, right) => compareDocumentOrder(left.node, right.node))) {
    const duplicateIndex = compact.findIndex((existing) => {
      if (existing.role !== record.role) {
        return false;
      }
      if (existing.node.contains(record.node) || record.node.contains(existing.node) || existing.text === record.text) {
        return true;
      }
      const shorter = existing.text.length < record.text.length ? existing.text : record.text;
      const longer = existing.text.length < record.text.length ? record.text : existing.text;
      return shorter.length > 120 && longer.includes(shorter);
    });
    if (duplicateIndex === -1) {
      compact.push(record);
      continue;
    }
    const existing = compact[duplicateIndex];
    if (existing.node.contains(record.node) && existing.node !== record.node) {
      compact[duplicateIndex] = record;
      continue;
    }
    if (!record.node.contains(existing.node)) {
      const existingSize = existing.node.querySelectorAll("*").length;
      const recordSize = record.node.querySelectorAll("*").length;
      compact[duplicateIndex] = recordSize < existingSize ? record : existing;
    }
  }
  return compact.sort((left, right) => compareDocumentOrder(left.node, right.node));
}

function markdownFromGeminiUserNode(node: Element): string {
  const root = node.querySelector(".query-text") ?? node;
  const lineNodes = root.matches(".query-text-line") ? [root] : Array.from(root.querySelectorAll(".query-text-line"));
  if (!lineNodes.length) {
    return getElementText(root);
  }
  let lines = lineNodes.map((line) => nodeText(line).replace(/\u00a0/g, " ").replace(/[ \t]+$/g, ""));
  const nonblank = lines.filter((line) => line.trim());
  if (nonblank.length) {
    const commonIndent = Math.min(...nonblank.map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0));
    if (commonIndent > 0) {
      lines = lines.map((line) => (line.trim() ? line.slice(commonIndent) : ""));
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function removeGeminiNoise(root: ParentNode): void {
  removeNoise(root);
  root.querySelectorAll("mat-icon, [aria-hidden='true'], .cdk-visually-hidden, .screen-reader-user-query-label").forEach((node) => node.remove());
  root.querySelectorAll("*").forEach((node) => {
    if (node.children.length) {
      return;
    }
    const text = getElementText(node);
    if (/^(Gemini 说|Gemini said|显示思路|Show thinking|停止回答|Stop responding|立即回答|Answer now)$/i.test(text)) {
      node.remove();
    }
    if (/^Gemini (can make mistakes|是一款 AI 工具)/i.test(text)) {
      node.remove();
    }
  });
}

export function extractGeminiRolePayloads(root: ParentNode = document): RolePayload[] {
  const records: Array<{ role: Role; node: Element; text: string }> = [];
  const userSelectors = ["user-query", "[data-test-id*='user-query' i]", "[data-testid*='user-query' i]", ".user-query", ".query-text"];
  const assistantSelectors = ["model-response", "message-content", ".model-response-text", ".response-content", ".model-response"];

  userSelectors.forEach((selector) => root.querySelectorAll(selector).forEach((node) => addRecord(records, "user", node)));
  assistantSelectors.forEach((selector) => {
    root.querySelectorAll(selector).forEach((node) => {
      if (node.closest("user-query, [data-test-id*='user-query' i], [data-testid*='user-query' i], .user-query")) {
        return;
      }
      addRecord(records, "assistant", node);
    });
  });

  return compactRecords(records).map((record) => {
    const sourceNode = record.role === "user" ? record.node.querySelector(".query-text") ?? record.node : record.node;
    const clone = sourceNode.cloneNode(true) as Element;
    normalizeMedia(clone);
    normalizeCodeBlocks(clone);
    removeGeminiNoise(clone);
    const domMarkdown = record.role === "user" ? markdownFromGeminiUserNode(record.node) : convertHtmlToMarkdown(cleanText(clone.innerHTML || clone.outerHTML));
    const domHtml = cleanText(clone.innerHTML || clone.outerHTML);
    return {
      role: record.role,
      clipboard_text: "",
      clipboard_html: "",
      dom_markdown: domMarkdown,
      dom_html: domHtml,
      dom_text: record.role === "user" ? domMarkdown : getElementText(clone),
    };
  });
}

function normalizeClaudeSpecialBlocks(root: ParentNode): void {
  root.querySelectorAll("[data-testid*='artifact' i], .artifact, [data-testid*='attachment' i], .attachment").forEach((node) => {
    const replacement = document.createElement("p");
    const text = getElementText(node).slice(0, 80);
    replacement.textContent = text ? `[Attachment: ${text}]` : "[Attachment]";
    node.replaceWith(replacement);
  });
  root.querySelectorAll("[data-testid*='thinking' i], details").forEach((node) => {
    const replacement = document.createElement("blockquote");
    const text = getElementText(node).slice(0, 160);
    replacement.textContent = text ? `[Thinking: ${text}]` : "[Thinking block]";
    node.replaceWith(replacement);
  });
}

function removeClaudeNoise(root: ParentNode): void {
  removeNoise(root);
  root.querySelectorAll("[aria-hidden='true'], .sr-only").forEach((node) => node.remove());
  root.querySelectorAll("*").forEach((node) => {
    if (!node.children.length && /^(Copy|Retry|Share|Claude said|Human said|You said)$/i.test(getElementText(node))) {
      node.remove();
    }
  });
}

export function extractClaudeRolePayloads(root: ParentNode = document): RolePayload[] {
  const records: Array<{ role: Role; node: Element; text: string }> = [];
  const userSelector = [
    "[data-testid='user-message']",
    "[data-testid*='user-message' i]",
    "[data-testid*='human' i]",
    ".font-user-message",
    "[data-user-message-bubble='true'] [data-testid='user-message']",
  ].join(",");
  const assistantSelector = [
    "[data-testid*='assistant' i]",
    "[data-testid*='claude' i]",
    ".font-claude-response",
    ".standard-markdown",
    ".progressive-markdown",
    ".prose",
  ].join(",");

  root.querySelectorAll(userSelector).forEach((node) => addRecord(records, "user", node));
  root.querySelectorAll(assistantSelector).forEach((node) => {
    if (node.closest(userSelector)) {
      return;
    }
    addRecord(records, "assistant", node);
  });

  return compactRecords(records).map((record) => {
    const clone = record.node.cloneNode(true) as Element;
    normalizeClaudeSpecialBlocks(clone);
    normalizeMedia(clone);
    normalizeCodeBlocks(clone);
    removeClaudeNoise(clone);
    const domHtml = cleanText(clone.innerHTML || clone.outerHTML);
    return {
      role: record.role,
      clipboard_text: "",
      clipboard_html: "",
      dom_markdown: convertHtmlToMarkdown(domHtml),
      dom_html: domHtml,
      dom_text: getElementText(clone),
    };
  });
}

function extractPayloadsForService(service: Service): RolePayload[] {
  if (service === "gemini") {
    return extractGeminiRolePayloads();
  }
  if (service === "claude") {
    return extractClaudeRolePayloads();
  }
  return extractRolePayloads();
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

function findScrollContainer(service: Service): HTMLElement | Window {
  const turn = document.querySelector("[data-testid^='conversation-turn-']");
  const selectors =
    service === "chatgpt"
      ? [
          "div[data-testid='conversation-turns']",
          "div[aria-label='Chat history']",
          "div.flex.h-full.flex-col.overflow-y-auto",
          "div.flex.h-full.w-full.flex-col.overflow-y-auto",
          "main div.flex-1.overflow-y-auto",
          "main div.overflow-y-auto",
        ]
      : ["main", ".conversation-container", "[data-testid='conversation']", "[data-testid*='conversation' i]", "div[role='main']", "div.overflow-y-auto", "body"];

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

function turnCount(service: Service): number {
  const selectors =
    service === "gemini"
      ? [
          "user-query",
          "[data-test-id*='user-query' i]",
          "[data-testid*='user-query' i]",
          ".user-query",
          "model-response",
          "message-content",
          ".model-response-text",
          ".response-content",
          ".model-response",
        ]
      : service === "claude"
        ? [
            "[data-testid='user-message']",
            "[data-testid*='user-message' i]",
            "[data-testid*='assistant' i]",
            ".font-claude-response",
            ".standard-markdown",
            ".progressive-markdown",
            ".prose",
          ]
        : ["[data-testid^='conversation-turn-']", "[data-message-author-role]"];
  return Array.from(document.querySelectorAll(selectors.join(","))).filter((node) => getElementText(node).length > 0).length;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function scrollConversationToTop(service: Service = "chatgpt", maxAttempts = 8, stableRoundsTarget = 2, delayMs = 250): Promise<ScrollDebug> {
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

function buildConversation(parsed: ParsedConversationUrl, messages: ChatMessage[], scrollDebug: ScrollDebug): ConversationExport {
  const selectedTitle = selectTitle(titleCandidates(parsed.url, parsed.service), parsed.service);
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
    messages,
  };
}

export async function exportCurrentConversation(): Promise<{ status: PageStatus; bundle?: ExportBundle; error?: string }> {
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
  const scrollDebug = await scrollConversationToTop(parsed.service);
  const payloads = extractPayloadsForService(parsed.service);
  const messages = payloads.map(buildMessage).filter((message) => message.final_markdown.trim());
  if (!messages.length) {
    return {
      status,
      error: `No ${parsed.siteLabel} messages were found on the current conversation page.`,
    };
  }

  const conversation = buildConversation(parsed, messages, scrollDebug);

  return {
    status,
    bundle: buildExportBundle(conversation),
  };
}
