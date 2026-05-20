import { ImageAssetCollector } from "../../shared/assets";
import { convertHtmlToMarkdown } from "../../shared/markdown";
import type { Role } from "../../shared/types";
import {
  addRecord,
  cleanText,
  compactRecords,
  getElementText,
  nodeText,
  normalizeCodeBlocks,
  normalizeMedia,
  normalizeStaticAttachments,
  removeNoise,
  type RolePayload,
} from "./shared";

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
