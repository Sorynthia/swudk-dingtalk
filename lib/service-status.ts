import "server-only";

export const SERVICE_DISABLED_MESSAGE = "服务暂未开放，请稍后再试";

export function parseServiceEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function hasValidProductionConfiguration() {
  if (process.env.NODE_ENV !== "production") return true;
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return false;
  try {
    const origin = new URL(process.env.APP_ORIGIN ?? "");
    return (
      origin.protocol === "https:" &&
      !origin.username &&
      !origin.password &&
      origin.pathname === "/" &&
      !origin.search &&
      !origin.hash
    );
  } catch {
    return false;
  }
}

export function isServiceEnabled() {
  return parseServiceEnabled(process.env.SERVICE_ENABLED) && hasValidProductionConfiguration();
}
