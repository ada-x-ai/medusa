import { authenticate, configureStoreSearch, defineMiddlewares } from "@medusajs/framework/http"
import { rejectHubTokenLogin, requireHubOperator } from "../lib/identity/session"

// 商品索引按发布状态和当前密钥允许的销售渠道过滤。
export default defineMiddlewares({
  routes: [
    {
      matcher: "/auth/:actor_type/:auth_provider",
      method: ["GET", "POST"],
      middlewares: [rejectHubTokenLogin],
    },
    {
      matcher: "/admin/*",
      middlewares: [
        authenticate("user", ["session", "bearer", "api-key"]),
        requireHubOperator,
      ],
    },
    {
      method: ['POST'],
      matcher: '/store/search',
      middlewares: [
        configureStoreSearch({
          allowed_indexes: {
            product: true,
          },
        }),
      ],
    },
  ],
})
