# Build-Kontext ist das Repo-Root: docker build -f apps/gateway/Dockerfile .
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @lastplan/gateway...
RUN pnpm --filter @lastplan/gateway build
# Nur Laufzeit-Abhängigkeiten (inkl. nativem better-sqlite3) in einen eigenen Ordner
RUN pnpm --filter @lastplan/gateway deploy --prod /out

FROM node:22-bookworm-slim
ENV NODE_ENV=production GATEWAY_DATA_DIR=/data
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/gateway/dist ./dist
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.GATEWAY_PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
