import type { AuthIdentityProviderService } from "@medusajs/framework/types"
import HubAuthService from "../service"
import { currentIdentity } from "../../../lib/identity/protocol"
import { configuration } from "../../../lib/identity/__tests__/fixtures"
import { providerEntityId } from "../../../lib/identity/configuration"

jest.mock("../../../lib/identity/protocol", () => ({ currentIdentity: jest.fn() }))

describe("Hub auth provider", () => {
  const identities = { retrieve: jest.fn(), create: jest.fn(), update: jest.fn() }
  const provider = new HubAuthService({}, configuration)

  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(currentIdentity).mockResolvedValue("hub-user-1")
    identities.retrieve.mockResolvedValue({ id: "auth_1", app_metadata: { user_id: "user_1" } })
  })

  it("authenticates only a current identity already linked to its configured operator", async () => {
    const result = await provider.authenticate({ body: { access_token: "central-token" } }, identities as unknown as AuthIdentityProviderService)
    expect(result.success).toBe(true)
    expect(identities.retrieve).toHaveBeenCalledWith({ entity_id: providerEntityId(configuration.issuer, "hub-user-1") })
    expect(identities.create).not.toHaveBeenCalled()
  })

  it("refuses an unknown central subject without creating an auth identity", async () => {
    jest.mocked(currentIdentity).mockResolvedValueOnce("unknown-user")
    const result = await provider.authenticate({ body: { access_token: "central-token" } }, identities as unknown as AuthIdentityProviderService)
    expect(result.success).toBe(false)
    expect(identities.retrieve).not.toHaveBeenCalled()
    expect(identities.create).not.toHaveBeenCalled()
  })

  it("refuses a mismatched native actor", async () => {
    identities.retrieve.mockResolvedValueOnce({ id: "auth_2", app_metadata: { user_id: "user_2" } })
    const result = await provider.authenticate({ body: { access_token: "central-token" } }, identities as unknown as AuthIdentityProviderService)
    expect(result.success).toBe(false)
  })

  it("refuses missing proof or central validation failure", async () => {
    expect((await provider.authenticate({}, identities as unknown as AuthIdentityProviderService)).success).toBe(false)
    jest.mocked(currentIdentity).mockRejectedValueOnce(new Error("Unauthorized"))
    expect((await provider.authenticate({ body: { access_token: "expired" } }, identities as unknown as AuthIdentityProviderService)).success).toBe(false)
  })
})
