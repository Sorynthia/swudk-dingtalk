import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: {
    id: "session-id",
    stage: "authenticated",
    token: "test-token",
    checkInPromise: undefined as Promise<unknown> | undefined,
  },
  getCheckInStatus: vi.fn(),
  invalidateSession: vi.fn(),
  isSwuUnauthorizedError: vi.fn<(value: unknown) => boolean>(() => false),
  submitCheckIn: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => ({ value: "session-id" })) })),
}));
vi.mock("@/lib/session-store", () => ({
  SESSION_COOKIE: "swu_portal_session",
  getLoginSession: vi.fn(() => mocks.session),
}));
vi.mock("@/lib/session-http", () => ({
  invalidateSession: mocks.invalidateSession,
  isSameOriginRequest: vi.fn(() => true),
}));
vi.mock("@/lib/swu", () => ({
  getCheckInStatus: mocks.getCheckInStatus,
  isSwuUnauthorizedError: mocks.isSwuUnauthorizedError,
  submitCheckIn: mocks.submitCheckIn,
}));

import { GET, POST } from "@/app/api/check-in/route";

describe("签到接口并发保护", () => {
  beforeEach(() => {
    process.env.SERVICE_ENABLED = "true";
    mocks.session.checkInPromise = undefined;
    mocks.getCheckInStatus.mockReset();
    mocks.invalidateSession.mockReset();
    mocks.isSwuUnauthorizedError.mockReset();
    mocks.isSwuUnauthorizedError.mockReturnValue(false);
  });

  it("同一会话的并发请求只提交一次", async () => {
    let resolveSubmission: ((value: { state: string; message: string }) => void) | undefined;
    mocks.submitCheckIn.mockReturnValueOnce(new Promise((resolve) => {
      resolveSubmission = resolve;
    }));

    const request = () => new Request("http://localhost/api/check-in", {
      method: "POST",
      headers: { Origin: "http://localhost" },
    });
    const first = POST(request());
    const second = POST(request());
    await vi.waitFor(() => expect(mocks.submitCheckIn).toHaveBeenCalledTimes(1));
    resolveSubmission?.({ state: "checked_in", message: "已完成" });

    const responses = await Promise.all([first, second]);
    expect(await responses[0].json()).toEqual({ status: { state: "checked_in", message: "已完成" } });
    expect(await responses[1].json()).toEqual({ status: { state: "checked_in", message: "已完成" } });
  });

  it("上游认证失效时清除会话并返回 401", async () => {
    const error = new Error("token 已失效");
    mocks.getCheckInStatus.mockRejectedValueOnce(error);
    mocks.isSwuUnauthorizedError.mockImplementationOnce((value) => value === error);

    const response = await GET(new Request("http://localhost/api/check-in"));
    expect(response.status).toBe(401);
    expect(mocks.invalidateSession).toHaveBeenCalledWith(expect.any(Request), "session-id");
  });
});
