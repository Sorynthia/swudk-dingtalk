import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { pollDingTalkLogin } from "@/lib/dingtalk";
import { getLoginSession, SESSION_COOKIE } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const session = getLoginSession(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { stage: "unauthenticated", message: "登录会话不存在或已过期" },
      { status: 401 },
    );
  }

  return NextResponse.json(await pollDingTalkLogin(session));
}
