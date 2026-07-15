import { cookies } from "next/headers";

import AppShell from "@/components/app-shell";
import {
  deleteLoginSession,
  getLoginSession,
  type LoginSession,
  SESSION_COOKIE,
} from "@/lib/session-store";
import { getCheckInStatus, isSwuUnauthorizedError } from "@/lib/swu";
import type { CheckInStatus, SessionPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

function getInitialPayload(session: LoginSession | undefined): SessionPayload {
  if (!session) return { stage: "unauthenticated" };

  return {
    stage: session.stage,
    message: session.message,
    qrImage: session.stage === "waiting" || session.stage === "scanned" ? session.qrImage : undefined,
    expiresAt: session.stage === "waiting" || session.stage === "scanned" ? session.expiresAt : undefined,
    profile: session.stage === "authenticated" ? session.profile : undefined,
  };
}

export default async function HomePage() {
  const cookieStore = await cookies();
  let session = getLoginSession(cookieStore.get(SESSION_COOKIE)?.value);
  let initialPayload = getInitialPayload(session);
  let initialCheckInStatus: CheckInStatus | undefined;
  let initialCheckInError: string | undefined;

  if (session?.stage === "authenticated" && session.token) {
    try {
      initialCheckInStatus = await getCheckInStatus(session.token);
    } catch (error) {
      if (isSwuUnauthorizedError(error)) {
        deleteLoginSession(session.id);
        session = undefined;
        initialPayload = getInitialPayload(undefined);
      } else {
        initialCheckInError = error instanceof Error ? error.message : "签到状态查询失败";
      }
    }
  }

  return (
    <AppShell
      initialPayload={initialPayload}
      initialCheckInStatus={initialCheckInStatus}
      initialCheckInError={initialCheckInError}
    />
  );
}
