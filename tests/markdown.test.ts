import { describe, expect, it } from "vitest";

import { buildExportBundle } from "../src/shared/exportBundle";
import { buildOutputBaseName } from "../src/shared/filename";
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

    expect(buildOutputBaseName(conversation)).toBe("Fixture_Chat__abc-123");
    expect(renderConversationMarkdown(conversation)).toContain("### ChatGPT");
    const bundle = buildExportBundle(conversation);
    expect(bundle.files.map((file) => file.filename)).toEqual([
      "Fixture_Chat__abc-123.json",
      "Fixture_Chat__abc-123.md",
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
