import { AbstractAuthModuleProvider } from "@medusajs/framework/utils"
import type { AuthenticationInput, AuthenticationResponse, AuthIdentityProviderService } from "@medusajs/framework/types"
import { z } from "@medusajs/framework/zod"
import { IdentityConfiguration, identityBinding, providerEntityId } from "../../lib/identity/configuration"
import { currentIdentity } from "../../lib/identity/protocol"

export default class HubAuthService extends AbstractAuthModuleProvider {
  static identifier = "hub"
  static DISPLAY_NAME = "Hub"

  constructor(container: Record<string, unknown>, private readonly configuration: IdentityConfiguration) {
    super()
  }

  async authenticate(
    input: AuthenticationInput, identities: AuthIdentityProviderService
  ): Promise<AuthenticationResponse> {
    try {
      const { access_token } = z.object({ access_token: z.string().min(1) }).parse(input.body)
      const subject = await currentIdentity(this.configuration, access_token)
      const binding = identityBinding(this.configuration, subject)
      const authIdentity = await identities.retrieve({
        entity_id: providerEntityId(binding.issuer, subject),
      })
      if (authIdentity.app_metadata?.user_id !== binding.userId) {
        return { success: false, error: "The Hub operator binding is invalid" }
      }
      return { success: true, authIdentity }
    } catch {
      return { success: false, error: "Hub authentication failed" }
    }
  }
}
