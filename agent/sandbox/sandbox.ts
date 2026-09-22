import { defineSandbox } from "eve/sandbox";
import { docker } from "eve/sandbox/docker";
import { microsandbox } from "eve/sandbox/microsandbox";
import { vercel } from "eve/sandbox/vercel";

/**
 * Backend del sandbox donde corre Chromium. Se elige con SRI_SANDBOX_BACKEND.
 *
 *   "docker"        Contenedor local. Es la opción por defecto en un VPS.
 *                   NO soporta allow-list por dominio: el backend solo acepta
 *                   "allow-all" o "deny-all", y "deny-all" bloquearía también
 *                   al SRI. El egress se restringe entonces en el firewall del
 *                   host, no acá. Ver DESPLIEGUE.md.
 *
 *   "microsandbox"  microVM local. SÍ soporta allow-list por dominio, así que
 *                   el egress queda restringido a *.sri.gob.ec de verdad.
 *                   Requiere Linux glibc con KVM habilitado: comprobá que
 *                   exista /dev/kvm en el VPS. Es la mejor opción si está.
 *
 *   "vercel"        Sandbox hospedado. Solo si querés que el VPS cree sandboxes
 *                   en Vercel; requiere credenciales de Vercel.
 */
const BACKEND = (process.env.SRI_SANDBOX_BACKEND ?? "docker") as
  | "docker"
  | "microsandbox"
  | "vercel";

/**
 * Con SRI_EJECUCION=local, Chromium corre en el runtime de la app y este
 * sandbox no interviene en el flujo del SRI. Se deja sin bootstrap para que no
 * intente instalar Playwright en un backend que quizá no tenga binarios
 * reales (just-bash, el fallback en Windows sin Docker).
 */
const EJECUCION_LOCAL = process.env.SRI_EJECUCION === "local";

const DOMINIOS_SRI = [
  "srienlinea.sri.gob.ec",
  "sri.gob.ec",
  "*.sri.gob.ec",
  "celcer.sri.gob.ec",
  "cel.sri.gob.ec",
];

/** Dominios que solo se necesitan mientras se construye el template. */
const DOMINIOS_BOOTSTRAP = [
  "registry.npmjs.org",
  "cdn.playwright.dev",
  "playwright.azureedge.net",
  "deb.debian.org",
  "security.debian.org",
  "archive.ubuntu.com",
  "security.ubuntu.com",
  "ports.ubuntu.com",
];

/** Subí esta versión para forzar la reconstrucción del template. */
const VERSION_RUNTIME = "playwright-chromium-v1";

/** Instala Chromium una sola vez por template; lo heredan todas las sesiones. */
async function instalarPlaywright(sandbox: {
  run: (o: { command: string }) => PromiseLike<{ exitCode: number; stdout: string; stderr: string }>;
}): Promise<void> {
  const instalar = await sandbox.run({
    command: [
      "set -euo pipefail",
      "cd /workspace",
      '[ -f package.json ] || npm init -y >/dev/null',
      "npm install --no-audit --no-fund playwright@1.56.0",
      "npx --yes playwright install --with-deps chromium",
    ].join(" && "),
  });

  if (instalar.exitCode !== 0) {
    throw new Error(
      `No se pudo instalar Playwright en el sandbox (exit ${instalar.exitCode}): ` +
        `${instalar.stderr || instalar.stdout}`,
    );
  }
}

const revalidationKey = () => `${VERSION_RUNTIME}-${BACKEND}`;

function definirDocker() {
  return defineSandbox({
    // El backend Docker no acepta opciones por sesión ni allow-lists por
    // dominio: su política queda fijada acá. El egress NO está restringido
    // por eve; restringilo en el firewall del host.
    backend: docker({ networkPolicy: "allow-all" }),
    revalidationKey,
    async bootstrap({ use }) {
      await instalarPlaywright(await use());
    },
  });
}

function definirMicrosandbox() {
  return defineSandbox({
    backend: microsandbox({
      memoryMiB: 2048,
      // Línea base: si una sesión se reemplaza, `onSession` no se re-ejecuta
      // y el egress nunca queda abierto.
      networkPolicy: { allow: [...DOMINIOS_SRI, ...DOMINIOS_BOOTSTRAP] },
    }),
    revalidationKey,
    async bootstrap({ use }) {
      await instalarPlaywright(await use());
    },
    async onSession({ use }) {
      // El bootstrap ya terminó: se cierra el egress a solo el SRI.
      await use({ networkPolicy: { allow: DOMINIOS_SRI } });
    },
  });
}

function definirVercel() {
  return defineSandbox({
    backend: vercel({
      resources: { vcpus: 2 },
      networkPolicy: { allow: [...DOMINIOS_SRI, ...DOMINIOS_BOOTSTRAP] },
    }),
    revalidationKey,
    async bootstrap({ use }) {
      await instalarPlaywright(await use());
    },
    async onSession({ use }) {
      await use({ networkPolicy: { allow: DOMINIOS_SRI } });
    },
  });
}

export default EJECUCION_LOCAL
  ? defineSandbox({})
  : BACKEND === "microsandbox"
    ? definirMicrosandbox()
    : BACKEND === "vercel"
      ? definirVercel()
      : definirDocker();
