import { createHash, randomBytes } from "node:crypto"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { z } from "@medusajs/framework/zod"
import { IdentityConfiguration, IdentityError, identityBinding } from "./configuration"

export type IdentityFlow = {
  state: string
  nonce: string
  verifier: string
  expiresAt: number
  issuer: string
  browserOrigin: string
  clientId: string
  productId: string
  callbackUrl: string
}

export type IdentityTokens = {
  accessToken: string
  expiresAt: number
  subject: string
}

type Discovery = {
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
}

export function createFlow(configuration: IdentityConfiguration, now = Date.now()): IdentityFlow {
  return {
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    expiresAt: now + 10 * 60 * 1000,
    issuer: configuration.issuer,
    browserOrigin: configuration.browserOrigin,
    clientId: configuration.clientId,
    productId: configuration.productId,
    callbackUrl: configuration.callbackUrl,
  }
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new IdentityError(response.status === 401 || response.status === 403 ? 401 : 503,
      "Hub identity verification is unavailable")
  }
  return response.json()
}

function endpoint(value: string, configuration: IdentityConfiguration): string {
  const url = new URL(value)
  if (url.origin !== configuration.origin || url.username || url.password || url.search || url.hash) {
    throw new IdentityError(503, "Hub discovery returned an invalid endpoint")
  }
  return url.href
}

async function discover(configuration: IdentityConfiguration): Promise<Discovery> {
  const response = await fetch(new URL("/.well-known/openid-configuration", configuration.origin), {
    redirect: "error", signal: AbortSignal.timeout(10_000),
  })
  const document = z.object({
    issuer: z.literal(configuration.issuer),
    authorization_endpoint: z.url(), token_endpoint: z.url(), jwks_uri: z.url(),
  }).parse(await responseJson(response))
  return {
    authorization_endpoint: endpoint(document.authorization_endpoint, configuration),
    token_endpoint: endpoint(document.token_endpoint, configuration),
    jwks_uri: endpoint(document.jwks_uri, configuration),
  }
}

export async function authorizationUrl(configuration: IdentityConfiguration, flow: IdentityFlow): Promise<string> {
  const discovery = await discover(configuration)
  const url = new URL(new URL(discovery.authorization_endpoint).pathname, configuration.browserOrigin)
  const fields = {
    client_id: configuration.clientId, redirect_uri: configuration.callbackUrl,
    response_type: "code", scope: "openid profile platform:entitlements:read",
    resource: new URL("/v1", configuration.origin).href,
    state: flow.state, nonce: flow.nonce, code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(flow.verifier).digest("base64url"),
  }
  for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value)
  return url.href
}

export function callbackCode(
  configuration: IdentityConfiguration, flow: IdentityFlow | undefined,
  query: URLSearchParams, now = Date.now()
): string {
  for (const key of ["state", "code", "iss", "error"]) {
    if (query.getAll(key).length > 1) throw new IdentityError(400, "Duplicate authorization callback parameter")
  }
  if (!flow || flow.expiresAt <= now || flow.issuer !== configuration.issuer ||
    flow.browserOrigin !== configuration.browserOrigin ||
    flow.clientId !== configuration.clientId || flow.productId !== configuration.productId ||
    flow.callbackUrl !== configuration.callbackUrl || query.get("state") !== flow.state ||
    (query.has("iss") && query.get("iss") !== configuration.issuer) || query.has("error")) {
    throw new IdentityError(400, "The Hub authorization attempt is invalid or expired")
  }
  const code = query.get("code")
  if (!code) throw new IdentityError(400, "The Hub authorization code is missing")
  return code
}

export async function currentIdentity(configuration: IdentityConfiguration, accessToken: string): Promise<string> {
  const response = await fetch(new URL("/v1/identity", configuration.origin), {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: "error", signal: AbortSignal.timeout(10_000),
  })
  const identity = z.object({
    userId: z.string().min(1), productId: z.literal(configuration.productId),
  }).parse(await responseJson(response))
  identityBinding(configuration, identity.userId)
  return identity.userId
}

export async function exchangeCode(
  configuration: IdentityConfiguration, flow: IdentityFlow, code: string
): Promise<IdentityTokens> {
  const discovery = await discover(configuration)
  const credentials = `${encodeURIComponent(configuration.clientId)}:${encodeURIComponent(configuration.clientSecret)}`
  const response = await fetch(discovery.token_endpoint, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Basic ${Buffer.from(credentials).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: configuration.callbackUrl,
      code_verifier: flow.verifier, resource: new URL("/v1", configuration.origin).href,
    }),
  })
  const tokens = z.object({
    access_token: z.string().min(1), id_token: z.string().min(1),
    token_type: z.enum(["Bearer", "bearer"]), expires_in: z.number().int().positive().max(86_400),
  }).parse(await responseJson(response))
  const verified = await jwtVerify(tokens.id_token,
    createRemoteJWKSet(new URL(discovery.jwks_uri), { timeoutDuration: 10_000 }), {
      issuer: configuration.issuer, audience: configuration.clientId,
      algorithms: ["EdDSA", "ES256", "RS256"], requiredClaims: ["sub", "iat", "exp", "nonce"],
      maxTokenAge: "10m",
    })
  const claims = verified.payload
  if (claims.nonce !== flow.nonce ||
    (claims.azp !== undefined && claims.azp !== configuration.clientId) ||
    (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== configuration.clientId)) {
    throw new IdentityError(401, "The Hub identity token does not match this authorization attempt")
  }
  const subject = await currentIdentity(configuration, tokens.access_token)
  if (subject !== claims.sub) throw new IdentityError(401, "Hub identity proofs do not match")
  return { accessToken: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000, subject }
}
