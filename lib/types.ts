export type LoginStage = "waiting" | "scanned" | "authenticated" | "expired" | "error";

export type ApiRecord = Record<string, unknown>;

export interface DormitoryProfile {
  address: string | null;
  checkInRadius: string | null;
}

export interface StudentProfile {
  studentId: string;
  dormitory: DormitoryProfile | null;
  updatedAt: string;
}

export type CheckInState = "available" | "checked_in" | "not_required" | "on_leave" | "unavailable";

export interface CheckInStatus {
  state: CheckInState;
  message: string;
}

export interface SessionPayload {
  stage: LoginStage | "unauthenticated";
  message?: string;
  qrImage?: string;
  expiresAt?: number;
  profile?: StudentProfile;
}
