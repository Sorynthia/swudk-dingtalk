import { afterEach, describe, expect, it } from "vitest";

import { isSameOriginRequest } from "@/lib/session-http";

afterEach(() => {
  delete process.env.APP_ORIGIN;
});

describe("写接口来源校验", () => {
  it("只接受与应用相同的 Origin", () => {
    expect(isSameOriginRequest(new Request("http://localhost/api/check-in", {
      headers: { Origin: "http://localhost" },
    }))).toBe(true);
    expect(isSameOriginRequest(new Request("http://localhost/api/check-in", {
      headers: { Origin: "https://example.com" },
    }))).toBe(false);
    expect(isSameOriginRequest(new Request("http://localhost/api/check-in"))).toBe(false);
  });

  it("反向代理部署时使用 APP_ORIGIN", () => {
    process.env.APP_ORIGIN = "https://campus.example.com";
    expect(isSameOriginRequest(new Request("http://internal:3000/api/check-in", {
      headers: { Origin: "https://campus.example.com" },
    }))).toBe(true);
  });
});
