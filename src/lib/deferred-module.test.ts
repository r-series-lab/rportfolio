import { describe, expect, it, vi } from "vitest";
import { createDeferredModuleLoader } from "./deferred-module";

describe("createDeferredModuleLoader", () => {
  it("shares one in-flight and resolved module promise per key", async () => {
    const module = { default: "overview" };
    const loader = vi.fn().mockResolvedValue(module);
    const loadModule = createDeferredModuleLoader({ overview: loader });

    const first = loadModule("overview");
    const second = loadModule("overview");

    expect(second).toBe(first);
    await expect(first).resolves.toBe(module);
    await expect(loadModule("overview")).resolves.toBe(module);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("clears a failed request so the module can be retried", async () => {
    const module = { default: "structure" };
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce(module);
    const loadModule = createDeferredModuleLoader({ structure: loader });

    await expect(loadModule("structure")).rejects.toThrow("chunk unavailable");
    await expect(loadModule("structure")).resolves.toBe(module);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
