import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { startDingTalkLogin } from "@/lib/dingtalk";
import {
  deleteLoginSession,
  getSessionCookieOptions,
  getLoginSession,
  SESSION_COOKIE,
} from "@/lib/session-store";
import { isSameOriginRequest } from "@/lib/session-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ stage: "error", message: "请求来源无效" }, { status: 403 });
  }
  try {
    const cookieStore = await cookies();
    const previousSessionId = cookieStore.get(SESSION_COOKIE)?.value;
    const previousSession = getLoginSession(previousSessionId);
    if (previousSession?.stage === "waiting" || previousSession?.stage === "scanned") {
      return NextResponse.json({
        stage: previousSession.stage,
        message: previousSession.message,
        qrImage: previousSession.qrImage,
        expiresAt: previousSession.expiresAt,
      });
    }
    const session = await startDingTalkLogin();
    deleteLoginSession(previousSessionId);
    cookieStore.set(SESSION_COOKIE, session.id, getSessionCookieOptions(request));

    return NextResponse.json({
      stage: session.stage,
      message: session.message,
      qrImage: session.qrImage,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "二维码生成失败";
    return NextResponse.json({ stage: "error", message }, { status: 502 });
  }
}
