"use client";

import Image from "next/image";
import {
  CircleCheckBig,
  Clock3,
  House,
  LoaderCircle,
  LogOut,
  MapPin,
  MessageCircle,
  QrCode,
  RefreshCw,
  ScanLine,
  Send,
  ShieldCheck,
  Sparkles,
  Smartphone,
  Clock,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { requestLogout } from "@/lib/client-api";
import type {
  CheckInStatus,
  DormitoryProfile,
  LoginStage,
  SessionPayload,
  StudentProfile,
} from "@/lib/types";

type ViewStage = LoginStage | "loading" | "idle" | "generating" | "unauthenticated";

function formatDormitory(dormitory: DormitoryProfile | null) {
  return dormitory?.address || "暂无信息";
}

interface DormitoryField {
  label: string;
  value: string;
  icon: typeof House;
}

function getDormitoryFields(dormitory: DormitoryProfile | null): DormitoryField[] {
  if (!dormitory) {
    return [{ label: "住宿信息", value: "暂无信息", icon: House }];
  }

  const fields: DormitoryField[] = [];

  if (dormitory.checkInRadius) {
    fields.push({ label: "签到半径", value: dormitory.checkInRadius, icon: ScanLine });
  }
  if (typeof dormitory.latitude === "number" && typeof dormitory.longitude === "number") {
    fields.push({
      label: "登记坐标",
      value: `${dormitory.latitude.toFixed(6)}, ${dormitory.longitude.toFixed(6)}`,
      icon: MapPin,
    });
  }
  return fields.length > 0 ? fields : [{ label: "住宿信息", value: formatDormitory(dormitory), icon: House }];
}

function formatUpdatedTime(value: string | undefined) {
  if (!value) return "未知时间";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(parsed);
}

function formatRemainingTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${remainingSeconds} 秒`;
  if (remainingSeconds === 0) return `${minutes} 分钟`;
  return `${minutes} 分 ${remainingSeconds} 秒`;
}

const SESSION_STAGES = new Set<SessionPayload["stage"]>([
  "waiting",
  "scanned",
  "authenticated",
  "expired",
  "error",
  "unauthenticated",
]);

/** @internal 仅导出以覆盖接口响应校验测试。 */
export async function readPayload(response: Response): Promise<SessionPayload> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("服务返回了无法解析的数据");
  }
  const payload = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  const message = typeof payload?.message === "string" ? payload.message : undefined;
  if (!payload || !SESSION_STAGES.has(payload.stage as SessionPayload["stage"])) {
    throw new Error(message || "服务返回了无效状态");
  }
  if (!response.ok && payload.stage !== "unauthenticated" && payload.stage !== "error") {
    throw new Error(message || "服务暂时不可用");
  }
  return payload as unknown as SessionPayload;
}

class SessionExpiredError extends Error {
  constructor(message = "登录状态已失效，请重新登录") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

async function readCheckInStatus(response: Response): Promise<CheckInStatus> {
  const payload = (await response.json()) as { status?: CheckInStatus; message?: string };
  if (response.status === 401) throw new SessionExpiredError(payload.message);
  if (!response.ok || !payload.status) throw new Error(payload.message || "签到状态查询失败");
  return payload.status;
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-sm font-semibold tracking-[0.04em]">
      <Image src="/icon.svg" alt="" width={28} height={28} aria-hidden />
      <span>钉钉扫码打卡</span>
    </div>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

interface SiteHeaderProps {
  status: string;
  actions?: ReactNode;
}

function SiteHeader({ status, actions }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 rounded-xl border bg-background px-3 sm:h-16 sm:px-4">
        <Brand />
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="sr-only">{status}</span>
          <Badge aria-hidden="true" variant="outline" className="hidden border-primary/20 bg-background/60 text-muted-foreground sm:inline-flex">
            {status}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            asChild
            aria-label="反馈"
            title="反馈"
          >
            <a href="https://qm.qq.com/q/c0UjhguHRe" target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-4" />
              <span className="hidden sm:inline">反馈</span>
            </a>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            asChild
            aria-label="查看 GitHub 仓库"
            title="查看 GitHub 仓库"
          >
            <a href="https://github.com/Sorynthia/swudk-dingtalk" target="_blank" rel="noopener noreferrer">
              <GithubIcon className="size-4" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            asChild
            aria-label="自动签到"
            title="自动签到"
          >
            <a href="https://sorynthia.cn" target="_blank" rel="noopener noreferrer">
              <Clock className="size-4" />
              <span className="hidden sm:inline">自动</span>
            </a>
          </Button>
          {actions}
        </div>
      </div>
    </header>
  );
}

interface LoginScreenProps {
  stage: ViewStage;
  qrImage?: string;
  expiresAt?: number;
  message?: string;
  onRetry: () => void;
}

function LoginScreen({ stage, qrImage, expiresAt, message, onRetry }: LoginScreenProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (stage !== "waiting" && stage !== "scanned") return;
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt, stage]);

  const secondsRemaining = expiresAt && (stage === "waiting" || stage === "scanned") ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : 0;

  let content: ReactNode = null;

  if (stage === "loading" || stage === "idle") {
    content = (
      <div className="flex flex-col items-center gap-4">
        <div className="relative isolate grid size-44 place-items-center rounded-xl border bg-muted">
          <QrCode className="size-14 text-primary" aria-hidden="true" />
        </div>
        <Button variant="default" size="lg" onClick={onRetry}>
          扫码登录
        </Button>
      </div>
    );
  } else if (stage === "generating") {
    content = (
      <div className="relative isolate grid size-44 place-items-center rounded-xl border bg-muted">
        <LoaderCircle className="size-14 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  } else if (stage === "waiting" && qrImage) {
    content = (
      <div className="flex flex-col items-center gap-4">
        <div className="relative isolate overflow-hidden rounded-xl border bg-white">
          <Image src={qrImage} alt="登录二维码" width={220} height={220} priority unoptimized />
          <span className="absolute inset-x-0 bottom-0 flex h-8 items-center justify-center bg-gradient-to-t from-black/60 to-transparent text-xs font-medium text-white">
            {formatRemainingTime(secondsRemaining)}
          </span>
        </div>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Smartphone className="size-4" aria-hidden="true" />
          打开钉钉扫描二维码登录
        </p>
      </div>
    );
  } else if (stage === "scanned") {
    content = (
      <div className="flex flex-col items-center gap-4">
        <div className="relative isolate grid size-44 place-items-center rounded-xl border bg-muted">
          <ShieldCheck className="size-14 text-primary" aria-hidden="true" />
        </div>
        <p className="text-sm text-muted-foreground">已扫描,请在手机上确认登录</p>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock3 className="size-3.5" aria-hidden="true" />
          {formatRemainingTime(secondsRemaining)}
        </p>
      </div>
    );
  } else if (stage === "expired") {
    content = (
      <div className="flex flex-col items-center gap-4">
        <div className="relative isolate grid size-44 place-items-center rounded-xl border bg-muted">
          <QrCode className="size-14 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="text-sm text-muted-foreground">二维码已过期</p>
        <Button variant="outline" size="lg" onClick={onRetry}>
          重新生成
        </Button>
      </div>
    );
  } else if (stage === "error") {
    content = (
      <div className="flex flex-col items-center gap-4">
        <Alert variant="destructive" className="max-w-sm">
          <AlertTitle>登录失败</AlertTitle>
          <AlertDescription>{message || "请稍后重试"}</AlertDescription>
        </Alert>
        <Button variant="outline" size="lg" onClick={onRetry}>
          重新生成二维码
        </Button>
      </div>
    );
  }

  return (
    <main data-screen="login" className="min-h-dvh">
      <div className="flex min-h-dvh flex-col">
        <SiteHeader status="未登录" />
        <section data-reveal className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-3 py-16 text-center sm:px-6">
          {content}
        </section>
      </div>
    </main>
  );
}

interface DashboardProps {
  profile: StudentProfile;
  initialCheckInStatus?: CheckInStatus;
  initialCheckInError?: string;
  onLogout: () => void;
  onSessionExpired: () => void;
  onProfileChange: (profile: StudentProfile) => void;
}

function Dashboard({
  profile,
  initialCheckInStatus,
  initialCheckInError,
  onLogout,
  onSessionExpired,
  onProfileChange,
}: DashboardProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  const [checkInStatus, setCheckInStatus] = useState(initialCheckInStatus);
  const [statusLoading, setStatusLoading] = useState(!initialCheckInStatus && !initialCheckInError);
  const [submitting, setSubmitting] = useState(false);
  const [checkInError, setCheckInError] = useState(initialCheckInError);
  const [logoutError, setLogoutError] = useState<string>();
  const [loggingOut, setLoggingOut] = useState(false);
  const dormitory = formatDormitory(profile.dormitory);
  const dormitoryFields = useMemo(() => getDormitoryFields(profile.dormitory), [profile.dormitory]);
  const updatedAt = useMemo(() => formatUpdatedTime(profile.updatedAt), [profile.updatedAt]);

  const loadCheckInStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const status = await readCheckInStatus(await fetch("/api/check-in", { cache: "no-store" }));
      setCheckInError(undefined);
      setCheckInStatus(status);
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        onSessionExpired();
        return;
      }
      setCheckInError(error instanceof Error ? error.message : "签到状态查询失败");
    } finally {
      setStatusLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    if (initialCheckInStatus || initialCheckInError) return;
    let cancelled = false;
    void fetch("/api/check-in", { cache: "no-store" })
      .then(readCheckInStatus)
      .then((status) => {
        if (!cancelled) setCheckInStatus(status);
      })
      .catch((error: unknown) => {
        if (!cancelled && error instanceof SessionExpiredError) {
          onSessionExpired();
        } else if (!cancelled) {
          setCheckInError(error instanceof Error ? error.message : "签到状态查询失败");
        }
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialCheckInError, initialCheckInStatus, onSessionExpired]);

  const refreshProfile = async () => {
    setRefreshing(true);
    setRefreshError(undefined);
    try {
      const response = await fetch("/api/profile", { method: "POST" });
      const payload = (await response.json()) as { profile?: StudentProfile; message?: string };
      if (response.status === 401) throw new SessionExpiredError(payload.message);
      if (!response.ok || !payload.profile) throw new Error(payload.message || "信息刷新失败");
      onProfileChange(payload.profile);
      await loadCheckInStatus();
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        onSessionExpired();
        return;
      }
      setRefreshError(error instanceof Error ? error.message : "信息刷新失败");
    } finally {
      setRefreshing(false);
    }
  };

  const submitTemporaryCheckIn = async () => {
    setSubmitting(true);
    setCheckInError(undefined);
    try {
      const response = await fetch("/api/check-in", { method: "POST" });
      setCheckInStatus(await readCheckInStatus(response));
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        onSessionExpired();
        return;
      }
      setCheckInError(error instanceof Error ? error.message : "临时签到失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    setLogoutError(undefined);
    try {
      await onLogout();
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : "退出登录失败");
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div data-screen="dashboard" className="min-h-dvh">
      <SiteHeader
          status="已登录"
          actions={
            <>
            <Button
              variant="outline"
              size="icon"
              onClick={refreshProfile}
              disabled={refreshing}
              aria-label="刷新校园信息"
              title="刷新校园信息"
            >
              <RefreshCw className={refreshing ? "animate-spin" : ""} />
            </Button>
            <Button variant="outline" size="icon" onClick={handleLogout} disabled={loggingOut} aria-label="退出登录" title="退出登录">
              {loggingOut ? <LoaderCircle className="animate-spin" /> : <LogOut />}
            </Button>
            </>
          }
        />

      <div className="mx-auto w-full max-w-4xl px-3 sm:px-6">
      <main className="w-full px-1 py-8 sm:px-2 sm:py-12">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Badge variant="secondary" className="mb-3 font-normal sm:mb-4">学号 {profile.studentId}</Badge>
            <h1 className="text-3xl font-semibold sm:text-4xl">今日寝室签到</h1>
            <p className="mt-3 text-sm text-muted-foreground">核对住宿信息后，完成今天的临时签到</p>
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" aria-hidden="true" />
            更新于 {updatedAt}
          </p>
        </div>

        {refreshError && (
          <Alert variant="destructive" className="mt-6">
            <AlertTitle>刷新失败</AlertTitle>
            <AlertDescription>{refreshError}</AlertDescription>
          </Alert>
        )}

        {logoutError && (
          <Alert variant="destructive" className="mt-6">
            <AlertTitle>退出失败</AlertTitle>
            <AlertDescription>{logoutError}</AlertDescription>
          </Alert>
        )}

        <section className="mt-7 grid gap-5 sm:mt-8 lg:grid-cols-[1.08fr_0.92fr]" aria-label="临时签到和住宿详情">
          <div className="rounded-xl border bg-card p-5 sm:p-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-primary">今日状态</p>
                <h2 className="mt-2 text-xl font-semibold">临时签到</h2>
              </div>
              {checkInStatus && !statusLoading && (
                <Badge variant={checkInStatus.state === "checked_in" ? "default" : "secondary"}>
                  {checkInStatus.state === "available"
                    ? "待签到"
                    : checkInStatus.state === "checked_in"
                      ? "已完成"
                      : checkInStatus.state === "unavailable"
                        ? "不可签到"
                        : "无需签到"}
                </Badge>
              )}
            </div>
            <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
              提交时将使用已登记的住宿信息。
            </p>

            <div className="mt-7 min-h-20" aria-live="polite">
              {statusLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-56" />
                </div>
              ) : checkInStatus ? (
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-secondary text-primary">
                    {checkInStatus.state === "checked_in" ? <CircleCheckBig className="size-5" /> : <Clock3 className="size-5" />}
                  </span>
                  <div>
                    <p className="font-medium">
                      {checkInStatus.state === "available" ? "等待签到" : "当前状态"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{checkInStatus.message}</p>
                  </div>
                </div>
              ) : null}
            </div>

            {checkInError && (
              <Alert variant="destructive" className="mt-5">
                <AlertTitle>操作失败</AlertTitle>
                <AlertDescription>{checkInError}</AlertDescription>
              </Alert>
            )}

            <Button
              variant="default"
              size="lg"
              className="mt-8 w-full sm:w-auto"
              onClick={submitTemporaryCheckIn}
              disabled={statusLoading || submitting || checkInStatus?.state !== "available"}
            >
              {submitting ? <LoaderCircle className="animate-spin" /> : <Send />}
              {submitting ? "正在提交…" : checkInStatus?.state === "checked_in" ? "今日已签到" : "执行临时签到"}
            </Button>
          </div>

          <div className="rounded-xl border bg-card p-5 sm:p-8">
            <p className="text-xs font-medium text-muted-foreground">住宿档案</p>
            <h2 className="mt-2 text-xl font-semibold">{dormitory}</h2>
            <div className="mt-6 divide-y">
              {dormitoryFields.map(({ label, value, icon: Icon }) => (
                <div key={`${label}-${value}`} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
                  <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 break-words text-sm font-medium">{value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Separator className="mt-8 sm:mt-12" />
        <footer className="flex flex-col gap-2 py-6 text-xs leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>钉钉扫码打卡 · 非学校官方应用</span>
        </footer>
      </main>
      </div>
    </div>
  );
}

function MaintenanceScreen() {
  return (
    <main data-service-state="disabled" className="min-h-dvh">
      <div className="flex min-h-dvh flex-col">
        <SiteHeader status="服务关闭" />
        <section data-reveal className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-3 py-16 text-center sm:px-6">
          <div className="relative isolate grid size-44 place-items-center rounded-full border bg-muted">
            <Sparkles className="size-14 text-primary" aria-hidden="true" />
          </div>
          <h1 className="mt-8 text-3xl font-semibold sm:text-4xl">服务暂未开放</h1>
          <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground sm:text-base">
            当前暂不提供二维码登录、住宿查询与临时签到，请稍后再访问。
          </p>
        </section>
      </div>
    </main>
  );
}

interface EnabledAppShellProps {
  initialPayload: SessionPayload;
  initialCheckInStatus?: CheckInStatus;
  initialCheckInError?: string;
}

interface AppShellProps extends EnabledAppShellProps {
  serviceEnabled: boolean;
}

function EnabledAppShell({
  initialPayload,
  initialCheckInStatus,
  initialCheckInError,
}: EnabledAppShellProps) {
  const [stage, setStage] = useState<ViewStage>(() =>
    initialPayload.stage === "unauthenticated" ? "idle" : initialPayload.stage,
  );
  const [qrImage, setQrImage] = useState(initialPayload.qrImage);
  const [expiresAt, setExpiresAt] = useState(initialPayload.expiresAt);
  const [message, setMessage] = useState(initialPayload.message);
  const [profile, setProfile] = useState(initialPayload.profile);
  const [useInitialCheckInState, setUseInitialCheckInState] = useState(true);
  const qrRequestPending = useRef(false);

  const applyPayload = useCallback((payload: SessionPayload) => {
    setStage(payload.stage);
    setMessage(payload.message);
    if (payload.stage === "waiting" || payload.stage === "scanned") {
      if (payload.qrImage !== undefined) setQrImage(payload.qrImage);
      if (payload.expiresAt !== undefined) setExpiresAt(payload.expiresAt);
    } else {
      setQrImage(undefined);
      setExpiresAt(undefined);
    }
    setProfile(payload.stage === "authenticated" ? payload.profile : undefined);
  }, []);

  const createQrCode = useCallback(async () => {
    if (qrRequestPending.current) return;
    qrRequestPending.current = true;
    setStage("generating");
    setMessage(undefined);
    setQrImage(undefined);
    setExpiresAt(undefined);
    setUseInitialCheckInState(false);
    try {
      const response = await fetch("/api/auth/qr", { method: "POST" });
      applyPayload(await readPayload(response));
    } catch (error) {
      setStage("error");
      setMessage(error instanceof Error ? error.message : "二维码生成失败");
    } finally {
      qrRequestPending.current = false;
    }
  }, [applyPayload]);

  useEffect(() => {
    if (stage !== "waiting" && stage !== "scanned") return;
    let cancelled = false;
    let timer: number | undefined;
    let polling = false;
    let pollController: AbortController | undefined;
    let resumePending = false;

    const schedulePoll = (delay: number) => {
      if (cancelled || document.hidden || polling || timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void poll();
      }, delay);
    };

    const poll = async () => {
      polling = true;
      pollController = new AbortController();
      try {
        const response = await fetch("/api/auth/status", {
          cache: "no-store",
          signal: pollController.signal,
        });
        const payload = await readPayload(response);
        if (!cancelled) applyPayload(payload);
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          setMessage("连接暂时中断，正在等待恢复");
        }
      } finally {
        pollController = undefined;
        polling = false;
        const nextDelay = resumePending ? 0 : 2000;
        resumePending = false;
        schedulePoll(nextDelay);
      }
    };

    const pausePolling = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      resumePending = false;
      pollController?.abort();
      setMessage(stage === "scanned" ? "已扫码，返回页面后继续确认" : "查询已暂停，返回页面后自动继续");
    };

    const resumePolling = () => {
      if (document.hidden) return;
      if (polling) {
        resumePending = true;
        return;
      }
      schedulePoll(0);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) pausePolling();
      else resumePolling();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", pausePolling);
    window.addEventListener("pageshow", resumePolling);
    window.addEventListener("focus", resumePolling);
    window.addEventListener("online", resumePolling);
    schedulePoll(1200);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", pausePolling);
      window.removeEventListener("pageshow", resumePolling);
      window.removeEventListener("focus", resumePolling);
      window.removeEventListener("online", resumePolling);
      if (timer !== undefined) window.clearTimeout(timer);
      pollController?.abort();
    };
  }, [applyPayload, stage]);

  const clearClientSession = useCallback(() => {
    setProfile(undefined);
    setQrImage(undefined);
    setExpiresAt(undefined);
    setMessage(undefined);
    setUseInitialCheckInState(false);
    setStage("idle");
  }, []);

  const logout = async () => {
    await requestLogout();
    clearClientSession();
  };

  if (stage === "authenticated" && profile) {
    return (
      <Dashboard
        profile={profile}
        initialCheckInStatus={useInitialCheckInState ? initialCheckInStatus : undefined}
        initialCheckInError={useInitialCheckInState ? initialCheckInError : undefined}
        onLogout={logout}
        onSessionExpired={clearClientSession}
        onProfileChange={setProfile}
      />
    );
  }

  return (
    <LoginScreen
      key={expiresAt ?? stage}
      stage={stage}
      qrImage={qrImage}
      expiresAt={expiresAt}
      message={message}
      onRetry={createQrCode}
    />
  );
}

export default function AppShell({ serviceEnabled, ...props }: AppShellProps) {
  return serviceEnabled ? <EnabledAppShell {...props} /> : <MaintenanceScreen />;
}
