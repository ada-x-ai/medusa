FROM node:24.22.1-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@10.11.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/backend/package.json ./apps/backend/package.json
RUN pnpm install --frozen-lockfile --filter @dtc/backend...
COPY apps/backend ./apps/backend
COPY eslint.config.ts ./
ENV MEDUSA_DISABLE_TELEMETRY=true
# 构建只校验配置形状，不连接数据库，也不使用部署密钥。
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:1/build REDIS_URL=redis://127.0.0.1:1 MEDUSA_PUBLIC_URL=https://build.example.invalid JWT_SECRET=build-only-secret-with-at-least-32-characters COOKIE_SECRET=another-build-only-secret-with-32-characters pnpm --filter @dtc/backend build
COPY deploy/container-entrypoint.sh /usr/local/bin/medusa-entrypoint
RUN chmod 755 /usr/local/bin/medusa-entrypoint
WORKDIR /app/apps/backend/.medusa/server
RUN chown node:node /app/apps/backend/.medusa/server
ENV PATH="/app/apps/backend/node_modules/.bin:${PATH}"
ENV NODE_ENV=production
ENV PORT=9000
EXPOSE 9000
ENTRYPOINT ["/usr/local/bin/medusa-entrypoint"]
CMD ["pnpm", "exec", "medusa", "start"]
