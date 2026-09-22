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
# La primera vez el arranque baja la imagen del sandbox (~2 GB): 60s no alcanza.
INTENTOS_SALUD="${SRI_HEALTH_RETRIES:-150}"

SALIDA="$DESTINO/.output"
PREVIA="$DESTINO/.output.anterior"
FALLIDO="$DESTINO/.output.fallido"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
aviso() { printf '\033[1;33m!!\033[0m  %s\n' "$*"; }
error() { printf '\033[1;31mxx\033[0m  %s\n' "$*" >&2; exit 1; }

# Sin esto, un comando que falle bajo `set -e` mata el script sin imprimir
# nada y te deja adivinando dónde se cortó.
al_fallar() {
  local codigo=$?
  error "Falló en la línea $1 (código $codigo)."
}
trap 'al_fallar $LINENO' ERR

SKIP_PULL=0
ROLLBACK=0
SIN_ROLLBACK=0
for arg in "$@"; do
  case "$arg" in
    --skip-pull) SKIP_PULL=1 ;;
    --rollback) ROLLBACK=1 ;;
    --no-rollback) SIN_ROLLBACK=1 ;;
    *) error "Argumento desconocido: $arg" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || error "Corré este script como root (sudo)."
[ -d "$DESTINO/.git" ] || error "No hay un checkout en $DESTINO. Corré provision.sh primero."

# -H fija HOME al home del usuario de servicio. Sin esto, npm usa la caché de
# root (/root/.npm), a la que "$USUARIO" no tiene acceso, y falla con EACCES.
como_servicio() { sudo -u "$USUARIO" -H "$@"; }

# 0 = responde | 1 = agotó el tiempo, seguía arrancando | 2 = el servicio murió
esperar_salud() {
  local intento=1 estado
  while [ "$intento" -le "$INTENTOS_SALUD" ]; do
    if curl -fsS --max-time 3 "http://127.0.0.1:$PUERTO/eve/v1/health" >/dev/null 2>&1; then
      return 0
    fi
    estado="$(systemctl is-active "$SERVICIO" 2>/dev/null || true)"
    if [ "$estado" = "failed" ] || [ "$estado" = "inactive" ]; then
      return 2
    fi
    # Cada 30s se avisa que sigue vivo: el template del sandbox puede tardar.
    if [ $((intento % 15)) -eq 0 ]; then
      info "Sigue arrancando ($((intento * 2))s)... el template del sandbox tarda la primera vez."
    fi
    sleep 2
    intento=$((intento + 1))
  done
  return 1
}

restaurar_anterior() {
  if [ -d "$PREVIA" ]; then
    aviso "Restaurando el build anterior."
    # El build que falló se conserva: sin él no hay nada que investigar.
    rm -rf "$FALLIDO"
    [ -d "$SALIDA" ] && mv "$SALIDA" "$FALLIDO"
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

# sudo resetea el PATH a `secure_path`, así que node/npm/npx se invocan por
# ruta absoluta. Resolverlos acá también detecta una instalación que el
# usuario de servicio no puede usar.
# Se prefiere una instalación de sistema: es la única que el usuario de
# servicio puede ejecutar. El PATH de root suele anteponer un nvm, así que
# `command -v` solo se usa como último recurso.
resolver_bin() {
  local nombre="$1" dir
  for dir in /usr/bin /usr/local/bin; do
    [ -x "$dir/$nombre" ] && { printf '%s' "$dir/$nombre"; return 0; }
  done
  command -v "$nombre" || true
}

NODE_BIN="$(resolver_bin node)"
NPM_BIN="$(resolver_bin npm)"
NPX_BIN="$(resolver_bin npx)"
if [ -z "$NODE_BIN" ] || [ -z "$NPM_BIN" ] || [ -z "$NPX_BIN" ]; then
  error "No encuentro node, npm o npx en el PATH de root."
fi

if ! sudo -u "$USUARIO" "$NODE_BIN" -v >/dev/null 2>&1; then
  error "El usuario '$USUARIO' no puede ejecutar $NODE_BIN.
    Pasa cuando Node se instaló con nvm dentro de /root: el usuario de
    servicio no tiene acceso a ese directorio. Instalalo a nivel de sistema:

      curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
      apt-get install -y nodejs"
fi

# El archivo se LEE, no se sourcea. systemd lo parsea con su propio formato,
# que admite valores con espacios y símbolos; pasarlos por el shell podía
# abortar el script en silencio y, peor, ejecutar lo que hubiera adentro.
valor_de() {
  local linea v
  linea="$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1=" "$ARCHIVO_ENV" | tail -n 1 || true)"
  [ -n "$linea" ] || return 0
  v="${linea#*=}"
  v="${v%\"}"; v="${v#\"}"
  v="${v%'}"; v="${v#'}"
  printf '%s' "$v"
}

faltantes=""
for clave in AI_GATEWAY_API_KEY SRI_AGENTE_USUARIO SRI_AGENTE_CLAVE; do
  [ -n "$(valor_de "$clave")" ] || faltantes="$faltantes $clave"
done
if [ -n "$faltantes" ]; then
  error "Sin valor en $ARCHIVO_ENV:$faltantes"
fi

if ! grep -qE '^[[:space:]]*(export[[:space:]]+)?SRI_CRED_[0-9]{13}=.+' "$ARCHIVO_ENV"; then
  aviso "No hay ninguna credencial SRI_CRED_<RUC>: el agente no podrá entrar al portal."
fi

# ── Código ──────────────────────────────────────────────────────────────────
cd "$DESTINO"
# Cualquier cosa que se haya corrido como root antes deja archivos que el
# usuario de servicio no puede sobrescribir.
info "Normalizando la propiedad de $DESTINO."
chown -R "$USUARIO":"$USUARIO" "$DESTINO"

COMMIT_PREVIO="$(como_servicio git rev-parse --short HEAD)"

if [ "$SKIP_PULL" -eq 0 ]; then
  info "Actualizando el código."
  como_servicio git pull --ff-only
fi
COMMIT_NUEVO="$(como_servicio git rev-parse --short HEAD)"
info "Commit: $COMMIT_PREVIO -> $COMMIT_NUEVO"

# ── Build ───────────────────────────────────────────────────────────────────
info "Instalando dependencias."
como_servicio "$NPM_BIN" ci --no-audit --no-fund

info "Verificando tipos."
como_servicio "$NPX_BIN" tsc || error "El typecheck falló; no se despliega."

info "Guardando el build anterior para poder volver."
rm -rf "$PREVIA"
[ -d "$SALIDA" ] && cp -a "$SALIDA" "$PREVIA"

info "Compilando la UI."
if ! como_servicio "$NPM_BIN" run web:build; then
  aviso "El build de la UI fallo."
  restaurar_anterior
  exit 1
fi

info "Compilando el agente."
if ! como_servicio "$NPM_BIN" run build; then
  aviso "El build falló."
  restaurar_anterior
  exit 1
fi

# ── Reinicio y verificación ─────────────────────────────────────────────────
# Bajar la imagen acá y no durante el arranque hace que el health check mida
# el servicio y no la velocidad de tu red. Debe coincidir con IMAGEN_PLAYWRIGHT
# de agent/sandbox/sandbox.ts.
BACKEND_SANDBOX="$(valor_de SRI_SANDBOX_BACKEND)"
IMAGEN_SANDBOX="$(valor_de SRI_IMAGEN_SANDBOX)"
: "${IMAGEN_SANDBOX:=mcr.microsoft.com/playwright:v1.56.0-noble}"
if [ "${BACKEND_SANDBOX:-docker}" = "docker" ] && [ "$(valor_de SRI_EJECUCION)" != "local" ]; then
  info "Descargando la imagen del sandbox ($IMAGEN_SANDBOX)."
  docker pull "$IMAGEN_SANDBOX" || error "No se pudo descargar $IMAGEN_SANDBOX."
fi

info "Reiniciando $SERVICIO."
# Limpia el contador de StartLimitBurst de intentos anteriores.
systemctl reset-failed "$SERVICIO" 2>/dev/null || true
systemctl restart "$SERVICIO"

set +e
esperar_salud
SALUD=$?
set -e

case "$SALUD" in
  0)
    info "Desplegado: $COMMIT_NUEVO responde en /eve/v1/health."
    ;;
  2)
    aviso "El servicio se cayó durante el arranque."
    journalctl -u "$SERVICIO" -n 60 --no-pager || true
    if [ "$SIN_ROLLBACK" -eq 1 ]; then
      error "Se deja el build nuevo puesto (--no-rollback)."
    fi
    restaurar_anterior
    exit 1
    ;;
  *)
    aviso "Sigue arrancando tras $((INTENTOS_SALUD * 2))s y no respondió todavía."
    aviso "El servicio NO se cayó: probablemente el template del sandbox aún se construye."
    journalctl -u "$SERVICIO" -n 60 --no-pager || true
    if [ "$SIN_ROLLBACK" -eq 1 ]; then
      aviso "Se deja el build nuevo puesto (--no-rollback). Seguilo con:"
      aviso "  journalctl -u $SERVICIO -f"
      exit 0
    fi
    aviso "Si querés darle más tiempo en vez de revertir:"
    aviso "  SRI_HEALTH_RETRIES=600 bash deploy/deploy.sh --skip-pull --no-rollback"
    restaurar_anterior
    exit 1
    ;;
esac
