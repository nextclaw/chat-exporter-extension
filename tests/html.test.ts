import { describe, expect, it } from "vitest";

import { renderConversationHtml } from "../src/shared/html";
import {
  EXPORTER_VERSION,
  FORMAT_VERSION,
  type ChatMessage,
  type ConversationExport,
} from "../src/shared/types";

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "user-0001",
    role: "user",
    clipboard_text: "",
    clipboard_html: "",
    dom_markdown: "Hello?",
    dom_html: "<p>Hello?</p>",
    dom_text: "Hello?",
    final_markdown: "Hello?",
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
    ...overrides,
  };
}

function makeConversation(messages: ChatMessage[], overrides: Partial<ConversationExport> = {}): ConversationExport {
  return {
    service: "chatgpt",
    format_version: FORMAT_VERSION,
    exporter_version: EXPORTER_VERSION,
    conversation_id: "demo",
    title: "How to read a book",
    title_source: "document_title",
    url: "https://chatgpt.com/c/demo",
    exported_at: "2026-05-22T00:00:00Z",
    message_count: messages.length,
    scroll_debug: {},
    assets: [],
    messages,
    ...overrides,
  };
}

describe("renderConversationHtml", () => {
  it("emits a complete HTML document with doctype, charset, and viewport meta", () => {
    const html = renderConversationHtml(makeConversation([makeMessage()]));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8" />');
    expect(html).toContain('initial-scale=1');
  });

  it("renders the conversation title and source URL in the header", () => {
    const html = renderConversationHtml(makeConversation([makeMessage()]));
    expect(html).toContain("<h1>How to read a book</h1>");
    expect(html).toContain('href="https://chatgpt.com/c/demo"');
    expect(html).toContain("Messages: 1");
  });

  it("groups user + assistant messages into a single turn section", () => {
    const html = renderConversationHtml(
      makeConversation([
        makeMessage({ role: "user", dom_html: "<p>Q1</p>", final_markdown: "Q1" }),
        makeMessage({ id: "assistant-0001", role: "assistant", dom_html: "<p>A1</p>", final_markdown: "A1" }),
      ]),
    );
    const turnSections = html.match(/<section class="turn">/g) ?? [];
    expect(turnSections).toHaveLength(1);
    expect(html).toContain("Turn 1");
    expect(html).toContain('<article class="message user">');
    expect(html).toContain('<article class="message assistant">');
  });

  it("starts a new turn for each subsequent user message", () => {
    const html = renderConversationHtml(
      makeConversation([
        makeMessage({ role: "user", dom_html: "<p>Q1</p>" }),
        makeMessage({ id: "assistant-0001", role: "assistant", dom_html: "<p>A1</p>" }),
        makeMessage({ id: "user-0002", role: "user", dom_html: "<p>Q2</p>" }),
      ]),
    );
    expect((html.match(/Turn 1/g) ?? []).length).toBe(1);
    expect((html.match(/Turn 2/g) ?? []).length).toBe(1);
  });

  it("strips <script> tags from message bodies as a defense in depth", () => {
    const html = renderConversationHtml(
      makeConversation([
        makeMessage({
          role: "assistant",
          dom_html: '<p>Safe answer.</p><script>alert("xss")</script>',
        }),
      ]),
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
    expect(html).toContain("Safe answer.");
  });

  it("escapes the title and URL when they contain HTML-special characters", () => {
    const html = renderConversationHtml(
      makeConversation([makeMessage()], {
        title: 'Chat <special> & "quoted"',
        url: "https://chatgpt.com/c/demo?q=<x>",
      }),
    );
    expect(html).toContain("<h1>Chat &lt;special&gt; &amp; &quot;quoted&quot;</h1>");
    expect(html).toContain("?q=&lt;x&gt;");
  });

  it("preserves relative asset image paths so the file works alongside the assets folder", () => {
    const html = renderConversationHtml(
      makeConversation([
        makeMessage({
          role: "assistant",
          dom_html: '<p>Look:</p><img alt="diagram" src="./demo_assets/001__diagram.png" />',
        }),
      ]),
    );
    expect(html).toContain('src="./demo_assets/001__diagram.png"');
    expect(html).toContain('alt="diagram"');
  });

  it("falls back to the markdown body when dom_html is empty", () => {
    const html = renderConversationHtml(
      makeConversation([
        makeMessage({ role: "user", dom_html: "", final_markdown: "Hi there\nWith two lines." }),
      ]),
    );
    expect(html).toContain("Hi there<br />With two lines.");
  });
});
