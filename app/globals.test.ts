import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("星轨视觉样式", () => {
  it("提供服务与二维码轨道、新拟态阴影和减弱动画规则", async () => {
    const css = await readFile(new URL("./globals.css", import.meta.url), "utf8");

    expect(css).toContain('[data-visual="service-orbit"]');
    expect(css).toContain('[data-visual="qr-orbit"]');
    expect(css).toContain("--shadow-neumorphic:");
    expect(css).toContain("--shadow-neumorphic-inset:");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  it("提供与暖色星轨风格一致的站点图标", async () => {
    const icon = await readFile(new URL("./icon.svg", import.meta.url), "utf8");

    expect(icon).toContain("<title>SWU钉钉扫码打卡</title>");
    expect(icon).toContain("#3b2b22");
    expect(icon).toContain("#fff8ed");
    expect(icon).toContain("#dba76f");
    expect(icon).toContain("M19 27v-6h6");
    expect(icon).toContain("m25 32 5 5 9-11");
  });
});
