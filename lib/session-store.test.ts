import { describe, expect, it } from "vitest";

import {
  authenticateSession,
  createLoginSession,
  deleteLoginSession,
  getLoginSession,
  getSessionCookieOptions,
  LOGIN_TTL_MS,
} from "@/lib/session-store";

const profile = {
  studentId: "20260001",
  dormitory: { address: "学生园区 1 舍", checkInRadius: "500 米", latitude: null, longitude: null },
  updatedAt: new Date().toISOString(),
};

function newSession(expiresAt = Date.now() + LOGIN_TTL_MS) {
  return createLoginSession({
    expiresAt,
    stage: "waiting",
    message: "等待扫码",
    qrImage: "data:image/png;base64,test",
    qrCode: "temporary-code",
    goto: "https://oapi.dingtalk.com/connect/oauth2/sns_authorize",
    appId: "temporary-app",
    cookies: [],
  });
}

describe("进程内临时会话", () => {
  it("认证后保留会话并清理二维码数据", () => {
    const session = newSession();
    authenticateSession(session, "test-secret-token", profile);

    expect(getLoginSession(session.id)).toBe(session);
    expect(session).toMatchObject({
      stage: "authenticated",
      token: "test-secret-token",
      profile,
      qrImage: "",
      qrCode: "",
      goto: "",
      appId: "",
    });
  });

  it("删除会话后不再可访问", () => {
    const session = newSession();
    deleteLoginSession(session.id);
    expect(getLoginSession(session.id)).toBeUndefined();
  });

  it("待扫码会话过期后返回 expired 状态", () => {
    const session = newSession(Date.now() - 1);
    expect(getLoginSession(session.id)).toMatchObject({
      stage: "expired",
      message: "二维码已过期",
    });
  });

  it("已删除会话不能异步认证", () => {
    const session = newSession();
    deleteLoginSession(session.id);
    expect(() => authenticateSession(session, "test-token", profile)).toThrow("登录会话已失效");
  });

  it("Cookie 安全属性只根据当前请求协议决定", () => {
    expect(getSessionCookieOptions(new Request("http://localhost/api/auth/qr")).secure).toBe(false);
    expect(getSessionCookieOptions(new Request("https://example.com/api/auth/qr")).secure).toBe(true);
  });
});
