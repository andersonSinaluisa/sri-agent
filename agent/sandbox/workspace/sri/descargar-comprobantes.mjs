// Descarga el listado de comprobantes electrónicos RECIBIDOS de un período.
// Entrada: { anio: number, mes: number, tipoComprobante?: string }
// Salida:  { periodo, filas: [...], archivoListado }
import { ejecutar, log } from "./lib/runner.mjs";
import {
  asegurarSesion,
  aCentavos,
  calentarPantalla,
  clicComoPersona,
  ErrorCaptcha,
  exigirPantalla,
} from "./lib/portal.mjs";
import { esperarAjax } from "./lib/primefaces.mjs";
import { COLUMNAS_COMPROBANTES, COMPROBANTES, URLS } from "./lib/selectores.mjs";
import { join } from "node:path";

/**
 * Elige una opción y espera a que el portal termine de repintarse.
 *
 * Cada desplegable de esta pantalla dispara un AJAX de JSF al cambiar, y el
 * servidor repinta los demás. Encadenar los cuatro cambios sin esperar dejaba
 * la pantalla mostrando lo correcto pero el servidor consultando otra cosa:
 * de ahí "No existen datos" con los filtros bien puestos.
 */
async function elegir(page, selector, valor) {
  await page.selectOption(selector, valor);
  await esperarAjax(page);
}

/**
 * Espera a que reCAPTCHA Enterprise esté listo.
 *
 * El botón de consultar llama a `executeRecaptcha(...)` antes de enviar. Si
 * se hace clic antes de que el script termine de cargar, el envío sale sin
 * token y el portal contesta como si no hubiera datos.
 */
async function esperarRecaptcha(page) {
  await page
    .waitForFunction(
      () => {
        const g = /** @type {any} */ (window).grecaptcha;
        // Si la pantalla no usa reCAPTCHA, no hay nada que esperar.
        return g === undefined || typeof (g.enterprise ?? g).execute === "function";
      },
      undefined,
      { timeout: 20_000 },
    )
    .catch(() => {});
}

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
    await page
      .waitForSelector(COMPROBANTES.selectAnio, { timeout: 30_000 })
      .catch(() => {});
    await exigirPantalla(page, COMPROBANTES.selectAnio, "comprobantes recibidos");

    // Antes de tocar nada: que la pantalla tenga historia de interacción. El
    // botón de consultar envía un token de reCAPTCHA Enterprise que puntúa
    // justamente eso.
    await calentarPantalla(page);

    // El orden importa: el mes repuebla el día, así que va antes.
    await elegir(page, COMPROBANTES.selectAnio, String(anio));
    await elegir(page, COMPROBANTES.selectMes, String(mes));
    await elegir(page, COMPROBANTES.selectDia, "0"); // 0 = todo el mes
    await elegir(page, COMPROBANTES.selectTipoComprobante, String(tipoComprobante));

    await esperarRecaptcha(page);

    // Consultar de nuevo si vuelve vacía.
    //
    // Es una consulta de solo lectura: repetirla no cambia nada en el portal
    // ni arriesga la cuenta, a diferencia del login. Y hace falta porque el
    // token de reCAPTCHA puede salir rechazado, y entonces el portal contesta
    // como si el período estuviera vacío aunque los filtros estén bien.
    const MAX_CONSULTAS = 3;
    let filasEnPantalla = 0;
    let captchaRechazado = false;

    for (let intento = 1; intento <= MAX_CONSULTAS; intento += 1) {
      if (intento > 1) {
        log(
          `La consulta volvió vacía${captchaRechazado ? " (captcha rechazado)" : ""}; ` +
            `reintento ${intento} de ${MAX_CONSULTAS}.`,
        );
        // Más interacción antes de volver a intentar: si lo que falló fue el
        // puntaje del token, repetir el mismo gesto da el mismo resultado.
        await calentarPantalla(page);
      }

      await clicComoPersona(page, COMPROBANTES.botonConsultar);
      await esperarAjax(page);
      await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});

      filasEnPantalla = await page.locator(COMPROBANTES.filasResultados).count();
      captchaRechazado = (await page.locator(COMPROBANTES.mensajeCaptcha).count()) > 0;
      if (filasEnPantalla > 0) break;
    }

    // Un captcha rechazado NO es un período vacío.
    //
    // Devolver una lista vacía acá sería lo más peligroso que puede hacer este
    // script: el período entraría a la liquidación sin crédito tributario por
    // adquisiciones y la declaración saldría mal, sin que nada lo avise. Mejor
    // fallar fuerte y que una persona resuelva la consulta.
    if (filasEnPantalla === 0 && captchaRechazado) {
      const sufijo = `${anio}-${String(mes).padStart(2, "0")}`;
      throw new ErrorCaptcha(
        "la consulta de comprobantes recibidos",
        `Se intentó ${MAX_CONSULTAS} veces, así que NO se sabe si el período ${sufijo} ` +
          "tiene comprobantes. No se devuelve una lista vacía a propósito: liquidar con " +
          "eso daría una declaración sin crédito tributario y se presentaría igual. " +
          "La salida es el archivo: entrá al portal, hacé la consulta, tocá " +
          `"Descargar reporte" y guardalo como "listado-${sufijo}.txt" en el directorio ` +
          "de datos. El flujo lo lee de ahí y sigue solo.",
      );
    }

    // Las filas mandan sobre el mensaje: el aviso de un intento anterior puede
    // seguir en pantalla aunque el reintento ya haya traído resultados.
    //
    // `sinDatos` distingue dos situaciones que producen la misma lista vacia:
    // que el portal diga que no hay nada, o que la tabla no se haya podido
    // leer. La primera es un resultado; la segunda es una falla silenciosa.
    if (filasEnPantalla === 0) {
      const loDice = (await page.locator(COMPROBANTES.mensajeSinResultados).count()) > 0;
      log(
        loDice
          ? `El portal informa que el período no tiene comprobantes de ese tipo ` +
            `(${MAX_CONSULTAS} consultas).`
          : `La tabla quedó vacía y el portal no dijo que no hubiera datos ` +
            `(${MAX_CONSULTAS} consultas). Verificá el período a mano.`,
      );
      return { periodo: { anio, mes }, filas: [], archivoListado: null, sinDatos: loDice };
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
      sinDatos: false,
    };
  },
);
