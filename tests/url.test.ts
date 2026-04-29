import { describe, expect, it } from "vitest";

import { parseChatGptConversationUrl } from "../src/shared/url";

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
