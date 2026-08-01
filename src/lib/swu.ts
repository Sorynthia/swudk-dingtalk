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
  success?: boolean;
  message?: string;
  msg?: string;
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

const SUCCESS_CODES = new Set(["0", "200", "20000", "00000"]);

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

async function fetchJson<T>(url: string, token: string, init?: RequestInit): Promise<T> {
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
    throw new Error(`校内服务请求失败（HTTP ${response.status}）`);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new Error("校内服务返回了无法解析的数据");
  }
}

function assertBusinessSuccess(payload: DataResponse, context: string) {
  const message = payload.message || payload.msg;
  const code = payload.code === undefined ? undefined : String(payload.code);
  const hasSuccessSignal = payload.success === true || (code !== undefined && SUCCESS_CODES.has(code));
  const failed =
    payload.success === false ||
    (code !== undefined && !SUCCESS_CODES.has(code)) ||
    (!hasSuccessSignal && payload.data === undefined && Boolean(message));
  if (failed && (code === "401" || code === "403" || /登录|认证|token/i.test(message ?? ""))) {
    throw new SwuUnauthorizedError(message || undefined);
  }
  if (failed) {
    throw new Error(message || `${context}失败（业务码 ${code ?? "未知"}）`);
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
  });
  assertBusinessSuccess(payload, "住宿信息查询");
  return asRecord(payload.data);
}

async function hasActiveApprovedLeave(token: string, now: Date) {
  for (let pageNum = 1; pageNum <= MAX_LEAVE_PAGES; pageNum += 1) {
    const url = new URL(LEAVE_URL);
    url.searchParams.set("pageNum", String(pageNum));
    url.searchParams.set("pageSize", String(LEAVE_PAGE_SIZE));
    const payload = await fetchJson<DataResponse>(url.toString(), token);
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
  });
  assertBusinessSuccess(transitionPayload, "签到状态查询");
  const task = recordsFrom(transitionPayload)[0];
  if (!task) {
    return { status: { state: "not_required", message: "今日暂无临时签到任务" } };
  }
  if (task.qdzt === "已签到") {
    return { status: { state: "checked_in", message: "今日临时签到已完成" }, task };
  }
  if (task.qdzt !== "未签到") {
    const taskState = typeof task.qdzt === "string" && task.qdzt.trim() ? task.qdzt.trim() : "未知";
    return {
      status: { state: "unavailable", message: `当前签到任务状态为“${taskState}”，不可提交` },
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

export async function getStudentProfile(token: string): Promise<StudentProfile> {
  const [userPayload, dormitory] = await Promise.all([
    fetchJson<UserResponse>(USER_URL, token),
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

  return {
    studentId,
    dormitory: dormitory
      ? {
          address: typeof address === "string" && address.trim() ? address.trim() : null,
          checkInRadius:
            typeof checkInRadius === "string" || typeof checkInRadius === "number"
              ? String(checkInRadius)
              : null,
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
    fetchJson<UserResponse>(USER_URL, token),
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
  const saveUrl = new URL(CHECK_IN_URL);
  saveUrl.searchParams.set("formId", formId);
  saveUrl.searchParams.set("isSubmitProcess", "false");

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
        netType: "wifi",
        operatorType: "unknown",
        imei: "imei",
        time: Date.now(),
        provider: "lbs",
        isFromMock: false,
        isGpsEnabled: true,
        isWifiEnabled: true,
        isMobileEnabled: false,
        isOffset: true,
        cityAdCode: "023",
        districtAdCode: "500109",
        isArea: true,
        tip: "当前在签到范围内",
      },
    }),
  });
  assertBusinessSuccess(savePayload, "临时签到提交");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const confirmed = await getTodayCheckInContext(token);
    if (confirmed.status.state === "checked_in") {
      return { state: "checked_in", message: "临时签到已完成" };
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error("签到请求已提交，但未能确认签到状态，请刷新后重试");
}
