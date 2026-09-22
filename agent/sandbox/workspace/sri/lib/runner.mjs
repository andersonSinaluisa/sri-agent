// Contrato de ejecución compartido por todos los scripts de automatización.
//
//   stdout  -> EXACTAMENTE una línea: __SRI_RESULT__<json>
//   stderr  -> logs legibles para diagnóstico
//   exit 0  -> { ok: true, datos }        exit 1 -> { ok: false, error, diagnostico }
//
// Las credenciales llegan SOLO por variables de entorno (SRI_RUC, SRI_USUARIO,
// SRI_CLAVE) y nunca se escriben a disco ni se devuelven en el resultado.

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const MARCADOR = "__SRI_RESULT__";

// Raíz de los archivos que producen los scripts. En el sandbox es
// /workspace/sri; en ejecución local la fija el runtime de la app.
const DIR_BASE = process.env.SRI_DIR_BASE ?? "/workspace/sri";

/** Ancla una ruta relativa a la raíz de datos. */
export function rutaDatos(...partes) {
  return join(DIR_BASE, ...partes);
}

const DIR_SESIONES = process.env.SRI_DIR_SESIONES ?? join(homedir(), ".sri-sesiones");
const DIR_DIAGNOSTICO = rutaDatos("diagnostico");
const DIR_DESCARGAS = rutaDatos("descargas");

export function log(...partes) {
  process.stderr.write(`${partes.join(" ")}\n`);
}

/**
 * Chromium headless se anuncia como "HeadlessChrome/141.0.7390.37", y el
 * portal del SRI filtra por User-Agent: con el de curl no contesta nada y con
 * uno de Chrome devuelve 200 en 150ms. Se reemplaza por el de un Chrome
 * normal, conservando la version real del binario para no mentir sobre las
 * capacidades del motor, que son las mismas.
 */
function userAgentDeNavegador(navegador) {
  const plataforma =
    process.platform === "win32"
      ? "Windows NT 10.0; Win64; x64"
      : process.platform === "darwin"
        ? "Macintosh; Intel Mac OS X 10_15_7"
        : "X11; Linux x86_64";
  return (
    `Mozilla/5.0 (${plataforma}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `Chrome/${navegador.version()} Safari/537.36`
  );
}

function leerEntrada() {
  const crudo = process.argv[2];
  if (crudo === undefined || crudo === "") return {};
  return JSON.parse(Buffer.from(crudo, "base64").toString("utf8"));
}

function leerCredenciales() {
  const ruc = process.env.SRI_RUC;
  const usuario = process.env.SRI_USUARIO;
  const clave = process.env.SRI_CLAVE;
  if (!ruc || !usuario || !clave) {
    throw new Error(
      "Error interno: el runtime no paso las credenciales al script. " +
        'Esto NO lo configura el usuario; la variable de usuario es SRI_CRED_<RUC>="usuario:clave".',
    );
  }
  return { ruc, usuario, clave };
}

function rutaSesion(ruc) {
  return join(DIR_SESIONES, `${ruc}.json`);
}

async function capturarDiagnostico(page, etiqueta) {
  if (page === null || page.isClosed()) return null;
  try {
    await mkdir(DIR_DIAGNOSTICO, { recursive: true });
    const sello = new Date().toISOString().replace(/[:.]/g, "-");
    const base = join(DIR_DIAGNOSTICO, `${etiqueta}-${sello}`);
    await page.screenshot({ path: `${base}.png`, fullPage: true });
    await writeFile(`${base}.html`, await page.content(), "utf8");
    return { captura: `${base}.png`, html: `${base}.html`, url: page.url() };
  } catch (error) {
    log("No se pudo capturar diagnóstico:", error.message);
    return null;
  }
}

/**
 * Ejecuta un paso de automatización con navegador ya inicializado.
 *
 * @param {string} nombre    etiqueta para archivos de diagnóstico
 * @param {(ctx: {page: import("playwright").Page, contexto: import("playwright").BrowserContext, entrada: any, credenciales: {ruc: string, usuario: string, clave: string}, guardarSesion: () => Promise<void>, dirDescargas: string}) => Promise<any>} paso
 */
export async function ejecutar(nombre, paso) {
  const entrada = leerEntrada();
  const credenciales = leerCredenciales();

  await mkdir(DIR_SESIONES, { recursive: true });
  await mkdir(DIR_DESCARGAS, { recursive: true });

  // El sandbox de Chromium no puede funcionar como root, y el backend Docker
  // de eve ejecuta con el usuario por defecto de la imagen (root).
  const args = ["--disable-dev-shm-usage"];
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    args.push("--no-sandbox");
  }

  const navegador = await chromium.launch({ headless: true, args });

  const archivoSesion = rutaSesion(credenciales.ruc);
  const contexto = await navegador.newContext({
    storageState: existsSync(archivoSesion) ? archivoSesion : undefined,
    userAgent: userAgentDeNavegador(navegador),
    locale: "es-EC",
    timezoneId: "America/Guayaquil",
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  });
  contexto.setDefaultTimeout(45_000);

  const page = await contexto.newPage();
  const guardarSesion = async () => {
    await contexto.storageState({ path: archivoSesion });
  };

  let salida;
  try {
    const datos = await paso({
      page,
      contexto,
      entrada,
      credenciales,
      guardarSesion,
      dirDescargas: DIR_DESCARGAS,
    });
    salida = { ok: true, datos };
  } catch (error) {
    const diagnostico = await capturarDiagnostico(page, nombre);
    salida = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      diagnostico,
    };
  } finally {
    await contexto.close().catch(() => {});
    await navegador.close().catch(() => {});
  }

  process.stdout.write(`${MARCADOR}${JSON.stringify(salida)}\n`);
  process.exit(salida.ok ? 0 : 1);
}
