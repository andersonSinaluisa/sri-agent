import { log } from "./runner.mjs";
import { deCentavos } from "./portal.mjs";
import { DECLARACION_104, URLS } from "./selectores.mjs";

/**
 * Abre el Formulario 104 del período y escribe los casilleros.
 * NO presenta nada: deja el formulario listo y validado en pantalla.
 *
 * @param {import("playwright").Page} page
 * @param {{anio: number, mes: number}} periodo
 * @param {Record<string, number>} casilleros  casillero -> centavos enteros
 */
export async function llenarFormulario104(page, periodo, casilleros) {
  await page.goto(URLS.declaracionIva, { waitUntil: "domcontentloaded" });
  await page.click(DECLARACION_104.enlaceNuevaDeclaracion);
  await page.selectOption(DECLARACION_104.selectPeriodoAnio, String(periodo.anio));
  await page.selectOption(DECLARACION_104.selectPeriodoMes, String(periodo.mes));
  await page.click(DECLARACION_104.botonContinuar);

  const escritos = [];
  for (const [casillero, centavos] of Object.entries(casilleros)) {
    const selector = DECLARACION_104.casilleros[casillero];
    if (selector === undefined) {
      throw new Error(
        `El casillero ${casillero} no está mapeado en selectores.mjs (DECLARACION_104.casilleros).`,
      );
    }
    const valor = deCentavos(centavos);
    await page.fill(selector, valor);
    escritos.push({ casillero, valor });
  }
  log(`Casilleros escritos: ${escritos.length}`);

  await page.click(DECLARACION_104.botonValidar);
  await page.waitForSelector(DECLARACION_104.resumenLiquidacion).catch(() => {});

  const resumen = (await page.locator(DECLARACION_104.resumenLiquidacion).count())
    ? (await page.locator(DECLARACION_104.resumenLiquidacion).innerText()).trim()
    : null;

  return { escritos, resumen };
}

/**
 * Relee del DOM lo que quedó escrito, para poder contrastarlo contra lo que
 * el agente creía estar enviando. Detecta reformateos y campos calculados
 * por el propio portal.
 */
export async function leerCasilleros(page) {
  const leidos = {};
  for (const [casillero, selector] of Object.entries(DECLARACION_104.casilleros)) {
    if (await page.locator(selector).count()) {
      leidos[casillero] = await page.inputValue(selector);
    }
  }
  return leidos;
}
