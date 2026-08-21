# Frontend container — builds the React/Vite SPA from source (this monorepo) and
# serves the static output with nginx. Build context is `frontend/`, so all COPY
# paths below are relative to the frontend workspace root.

# ---- Stage 1: build the SPA from source ---------------------------------------
FROM node:24.13.0-slim AS build
ARG NPM_REGISTRY

# Disable lefthook's git-hook install (no .git in the build context).
ENV LEFTHOOK=0

WORKDIR /app

# 1) Copy only what dependency resolution needs, so the (slow) install layer is
#    cached until the lockfile or a package manifest changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/app/package.json    packages/app/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json     packages/ui/package.json
COPY packages/config/package.json packages/config/package.json

# Bootstrap the package.json-pinned pnpm version through the registry configured
# in .npmrc. Corepack otherwise downloads pnpm directly from registry.npmjs.org.
ENV NPM_CONFIG_USERCONFIG=/app/.npmrc
RUN test -n "${NPM_REGISTRY}" \
	&& npm install --global pnpm@10.12.1

# Deterministic install from the committed lockfile.
RUN pnpm install --frozen-lockfile

# 2) Copy the rest of the workspace and build. node_modules and dist are excluded
#    via .dockerignore, so the install layer above is preserved.
COPY . .
RUN pnpm build

# ---- Stage 2: serve the built assets with nginx -------------------------------
FROM nginx:stable-alpine
LABEL org.opencontainers.image.licenses="MIT"

# SPA nginx config (try_files fallback to /index.html for client-side routes).
COPY deployments/docker/nginx.conf /etc/nginx/conf.d/default.conf

# Replace the default placeholder site with the built SPA.
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/packages/app/dist/ /usr/share/nginx/html/

EXPOSE 80

ENTRYPOINT ["nginx", "-g", "daemon off;"]
