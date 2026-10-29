import type { AuthContext, MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { providerEntityId } from "../configuration"
import { ensureOperatorIdentity, OperatorSession, validateOperatorSession } from "../operator"
import { currentIdentity } from "../protocol"
import { configuration } from "./fixtures"

jest.mock("../protocol", () => ({ currentIdentity: jest.fn() }))

describe("Medusa operator identity", () => {
  const auth = {
    listAuthIdentities: jest.fn(), createProviderIdentities: jest.fn(), retrieveAuthIdentity: jest.fn(),
  }
  const users = { retrieveUser: jest.fn() }
  const req = { scope: { resolve: (key: string) => {
    if (key === Modules.AUTH) return auth
    if (key === Modules.USER) return users
    throw new Error("Unexpected service")
  } } } as unknown as MedusaRequest
  const context: AuthContext = {
    actor_id: "user_1", actor_type: "user", auth_identity_id: "auth_1", auth_provider: "hub",
    app_metadata: { user_id: "user_1" }, user_metadata: {},
  }
  const proof: OperatorSession = {
    accessToken: "central-token", expiresAt: Date.now() + 300_000,
    issuer: configuration.issuer, productId: configuration.productId, clientId: configuration.clientId,
    subject: "hub-user-1", authIdentityId: "auth_1",
  }

  beforeEach(() => {
    jest.clearAllMocks()
    users.retrieveUser.mockResolvedValue({ id: "user_1", deleted_at: null })
    auth.retrieveAuthIdentity.mockResolvedValue({
      id: "auth_1", app_metadata: { user_id: "user_1" },
      provider_identities: [{ provider: "hub", entity_id: providerEntityId(configuration.issuer, "hub-user-1") }],
    })
    jest.mocked(currentIdentity).mockResolvedValue("hub-user-1")
  })

  it("attaches Hub to the existing native identity without replacing MFA or creating an operator", async () => {
    auth.listAuthIdentities.mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "auth_with_native_mfa", app_metadata: { user_id: "user_1" } }])
    await ensureOperatorIdentity(req, configuration, "hub-user-1")
    expect(auth.createProviderIdentities).toHaveBeenCalledWith({
      provider: "hub", auth_identity_id: "auth_with_native_mfa",
      entity_id: providerEntityId(configuration.issuer, "hub-user-1"),
    })
  })

  it("reuses an existing exact provider binding", async () => {
    auth.listAuthIdentities.mockResolvedValueOnce([{ id: "auth_1", app_metadata: { user_id: "user_1" } }])
    await ensureOperatorIdentity(req, configuration, "hub-user-1")
    expect(auth.createProviderIdentities).not.toHaveBeenCalled()
  })

  it("refuses to rebind an existing identity to a different operator", async () => {
    auth.listAuthIdentities.mockResolvedValueOnce([{ id: "auth_2", app_metadata: { user_id: "user_2" } }])
    await expect(ensureOperatorIdentity(req, configuration, "hub-user-1")).rejects.toMatchObject({ status: 403 })
    expect(auth.createProviderIdentities).not.toHaveBeenCalled()
  })

  it.each([[], [{ id: "auth_1" }, { id: "auth_2" }]])("rejects missing or ambiguous native identities", async (...identities) => {
    auth.listAuthIdentities.mockResolvedValueOnce([]).mockResolvedValueOnce(identities)
    await expect(ensureOperatorIdentity(req, configuration, "hub-user-1")).rejects.toThrow()
    expect(auth.createProviderIdentities).not.toHaveBeenCalled()
  })

  it("checks both the current central identity and native provider link on session restore", async () => {
    await expect(validateOperatorSession(req, configuration, proof, context)).resolves.toBeUndefined()
    expect(currentIdentity).toHaveBeenCalledWith(configuration, "central-token")
    expect(auth.retrieveAuthIdentity).toHaveBeenCalledWith("auth_1", { relations: ["provider_identities"] })
  })

  it.each([
    { expiresAt: 0 }, { issuer: "https://other.test/api/auth" },
    { productId: "other" }, { clientId: "other" }, { authIdentityId: "other" },
  ])("rejects an expired or changed session binding", async (change) => {
    await expect(validateOperatorSession(req, configuration, { ...proof, ...change }, context)).rejects.toThrow()
    expect(currentIdentity).not.toHaveBeenCalled()
  })

  it("rejects a legacy password session without a Hub proof", async () => {
    await expect(validateOperatorSession(req, configuration, undefined, { ...context, auth_provider: "emailpass" })).rejects.toThrow()
  })

  it("rejects central revocation on the next Admin request", async () => {
    jest.mocked(currentIdentity).mockRejectedValueOnce(new Error("Revoked"))
    await expect(validateOperatorSession(req, configuration, proof, context)).rejects.toThrow()
  })

  it("rejects a deleted operator", async () => {
    users.retrieveUser.mockResolvedValueOnce({ id: "user_1", deleted_at: new Date() })
    await expect(validateOperatorSession(req, configuration, proof, context)).rejects.toThrow()
  })

  it("rejects a removed provider link or changed actor association", async () => {
    for (const identity of [
      { app_metadata: { user_id: "user_1" }, provider_identities: [] },
      { app_metadata: { user_id: "user_2" }, provider_identities: [{ provider: "hub" }] },
    ]) {
      auth.retrieveAuthIdentity.mockResolvedValueOnce(identity)
      await expect(validateOperatorSession(req, configuration, proof, context)).rejects.toThrow()
    }
  })
})
