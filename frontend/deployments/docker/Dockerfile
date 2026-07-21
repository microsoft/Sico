# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

# Frontend container — builds the React/Vite SPA from source (this monorepo) and
# serves the static output with nginx. Build context is `frontend/`, so all COPY
# paths below are relative to the frontend workspace root.

# ---- Stage 1: build the SPA from source ---------------------------------------
FROM node:24.13.0-slim AS build

# Corepack ships with Node 24 and activates the pnpm version pinned by the root
# package.json ("packageManager": "pnpm@10.12.1"). Disable the download prompt so
# the build is non-interactive; disable lefthook's git-hook install (no .git in
# the build context) so `pnpm install` stays hermetic.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    LEFTHOOK=0
RUN corepack enable

WORKDIR /app

# 1) Copy only what dependency resolution needs, so the (slow) install layer is
#    cached until the lockfile or a package manifest changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/app/package.json    packages/app/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json     packages/ui/package.json
COPY packages/config/package.json packages/config/package.json

# Deterministic install from the committed lockfile.
RUN pnpm install --frozen-lockfile

# 2) Copy the rest of the workspace and build. node_modules and dist are excluded
#    via .dockerignore, so the install layer above is preserved.
COPY . .
RUN pnpm build

# ---- Stage 2: serve the built assets with nginx -------------------------------
FROM nginx:stable-alpine

# SPA nginx config (try_files fallback to /index.html for client-side routes).
COPY deployments/docker/nginx.conf /etc/nginx/conf.d/default.conf

# Replace the default placeholder site with the built SPA.
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/packages/app/dist/ /usr/share/nginx/html/

EXPOSE 80

ENTRYPOINT ["nginx", "-g", "daemon off;"]
