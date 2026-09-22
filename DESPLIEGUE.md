# Despliegue en VPS

El agente corre como un servicio Node (Nitro) detrás de un reverse proxy, y
levanta contenedores Docker para el sandbox donde vive Chromium.

```
Caddy (TLS)  →  eve start :3000  →  sandbox Docker  →  Chromium  →  SRI
```

## Requisitos del VPS

| | |
|---|---|
| SO | Linux glibc (Debian/Ubuntu) |
| Node | 24.x |
| Docker | daemon corriendo; el usuario del servicio en el grupo `docker` |
| Disco | ~6 GB libres — la imagen oficial de Playwright pesa ~2 GB |
| RAM | 2 GB mínimo; Chromium headless es el que manda |

## 1. Elegir backend de sandbox

Esta es la decisión con consecuencia de seguridad. Comprobá primero:

```sh
ls -l /dev/kvm
```

**Si existe `/dev/kvm`** → usá `SRI_SANDBOX_BACKEND=microsandbox`. Es el único
backend local que soporta allow-list por dominio, así que el egress del
navegador queda restringido a `*.sri.gob.ec` de verdad. Es la opción correcta.

**Si no existe** (típico en VPS sin virtualización anidada) → `docker`. El
backend Docker de eve **solo acepta `allow-all` o `deny-all`**, y `deny-all`
bloquearía también al SRI. Es decir: **el navegador que maneja las credenciales
fiscales puede alcanzar cualquier host**. Si te quedás en Docker, compensá en el
firewall del host — con la salvedad de que las IPs del SRI no son estables, así
que un allow-list por IP se rompe solo. La alternativa sólida es un proxy de
salida con filtrado por dominio.

No hay una tercera opción local. Vale la pena averiguar si tu proveedor ofrece
KVM anidado antes de conformarte con Docker.

## 2. Instalar

```sh
git clone <tu-repo> /tmp/sri-agent && cd /tmp/sri-agent
sudo bash deploy/provision.sh <url-del-repo>
```

`provision.sh` comprueba los requisitos, detecta si hay `/dev/kvm` y preselecciona
el backend en consecuencia, crea el usuario de servicio y los directorios, clona
el repo, deja `/etc/sri-agent/env` desde la plantilla e instala la unidad de
systemd. Es idempotente: si ya hay un checkout, no lo toca.

## 3. Configurar el entorno

```sh
sudo -e /etc/sri-agent/env
```

Tres variables que se olvidan y rompen el despliegue:

- **`AI_GATEWAY_API_KEY`** — un model id en string sale por el AI Gateway. En
  Vercel eso se autentica con el OIDC del proyecto; **en tu VPS no existe ese
  OIDC**, así que sin la clave el agente no puede llamar al modelo. Si preferís
  ir directo a un proveedor, instalá su paquete del AI SDK y pasá el objeto de
  modelo en `agent/agent.ts`.
- **`SRI_AGENTE_USUARIO` / `SRI_AGENTE_CLAVE`** — eve falla cerrado. Sin esto el
  canal devuelve 401 a todo el mundo en producción.
- **`SRI_CRED_<RUC>`** — una por contribuyente.

`deploy.sh` verifica que las tres estén con valor antes de compilar, y aborta si
falta alguna.

## 4. Desplegar

```sh
sudo bash /srv/sri-agent/deploy/deploy.sh
```

El script hace, en orden: preflight del entorno y de Docker → `git pull` →
`npm ci` → `npx tsc` → guarda el build anterior → `npm run build` → reinicia el
servicio → espera el health check. **Si el build falla o el servicio no levanta,
restaura el build anterior automáticamente** y sale con error.

```sh
sudo bash deploy/deploy.sh --skip-pull   # rebuild sin traer cambios
sudo bash deploy/deploy.sh --rollback    # volver al build anterior a mano
```

Nunca toca `.eve/`, así que las sesiones parqueadas esperando aprobación
sobreviven al deploy.

Después, el reverse proxy con `deploy/Caddyfile`. Tiene que reenviar **los dos
prefijos sin reescribir la ruta**:

- `/eve/` — health, sesiones, streams, canales
- `/.well-known/workflow/` — callbacks de workflow

Un proxy restringido a `/eve/` deja arrancar la sesión, pero el run se cuelga
cuando el callback no puede volver.

## 5. Verificar

```sh
curl https://sri.tu-dominio.com/eve/v1/health
eve dev https://sri.tu-dominio.com     # TUI contra el agente desplegado
```

La primera sesión baja la imagen `mcr.microsoft.com/playwright` (~2 GB) y
construye el template del sandbox; tarda varios minutos. Las siguientes lo
reutilizan. Para forzar la reconstrucción, subí `VERSION_RUNTIME` en
`agent/sandbox/sandbox.ts`.

Se usa la imagen oficial de Playwright en vez de instalar Chromium sobre la
imagen base de eve porque `playwright install --with-deps` aborta en cuanto la
distro no está en su lista soportada (`does not support chromium on
ubuntu26.04-x64`). La imagen ya trae el navegador y sus librerías.

## Estado durable — no lo pierdas

El estado de las sesiones vive en `.eve/.workflow-data`, dentro del
`WorkingDirectory`. Ahí queda parqueada una declaración que está **esperando
aprobación humana**: si borrás ese directorio o desplegás sobre un volumen
efímero, esa aprobación pendiente se pierde.

Ponelo en almacenamiento persistente e incluilo en el backup. Un `git clone`
limpio sobre el mismo directorio en cada deploy lo destruye: desplegá con
`git pull` + `npm ci` + `npm run build`, sin borrar `.eve/`.

## Actualizar

```sh
sudo bash /srv/sri-agent/deploy/deploy.sh
```

## Schedules

`eve start` levanta el runner de tareas de Nitro, así que los `agent/schedules/`
se disparan solos. Hoy no hay ninguno definido; las alertas por noveno dígito
están pendientes y `fechaLimiteIva` ya está listo para alimentarlas.
