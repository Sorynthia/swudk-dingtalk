import "server-only";

import type { ApiRecord, CheckInStatus, StudentProfile } from "@/lib/types";

const USER_URL = "https://of.swu.edu.cn/gateway/fighter-middle/api/auth/user?appType=fighter-portal";
const DORMITORY_URL = "https://of.swu.edu.cn/gateway/fighter-baida/api/cqlc/getDormitory";
const TRANSITION_URL = "https://of.swu.edu.cn/gateway/fighter-baida/api/cqtj/getTransitionByToday";
const LEAVE_URL = "https://of.swu.edu.cn/gateway/fighter-baida/api/xsqjxj/listSelfLeaveData";
const LEAVE_PAGE_SIZE = 100;
const MAX_LEAVE_PAGES = 20;
const CHECK_IN_URL = "https://of.swu.edu.cn/gateway/fighter-baida/api/form-instance/save";

interface UserResponse extends DataResponse {
  data?: {
    subject?: {
      username?: string;
    };
  };
}

interface DataResponse {
  data?: unknown;
  code?: string | number;
  status?: string | number;
  success?: boolean | string | number;
  result?: boolean | string | number;
  ok?: boolean | string | number;
  message?: string;
  msg?: string;
  error?: string;
  exceptionMsg?: string;
}

interface CheckInContext {
  status: CheckInStatus;
  task?: ApiRecord;
}

interface DormitoryColumn extends ApiRecord {
  value?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

const SUCCESS_CODES = new Set(["0", "200", "20000", "00000", "success", "ok", "true"]);
const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function isRetryableNetworkError(error: unknown) {
  return error instanceof TypeError
    || (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError"));
}

export class SwuUnauthorizedError extends Error {
  constructor(message = "校内登录状态已失效") {
    super(message);
    this.name = "SwuUnauthorizedError";
  }
}

export function isSwuUnauthorizedError(error: unknown): error is SwuUnauthorizedError {
  return error instanceof SwuUnauthorizedError;
}

function asRecord(value: unknown): ApiRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ApiRecord)
    : null;
}

async function fetchJson<T>(
  url: string,
  token: string,
  init?: RequestInit,
  options: { retry?: boolean } = {},
): Promise<T> {
  for (let attempt = 0; attempt < (options.retry ? 2 : 1); attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "fighter-auth-token": token,
          ...init?.headers,
        },
      });

      if (response.status === 401 || response.status === 403) {
        throw new SwuUnauthorizedError();
      }
      if (!response.ok) {
        if (options.retry && attempt === 0 && RETRYABLE_HTTP_STATUS.has(response.status)) {
          continue;
        }
        throw new Error(`校内服务请求失败（HTTP ${response.status}）`);
      }

      try {
        return (await response.json()) as T;
      } catch {
        throw new Error("校内服务返回了无法解析的数据");
      }
    } catch (error) {
      if (error instanceof SwuUnauthorizedError) throw error;
      if (options.retry && attempt === 0 && isRetryableNetworkError(error)) continue;
      throw error;
    }
  }
  throw new Error("校内服务请求失败");
}

function isFailedResult(value: unknown) {
  return value === false
    || (typeof value === "number" && value === 0)
    || (typeof value === "string" && /^(false|0|fail|failed|error)$/i.test(value.trim()));
}

function readResponseMessage(payload: DataResponse) {
  for (const key of ["message", "msg", "error", "exceptionMsg"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function assertBusinessSuccess(payload: DataResponse, context: string) {
  const message = readResponseMessage(payload);
  const data = asRecord(payload.data);
  const codeValue = payload.code ?? payload.status ?? data?.code ?? data?.status;
  const code = codeValue === undefined ? undefined : String(codeValue).trim().toLowerCase();
  const explicitResult = payload.success ?? payload.result ?? payload.ok
    ?? data?.success ?? data?.result ?? data?.ok;
  const failedCode = code !== undefined && !SUCCESS_CODES.has(code);
  const failedResult = isFailedResult(explicitResult);
  const hasSuccessSignal = explicitResult === true
    || (typeof explicitResult === "string" && /^(success|ok|true)$/i.test(explicitResult.trim()))
    || (code !== undefined && SUCCESS_CODES.has(code));
  const failed = failedCode || failedResult || (!hasSuccessSignal && payload.data === undefined && Boolean(message));
  if (failed && (code === "401" || code === "403" || /登录|认证|token/i.test(message))) {
    throw new SwuUnauthorizedError(message || undefined);
  }
  if (failed) {
    throw new Error(message || `${context}失败（业务码 ${codeValue ?? "未知"}）`);
  }
}

function recordsFrom(payload: DataResponse) {
  const data = asRecord(payload.data);
  return Array.isArray(data?.records) ? data.records.map(asRecord).filter((record) => record !== null) : [];
}

function parseChinaTime(value: unknown) {
  if (typeof value !== "string") return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) return undefined;
  return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+08:00`);
}

function formatChinaDate(now = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replaceAll("/", "-");
}

function normalizeCheckInWindow(value: unknown): [string, string] | undefined {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => typeof part === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(part))
  ) return [value[0] as string, value[1] as string];
  if (typeof value === "string") {
    const parts = value.match(/([01]\d|2[0-3]):[0-5]\d/g);
    if (parts?.length === 2) return [parts[0], parts[1]];
  }
  return undefined;
}

function isWithinChinaTimeWindow(window: [string, string], now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const currentMinutes = hour * 60 + minute;
  const toMinutes = (value: string) => {
    const [windowHour, windowMinute] = value.split(":").map(Number);
    return windowHour * 60 + windowMinute;
  };
  const start = toMinutes(window[0]);
  const end = toMinutes(window[1]);
  return start <= end
    ? start <= currentMinutes && currentMinutes <= end
    : currentMinutes >= start || currentMinutes <= end;
}

async function getDormitory(token: string) {
  const payload = await fetchJson<DataResponse>(DORMITORY_URL, token, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body: "{}",
  }, { retry: true });
  assertBusinessSuccess(payload, "住宿信息查询");
  return asRecord(payload.data);
}

async function hasActiveApprovedLeave(token: string, now: Date) {
  for (let pageNum = 1; pageNum <= MAX_LEAVE_PAGES; pageNum += 1) {
    const url = new URL(LEAVE_URL);
    url.searchParams.set("pageNum", String(pageNum));
    url.searchParams.set("pageSize", String(LEAVE_PAGE_SIZE));
    const payload = await fetchJson<DataResponse>(url.toString(), token, undefined, { retry: true });
    assertBusinessSuccess(payload, "请假信息查询");
    const records = recordsFrom(payload);
    const active = records.some((leave) => {
      if (leave.lcztmc !== "已同意") return false;
      const startTime = parseChinaTime(leave.kssj);
      const endTime = parseChinaTime(leave.jssj);
      return Boolean(startTime && endTime && startTime <= now && now <= endTime);
    });
    if (active) return true;
    if (records.length < LEAVE_PAGE_SIZE) return false;
  }
  throw new Error("请假记录过多，无法完整确认今日状态");
}

async function getTodayCheckInContext(token: string): Promise<CheckInContext> {
  const now = new Date();
  if (await hasActiveApprovedLeave(token, now)) {
    return { status: { state: "on_leave", message: "当前处于已批准的请假时段，无需签到" } };
  }

  const transitionPayload = await fetchJson<DataResponse>(TRANSITION_URL, token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ pageNum: "1", pageSize: "1" }),
  }, { retry: true });
  assertBusinessSuccess(transitionPayload, "签到状态查询");
  const task = recordsFrom(transitionPayload)[0];
  if (!task) {
    return { status: { state: "not_required", message: "今日暂无临时签到任务" } };
  }
  const taskState = typeof task.qdzt === "string" ? task.qdzt.trim() : task.qdzt;
  if (taskState === "已签到") {
    return { status: { state: "checked_in", message: "今日临时签到已完成" }, task };
  }
  if (taskState !== "未签到") {
    const displayState = typeof taskState === "string" && taskState ? taskState : "未知";
    return {
      status: { state: "unavailable", message: `当前签到任务状态为“${displayState}”，不可提交` },
      task,
    };
  }
  const checkInWindow = normalizeCheckInWindow(task.qdsj);
  if (!checkInWindow) {
    return {
      status: { state: "unavailable", message: "签到任务缺少有效的开放时间，不可提交" },
      task,
    };
  }
  if (!isWithinChinaTimeWindow(checkInWindow)) {
    return {
      status: {
        state: "unavailable",
        message: `签到开放时间为 ${checkInWindow[0]}–${checkInWindow[1]}`,
      },
      task,
    };
  }
  return { status: { state: "available", message: "当前可以进行临时签到" }, task };
}

function readDormitoryColumns(dormitory: ApiRecord | null): DormitoryColumn[] {
  if (!dormitory || !Array.isArray(dormitory.columnList)) {
    throw new Error("住宿信息缺少签到所需字段");
  }
  return dormitory.columnList.map(asRecord).filter((column) => column !== null);
}

function requireString(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value.trim();
}

function requireStringOrNumber(value: unknown, message: string) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error(message);
}

function optionalStringOrNumber(value: unknown, fallback: string | number) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function optionalBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function requireCoordinate(
  value: unknown,
  missingMessage: string,
  invalidMessage: string,
  minimum: number,
  maximum: number,
) {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !value.trim())
  ) {
    throw new Error(missingMessage);
  }
  const coordinate = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(coordinate) || coordinate < minimum || coordinate > maximum) {
    throw new Error(invalidMessage);
  }
  return coordinate;
}

function isAlreadyCheckedInError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /已签到|已经签到|重复签到|今日[^。\n]{0,12}签到|already\s*(checked|signed)|duplicate/i.test(message);
}

async function confirmCheckIn(token: string) {
  const delays = [0, 300, 600, 1_000];
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
    try {
      const confirmed = await getTodayCheckInContext(token);
      if (confirmed.status.state === "checked_in") return true;
    } catch (error) {
      if (isSwuUnauthorizedError(error)) throw error;
    }
  }
  return false;
}

export async function getStudentProfile(token: string): Promise<StudentProfile> {
  const [userPayload, dormitory] = await Promise.all([
    fetchJson<UserResponse>(USER_URL, token, undefined, { retry: true }),
    getDormitory(token),
  ]);

  const studentId = userPayload.data?.subject?.username;
  assertBusinessSuccess(userPayload, "学生信息查询");
  if (!studentId) {
    throw new Error("校内服务未返回学号");
  }

  const columns = dormitory && Array.isArray(dormitory.columnList)
    ? dormitory.columnList.map(asRecord).filter((column) => column !== null)
    : [];
  const address = columns[1]?.value;
  const checkInRadius = columns[2]?.value;
  const latitude = typeof columns[0]?.latitude === "number"
    ? Number.isFinite(columns[0].latitude) ? columns[0].latitude : null
    : typeof columns[0]?.latitude === "string" && columns[0].latitude.trim()
      ? Number.isFinite(Number(columns[0].latitude)) ? Number(columns[0].latitude) : null
      : null;
  const longitude = typeof columns[0]?.longitude === "number"
    ? Number.isFinite(columns[0].longitude) ? columns[0].longitude : null
    : typeof columns[0]?.longitude === "string" && columns[0].longitude.trim()
      ? Number.isFinite(Number(columns[0].longitude)) ? Number(columns[0].longitude) : null
      : null;

  return {
    studentId,
    dormitory: dormitory
      ? {
        address: typeof address === "string" && address.trim() ? address.trim() : null,
        checkInRadius:
          typeof checkInRadius === "string" || typeof checkInRadius === "number"
            ? String(checkInRadius)
            : null,
        latitude,
        longitude,
      }
      : null,
    updatedAt: new Date().toISOString(),
  };
}

export async function getCheckInStatus(token: string) {
  return (await getTodayCheckInContext(token)).status;
}

export async function submitCheckIn(token: string): Promise<CheckInStatus> {
  const context = await getTodayCheckInContext(token);
  if (context.status.state !== "available" || !context.task) return context.status;

  const formId = requireString(context.task.formId, "签到任务缺少 formId");
  const taskId = requireString(context.task.id, "签到任务缺少 id");
  const checkInWindow = normalizeCheckInWindow(context.task.qdsj);
  if (!checkInWindow) throw new Error("签到任务缺少有效的开放时间");
  const [userPayload, dormitory] = await Promise.all([
    fetchJson<UserResponse>(USER_URL, token, undefined, { retry: true }),
    getDormitory(token),
  ]);
  assertBusinessSuccess(userPayload, "学生信息查询");
  const studentId = requireString(userPayload.data?.subject?.username, "校内服务未返回学号");
  const columns = readDormitoryColumns(dormitory);
  if (columns.length < 3) throw new Error("住宿信息不完整，无法执行签到");

  const latitude = requireCoordinate(
    columns[0].latitude,
    "住宿信息缺少纬度",
    "住宿信息中的纬度无效",
    -90,
    90,
  );
  const longitude = requireCoordinate(
    columns[0].longitude,
    "住宿信息缺少经度",
    "住宿信息中的经度无效",
    -180,
    180,
  );
  const address = requireString(columns[1].value, "住宿信息缺少签到地址");
  const checkInRadius = requireStringOrNumber(columns[2].value, "住宿信息缺少签到半径");
  const locationColumn = columns[0];
  const saveUrl = new URL(CHECK_IN_URL);
  saveUrl.searchParams.set("formId", formId);
  saveUrl.searchParams.set("isSubmitProcess", "false");

  try {
    const savePayload = await fetchJson<DataResponse>(saveUrl.toString(), token, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8" },
      body: JSON.stringify({
        id: taskId,
        formId,
        tsrq: formatChinaDate(),
        xh: studentId,
        qdsj: checkInWindow,
        qsqddd: address,
        qdbj: checkInRadius,
        qddz: {
          latitude,
          longitude,
          address,
          netType: optionalStringOrNumber(locationColumn.netType, "wifi"),
          operatorType: optionalStringOrNumber(locationColumn.operatorType, "unknown"),
          imei: optionalStringOrNumber(locationColumn.imei, "imei"),
          time: Date.now(),
          provider: optionalStringOrNumber(locationColumn.provider, "lbs"),
          isFromMock: optionalBoolean(locationColumn.isFromMock, false),
          isGpsEnabled: optionalBoolean(locationColumn.isGpsEnabled, true),
          isWifiEnabled: optionalBoolean(locationColumn.isWifiEnabled, true),
          isMobileEnabled: optionalBoolean(locationColumn.isMobileEnabled, false),
          isOffset: optionalBoolean(locationColumn.isOffset, true),
          cityAdCode: optionalStringOrNumber(locationColumn.cityAdCode, "023"),
          districtAdCode: optionalStringOrNumber(locationColumn.districtAdCode, "500109"),
          isArea: optionalBoolean(locationColumn.isArea, true),
          tip: optionalStringOrNumber(locationColumn.tip, "当前在签到范围内"),
        },
      }),
    });
    assertBusinessSuccess(savePayload, "临时签到提交");
  } catch (error) {
    if (!isAlreadyCheckedInError(error) || !(await confirmCheckIn(token))) throw error;
    return { state: "checked_in", message: "今日临时签到已完成" };
  }

  if (await confirmCheckIn(token)) {
    return { state: "checked_in", message: "临时签到已完成" };
  }

  throw new Error("签到请求已提交，但未能确认签到状态，请刷新后重试");
}
