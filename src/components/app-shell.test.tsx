import type { ReactElement } from "react";
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

import AppShell from "@/components/app-shell";

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
  return AppShell({
    initialPayload,
    initialCheckInStatus,
    initialCheckInError,
  });
}

describe("客户端会话切换", () => {
  beforeEach(() => {
    hookState.stateCursor = 0;
    hookState.refCursor = 0;
    hookState.states.length = 0;
    hookState.refs.length = 0;
    vi.unstubAllGlobals();
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
