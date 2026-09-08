import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getLoginSession, SESSION_COOKIE } from "@/lib/session-store";
import { invalidateSession } from "@/lib/session-http";
import {
  getCheckInStatus,
  isSwuUnauthorizedError,
  submitCheckIn,
} from "@/lib/swu";
import { serviceUnavailableResponse } from "@/lib/service-http";
import { isServiceEnabled } from "@/lib/service-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getAuthenticatedSession() {
  const cookieStore = await cookies();
  const session = getLoginSession(cookieStore.get(SESSION_COOKIE)?.value);
  return session?.stage === "authenticated" && session.token ? session : undefined;
}

export async function GET(request: Request) {
  if (!isServiceEnabled()) return serviceUnavailableResponse();
  const session = await getAuthenticatedSession();
  if (!session?.token) return NextResponse.json({ message: "请重新登录" }, { status: 401 });

  try {
    return NextResponse.json({ status: await getCheckInStatus(session.token) });
  } catch (error) {
    if (isSwuUnauthorizedError(error)) {
      await invalidateSession(request, session.id);
      return NextResponse.json({ message: "登录状态已失效，请重新登录" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "签到状态查询失败";
    return NextResponse.json({ message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!isServiceEnabled()) return serviceUnavailableResponse();
  const session = await getAuthenticatedSession();
  if (!session?.token) return NextResponse.json({ message: "请重新登录" }, { status: 401 });

  try {
    if (!session.checkInPromise) {
      session.checkInPromise = submitCheckIn(session.token).finally(() => {
        session.checkInPromise = undefined;
      });
    }
    return NextResponse.json({ status: await session.checkInPromise });
  } catch (error) {
    if (isSwuUnauthorizedError(error)) {
      await invalidateSession(request, session.id);
      return NextResponse.json({ message: "登录状态已失效，请重新登录" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "临时签到失败";
    return NextResponse.json({ message }, { status: 502 });
  }
}
