import type { AuthContext, MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { IdentityConfiguration, IdentityError, identityBinding, providerEntityId } from "./configuration"
import { currentIdentity } from "./protocol"

export type OperatorSession = {
  accessToken: string
  expiresAt: number
  issuer: string
  productId: string
  clientId: string
  subject: string
  authIdentityId: string
}

export async function ensureOperatorIdentity(
  req: MedusaRequest, configuration: IdentityConfiguration, subject: string
): Promise<void> {
  const binding = identityBinding(configuration, subject)
  const user = await req.scope.resolve(Modules.USER).retrieveUser(binding.userId)
  if (user.deleted_at) throw new IdentityError(403, "The assigned Medusa operator is unavailable")
  const auth = req.scope.resolve(Modules.AUTH)
  const entityId = providerEntityId(binding.issuer, subject)
  const registered = await auth.listAuthIdentities({
    provider_identities: { provider: "hub", entity_id: entityId },
  })
  if (registered.length > 1 || (registered.length === 1 && registered[0].app_metadata?.user_id !== user.id)) {
    throw new IdentityError(403, "The Hub identity is already bound to another Medusa operator")
  }
  if (registered.length === 1) return
  const nativeIdentities = await auth.listAuthIdentities({ app_metadata: { user_id: user.id } })
  if (nativeIdentities.length !== 1) {
    throw new IdentityError(403, "The assigned Medusa operator must have one existing authentication identity")
  }
  // 复用原身份，避免通过新身份绕过已有的双重验证设置。
  await auth.createProviderIdentities({
    provider: "hub", entity_id: entityId, auth_identity_id: nativeIdentities[0].id,
  })
}

export async function validateOperatorSession(
  req: MedusaRequest, configuration: IdentityConfiguration,
  proof: OperatorSession | undefined, context: AuthContext | undefined
): Promise<void> {
  if (!proof || !context || proof.expiresAt <= Date.now() ||
    proof.issuer !== configuration.issuer || proof.productId !== configuration.productId ||
    proof.clientId !== configuration.clientId || context.actor_type !== "user" ||
    context.auth_provider !== "hub" || context.auth_identity_id !== proof.authIdentityId) {
    throw new IdentityError(401, "The Hub operator session has expired")
  }
  const binding = identityBinding(configuration, proof.subject)
  if (binding.userId !== context.actor_id || context.app_metadata.user_id !== binding.userId) {
    throw new IdentityError(401, "The Medusa operator binding has changed")
  }
  const subject = await currentIdentity(configuration, proof.accessToken)
  if (subject !== proof.subject) throw new IdentityError(401, "The Hub operator session is invalid")
  const user = await req.scope.resolve(Modules.USER).retrieveUser(binding.userId)
  if (user.deleted_at) throw new IdentityError(401, "The assigned Medusa operator is unavailable")
  const auth = req.scope.resolve(Modules.AUTH)
  const identity = await auth.retrieveAuthIdentity(proof.authIdentityId, { relations: ["provider_identities"] })
  if (identity.app_metadata?.user_id !== binding.userId ||
    !identity.provider_identities?.some((provider) => provider.provider === "hub" &&
      provider.entity_id === providerEntityId(configuration.issuer, subject))) {
    throw new IdentityError(401, "The Hub provider binding has changed")
  }
}
