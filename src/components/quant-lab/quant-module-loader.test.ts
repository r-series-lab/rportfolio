import { describe, expect, it } from "vitest";
import {
  loadQuantAccount,
  loadQuantDialogs,
  loadQuantLogs,
  loadQuantOrders,
  loadQuantSimulation,
} from "./quant-module-loader";

describe("quant deferred modules", () => {
  it("shares the dialog module between intent preloading and lazy rendering", async () => {
    const first = loadQuantDialogs();
    const second = loadQuantDialogs();

    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ default: expect.any(Function) });
  });

  it("keeps simulation on its own cached module boundary", async () => {
    const first = loadQuantSimulation();
    const second = loadQuantSimulation();

    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ default: expect.any(Function) });
  });

  it.each([
    ["orders", loadQuantOrders],
    ["account", loadQuantAccount],
    ["logs", loadQuantLogs],
  ] as const)("keeps the %s rail on its own cached module boundary", async (_name, loadModule) => {
    const first = loadModule();
    const second = loadModule();

    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ default: expect.any(Function) });
  });
});
