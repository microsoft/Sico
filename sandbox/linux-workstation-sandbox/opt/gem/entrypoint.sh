#!/bin/bash
set -e

log() {
	echo "$(date '+%Y-%m-%d %H:%M:%S,%3N') INFO $@"
}

log "Starting entrypoint script..."

# Create a non-root user
log "Creating user ('$USER') with UID ($USER_UID) and GID ($USER_GID)..."
if ! getent group $USER >/dev/null; then
	groupadd --gid $USER_GID $USER
fi
if ! id -u $USER >/dev/null 2>&1; then
	useradd --uid $USER_UID --gid $USER_GID --shell /bin/bash --create-home $USER
fi

# Workaround for an X11 problem: http://blog.tigerteufel.de/?p=476
log "Setting up X11 permissions..."
mkdir -p /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix
chown $USER /tmp/.X11-unix/

# Make directories
log "Creating necessary directories..."
mkdir -p "$LOG_DIR" "$XDG_RUNTIME_DIR"
chmod 1777 "$LOG_DIR"
chown $USER "$LOG_DIR" "$XDG_RUNTIME_DIR"

# noVNC path (only symlink if not provided in rootfs)
if [ ! -e /opt/novnc ] && [ -d /usr/share/novnc ]; then
	ln -sf /usr/share/novnc /opt/novnc
fi

# Ensure noVNC entry exists for /vnc/index.html
if [ -d /opt/novnc ] && [ ! -f /opt/novnc/index.html ] && [ -f /opt/novnc/vnc.html ]; then
	ln -sf /opt/novnc/vnc.html /opt/novnc/index.html
fi

log "Setting up Nginx directories..."
mkdir -p /var/lib/nginx
chmod 1777 /var/lib/nginx
chown nobody /var/lib/nginx

# Copy the browser preferences file to the user's config directory
log "Copying the browser preferences file to user's config directory..."
su $USER -c '
	touch "$HOME/.Xauthority" && \
	mkdir -p "$HOME/.config/browser/Default" && \
	cp "/opt/gem/preferences.json" "$HOME/.config/browser/Default/Preferences"
'

# Create DNS over HTTPS configuration file if environment variable is set and not empty (after trim)
TRIMMED_DOH_TEMPLATES="$(echo -n "$DNS_OVER_HTTPS_TEMPLATES" | xargs)"

if [ -n "$TRIMMED_DOH_TEMPLATES" ]; then
	log "DNS_OVER_HTTPS_TEMPLATES is set. Creating DNS over HTTPS configuration with templates: $TRIMMED_DOH_TEMPLATES..."
	# Create the JSON configuration file
	cat >/etc/browser/policies/managed/dns_over_https.json <<EOF
{
	"DnsOverHttpsMode": "secure",
	"DnsOverHttpsTemplates": "$TRIMMED_DOH_TEMPLATES"
}
EOF

else
	log "DNS_OVER_HTTPS_TEMPLATES is not set or empty. Skipping DNS over HTTPS configuration..."
fi

# Define Nginx configuration file paths
AUTH_CONFIG="/opt/gem/nginx-server-with-auth.conf"
NO_AUTH_CONFIG="/opt/gem/nginx-server-without-auth.conf"
ACTIVE_CONFIG="/opt/gem/nginx-server-active.conf"

# Trim whitespace from JWT_PUBLIC_KEY to handle cases where it might be set to just spaces
TRIMMED_JWT_PUBLIC_KEY="$(echo -n "$JWT_PUBLIC_KEY" | xargs)"

# Check if JWT_PUBLIC_KEY is provided to decide which Nginx config to activate
if [ -n "$TRIMMED_JWT_PUBLIC_KEY" ]; then
	log "JWT_PUBLIC_KEY is set. Activating authentication server configuration..."
	: "${AUTH_BACKEND_PORT:=8081}"
	envsubst '${PUBLIC_PORT} ${AUTH_BACKEND_PORT} ${GEM_SERVER_PORT}' <"$AUTH_CONFIG" >"$ACTIVE_CONFIG"
else
	log "JWT_PUBLIC_KEY is not set or is empty. Activating direct routing server configuration..."
	envsubst '${PUBLIC_PORT}' <"$NO_AUTH_CONFIG" >"$ACTIVE_CONFIG"
fi

log "Generating other Nginx config files..."
envsubst '${BROWSER_REMOTE_DEBUGGING_PORT}' <"/opt/gem/nginx.cdp.conf" >"/opt/gem/nginx/cdp.conf"
envsubst '${GEM_SERVER_PORT}' <"/opt/gem/nginx.srv.conf" >"/opt/gem/nginx/srv.conf"
envsubst '${WEBSOCKET_PROXY_PORT}' <"/opt/gem/nginx.vnc.conf" >"/opt/gem/nginx/vnc.conf"

if [ ! -f /opt/gem/mcp.disabled ]; then
	log "/opt/gem/mcp.disabled not found. Configuring MCP server..."
	cp /opt/gem/supervisord.mcp.conf /opt/gem/supervisord/mcp.conf
	envsubst '${MCP_SERVER_PORT}' <"/opt/gem/nginx.mcp.conf" >"/opt/gem/nginx/mcp.conf"
else
	log "/opt/gem/mcp.disabled found. Skipping MCP server configuration..."
fi

log "Starting supervisord as the main process..."

# Replace the current shell process with supervisord.
# supervisord will run in the foreground (-n option).
# Docker will directly manage supervisord's lifecycle.
# Any signals (like SIGTERM from `docker stop`) will go directly to supervisord.
exec /usr/bin/supervisord -n -c /opt/gem/supervisord.conf
