# syntax=docker/dockerfile:1.7
ARG BASE_IMAGE=sico/linux-workstation-sandbox-base:local
FROM ${BASE_IMAGE}
LABEL org.opencontainers.image.licenses="MIT"

# Copy runtime configs and application assets
COPY deployments/docker/linux-workstation/rootfs /
COPY opt/gem /opt/gem
COPY opt/linux-workstation /opt/linux-workstation
COPY opt/terminal /opt/terminal
COPY linux-workstation-server /opt/linux-workstation-server

# Align wrapper paths with the copied app assets
RUN ln -sf /usr/local/bin/python-server /opt/python3.12/bin/python-server

# noVNC path (only symlink if not provided in base image)
RUN if [ ! -e /opt/novnc ]; then ln -sf /usr/share/novnc /opt/novnc; fi

# Ensure runtime scripts are executable
RUN chmod +x /opt/gem/*.sh /opt/gem/xdg-settings /usr/local/bin/* /usr/bin/mcp-server-browser /usr/bin/chrome-devtools-mcp /opt/gem/mcp-hub-wait.sh /opt/gem/tinyproxy.sh || true

# Runtime symlinks
RUN ln -sf /opt/gem/supervisord.conf /etc/supervisor/supervisord.conf \
  && ln -sf /dev/stdout /var/log/nginx/access.log \
  && ln -sf /dev/stderr /var/log/nginx/error.log \
  && ln -sf /usr/bin/tinyproxy /usr/local/bin/tinyproxy \
  && ln -sf /opt/gem/xdg-settings /usr/local/bin/xdg-settings

ENTRYPOINT ["/opt/gem/run.sh"]
