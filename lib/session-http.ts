import "server-only";

import { cookies } from "next/headers";

import {
  deleteLoginSession,
  getSessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/session-store";

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function invalidateSession(request: Request, sessionId: string | undefined) {
  deleteLoginSession(sessionId);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", { ...getSessionCookieOptions(request), maxAge: 0 });
}
