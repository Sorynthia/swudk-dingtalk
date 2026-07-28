import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  deleteLoginSession: vi.fn(),
  getLoginSession: vi.fn(),
  getCheckInStatus: vi.fn(),
  getStudentProfile: vi.fn(),
  pollDingTalkLogin: vi.fn(),
  startDingTalkLogin: vi.fn(),
  submitCheckIn: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => ({ value: "old-session" })),
    set: mocks.cookieSet,
  })),
}));
vi.mock("@/lib/dingtalk", () => ({
  pollDingTalkLogin: mocks.pollDingTalkLogin,
  startDingTalkLogin: mocks.startDingTalkLogin,
}));
vi.mock("@/lib/session-store", () => ({
  SESSION_COOKIE: "swu_portal_session",
  deleteLoginSession: mocks.deleteLoginSession,
  getLoginSession: mocks.getLoginSession,
  getSessionCookieOptions: vi.fn(() => ({})),
  persistAuthenticatedSession: vi.fn(),
}));
vi.mock("@/lib/session-http", () => ({
  invalidateSession: vi.fn(),
  isSameOriginRequest: vi.fn(() => true),
}));
vi.mock("@/lib/swu", () => ({
  getCheckInStatus: mocks.getCheckInStatus,
  getStudentProfile: mocks.getStudentProfile,
  isSwuUnauthorizedError: vi.fn(() => false),
  submitCheckIn: mocks.submitCheckIn,
}));

import { POST as createQr } from "@/app/api/auth/qr/route";
import { GET as pollStatus } from "@/app/api/auth/status/route";
import { DELETE as logout, GET as readSession } from "@/app/api/auth/session/route";
import { POST as refreshProfile } from "@/app/api/profile/route";
import { GET as readCheckIn, POST as submitCheckIn } from "@/app/api/check-in/route";

const sameOriginRequest = (url: string, method = "GET") => new Request(`http://localhost${url}`, {
  method,
  headers: method === "GET" ? undefined : { Origin: "http://localhost" },
});

describe("服务关闭时的业务接口", () => {
  beforeEach(() => {
    process.env.SERVICE_ENABLED = "false";
    vi.clearAllMocks();
  });

  it.each([
    ["生成二维码", () => createQr(sameOriginRequest("/api/auth/qr", "POST"))],
    ["轮询登录", () => pollStatus()],
    ["读取会话", () => readSession()],
    ["刷新资料", () => refreshProfile(sameOriginRequest("/api/profile", "POST"))],
    ["查询签到", () => readCheckIn(sameOriginRequest("/api/check-in"))],
    ["提交签到", () => submitCheckIn(sameOriginRequest("/api/check-in", "POST"))],
  ])("%s 返回 503", async (_name, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: "服务暂未开放，请稍后再试" });
  });

  it("不调用会话、钉钉或校内业务函数", async () => {
    await createQr(sameOriginRequest("/api/auth/qr", "POST"));
    await pollStatus();
    await readSession();
    await readCheckIn(sameOriginRequest("/api/check-in"));
    expect(mocks.getLoginSession).not.toHaveBeenCalled();
    expect(mocks.startDingTalkLogin).not.toHaveBeenCalled();
    expect(mocks.pollDingTalkLogin).not.toHaveBeenCalled();
    expect(mocks.getCheckInStatus).not.toHaveBeenCalled();
  });

  it("退出登录仍清理旧会话", async () => {
    const response = await logout(sameOriginRequest("/api/auth/session", "DELETE"));
    expect(response.status).toBe(200);
    expect(mocks.deleteLoginSession).toHaveBeenCalledWith("old-session");
    expect(mocks.cookieSet).toHaveBeenCalled();
  });
});
