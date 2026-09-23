// ACCIÓN IRREVERSIBLE: presenta la declaración ante el SRI.
// Solo se invoca desde `sri_presentar_104`, que exige aprobación humana.
// Entrada: { periodo: {anio, mes}, casilleros: {...}, confirmacion: "PRESENTAR" }
import { ejecutar, log, rutaDatos } from "./lib/runner.mjs";
import { asegurarSesion } from "./lib/portal.mjs";
import { llenarFormulario104, leerCasilleros } from "./lib/formulario104.mjs";
import { DECLARACION_104 } from "./lib/selectores.mjs";
import { mkdir } from "node:fs/promises";

await ejecutar("presentar-104", async ({ page, entrada, credenciales, guardarSesion }) => {
  const { periodo, casilleros, confirmacion } = entrada;
  if (confirmacion !== "PRESENTAR") {
    throw new Error("Falta la confirmación explícita de presentación.");
  }

  await asegurarSesion(page, credenciales, guardarSesion);
  const { escritos } = await llenarFormulario104(page, periodo, casilleros, {
    ruc: credenciales.ruc,
  });
  const leidos = await leerCasilleros(page);

  // Último control antes del punto de no retorno: lo que está en pantalla
  // tiene que coincidir con lo que se aprobó.
  for (const { casillero, valor } of escritos) {
    if (leidos[casillero] !== undefined && leidos[casillero] !== valor) {
      throw new Error(
        `El casillero ${casillero} quedó en "${leidos[casillero]}" y se aprobó "${valor}". ` +
          "No se presenta la declaración.",
      );
    }
  }

  if (DECLARACION_104.botonPresentar === null) {
    throw new Error(
      "Falta automatizar el paso 4 (Pago/Presentación): DECLARACION_104.botonPresentar " +
        "sigue sin definir. El formulario quedó lleno pero NO se presentó nada.",
    );
  }

  log("Presentando la declaración.");
  await page.click(DECLARACION_104.botonPresentar);
  await page.waitForSelector(DECLARACION_104.confirmacionPresentacion, { timeout: 90_000 });

  const numeroComprobante = (await page.locator(DECLARACION_104.numeroComprobante).count())
    ? (await page.locator(DECLARACION_104.numeroComprobante).innerText()).trim()
    : null;

  await mkdir(rutaDatos("presentadas"), { recursive: true });
  const sufijo = `${periodo.anio}-${String(periodo.mes).padStart(2, "0")}`;
  const captura = rutaDatos("presentadas", `104-${sufijo}.png`);
  await page.screenshot({ path: captura, fullPage: true });

  let comprobante = null;
  if (await page.locator(DECLARACION_104.enlaceDescargarComprobante).count()) {
    const [descarga] = await Promise.all([
      page.waitForEvent("download"),
      page.click(DECLARACION_104.enlaceDescargarComprobante),
    ]);
    comprobante = rutaDatos("presentadas", `comprobante-${sufijo}.pdf`);
    await descarga.saveAs(comprobante);
  }

  return { periodo, numeroComprobante, comprobante, captura, leidos, presentado: true };
});
