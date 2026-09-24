// ACCIÓN IRREVERSIBLE: presenta la declaración ante el SRI.
// Solo se invoca desde `sri_presentar_104`, que exige aprobación humana.
//
// Entrada: { periodo: {anio, mes}, casilleros: {...}, confirmacion: "PRESENTAR" }
import { ejecutar, log, rutaDatos } from "./lib/runner.mjs";
import { asegurarSesion } from "./lib/portal.mjs";
import {
  declaracionPresentada,
  leerCasilleros,
  leerMensajes,
  leerResumen,
  llenarFormulario104,
  pasoResaltado,
} from "./lib/formulario104.mjs";
import { DECLARACION_104, URLS } from "./lib/selectores.mjs";
import { mkdir } from "node:fs/promises";

await ejecutar("presentar-104", async ({ page, entrada, credenciales, guardarSesion }) => {
  const { periodo, casilleros, confirmacion } = entrada;
  if (confirmacion !== "PRESENTAR") {
    throw new Error("Falta la confirmación explícita de presentación.");
  }

  await asegurarSesion(page, credenciales, guardarSesion, { destino: URLS.declaracionIva });
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

  const mensajes = await leerMensajes(page);
  if (mensajes.errores.length > 0) {
    throw new Error(
      `El formulario reporta errores; no se presenta: ${mensajes.errores.join(" | ")}`,
    );
  }

  // Avanzar del formulario al resumen.
  if ((await page.locator(DECLARACION_104.botonSiguienteResumen).count()) > 0) {
    await page.click(DECLARACION_104.botonSiguienteResumen);
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  }

  const resumen = await leerResumen(page);
  const paso = await pasoResaltado(page);
  log(`Paso ${paso} · total según el portal: ${resumen.textoTotal ?? "no disponible"}`);

  await mkdir(rutaDatos("presentadas"), { recursive: true });
  const sufijo = `${periodo.anio}-${String(periodo.mes).padStart(2, "0")}`;
  const captura = rutaDatos("presentadas", `104-${sufijo}.png`);
  await page.screenshot({ path: captura, fullPage: true });

  // El envío final del paso 4 (Pago) todavía no está mapeado: en las capturas
  // que tenemos del portal solo aparece "Anterior"; el botón de envío surge
  // después de elegir medio de pago, y esa pantalla no se inspeccionó.
  //
  // Se corta acá a propósito. Hacer clic a ciegas en el paso que presenta una
  // declaración no es un riesgo aceptable: el formulario queda lleno y
  // verificado, y la presentación se completa a mano esta vez.
  if (await declaracionPresentada(page)) {
    log("El portal ya reporta la declaración como presentada.");
    return { periodo, paso, resumen, leidos, captura, presentado: true };
  }

  throw new Error(
    `Formulario lleno y verificado (paso "${paso}", total ${resumen.textoTotal ?? "?"}), ` +
      "pero el envío final del paso 4 no está automatizado todavía: falta mapear la " +
      "pantalla de pago posterior a elegir medio de pago. NO se presentó nada. " +
      `Revisá la captura en ${captura} y completá el envío desde el portal.`,
  );
});
