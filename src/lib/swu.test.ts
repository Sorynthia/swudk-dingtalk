import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCheckInStatus,
  getStudentProfile,
  submitCheckIn,
  SwuUnauthorizedError,
} from "@/lib/swu";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const dormitoryPayload = {
  code: 200,
  data: {
    columnList: [
      { latitude: 29.8, longitude: 106.4 },
      { value: "学生园区 1 舍" },
      { value: "500 米" },
    ],
  },
};

describe("校内资料和签到逻辑", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("只向前端资料返回必要住宿字段", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/auth/user")) {
        return jsonResponse({ code: 200, data: { subject: { username: "20260001" } } });
      }
      return jsonResponse(dormitoryPayload);
    }));

    const profile = await getStudentProfile("test-token");
    expect(profile.dormitory).toEqual({
      address: "学生园区 1 舍",
      checkInRadius: "500 米",
    });
    expect(JSON.stringify(profile)).not.toContain("latitude");
    expect(JSON.stringify(profile)).not.toContain("longitude");
  });

  it("将上游 401 转换为登录失效错误", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "未登录" }, 401)));
    await expect(getStudentProfile("expired-token")).rejects.toBeInstanceOf(SwuUnauthorizedError);
  });

  it("当前时间处于已批准请假区间时无需签到", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T14:00:00Z"));
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        code: 200,
        data: {
          records: [
            {
              lcztmc: "已同意",
              kssj: "2026-07-16 21:00",
              jssj: "2026-07-16 23:00",
            },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCheckInStatus("test-token")).resolves.toEqual({
      state: "on_leave",
      message: "当前处于已批准的请假时段，无需签到",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("提交后重新查询并确认已签到", async () => {
    let transitionCalls = 0;
    let submittedBody: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("listSelfLeaveData")) {
        return jsonResponse({ code: 200, data: { records: [] } });
      }
      if (url.includes("getTransitionByToday")) {
        transitionCalls += 1;
        return jsonResponse({
          code: 200,
          data: {
            records: [{ id: "task-1", formId: "form-1", qdzt: transitionCalls > 1 ? "已签到" : "未签到" }],
          },
        });
      }
      if (url.includes("/api/auth/user")) {
        return jsonResponse({ code: 200, data: { subject: { username: "20260001" } } });
      }
      if (url.includes("getDormitory")) {
        return jsonResponse({
          code: 200,
          data: {
            columnList: [
              { latitude: 29.8, longitude: 106.4 },
              { value: "学生园区 1 舍" },
              { value: 500 },
            ],
          },
        });
      }
      if (url.includes("form-instance/save")) {
        submittedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ code: 200, message: "保存成功" });
      }
      throw new Error(`未处理的测试 URL: ${url}`);
    }));

    await expect(submitCheckIn("test-token")).resolves.toEqual({
      state: "checked_in",
      message: "临时签到已完成",
    });
    expect(submittedBody).toMatchObject({
      id: "task-1",
      formId: "form-1",
      xh: "20260001",
      qdbj: "500",
    });
    expect(transitionCalls).toBe(2);
  });

  it.each([
    ["空白纬度", " ", 106.4, "住宿信息缺少纬度"],
    ["越界纬度", 91, 106.4, "住宿信息中的纬度无效"],
    ["越界经度", 29.8, 181, "住宿信息中的经度无效"],
  ])("拒绝%s", async (_caseName, latitude, longitude, expectedMessage) => {
    let transitionCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("listSelfLeaveData")) {
        return jsonResponse({ code: 200, data: { records: [] } });
      }
      if (url.includes("getTransitionByToday")) {
        transitionCalls += 1;
        return jsonResponse({
          code: 200,
          data: {
            records: [{ id: "task-1", formId: "form-1", qdzt: transitionCalls > 1 ? "已签到" : "未签到" }],
          },
        });
      }
      if (url.includes("/api/auth/user")) {
        return jsonResponse({ code: 200, data: { subject: { username: "20260001" } } });
      }
      if (url.includes("getDormitory")) {
        return jsonResponse({
          code: 200,
          data: {
            columnList: [
              { latitude, longitude },
              { value: "学生园区 1 舍" },
              { value: "500 米" },
            ],
          },
        });
      }
      if (url.includes("form-instance/save")) {
        return jsonResponse({ code: 200, message: "保存成功" });
      }
      throw new Error(`未处理的测试 URL: ${url}`);
    }));

    await expect(submitCheckIn("test-token")).rejects.toThrow(expectedMessage);
  });

  it("HTTP 200 的业务失败不会被报告为签到成功", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("listSelfLeaveData")) return jsonResponse({ code: 200, data: { records: [] } });
      if (url.includes("getTransitionByToday")) {
        return jsonResponse({ code: 200, data: { records: [{ id: "task-1", formId: "form-1", qdzt: "未签到" }] } });
      }
      if (url.includes("/api/auth/user")) {
        return jsonResponse({ code: 200, data: { subject: { username: "20260001" } } });
      }
      if (url.includes("getDormitory")) return jsonResponse(dormitoryPayload);
      if (url.includes("form-instance/save")) {
        return jsonResponse({ success: false, code: 500, message: "保存失败" });
      }
      throw new Error(`未处理的测试 URL: ${url}`);
    }));

    await expect(submitCheckIn("test-token")).rejects.toThrow("保存失败");
  });

  it("学生信息业务失败时不会提交签到", async () => {
    let saveCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("listSelfLeaveData")) {
        return jsonResponse({ code: 200, data: { records: [] } });
      }
      if (url.includes("getTransitionByToday")) {
        return jsonResponse({ code: 200, data: { records: [{ id: "task-1", formId: "form-1", qdzt: "未签到" }] } });
      }
      if (url.includes("/api/auth/user")) {
        return jsonResponse({
          success: false,
          code: 500,
          message: "学生信息查询失败",
          data: { subject: { username: "20260001" } },
        });
      }
      if (url.includes("getDormitory")) return jsonResponse(dormitoryPayload);
      if (url.includes("form-instance/save")) {
        saveCalls += 1;
        return jsonResponse({ code: 200, message: "保存成功" });
      }
      throw new Error(`未处理的测试 URL: ${url}`);
    }));

    await expect(submitCheckIn("test-token")).rejects.toThrow("学生信息查询失败");
    expect(saveCalls).toBe(0);
  });
});
