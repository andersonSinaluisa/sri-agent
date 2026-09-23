// Descarga el listado de comprobantes electrónicos RECIBIDOS de un período.
// Entrada: { anio: number, mes: number, tipoComprobante?: string }
// Salida:  { periodo, filas: [...], archivoListado }
import { ejecutar, log } from "./lib/runner.mjs";
import { asegurarSesion, aCentavos } from "./lib/portal.mjs";
import { COLUMNAS_COMPROBANTES, COMPROBANTES, URLS } from "./lib/selectores.mjs";
import { join } from "node:path";

/** "0992696036001\nCOMFARMALSA S.A." -> { ruc, razonSocial } */
function partirEmisor(celda) {
  const lineas = String(celda)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return { ruc: lineas[0] ?? "", razonSocial: lineas.slice(1).join(" ") };
}

/** "Factura  016-021-000620505" -> { tipo, serie } */
function partirTipoSerie(celda) {
  const texto = String(celda).replace(/\s+/g, " ").trim();
  // La serie es el último token y tiene forma NNN-NNN-NNNNNNNNN.
  const coincidencia = texto.match(/^(.*?)\s+([\d-]+)$/);
  if (coincidencia === null) return { tipo: texto, serie: "" };
  return { tipo: coincidencia[1].trim(), serie: coincidencia[2] };
}

await ejecutar(
  "descargar-comprobantes",
  async ({ page, entrada, credenciales, guardarSesion, dirDescargas }) => {
    const { anio, mes, tipoComprobante = "1" } = entrada;
    if (!anio || !mes) throw new Error("Se requieren `anio` y `mes` en la entrada.");

    await asegurarSesion(page, credenciales, guardarSesion);

    await page.goto(URLS.comprobantesRecibidos, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await page.waitForSelector(COMPROBANTES.selectAnio, { timeout: 30_000 });

    await page.selectOption(COMPROBANTES.selectAnio, String(anio));
    await page.selectOption(COMPROBANTES.selectMes, String(mes));
    await page.selectOption(COMPROBANTES.selectDia, "0"); // 0 = todo el mes
    await page.selectOption(COMPROBANTES.selectTipoComprobante, String(tipoComprobante));

    await page.click(COMPROBANTES.botonConsultar);
    // La consulta pasa por reCAPTCHA Enterprise y vuelve por AJAX.
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});

    if (await page.locator(COMPROBANTES.mensajeSinResultados).count()) {
      log("El período no tiene comprobantes recibidos.");
      return { periodo: { anio, mes }, filas: [], archivoListado: null };
    }

    const celdasPorFila = await page
      .locator(COMPROBANTES.filasResultados)
      .evaluateAll((filas) =>
        filas.map((fila) => [...fila.querySelectorAll("td")].map((td) => td.innerText)),
      );

    const C = COLUMNAS_COMPROBANTES;
    const comprobantes = celdasPorFila
      .filter((celdas) => celdas.length > C.importeTotal)
      .map((celdas) => {
        const emisor = partirEmisor(celdas[C.rucYRazonSocial]);
        const documento = partirTipoSerie(celdas[C.tipoYSerie]);
        return {
          rucEmisor: emisor.ruc,
          razonSocialEmisor: emisor.razonSocial,
          tipoComprobante: documento.tipo,
          serie: documento.serie,
          claveAcceso: celdas[C.claveAcceso].trim(),
          fechaEmision: celdas[C.fechaEmision].trim(),
          fechaAutorizacion: celdas[C.fechaHoraAutorizacion].trim(),
          subtotalCentavos: aCentavos(celdas[C.valorSinImpuestos]),
          ivaCentavos: aCentavos(celdas[C.iva]),
          totalCentavos: aCentavos(celdas[C.importeTotal]),
        };
      });

    // Control de coherencia: si los totales no cuadran, algo se leyó mal y es
    // mejor saberlo acá que al liquidar.
    const descuadradas = comprobantes.filter(
      (c) => Math.abs(c.subtotalCentavos + c.ivaCentavos - c.totalCentavos) > 1,
    );
    if (descuadradas.length > 0) {
      log(
        `AVISO: ${descuadradas.length} de ${comprobantes.length} filas no cuadran ` +
          "(subtotal + IVA != total). Puede haber cambiado el orden de las columnas.",
      );
    }

    let archivoListado = null;
    if (await page.locator(COMPROBANTES.enlaceDescargarListado).count()) {
      const [descarga] = await Promise.all([
        page.waitForEvent("download", { timeout: 60_000 }),
        page.click(COMPROBANTES.enlaceDescargarListado),
      ]);
      archivoListado = join(dirDescargas, `recibidos-${anio}-${String(mes).padStart(2, "0")}.txt`);
      await descarga.saveAs(archivoListado);
    }

    log(`Comprobantes leídos: ${comprobantes.length}`);
    return {
      periodo: { anio, mes },
      filas: comprobantes,
      archivoListado,
      filasDescuadradas: descuadradas.length,
    };
  },
);
