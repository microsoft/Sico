#! /usr/bin/env bash

set -e

# Create a non-root user
if ! getent group $USER >/dev/null; then
  groupadd --gid $USER_GID $USER
fi
if ! id -u $USER >/dev/null 2>&1; then
  useradd --uid $USER_UID --gid $USER --shell /bin/bash --create-home $USER
fi

# Add user to sudoers with NOPASSWD (only if we have permission)
if [ -w /etc/sudoers.d ]; then
  mkdir -p /etc/sudoers.d
  echo "$USER ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/$USER
  chmod 440 /etc/sudoers.d/$USER
else
  echo "Warning: Cannot modify sudoers (running in restricted environment)"
fi

mkdir -p /home/$USER/.npm-global/lib
chmod 755 /home/$USER/.npm-global
# bashrc - idempotent: copy template every time
cp -f /opt/gem/bashrc /home/$USER/.bashrc

# code-server
mkdir -p /home/$USER/.config/code-server /home/$USER/.local/share/code-server \
     && chmod -R 755 /home/$USER/.local/share/code-server/
cp -rf /opt/gem/vscode /home/$USER/.config/code-server/vscode

# matplotlib - idempotent
mkdir -p /home/$USER/.config/matplotlib
cp -f /opt/gem/matplotlibrc /home/$USER/.config/matplotlib/matplotlibrc

# Nginx - idempotent: regenerate configs and remove templates to avoid duplicates
DISABLE_CODE_SERVER=${DISABLE_CODE_SERVER:-false}
if [ -f "/opt/gem/nginx/nginx.python_srv.conf" ]; then
  envsubst '${MCP_HUB_PORT} ${SANDBOX_SRV_PORT}' <"/opt/gem/nginx/nginx.python_srv.conf" >"/opt/gem/nginx/python_srv.conf" && rm -f "/opt/gem/nginx/nginx.python_srv.conf"
fi
if [ -f "/opt/gem/nginx/nginx.mcp_hub.conf" ]; then
  envsubst '${MCP_HUB_PORT} ${SANDBOX_SRV_PORT}' <"/opt/gem/nginx/nginx.mcp_hub.conf" >"/opt/gem/nginx/mcp_hub.conf" && rm -f "/opt/gem/nginx/nginx.mcp_hub.conf"
fi
if [ -f "/opt/gem/nginx/nginx.code_server.conf" ]; then
  if [ "$DISABLE_CODE_SERVER" = "true" ]; then
    rm -f "/opt/gem/nginx/nginx.code_server.conf" "/opt/gem/nginx/code_server.conf"
  else
    envsubst '${CODE_SERVER_PORT}' <"/opt/gem/nginx/nginx.code_server.conf" >"/opt/gem/nginx/code_server.conf" && rm -f "/opt/gem/nginx/nginx.code_server.conf"
  fi
fi

# Supervisord - disable services if requested
if [ "$DISABLE_CODE_SERVER" = "true" ]; then
  rm -f /opt/gem/supervisord/supervisord.code_server.conf
fi

# in the end ensure the home directory is owned by the user
chown -R $USER:$USER /home/$USER

mkdir -p $LOG_DIR
touch $LOG_DIR/entrypoint.log

if [ -n "${APP_VERSION:-}" ]; then
  export IMAGE_VERSION="${APP_VERSION}"
elif [ -f /etc/linux_workstation_version ]; then
  export IMAGE_VERSION="$(cat /etc/linux_workstation_version)"
else
  export IMAGE_VERSION="local"
fi
export OTEL_SDK_DISABLED=true
export NGINX_LOG_LEVEL=${NGINX_LOG_LEVEL:-debug}
export NPM_CONFIG_PREFIX=/home/$USER/.npm-global
export PATH=$NPM_CONFIG_PREFIX/bin:$PATH
export HOMEPAGE=${HOMEPAGE:-""}
export BROWSER_NO_SANDBOX=${BROWSER_NO_SANDBOX:-"--no-sandbox"}
export BROWSER_EXTRA_ARGS="${BROWSER_NO_SANDBOX} --lang=en-US --time-zone-for-testing=${TZ} --window-position=0,0 --window-size=${DISPLAY_WIDTH},${DISPLAY_HEIGHT}  --homepage ${HOMEPAGE} ${BROWSER_EXTRA_ARGS}"
# Add user-agent if BROWSER_USER_AGENT is set
if [ -n "${BROWSER_USER_AGENT}" ]; then
  export BROWSER_EXTRA_ARGS=" --user-agent=\"${BROWSER_USER_AGENT}\" ${BROWSER_EXTRA_ARGS}"
fi

# Nginx proxy config - idempotent: always regenerate
envsubst '${PUBLIC_PORT}' <"/opt/gem/nginx-server-port-proxy.conf.template" >"/opt/gem/nginx-server-port-proxy.conf"

# 处理代理配置
PROXY_SERVER="$(echo -n "$PROXY_SERVER" | xargs)"
if [ -n "${PROXY_SERVER}" ]; then
  mkdir -p -m 755 /var/run/tinyproxy
  chown nobody /var/run/tinyproxy

  PROXY_SERVER=${PROXY_SERVER#\"}
  PROXY_SERVER=${PROXY_SERVER%\"}

  PROXY_SERVER=${PROXY_SERVER#http://}
  PROXY_SERVER=${PROXY_SERVER#https://}

  TINYPROXY_CONFIG_DIR="/opt/gem/tinyproxy"
  TINYPROXY_CONFIG="/etc/tinyproxy.conf"

  if [ -d "${TINYPROXY_CONFIG_DIR}" ]; then
    # base.conf exists check
    if [ ! -f "${TINYPROXY_CONFIG_DIR}/base.conf" ]; then
      echo "ERROR: ${TINYPROXY_CONFIG_DIR}/base.conf is required but not found!" >&2
      exit 1
    fi

    # clean up old config
    > "${TINYPROXY_CONFIG}"

    # load base.conf first (mandatory)
    echo "# === base.conf ===" >> "${TINYPROXY_CONFIG}"
    envsubst '${TINYPROXY_PORT}' < "${TINYPROXY_CONFIG_DIR}/base.conf" >> "${TINYPROXY_CONFIG}"
    echo "" >> "${TINYPROXY_CONFIG}"

    # If PROXY_SERVER is not "true" but an actual proxy address, add Upstream directive
    if [ "${PROXY_SERVER}" != "true" ]; then
      echo "# === Auto-generated Upstream ===" >> "${TINYPROXY_CONFIG}"
      echo "Upstream http ${PROXY_SERVER}" >> "${TINYPROXY_CONFIG}"
      echo "" >> "${TINYPROXY_CONFIG}"
    fi

    # load other .conf files recursively in alphabetical order (excluding base.conf)
    for conf_file in $(find "${TINYPROXY_CONFIG_DIR}" -type f -name "*.conf" 2>/dev/null | grep -vE "base.conf" | sort); do
      if [ -f "${conf_file}" ]; then
        # get relative path for better comment
        rel_path="${conf_file#${TINYPROXY_CONFIG_DIR}/}"
        # add separator comment with relative path
        echo "# === ${rel_path} ===" >> "${TINYPROXY_CONFIG}"
        # Replace `${PROXY_SERVER}` and append to the configuration file.
        envsubst '${PROXY_SERVER}' < "${conf_file}" >> "${TINYPROXY_CONFIG}"
        echo "" >> "${TINYPROXY_CONFIG}"  # add empty line separator
      fi
    done

    echo "Tinyproxy configuration assembled from ${TINYPROXY_CONFIG_DIR}"
  else
    echo "ERROR: Tinyproxy config directory ${TINYPROXY_CONFIG_DIR} not found!" >&2
    exit 1
  fi

  export BROWSER_EXTRA_ARGS="${BROWSER_EXTRA_ARGS} --proxy-server=http://127.0.0.1:${TINYPROXY_PORT} --proxy-bypass-list=\"localhost,127.0.0.1,*.byted.org,*.bytedance.net,*.baidu.com,baidu.com\""
else
  rm -f /opt/gem/supervisord/supervisord.tinyproxy.conf
fi

# Display startup banner
print_banner() {
  echo ""
  echo -e "\033[36m █████╗ ██╗ ██████╗     ███████╗ █████╗ ███╗   ██╗██████╗ ██████╗  ██████╗ ██╗  ██╗\033[0m"
  echo -e "\033[36m██╔══██╗██║██╔═══██╗    ██╔════╝██╔══██╗████╗  ██║██╔══██╗██╔══██╗██╔═══██╗╚██╗██╔╝\033[0m"
  echo -e "\033[36m███████║██║██║   ██║    ███████╗███████║██╔██╗ ██║██║  ██║██████╔╝██║   ██║ ╚███╔╝\033[0m"
  echo -e "\033[36m██╔══██║██║██║   ██║    ╚════██║██╔══██║██║╚██╗██║██║  ██║██╔══██╗██║   ██║ ██╔██╗\033[0m"
  echo -e "\033[36m██║  ██║██║╚██████╔╝    ███████║██║  ██║██║ ╚████║██████╔╝██████╔╝╚██████╔╝██╔╝ ██╗\033[0m"
  echo -e "\033[36m╚═╝  ╚═╝╚═╝ ╚═════╝     ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝\033[0m"
  echo ""
  echo -e "\033[32m🚀 Linux Workstation Sandbox Environment\033[0m"
  if [ -n "${IMAGE_VERSION}" ]; then
    echo -e "\033[34m📦 Image Version: ${IMAGE_VERSION}\033[0m"
  fi
  echo -e "\033[33m🌈 Dashboard: http://localhost:${PUBLIC_PORT}\033[0m"
  echo -e "\033[33m📚 Documentation: http://localhost:${PUBLIC_PORT}/v1/docs\033[0m"
  echo ""
  echo -e "\033[35m================================================================\033[0m"
}

print_banner

# 启动 supervisord
exec /opt/gem/entrypoint.sh
