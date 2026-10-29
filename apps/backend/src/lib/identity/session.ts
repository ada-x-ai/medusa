import type { AuthenticatedMedusaRequest, MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import { getAuthContextFromJwtToken } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { generateJwtTokenWithChecks } from "@medusajs/medusa/api/auth/utils/generate-jwt-token"
import { IdentityError, identityBinding, identityConfiguration } from "./configuration"
import { authorizationUrl, callbackCode, createFlow, exchangeCode, IdentityFlow } from "./protocol"
import { ensureOperatorIdentity, OperatorSession, validateOperatorSession } from "./operator"

type IdentitySession = MedusaRequest["session"] & {
  identityFlow?: IdentityFlow
  hubIdentity?: OperatorSession
}

function save(session: IdentitySession): Promise<void> {
  return new Promise((resolve, reject) => session.save((error) => error ? reject(error) : resolve()))
}

function regenerate(req: MedusaRequest): Promise<void> {
  return new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()))
}

export function identityFailure(res: MedusaResponse, error: unknown): void {
  res.setHeader("Cache-Control", "no-store")
  res.setHeader("Referrer-Policy", "no-referrer")
  res.status(error instanceof IdentityError ? error.status : 503).json({
    message: error instanceof IdentityError ? error.message : "Hub sign-in is unavailable. Return to Hub and try again.",
  })
}

export function rejectHubTokenLogin(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void {
  if (req.params.actor_type !== "user" || req.params.auth_provider !== "hub") return next()
  // 只接受浏览器回调中的授权证明，禁止其他客户端的访问令牌直接换取管理员身份。
  identityFailure(res, new IdentityError(403, "Start Hub sign-in from /identity/start"))
}

export async function startIdentity(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const configuration = identityConfiguration()
    if (!configuration) throw new IdentityError(403, "Hub sign-in is not configured")
    const flow = createFlow(configuration)
    const location = await authorizationUrl(configuration, flow)
    await regenerate(req)
    const session = req.session as IdentitySession
    session.identityFlow = flow
    await save(session)
    res.setHeader("Cache-Control", "no-store")
    res.setHeader("Referrer-Policy", "no-referrer")
    res.redirect(303, location)
  } catch (error) {
    identityFailure(res, error)
  }
}

export async function completeIdentity(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const configuration = identityConfiguration()
    if (!configuration) throw new IdentityError(403, "Hub sign-in is not configured")
    const session = req.session as IdentitySession
    const flow = session.identityFlow
    // 先消费本次授权，再交换授权码，失败时不能重放回调。
    delete session.identityFlow
    await save(session)
    const query = new URL(req.originalUrl, configuration.publicOrigin).searchParams
    const code = callbackCode(configuration, flow, query)
    const proof = await exchangeCode(configuration, flow!, code)
    await ensureOperatorIdentity(req, configuration, proof.subject)
    const auth = req.scope.resolve(Modules.AUTH)
    const result = await auth.authenticate("hub", { body: { access_token: proof.accessToken } })
    if (!result.success || !result.authIdentity ||
      result.authIdentity.app_metadata?.user_id !== identityBinding(configuration, proof.subject).userId) {
      throw new IdentityError(401, "Hub authentication failed")
    }
    const native = await generateJwtTokenWithChecks(req.scope, {
      authIdentity: result.authIdentity, mfaChallenge: result.mfaChallenge,
      actorType: "user", authProvider: "hub",
    })
    if (native.mfa_required || native.verification_required) {
      throw new IdentityError(403, "Additional Medusa verification is required for this operator")
    }
    const { projectConfig: { http } } = req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
    if (!http.jwtSecret) throw new IdentityError(503, "The Medusa signing configuration is unavailable")
    const context = getAuthContextFromJwtToken(`Bearer ${native.token}`, http.jwtSecret,
      ["bearer"], ["user"], http.jwtPublicKey, http.jwtVerifyOptions ?? http.jwtOptions)
    if (!context?.actor_id || context.auth_identity_id !== result.authIdentity.id) {
      throw new IdentityError(401, "The Medusa authentication context is invalid")
    }
    await regenerate(req)
    const authenticated = req.session as IdentitySession
    authenticated.auth_context = context
    authenticated.hubIdentity = {
      ...proof, issuer: configuration.issuer, productId: configuration.productId,
      clientId: configuration.clientId, authIdentityId: context.auth_identity_id,
    }
    await save(authenticated)
    res.setHeader("Cache-Control", "no-store")
    res.setHeader("Referrer-Policy", "no-referrer")
    res.redirect(303, new URL("/app", configuration.publicOrigin).href)
  } catch (error) {
    identityFailure(res, error)
  }
}

export async function requireHubOperator(
  req: AuthenticatedMedusaRequest, res: MedusaResponse, next: MedusaNextFunction
): Promise<void> {
  try {
    const configuration = identityConfiguration()
    if (!configuration || req.auth_context?.actor_type === "api-key") return next()
    const session = req.session as IdentitySession
    await validateOperatorSession(req, configuration, session.hubIdentity, req.auth_context)
    next()
  } catch (error) {
    // 会话失效后由原生管理台返回登录页，再自动发起中央授权。
    req.session.destroy(() => identityFailure(res,
      error instanceof IdentityError && error.status === 503 ? error :
        new IdentityError(401, "The Hub operator session is no longer valid")))
  }
}
