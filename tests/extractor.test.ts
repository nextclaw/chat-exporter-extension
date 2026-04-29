import { beforeEach, describe, expect, it } from "vitest";

import { extractClaudeRolePayloads, extractGeminiRolePayloads, extractRolePayloads, probeCurrentPage } from "../src/content/chatgptExtractor";

function setUrl(url: string): void {
  window.history.replaceState({}, "", url);
}

describe("ChatGPT page probing", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("accepts ChatGPT conversation pages", () => {
    setUrl("https://chatgpt.com/c/fixture-chat");
    expect(probeCurrentPage()).toMatchObject({
      ok: true,
      conversationId: "fixture-chat",
    });
  });

  it("rejects non-conversation pages", () => {
    setUrl("https://chatgpt.com/g/g-example");
    expect(probeCurrentPage()).toMatchObject({
      ok: false,
      reason: "Current page is not a ChatGPT conversation page.",
    });
  });

});

describe("extractRolePayloads", () => {
  beforeEach(() => {
    setUrl("https://chatgpt.com/c/fixture-chat");
    document.body.innerHTML = "";
  });

  it("extracts user and assistant messages while removing UI noise", () => {
    document.body.innerHTML = `
      <article data-message-author-role="user">
        <div class="whitespace-pre-wrap"># Prompt<br>- keep this</div>
      </article>
      <article data-message-author-role="assistant">
        <div class="markdown">
          <p>Answer with <a href="https://example.com">a link</a>.</p>
          <div data-testid="code-block">
            <span>ts</span>
            <pre><code>const ok = true;</code></pre>
            <button>Copy code</button>
          </div>
          <button>Copy</button>
          <span class="sr-only">ChatGPT said</span>
        </div>
      </article>
    `;

    const payloads = extractRolePayloads();
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({
      role: "user",
      dom_text: "# Prompt\n- keep this",
    });
    expect(payloads[1].dom_html).not.toContain("Copy");
    expect(payloads[1].dom_markdown).toContain("[a link](https://example.com)");
    expect(payloads[1].dom_markdown).toContain("```ts");
  });

  it("normalizes media and math placeholders", () => {
    document.body.innerHTML = `
      <article data-message-author-role="assistant">
        <div class="markdown">
          <p><img alt="diagram" src="https://example.com/diagram.png"></p>
          <span class="katex"><annotation encoding="application/x-tex">x^2</annotation></span>
        </div>
      </article>
    `;

    const [payload] = extractRolePayloads();
    expect(payload.dom_text).toContain("[Image: diagram]");
    expect(payload.dom_text).toContain("$$");
    expect(payload.dom_markdown).toContain("[Image: diagram](https://example.com/diagram.png)");
  });
});

describe("extractGeminiRolePayloads", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("extracts Gemini user lines and assistant responses", () => {
    document.body.innerHTML = `
      <user-query>
        <div class="query-text">
          <div class="query-text-line"># Prompt</div>
          <div class="query-text-line">- keep structure</div>
        </div>
      </user-query>
      <model-response>
        <div class="model-response-text">
          <p>Gemini answer with <a href="https://example.com">docs</a>.</p>
          <button>Stop responding</button>
        </div>
      </model-response>
    `;

    const payloads = extractGeminiRolePayloads();
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({
      role: "user",
      dom_markdown: "# Prompt\n- keep structure",
      dom_text: "# Prompt\n- keep structure",
    });
    expect(payloads[1].dom_markdown).toContain("[docs](https://example.com)");
    expect(payloads[1].dom_text).not.toContain("Stop responding");
  });
});

describe("extractClaudeRolePayloads", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("extracts Claude user and assistant messages", () => {
    document.body.innerHTML = `
      <div data-testid="user-message">Please summarize this.</div>
      <div class="font-claude-response">
        <div class="standard-markdown">
          <p>Claude answer.</p>
          <pre><code>print("ok")</code></pre>
          <button>Copy</button>
        </div>
      </div>
    `;

    const payloads = extractClaudeRolePayloads();
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({
      role: "user",
      dom_text: "Please summarize this.",
    });
    expect(payloads[1].dom_markdown).toContain("Claude answer.");
    expect(payloads[1].dom_markdown).toContain("```");
    expect(payloads[1].dom_text).not.toContain("Copy");
  });
});
