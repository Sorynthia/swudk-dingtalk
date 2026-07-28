import "server-only";

export const SERVICE_DISABLED_MESSAGE = "服务暂未开放，请稍后再试";

export function parseServiceEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function isServiceEnabled() {
  return parseServiceEnabled(process.env.SERVICE_ENABLED);
}
