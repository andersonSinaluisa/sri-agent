#!/usr/bin/env bash
#
# Actualiza y reinicia el agente SRI en el VPS. Como root:
#
#   sudo bash deploy/deploy.sh              # pull + build + restart
#   sudo bash deploy/deploy.sh --skip-pull  # solo rebuild del código actual
#   sudo bash deploy/deploy.sh --rollback   # vuelve al build anterior
#
# Nunca toca .eve/: ahí vive el estado durable de las sesiones, incluidas las
# declaraciones parqueadas esperando aprobación humana.

set -euo pipefail

USUARIO="${SRI_SERVICE_USER:-sri}"
DESTINO="${SRI_APP_DIR:-/srv/sri-agent}"
ARCHIVO_ENV="${SRI_ENV_FILE:-/etc/sri-agent/env}"
SERVICIO="sri-agent"
PUERTO="${SRI_PORT:-3000}"
INTENTOS_SALUD="${SRI_HEALTH_RETRIES:-30}"

SALIDA="$DESTINO/.output"
PREVIA="$DESTINO/.output.anterior"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
aviso() { printf '\033[1;33m!!\033[0m  %s\n' "$*"; }
error() { printf '\033[1;31mxx\033[0m  %s\n' "$*" >&2; exit 1; }

SKIP_PULL=0
ROLLBACK=0
for arg in "$@"; do
  case "$arg" in
    --skip-pull) SKIP_PULL=1 ;;
    --rollback) ROLLBACK=1 ;;
    *) error "Argumento desconocido: $arg" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || error "Corré este script como root (sudo)."
[ -d "$DESTINO/.git" ] || error "No hay un checkout en $DESTINO. Corré provision.sh primero."

como_servicio() { sudo -u "$USUARIO" --preserve-env=HOME "$@"; }

esperar_salud() {
  local intento=1
  while [ "$intento" -le "$INTENTOS_SALUD" ]; do
    if curl -fsS --max-time 3 "http://127.0.0.1:$PUERTO/eve/v1/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    intento=$((intento + 1))
  done
  return 1
}

restaurar_anterior() {
  if [ -d "$PREVIA" ]; then
    aviso "Restaurando el build anterior."
    rm -rf "$SALIDA"
    mv "$PREVIA" "$SALIDA"
    systemctl restart "$SERVICIO"
    if esperar_salud; then
      aviso "El servicio volvió al build anterior y responde."
    else
      error "El rollback tampoco levanta. Revisá: journalctl -u $SERVICIO -n 100"
    fi
  else
    error "No hay build anterior para restaurar."
  fi
}

# ── Rollback explícito ──────────────────────────────────────────────────────
if [ "$ROLLBACK" -eq 1 ]; then
  info "Rollback solicitado."
  restaurar_anterior
  exit 0
fi

# ── Preflight ───────────────────────────────────────────────────────────────
info "Comprobando requisitos."

[ -f "$ARCHIVO_ENV" ] || error "Falta $ARCHIVO_ENV."
docker info >/dev/null 2>&1 || error "El daemon de Docker no responde."

# Se comprueba que las variables estén definidas, sin imprimir sus valores.
faltantes=""
for clave in AI_GATEWAY_API_KEY SRI_AGENTE_USUARIO SRI_AGENTE_CLAVE; do
  valor="$(set -a; . "$ARCHIVO_ENV" >/dev/null 2>&1; set +a; eval "printf '%s' \"\${$clave:-}\"")"
  [ -n "$valor" ] || faltantes="$faltantes $clave"
done
if [ -n "$faltantes" ]; then
  error "Sin valor en $ARCHIVO_ENV:$faltantes"
fi

if ! (set -a; . "$ARCHIVO_ENV" >/dev/null 2>&1; set +a; env | grep -q '^SRI_CRED_'); then
  aviso "No hay ninguna credencial SRI_CRED_<RUC>: el agente no podrá entrar al portal."
fi

# ── Código ──────────────────────────────────────────────────────────────────
cd "$DESTINO"
COMMIT_PREVIO="$(como_servicio git rev-parse --short HEAD)"

if [ "$SKIP_PULL" -eq 0 ]; then
  info "Actualizando el código."
  como_servicio git pull --ff-only
fi
COMMIT_NUEVO="$(como_servicio git rev-parse --short HEAD)"
info "Commit: $COMMIT_PREVIO -> $COMMIT_NUEVO"

# ── Build ───────────────────────────────────────────────────────────────────
info "Instalando dependencias."
como_servicio npm ci --no-audit --no-fund

info "Verificando tipos."
como_servicio npx tsc || error "El typecheck falló; no se despliega."

info "Guardando el build anterior para poder volver."
rm -rf "$PREVIA"
[ -d "$SALIDA" ] && cp -a "$SALIDA" "$PREVIA"

info "Compilando."
if ! como_servicio npm run build; then
  aviso "El build falló."
  restaurar_anterior
  exit 1
fi

# ── Reinicio y verificación ─────────────────────────────────────────────────
info "Reiniciando $SERVICIO."
systemctl restart "$SERVICIO"

if esperar_salud; then
  info "Desplegado: $COMMIT_NUEVO responde en /eve/v1/health."
  aviso "La primera sesión construye el template del sandbox (Playwright + Chromium,"
  aviso "~400 MB) y tarda varios minutos. Las siguientes lo reutilizan."
else
  aviso "El servicio no respondió tras $((INTENTOS_SALUD * 2))s."
  journalctl -u "$SERVICIO" -n 40 --no-pager || true
  restaurar_anterior
  exit 1
fi
