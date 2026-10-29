import { identityBinding, identityConfiguration, providerEntityId } from "../configuration"
import { configuration, identityEnvironment } from "./fixtures"

describe("Hub identity configuration", () => {
  it("leaves native authentication unchanged when no identity fields are configured", () => {
    expect(identityConfiguration({})).toBeUndefined()
  })

  it("rejects partial configuration", () => {
    expect(() => identityConfiguration({ HUB_IDENTITY_ORIGIN: identityEnvironment.HUB_IDENTITY_ORIGIN })).toThrow()
  })

  it.each([
    "http://hub.example.test", "https://name:secret@hub.example.test",
    "https://hub.example.test/other", "https://hub.example.test?target=other",
    "https://hub.example.test#fragment",
  ])("rejects an unsafe identity origin %s", (origin) => {
    expect(() => identityConfiguration({ ...identityEnvironment, HUB_IDENTITY_ORIGIN: origin })).toThrow()
  })

  it("uses a fixed callback and exact issuer", () => {
    expect(configuration.callbackUrl).toBe("https://commerce.example.test/identity/callback")
    expect(configuration.issuer).toBe("https://hub.example.test/api/auth")
    expect(configuration.browserOrigin).toBe(configuration.origin)
  })

  it("validates the explicit browser origin without changing the canonical issuer", () => {
    const values = identityConfiguration({ ...identityEnvironment, HUB_IDENTITY_BROWSER_ORIGIN: "https://console.example.test" })!
    expect(values.browserOrigin).toBe("https://console.example.test")
    expect(values.issuer).toBe(configuration.issuer)
    expect(() => identityConfiguration({ ...identityEnvironment, HUB_IDENTITY_BROWSER_ORIGIN: "https://console.example.test/path" })).toThrow()
  })

  it.each([
    [{ issuer: "https://other.example.test/api/auth", subject: "hub-user-1", userId: "user_1" }],
    [{ issuer: configuration.issuer, subject: "hub-user-1", userId: "user_1" },
      { issuer: configuration.issuer, subject: "hub-user-1", userId: "user_2" }],
    [{ issuer: configuration.issuer, subject: "hub-user-1", userId: "user_1" },
      { issuer: configuration.issuer, subject: "hub-user-2", userId: "user_1" }],
  ])("rejects cross-issuer or duplicate mappings", (...bindings) => {
    expect(() => identityConfiguration({
      ...identityEnvironment, HUB_IDENTITY_BINDINGS: JSON.stringify(bindings),
    })).toThrow()
  })

  it("never matches a subject by email, partial value, or case conversion", () => {
    expect(identityBinding(configuration, "hub-user-1").userId).toBe("user_1")
    for (const subject of ["hub-user", "HUB-USER-1", "admin@example.test"]) {
      expect(() => identityBinding(configuration, subject)).toThrow()
    }
  })

  it("encodes issuer and subject without tuple ambiguity", () => {
    expect(providerEntityId("issuer:a", "b")).not.toBe(providerEntityId("issuer", "a:b"))
  })
})
