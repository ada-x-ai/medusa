import type { AuthenticatedMedusaRequest, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthContextFromJwtToken } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { generateJwtTokenWithChecks } from "@medusajs/medusa/api/auth/utils/generate-jwt-token"
import { completeIdentity, rejectHubTokenLogin, requireHubOperator, startIdentity } from "../session"
import { createFlow, exchangeCode } from "../protocol"
import { ensureOperatorIdentity, validateOperatorSession } from "../operator"
import { IdentityError } from "../configuration"
import { configuration, identityEnvironment } from "./fixtures"

jest.mock("../protocol", () => ({
  ...jest.requireActual("../protocol"),
  authorizationUrl: jest.fn().mockResolvedValue("https://hub.example.test/api/auth/oauth2/authorize"),
  exchangeCode: jest.fn(),
}))
jest.mock("../operator", () => ({ ensureOperatorIdentity: jest.fn(), validateOperatorSession: jest.fn() }))
jest.mock("@medusajs/medusa/api/auth/utils/generate-jwt-token", () => ({ generateJwtTokenWithChecks: jest.fn() }))
jest.mock("@medusajs/framework/http", () => ({ getAuthContextFromJwtToken: jest.fn() }))

describe("Hub native Admin session", () => {
  const originalEnvironment = process.env
  const context = {
    actor_id: "user_1", actor_type: "user", auth_identity_id: "auth_1", auth_provider: "hub",
    app_metadata: { user_id: "user_1" }, user_metadata: {},
  }
  const auth = { authenticate: jest.fn() }
  let request: MedusaRequest
  let response: MedusaResponse
  let session: Record<string, any>
  let status: jest.Mock
  let json: jest.Mock
  let redirect: jest.Mock
  let regenerated: number

  function newSession() {
    session = {
      save: jest.fn((callback) => callback()),
      regenerate: jest.fn((callback) => {
        regenerated += 1
        newSession()
        callback()
      }),
      destroy: jest.fn((callback) => callback()),
    }
    if (request) request.session = session as MedusaRequest["session"]
  }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnvironment, ...identityEnvironment }
    regenerated = 0
    request = undefined as unknown as MedusaRequest
    newSession()
    request = {
      session,
      scope: { resolve: (key: string) => {
        if (key === Modules.AUTH) return auth
        if (key === ContainerRegistrationKeys.CONFIG_MODULE) return { projectConfig: { http: { jwtSecret: "native-secret" } } }
        throw new Error("Unexpected service")
      } },
    } as unknown as MedusaRequest
    json = jest.fn()
    redirect = jest.fn()
    status = jest.fn().mockReturnValue({ json })
    response = { setHeader: jest.fn(), redirect, status } as unknown as MedusaResponse
    auth.authenticate.mockResolvedValue({
      success: true, authIdentity: { id: "auth_1", app_metadata: { user_id: "user_1" } },
    })
    jest.mocked(generateJwtTokenWithChecks).mockResolvedValue({ token: "native-token" })
    jest.mocked(getAuthContextFromJwtToken).mockReturnValue(context)
    jest.mocked(exchangeCode).mockResolvedValue({
      accessToken: "central-token", subject: "hub-user-1", expiresAt: Date.now() + 300_000,
    })
  })
  afterEach(() => { process.env = originalEnvironment })

  function callbackRequest() {
    const flow = createFlow(configuration)
    session.identityFlow = flow
    request.originalUrl = `/identity/callback?state=${flow.state}&code=one-use-code&iss=${encodeURIComponent(configuration.issuer)}`
    return flow
  }

  it("saves a browser-bound flow before redirecting to Hub", async () => {
    await startIdentity(request, response)
    expect(regenerated).toBe(1)
    expect(session.identityFlow.issuer).toBe(configuration.issuer)
    expect(session.save).toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith(303, "https://hub.example.test/api/auth/oauth2/authorize")
  })

  it("converts verified Hub authorization into a fresh native server session", async () => {
    callbackRequest()
    await completeIdentity(request, response)
    expect(ensureOperatorIdentity).toHaveBeenCalledWith(request, configuration, "hub-user-1")
    expect(generateJwtTokenWithChecks).toHaveBeenCalledWith(request.scope, expect.objectContaining({ actorType: "user", authProvider: "hub" }))
    expect(regenerated).toBe(1)
    expect(session.auth_context).toEqual(context)
    expect(session.hubIdentity).toMatchObject({ accessToken: "central-token", subject: "hub-user-1", authIdentityId: "auth_1" })
    expect(session.identityFlow).toBeUndefined()
    expect(redirect).toHaveBeenCalledWith(303, "https://commerce.example.test/app")
    expect(json).not.toHaveBeenCalled()
  })

  it("consumes an authorization flow even when token exchange fails", async () => {
    callbackRequest()
    jest.mocked(exchangeCode).mockRejectedValueOnce(new Error("Token exchange failed"))
    await completeIdentity(request, response)
    expect(session.identityFlow).toBeUndefined()
    expect(regenerated).toBe(0)
    expect(session.auth_context).toBeUndefined()
    expect(status).toHaveBeenCalledWith(503)
    await completeIdentity(request, response)
    expect(exchangeCode).toHaveBeenCalledTimes(1)
    expect(status).toHaveBeenLastCalledWith(400)
  })

  it.each(["mfa", "verification"])("does not bypass native %s requirements", async (requirement) => {
    callbackRequest()
    const result = requirement === "mfa" ? {
      token: "limited-token", mfa_required: true, mfa_challenge: { id: "challenge" },
    } : { token: "limited-token", verification_required: true }
    jest.mocked(generateJwtTokenWithChecks).mockResolvedValueOnce(result as Awaited<ReturnType<typeof generateJwtTokenWithChecks>>)
    await completeIdentity(request, response)
    expect(status).toHaveBeenCalledWith(403)
    expect(session.auth_context).toBeUndefined()
    expect(getAuthContextFromJwtToken).not.toHaveBeenCalled()
  })

  it("refuses an unexpected authenticated actor before issuing a native token", async () => {
    callbackRequest()
    auth.authenticate.mockResolvedValueOnce({
      success: true, authIdentity: { id: "auth_2", app_metadata: { user_id: "user_2" } },
    })
    await completeIdentity(request, response)
    expect(status).toHaveBeenCalledWith(401)
    expect(generateJwtTokenWithChecks).not.toHaveBeenCalled()
  })

  it("rejects direct token login even when another client presents an active product token", () => {
    request.body = { access_token: "active-token-issued-to-another-client" }
    request.params = { actor_type: "user", auth_provider: "hub" }
    rejectHubTokenLogin(request, response, jest.fn())
    expect(status).toHaveBeenCalledWith(403)
    expect(json).toHaveBeenCalledWith({ message: "Start Hub sign-in from /identity/start" })
    expect(auth.authenticate).not.toHaveBeenCalled()
    expect(getAuthContextFromJwtToken).not.toHaveBeenCalled()
  })

  it("preserves customer and other provider authentication", () => {
    const next = jest.fn()
    request.params = { actor_type: "customer", auth_provider: "emailpass" }
    rejectHubTokenLogin(request, response, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(status).not.toHaveBeenCalled()
  })

  it("rejects invalid central sessions on Admin requests and allows existing API-key automation", async () => {
    const next = jest.fn()
    jest.mocked(validateOperatorSession).mockRejectedValueOnce(new IdentityError(401, "Expired"))
    await requireHubOperator(Object.assign(request, { auth_context: context }), response, next)
    expect(session.destroy).toHaveBeenCalled()
    expect(status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
    await requireHubOperator(Object.assign(request, { auth_context: { ...context, actor_type: "api-key" } }), response, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(validateOperatorSession).toHaveBeenCalledTimes(1)
  })
})
