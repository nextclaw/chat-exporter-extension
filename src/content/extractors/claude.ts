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

function claudeArtifactLabel(card: Element): string {
  // Title via the View / Download overlay button aria-label — semantic and stable,
  // unlike the Tailwind utility classes around the title text.
  const labelled = card.querySelector("button[aria-label^='View '], button[aria-label^='Download ']");
  let title = cleanText(labelled?.getAttribute("aria-label")).replace(/^(?:View|Download)\s+/i, "");
  if (!title) {
    title = getElementText(card).split("\n").map((line) => line.trim()).filter(Boolean)[0] ?? "";
  }
  title = title.slice(0, 120);
  // Type line looks like "Document · MD"; use the middot as the heuristic and skip
  // the title line and the "Download" button label.
  const typeLine = getElementText(card)
    .split("\n")
    .map((line) => cleanText(line))
    .find((line) => line.includes("·") && line !== title);
  return typeLine ? `${title} (${typeLine.replace(/\s*·\s*/g, " · ")})` : title;
}

function normalizeClaudeSpecialBlocks(root: ParentNode): void {
  root.querySelectorAll("[class~='group/artifact-block'], [data-testid*='artifact' i], .artifact, [data-testid*='attachment' i], .attachment").forEach((node) => {
    const replacement = document.createElement("p");
    const label = claudeArtifactLabel(node);
    replacement.textContent = label ? `[Attachment: ${label}]` : "[Attachment]";
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
