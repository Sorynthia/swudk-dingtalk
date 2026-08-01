import "server-only";

import { NextResponse } from "next/server";

import { SERVICE_DISABLED_MESSAGE } from "@/lib/service-status";

export function serviceUnavailableResponse() {
  return NextResponse.json({ message: SERVICE_DISABLED_MESSAGE }, { status: 503 });
}
