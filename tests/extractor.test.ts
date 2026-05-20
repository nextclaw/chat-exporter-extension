import { beforeEach, describe, expect, it } from "vitest";

import {
  extractClaudeRolePayloads,
  extractGeminiRolePayloads,
  extractRolePayloads,
  harvestChatGptPayloads,
  probeCurrentPage,
} from "../src/content/chatgptExtractor";
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

  it("preserves code wrapped in a button while still stripping plain-text buttons", async () => {
    document.body.innerHTML = `
      <article data-message-author-role="assistant">
        <div class="markdown">
          <p>Inline reply with code-bearing button:</p>
          <button><pre><code class="language-py">print("kept")</code></pre></button>
          <button>Copy</button>
        </div>
      </article>
    `;

    const [payload] = await extractRolePayloads();
    expect(payload.dom_markdown).toContain("print(\"kept\")");
    expect(payload.dom_markdown).toContain("```py");
    expect(payload.dom_text).not.toContain("Copy");
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

  it("registers static ChatGPT attachment links without touching normal references", async () => {
    document.body.innerHTML = `
      <article data-message-author-role="user">
        <div class="whitespace-pre-wrap">
          <div class="group/file-tile">
            <a download="notes.md" href="https://chatgpt.com/backend-api/files/notes.md">notes.md</a>
          </div>
          <a href="https://example.com/reference.pdf">reference</a>
        </div>
      </article>
    `;

    const collector = new ImageAssetCollector("chatgpt__附件测试__fixture-chat");
    const [payload] = await extractRolePayloads(document, collector);
    expect(payload.dom_markdown).toContain("[Attachment: notes.md](./chatgpt__附件测试__fixture-chat_assets/001__notes.md)");
    expect(payload.dom_markdown).toContain("[reference](https://example.com/reference.pdf)");
    expect(collector.listAssets()).toMatchObject([
      {
        kind: "attachment",
        original_url: "https://chatgpt.com/backend-api/files/notes.md",
        filename: "chatgpt__附件测试__fixture-chat_assets/001__notes.md",
        status: "ready",
      },
    ]);
  });

  it("keeps no-href ChatGPT file tiles as text placeholders", async () => {
    document.body.innerHTML = `
      <article data-message-author-role="user">
        <div class="whitespace-pre-wrap">
          <div class="group/file-tile"><span>reading-notes.md</span></div>
        </div>
      </article>
    `;

    const collector = new ImageAssetCollector("chatgpt__附件测试__fixture-chat");
    const [payload] = await extractRolePayloads(document, collector);
    expect(payload.dom_markdown).toContain("[Attachment: reading-notes.md]");
    expect(payload.dom_markdown).not.toContain("](./chatgpt__附件测试__fixture-chat_assets/");
    expect(collector.listAssets()).toHaveLength(0);
  });

  it("harvests ChatGPT virtualized turns by visiting turn anchors", async () => {
    const imageUrl =
      "https://chatgpt.com/backend-api/estuary/content?id=file_virtualized_image&ts=1&p=fs&cid=1&sig=fixture&v=0";
    const scrollContainer = document.createElement("div");
    scrollContainer.setAttribute("data-testid", "conversation-turns");
    const totalPairs = 20;
    const imageTurnIndex = totalPairs * 2 + 1;
    let scrollTop = imageTurnIndex * 1000;
    Object.defineProperties(scrollContainer, {
      clientHeight: { configurable: true, value: 500 },
      scrollHeight: { configurable: true, value: 60000 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });
    const renderAround = (centerIndex: number) => {
      scrollTop = centerIndex * 1000;
      for (const node of Array.from(scrollContainer.querySelectorAll<HTMLElement>("[data-testid^='conversation-turn-']"))) {
        const match = (node.getAttribute("data-testid") ?? "").match(/^conversation-turn-(\d+)$/);
        const turnIndex = match ? Number(match[1]) : 0;
        if (Math.abs(turnIndex - centerIndex) > 1) {
          node.innerHTML = "";
          continue;
        }
        if (turnIndex === imageTurnIndex) {
          node.innerHTML = `
            <div class="agent-turn">
              <div class="group/imagegen-image"><img alt="示意图" src="${imageUrl}"></div>
              <button data-testid="good-image-turn-action-button">Good</button>
            </div>
          `;
          continue;
        }
        const pair = Math.ceil(turnIndex / 2);
        node.innerHTML =
          turnIndex % 2 === 1
            ? `<article data-message-author-role="user"><div class="whitespace-pre-wrap">Prompt ${pair}</div></article>`
            : `<article data-message-author-role="assistant"><div class="markdown"><p>Answer ${pair}</p></div></article>`;
      }
    };
    for (let index = 1; index <= imageTurnIndex; index += 1) {
      const turn = document.createElement("div");
      turn.setAttribute("data-testid", `conversation-turn-${index}`);
      turn.scrollIntoView = () => renderAround(index);
      scrollContainer.append(turn);
    }
    document.body.append(scrollContainer);
    renderAround(imageTurnIndex);

    const collector = new ImageAssetCollector("chatgpt__虚拟列表__fixture-chat");
    const result = await harvestChatGptPayloads(collector, { delayMs: 0, viewportStepRatio: 1, maxSamples: 10 });
    const expected = Array.from({ length: totalPairs }, (_, index) => [`Prompt ${index + 1}`, `Answer ${index + 1}`]).flat();

    expect(result.payloads.map((payload) => payload.dom_text)).toEqual([...expected, "[Image: 示意图]"]);
    expect(result.debug.harvest_strategy).toBe("turn-anchor");
    expect(result.debug.visited_turn_count).toBe(imageTurnIndex);
    expect(result.debug.missing_turn_indices).toEqual([]);
    expect(result.debug.coverage_reached_bottom).toBe(true);
    expect(result.debug.harvested_messages).toBe(41);
    expect(result.debug.deduped_messages).toBeGreaterThan(0);
    expect(result.debug.restored_scroll_top).toBe(imageTurnIndex * 1000);
    expect(result.payloads[40].dom_markdown).toContain("![示意图](./chatgpt__虚拟列表__fixture-chat_assets/001__示意图.png)");
  });

  it("uses a full adaptive sweep when turn anchors are unavailable", async () => {
    const scrollContainer = document.createElement("div");
    scrollContainer.setAttribute("aria-label", "Chat history");
    let scrollTop = 0;
    Object.defineProperties(scrollContainer, {
      clientHeight: { configurable: true, value: 500 },
      scrollHeight: { configurable: true, value: 5000 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
          const bucket = Math.min(5, Math.floor(value / 1000) + 1);
          scrollContainer.innerHTML = `
            <article data-message-author-role="user"><div class="whitespace-pre-wrap">Fallback prompt ${bucket}</div></article>
            <article data-message-author-role="assistant"><div class="markdown"><p>Fallback answer ${bucket}</p></div></article>
          `;
        },
      },
    });
    document.body.append(scrollContainer);
    scrollContainer.scrollTop = 0;

    const collector = new ImageAssetCollector("chatgpt__fallback__fixture-chat");
    const result = await harvestChatGptPayloads(collector, { delayMs: 0, viewportStepRatio: 1, maxSamples: 2 });

    expect(result.debug.harvest_strategy).toBe("adaptive-scroll");
    expect(result.debug.coverage_reached_bottom).toBe(true);
    expect(result.debug.harvest_positions?.at(-1)).toBe(4500);
    expect(result.payloads.map((payload) => payload.dom_text)).toEqual([
      "Fallback prompt 1",
      "Fallback answer 1",
      "Fallback prompt 2",
      "Fallback answer 2",
      "Fallback prompt 3",
      "Fallback answer 3",
      "Fallback prompt 4",
      "Fallback answer 4",
      "Fallback prompt 5",
      "Fallback answer 5",
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

  it("deduplicates separate assistant nodes that share the exact same rendered text", async () => {
    document.body.innerHTML = `
      <div data-testid="user-message">What is the answer?</div>
      <div class="font-claude-response">
        <div class="standard-markdown"><p>The answer is forty-two.</p></div>
      </div>
      <div class="font-claude-response">
        <div class="progressive-markdown"><p>The answer is forty-two.</p></div>
      </div>
    `;

    const payloads = await extractClaudeRolePayloads();
    expect(payloads.map((p) => p.role)).toEqual(["user", "assistant"]);
    expect(payloads[1].dom_text).toContain("forty-two");
  });

  it("keeps the inner node when a wrapping assistant container repeats the same text", async () => {
    document.body.innerHTML = `
      <div data-testid="user-message">Wrap?</div>
      <div class="prose">
        <div class="standard-markdown"><p>Wrapped reply.</p></div>
      </div>
    `;

    const payloads = await extractClaudeRolePayloads();
    expect(payloads).toHaveLength(2);
    expect(payloads[1].dom_text).toBe("Wrapped reply.");
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
