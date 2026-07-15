import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  getLoginSession,
  persistAuthenticatedSession,
  SESSION_COOKIE,
} from "@/lib/session-store";
import { invalidateSession, isSameOriginRequest } from "@/lib/session-http";
import { getStudentProfile, isSwuUnauthorizedError } from "@/lib/swu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ message: "请求来源无效" }, { status: 403 });
  }
  const cookieStore = await cookies();
  const session = getLoginSession(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session?.token || session.stage !== "authenticated") {
    return NextResponse.json({ message: "请重新登录" }, { status: 401 });
  }

  try {
    session.profile = await getStudentProfile(session.token);
    persistAuthenticatedSession(session);
    return NextResponse.json({ profile: session.profile });
  } catch (error) {
    if (isSwuUnauthorizedError(error)) {
      await invalidateSession(request, session.id);
      return NextResponse.json({ message: "登录状态已失效，请重新登录" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "信息刷新失败";
    return NextResponse.json({ message }, { status: 502 });
  }
}
