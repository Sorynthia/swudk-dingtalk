import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { startDingTalkLogin } from "@/lib/dingtalk";
import {
  deleteLoginSession,
  getSessionCookieOptions,
  getLoginSession,
  SESSION_COOKIE,
} from "@/lib/session-store";
import { acquireQrGenerationLease } from "@/lib/qr-rate-limit";
import { serviceUnavailableResponse } from "@/lib/service-http";
import { isServiceEnabled } from "@/lib/service-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isServiceEnabled()) return serviceUnavailableResponse();
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
    const lease = acquireQrGenerationLease(request, previousSession?.id);
    if (!lease) {
      return NextResponse.json(
        { stage: "error", message: "二维码生成请求过于频繁，请稍后再试" },
        { status: 429, headers: { "Retry-After": "120" } },
      );
    }

    try {
      const session = await startDingTalkLogin();
      deleteLoginSession(previousSessionId);
      cookieStore.set(SESSION_COOKIE, session.id, getSessionCookieOptions(request));

      return NextResponse.json({
        stage: session.stage,
        message: session.message,
        qrImage: session.qrImage,
        expiresAt: session.expiresAt,
      });
    } finally {
      lease.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "二维码生成失败";
    return NextResponse.json({ stage: "error", message }, { status: 502 });
  }
}
