import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CheckInStatus, SessionPayload, StudentProfile } from "@/lib/types";

const hookState = vi.hoisted(() => ({
  stateCursor: 0,
  refCursor: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
    useEffect: () => undefined,
    useRef: <T,>(initialValue: T) => {
      const index = hookState.refCursor++;
      hookState.refs[index] ??= { current: initialValue };
      return hookState.refs[index] as { current: T };
    },
    useState: <T,>(initialValue: T | (() => T)) => {
      const index = hookState.stateCursor++;
      if (!(index in hookState.states)) {
        hookState.states[index] = typeof initialValue === "function"
          ? (initialValue as () => T)()
          : initialValue;
      }
      const setValue = (nextValue: T | ((current: T) => T)) => {
        const current = hookState.states[index] as T;
        hookState.states[index] = typeof nextValue === "function"
          ? (nextValue as (value: T) => T)(current)
          : nextValue;
      };
      return [hookState.states[index] as T, setValue] as const;
    },
  };
});

import AppShell, { readPayload } from "@/components/app-shell";

interface DashboardProps {
  initialCheckInStatus?: CheckInStatus;
  initialCheckInError?: string;
  onSessionExpired: () => void;
}

interface LoginProps {
  onRetry: () => Promise<void>;
}

function renderAppShell(
  initialPayload: SessionPayload,
  initialCheckInStatus?: CheckInStatus,
  initialCheckInError?: string,
) {
  hookState.stateCursor = 0;
  hookState.refCursor = 0;
  const element = AppShell({
    serviceEnabled: true,
    initialPayload,
    initialCheckInStatus,
    initialCheckInError,
  });
  const renderEnabled = element.type as (props: object) => ReactElement;
  return renderEnabled(element.props);
}

describe("客户端会话切换", () => {
  it("拒绝只有错误消息但缺少会话状态的 API 响应", async () => {
    const response = new Response(JSON.stringify({ message: "服务暂未开放，请稍后再试" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });

    await expect(readPayload(response)).rejects.toThrow("服务暂未开放，请稍后再试");
  });

  beforeEach(() => {
    hookState.stateCursor = 0;
    hookState.refCursor = 0;
    hookState.states.length = 0;
    hookState.refs.length = 0;
    vi.unstubAllGlobals();
  });

  it("服务关闭时只渲染维护界面", () => {
    const maintenanceElement = AppShell({
      serviceEnabled: false,
      initialPayload: { stage: "unauthenticated" },
    }) as ReactElement<Record<string, unknown>>;
    const renderMaintenance = maintenanceElement.type as (
      props: Record<string, unknown>,
    ) => ReactElement<Record<string, unknown>>;
    const maintenanceRoot = renderMaintenance(maintenanceElement.props);

    expect(maintenanceRoot.props["data-service-state"]).toBe("disabled");
  });

  it("顶栏与个人网站同宽并只显示中文品牌文字", () => {
    const html = renderToStaticMarkup(
      AppShell({
        serviceEnabled: false,
        initialPayload: { stage: "unauthenticated" },
      }),
    );

    expect(html).toContain('src="/icon.svg"');
    expect(html).toContain("钉钉扫码打卡");
    expect(html).not.toContain("SWU钉钉扫码打卡");
    expect(html).not.toContain("西大寝签");
    expect(html).not.toContain("SWU Campus");
    expect(html).toMatch(
      /<header[^>]*class="[^"]*sticky top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4[^"]*">/,
    );
    expect(html).toMatch(
      /<header[\s\S]*?<div[^>]*class="[^"]*mx-auto[^"]*h-14[^"]*w-full[^"]*max-w-5xl[^"]*sm:h-16[^"]*">/,
    );
  });

  it("重新登录后不复用首次服务端渲染的签到状态", async () => {
    const firstProfile: StudentProfile = {
      studentId: "20260001",
      dormitory: null,
      updatedAt: "2026-07-22T00:00:00.000Z",
    };
    const secondProfile: StudentProfile = {
      studentId: "20260002",
      dormitory: null,
      updatedAt: "2026-07-22T01:00:00.000Z",
    };
    const initialPayload: SessionPayload = {
      stage: "authenticated",
      profile: firstProfile,
    };
    const oldStatus: CheckInStatus = {
      state: "checked_in",
      message: "今日临时签到已完成",
    };
    const oldError = "旧会话签到状态查询失败";

    const firstDashboard = renderAppShell(
      initialPayload,
      oldStatus,
      oldError,
    ) as ReactElement<DashboardProps>;
    firstDashboard.props.onSessionExpired();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      stage: "authenticated",
      profile: secondProfile,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    const loginScreen = renderAppShell(initialPayload, oldStatus, oldError) as ReactElement<LoginProps>;
    await loginScreen.props.onRetry();

    const secondDashboard = renderAppShell(
      initialPayload,
      oldStatus,
      oldError,
    ) as ReactElement<DashboardProps>;
    expect(secondDashboard.props.initialCheckInStatus).toBeUndefined();
    expect(secondDashboard.props.initialCheckInError).toBeUndefined();
  });
});
