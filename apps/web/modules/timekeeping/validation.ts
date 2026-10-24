import { z } from "zod";

export const positionSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

// Identity, times, site coordinates and perimeter results never come from clients.
export const checkInSchema = positionSchema
  .extend({ siteId: z.uuid() })
  .strict();
export const checkOutSchema = positionSchema
  .extend({ sessionId: z.uuid() })
  .strict();
