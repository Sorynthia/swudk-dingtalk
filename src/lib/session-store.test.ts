import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const temporaryDirectories: string[] = [];

async function loadIsolatedStore() {
  const root = join(tmpdir(), `swudk-session-${randomBytes(8).toString("hex")}`);
  const dataDirectory = join(root, "data");
  const sessionSecret = randomBytes(32).toString("base64");
  mkdirSync(dataDirectory, { recursive: true });
  temporaryDirectories.push(root);
  process.env.SESSION_DATA_DIR = dataDirectory;
  process.env.SESSION_SECRET = sessionSecret;
  (globalThis as typeof globalThis & { swuLoginSessions?: unknown }).swuLoginSessions = undefined;
  vi.resetModules();
  const store = await import("@/lib/session-store");
  return {
    store,
    root,
    dataDirectory,
    encryptionKey: createHash("sha256").update(sessionSecret).digest(),
  };
}

afterEach(() => {
  delete process.env.SESSION_DATA_DIR;
  delete process.env.SESSION_SECRET;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("本机会话存储", () => {
  it("加密保存并跨模块恢复当前会话", async () => {
    const { store, dataDirectory } = await loadIsolatedStore();
    const session = store.createLoginSession({
      expiresAt: Date.now() + store.LOGIN_TTL_MS,
      stage: "waiting",
      message: "测试",
      qrImage: "data:image/png;base64,test",
      qrCode: "temporary-code",
      goto: "https://oapi.dingtalk.com/connect/oauth2/sns_authorize",
      appId: "temporary-app",
      cookies: new Map([
        ["https://login.dingtalk.com", new Map([["temporary-cookie", "value"]])],
      ]),
    });
    store.authenticateSession(session, "test-secret-token", {
      studentId: "20260001",
      dormitory: { address: "学生园区 1 舍", checkInRadius: "500 米" },
      updatedAt: new Date().toISOString(),
    });
    expect(session).toMatchObject({ qrImage: "", qrCode: "", goto: "", appId: "" });
    expect(session.cookies.size).toBe(0);

    const sessionPath = join(dataDirectory, `${session.id}.session`);
    expect(readFileSync(sessionPath, "utf8")).not.toContain("test-secret-token");

    (globalThis as typeof globalThis & { swuLoginSessions?: unknown }).swuLoginSessions = undefined;
    vi.resetModules();
    const restoredStore = await import("@/lib/session-store");
    const restored = restoredStore.getLoginSession(session.id);
    expect(restored?.token).toBe("test-secret-token");
    expect(restored?.profile?.dormitory).toEqual({
      address: "学生园区 1 舍",
      checkInRadius: "500 米",
    });

    restoredStore.deleteLoginSession(session.id);
    expect(existsSync(sessionPath)).toBe(false);
  });

  it("待扫码会话超时后返回 expired 状态", async () => {
    const { store } = await loadIsolatedStore();
    const session = store.createLoginSession({
      expiresAt: Date.now() - 1,
      stage: "waiting",
      message: "等待扫码",
      qrImage: "data:image/png;base64,test",
      qrCode: "code",
      goto: "goto",
      appId: "app",
      cookies: new Map(),
    });

    expect(store.getLoginSession(session.id)).toMatchObject({
      stage: "expired",
      message: "二维码已过期",
    });
  });

  it("拒绝并删除包含旧资料结构的会话", async () => {
    const { store, dataDirectory, encryptionKey } = await loadIsolatedStore();
    const id = randomUUID();
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      encryptionKey,
      iv,
    );
    const encrypted = Buffer.concat([
      cipher.update(
        JSON.stringify({
          version: 2,
          id,
          createdAt: Date.now(),
          expiresAt: Date.now() + 60_000,
          token: "old-token",
          profile: {
            studentId: "20260001",
            dormitory: { address: "学生园区 1 舍", checkInClass: "500 米" },
            updatedAt: new Date().toISOString(),
          },
        }),
        "utf8",
      ),
      cipher.final(),
    ]);
    const sealed = [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url"),
    ].join(".");
    writeFileSync(join(dataDirectory, `${id}.session`), sealed, "utf8");

    expect(store.getLoginSession(id)).toBeUndefined();
    expect(existsSync(join(dataDirectory, `${id}.session`))).toBe(false);
  });

  it("缺少环境密钥时拒绝保存会话", async () => {
    const { store } = await loadIsolatedStore();
    delete process.env.SESSION_SECRET;
    const session = store.createLoginSession({
      expiresAt: Date.now() + store.LOGIN_TTL_MS,
      stage: "waiting",
      message: "测试",
      qrImage: "",
      qrCode: "",
      goto: "",
      appId: "",
      cookies: new Map(),
    });

    const originalExpiresAt = session.expiresAt;

    expect(() => store.authenticateSession(session, "test-token", {
      studentId: "20260001",
      dormitory: null,
      updatedAt: new Date().toISOString(),
    })).toThrow("SESSION_SECRET 未配置或长度不足 32 个字符");
    expect(session).toMatchObject({
      stage: "waiting",
      message: "测试",
      expiresAt: originalExpiresAt,
    });
    expect(session.token).toBeUndefined();
    expect(session.profile).toBeUndefined();
  });

  it("退出后异步请求不能重新持久化已删除的会话", async () => {
    const { store, dataDirectory } = await loadIsolatedStore();
    const session = store.createLoginSession({
      expiresAt: Date.now() + store.LOGIN_TTL_MS,
      stage: "waiting",
      message: "测试",
      qrImage: "",
      qrCode: "",
      goto: "",
      appId: "",
      cookies: new Map(),
    });
    store.authenticateSession(session, "test-token", {
      studentId: "20260001",
      dormitory: null,
      updatedAt: new Date().toISOString(),
    });
    const sessionPath = join(dataDirectory, `${session.id}.session`);

    store.deleteLoginSession(session.id);
    expect(existsSync(sessionPath)).toBe(false);

    session.profile = {
      studentId: "20260001",
      dormitory: { address: "学生园区 2 舍", checkInRadius: "300 米" },
      updatedAt: new Date().toISOString(),
    };
    expect(store.persistAuthenticatedSession(session)).toBe(false);
    expect(existsSync(sessionPath)).toBe(false);
  });

  it("退出后未完成的登录流程不能恢复已删除的会话", async () => {
    const { store, dataDirectory } = await loadIsolatedStore();
    const session = store.createLoginSession({
      expiresAt: Date.now() + store.LOGIN_TTL_MS,
      stage: "waiting",
      message: "等待扫码",
      qrImage: "",
      qrCode: "",
      goto: "",
      appId: "",
      cookies: new Map(),
    });

    store.deleteLoginSession(session.id);
    expect(() => store.authenticateSession(session, "test-token", {
      studentId: "20260001",
      dormitory: null,
      updatedAt: new Date().toISOString(),
    })).toThrow("登录会话已失效");
    expect(session.stage).toBe("waiting");
    expect(existsSync(join(dataDirectory, `${session.id}.session`))).toBe(false);
  });
});
