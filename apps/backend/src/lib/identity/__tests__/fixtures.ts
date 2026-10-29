import { identityConfiguration } from "../configuration"

export const identityEnvironment = {
  HUB_IDENTITY_ORIGIN: "https://hub.example.test",
  HUB_IDENTITY_CLIENT_ID: "medusa-admin",
  HUB_IDENTITY_CLIENT_SECRET: "example-client-secret",
  HUB_IDENTITY_PRODUCT_ID: "medusa",
  MEDUSA_PUBLIC_URL: "https://commerce.example.test",
  HUB_IDENTITY_BINDINGS: JSON.stringify([{
    issuer: "https://hub.example.test/api/auth", subject: "hub-user-1", userId: "user_1",
  }]),
}

export const configuration = identityConfiguration(identityEnvironment)!
