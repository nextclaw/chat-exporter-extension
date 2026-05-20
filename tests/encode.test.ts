import { describe, expect, it } from "vitest";

import { textToDataUrl } from "../src/shared/encode";

function decode(dataUrl: string): { mimeType: string; text: string } {
  const match = dataUrl.match(/^data:(.+);base64,(.*)$/);
  if (!match) {
    throw new Error(`Not a base64 data URL: ${dataUrl.slice(0, 64)}`);
  }
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return { mimeType: match[1], text: new TextDecoder().decode(bytes) };
}

describe("textToDataUrl", () => {
  it("encodes ASCII content with the requested MIME type", () => {
    const decoded = decode(textToDataUrl("hello", "text/plain"));
    expect(decoded.mimeType).toBe("text/plain");
    expect(decoded.text).toBe("hello");
  });

  it("round-trips UTF-8 content including CJK and emoji", () => {
    const original = "导出对话 🚀 Hörnchen — 日本語";
    const decoded = decode(textToDataUrl(original, "text/markdown;charset=utf-8"));
    expect(decoded.mimeType).toBe("text/markdown;charset=utf-8");
    expect(decoded.text).toBe(original);
  });

  it("round-trips strings larger than the 0x8000 chunk boundary", () => {
    const original = "あ".repeat(50_000);
    const decoded = decode(textToDataUrl(original, "application/json"));
    expect(decoded.text).toBe(original);
    expect(decoded.text.length).toBe(50_000);
  });

  it("encodes empty strings as a zero-byte base64 payload", () => {
    expect(textToDataUrl("", "text/plain")).toBe("data:text/plain;base64,");
  });
});
