import { z } from "@medusajs/framework/zod"

export const runtimeEnvironmentSchema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  MEDUSA_PUBLIC_URL: z.url(),
  JWT_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  STORE_CORS: z.string().default(""),
})
