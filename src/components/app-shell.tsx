"use client";

import Image from "next/image";
import {
  Check,
  CircleCheckBig,
  Clock3,
  GraduationCap,
  House,
  LoaderCircle,
  LogOut,
  QrCode,
  RefreshCw,
  ScanLine,
  Send,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

  if (dormitory.address) {
    fields.push({ label: "住宿地址", value: dormitory.address, icon: House });
  }
  if (dormitory.checkInRadius) {
    fields.push({ label: "签到半径", value: dormitory.checkInRadius, icon: ScanLine });
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

async function readPayload(response: Response): Promise<SessionPayload> {
  const payload = (await response.json()) as SessionPayload;
  if (!response.ok && !payload.message) throw new Error("服务暂时不可用");
  return payload;
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
    <div className="flex items-center gap-3">
      <span className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm">
        <GraduationCap className="size-5" aria-hidden="true" />
      </span>
      <div>
        <p className="text-[0.6875rem] font-semibold text-muted-foreground uppercase">
          SWU Campus
        </p>
        <p className="text-base font-semibold">西大寝签</p>
      </div>
    </div>
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
    if (!expiresAt || (stage !== "waiting" && stage !== "scanned")) return;
    const syncNow = () => setNow(Date.now());
    const handleVisibilityChange = () => {
      if (!document.hidden) syncNow();
    };

    syncNow();
    const timer = window.setInterval(syncNow, 1000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", syncNow);
    window.addEventListener("focus", syncNow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", syncNow);
      window.removeEventListener("focus", syncNow);
    };
  }, [expiresAt, stage]);

  const secondsLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0;
  const isGenerating = stage === "generating";
  const hasFailed = stage === "error" || stage === "expired";
  const hasActiveQr = (stage === "waiting" || stage === "scanned") && Boolean(qrImage);

  return (
    <main className="min-h-dvh sm:px-6 sm:py-6 lg:grid lg:place-items-center lg:px-10">
      <section className="mx-auto grid min-h-dvh w-full max-w-6xl overflow-hidden bg-card sm:min-h-[calc(100dvh-3rem)] sm:rounded-lg sm:border sm:shadow-[0_24px_70px_-42px_rgba(55,37,31,0.45)] lg:min-h-[680px] lg:grid-cols-[0.92fr_1.08fr]">
        <div className="relative hidden flex-col justify-between overflow-hidden bg-[#282421] p-12 text-white lg:flex">
          <BrandPanelArt />
          <div className="relative z-10 max-w-sm">
            <Badge className="mb-6 border-white/15 bg-white/10 text-white hover:bg-white/10">
              钉钉统一登录
            </Badge>
            <h1 className="text-4xl leading-tight font-semibold">
              住宿信息与签到，
              <br />一处完成。
            </h1>
            <p className="mt-5 max-w-xs text-sm leading-6 text-white/62">
              登录后可查看登记住宿信息，并按需完成临时签到。
            </p>
          </div>
          <div className="relative z-10 flex items-center gap-2 text-xs text-white/45">
            <ShieldCheck className="size-4" aria-hidden="true" />
            由学校统一身份认证提供登录
          </div>
        </div>

        <div className="flex min-h-full flex-col px-4 py-5 sm:px-10 sm:py-8 lg:px-16 lg:py-12">
          <div className="flex items-center justify-between lg:hidden">
            <Brand />
            <Badge variant="outline" className="text-muted-foreground">安全登录</Badge>
          </div>

          <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-7 sm:py-12">
            <div className="mb-6 text-center sm:mb-8">
              <p className="mb-2 text-xs font-semibold text-primary">钉钉扫码</p>
              <h2 className="text-2xl font-semibold sm:text-3xl">登录西大寝签</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">扫描二维码，并在钉钉中确认登录</p>
            </div>

            <div className="relative mx-auto grid size-[min(19rem,calc(100vw-3rem))] place-items-center border bg-white p-3 shadow-sm sm:size-[21rem] sm:p-4">
              {hasActiveQr && qrImage ? (
                <Image
                  src={qrImage}
                  alt="钉钉登录二维码"
                  width={320}
                  height={320}
                  unoptimized
                  priority
                  className="size-full"
                />
              ) : isGenerating ? (
                <div className="flex flex-col items-center gap-4 text-muted-foreground" role="status">
                  <LoaderCircle className="size-8 animate-spin text-primary" aria-hidden="true" />
                  <span className="text-sm">正在生成二维码…</span>
                </div>
              ) : hasFailed ? (
                <div className="flex max-w-52 flex-col items-center text-center">
                  <ScanLine className="mb-4 size-10 text-muted-foreground" aria-hidden="true" />
                  <p className="font-medium">{stage === "expired" ? "二维码已过期" : "暂时无法登录"}</p>
                  <p className="mt-2 text-sm leading-5 text-muted-foreground">{message}</p>
                  <Button className="mt-5" onClick={onRetry}>
                    <RefreshCw className="size-4" />
                    重新生成
                  </Button>
                </div>
              ) : (
                <div className="flex max-w-56 flex-col items-center text-center">
                  <QrCode className="mb-4 size-10 text-primary" aria-hidden="true" />
                  <p className="font-medium">按需生成登录二维码</p>
                  <p className="mt-2 text-sm leading-5 text-muted-foreground">
                    二维码只在你准备扫码时创建
                  </p>
                  <Button className="mt-5" onClick={onRetry}>
                    <QrCode className="size-4" />
                    生成登录二维码
                  </Button>
                </div>
              )}
            </div>

            {(stage === "waiting" || stage === "scanned") && (
              <div className="mt-6 flex min-h-12 items-center justify-center gap-3" aria-live="polite">
                <span
                  className="status-pulse size-2 rounded-full bg-emerald-600"
                  aria-hidden="true"
                />
                <div className="text-sm">
                  <span className="font-medium">
                    {message || (stage === "scanned" ? "已扫码，请在手机端确认" : "等待扫码")}
                  </span>
                  {expiresAt && (
                    <span className="ml-2 text-muted-foreground">
                      剩余 {formatRemainingTime(secondsLeft)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {stage === "scanned" && (
              <Alert className="mt-2 border-emerald-200 bg-emerald-50 text-emerald-950">
                <Smartphone className="size-4" />
                <AlertTitle>已识别扫码</AlertTitle>
                <AlertDescription>请返回钉钉完成授权，页面会自动继续。</AlertDescription>
              </Alert>
            )}
          </div>

          <p className="text-center text-xs leading-5 text-muted-foreground">
            请在本人设备上完成扫码登录
          </p>
        </div>
      </section>
    </main>
  );
}

function BrandPanelArt() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className="absolute -top-28 -right-36 size-[30rem] rounded-full border border-white/8" />
      <div className="absolute -top-12 -right-20 size-[22rem] rounded-full border border-white/8" />
      <div className="absolute top-24 right-20 grid size-24 place-items-center rounded-full border border-white/10 text-white/12">
        <GraduationCap className="size-10" />
      </div>
      <div className="absolute right-10 bottom-16 flex items-end gap-3 opacity-10">
        {[48, 72, 56, 94, 64, 82].map((height, index) => (
          <span key={index} className="w-7 border border-white" style={{ height }} />
        ))}
      </div>
    </div>
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
    <div className="min-h-dvh bg-background">
      <header className="border-b bg-background/95">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:h-18 sm:px-5 md:px-8">
          <Brand />
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden gap-1.5 text-muted-foreground sm:flex">
              <Check className="size-3.5" />
              已登录
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              onClick={refreshProfile}
              disabled={refreshing}
              aria-label="刷新校园信息"
              title="刷新校园信息"
            >
              <RefreshCw className={refreshing ? "animate-spin" : ""} />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleLogout} disabled={loggingOut} aria-label="退出登录" title="退出登录">
              {loggingOut ? <LoaderCircle className="animate-spin" /> : <LogOut />}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-5 sm:py-9 md:px-8 md:py-12">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Badge variant="secondary" className="mb-3 font-normal sm:mb-4">学号 {profile.studentId}</Badge>
            <h1 className="text-2xl font-semibold sm:text-4xl">今日寝室签到</h1>
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

        <section className="mt-7 grid overflow-hidden rounded-lg border bg-card shadow-sm sm:mt-8 lg:grid-cols-[1.08fr_0.92fr]" aria-label="临时签到和住宿详情">
          <div className="p-5 sm:p-8 lg:border-r">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-primary">今日状态</p>
                <h2 className="mt-2 text-xl font-semibold">临时签到</h2>
              </div>
              {checkInStatus && !statusLoading && (
                <Badge variant={checkInStatus.state === "checked_in" ? "default" : "secondary"}>
                  {checkInStatus.state === "available" ? "待签到" : checkInStatus.state === "checked_in" ? "已完成" : "无需签到"}
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
              size="lg"
              className="mt-8 w-full sm:w-auto"
              onClick={submitTemporaryCheckIn}
              disabled={statusLoading || submitting || checkInStatus?.state !== "available"}
            >
              {submitting ? <LoaderCircle className="animate-spin" /> : <Send />}
              {submitting ? "正在提交…" : checkInStatus?.state === "checked_in" ? "今日已签到" : "执行临时签到"}
            </Button>
          </div>

          <div className="border-t bg-muted/25 p-5 sm:p-8 lg:border-t-0">
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
          <span>西大寝签 · 非学校官方应用</span>
        </footer>
      </main>
    </div>
  );
}

interface AppShellProps {
  initialPayload: SessionPayload;
  initialCheckInStatus?: CheckInStatus;
  initialCheckInError?: string;
}

export default function AppShell({
  initialPayload,
  initialCheckInStatus,
  initialCheckInError,
}: AppShellProps) {
  const [stage, setStage] = useState<ViewStage>(() =>
    initialPayload.stage === "unauthenticated" ? "idle" : initialPayload.stage,
  );
  const [qrImage, setQrImage] = useState(initialPayload.qrImage);
  const [expiresAt, setExpiresAt] = useState(initialPayload.expiresAt);
  const [message, setMessage] = useState(initialPayload.message);
  const [profile, setProfile] = useState(initialPayload.profile);
  const qrRequestPending = useRef(false);

  const applyPayload = useCallback((payload: SessionPayload) => {
    setStage(payload.stage);
    setMessage(payload.message);
    if (payload.qrImage !== undefined) setQrImage(payload.qrImage);
    if (payload.expiresAt !== undefined) setExpiresAt(payload.expiresAt);
    if (payload.profile) setProfile(payload.profile);
  }, []);

  const createQrCode = useCallback(async () => {
    if (qrRequestPending.current) return;
    qrRequestPending.current = true;
    setStage("generating");
    setMessage(undefined);
    setQrImage(undefined);
    setExpiresAt(undefined);
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
        initialCheckInStatus={initialCheckInStatus}
        initialCheckInError={initialCheckInError}
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
