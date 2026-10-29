import { createRequire } from "node:module"
import { createServer, Server } from "node:http"
import middlewareConfiguration from "../../../api/middlewares"

describe("Hub authentication HTTP routing", () => {
  let server: Server
  let origin: string

  beforeAll(async () => {
    // 使用框架自己的 Express，验证编码路径经过原生参数解析后仍会被拦截。
    const frameworkRequire = createRequire(require.resolve("@medusajs/framework/http"))
    const app = frameworkRequire("express")()
    const route = middlewareConfiguration.routes?.find((entry) => entry.matcher === "/auth/:actor_type/:auth_provider")
    if (!route?.methods || !route.middlewares) throw new Error("The Hub token middleware is not registered")
    for (const method of route.methods) {
      app[method.toLowerCase()](route.matcher, ...route.middlewares)
    }
    app.get("/auth/:actor_type/:auth_provider", (_req, res) => res.json({ reachedNativeProvider: true }))
    app.post("/auth/:actor_type/:auth_provider", (_req, res) => res.json({ reachedNativeProvider: true }))
    server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("The HTTP test server did not start")
    origin = `http://127.0.0.1:${address.port}`
  })
  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })

  it.each(["/auth/user/hub", "/auth/%75ser/%68ub", "/auth/user/hub/"])(
    "blocks direct raw-token login at %s", async (path) => {
      for (const method of ["GET", "POST"]) {
        const response = await fetch(`${origin}${path}`, { method })
        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({ message: "Start Hub sign-in from /identity/start" })
      }
    }
  )

  it("preserves the native customer provider route", async () => {
    const response = await fetch(`${origin}/auth/customer/emailpass`, { method: "POST" })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ reachedNativeProvider: true })
  })
})
