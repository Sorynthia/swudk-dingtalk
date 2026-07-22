import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import type { CheckInStatus, LoginStage, SessionPayload, StudentProfile } from "@/lib/types";

export const SESSION_COOKIE = "swu_portal_session";
export const LOGIN_TTL_MS = 2 * 60 * 1000;
const AUTHENTICATED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_DATA_DIRECTORY = join(/*turbopackIgnore: true*/ process.cwd(), ".data");
const DATA_DIRECTORY = process.env.SESSION_DATA_DIR
  ? resolve(process.env.SESSION_DATA_DIR)
  : DEFAULT_DATA_DIRECTORY;

export type LoginCookieStore = Map<string, Map<string, string>>;

interface PersistedSession {
  version: 2;
  id: string;
  createdAt: number;
  expiresAt: number;
  token: string;
  profile: unknown;
}

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

function ensureDataDirectory() {
  mkdirSync(DATA_DIRECTORY, { recursive: true });
}

function getEncryptionKey() {
  const configuredSecret = process.env.SESSION_SECRET;
  if (!configuredSecret || configuredSecret.length < 32) {
    throw new Error("SESSION_SECRET 未配置或长度不足 32 个字符");
  }
  return createHash("sha256").update(configuredSecret).digest();
}

function persistedSessionPath(id: string) {
  if (!SESSION_ID_PATTERN.test(id)) throw new Error("会话标识格式无效");
  return join(DATA_DIRECTORY, `${id}.session`);
}

function removePersistedSession(id: string) {
  if (!SESSION_ID_PATTERN.test(id)) return;
  const path = persistedSessionPath(id);
  if (existsSync(path)) unlinkSync(path);
}

function sealSession(payload: PersistedSession) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function openSession(value: string): PersistedSession {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".", 4);
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("本机会话数据格式无效");
  }

  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(decrypted) as PersistedSession;
}

function normalizeProfile(value: unknown): StudentProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const profile = value as Record<string, unknown>;
  if (typeof profile.studentId !== "string" || typeof profile.updatedAt !== "string") return undefined;

  const rawDormitory = profile.dormitory;
  if (rawDormitory === null) {
    return { studentId: profile.studentId, dormitory: null, updatedAt: profile.updatedAt };
  }
  let dormitory: StudentProfile["dormitory"];
  if (rawDormitory && typeof rawDormitory === "object" && !Array.isArray(rawDormitory)) {
    const record = rawDormitory as Record<string, unknown>;
    const address = record.address;
    const checkInRadius = record.checkInRadius;
    if (
      (typeof address !== "string" && address !== null) ||
      (typeof checkInRadius !== "string" && checkInRadius !== null)
    ) return undefined;
    dormitory = { address, checkInRadius };
  } else {
    return undefined;
  }

  return { studentId: profile.studentId, dormitory, updatedAt: profile.updatedAt };
}

function loadPersistedSession(id: string): LoginSession | undefined {
  if (!SESSION_ID_PATTERN.test(id)) return undefined;
  const path = persistedSessionPath(id);
  if (!existsSync(path)) return undefined;

  try {
    const persisted = openSession(readFileSync(path, "utf8"));
    const profile = normalizeProfile(persisted.profile);
    if (
      persisted.version !== 2 ||
      persisted.id !== id ||
      typeof persisted.createdAt !== "number" ||
      typeof persisted.expiresAt !== "number" ||
      persisted.expiresAt <= Date.now() ||
      typeof persisted.token !== "string" || !persisted.token ||
      !profile
    ) {
      removePersistedSession(id);
      return undefined;
    }

    const session: LoginSession = {
      id,
      createdAt: persisted.createdAt,
      expiresAt: persisted.expiresAt,
      stage: "authenticated",
      message: "已从本机恢复登录",
      qrImage: "",
      qrCode: "",
      goto: "",
      appId: "",
      cookies: new Map(),
      token: persisted.token,
      profile,
    };
    sessions.set(id, session);
    return session;
  } catch {
    removePersistedSession(id);
    return undefined;
  }
}

function clearExpiredSessions(now = Date.now()) {
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(id);
      removePersistedSession(id);
    }
  }
}

export function createLoginSession(initial: Omit<LoginSession, "id" | "createdAt">) {
  clearExpiredSessions();
  const session: LoginSession = {
    ...initial,
    id: randomUUID(),
    createdAt: Date.now(),
  };
  sessions.set(session.id, session);
  return session;
}

export function getLoginSession(id: string | undefined) {
  if (!id) return undefined;
  const session = sessions.get(id) ?? loadPersistedSession(id);
  if (!session) return undefined;
  if (session.expiresAt <= Date.now()) {
    if (session.stage === "waiting" || session.stage === "scanned" || session.stage === "expired") {
      session.stage = "expired";
      session.message = "二维码已过期";
      clearPendingLoginData(session);
      return session;
    }
    sessions.delete(id);
    removePersistedSession(id);
    return undefined;
  }
  return session;
}

export function clearPendingLoginData(session: LoginSession) {
  session.qrImage = "";
  session.qrCode = "";
  session.goto = "";
  session.appId = "";
  session.cookies.clear();
  session.pollFailureCount = undefined;
}

function writeAuthenticatedSession(
  session: LoginSession,
  token: string,
  profile: StudentProfile,
  expiresAt: number,
) {
  if (sessions.get(session.id) !== session) return false;
  ensureDataDirectory();
  writeFileSync(
    persistedSessionPath(session.id),
    sealSession({
      version: 2,
      id: session.id,
      createdAt: session.createdAt,
      expiresAt,
      token,
      profile,
    }),
    { encoding: "utf8", mode: 0o600 },
  );
  return true;
}

export function persistAuthenticatedSession(session: LoginSession) {
  if (session.stage !== "authenticated" || !session.token || !session.profile) return false;
  return writeAuthenticatedSession(session, session.token, session.profile, session.expiresAt);
}

export function authenticateSession(session: LoginSession, token: string, profile: StudentProfile) {
  if (
    sessions.get(session.id) !== session ||
    (session.stage !== "waiting" && session.stage !== "scanned") ||
    session.expiresAt <= Date.now()
  ) {
    throw new Error("登录会话已失效");
  }
  const expiresAt = Date.now() + AUTHENTICATED_TTL_MS;
  if (!writeAuthenticatedSession(session, token, profile, expiresAt)) {
    throw new Error("登录会话已失效");
  }

  session.stage = "authenticated";
  session.message = "登录成功";
  session.token = token;
  session.profile = profile;
  session.expiresAt = expiresAt;
  clearPendingLoginData(session);
}

export function deleteLoginSession(id: string | undefined) {
  if (!id) return;
  sessions.delete(id);
  removePersistedSession(id);
}

export function getSessionCookieOptions(request: Request) {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0].trim();
  const secure = forwardedProtocol ? forwardedProtocol === "https" : new URL(request.url).protocol === "https:";

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: AUTHENTICATED_TTL_MS / 1000,
  };
}
