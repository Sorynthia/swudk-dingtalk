import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertAllowedLoginUrl,
  extractState,
  extractTicket,
  pollDingTalkLogin,
} from "@/lib/dingtalk";
import type { LoginSession } from "@/lib/session-store";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("钉钉登录回调解析", () => {
  it("能够从双重编码链接中提取 state", () => {
    const target = "https://login.dingtalk.com/login/qrcode.htm?state=test%2Fstate";
    expect(extractState(encodeURIComponent(encodeURIComponent(target)))).toBe("test/state");
  });

  it("能够从查询参数和片段中提取 ticket", () => {
    expect(extractTicket("https://of.swu.edu.cn/callback?ticket=query-ticket")).toBe("query-ticket");
    expect(extractTicket("https://of.swu.edu.cn/#/result?ticket=fragment-ticket")).toBe("fragment-ticket");
  });

  it("只允许钉钉和学校域名参与登录跳转", () => {
    expect(assertAllowedLoginUrl("https://login.dingtalk.com/login/qrcode.htm"))
      .toBe("https://login.dingtalk.com/login/qrcode.htm");
    expect(assertAllowedLoginUrl("https://of.swu.edu.cn/callback"))
      .toBe("https://of.swu.edu.cn/callback");
    expect(() => assertAllowedLoginUrl("http://of.swu.edu.cn/callback"))
      .toThrow("不受信任");
    expect(() => assertAllowedLoginUrl("https://of.swu.edu.cn.example.com/callback"))
      .toThrow("不受信任");
  });

  it("二维码轮询连续失败三次后才终止", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const session: LoginSession = {
      id: "00000000-0000-4000-8000-000000000000",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      stage: "waiting",
      message: "等待扫码",
      qrImage: "data:image/png;base64,test",
      qrCode: "test-code",
      goto: "https://oapi.dingtalk.com/connect/oauth2/sns_authorize",
      appId: "test-app",
      cookies: [],
    };

    await expect(pollDingTalkLogin(session)).resolves.toMatchObject({
      stage: "waiting",
      message: "登录服务暂时不稳定，正在重试（1/3）",
    });
    await expect(pollDingTalkLogin(session)).resolves.toMatchObject({ stage: "waiting" });
    await expect(pollDingTalkLogin(session)).resolves.toMatchObject({
      stage: "error",
      message: "二维码状态查询失败（HTTP 503）",
    });
  });

  it("只向当前登录来源发送对应 Cookie", async () => {
    let sentCookie: string | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      sentCookie = new Headers(init?.headers).get("cookie");
      return new Response("{}", { status: 503 });
    }));
    const session: LoginSession = {
      id: "00000000-0000-4000-8000-000000000000",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      stage: "waiting",
      message: "等待扫码",
      qrImage: "data:image/png;base64,test",
      qrCode: "test-code",
      goto: "https://oapi.dingtalk.com/connect/oauth2/sns_authorize",
      appId: "test-app",
      cookies: [
        { name: "ding-session", value: "ding-value", domain: "login.dingtalk.com", path: "/", hostOnly: true, secure: true },
        { name: "oapi-session", value: "oapi-secret", domain: "oapi.dingtalk.com", path: "/", hostOnly: true, secure: true },
        { name: "swu-session", value: "swu-secret", domain: "of.swu.edu.cn", path: "/", hostOnly: true, secure: true },
      ],
    };

    await pollDingTalkLogin(session);

    expect(sentCookie).toBe("ding-session=ding-value");
    expect(sentCookie).not.toContain("oapi-secret");
    expect(sentCookie).not.toContain("swu-secret");
  });

  it("不会发送路径不匹配、已过期或已删除的 Cookie", async () => {
    let requestCount = 0;
    let sentCookie: string | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestCount += 1;
      sentCookie = new Headers(init?.headers).get("cookie");
      return new Response("{}", {
        status: 503,
        headers: requestCount === 1
          ? { "Set-Cookie": "ding-session=; Path=/; Max-Age=0" }
          : undefined,
      });
    }));
    const session: LoginSession = {
      id: "00000000-0000-4000-8000-000000000000",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      stage: "waiting",
      message: "等待扫码",
      qrImage: "data:image/png;base64,test",
      qrCode: "test-code",
      goto: "https://oapi.dingtalk.com/connect/oauth2/sns_authorize",
      appId: "test-app",
      cookies: [
        { name: "ding-session", value: "old", domain: "login.dingtalk.com", path: "/", hostOnly: true, secure: true },
        { name: "private", value: "secret", domain: "login.dingtalk.com", path: "/private", hostOnly: true, secure: true },
        { name: "expired", value: "secret", domain: "login.dingtalk.com", path: "/", hostOnly: true, secure: true, expiresAt: Date.now() - 1 },
      ],
    };

    await pollDingTalkLogin(session);
    await pollDingTalkLogin(session);

    expect(sentCookie).toBeNull();
    expect(session.cookies).toHaveLength(1);
    expect(session.cookies[0].name).toBe("private");
  });

  it("保存并复用当前登录来源返回的 Cookie", async () => {
    let requestCount = 0;
    let reusedCookie: string | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestCount += 1;
      if (requestCount === 2) {
        reusedCookie = new Headers(init?.headers).get("cookie");
      }
      return new Response("{}", {
        status: 503,
        headers: requestCount === 1
          ? { "Set-Cookie": "ding-session=ding-value; Path=/; HttpOnly" }
          : undefined,
      });
    }));
    const session: LoginSession = {
      id: "00000000-0000-4000-8000-000000000000",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      stage: "waiting",
      message: "等待扫码",
      qrImage: "data:image/png;base64,test",
      qrCode: "test-code",
      goto: "https://oapi.dingtalk.com/connect/oauth2/sns_authorize",
      appId: "test-app",
      cookies: [],
    };

    await pollDingTalkLogin(session);
    await pollDingTalkLogin(session);

    expect(reusedCookie).toBe("ding-session=ding-value");
  });
});
