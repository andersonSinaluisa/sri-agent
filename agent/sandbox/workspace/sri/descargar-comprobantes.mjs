// Descarga el listado de comprobantes electrónicos RECIBIDOS de un período.
// Entrada: { anio: number, mes: number, tipoComprobante?: string }
// Salida:  { periodo, filas: [...], archivoListado }
import { ejecutar, log } from "./lib/runner.mjs";
import { asegurarSesion, aCentavos } from "./lib/portal.mjs";
import { COMPROBANTES, URLS } from "./lib/selectores.mjs";
import { join } from "node:path";

await ejecutar(
  "descargar-comprobantes",
  async ({ page, entrada, credenciales, guardarSesion, dirDescargas }) => {
    const { anio, mes, tipoComprobante = "1" } = entrada;
    if (!anio || !mes) throw new Error("Se requieren `anio` y `mes` en la entrada.");

    await asegurarSesion(page, credenciales, guardarSesion);

    await page.goto(URLS.comprobantesRecibidos, { waitUntil: "domcontentloaded" });
    await page.selectOption(COMPROBANTES.selectAnio, String(anio));
    await page.selectOption(COMPROBANTES.selectMes, String(mes));
    await page.selectOption(COMPROBANTES.selectDia, "0"); // 0 = todo el mes
    await page.selectOption(COMPROBANTES.selectTipoComprobante, String(tipoComprobante));
    await page.click(COMPROBANTES.botonConsultar);

    await page
      .waitForSelector(`${COMPROBANTES.tablaResultados}, ${COMPROBANTES.mensajeSinResultados}`)
      .catch(() => {});

    if (await page.locator(COMPROBANTES.mensajeSinResultados).count()) {
      log("El período no tiene comprobantes recibidos.");
      return { periodo: { anio, mes }, filas: [], archivoListado: null };
    }

    const filas = await page.locator(COMPROBANTES.filasResultados).evaluateAll((trs) =>
      trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.innerText.trim())),
    );

    // El orden de columnas depende del portal; se mapea acá y en ningún otro lado.
    const comprobantes = filas
      .filter((celdas) => celdas.length >= 8)
      .map((celdas) => ({
        rucEmisor: celdas[1],
        razonSocialEmisor: celdas[2],
        tipoComprobante: celdas[3],
        serie: celdas[4],
        claveAcceso: celdas[5],
        fechaEmision: celdas[6],
        fechaAutorizacion: celdas[7],
        subtotalCentavos: aCentavos(celdas[8] ?? "0"),
        ivaCentavos: aCentavos(celdas[9] ?? "0"),
        totalCentavos: aCentavos(celdas[10] ?? "0"),
      }));

    let archivoListado = null;
    if (await page.locator(COMPROBANTES.enlaceDescargarListado).count()) {
      const [descarga] = await Promise.all([
        page.waitForEvent("download"),
        page.click(COMPROBANTES.enlaceDescargarListado),
      ]);
      archivoListado = join(dirDescargas, `recibidos-${anio}-${String(mes).padStart(2, "0")}.txt`);
      await descarga.saveAs(archivoListado);
    }

    log(`Comprobantes leídos: ${comprobantes.length}`);
    return { periodo: { anio, mes }, filas: comprobantes, archivoListado };
  },
);
