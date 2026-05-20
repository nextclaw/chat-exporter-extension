import { ImageAssetCollector } from "../../shared/assets";
import { convertHtmlToMarkdown } from "../../shared/markdown";
import type { Role } from "../../shared/types";
import {
  addRecord,
  cleanText,
  compactRecords,
  getElementText,
  normalizeCodeBlocks,
  normalizeMedia,
  normalizeStaticAttachments,
  removeNoise,
  type RolePayload,
} from "./shared";

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
