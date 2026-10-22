import { z } from "zod";
import type { UserRole } from "./types";

export const roleHomes = {
  agent: "/agent",
  supervisor: "/dispatch",
  admin: "/admin",
} as const satisfies Record<UserRole, string>;

export const profileAccessSchema = z.object({
  role: z.enum(["agent", "supervisor", "admin"]),
  is_active: z.boolean(),
});

export const profileSchema = profileAccessSchema.extend({
  id: z.uuid(),
  badge_number: z.string().min(1),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
});
