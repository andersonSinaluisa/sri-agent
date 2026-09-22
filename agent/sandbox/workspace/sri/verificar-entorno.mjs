// Comprueba que Chromium arranca y que el contrato del runner funciona.
// NO contacta al SRI ni usa credenciales reales: sirve para validar el entorno
// antes de pelearse con el portal.
//
//   npm run sri:check

import { resolve } from "node:path";

process.env.SRI_RUC ??= "0000000000000";
process.env.SRI_USUARIO ??= "verificacion";
process.env.SRI_CLAVE ??= "verificacion";
process.env.SRI_DIR_BASE ??= resolve(process.cwd(), ".sri-datos");

const { ejecutar, rutaDatos } = await import("./lib/runner.mjs");

await ejecutar("verificar-entorno", async ({ page }) => {
  await page.goto("about:blank");
  await page.setContent("<h1>ok</h1>");
  return {
    navegador: page.context().browser()?.version() ?? null,
    plataforma: `${process.platform} ${process.arch}`,
    node: process.versions.node,
    dirDatos: rutaDatos("."),
    modo: process.env.SRI_EJECUCION ?? "sandbox",
  };
});
