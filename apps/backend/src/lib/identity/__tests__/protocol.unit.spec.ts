import { createHash } from "node:crypto"
import { createLocalJWKSet, createRemoteJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose"
import { authorizationUrl, callbackCode, createFlow, exchangeCode } from "../protocol"
import { configuration } from "./fixtures"

jest.mock("jose", () => ({ ...jest.requireActual("jose"), createRemoteJWKSet: jest.fn() }))

const discovery = {
  issuer: configuration.issuer,
  authorization_endpoint: `${configuration.issuer}/oauth2/authorize`,
  token_endpoint: `${configuration.issuer}/oauth2/token`,
  jwks_uri: `${configuration.issuer}/jwks`,
}

describe("Hub authorization protocol", () => {
  let keys: Awaited<ReturnType<typeof generateKeyPair>>
  const fetchMock = jest.fn()
  const originalFetch = global.fetch

  beforeAll(async () => {
    keys = await generateKeyPair("RS256")
    const jwk = { ...await exportJWK(keys.publicKey), kid: "test-key", alg: "RS256" }
    jest.mocked(createRemoteJWKSet).mockReturnValue(createLocalJWKSet({ keys: [jwk] }) as ReturnType<typeof createRemoteJWKSet>)
    global.fetch = fetchMock
  })
  afterAll(() => { global.fetch = originalFetch })
  beforeEach(() => { fetchMock.mockReset() })

  async function tokens(nonce: string, claims: Record<string, unknown> = {}) {
    const token = await new SignJWT({ nonce, ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(configuration.issuer).setAudience(configuration.clientId)
      .setSubject("hub-user-1").setIssuedAt().setExpirationTime("5m").sign(keys.privateKey)
    return { access_token: "central-access-token", id_token: token, token_type: "Bearer", expires_in: 300 }
  }

  function mockExchange(tokenResponse: unknown, identity = { userId: "hub-user-1", productId: configuration.productId }) {
    fetchMock.mockResolvedValueOnce(Response.json(discovery))
      .mockResolvedValueOnce(Response.json(tokenResponse))
      .mockResolvedValueOnce(Response.json(identity))
  }

  it("starts a browser-bound authorization flow with PKCE and nonce", async () => {
    const flow = createFlow(configuration)
    fetchMock.mockResolvedValueOnce(Response.json(discovery))
    const url = new URL(await authorizationUrl(configuration, flow))
    expect(url.searchParams.get("state")).toBe(flow.state)
    expect(url.searchParams.get("nonce")).toBe(flow.nonce)
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(flow.verifier).digest("base64url"))
    expect(url.searchParams.get("redirect_uri")).toBe(configuration.callbackUrl)
    expect(url.searchParams.get("resource")).toBe(`${configuration.origin}/v1`)
  })

  it("rejects expired, changed, duplicate, or unbound callbacks", () => {
    const flow = createFlow(configuration)
    const query = new URLSearchParams({ state: flow.state, code: "code", iss: configuration.issuer })
    expect(callbackCode(configuration, flow, query)).toBe("code")
    expect(() => callbackCode(configuration, undefined, query)).toThrow()
    expect(() => callbackCode(configuration, { ...flow, expiresAt: 0 }, query)).toThrow()
    expect(() => callbackCode(configuration, { ...flow, clientId: "other" }, query)).toThrow()
    expect(() => callbackCode(configuration, { ...flow, productId: "other" }, query)).toThrow()
    expect(() => callbackCode(configuration, { ...flow, callbackUrl: "https://other.test" }, query)).toThrow()
    for (const change of ["state=wrong&code=code", `state=${flow.state}&code=code&code=other`,
      `state=${flow.state}&code=code&iss=https://other.test`, `state=${flow.state}&error=access_denied`]) {
      expect(() => callbackCode(configuration, flow, new URLSearchParams(change))).toThrow()
    }
  })

  it("uses the configured browser origin only for authorization while keeping canonical token verification", async () => {
    const split = { ...configuration, browserOrigin: "https://console.example.test" }
    const flow = createFlow(split)
    fetchMock.mockResolvedValueOnce(Response.json(discovery))
    const url = new URL(await authorizationUrl(split, flow))
    expect(url.origin).toBe(split.browserOrigin)
    expect(url.pathname).toBe(new URL(discovery.authorization_endpoint).pathname)
    expect(flow.issuer).toBe(configuration.issuer)
    mockExchange(await tokens(flow.nonce))
    await expect(exchangeCode(split, flow, "code")).resolves.toMatchObject({ subject: "hub-user-1" })
    expect(fetchMock.mock.calls[2][0]).toBe(discovery.token_endpoint)
    expect(fetchMock.mock.calls[3][0].origin).toBe(configuration.origin)
  })

  it("validates the signed ID token and current product identity", async () => {
    const flow = createFlow(configuration)
    mockExchange(await tokens(flow.nonce))
    await expect(exchangeCode(configuration, flow, "one-use-code")).resolves.toMatchObject({
      accessToken: "central-access-token", subject: "hub-user-1",
    })
    const [url, request] = fetchMock.mock.calls[1]
    expect(url).toBe(discovery.token_endpoint)
    expect(request.body.get("code_verifier")).toBe(flow.verifier)
    expect(request.body.get("code")).toBe("one-use-code")
    expect(request.headers.Authorization).toBe(`Basic ${Buffer.from("medusa-admin:example-client-secret").toString("base64")}`)
  })

  it("rejects a valid signature with the wrong nonce", async () => {
    const flow = createFlow(configuration)
    mockExchange(await tokens("other-attempt"))
    await expect(exchangeCode(configuration, flow, "code")).rejects.toThrow()
  })

  it("rejects an incorrect authorized party", async () => {
    const flow = createFlow(configuration)
    mockExchange(await tokens(flow.nonce, { azp: "other-client" }))
    await expect(exchangeCode(configuration, flow, "code")).rejects.toThrow()
  })

  it.each(["issuer", "audience", "signature", "expiry"])("rejects an invalid ID token %s", async (failure) => {
    const flow = createFlow(configuration)
    const signingKeys = failure === "signature" ? await generateKeyPair("RS256") : keys
    const token = await new SignJWT({ nonce: flow.nonce })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(failure === "issuer" ? "https://other.test" : configuration.issuer)
      .setAudience(failure === "audience" ? "other" : configuration.clientId)
      .setSubject("hub-user-1").setIssuedAt().setExpirationTime(failure === "expiry" ? 1 : "5m")
      .sign(signingKeys.privateKey)
    mockExchange({ ...await tokens(flow.nonce), id_token: token })
    await expect(exchangeCode(configuration, flow, "code")).rejects.toThrow()
  })

  it.each([
    { userId: "other-user", productId: configuration.productId },
    { userId: "hub-user-1", productId: "other-product" },
  ])("rejects a wrong current identity or product", async (identity) => {
    const flow = createFlow(configuration)
    mockExchange(await tokens(flow.nonce), identity)
    await expect(exchangeCode(configuration, flow, "code")).rejects.toThrow()
  })

  it("rejects discovery endpoint substitution", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...discovery, token_endpoint: "https://attacker.test/token" }))
    await expect(authorizationUrl(configuration, createFlow(configuration))).rejects.toThrow()
  })

  it("rejects a revoked central access token", async () => {
    const flow = createFlow(configuration)
    fetchMock.mockResolvedValueOnce(Response.json(discovery))
      .mockResolvedValueOnce(Response.json(await tokens(flow.nonce)))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
    await expect(exchangeCode(configuration, flow, "code")).rejects.toMatchObject({ status: 401 })
  })
})
