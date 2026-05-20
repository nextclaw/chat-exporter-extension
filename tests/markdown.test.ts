import { describe, expect, it } from "vitest";

import { buildExportBundle } from "../src/shared/exportBundle";
import { buildOutputBaseName, sanitizeFilenamePart } from "../src/shared/filename";
import { convertHtmlToMarkdown, enrichMessage, renderConversationMarkdown } from "../src/shared/markdown";
import { EXPORTER_VERSION, FORMAT_VERSION, type ConversationExport } from "../src/shared/types";

describe("markdown conversion", () => {
  it("keeps headings, lists, links, code blocks, and tables", () => {
    const markdown = convertHtmlToMarkdown(`
      <h2>Plan</h2>
      <p>See <a href="https://example.com">docs</a>.</p>
      <ul><li>One</li><li>Two</li></ul>
      <pre><code class="language-ts">const ok = true;</code></pre>
      <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
    `);

    expect(markdown).toContain("## Plan");
    expect(markdown).toContain("[docs](https://example.com)");
    expect(markdown).toContain("- One");
    expect(markdown).toContain("```ts");
    expect(markdown).toContain("| A | B |");
  });

  it("enriches DOM-only messages with feature flags and source scoring", () => {
    const message = enrichMessage({
      id: "assistant-0001",
      role: "assistant",
      clipboard_text: "",
      clipboard_html: "",
      dom_markdown: "",
      dom_html: "<p>Use <code>npm test</code>.</p>",
      dom_text: "Use npm test.",
    });

    expect(message.final_markdown).toContain("`npm test`");
    expect(message.selected_source).toBe("dom_html");
    expect(message.feature_flags.has_inline_code).toBe(true);
  });
});

describe("conversation rendering", () => {
  it("builds compatible filenames and output files", () => {
    const conversation: ConversationExport = {
      service: "chatgpt",
      format_version: FORMAT_VERSION,
      exporter_version: EXPORTER_VERSION,
      conversation_id: "abc-123",
      title: "Fixture Chat",
      title_source: "document_title",
      url: "https://chatgpt.com/c/abc-123",
      exported_at: "2026-04-29T00:00:00+00:00",
      message_count: 2,
      scroll_debug: {},
      assets: [],
      messages: [
        enrichMessage({
          id: "user-0000",
          role: "user",
          clipboard_text: "",
          clipboard_html: "",
          dom_markdown: "Hello",
          dom_html: "<p>Hello</p>",
          dom_text: "Hello",
        }),
        enrichMessage({
          id: "assistant-0001",
          role: "assistant",
          clipboard_text: "",
          clipboard_html: "",
          dom_markdown: "Hi",
          dom_html: "<p>Hi</p>",
          dom_text: "Hi",
        }),
      ],
    };

    expect(buildOutputBaseName(conversation)).toBe("chatgpt__Fixture_Chat__abc-123");
    expect(renderConversationMarkdown(conversation)).toContain("### ChatGPT");
    const bundle = buildExportBundle(conversation);
    expect(bundle.files.map((file) => file.filename)).toEqual([
      "chatgpt__Fixture_Chat__abc-123.json",
      "chatgpt__Fixture_Chat__abc-123.md",
    ]);
  });

  it("uses service-specific filename prefixes", () => {
    expect(buildOutputBaseName({ service: "chatgpt", title: "Same Title", conversation_id: "id-1" })).toBe(
      "chatgpt__Same_Title__id-1",
    );
    expect(buildOutputBaseName({ service: "gemini", title: "Same Title", conversation_id: "id-1" })).toBe(
      "gemini__Same_Title__id-1",
    );
    expect(buildOutputBaseName({ service: "claude", title: "Same Title", conversation_id: "id-1" })).toBe(
      "claude__Same_Title__id-1",
    );
  });

  it("keeps Unicode titles while removing unsafe filename characters", () => {
    expect(buildOutputBaseName({ service: "chatgpt", title: "如何阅读一本书", conversation_id: "id" })).toBe(
      "chatgpt__如何阅读一本书__id",
    );
    expect(buildOutputBaseName({ service: "gemini", title: "Gemini 图片测试 2026", conversation_id: "id" })).toBe(
      "gemini__Gemini_图片测试_2026__id",
    );
    expect(buildOutputBaseName({ service: "claude", title: 'A/B: C*? "D" <E>|', conversation_id: "id" })).toBe(
      "claude__A_B_C_D_E__id",
    );
    expect(buildOutputBaseName({ service: "chatgpt", title: "🤖✨", conversation_id: "id" })).toBe(
      "chatgpt__chatgpt__id",
    );
  });

  it("truncates long Unicode filename parts without splitting characters", () => {
    const slug = sanitizeFilenamePart("测".repeat(120), "fallback");
    expect(Array.from(slug)).toHaveLength(80);
    expect(slug).toBe("测".repeat(80));
  });

  it("includes ready image assets in the export bundle", () => {
    const conversation: ConversationExport = {
      service: "gemini",
      format_version: FORMAT_VERSION,
      exporter_version: EXPORTER_VERSION,
      conversation_id: "gemini-asset",
      title: "图片导出",
      title_source: "test",
      url: "https://gemini.google.com/app/gemini-asset",
      exported_at: "2026-04-29T00:00:00+00:00",
      message_count: 1,
      scroll_debug: {},
      assets: [
        {
          id: "image-001",
          kind: "image",
          original_url: "https://example.com/diagram.png",
          download_url: "https://example.com/diagram.png",
          local_path: "./gemini__图片导出__gemini-asset_assets/001__流程图.png",
          filename: "gemini__图片导出__gemini-asset_assets/001__流程图.png",
          alt: "流程图",
          mime_type: "image/png",
          status: "ready",
        },
      ],
      messages: [
        enrichMessage({
          id: "assistant-0000",
          role: "assistant",
          clipboard_text: "",
          clipboard_html: "",
          dom_markdown: "![流程图](./gemini__图片导出__gemini-asset_assets/001__流程图.png)",
          dom_html: "<p><img alt=\"流程图\" src=\"./gemini__图片导出__gemini-asset_assets/001__流程图.png\"></p>",
          dom_text: "[Image: 流程图]",
        }),
      ],
    };

    const bundle = buildExportBundle(conversation);
    expect(bundle.assets).toHaveLength(1);
    expect(bundle.files.map((file) => file.filename)).toEqual([
      "gemini__图片导出__gemini-asset.json",
      "gemini__图片导出__gemini-asset.md",
      "gemini__图片导出__gemini-asset_assets/001__流程图.png",
    ]);
    expect(bundle.files[2]).toMatchObject({
      kind: "asset",
      url: "https://example.com/diagram.png",
    });
  });

  it("includes ready attachment assets in the export bundle", () => {
    const conversation: ConversationExport = {
      service: "chatgpt",
      format_version: FORMAT_VERSION,
      exporter_version: EXPORTER_VERSION,
      conversation_id: "attachment-asset",
      title: "附件导出",
      title_source: "test",
      url: "https://chatgpt.com/c/attachment-asset",
      exported_at: "2026-04-29T00:00:00+00:00",
      message_count: 1,
      scroll_debug: {},
      assets: [
        {
          id: "attachment-001",
          kind: "attachment",
          original_url: "https://example.com/report.pdf",
          download_url: "https://example.com/report.pdf",
          local_path: "./chatgpt__附件导出__attachment-asset_assets/001__report.pdf",
          filename: "chatgpt__附件导出__attachment-asset_assets/001__report.pdf",
          alt: "",
          display_name: "report.pdf",
          mime_type: "application/pdf",
          status: "ready",
        },
      ],
      messages: [
        enrichMessage({
          id: "user-0000",
          role: "user",
          clipboard_text: "",
          clipboard_html: "",
          dom_markdown: "[Attachment: report.pdf](./chatgpt__附件导出__attachment-asset_assets/001__report.pdf)",
          dom_html: "<p><a href=\"./chatgpt__附件导出__attachment-asset_assets/001__report.pdf\">Attachment: report.pdf</a></p>",
          dom_text: "[Attachment: report.pdf]",
        }),
      ],
    };

    expect(buildExportBundle(conversation).files.map((file) => file.filename)).toEqual([
      "chatgpt__附件导出__attachment-asset.json",
      "chatgpt__附件导出__attachment-asset.md",
      "chatgpt__附件导出__attachment-asset_assets/001__report.pdf",
    ]);
  });

  it("renders service-specific assistant headings", () => {
    const conversation: ConversationExport = {
      service: "gemini",
      format_version: FORMAT_VERSION,
      exporter_version: EXPORTER_VERSION,
      conversation_id: "gemini-123",
      title: "Gemini Fixture",
      title_source: "test",
      url: "https://gemini.google.com/app/gemini-123",
      exported_at: "2026-04-29T00:00:00+00:00",
      message_count: 1,
      scroll_debug: {},
      assets: [],
      messages: [
        enrichMessage({
          id: "assistant-0000",
          role: "assistant",
          clipboard_text: "",
          clipboard_html: "",
          dom_markdown: "Hello from Gemini",
          dom_html: "<p>Hello from Gemini</p>",
          dom_text: "Hello from Gemini",
        }),
      ],
    };

    expect(renderConversationMarkdown(conversation)).toContain("### Gemini");
  });
});
