import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startDingTalkLogin: vi.fn(),
  deleteLoginSession: vi.fn(),
  getLoginSession: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => ({ value: "old-session" })),
    set: mocks.cookieSet,
  })),
}));
vi.mock("@/lib/dingtalk", () => ({ startDingTalkLogin: mocks.startDingTalkLogin }));
vi.mock("@/lib/session-store", () => ({
  SESSION_COOKIE: "swu_portal_session",
  deleteLoginSession: mocks.deleteLoginSession,
  getLoginSession: mocks.getLoginSession,
  getSessionCookieOptions: vi.fn(() => ({})),
}));
vi.mock("@/lib/session-http", () => ({ isSameOriginRequest: vi.fn(() => true) }));

import { POST } from "@/app/api/auth/qr/route";

describe("二维码会话替换", () => {
  beforeEach(() => {
    mocks.startDingTalkLogin.mockReset();
    mocks.deleteLoginSession.mockReset();
    mocks.getLoginSession.mockReset();
    mocks.cookieSet.mockReset();
  });

  it("已有有效二维码时直接复用会话", async () => {
    mocks.getLoginSession.mockReturnValueOnce({
      stage: "waiting",
      message: "等待扫码",
      qrImage: "data:image/png;base64,existing",
      expiresAt: Date.now() + 60_000,
    });
    const response = await POST(new Request("http://localhost/api/auth/qr", {
      method: "POST",
      headers: { Origin: "http://localhost" },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      stage: "waiting",
      qrImage: "data:image/png;base64,existing",
    });
    expect(mocks.startDingTalkLogin).not.toHaveBeenCalled();
    expect(mocks.deleteLoginSession).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("二维码生成失败时保留原登录会话", async () => {
    mocks.startDingTalkLogin.mockRejectedValueOnce(new Error("上游不可用"));
    const response = await POST(new Request("http://localhost/api/auth/qr", {
      method: "POST",
      headers: { Origin: "http://localhost" },
    }));

    expect(response.status).toBe(502);
    expect(mocks.deleteLoginSession).not.toHaveBeenCalled();
  });

  it("二维码生成成功后才替换原会话", async () => {
    mocks.startDingTalkLogin.mockResolvedValueOnce({
      id: "new-session",
      stage: "waiting",
      message: "等待扫码",
      qrImage: "data:image/png;base64,test",
      expiresAt: Date.now() + 60_000,
    });
    const response = await POST(new Request("http://localhost/api/auth/qr", {
      method: "POST",
      headers: { Origin: "http://localhost" },
    }));

    expect(response.status).toBe(200);
    expect(mocks.deleteLoginSession).toHaveBeenCalledWith("old-session");
    expect(mocks.cookieSet).toHaveBeenCalled();
  });
});
