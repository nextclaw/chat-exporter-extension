import { describe, expect, it } from "vitest";

import { parseChatGptConversationUrl, parseConversationUrl } from "../src/shared/url";

describe("parseChatGptConversationUrl", () => {
  it("accepts current ChatGPT conversation pages", () => {
    expect(parseChatGptConversationUrl("https://chatgpt.com/c/abc-123?model=gpt-5").ok).toBe(true);
    expect(parseChatGptConversationUrl("https://chat.openai.com/c/abc_123").ok).toBe(true);
  });

  it("extracts the conversation id from a path segment", () => {
    const parsed = parseChatGptConversationUrl("https://chatgpt.com/c/abc-123#ignored");
    expect(parsed).toMatchObject({
      ok: true,
      conversationId: "abc-123",
      url: "https://chatgpt.com/c/abc-123",
    });
  });

  it("rejects non-conversation ChatGPT pages", () => {
    expect(parseChatGptConversationUrl("https://chatgpt.com/").ok).toBe(false);
    expect(parseChatGptConversationUrl("https://chatgpt.com/g/g-example").ok).toBe(false);
    expect(parseChatGptConversationUrl("https://chatgpt.com/g/g-example/c/not-a-chat").ok).toBe(false);
    expect(parseChatGptConversationUrl("https://chatgpt.com/share/abc-123").ok).toBe(false);
  });

  it("rejects unsupported origins", () => {
    expect(parseChatGptConversationUrl("https://example.com/c/abc").ok).toBe(false);
  });
});

describe("parseConversationUrl", () => {
  it("accepts current Gemini and Claude conversation pages", () => {
    expect(parseConversationUrl("https://gemini.google.com/app/gemini-123")).toMatchObject({
      ok: true,
      service: "gemini",
      conversationId: "gemini-123",
    });
    expect(parseConversationUrl("https://claude.ai/chat/claude-123")).toMatchObject({
      ok: true,
      service: "claude",
      conversationId: "claude-123",
    });
    expect(parseConversationUrl("https://app.claude.ai/chat/claude-456")).toMatchObject({
      ok: true,
      service: "claude",
      conversationId: "claude-456",
    });
  });

  it("rejects non-conversation Gemini and Claude pages", () => {
    expect(parseConversationUrl("https://gemini.google.com/").ok).toBe(false);
    expect(parseConversationUrl("https://gemini.google.com/share/abc").ok).toBe(false);
    expect(parseConversationUrl("https://claude.ai/new").ok).toBe(false);
    expect(parseConversationUrl("https://claude.ai/project/chat/not-current").ok).toBe(false);
  });
});
