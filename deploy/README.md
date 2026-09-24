# Despliegue

El agente corre en un VPS propio, no en Vercel: necesita Docker para el
sandbox de Playwright y sesiones largas que un runtime serverless corta.

- `provision.sh` — prepara un servidor nuevo (una sola vez).
- `deploy.sh` — actualiza y reinicia. Es el que hace el trabajo real.
- `sri-agent.service` — la unidad de systemd.
- `nginx.conf` — el sitio, con la UI estática y el proxy al agente.

## A mano

```sh
sudo bash deploy/deploy.sh              # pull + build + restart
sudo bash deploy/deploy.sh --skip-pull  # rebuild del código que ya está
sudo bash deploy/deploy.sh --rollback   # volver al build anterior
```

Construye, verifica tipos, reinicia y espera el health check. Si el servicio
no levanta, **vuelve solo al build anterior**. Nunca toca `.eve/`, donde vive
el estado durable de las sesiones — incluidas las declaraciones parqueadas
esperando aprobación humana.

## Desde GitHub Actions

`.github/workflows/desplegar.yml` corre las pruebas y después entra por SSH a
ejecutar `deploy.sh`. El flujo no construye nada: el servidor ya sabe hacerlo,
y duplicar esa lógica es garantía de que las dos versiones se separen.

Se dispara con cada push a `master` y a mano desde la pestaña Actions, donde
además hay una casilla para **volver al build anterior** sin desplegar.

### Secretos (Settings → Secrets and variables → Actions)

| Secreto | Qué es |
| --- | --- |
| `VPS_HOST` | IP o nombre del servidor |
| `VPS_USER` | usuario de despliegue |
| `VPS_SSH_KEY` | clave privada, completa y sin frase |
| `VPS_KNOWN_HOSTS` | huella del servidor (ver abajo) |
| `VPS_PORT` | puerto SSH, si no es el 22 |

Y, opcionalmente, la variable `VPS_APP_DIR` si la app no está en
`/srv/sri-agent`.

La huella se genera desde tu máquina:

```sh
ssh-keyscan -p 22 TU_HOST
```

Pegá la salida completa. **No uses `StrictHostKeyChecking=no`**: con eso,
cualquiera que logre interponerse en la conexión recibe la clave de
despliegue y nada lo delata.

### Una clave dedicada, no la tuya

```sh
ssh-keygen -t ed25519 -f ~/.ssh/sri-despliegue -C "github-actions" -N ""
```

La privada va al secreto `VPS_SSH_KEY`; la pública, al `authorized_keys` del
usuario de despliegue en el servidor. Así se puede revocar el acceso de la CI
sin tocar el tuyo.

### Sin root por SSH

`deploy.sh` necesita root, pero abrir SSH como root para la CI es más permiso
del necesario. Conviene un usuario que pueda ejecutar **solo ese script**:

```sh
useradd -m -s /bin/bash despliegue
mkdir -p ~despliegue/.ssh && chmod 700 ~despliegue/.ssh
# pegá acá la clave pública de la CI
nano ~despliegue/.ssh/authorized_keys
chown -R despliegue:despliegue ~despliegue/.ssh

cat >/etc/sudoers.d/despliegue <<'EOF'
despliegue ALL=(root) NOPASSWD: /srv/sri-agent/deploy/deploy.sh
EOF
chmod 440 /etc/sudoers.d/despliegue
```

Y `VPS_USER=despliegue`.

### Aprobación antes de desplegar

El flujo usa el entorno `produccion`. Crealo en Settings → Environments y
agregale *Required reviewers* si querés que cada despliegue espere un visto
bueno. Sin eso, todo push a `master` va derecho al servidor; si preferís que
sea siempre manual, borrá el disparador `push` del archivo.

## Las credenciales no pasan por GitHub

Las del SRI viven **solo** en `/etc/sri-agent/env`, en el servidor. El flujo
de despliegue no las lee ni las necesita. Si alguna vez las metés como
secreto de Actions, quedan en los registros de un tercero y hay que rotarlas.

Para cargarlas o cambiarlas, en el servidor:

```sh
sudo nano /etc/sri-agent/env
sudo systemctl restart sri-agent
```

Si la clave lleva `$`, `#`, `(` o `)`, usá la variante en base64
(`SRI_CRED_<RUC>_B64`): el valor codificado es alfanumérico y ningún parser de
archivos de entorno lo toca.
