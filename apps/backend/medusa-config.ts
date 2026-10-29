import { defineConfig, loadEnv } from "@medusajs/framework/utils"
import { runtimeEnvironmentSchema } from "./src/lib/runtime-environment"
import { identityConfiguration } from "./src/lib/identity/configuration"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

const environment = runtimeEnvironmentSchema.parse(process.env)
const publicUrl = new URL(environment.MEDUSA_PUBLIC_URL)
const identity = identityConfiguration()

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: environment.DATABASE_URL,
    redisUrl: environment.REDIS_URL,
    // 开发实例使用单个进程，同时处理接口和后台任务。
    workerMode: "shared",
    http: {
      storeCors: environment.STORE_CORS,
      adminCors: publicUrl.origin,
      authCors: publicUrl.origin,
      jwtSecret: environment.JWT_SECRET,
      cookieSecret: environment.COOKIE_SECRET,
      ...(identity ? {
        authMethodsPerActor: { user: ["hub"], customer: ["emailpass"] },
        requireActorAssociation: { hub: true },
      } : {}),
    },
  },
  modules: [
    ...(identity ? [{
      resolve: "@medusajs/medusa/auth",
      options: {
        providers: [
          { resolve: "@medusajs/medusa/auth-emailpass", id: "emailpass" },
          { resolve: "./src/modules/hub-auth", id: "hub", options: identity },
        ],
      },
    }] : []),
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: { redisUrl: environment.REDIS_URL },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: { redis: { redisUrl: environment.REDIS_URL } },
    },
    {
      resolve: "@medusajs/medusa/locking",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/locking-redis",
            id: "locking-redis",
            is_default: true,
            options: { redisUrl: environment.REDIS_URL },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/file-local",
            id: "local",
            // 此目录由独立开发实例的持久卷保存；正式商城应改用对象存储。
            options: { backend_url: new URL("/static", publicUrl).href },
          },
        ],
      },
    },
  ],
})
