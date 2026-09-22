// Llena el Formulario 104 y SE DETIENE antes de presentarlo.
// Este archivo no contiene ninguna ruta de código que presente la declaración.
// Entrada: { periodo: {anio, mes}, casilleros: { "401": 123456, ... } }
// Salida:  { resumen, escritos, leidos, captura }
import { ejecutar, rutaDatos } from "./lib/runner.mjs";
import { asegurarSesion } from "./lib/portal.mjs";
import { llenarFormulario104, leerCasilleros } from "./lib/formulario104.mjs";
import { mkdir } from "node:fs/promises";

await ejecutar("preparar-104", async ({ page, entrada, credenciales, guardarSesion }) => {
  const { periodo, casilleros } = entrada;
  if (!periodo?.anio || !periodo?.mes) throw new Error("Falta `periodo.anio` / `periodo.mes`.");
  if (!casilleros || Object.keys(casilleros).length === 0) {
    throw new Error("No se recibió ningún casillero para escribir.");
  }

  await asegurarSesion(page, credenciales, guardarSesion);
  const { escritos, resumen } = await llenarFormulario104(page, periodo, casilleros);
  const leidos = await leerCasilleros(page);

  await mkdir(rutaDatos("borradores"), { recursive: true });
  const captura = rutaDatos(
    "borradores",
    `104-${periodo.anio}-${String(periodo.mes).padStart(2, "0")}.png`,
  );
  await page.screenshot({ path: captura, fullPage: true });

  return { periodo, escritos, leidos, resumen, captura, presentado: false };
});
