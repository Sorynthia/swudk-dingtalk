import { describe, expect, it } from "vitest";

import { isSameOriginRequest } from "@/lib/session-http";

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

  it("只根据当前请求地址校验来源", () => {
    expect(isSameOriginRequest(new Request("https://campus.example.com/api/check-in", {
      headers: { Origin: "https://campus.example.com" },
    }))).toBe(true);
    expect(isSameOriginRequest(new Request("http://internal:3000/api/check-in", {
      headers: { Origin: "https://campus.example.com" },
    }))).toBe(false);
  });
});
