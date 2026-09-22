#!/usr/bin/env bash
#
# Instalación inicial del agente SRI en un VPS. Se corre UNA vez, como root.
# Para actualizaciones posteriores usá deploy.sh.
#
#   sudo bash deploy/provision.sh <url-del-repo>

set -euo pipefail

USUARIO="${SRI_SERVICE_USER:-sri}"
DESTINO="${SRI_APP_DIR:-/srv/sri-agent}"
DIR_ENV="${SRI_ENV_DIR:-/etc/sri-agent}"
REPO="${1:-}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
aviso() { printf '\033[1;33m!!\033[0m  %s\n' "$*"; }
error() { printf '\033[1;31mxx\033[0m  %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || error "Corré este script como root (sudo)."
[ -n "$REPO" ] || error "Uso: sudo bash deploy/provision.sh <url-del-repo>"

# ── Requisitos ──────────────────────────────────────────────────────────────
command -v git >/dev/null || error "Falta git."
command -v node >/dev/null || error "Falta Node.js 24.x."

VERSION_NODE="$(node -p 'process.versions.node.split(".")[0]')"
[ "$VERSION_NODE" -ge 24 ] || error "Node $VERSION_NODE detectado; hace falta 24.x."

if ! command -v docker >/dev/null; then
  error "Falta Docker. El sandbox donde corre Chromium lo necesita."
fi
docker info >/dev/null 2>&1 || error "El daemon de Docker no responde."

LIBRE_KB="$(df -Pk / | awk 'NR==2 {print $4}')"
[ "$LIBRE_KB" -gt 3145728 ] || aviso "Menos de 3 GB libres: la imagen base más Chromium pueden no entrar."

# ── Backend de sandbox ──────────────────────────────────────────────────────
if [ -e /dev/kvm ]; then
  BACKEND_SUGERIDO="microsandbox"
  info "Hay /dev/kvm: podés usar microsandbox y restringir el egress a *.sri.gob.ec."
else
  BACKEND_SUGERIDO="docker"
  aviso "No hay /dev/kvm. Con el backend docker el navegador NO tiene restricción"
  aviso "de egress: puede alcanzar cualquier host. Ver DESPLIEGUE.md."
fi

# ── Usuario y directorios ───────────────────────────────────────────────────
if ! id -u "$USUARIO" >/dev/null 2>&1; then
  info "Creando usuario de servicio '$USUARIO'."
  useradd --system --home "$DESTINO" --shell /usr/sbin/nologin "$USUARIO"
fi
usermod -aG docker "$USUARIO"

install -d -o "$USUARIO" -g "$USUARIO" -m 750 "$DESTINO"
install -d -o root -g "$USUARIO" -m 750 "$DIR_ENV"

# ── Código ──────────────────────────────────────────────────────────────────
if [ -d "$DESTINO/.git" ]; then
  info "Ya hay un checkout en $DESTINO; no se toca."
else
  info "Clonando el repositorio."
  sudo -u "$USUARIO" git clone "$REPO" "$DESTINO"
fi

# ── Entorno ─────────────────────────────────────────────────────────────────
if [ ! -f "$DIR_ENV/env" ]; then
  info "Creando $DIR_ENV/env desde la plantilla."
  install -o root -g "$USUARIO" -m 640 \
    "$DESTINO/.env.production.example" "$DIR_ENV/env"
  sed -i "s|^SRI_SANDBOX_BACKEND=.*|SRI_SANDBOX_BACKEND=$BACKEND_SUGERIDO|" "$DIR_ENV/env"
  aviso "Completá $DIR_ENV/env antes de arrancar el servicio."
fi

# ── Servicio ────────────────────────────────────────────────────────────────
info "Instalando la unidad de systemd."
install -m 644 "$DESTINO/deploy/sri-agent.service" /etc/systemd/system/sri-agent.service
systemctl daemon-reload
systemctl enable sri-agent

cat <<FIN

Instalación base lista.

Siguiente:
  1. sudo -e $DIR_ENV/env      # AI_GATEWAY_API_KEY, SRI_AGENTE_*, SRI_CRED_<RUC>
  2. sudo bash $DESTINO/deploy/deploy.sh
  3. configurar el reverse proxy con deploy/Caddyfile

El proxy tiene que reenviar /eve/ Y /.well-known/workflow/ sin reescribir rutas.
FIN
