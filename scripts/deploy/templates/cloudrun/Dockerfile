# Modelo de Dockerfile para o host Cloud Run (copiado pelo projeto derivado).
# Requer `output: 'standalone'` no next.config do projeto, pois a imagem usa .next/standalone.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
# --ignore-scripts: o `prepare` da raiz (hooks de git) precisa de scripts/, que ainda não foi copiado aqui.
RUN npm ci --ignore-scripts

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# O build roda sem envs. Se o app valida env no build (ex.: Zod no next.config), declare `ARG NOME`
# e `ENV NOME=$NOME` antes do build e passe `--build-arg` no `docker build` (ver host-cloudrun.md).
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# O server.js do standalone escuta em process.env.HOSTNAME; sem 0.0.0.0 o Cloud Run não alcança o health check.
ENV HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
# --chown: o usuário não root precisa escrever em .next/cache.
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 8080
CMD ["node", "server.js"]
