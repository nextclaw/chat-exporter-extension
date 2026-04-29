import type { CandidateScore, ChatMessage, ConversationExport, FeatureFlags } from "./types";
import { SITE_LABEL } from "./types";

const NOISE_PATTERNS = [
  /\bCopy\b/i,
  /\bRegenerate\b/i,
  /\bChatGPT said\b/i,
  /\bThought for\b/i,
  /\bGood response\b/i,
  /\bBad response\b/i,
  /\bRead aloud\b/i,
  /\bShare\b/i,
  /\bEdit\b/i,
  /\bRetry\b/i,
];

export function normalizeMarkdownText(text: string | undefined): string {
  const content = (text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/```([^\n`]*)\n([\s\S]*?)\n\n```/g, "```$1\n$2\n```");
  return content.trim();
}

export function normalizeUserMarkdownText(text: string | undefined): string {
  let content = normalizeMarkdownText(text);
  if (!content) {
    return "";
  }

  const lines = content.split("\n");
  while (lines.length > 0 && ["You said", "User said", "Human said", "你说"].includes(lines[0].trim())) {
    lines.shift();
    while (lines.length > 0 && !lines[0].trim()) {
      lines.shift();
    }
  }

  content = lines.join("\n");
  content = content.replace(/^ {1,3}(?=(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|```|>|---\s*$))/gm, "");
  return normalizeMarkdownText(content);
}

export function sanitizeHtmlFragment(html: string | undefined): string {
  if (!html?.trim()) {
    return "";
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  const root = template.content;
  root.querySelectorAll("script, style, noscript, textarea, svg, button").forEach((node) => node.remove());
  root.querySelectorAll(".sr-only, [aria-hidden='true']").forEach((node) => node.remove());
  return Array.from(root.childNodes)
    .map((node) => serializeNode(node))
    .join("")
    .trim();
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }
  return (node as Element).outerHTML;
}

function visibleText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }
  const element = node as Element;
  return Array.from(element.childNodes).map(visibleText).join("");
}

function collapseInline(text: string): string {
  return text.replace(/[ \t\n]+/g, " ").trim();
}

function renderChildren(element: Element): string {
  return Array.from(element.childNodes).map(renderNode).join("");
}

function renderBlockChildren(element: Element): string {
  return normalizeMarkdownText(renderChildren(element));
}

function renderListItem(element: Element, marker: string): string {
  const body = renderBlockChildren(element);
  if (!body) {
    return "";
  }
  const lines = body.split("\n");
  const [first = "", ...rest] = lines;
  const continuation = rest.map((line) => (line ? `  ${line}` : "")).join("\n");
  return continuation ? `${marker} ${first}\n${continuation}` : `${marker} ${first}`;
}

function renderTable(element: Element): string {
  const rows = Array.from(element.querySelectorAll("tr")).map((row) =>
    Array.from(row.querySelectorAll("th, td")).map((cell) => collapseInline(visibleText(cell))),
  );
  if (!rows.length || rows[0].length === 0) {
    return "";
  }
  const header = rows[0];
  const separator = header.map(() => "---");
  const bodyRows = rows.slice(1);
  const renderRow = (row: string[]): string =>
    `| ${header.map((_, index) => row[index] ?? "").join(" | ")} |`;
  return [renderRow(header), renderRow(separator), ...bodyRows.map(renderRow)].join("\n");
}

function codeFence(language: string, body: string): string {
  const safeLanguage = /^[A-Za-z0-9.+#-]{1,24}$/.test(language) ? language : "";
  return `\n\`\`\`${safeLanguage}\n${body.replace(/\n+$/g, "")}\n\`\`\`\n\n`;
}

function renderNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node as Element;
  const tagName = element.tagName.toLowerCase();

  if (tagName === "br") {
    return "\n";
  }
  if (tagName === "pre") {
    const code = element.querySelector("code");
    const className = code?.getAttribute("class") ?? "";
    const language = className.match(/language-([A-Za-z0-9.+#-]+)/)?.[1] ?? "";
    return codeFence(language, code?.textContent ?? element.textContent ?? "");
  }
  if (tagName === "code") {
    const body = element.textContent ?? "";
    const tick = body.includes("`") ? "``" : "`";
    return `${tick}${body}${tick}`;
  }
  if (/^h[1-6]$/.test(tagName)) {
    const level = Number(tagName.slice(1));
    return `\n${"#".repeat(level)} ${collapseInline(renderChildren(element))}\n\n`;
  }
  if (["p", "div", "section", "article", "main"].includes(tagName)) {
    const body = renderBlockChildren(element);
    return body ? `${body}\n\n` : "";
  }
  if (tagName === "blockquote") {
    const body = renderBlockChildren(element);
    return body ? `${body.split("\n").map((line) => `> ${line}`.trimEnd()).join("\n")}\n\n` : "";
  }
  if (tagName === "strong" || tagName === "b") {
    const body = collapseInline(renderChildren(element));
    return body ? `**${body}**` : "";
  }
  if (tagName === "em" || tagName === "i") {
    const body = collapseInline(renderChildren(element));
    return body ? `*${body}*` : "";
  }
  if (tagName === "a") {
    const body = collapseInline(renderChildren(element)) || element.getAttribute("href") || "";
    const href = element.getAttribute("href");
    if (!href) {
      return body;
    }
    const imageLabel = body.match(/^\[(Image(?:: [^\]]+)?)\]$/);
    return imageLabel ? `[${imageLabel[1]}](${href})` : `[${body}](${href})`;
  }
  if (tagName === "ul") {
    const items = Array.from(element.children)
      .filter((child) => child.tagName.toLowerCase() === "li")
      .map((child) => renderListItem(child, "-"))
      .filter(Boolean);
    return items.length ? `${items.join("\n")}\n\n` : "";
  }
  if (tagName === "ol") {
    const items = Array.from(element.children)
      .filter((child) => child.tagName.toLowerCase() === "li")
      .map((child, index) => renderListItem(child, `${index + 1}.`))
      .filter(Boolean);
    return items.length ? `${items.join("\n")}\n\n` : "";
  }
  if (tagName === "li") {
    return renderListItem(element, "-");
  }
  if (tagName === "table") {
    const table = renderTable(element);
    return table ? `\n${table}\n\n` : "";
  }
  if (tagName === "img") {
    const alt = element.getAttribute("alt")?.trim();
    const src = element.getAttribute("src")?.trim();
    if (src) {
      return alt ? `![${alt}](${src})` : `![](${src})`;
    }
    return alt ? `[Image: ${alt}]` : "[Image]";
  }

  return renderChildren(element);
}

export function convertHtmlToMarkdown(html: string | undefined): string {
  const content = sanitizeHtmlFragment(html);
  if (!content) {
    return "";
  }
  const template = document.createElement("template");
  template.innerHTML = content;
  return normalizeMarkdownText(Array.from(template.content.childNodes).map(renderNode).join(""));
}

export function extractFeatureFlags(domHtml: string | undefined, domText = ""): FeatureFlags {
  const html = domHtml ?? "";
  const text = domText.trim();
  return {
    has_code_block: /<pre\b/i.test(html),
    has_inline_code: /<code\b/i.test(html),
    has_table: /<table\b/i.test(html),
    has_link: /<a\b/i.test(html),
    has_list: /<(?:ul|ol|li)\b/i.test(html),
    has_math: /data-math|class=(?:"|')[^"']*(?:math|katex)/i.test(html) || /\${1,2}[^$]+\${1,2}/.test(text),
    has_blockquote: /<blockquote\b/i.test(html),
    link_count: (html.match(/<a\b/gi) ?? []).length,
    table_count: (html.match(/<table\b/gi) ?? []).length,
    code_block_count: (html.match(/<pre\b/gi) ?? []).length,
    text_length: text.length,
  };
}

function markdownSignature(markdown: string): Record<string, number | boolean> {
  const content = normalizeMarkdownText(markdown);
  return {
    has_code_block: /(^|\n)```/.test(content),
    has_table: /^\|.+\|\s*$/m.test(content) && /^\|(?:\s*:?-+:?\s*\|)+\s*$/m.test(content),
    has_link: /\[[^\]]+\]\(([^)]+)\)/.test(content),
    has_list: /^(?: {0,6}[-*+]\s| {0,6}\d+\.\s)/m.test(content),
    has_math: /(?<!\\)\$\$?[^$]+\$\$?/.test(content) || /\\\((.*?)\\\)|\\\[(.*?)\\\]/.test(content),
    has_blockquote: /^>\s/m.test(content),
    html_tag_count: (content.match(/<[A-Za-z/][^>]*>/g) ?? []).length,
    noise_hits: NOISE_PATTERNS.reduce((count, pattern) => count + (pattern.test(content) ? 1 : 0), 0),
    length: content.length,
  };
}

function scoreMarkdownCandidate(
  markdown: string,
  featureFlags: FeatureFlags,
  sourceName: string,
  role: string,
  domText = "",
): CandidateScore {
  const content = normalizeMarkdownText(markdown);
  const reasons: string[] = [];
  if (!content) {
    return { score: -100, reasons: ["empty"] };
  }

  if (role !== "assistant") {
    let score = 1;
    if (featureFlags.text_length && content.length >= Math.max(1, Math.floor(featureFlags.text_length * 0.7))) {
      score += 1;
      reasons.push("user_text_length_ok");
    }
    return { score, reasons: reasons.length ? reasons : ["user_text"] };
  }

  const signature = markdownSignature(content);
  let score = 0;
  const expectedPairs: Array<[keyof FeatureFlags, number, number]> = [
    ["has_code_block", 6, -8],
    ["has_table", 5, -7],
    ["has_link", 4, -6],
    ["has_list", 2.5, -2.5],
    ["has_math", 4, -5],
    ["has_blockquote", 1.5, -1.5],
  ];

  for (const [key, hitReward, missPenalty] of expectedPairs) {
    const expected = Boolean(featureFlags[key]);
    const seen = Boolean(signature[key]);
    if (expected && seen) {
      score += hitReward;
      reasons.push(`${key}:matched`);
    } else if (expected && !seen) {
      score += missPenalty;
      reasons.push(`${key}:missing`);
    } else if (seen) {
      score += 0.5;
      reasons.push(`${key}:extra`);
    }
  }

  const domLength = featureFlags.text_length || domText.trim().length;
  if (domLength) {
    const ratio = content.length / Math.max(domLength, 1);
    if (ratio >= 0.9) {
      score += 2.5;
      reasons.push("length:full");
    } else if (ratio >= 0.65) {
      score += 1;
      reasons.push("length:ok");
    } else if (ratio < 0.45) {
      score -= 4;
      reasons.push("length:short");
    }
  }

  const noiseHits = Number(signature.noise_hits);
  if (noiseHits) {
    score -= 2.5 * noiseHits;
    reasons.push(`noise:${noiseHits}`);
  }

  const htmlTagCount = Number(signature.html_tag_count);
  if (htmlTagCount) {
    score -= Math.min(3, htmlTagCount * 0.5);
    reasons.push("raw_html_leftover");
  }

  const sourceBias: Record<string, number> = {
    clipboard_text: 1.2,
    clipboard_html: 0.9,
    dom_markdown: 0.7,
    dom_html: 0.6,
    dom_text: -1.5,
  };
  score += sourceBias[sourceName] ?? 0;
  reasons.push(`source:${sourceName}`);

  return { score: Number(score.toFixed(3)), reasons };
}

function buildMarkdownCandidates(message: Partial<ChatMessage>): Record<string, string> {
  const normalizer = message.role === "user" ? normalizeUserMarkdownText : normalizeMarkdownText;
  const candidates: Record<string, string> = {};

  if (message.clipboard_text) {
    candidates.clipboard_text = normalizer(message.clipboard_text);
  }
  if (message.clipboard_html) {
    const converted = convertHtmlToMarkdown(message.clipboard_html);
    if (converted) {
      candidates.clipboard_html = normalizer(converted);
    }
  }
  if (message.dom_markdown) {
    candidates.dom_markdown = normalizer(message.dom_markdown);
  }
  if (message.dom_html) {
    const converted = convertHtmlToMarkdown(message.dom_html);
    if (converted) {
      candidates.dom_html = normalizer(converted);
    }
  }
  if (message.dom_text) {
    candidates.dom_text = normalizer(message.dom_text);
  }

  return Object.fromEntries(Object.entries(candidates).filter(([, value]) => Boolean(value)));
}

export function enrichMessage(message: Omit<ChatMessage, "feature_flags" | "final_markdown" | "selected_source" | "quality_score" | "candidate_scores">): ChatMessage {
  const featureFlags = extractFeatureFlags(message.dom_html, message.dom_text);
  const candidates = buildMarkdownCandidates({ ...message, feature_flags: featureFlags });
  const candidateScores: Record<string, CandidateScore> = {};
  let bestName = "";
  let bestMarkdown = "";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const [name, candidate] of Object.entries(candidates)) {
    const score = scoreMarkdownCandidate(candidate, featureFlags, name, message.role, message.dom_text);
    candidateScores[name] = score;
    if (score.score > bestScore) {
      bestName = name;
      bestMarkdown = candidate;
      bestScore = score.score;
    }
  }

  if (!bestName && message.dom_text) {
    bestName = "dom_text";
    bestMarkdown = message.dom_text;
    bestScore = -1.5;
    candidateScores.dom_text = { score: bestScore, reasons: ["fallback"] };
  }

  return {
    ...message,
    feature_flags: featureFlags,
    final_markdown: message.role === "user" ? normalizeUserMarkdownText(bestMarkdown) : normalizeMarkdownText(bestMarkdown),
    selected_source: bestName || "missing",
    quality_score: Number(bestScore.toFixed(3)),
    candidate_scores: candidateScores,
  };
}

function quoteMarkdownBlock(text: string): string {
  const content = normalizeMarkdownText(text);
  if (!content) {
    return "> ";
  }
  return content
    .split("\n")
    .map((line) => (line ? `> ${line}` : "> "))
    .join("\n");
}

function jsonString(value: string): string {
  return JSON.stringify(value);
}

export function renderConversationMarkdown(conversation: ConversationExport): string {
  const title = conversation.title.trim() || `${SITE_LABEL} Conversation`;
  const renderedMessages: Array<{ role: string; content: string }> = [];
  let previousSignature = "";

  for (const message of conversation.messages) {
    const content = normalizeMarkdownText(message.final_markdown);
    if (!content || !["user", "assistant"].includes(message.role)) {
      continue;
    }
    const signature = `${message.role}\u0000${content}`;
    if (signature === previousSignature) {
      continue;
    }
    previousSignature = signature;
    renderedMessages.push({ role: message.role, content });
  }

  let turnCount = 0;
  let currentTurnOpen = false;
  for (const message of renderedMessages) {
    if (message.role === "user" || !currentTurnOpen) {
      turnCount += 1;
      currentTurnOpen = true;
    }
  }

  const parts = [
    "---",
    `title: ${jsonString(title)}`,
    `source: ${jsonString(conversation.url)}`,
    `exported: ${jsonString(conversation.exported_at)}`,
    `messages: ${renderedMessages.length}`,
    `turns: ${turnCount}`,
    `source_messages: ${conversation.messages.length}`,
    "---",
    "",
    `# ${title}`,
    "",
  ];

  let turnIndex = 0;
  currentTurnOpen = false;
  for (const message of renderedMessages) {
    if (message.role === "user") {
      turnIndex += 1;
      currentTurnOpen = true;
      parts.push("---", "", `## Turn ${turnIndex}`, "", "### User", "", quoteMarkdownBlock(message.content), "");
      continue;
    }

    if (!currentTurnOpen) {
      turnIndex += 1;
      currentTurnOpen = true;
      parts.push("---", "", `## Turn ${turnIndex}`, "");
    }
    parts.push(`### ${SITE_LABEL}`, "", message.content, "");
  }

  return `${parts.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
