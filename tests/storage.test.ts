import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSelectedFormats, saveSelectedFormats } from "../src/popup/storage";

function withStorage(initial: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = { ...initial };
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in state ? { [key]: state[key] } : {})),
        set: vi.fn(async (entries: Record<string, unknown>) => {
          Object.assign(state, entries);
        }),
      },
    },
  });
  return state;
}

describe("popup/storage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the default Markdown selection when storage is empty", async () => {
    withStorage();
    await expect(loadSelectedFormats()).resolves.toEqual(["markdown"]);
  });

  it("round-trips the saved selection", async () => {
    const state = withStorage();
    await saveSelectedFormats(["markdown", "json"]);
    expect(state.exportFormats).toEqual(["markdown", "json"]);
    await expect(loadSelectedFormats()).resolves.toEqual(["markdown", "json"]);
  });

  it("falls back to the default when stored entries are all invalid", async () => {
    withStorage({ exportFormats: ["pdf", "html"] });
    await expect(loadSelectedFormats()).resolves.toEqual(["markdown"]);
  });

  it("keeps only the supported entries when the stored array is mixed", async () => {
    withStorage({ exportFormats: ["json", "garbage", "markdown"] });
    await expect(loadSelectedFormats()).resolves.toEqual(["json", "markdown"]);
  });

  it("swallows chrome.storage failures and returns the default", async () => {
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => {
            throw new Error("denied");
          }),
          set: vi.fn(),
        },
      },
    });
    await expect(loadSelectedFormats()).resolves.toEqual(["markdown"]);
  });
});
