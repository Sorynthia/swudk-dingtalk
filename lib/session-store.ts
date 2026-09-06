import "server-only";

import { randomUUID } from "node:crypto";

import type { CheckInStatus, LoginStage, SessionPayload, StudentProfile } from "@/lib/types";

export const SESSION_COOKIE = "swu_portal_session";
export const LOGIN_TTL_MS = 2 * 60 * 1000;
const AUTHENTICATED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface LoginCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  hostOnly: boolean;
  secure: boolean;
  expiresAt?: number;
}

export type LoginCookieStore = LoginCookie[];

export interface LoginSession {
  id: string;
  createdAt: number;
  expiresAt: number;
  stage: LoginStage;
  message: string;
  qrImage: string;
  qrCode: string;
  goto: string;
  appId: string;
  cookies: LoginCookieStore;
  token?: string;
  profile?: StudentProfile;
  pollPromise?: Promise<SessionPayload>;
  pollFailureCount?: number;
  checkInPromise?: Promise<CheckInStatus>;
}

declare global {
  var swuLoginSessions: Map<string, LoginSession> | undefined;
}

const sessions = globalThis.swuLoginSessions ?? new Map<string, LoginSession>();
globalThis.swuLoginSessions = sessions;

function clearExpiredSessions(now = Date.now()) {
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

export function createLoginSession(initial: Omit<LoginSession, "id" | "createdAt">) {
  clearExpiredSessions();
  const session: LoginSession = { ...initial, id: randomUUID(), createdAt: Date.now() };
  sessions.set(session.id, session);
  return session;
}

export function getLoginSession(id: string | undefined) {
  if (!id) return undefined;
  const session = sessions.get(id);
  if (!session) return undefined;
  if (session.expiresAt <= Date.now()) {
    if (session.stage === "waiting" || session.stage === "scanned" || session.stage === "expired") {
      session.stage = "expired";
      session.message = "二维码已过期";
      clearPendingLoginData(session);
      session.expiresAt = Date.now();
      return session;
    }
    sessions.delete(id);
    return undefined;
  }
  return session;
}

export function clearPendingLoginData(session: LoginSession) {
  session.qrImage = "";
  session.qrCode = "";
  session.goto = "";
  session.appId = "";
  session.cookies.length = 0;
  session.pollFailureCount = undefined;
}

export function authenticateSession(session: LoginSession, token: string, profile: StudentProfile) {
  if (
    sessions.get(session.id) !== session
    || (session.stage !== "waiting" && session.stage !== "scanned")
    || session.expiresAt <= Date.now()
  ) {
    throw new Error("登录会话已失效");
  }
  session.stage = "authenticated";
  session.message = "登录成功";
  session.token = token;
  session.profile = profile;
  session.expiresAt = Date.now() + AUTHENTICATED_TTL_MS;
  clearPendingLoginData(session);
}

export function deleteLoginSession(id: string | undefined) {
  if (id) sessions.delete(id);
}

export function getSessionCookieOptions(request: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: AUTHENTICATED_TTL_MS / 1000,
  };
}
