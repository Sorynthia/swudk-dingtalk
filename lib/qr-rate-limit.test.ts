import { afterEach, describe, expect, it } from "vitest";

import { acquireQrGenerationLease, resetQrRateLimitForTests } from "@/lib/qr-rate-limit";

afterEach(() => {
  resetQrRateLimitForTests();
});

describe("二维码生成限流", () => {
  it("同一会话在窗口内只允许五次生成", () => {
    const request = new Request("http://localhost/api/auth/qr", { method: "POST" });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const lease = acquireQrGenerationLease(request, "session-1", 1_000);
      expect(lease).toBeDefined();
      lease?.release();
    }
    expect(acquireQrGenerationLease(request, "session-1", 1_000)).toBeUndefined();
  });

  it("全局只允许四个同时进行的生成请求", () => {
    const request = new Request("http://localhost/api/auth/qr", { method: "POST" });
    const leases = Array.from({ length: 4 }, (_, index) =>
      acquireQrGenerationLease(request, `session-${index}`, 1_000),
    );
    expect(leases.every(Boolean)).toBe(true);
    expect(acquireQrGenerationLease(request, "session-5", 1_000)).toBeUndefined();
    leases.forEach((lease) => lease?.release());
  });
});
