export async function requestLogout(fetcher: typeof fetch = fetch) {
  const response = await fetcher("/api/auth/session", { method: "DELETE" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message || "退出登录失败，请重试");
  }
}
