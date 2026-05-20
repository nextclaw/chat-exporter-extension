import { ImageAssetCollector } from "../shared/assets";
import { buildExportBundle } from "../shared/exportBundle";
import { buildOutputBaseName } from "../shared/filename";
import { convertHtmlToMarkdown, enrichMessage } from "../shared/markdown";
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

interface ImageSource {
  url: string;
  alt: string;
}

interface PayloadRecord {
  node: Element;
  payload: RolePayload;
  turnIndex?: number;
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
  harvest_strategy?: string;
  turn_placeholders?: number;
  mounted_role_nodes?: number;
  harvested_messages?: number;
  harvest_positions?: number[];
  deduped_messages?: number;
  visited_turn_count?: number;
  visited_turn_indices?: number[];
  missing_turn_indices?: number[];
  coverage_reached_bottom?: boolean;
  initial_scroll_top?: number;
  restored_scroll_top?: number;
  scroll_height?: number;
  client_height?: number;
}

const NOISE_TEXT_PATTERN =
  /^(Thought for|Reasoned for|Searching the web|Finished thinking|Searching|Open in canvas)$/i;
const NON_LANGUAGE_PATTERN =
  /^(Copy|Edit|Run|Download|Good response|Bad response|Retry|Open in canvas)$/i;
const DOWNLOADABLE_ATTACHMENT_EXTENSIONS = new Set(["csv", "doc", "docx", "html", "json", "md", "pdf", "ppt", "pptx", "txt", "xls", "xlsx", "xml", "zip"]);

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
  if (element.tagName.toLowerCase() === "img") {
    const alt = cleanText(element.getAttribute("alt"));
    return alt ? `[Image: ${alt}]` : "[Image]";
  }
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

async function normalizeMedia(root: ParentNode, assetCollector?: ImageAssetCollector): Promise<void> {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  for (const img of images) {
    const alt = cleanText(img.getAttribute("alt"));
    if (alt) {
      img.setAttribute("alt", alt);
    }
    if (!assetCollector) {
      continue;
    }
    const asset = await assetCollector.registerImage(img);
    if (!asset) {
      continue;
    }
    img.setAttribute("data-original-src", asset.original_url);
    if (asset.status === "ready") {
      img.setAttribute("src", asset.local_path);
    }
  }
}

function imageUrlFromElement(image: HTMLImageElement): string {
  return image.currentSrc || image.getAttribute("src") || "";
}

function imageUrlLooksDownloadable(url: string): boolean {
  return /^(?:https?:|blob:|data:image\/)/i.test(url);
}

function urlLooksLikeImage(url: string): boolean {
  return (
    imageUrlLooksDownloadable(url) &&
    (/\/backend-api\/estuary\/content\b/i.test(url) || /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(url) || /^data:image\//i.test(url))
  );
}

function firstSrcsetUrl(srcset: string | null | undefined): string {
  return cleanText(srcset).split(",")[0]?.trim().split(/\s+/)[0] ?? "";
}

function collectImageSources(root: ParentNode): ImageSource[] {
  const sources = new Map<string, ImageSource>();
  const remember = (url: string, alt: string) => {
    const normalizedUrl = cleanText(url);
    if (!normalizedUrl || !imageUrlLooksDownloadable(normalizedUrl)) {
      return;
    }
    const normalizedAlt = cleanText(alt);
    const existing = sources.get(normalizedUrl);
    if (!existing || (!existing.alt && normalizedAlt)) {
      sources.set(normalizedUrl, { url: normalizedUrl, alt: normalizedAlt });
    }
  };

  root.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    remember(imageUrlFromElement(image), image.getAttribute("alt") ?? image.getAttribute("aria-label") ?? "");
  });
  root.querySelectorAll<HTMLSourceElement>("source[srcset]").forEach((source) => {
    remember(firstSrcsetUrl(source.getAttribute("srcset")), source.getAttribute("aria-label") ?? "");
  });
  root.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href") ?? "";
    if (urlLooksLikeImage(href)) {
      remember(href, anchor.getAttribute("aria-label") ?? anchor.getAttribute("title") ?? getElementText(anchor));
    }
  });

  return [...sources.values()];
}

function extensionFromPath(value: string): string {
  try {
    return new URL(value, location.origin).pathname.toLowerCase().match(/\.([a-z0-9]{1,12})$/)?.[1] ?? "";
  } catch {
    return value.toLowerCase().match(/\.([a-z0-9]{1,12})(?:$|[?#])/)?.[1] ?? "";
  }
}

function attachmentNameFromAnchor(anchor: HTMLAnchorElement): string {
  const downloadName = cleanText(anchor.getAttribute("download"));
  if (downloadName) {
    return downloadName;
  }
  const label = cleanText(anchor.getAttribute("aria-label") ?? anchor.getAttribute("title") ?? getElementText(anchor));
  if (label && !/^https?:\/\//i.test(label)) {
    return label;
  }
  try {
    return decodeURIComponent(new URL(anchor.href, location.origin).pathname.split("/").filter(Boolean).pop() ?? "attachment");
  } catch {
    return "attachment";
  }
}

function isAttachmentContext(anchor: HTMLAnchorElement): boolean {
  if (anchor.hasAttribute("download")) {
    return true;
  }
  if (anchor.closest("[data-testid*='attachment' i], [data-testid*='file' i], [data-testid*='document' i], [data-testid*='download' i], .attachment, .artifact")) {
    return true;
  }
  const label = `${anchor.getAttribute("aria-label") ?? ""} ${anchor.getAttribute("title") ?? ""} ${getElementText(anchor)}`;
  return /\b(?:download|attachment|document|file)\b|下载|附件|文件/i.test(label);
}

async function normalizeStaticAttachments(root: ParentNode, assetCollector?: ImageAssetCollector): Promise<void> {
  if (!assetCollector) {
    return;
  }
  for (const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = cleanText(anchor.href || anchor.getAttribute("href"));
    const extension = extensionFromPath(href);
    if (!href || !DOWNLOADABLE_ATTACHMENT_EXTENSIONS.has(extension) || !isAttachmentContext(anchor)) {
      continue;
    }
    const name = attachmentNameFromAnchor(anchor);
    const asset = await assetCollector.registerAttachmentUrl(href, name);
    if (asset?.status !== "ready") {
      continue;
    }
    anchor.href = asset.local_path;
    anchor.textContent = `Attachment: ${name}`;
  }
}

function attachmentNameFromElement(element: Element): string {
  const label = cleanText(element.getAttribute("aria-label") ?? element.getAttribute("title") ?? getElementText(element));
  return cleanText(label.match(/[\p{L}\p{N}][\p{L}\p{N} ._-]*\.(?:csv|docx?|html|json|md|pdf|pptx?|txt|xlsx?|xml|zip)\b/iu)?.[0] ?? "");
}

function normalizeChatGptAttachmentPlaceholders(root: ParentNode): void {
  root.querySelectorAll<Element>("[class~='group/file-tile'], [data-testid*='attachment' i], [data-testid*='file' i], [data-testid*='document' i]").forEach((node) => {
    if (node.querySelector("a[href]")) {
      return;
    }
    const name = attachmentNameFromElement(node);
    if (!name) {
      return;
    }
    const replacement = document.createElement("p");
    replacement.textContent = `[Attachment: ${name}]`;
    node.replaceWith(replacement);
  });
}

function hasDescendantClass(root: ParentNode, className: string): boolean {
  const elements = root instanceof Element ? [root, ...Array.from(root.querySelectorAll("*"))] : Array.from(root.querySelectorAll("*"));
  return elements.some((element) => element.classList.contains(className));
}

function isChatGptImageGenTurn(node: Element): boolean {
  return (
    hasDescendantClass(node, "group/imagegen-image") ||
    Boolean(node.querySelector("[data-testid='image-gen-overlay-actions']")) ||
    Boolean(node.querySelector("button[data-testid='good-image-turn-action-button']")) ||
    Boolean(node.querySelector("img[src*='/backend-api/estuary/content']"))
  );
}

function chatGptImageGenTurns(root: ParentNode): Element[] {
  const candidates = Array.from(
    root.querySelectorAll<Element>(
      "[data-testid^='conversation-turn-'], .agent-turn, [class~='group/turn-messages']",
    ),
  ).filter(isChatGptImageGenTurn);
  return candidates.filter((candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)));
}

function chatGptTurnIndex(node: Element): number | undefined {
  const turn = node.closest("[data-testid^='conversation-turn-']");
  const testId = turn?.getAttribute("data-testid") ?? "";
  const match = testId.match(/^conversation-turn-(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

async function payloadFromRoleElement(roleElement: Element, assetCollector?: ImageAssetCollector): Promise<RolePayload | undefined> {
  const role = roleElement.getAttribute("data-message-author-role");
  if (role !== "user" && role !== "assistant") {
    return undefined;
  }

  const clone = pickSourceRoot(roleElement, role).cloneNode(true) as Element;
  normalizeMath(clone);
  await normalizeMedia(clone, assetCollector);
  await normalizeStaticAttachments(clone, assetCollector);
  if (role === "user") {
    normalizeChatGptAttachmentPlaceholders(clone);
  }
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
}

async function payloadFromChatGptImageGenTurn(turn: Element, assetCollector?: ImageAssetCollector): Promise<RolePayload | undefined> {
  const sources = collectImageSources(turn);
  if (!sources.length) {
    return undefined;
  }

  const wrapper = document.createElement("div");
  const markdown: string[] = [];
  const text: string[] = [];
  for (const source of sources) {
    const asset = await assetCollector?.registerImageUrl(source.url, source.alt);
    const alt = source.alt || "generated image";
    const imageUrl = asset?.status === "ready" ? asset.local_path : source.url;
    const paragraph = document.createElement("p");
    const image = document.createElement("img");
    image.setAttribute("alt", alt);
    image.setAttribute("src", imageUrl);
    image.setAttribute("data-original-src", source.url);
    paragraph.append(image);
    wrapper.append(paragraph);
    markdown.push(`![${alt}](${imageUrl})`);
    text.push(`[Image: ${alt}]`);
  }

  const domHtml = cleanText(wrapper.innerHTML);
  return {
    role: "assistant",
    dom_html: domHtml,
    dom_markdown: markdown.join("\n\n"),
    dom_text: text.join("\n"),
  };
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
  root.querySelectorAll("script, style, noscript, textarea, svg").forEach((node) => node.remove());
  root.querySelectorAll("button").forEach((node) => {
    if (!node.querySelector("pre, code")) {
      node.remove();
    }
  });
  root.querySelectorAll(".sr-only").forEach((node) => {
    if (/^(ChatGPT said|Gemini said|Gemini 说|Claude said|Human said|You said)/i.test(getElementText(node))) {
      node.remove();
    }
  });
  root.querySelectorAll<Element>("*").forEach((node) => {
    if (node.childElementCount) {
      return;
    }
    const text = (node.textContent ?? "").trim();
    if (text && NOISE_TEXT_PATTERN.test(text)) {
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

async function extractRolePayloadRecords(root: ParentNode = document, assetCollector?: ImageAssetCollector): Promise<PayloadRecord[]> {
  const records: PayloadRecord[] = [];
  for (const roleElement of Array.from(root.querySelectorAll("[data-message-author-role]"))) {
    const payload = await payloadFromRoleElement(roleElement, assetCollector);
    if (payload) {
      records.push({ node: roleElement, payload, turnIndex: chatGptTurnIndex(roleElement) });
    }
  }

  for (const turn of chatGptImageGenTurns(root)) {
    const payload = await payloadFromChatGptImageGenTurn(turn, assetCollector);
    if (payload) {
      records.push({ node: turn, payload, turnIndex: chatGptTurnIndex(turn) });
    }
  }

  return records.sort((left, right) => compareDocumentOrder(left.node, right.node));
}

export async function extractRolePayloads(root: ParentNode = document, assetCollector?: ImageAssetCollector): Promise<RolePayload[]> {
  return (await extractRolePayloadRecords(root, assetCollector)).map((record) => record.payload);
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
  const indexByExactKey = new Map<string, number>();
  const exactKey = (role: Role, text: string): string => `${role} ${text}`;
  const replaceAt = (index: number, replacement: { role: Role; node: Element; text: string }): void => {
    const previous = compact[index];
    if (previous && previous !== replacement) {
      const previousKey = exactKey(previous.role, previous.text);
      if (indexByExactKey.get(previousKey) === index) {
        indexByExactKey.delete(previousKey);
      }
    }
    compact[index] = replacement;
    indexByExactKey.set(exactKey(replacement.role, replacement.text), index);
  };

  for (const record of records.sort((left, right) => compareDocumentOrder(left.node, right.node))) {
    let duplicateIndex = indexByExactKey.get(exactKey(record.role, record.text)) ?? -1;
    if (duplicateIndex === -1) {
      duplicateIndex = compact.findIndex((existing) => {
        if (existing.role !== record.role) {
          return false;
        }
        if (existing.node.contains(record.node) || record.node.contains(existing.node)) {
          return true;
        }
        const shorter = existing.text.length < record.text.length ? existing.text : record.text;
        const longer = existing.text.length < record.text.length ? record.text : existing.text;
        return shorter.length > 120 && longer.includes(shorter);
      });
    }
    if (duplicateIndex === -1) {
      indexByExactKey.set(exactKey(record.role, record.text), compact.length);
      compact.push(record);
      continue;
    }
    const existing = compact[duplicateIndex];
    if (existing.node.contains(record.node) && existing.node !== record.node) {
      replaceAt(duplicateIndex, record);
      continue;
    }
    if (!record.node.contains(existing.node)) {
      const existingSize = existing.node.querySelectorAll("*").length;
      const recordSize = record.node.querySelectorAll("*").length;
      if (recordSize < existingSize) {
        replaceAt(duplicateIndex, record);
      }
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

function imageMarkdownReferences(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll<HTMLImageElement>("img"))
    .map((image) => {
      const alt = cleanText(image.getAttribute("alt"));
      const src = image.getAttribute("src") ?? "";
      if (src) {
        return alt ? `![${alt}](${src})` : `![](${src})`;
      }
      return alt ? `[Image: ${alt}]` : "[Image]";
    })
    .filter(Boolean);
}

function appendImageMarkdown(markdown: string, root: ParentNode): string {
  const images = imageMarkdownReferences(root);
  if (!images.length) {
    return markdown;
  }
  const imageBlock = images.join("\n\n");
  return markdown ? `${markdown}\n\n${imageBlock}` : imageBlock;
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

export async function extractGeminiRolePayloads(root: ParentNode = document, assetCollector?: ImageAssetCollector): Promise<RolePayload[]> {
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

  const payloads: RolePayload[] = [];
  for (const record of compactRecords(records)) {
    const sourceNode = record.role === "user" ? record.node.querySelector(".query-text") ?? record.node : record.node;
    const clone = sourceNode.cloneNode(true) as Element;
    await normalizeMedia(clone, assetCollector);
    await normalizeStaticAttachments(clone, assetCollector);
    normalizeCodeBlocks(clone);
    removeGeminiNoise(clone);
    const domMarkdown =
      record.role === "user"
        ? appendImageMarkdown(markdownFromGeminiUserNode(record.node), clone)
        : convertHtmlToMarkdown(cleanText(clone.innerHTML || clone.outerHTML));
    const domHtml = cleanText(clone.innerHTML || clone.outerHTML);
    payloads.push({
      role: record.role,
      dom_markdown: domMarkdown,
      dom_html: domHtml,
      dom_text: record.role === "user" ? domMarkdown : getElementText(clone),
    });
  }
  return payloads;
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

export async function extractClaudeRolePayloads(root: ParentNode = document, assetCollector?: ImageAssetCollector): Promise<RolePayload[]> {
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

  const payloads: RolePayload[] = [];
  for (const record of compactRecords(records)) {
    const clone = record.node.cloneNode(true) as Element;
    await normalizeMedia(clone, assetCollector);
    await normalizeStaticAttachments(clone, assetCollector);
    normalizeClaudeSpecialBlocks(clone);
    normalizeCodeBlocks(clone);
    removeClaudeNoise(clone);
    const domHtml = cleanText(clone.innerHTML || clone.outerHTML);
    payloads.push({
      role: record.role,
      dom_markdown: convertHtmlToMarkdown(domHtml),
      dom_html: domHtml,
      dom_text: getElementText(clone),
    });
  }
  return payloads;
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

function scrollTopOf(container: HTMLElement | Window): number {
  return container === window ? window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0 : (container as HTMLElement).scrollTop;
}

function scrollHeightOf(container: HTMLElement | Window): number {
  return container === window ? Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) : (container as HTMLElement).scrollHeight;
}

function clientHeightOf(container: HTMLElement | Window): number {
  return container === window ? window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight || 0 : (container as HTMLElement).clientHeight;
}

function scrollToPosition(container: HTMLElement | Window, position: number): void {
  if (container === window) {
    window.scrollTo(0, position);
    return;
  }
  (container as HTMLElement).scrollTop = position;
}

function chatGptConversationTurnElements(root: ParentNode = document): Array<{ node: HTMLElement; index: number }> {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-testid^='conversation-turn-']"))
    .map((node) => {
      const match = (node.getAttribute("data-testid") ?? "").match(/^conversation-turn-(\d+)$/);
      return match ? { node, index: Number(match[1]) } : undefined;
    })
    .filter((turn): turn is { node: HTMLElement; index: number } => Boolean(turn))
    .sort((left, right) => left.index - right.index);
}

function scrollTurnIntoView(turn: HTMLElement): void {
  if (typeof turn.scrollIntoView === "function") {
    turn.scrollIntoView({ block: "center" });
  }
}

function payloadHash(payload: RolePayload): string {
  const value = cleanText(payload.dom_markdown || payload.dom_text || payload.dom_html).replace(/\s+/g, " ");
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

interface HarvestedPayloadRecord extends PayloadRecord {
  firstSeenSequence: number;
}

function compareHarvestedRecords(left: HarvestedPayloadRecord, right: HarvestedPayloadRecord): number {
  const leftTurn = left.turnIndex ?? Number.MAX_SAFE_INTEGER;
  const rightTurn = right.turnIndex ?? Number.MAX_SAFE_INTEGER;
  if (leftTurn !== rightTurn) {
    return leftTurn - rightTurn;
  }
  return left.firstSeenSequence - right.firstSeenSequence;
}

export async function harvestChatGptPayloads(
  assetCollector: ImageAssetCollector,
  options: { delayMs?: number; maxSamples?: number; viewportStepRatio?: number } = {},
): Promise<{ payloads: RolePayload[]; debug: ScrollDebug }> {
  const delayMs = options.delayMs ?? 250;
  const viewportStepRatio = options.viewportStepRatio ?? 0.85;
  const container = findScrollContainer("chatgpt");
  const isWindow = container === window;
  const initialScrollTop = scrollTopOf(container);
  const initialTurnCount = turnCount("chatgpt");
  const harvested = new Map<string, HarvestedPayloadRecord>();
  const harvestPositions: number[] = [];
  let firstSeenSequence = 0;
  let dedupedMessages = 0;

  const sample = async (root: ParentNode = document): Promise<void> => {
    harvestPositions.push(Math.round(scrollTopOf(container)));
    const records = await extractRolePayloadRecords(root, assetCollector);
    for (const record of records) {
      const key = `${record.turnIndex ?? "unknown"}:${record.payload.role}:${payloadHash(record.payload)}`;
      if (harvested.has(key)) {
        dedupedMessages += 1;
        continue;
      }
      harvested.set(key, { ...record, firstSeenSequence });
      firstSeenSequence += 1;
    }
  };

  const turns = chatGptConversationTurnElements();
  const visitedTurnIndices: number[] = [];
  let harvestStrategy = "turn-anchor";
  let coverageReachedBottom = false;

  if (turns.length > 0) {
    await sample();
    for (const turn of turns) {
      const currentTurn = document.querySelector<HTMLElement>(`[data-testid='conversation-turn-${turn.index}']`);
      if (!currentTurn) {
        continue;
      }
      visitedTurnIndices.push(turn.index);
      scrollTurnIntoView(currentTurn);
      await wait(delayMs);
      await sample(currentTurn);
    }
    coverageReachedBottom = visitedTurnIndices.length === turns.length;
  } else {
    harvestStrategy = "adaptive-scroll";
    await sample();
    scrollToPosition(container, 0);
    await wait(delayMs);
    await sample();

    const maxScrollTop = Math.max(0, scrollHeightOf(container) - clientHeightOf(container));
    const step = Math.max(300, Math.floor(clientHeightOf(container) * viewportStepRatio) || 300);
    const positions = new Set<number>([0, maxScrollTop]);
    for (let position = step; position < maxScrollTop; position += step) {
      positions.add(position);
    }
    for (const position of [...positions].sort((left, right) => left - right)) {
      scrollToPosition(container, position);
      await wait(delayMs);
      await sample();
    }
    coverageReachedBottom = harvestPositions.some((position) => Math.abs(position - maxScrollTop) <= 2);
  }

  scrollToPosition(container, initialScrollTop);
  await wait(delayMs);

  const payloads = [...harvested.values()].sort(compareHarvestedRecords).map((record) => record.payload);
  const harvestedTurnIndices = new Set([...harvested.values()].map((record) => record.turnIndex).filter((index): index is number => typeof index === "number"));
  const missingTurnIndices = visitedTurnIndices.filter((index) => !harvestedTurnIndices.has(index));
  return {
    payloads,
    debug: {
      attempts: harvestPositions.length,
      stable_rounds: 0,
      initial_turn_count: initialTurnCount,
      final_turn_count: turnCount("chatgpt"),
      transport: isWindow ? "window" : "container",
      harvest_strategy: harvestStrategy,
      turn_placeholders: document.querySelectorAll("[data-testid^='conversation-turn-']").length,
      mounted_role_nodes: document.querySelectorAll("[data-message-author-role]").length,
      harvested_messages: payloads.length,
      harvest_positions: harvestPositions,
      deduped_messages: dedupedMessages,
      visited_turn_count: visitedTurnIndices.length,
      visited_turn_indices: visitedTurnIndices,
      missing_turn_indices: missingTurnIndices,
      coverage_reached_bottom: coverageReachedBottom,
      initial_scroll_top: Math.round(initialScrollTop),
      restored_scroll_top: Math.round(scrollTopOf(container)),
      scroll_height: scrollHeightOf(container),
      client_height: clientHeightOf(container),
    },
  };
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
