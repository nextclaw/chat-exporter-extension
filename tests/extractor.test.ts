import { beforeEach, describe, expect, it } from "vitest";

import { extractClaudeRolePayloads, extractGeminiRolePayloads, extractRolePayloads, probeCurrentPage } from "../src/content/chatgptExtractor";
import { ImageAssetCollector } from "../src/shared/assets";
import { enrichMessage } from "../src/shared/markdown";

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

  it("extracts user and assistant messages while removing UI noise", async () => {
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

    const payloads = await extractRolePayloads();
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({
      role: "user",
      dom_text: "# Prompt\n- keep this",
    });
    expect(payloads[1].dom_html).not.toContain("Copy");
    expect(payloads[1].dom_markdown).toContain("[a link](https://example.com)");
    expect(payloads[1].dom_markdown).toContain("```ts");
  });

  it("normalizes media and math placeholders", async () => {
    document.body.innerHTML = `
      <article data-message-author-role="assistant">
        <div class="markdown">
          <p><img alt="diagram" src="https://example.com/diagram.png"></p>
          <span class="katex"><annotation encoding="application/x-tex">x^2</annotation></span>
        </div>
      </article>
    `;

    const collector = new ImageAssetCollector("chatgpt__Fixture__fixture-chat");
    const [payload] = await extractRolePayloads(document, collector);
    expect(payload.dom_text).toContain("[Image: diagram]");
    expect(payload.dom_text).toContain("$$");
    expect(payload.dom_markdown).toContain("![diagram](./chatgpt__Fixture__fixture-chat_assets/001__diagram.png)");
    expect(collector.listAssets()).toMatchObject([
      {
        kind: "image",
        original_url: "https://example.com/diagram.png",
        local_path: "./chatgpt__Fixture__fixture-chat_assets/001__diagram.png",
        status: "ready",
      },
    ]);
  });

  it("extracts ChatGPT image generation turns as assistant image assets", async () => {
    const imageUrl =
      "https://chatgpt.com/backend-api/estuary/content?id=file_00000000e50471f5b84deadfb12486f7&ts=494056&p=fs&cid=1&sig=fixture&v=0";
    document.body.innerHTML = `
      <article data-message-author-role="user">
        <div class="whitespace-pre-wrap">Generate a poster.</div>
      </article>
      <div class="agent-turn">
        <button type="button">Thought for 1m 45s</button>
        <div class="group/imagegen-image">
          <img alt="已生成图片" src="${imageUrl}">
          <img alt="" aria-hidden="true" src="${imageUrl}">
          <img alt="" aria-hidden="true" src="${imageUrl}">
          <div data-testid="image-gen-overlay-actions">
            <button aria-label="编辑图片">编辑</button>
            <button aria-label="分享此图片">分享此图片</button>
          </div>
        </div>
        <button data-testid="copy-turn-action-button" aria-label="复制回复">复制回复</button>
        <button data-testid="good-image-turn-action-button" aria-label="喜欢此图片">喜欢此图片</button>
      </div>
    `;

    const collector = new ImageAssetCollector("chatgpt__生成宣传海报__fixture-chat");
    const payloads = await extractRolePayloads(document, collector);
    expect(payloads.map((payload) => payload.role)).toEqual(["user", "assistant"]);

    const assistant = payloads[1];
    expect(assistant.dom_markdown).toContain(
      "![已生成图片](./chatgpt__生成宣传海报__fixture-chat_assets/001__已生成图片.png)",
    );
    expect(`${assistant.dom_html}\n${assistant.dom_text}\n${assistant.dom_markdown}`).not.toMatch(
      /Thought for|编辑|分享此图片|复制回复/,
    );

    const enriched = enrichMessage({
      id: "assistant-0001",
      role: assistant.role,
      clipboard_text: "",
      clipboard_html: "",
      dom_markdown: assistant.dom_markdown,
      dom_html: assistant.dom_html,
      dom_text: assistant.dom_text,
    });
    expect(enriched.final_markdown).toContain(
      "![已生成图片](./chatgpt__生成宣传海报__fixture-chat_assets/001__已生成图片.png)",
    );
    expect(collector.listAssets()).toMatchObject([
      {
        kind: "image",
        original_url: imageUrl,
        local_path: "./chatgpt__生成宣传海报__fixture-chat_assets/001__已生成图片.png",
        status: "ready",
      },
    ]);
  });

  it("registers ChatGPT image generation download links when img nodes are absent", async () => {
    document.body.innerHTML = `
      <div class="agent-turn">
        <a href="https://example.com/render.png" aria-label="下载图片">Download</a>
        <button data-testid="good-image-turn-action-button" aria-label="喜欢此图片">喜欢此图片</button>
      </div>
    `;

    const collector = new ImageAssetCollector("chatgpt__图片链接__fixture-chat");
    const [payload] = await extractRolePayloads(document, collector);
    expect(payload.role).toBe("assistant");
    expect(payload.dom_markdown).toContain("![下载图片](./chatgpt__图片链接__fixture-chat_assets/001__下载图片.png)");
    expect(collector.listAssets()).toMatchObject([
      {
        original_url: "https://example.com/render.png",
        local_path: "./chatgpt__图片链接__fixture-chat_assets/001__下载图片.png",
      },
    ]);
  });
});

describe("extractGeminiRolePayloads", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("extracts Gemini user lines and assistant responses", async () => {
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

    const payloads = await extractGeminiRolePayloads();
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

  it("extracts Claude user and assistant messages", async () => {
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

    const payloads = await extractClaudeRolePayloads();
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
