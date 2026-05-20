import { describe, expect, it } from "vitest";

import { buildExportBundle } from "../src/shared/exportBundle";
import {
  EXPORTER_VERSION,
  FORMAT_VERSION,
  type ChatMessage,
  type ConversationExport,
  type ExportAsset,
  type ExportFile,
} from "../src/shared/types";

function makeMessage(): ChatMessage {
  return {
    id: "assistant-0001",
    role: "assistant",
    clipboard_text: "",
    clipboard_html: "",
    dom_markdown: "Hello!",
    dom_html: "<p>Hello!</p>",
    dom_text: "Hello!",
    final_markdown: "Hello!",
    selected_source: "dom_markdown",
    feature_flags: {
      has_code_block: false,
      has_inline_code: false,
      has_table: false,
      has_link: false,
      has_list: false,
      has_math: false,
      has_blockquote: false,
      link_count: 0,
      table_count: 0,
      code_block_count: 0,
      text_length: 6,
    },
    quality_score: 1,
    candidate_scores: {},
  };
}

function makeAsset(): ExportAsset {
  return {
    id: "image-001",
    kind: "image",
    original_url: "https://example.com/pic.png",
    download_url: "https://example.com/pic.png",
    local_path: "./chatgpt__Demo__demo_assets/001__pic.png",
    filename: "chatgpt__Demo__demo_assets/001__pic.png",
    alt: "demo",
    mime_type: "image/png",
    status: "ready",
  };
}

function makeConversation(): ConversationExport {
  return {
    service: "chatgpt",
    format_version: FORMAT_VERSION,
    exporter_version: EXPORTER_VERSION,
    conversation_id: "demo",
    title: "Demo",
    title_source: "document_title",
    url: "https://chatgpt.com/c/demo",
    exported_at: "2026-05-21T00:00:00Z",
    message_count: 1,
    scroll_debug: {},
    assets: [makeAsset()],
    messages: [makeMessage()],
  };
}

function filenames(files: ExportFile[]): string[] {
  return files.map((file) => file.filename);
}

describe("buildExportBundle format selection", () => {
  it("defaults to Markdown only when formats are omitted", () => {
    const bundle = buildExportBundle(makeConversation());
    expect(filenames(bundle.files)).toEqual([
      "chatgpt__Demo__demo.md",
      "chatgpt__Demo__demo_assets/001__pic.png",
    ]);
  });

  it("emits Markdown and JSON when both formats are requested", () => {
    const bundle = buildExportBundle(makeConversation(), ["markdown", "json"]);
    expect(filenames(bundle.files)).toEqual([
      "chatgpt__Demo__demo.md",
      "chatgpt__Demo__demo.json",
      "chatgpt__Demo__demo_assets/001__pic.png",
    ]);
  });

  it("emits only JSON when Markdown is unchecked", () => {
    const bundle = buildExportBundle(makeConversation(), ["json"]);
    expect(filenames(bundle.files)).toEqual([
      "chatgpt__Demo__demo.json",
      "chatgpt__Demo__demo_assets/001__pic.png",
    ]);
  });

  it("returns only asset files when formats is an empty array", () => {
    const bundle = buildExportBundle(makeConversation(), []);
    expect(filenames(bundle.files)).toEqual([
      "chatgpt__Demo__demo_assets/001__pic.png",
    ]);
  });

  it("still emits the Markdown text body, not a placeholder", () => {
    const bundle = buildExportBundle(makeConversation(), ["markdown"]);
    const markdown = bundle.files.find((file) => file.filename.endsWith(".md"));
    expect(markdown?.kind).toBe("text");
    if (markdown?.kind === "text") {
      expect(markdown.content).toContain("Hello!");
    }
  });
});
