import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  deleteLoginSession,
  getSessionCookieOptions,
  getLoginSession,
  SESSION_COOKIE,
} from "@/lib/session-store";
import { isSameOriginRequest } from "@/lib/session-http";
import { serviceUnavailableResponse } from "@/lib/service-http";
import { isServiceEnabled } from "@/lib/service-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isServiceEnabled()) return serviceUnavailableResponse();
  const cookieStore = await cookies();
  const session = getLoginSession(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ stage: "unauthenticated" });

  return NextResponse.json({
    stage: session.stage,
    message: session.message,
    qrImage: session.stage === "waiting" || session.stage === "scanned" ? session.qrImage : undefined,
    expiresAt: session.stage === "waiting" || session.stage === "scanned" ? session.expiresAt : undefined,
    profile: session.stage === "authenticated" ? session.profile : undefined,
  });
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ message: "请求来源无效" }, { status: 403 });
  }
  const cookieStore = await cookies();
  deleteLoginSession(cookieStore.get(SESSION_COOKIE)?.value);
  cookieStore.set(SESSION_COOKIE, "", { ...getSessionCookieOptions(request), maxAge: 0 });
  return NextResponse.json({ stage: "unauthenticated" });
}
