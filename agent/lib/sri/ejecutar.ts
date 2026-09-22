import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ToolContext } from "eve/tools";
import { resolverCredenciales } from "./credenciales.js";

const MARCADOR = "__SRI_RESULT__";

/**
 * Dónde corre Chromium.
 *
 *   "sandbox"  (por defecto) Dentro del sandbox de eve. Es el modo de
 *              producción: aísla el navegador del proceso de la app y, con
 *              microsandbox o vercel, restringe el egress a *.sri.gob.ec.
 *
 *   "local"    En un proceso hijo del runtime de la app, con el Playwright
 *              instalado en el proyecto. Sirve para desarrollar en Windows sin
 *              Docker. NO hay aislamiento ni restricción de red: el navegador
 *              corre con los permisos de tu usuario. No lo uses en producción.
 */
const MODO = (process.env.SRI_EJECUCION ?? "sandbox") as "sandbox" | "local";

const DIR_SCRIPTS_SANDBOX = "/workspace/sri";

function dirScriptsLocal(): string {
  return (
    process.env.SRI_DIR_SCRIPTS ??
    resolve(process.cwd(), "agent/sandbox/workspace/sri")
  );
}

function dirDatosLocal(): string {
  return process.env.SRI_DIR_BASE ?? resolve(process.cwd(), ".sri-datos");
}

interface Diagnostico {
  readonly captura: string;
  readonly html: string;
  readonly url: string;
}

type SalidaScript<T> =
  | { readonly ok: true; readonly datos: T }
  | { readonly ok: false; readonly error: string; readonly diagnostico: Diagnostico | null };

export class ErrorAutomatizacionSri extends Error {
  readonly diagnostico: Diagnostico | null;
  constructor(mensaje: string, diagnostico: Diagnostico | null) {
    super(mensaje);
    this.name = "ErrorAutomatizacionSri";
    this.diagnostico = diagnostico;
  }
}

function extraerResultado<T>(stdout: string): SalidaScript<T> | null {
  const linea = stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith(MARCADOR));
  if (linea === undefined) return null;
  return JSON.parse(linea.slice(MARCADOR.length)) as SalidaScript<T>;
}

interface ResultadoProceso {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Corre el script en un proceso hijo del runtime de la app. */
function correrLocal(
  script: string,
  cargaUtil: string,
  env: Record<string, string>,
  abortSignal: AbortSignal,
): Promise<ResultadoProceso> {
  return new Promise((cumplir, rechazar) => {
    const hijo = spawn(
      process.execPath,
      [join(dirScriptsLocal(), script), cargaUtil],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...env, SRI_DIR_BASE: dirDatosLocal() },
        signal: abortSignal,
        windowsHide: true,
      },
    );

    let stdout = "";
    let stderr = "";
    hijo.stdout.on("data", (trozo: Buffer) => (stdout += trozo.toString("utf8")));
    hijo.stderr.on("data", (trozo: Buffer) => (stderr += trozo.toString("utf8")));
    hijo.on("error", rechazar);
    hijo.on("close", (codigo) => cumplir({ exitCode: codigo ?? 1, stdout, stderr }));
  });
}

/** Corre el script dentro del sandbox de eve. */
async function correrEnSandbox(
  ctx: ToolContext,
  script: string,
  cargaUtil: string,
  env: Record<string, string>,
): Promise<ResultadoProceso> {
  const sandbox = await ctx.getSandbox();
  return sandbox.run({
    command: `node ${DIR_SCRIPTS_SANDBOX}/${script} ${cargaUtil}`,
    workingDirectory: "/workspace",
    env,
    abortSignal: ctx.abortSignal,
  });
}

/**
 * Ejecuta un script de Playwright.
 *
 * Las credenciales viajan por `env` del proceso —nunca por argumentos de línea
 * de comando ni por archivos— para que no aparezcan en logs. La entrada del
 * script va en base64 para no pelear con el quoting del shell.
 */
export async function ejecutarScriptSri<T>(
  ctx: ToolContext,
  script: string,
  ruc: string,
  entrada: unknown,
): Promise<T> {
  const credenciales = resolverCredenciales(ruc);
  const cargaUtil = Buffer.from(JSON.stringify(entrada), "utf8").toString("base64");
  // El sandbox recibe un entorno explicito, no hereda el del runtime: si el
  // proxy no se pasa acá, el navegador sale directo y vuelve a fallar.
  const proxy = process.env.SRI_PROXY;
  const env = {
    SRI_RUC: credenciales.ruc,
    SRI_USUARIO: credenciales.usuario,
    SRI_CLAVE: credenciales.clave,
    ...(proxy === undefined || proxy === "" ? {} : { SRI_PROXY: proxy }),
  };

  const resultado =
    MODO === "local"
      ? await correrLocal(script, cargaUtil, env, ctx.abortSignal)
      : await correrEnSandbox(ctx, script, cargaUtil, env);

  const salida = extraerResultado<T>(resultado.stdout);

  if (salida === null) {
    const faltaPlaywright = resultado.stderr.includes("Cannot find package 'playwright'");
    const pista = faltaPlaywright
      ? MODO === "local"
        ? " Instalá Playwright en el proyecto: npm run sri:setup"
        : " El sandbox no tiene Playwright: revisá el bootstrap en agent/sandbox/sandbox.ts."
      : "";
    throw new ErrorAutomatizacionSri(
      `El script ${script} no devolvió un resultado legible (exit ${resultado.exitCode}). ` +
        `${resultado.stderr.slice(-1500)}${pista}`,
      null,
    );
  }

  if (!salida.ok) {
    throw new ErrorAutomatizacionSri(salida.error, salida.diagnostico);
  }

  return salida.datos;
}

/** Lee un archivo que el script dejó, en base64. */
export async function leerBinarioSandbox(ctx: ToolContext, ruta: string): Promise<string | null> {
  if (MODO === "local") {
    return readFile(ruta)
      .then((bytes) => bytes.toString("base64"))
      .catch(() => null);
  }
  const sandbox = await ctx.getSandbox();
  const bytes = await sandbox.readBinaryFile({ path: ruta });
  if (bytes === null) return null;
  return Buffer.from(bytes).toString("base64");
}
