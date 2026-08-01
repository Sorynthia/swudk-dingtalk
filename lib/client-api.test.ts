import { describe, expect, it, vi } from "vitest";

import { requestLogout } from "@/lib/client-api";

describe("退出登录请求", () => {
  it("服务端失败时保留失败状态而不是假装退出", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ message: "本机会话删除失败" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    await expect(requestLogout(fetcher)).rejects.toThrow("本机会话删除失败");
  });
});
