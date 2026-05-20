import { ImageAssetCollector } from "../../shared/assets";
import type { Role, Service } from "../../shared/types";

export interface RolePayload {
  role: Role;
  dom_html: string;
  dom_markdown: string;
  dom_text: string;
}

export interface ImageSource {
  url: string;
  alt: string;
}

export interface PayloadRecord {
  node: Element;
  payload: RolePayload;
  turnIndex?: number;
}

export const NOISE_TEXT_PATTERN =
  /^(Thought for|Reasoned for|Searching the web|Finished thinking|Searching|Open in canvas)$/i;
export const NON_LANGUAGE_PATTERN =
  /^(Copy|Edit|Run|Download|Good response|Bad response|Retry|Open in canvas)$/i;
export const DOWNLOADABLE_ATTACHMENT_EXTENSIONS = new Set([
  "csv",
  "doc",
  "docx",
  "html",
  "json",
  "md",
  "pdf",
  "ppt",
  "pptx",
  "txt",
  "xls",
  "xlsx",
  "xml",
  "zip",
]);

export function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\u00a0/g, " ").replace(/\s+\n/g, "\n").trim();
}

export function getElementText(element: Element): string {
  const innerText = (element as HTMLElement).innerText;
  if (innerText) {
    return cleanText(innerText);
  }
  return cleanText(nodeText(element));
}

export function nodeText(node: Node): string {
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

export function normalizeMath(root: ParentNode): void {
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

export async function normalizeMedia(root: ParentNode, assetCollector?: ImageAssetCollector): Promise<void> {
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

export function imageUrlFromElement(image: HTMLImageElement): string {
  return image.currentSrc || image.getAttribute("src") || "";
}

export function imageUrlLooksDownloadable(url: string): boolean {
  return /^(?:https?:|blob:|data:image\/)/i.test(url);
}

export function urlLooksLikeImage(url: string): boolean {
  return (
    imageUrlLooksDownloadable(url) &&
    (/\/backend-api\/estuary\/content\b/i.test(url) || /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(url) || /^data:image\//i.test(url))
  );
}

function firstSrcsetUrl(srcset: string | null | undefined): string {
  return cleanText(srcset).split(",")[0]?.trim().split(/\s+/)[0] ?? "";
}

export function collectImageSources(root: ParentNode): ImageSource[] {
  const sources = new Map<string, ImageSource>();
  const remember = (url: string, alt: string): void => {
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

export async function normalizeStaticAttachments(root: ParentNode, assetCollector?: ImageAssetCollector): Promise<void> {
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

export function hasDescendantClass(root: ParentNode, className: string): boolean {
  const elements = root instanceof Element ? [root, ...Array.from(root.querySelectorAll("*"))] : Array.from(root.querySelectorAll("*"));
  return elements.some((element) => element.classList.contains(className));
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

export function normalizeCodeBlocks(root: ParentNode): void {
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

export function removeNoise(root: ParentNode): void {
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

export function addRecord(
  records: Array<{ role: Role; node: Element; text: string }>,
  role: Role,
  node: Element | null,
): void {
  if (!node) {
    return;
  }
  const text = getElementText(node).replace(/\s+/g, " ").trim();
  if (!text || text.length < 2 || /^(Gemini|Gemini 说|Gemini said|Claude|Human|You|Show thinking|显示思路)$/i.test(text)) {
    return;
  }
  records.push({ role, node, text });
}

export function compareDocumentOrder(left: Element, right: Element): number {
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

export function compactRecords(
  records: Array<{ role: Role; node: Element; text: string }>,
): Array<{ role: Role; node: Element; text: string }> {
  const compact: Array<{ role: Role; node: Element; text: string }> = [];
  const indexByExactKey = new Map<string, number>();
  const exactKey = (role: Role, text: string): string => `${role} ${text}`;
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

export function findScrollContainer(service: Service): HTMLElement | Window {
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

export function turnCount(service: Service): number {
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

export function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function scrollTopOf(container: HTMLElement | Window): number {
  return container === window
    ? window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
    : (container as HTMLElement).scrollTop;
}

export function scrollHeightOf(container: HTMLElement | Window): number {
  return container === window
    ? Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
    : (container as HTMLElement).scrollHeight;
}

export function clientHeightOf(container: HTMLElement | Window): number {
  return container === window
    ? window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight || 0
    : (container as HTMLElement).clientHeight;
}

export function scrollToPosition(container: HTMLElement | Window, position: number): void {
  if (container === window) {
    window.scrollTo(0, position);
    return;
  }
  (container as HTMLElement).scrollTop = position;
}

export function payloadHash(payload: RolePayload): string {
  const value = cleanText(payload.dom_markdown || payload.dom_text || payload.dom_html).replace(/\s+/g, " ");
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export interface ScrollDebug {
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
