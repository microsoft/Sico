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

# Frontend container — serves pre-built static assets from frontend-dist.zip.
# The zip is produced by the private sico-frontend-old repo and committed to
# this directory (frontend/frontend-dist.zip), so the build context is just
# `frontend/` — no extra build contexts required.

FROM nginx:stable-alpine

# Install unzip to extract the pre-built frontend bundle.
RUN apk add --no-cache unzip

# Copy the SPA nginx config (same as the original frontend/nginx.conf).
COPY deployments/docker/nginx.conf /etc/nginx/conf.d/default.conf

# Drop the default placeholder content.
RUN rm -rf /usr/share/nginx/html/*

# Unzip pre-built frontend assets into the nginx document root.
COPY frontend-dist.zip /tmp/frontend-dist.zip
RUN mkdir -p /tmp/frontend-dist \
    && unzip -q /tmp/frontend-dist.zip -d /tmp/frontend-dist \
    && cp -a /tmp/frontend-dist/. /usr/share/nginx/html/ \
    && rm -rf /tmp/frontend-dist /tmp/frontend-dist.zip

EXPOSE 80

ENTRYPOINT ["nginx", "-g", "daemon off;"]
