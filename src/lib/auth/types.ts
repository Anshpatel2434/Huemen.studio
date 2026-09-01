export type Role = "owner_admin" | "coach" | "client";

export interface Session {
  userId: string;
  /** The user's home tenant (their org for admin/coach, their workspace for client). */
  tenantId: string;
  role: Role;
  email: string;
}

export function isPlatformAdmin(role: Role): boolean {
  return role === "owner_admin";
}
