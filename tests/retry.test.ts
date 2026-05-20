import { describe, expect, it, vi } from "vitest";

import { withRetry } from "../src/shared/retry";

describe("withRetry", () => {
  it("returns the result on first success without delay", async () => {
    const op = vi.fn(async () => "ok");
    await expect(withRetry(op)).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries up to the configured attempts and surfaces the eventual success", async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error(`attempt ${calls}`);
      }
      return "ok";
    });
    await expect(withRetry(op, { attempts: 3, baseDelayMs: 0 })).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("throws the last error when all attempts fail", async () => {
    const op = vi.fn(async () => {
      throw new Error("nope");
    });
    await expect(withRetry(op, { attempts: 2, baseDelayMs: 0 })).rejects.toThrow("nope");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("invokes onRetry between attempts but not after the final failure", async () => {
    const onRetry = vi.fn();
    const op = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(withRetry(op, { attempts: 3, baseDelayMs: 0, onRetry })).rejects.toThrow("boom");
    expect(op).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error));
  });

  it("clamps attempts to at least 1", async () => {
    const op = vi.fn(async () => "ok");
    await expect(withRetry(op, { attempts: 0 })).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
  });
});
