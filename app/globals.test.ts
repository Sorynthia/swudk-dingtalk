import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("shadcn 视觉样式", () => {
  it("提供中性 shadcn token 与减弱动画规则", async () => {
    const css = await readFile(new URL("./globals.css", import.meta.url), "utf8");

    expect(css).toContain('--background: oklch(1 0 0);');
    expect(css).toContain('--primary: oklch(0.205 0 0);');
    expect(css).toContain('--radius: 0.625rem;');
    expect(css).toContain('--font-ui: "Public Sans"');
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  it("提供钉钉扫码打卡站点图标", async () => {
    const icon = await readFile(new URL("./icon.svg", import.meta.url), "utf8");

    expect(icon).toContain("<title>钉钉扫码打卡</title>");
    expect(icon).toContain("#3b2b22");
    expect(icon).toContain("#fff8ed");
    expect(icon).toContain("#dba76f");
    expect(icon).toContain("M19 27v-6h6");
    expect(icon).toContain("m25 32 5 5 9-11");
  });
});
