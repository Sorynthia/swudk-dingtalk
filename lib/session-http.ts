import "server-only";

import { cookies } from "next/headers";

import {
  deleteLoginSession,
  getSessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/session-store";

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin") || request.headers.get("referer");
  if (!origin) return false;
  
  try {
    const requestOrigin = new URL(request.url).origin;
    const headerOrigin = new URL(origin).origin;
    // 临时日志：调试部署环境的 origin 匹配问题
    if (headerOrigin !== requestOrigin) {
      console.error("[Origin Mismatch]", {
        requestUrl: request.url,
        requestOrigin,
        headerOrigin,
        originHeader: request.headers.get("origin"),
        refererHeader: request.headers.get("referer"),
      });
    }
    return headerOrigin === requestOrigin;
  } catch {
    return false;
  }
}

export async function invalidateSession(request: Request, sessionId: string | undefined) {
  deleteLoginSession(sessionId);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", { ...getSessionCookieOptions(request), maxAge: 0 });
}
