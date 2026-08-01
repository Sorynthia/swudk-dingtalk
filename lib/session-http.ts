import "server-only";

import { cookies } from "next/headers";

import {
  deleteLoginSession,
  getSessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/session-store";

export function getExpectedAppOrigin(request?: Request) {
  const configuredOrigin = process.env.APP_ORIGIN?.trim();
  if (!configuredOrigin) {
    if (process.env.NODE_ENV === "production") return undefined;
    return request ? new URL(request.url).origin : undefined;
  }

  try {
    const parsed = new URL(configuredOrigin);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) return undefined;
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  return origin === getExpectedAppOrigin(request);
}

export async function invalidateSession(request: Request, sessionId: string | undefined) {
  deleteLoginSession(sessionId);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", { ...getSessionCookieOptions(request), maxAge: 0 });
}
