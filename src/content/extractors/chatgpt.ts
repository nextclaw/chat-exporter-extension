import { ImageAssetCollector } from "../../shared/assets";
import { convertHtmlToMarkdown } from "../../shared/markdown";
import type { Role } from "../../shared/types";
import {
  cleanText,
  clientHeightOf,
  collectImageSources,
  compareDocumentOrder,
  findScrollContainer,
  getElementText,
  hasDescendantClass,
  normalizeCodeBlocks,
  normalizeMath,
  normalizeMedia,
  normalizeStaticAttachments,
  payloadHash,
  removeNoise,
  scrollHeightOf,
  scrollToPosition,
  scrollTopOf,
  turnCount,
  wait,
  type PayloadRecord,
  type RolePayload,
  type ScrollDebug,
} from "./shared";

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

export async function extractRolePayloadRecords(root: ParentNode = document, assetCollector?: ImageAssetCollector): Promise<PayloadRecord[]> {
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
