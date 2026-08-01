import { afterEach, describe, expect, it } from "vitest";

import { isServiceEnabled, parseServiceEnabled } from "@/lib/service-status";

describe("服务开关", () => {
  const originalValue = process.env.SERVICE_ENABLED;

  afterEach(() => {
    if (originalValue === undefined) delete process.env.SERVICE_ENABLED;
    else process.env.SERVICE_ENABLED = originalValue;
  });

  it.each([
    ["true", true],
    [" TRUE ", true],
    ["false", false],
    ["1", false],
    ["", false],
    [undefined, false],
  ])("将 %s 解析为 %s", (value, expected) => {
    expect(parseServiceEnabled(value)).toBe(expected);
  });

  it("每次调用时读取当前服务端环境变量", () => {
    process.env.SERVICE_ENABLED = "true";
    expect(isServiceEnabled()).toBe(true);

    process.env.SERVICE_ENABLED = "false";
    expect(isServiceEnabled()).toBe(false);
  });
});
