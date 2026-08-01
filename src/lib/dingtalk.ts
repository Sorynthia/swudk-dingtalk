import "server-only";

import QRCode from "qrcode";

import {
  authenticateSession,
  clearPendingLoginData,
  createLoginSession,
  LOGIN_TTL_MS,
  type LoginSession,
} from "@/lib/session-store";
import { getStudentProfile } from "@/lib/swu";
import type { SessionPayload } from "@/lib/types";

const NEXT_URL = "https://of.swu.edu.cn/#/casLogin?from=%2FappCenter";
const CALLBACK_URL = "https://of.swu.edu.cn/cas/oauth/callback/DINGTALK";
const APP_ID = "dinggam4ayb6ahjixiez";
const QR_PAGE_URL = "https://login.dingtalk.com/login/qrcode.htm";
const QR_GENERATE_URL = "https://login.dingtalk.com/user/qrcode/generate";
const QR_POLL_URL = "https://login.dingtalk.com/login/login_with_qr";
const EXCHANGE_TOKEN_URL = "https://of.swu.edu.cn/gateway/fighter-middle/api/integrate/uaap/cas/exchange-token";
const SERVICE_URL = `https://of.swu.edu.cn/gateway/fighter-middle/api/integrate/uaap/cas/resolve-cas-return?next=${encodeURIComponent(NEXT_URL)}`;
const LOGIN_URL = `https://of.swu.edu.cn/cas/oauth/login/DINGTALK?service=${encodeURIComponent(SERVICE_URL)}`;
const ALLOWED_LOGIN_ORIGINS = new Set([
  "https://login.dingtalk.com",
  "https://oapi.dingtalk.com",
  "https://of.swu.edu.cn",
]);
const MAX_CONSECUTIVE_POLL_FAILURES = 3;
const ALLOWED_COOKIE_DOMAINS = new Set([
  "login.dingtalk.com",
  "oapi.dingtalk.com",
  "dingtalk.com",
  "of.swu.edu.cn",
  "swu.edu.cn",
]);

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  Referer: "https://login.dingtalk.com/",
};

interface DingTalkPayload {
  success?: boolean;
  result?: string;
  data?: string;
  code?: string | number;
  msg?: string;
  message?: string;
}

class UnsafeLoginRedirectError extends Error {}

/** @internal 仅导出以覆盖登录跳转边界测试。 */
export function assertAllowedLoginUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeLoginRedirectError("登录服务返回了无效跳转地址");
  }
  if (parsed.protocol !== "https:" || !ALLOWED_LOGIN_ORIGINS.has(parsed.origin)) {
    throw new UnsafeLoginRedirectError("登录服务返回了不受信任的跳转地址");
  }
  return parsed.toString();
}

function defaultCookiePath(pathname: string) {
  if (!pathname.startsWith("/") || pathname === "/") return "/";
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}

function domainMatches(hostname: string, domain: string, hostOnly: boolean) {
  return hostOnly ? hostname === domain : hostname === domain || hostname.endsWith(`.${domain}`);
}

function pathMatches(pathname: string, cookiePath: string) {
  return pathname === cookiePath || (
    pathname.startsWith(cookiePath) &&
    (cookiePath.endsWith("/") || pathname.charAt(cookiePath.length) === "/")
  );
}

function absorbCookies(
  session: Pick<LoginSession, "cookies">,
  requestUrl: string,
  response: Response,
) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.call(response.headers)
    ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie") as string] : []);
  if (setCookies.length === 0) return;

  const request = new URL(requestUrl);
  for (const value of setCookies) {
    const parts = value.split(";").map((part) => part.trim());
    const separator = parts[0]?.indexOf("=") ?? -1;
    if (separator <= 0) continue;
    const name = parts[0].slice(0, separator);
    const cookieValue = parts[0].slice(separator + 1);
    let domain = request.hostname.toLowerCase();
    let hostOnly = true;
    let path = defaultCookiePath(request.pathname);
    let secure = false;
    let expiresAt: number | undefined;

    for (const attribute of parts.slice(1)) {
      const attributeSeparator = attribute.indexOf("=");
      const key = (attributeSeparator < 0 ? attribute : attribute.slice(0, attributeSeparator)).toLowerCase();
      const attributeValue = attributeSeparator < 0 ? "" : attribute.slice(attributeSeparator + 1).trim();
      if (key === "domain" && attributeValue) {
        const candidate = attributeValue.replace(/^\./, "").toLowerCase();
        if (
          !ALLOWED_COOKIE_DOMAINS.has(candidate) ||
          !domainMatches(request.hostname.toLowerCase(), candidate, false)
        ) {
          domain = "";
          break;
        }
        domain = candidate;
        hostOnly = false;
      } else if (key === "path" && attributeValue.startsWith("/")) {
        path = attributeValue;
      } else if (key === "secure") {
        secure = true;
      } else if (key === "max-age" && /^-?\d+$/.test(attributeValue)) {
        expiresAt = Date.now() + Number(attributeValue) * 1000;
      } else if (key === "expires" && expiresAt === undefined) {
        const parsed = Date.parse(attributeValue);
        if (!Number.isNaN(parsed)) expiresAt = parsed;
      }
    }
    if (!domain) continue;

    const index = session.cookies.findIndex((cookie) =>
      cookie.name === name && cookie.domain === domain && cookie.path === path,
    );
    if (!cookieValue || (expiresAt !== undefined && expiresAt <= Date.now())) {
      if (index >= 0) session.cookies.splice(index, 1);
      continue;
    }
    const cookie = { name, value: cookieValue, domain, path, hostOnly, secure, expiresAt };
    if (index >= 0) session.cookies[index] = cookie;
    else session.cookies.push(cookie);
  }
}

async function requestWithCookies(
  session: Pick<LoginSession, "cookies">,
  url: string,
  init: RequestInit = {},
) {
  const safeUrl = assertAllowedLoginUrl(url);
  const parsedUrl = new URL(safeUrl);
  const now = Date.now();
  session.cookies = session.cookies.filter((cookie) => cookie.expiresAt === undefined || cookie.expiresAt > now);
  const cookie = session.cookies
    .filter((item) =>
      domainMatches(parsedUrl.hostname.toLowerCase(), item.domain, item.hostOnly) &&
      pathMatches(parsedUrl.pathname, item.path) &&
      (!item.secure || parsedUrl.protocol === "https:"),
    )
    .sort((left, right) => right.path.length - left.path.length)
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
  const headers = new Headers(DEFAULT_HEADERS);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (cookie) headers.set("Cookie", cookie);

  const response = await fetch(safeUrl, {
    ...init,
    headers,
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  absorbCookies(session, safeUrl, response);
  return response;
}

async function followRedirects(
  session: Pick<LoginSession, "cookies">,
  initialUrl: string,
  maxRedirects = 10,
) {
  let currentUrl = initialUrl;

  for (let index = 0; index <= maxRedirects; index += 1) {
    const response = await requestWithCookies(session, currentUrl);
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) {
      if (!response.ok) {
        throw new Error(`登录服务请求失败（HTTP ${response.status}）`);
      }
      return { response, url: currentUrl };
    }
    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error("登录服务重定向次数过多");
}

/** @internal 仅导出以覆盖登录回调解析测试。 */
export function extractState(url: string) {
  const decodedUrl = decodeURIComponent(decodeURIComponent(url));
  const state = new URL(decodedUrl).searchParams.get("state");
  if (!state) throw new Error("未能获取钉钉登录状态参数");
  return state;
}

async function readJson<T>(response: Response, context: string): Promise<T> {
  if (!response.ok) throw new Error(`${context}失败（HTTP ${response.status}）`);
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`${context}返回了无法解析的数据`);
  }
}

export async function startDingTalkLogin() {
  const pendingSession: Pick<LoginSession, "cookies"> = { cookies: [] };
  const { url: redirectUrl } = await followRedirects(pendingSession, LOGIN_URL);
  const state = extractState(redirectUrl);
  const goto =
    "https://oapi.dingtalk.com/connect/oauth2/sns_authorize?" +
    new URLSearchParams({
      response_type: "code",
      appid: APP_ID,
      scope: "snsapi_login",
      redirect_uri: CALLBACK_URL,
      state,
    });

  const qrPageUrl = new URL(QR_PAGE_URL);
  qrPageUrl.searchParams.set("goto", goto);
  const qrPageResponse = await requestWithCookies(pendingSession, qrPageUrl.toString());
  if (!qrPageResponse.ok) throw new Error(`钉钉登录页请求失败（HTTP ${qrPageResponse.status}）`);

  const generateUrl = new URL(QR_GENERATE_URL);
  generateUrl.searchParams.set("bizScene", "http_third_party");
  generateUrl.searchParams.set("sceneId", APP_ID);
  const generatePayload = await readJson<DingTalkPayload>(
    await requestWithCookies(pendingSession, generateUrl.toString()),
    "二维码生成",
  );
  if (!generatePayload.success || !generatePayload.result) {
    throw new Error(generatePayload.message || generatePayload.msg || "二维码生成失败");
  }

  const qrCode = generatePayload.result;
  const qrContent =
    "https://oapi.dingtalk.com/connect/qrcommit?" +
    new URLSearchParams({
      showmenu: "false",
      code: qrCode,
      appid: APP_ID,
      redirect_uri: CALLBACK_URL,
    });
  const qrImage = await QRCode.toDataURL(qrContent, {
    width: 320,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#272421", light: "#ffffff" },
  });

  return createLoginSession({
    expiresAt: Date.now() + LOGIN_TTL_MS,
    stage: "waiting",
    message: "等待扫码",
    qrImage,
    qrCode,
    goto,
    appId: APP_ID,
    cookies: pendingSession.cookies,
  });
}

/** @internal 仅导出以覆盖登录回调解析测试。 */
export function extractTicket(url: string) {
  const parsed = new URL(url);
  const fragment = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  const fragmentQuery = fragment.includes("?") ? fragment.split("?", 2)[1] : fragment;
  const ticket = parsed.searchParams.get("ticket") || new URLSearchParams(fragmentQuery).get("ticket");
  if (!ticket) throw new Error("校内登录回调未返回 ticket");
  return ticket;
}

async function completeLogin(session: LoginSession, redirectUrl: string) {
  const authorizeResponse = await requestWithCookies(session, redirectUrl);
  const callbackLocation = authorizeResponse.headers.get("location");
  if (!callbackLocation) throw new Error("钉钉授权未返回回调地址");

  const callbackUrl = new URL(callbackLocation, redirectUrl).toString();
  const { url: finalUrl } = await followRedirects(session, callbackUrl);
  const ticket = extractTicket(finalUrl);
  const exchangeUrl = new URL(EXCHANGE_TOKEN_URL);
  exchangeUrl.searchParams.set("token", ticket);
  exchangeUrl.searchParams.set("remember", "true");
  const exchangePayload = await readJson<{ data?: string }>(
    await requestWithCookies(session, exchangeUrl.toString()),
    "登录凭证交换",
  );
  if (!exchangePayload.data) throw new Error("校内服务未返回登录凭证");

  const profile = await getStudentProfile(exchangePayload.data);
  authenticateSession(session, exchangePayload.data, profile);
}

async function performPoll(session: LoginSession): Promise<SessionPayload> {
  if (session.stage === "authenticated" || session.stage === "expired" || session.stage === "error") {
    return { stage: session.stage, message: session.message, profile: session.profile };
  }
  if (Date.now() >= session.expiresAt) {
    session.stage = "expired";
    session.message = "二维码已过期";
    clearPendingLoginData(session);
    return { stage: session.stage, message: session.message };
  }

  try {
    const body = new URLSearchParams({
      qrCode: session.qrCode,
      goto: session.goto,
      pdmToken: "",
      bizScene: "http_third_party",
      sceneId: session.appId,
    });
    const payload = await readJson<DingTalkPayload>(
      await requestWithCookies(session, QR_POLL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Referer: QR_PAGE_URL,
        },
        body,
      }),
      "二维码状态查询",
    );
    session.pollFailureCount = 0;

    if (payload.success && payload.data) {
      await completeLogin(session, payload.data);
      return { stage: session.stage, message: session.message, profile: session.profile };
    }

    const statusCode = String(payload.code ?? "");
    if (statusCode === "11041") {
      session.stage = "scanned";
      session.message = "已扫码，请在钉钉中确认";
    } else if (statusCode === "11019") {
      session.stage = "expired";
      session.message = "二维码已过期";
      clearPendingLoginData(session);
    } else {
      session.stage = "waiting";
      session.message = "等待扫码";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录过程中发生未知错误";
    if (error instanceof UnsafeLoginRedirectError) {
      session.stage = "error";
      session.message = message;
      clearPendingLoginData(session);
    } else {
      session.pollFailureCount = (session.pollFailureCount ?? 0) + 1;
      if (session.pollFailureCount >= MAX_CONSECUTIVE_POLL_FAILURES) {
        session.stage = "error";
        session.message = message;
        clearPendingLoginData(session);
      } else {
        session.message = `登录服务暂时不稳定，正在重试（${session.pollFailureCount}/${MAX_CONSECUTIVE_POLL_FAILURES}）`;
      }
    }
  }

  return { stage: session.stage, message: session.message, profile: session.profile };
}

export function pollDingTalkLogin(session: LoginSession) {
  if (!session.pollPromise) {
    session.pollPromise = performPoll(session).finally(() => {
      session.pollPromise = undefined;
    });
  }
  return session.pollPromise;
}
