import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { identityConfiguration } from "../../../lib/identity/configuration"
import { identityFailure } from "../../../lib/identity/session"

export const AUTHENTICATE = false

export function GET(_req: MedusaRequest, res: MedusaResponse): void {
  try {
    res.setHeader("Cache-Control", "no-store")
    res.json({ enabled: Boolean(identityConfiguration()) })
  } catch (error) {
    identityFailure(res, error)
  }
}
