// Abre sesión y describe una pantalla del portal, para que el agente pueda
// proponer selectores cuando uno deja de funcionar.
//
// Entrada: { url, esperarSelector?, maxLineas? }
import { ejecutar, log, rutaDatos } from "./lib/runner.mjs";
import { asegurarSesion } from "./lib/portal.mjs";
import { arbolPrincipal, inventariarControles } from "./lib/inventario.mjs";
import { mkdir } from "node:fs/promises";

await ejecutar("inspeccionar-pantalla", async ({ page, entrada, credenciales, guardarSesion }) => {
  const { url, esperarSelector, maxLineas = 60 } = entrada;
  if (!url) throw new Error("Falta `url` en la entrada.");

  await asegurarSesion(page, credenciales, guardarSesion);

  log(`Inspeccionando ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });

  // Las pantallas del SRI se pintan con JSF: sin esperar se inventaría el
  // esqueleto y los desplegables aparecen vacíos.
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  if (esperarSelector) {
    await page.waitForSelector(esperarSelector, { timeout: 20_000 }).catch(() => {});
  }

  await mkdir(rutaDatos("inspeccion"), { recursive: true });
  const captura = rutaDatos(
    "inspeccion",
    `${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
  );
  await page.screenshot({ path: captura, fullPage: true });

  return {
    url: page.url(),
    titulo: await page.title(),
    arbolAccesibilidad: await arbolPrincipal(page, maxLineas),
    controles: await inventariarControles(page),
    captura,
  };
});
