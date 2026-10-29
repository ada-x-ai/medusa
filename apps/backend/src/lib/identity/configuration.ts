import { z } from "@medusajs/framework/zod"

const bindingSchema = z.object({
  issuer: z.url(),
  subject: z.string().min(1),
  userId: z.string().min(1),
}).strict()

const environmentSchema = z.object({
  HUB_IDENTITY_ORIGIN: z.url(),
  HUB_IDENTITY_BROWSER_ORIGIN: z.union([z.url(), z.literal("")]).optional(),
  HUB_IDENTITY_CLIENT_ID: z.string().min(1),
  HUB_IDENTITY_CLIENT_SECRET: z.string().min(1),
  HUB_IDENTITY_PRODUCT_ID: z.string().min(1),
  HUB_IDENTITY_BINDINGS: z.string().min(1),
  MEDUSA_PUBLIC_URL: z.url(),
})

export type IdentityBinding = z.infer<typeof bindingSchema>
export type IdentityConfiguration = {
  origin: string
  browserOrigin: string
  issuer: string
  clientId: string
  clientSecret: string
  productId: string
  publicOrigin: string
  callbackUrl: string
  bindings: IdentityBinding[]
}

export class IdentityError extends Error {
  constructor(public readonly status: 400 | 401 | 403 | 503, message: string) {
    super(message)
  }
}

function origin(value: string): string {
  const url = new URL(value)
  const local = new Set(["localhost", "127.0.0.1", "[::1]"])
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local.has(url.hostname))) ||
    url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new IdentityError(503, "Identity URLs must be HTTPS origins or local development origins")
  }
  return url.origin
}

export function identityConfiguration(
  environment: Record<string, string | undefined> = process.env
): IdentityConfiguration | undefined {
  const fields = [environment.HUB_IDENTITY_ORIGIN, environment.HUB_IDENTITY_CLIENT_ID,
    environment.HUB_IDENTITY_CLIENT_SECRET, environment.HUB_IDENTITY_PRODUCT_ID,
    environment.HUB_IDENTITY_BINDINGS, environment.HUB_IDENTITY_BROWSER_ORIGIN]
  if (fields.every((value) => value === undefined || value === "")) return undefined
  const values = environmentSchema.parse(environment)
  const identityOrigin = origin(values.HUB_IDENTITY_ORIGIN)
  const browserOrigin = origin(values.HUB_IDENTITY_BROWSER_ORIGIN || identityOrigin)
  const publicOrigin = origin(values.MEDUSA_PUBLIC_URL)
  const issuer = new URL("/api/auth", identityOrigin).href
  const bindings = z.array(bindingSchema).min(1).parse(JSON.parse(values.HUB_IDENTITY_BINDINGS))
  const subjects = new Set<string>()
  const users = new Set<string>()
  for (const binding of bindings) {
    const key = providerEntityId(binding.issuer, binding.subject)
    if (binding.issuer !== issuer || subjects.has(key) || users.has(binding.userId)) {
      throw new IdentityError(503, "Identity bindings must use the configured issuer and unique subjects and users")
    }
    subjects.add(key)
    users.add(binding.userId)
  }
  return {
    origin: identityOrigin, browserOrigin, issuer, publicOrigin, bindings,
    clientId: values.HUB_IDENTITY_CLIENT_ID,
    clientSecret: values.HUB_IDENTITY_CLIENT_SECRET,
    productId: values.HUB_IDENTITY_PRODUCT_ID,
    callbackUrl: new URL("/identity/callback", publicOrigin).href,
  }
}

export function providerEntityId(issuer: string, subject: string): string {
  return JSON.stringify([issuer, subject])
}

export function identityBinding(configuration: IdentityConfiguration, subject: string): IdentityBinding {
  const binding = configuration.bindings.find((entry) =>
    entry.issuer === configuration.issuer && entry.subject === subject)
  if (!binding) throw new IdentityError(403, "This Hub identity is not assigned to a Medusa operator")
  return binding
}
