// Comprueba selectores candidatos contra una pantalla real del portal.
// Es el paso de verificación antes de proponer un cambio en selectores.mjs:
// un selector que resuelve 0 o 7 elementos no sirve, tiene que resolver 1.
//
// Entrada: { url, selectores: ["...", "..."], esperarSelector? }
import { ejecutar, log } from "./lib/runner.mjs";
import { asegurarSesion } from "./lib/portal.mjs";
import { contarCoincidencias } from "./lib/inventario.mjs";

await ejecutar("validar-selectores", async ({ page, entrada, credenciales, guardarSesion }) => {
  const { url, selectores, esperarSelector } = entrada;
  if (!url) throw new Error("Falta `url` en la entrada.");
  if (!Array.isArray(selectores) || selectores.length === 0) {
    throw new Error("Falta `selectores`: un arreglo de candidatos a probar.");
  }

  await asegurarSesion(page, credenciales, guardarSesion);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  if (esperarSelector) {
    await page.waitForSelector(esperarSelector, { timeout: 20_000 }).catch(() => {});
  }

  const resultados = [];
  for (const selector of selectores) {
    const resultado = await contarCoincidencias(page, selector);
    log(`${selector} -> ${resultado.valido ? `${resultado.cantidad} coincidencias` : "INVALIDO"}`);
    resultados.push(resultado);
  }

  return { url: page.url(), resultados };
});
