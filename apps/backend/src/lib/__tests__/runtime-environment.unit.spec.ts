import { runtimeEnvironmentSchema } from "../runtime-environment"

const environment = {
  DATABASE_URL: "postgresql://medusa:example@localhost:5432/medusa",
  REDIS_URL: "redis://localhost:6379",
  MEDUSA_PUBLIC_URL: "https://commerce.example.test",
  JWT_SECRET: "a".repeat(32),
  COOKIE_SECRET: "b".repeat(32),
}

describe("runtime environment", () => {
  it("accepts the independent backend without a storefront or payment key", () => {
    const result = runtimeEnvironmentSchema.parse(environment)
    expect(result.STORE_CORS).toBe("")
    expect(result.DATABASE_URL).toBe(environment.DATABASE_URL)
  })

  it.each(["DATABASE_URL", "REDIS_URL", "MEDUSA_PUBLIC_URL"])(
    "rejects an invalid %s",
    (key) => {
      expect(
        runtimeEnvironmentSchema.safeParse({ ...environment, [key]: "invalid" })
          .success
      ).toBe(false)
    }
  )

  it.each(["JWT_SECRET", "COOKIE_SECRET"])(
    "rejects a missing or weak %s",
    (key) => {
      for (const value of [undefined, "supersecret"]) {
        expect(
          runtimeEnvironmentSchema.safeParse({ ...environment, [key]: value })
            .success
        ).toBe(false)
      }
    }
  )
})
