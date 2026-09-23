import { log } from "./runner.mjs";
import { aCentavos, deCentavos, exigirPantalla } from "./portal.mjs";
import { elegirOpcion, escribirPeriodo } from "./primefaces.mjs";
import { casillerosVisibles, mapearCasilleros } from "./casilleros.mjs";
import { DECLARACION_104, URLS } from "./selectores.mjs";

const MESES = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
];

/**
 * Paso 1: elegir obligación y período fiscal. Deja la pantalla en el paso 2.
 */
export async function abrirPeriodo(page, periodo, periodicidad = "mensual") {
  await page.goto(URLS.declaracionIva, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector(DECLARACION_104.formulario, { timeout: 30_000 }).catch(() => {});
  await exigirPantalla(page, DECLARACION_104.formulario, "declaración de IVA");

  const texto =
    periodicidad === "semestral"
      ? DECLARACION_104.textoObligacionSemestral
      : DECLARACION_104.textoObligacionMensual;
  await elegirOpcion(page, DECLARACION_104.selectObligacion, texto);

  await escribirPeriodo(
    page,
    DECLARACION_104.campoPeriodo,
    `${String(periodo.mes).padStart(2, "0")}/${periodo.anio}`,
  );

  await page.click(DECLARACION_104.botonSiguientePeriodo);
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

  const pasoActual = await pasoResaltado(page);
  log(`Paso actual tras elegir el período: ${pasoActual}`);
  return { pasoActual, url: page.url() };
}

/** Cuál de los cuatro pasos está resaltado. */
export async function pasoResaltado(page) {
  const pasos = page.locator(DECLARACION_104.pasos);
  const cantidad = await pasos.count();
  for (let i = 0; i < cantidad; i++) {
    const clases = (await pasos.nth(i).getAttribute("class")) ?? "";
    if (clases.includes("ui-state-highlight")) {
      return (await pasos.nth(i).innerText()).replace(/\s+/g, " ").trim();
    }
  }
  return "desconocido";
}

/**
 * Comprueba que la cabecera del formulario coincide con lo que se pidió.
 *
 * Es el control más importante de todo el flujo: escribir los montos de un
 * mes en la declaración de otro no da ningún error, se presenta sin problema
 * y solo se descubre cuando llega la diferencia.
 */
export async function verificarCabecera(page, { ruc, periodo }) {
  const leer = async (selector) =>
    (await page.locator(selector).count()) > 0
      ? (await page.locator(selector).innerText()).replace(/\s+/g, " ").trim()
      : null;

  const cabecera = {
    ruc: await leer(DECLARACION_104.cabeceraRuc),
    razonSocial: await leer(DECLARACION_104.cabeceraRazonSocial),
    periodo: await leer(DECLARACION_104.cabeceraPeriodo),
    tipoDeclaracion: await leer(DECLARACION_104.cabeceraTipoDeclaracion),
  };

  if (cabecera.ruc !== null && cabecera.ruc !== ruc) {
    throw new Error(`La declaración abierta es del RUC ${cabecera.ruc} y se pidió ${ruc}.`);
  }

  const esperado = `${MESES[periodo.mes - 1]} ${periodo.anio}`;
  if (cabecera.periodo !== null && cabecera.periodo.toUpperCase() !== esperado) {
    throw new Error(
      `La declaración abierta es de "${cabecera.periodo}" y se pidió "${esperado}". ` +
        "No se escribe nada.",
    );
  }

  log(`Cabecera verificada: ${cabecera.periodo} · ${cabecera.tipoDeclaracion}`);
  return cabecera;
}

/** Abre todas las secciones plegadas del formulario. */
export async function abrirFormularioCompleto(page) {
  const enlace = page.locator(DECLARACION_104.enlaceVerFormularioCompleto);
  if ((await enlace.count()) === 0) return false;

  await enlace.click();
  const dialogo = page.locator(DECLARACION_104.dialogoFormularioCompleto).last();
  await dialogo
    .getByRole("button", { name: DECLARACION_104.textoAceptarDialogo })
    .click({ timeout: 15_000 })
    .catch(async () => {
      // Respaldo por si el diálogo no expone el rol esperado.
      await page.getByText(DECLARACION_104.textoAceptarDialogo, { exact: true }).last().click();
    });

  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  log("Formulario completo desplegado.");
  return true;
}

/** Mensajes de error y advertencia que muestra el propio formulario. */
export async function leerMensajes(page) {
  const textos = async (selector) =>
    (await page.locator(`${selector} li`).allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  return {
    errores: await textos(DECLARACION_104.listaErrores),
    advertencias: await textos(DECLARACION_104.listaAdvertencias),
  };
}

/**
 * Escribe los casilleros en el formulario ya abierto en el paso 3.
 * NO presenta nada.
 *
 * @param {Record<string, number>} casilleros  numero de casillero -> centavos
 */
export async function escribirCasilleros(page, casilleros) {
  await abrirFormularioCompleto(page);

  const mapa = await mapearCasilleros(page);
  const visibles = casillerosVisibles(mapa);

  const escritos = [];
  for (const [casillero, centavos] of Object.entries(casilleros)) {
    const destino = mapa[casillero];
    if (destino === undefined) {
      throw new Error(
        `El formulario no tiene el casillero ${casillero}. ` +
          `Disponibles y visibles: ${Object.keys(visibles).join(", ")}`,
      );
    }
    if (destino.oculto) {
      throw new Error(
        `El casillero ${casillero} está oculto en esta declaración ` +
          `(${destino.etiqueta ?? "sin descripción"}): no aplica a este contribuyente o período.`,
      );
    }

    const valor = deCentavos(centavos);
    await page.fill(destino.selector, valor);
    escritos.push({ casillero, valor, selector: destino.selector, etiqueta: destino.etiqueta });
  }

  log(`Casilleros escritos: ${escritos.length}`);
  return { escritos, casillerosDisponibles: Object.keys(visibles) };
}

/** Relee del DOM lo que quedó escrito, para contrastarlo con lo aprobado. */
export async function leerCasilleros(page) {
  const mapa = await mapearCasilleros(page);
  const leidos = {};
  for (const [casillero, destino] of Object.entries(mapa)) {
    if (destino.oculto) continue;
    if ((await page.locator(destino.selector).count()) > 0) {
      leidos[casillero] = await page.inputValue(destino.selector);
    }
  }
  return leidos;
}

/**
 * Lee el resumen que calcula el portal: impuesto, interes, multa y total.
 * Se devuelve en centavos para poder contrastarlo con nuestro calculo.
 */
export async function leerResumen(page) {
  const texto = async (selector) =>
    (await page.locator(selector).count()) > 0
      ? (await page.locator(selector).innerText()).trim()
      : null;
  const valor = async (selector) =>
    (await page.locator(selector).count()) > 0
      ? (await page.locator(selector).inputValue()).trim()
      : null;

  const total = await texto(DECLARACION_104.resumenTotalAPagar);
  const interes = await valor(DECLARACION_104.resumenInteres);
  const multa = await valor(DECLARACION_104.resumenMulta);

  return {
    totalAPagarCentavos: total === null ? null : aCentavos(total),
    interesCentavos: interes === null ? null : aCentavos(interes),
    multaCentavos: multa === null ? null : aCentavos(multa),
    textoTotal: total,
  };
}

/**
 * Reconoce la confirmacion de que la declaracion quedo presentada.
 *
 * Por TEXTO y no por clase CSS: el portal pinta este mensaje de exito con
 * `ui-messages-fatal`, la misma clase que usa para los errores. Mirar la
 * clase haria leer una presentacion exitosa como un fallo, y al reves.
 */
export async function declaracionPresentada(page) {
  const panel = page.locator(DECLARACION_104.panelMensajePrincipal);
  if ((await panel.count()) === 0) return false;
  const texto = await panel.innerText();
  return texto.includes(DECLARACION_104.textoDeclaracionPresentada);
}

/**
 * Paso 2: lee el cuestionario de perfilamiento tal como esta respondido.
 * Devuelve {codigo: {pregunta, respuesta}} con los ids estables (P006, P018...).
 */
export async function leerPreguntas(page) {
  return page.evaluate(() => {
    const salida = {};
    const bloques = document.querySelectorAll("[id^='P'][class*='respuestas-perfilamiento']");
    for (const bloque of bloques) {
      const codigo = bloque.id;
      if (!/^P\d+$/.test(codigo)) continue;
      const texto = bloque.querySelector("[id$=':oTxtdetallePregunta']");
      const marcado = bloque.querySelector("input[type='radio']:checked");
      salida[codigo] = {
        pregunta: (texto?.textContent ?? "").replace(/\s+/g, " ").trim(),
        respuesta: marcado?.getAttribute("value") ?? null,
      };
    }
    return salida;
  });
}

/**
 * Responde preguntas del perfilamiento por su codigo estable.
 *
 * @param {Record<string, "SI"|"NO">} respuestas  p. ej. { P018: "SI", P026: "SI" }
 */
export async function responderPreguntas(page, respuestas) {
  const aplicadas = [];
  for (const [codigo, valor] of Object.entries(respuestas)) {
    if (valor !== "SI" && valor !== "NO") {
      throw new Error(`Respuesta invalida para ${codigo}: "${valor}". Solo SI o NO.`);
    }
    const bloque = page.locator(DECLARACION_104.preguntaPorId(codigo));
    if ((await bloque.count()) === 0) {
      throw new Error(
        `El cuestionario no tiene la pregunta ${codigo} en este periodo. ` +
          "Lee las disponibles con leerPreguntas antes de responder.",
      );
    }
    const radio = bloque.locator(
      valor === "SI" ? DECLARACION_104.radioSi : DECLARACION_104.radioNo,
    );
    // El radio real esta oculto tras el widget de PrimeFaces; se marca con
    // force y se dispara el change que el portal escucha.
    await radio.first().check({ force: true });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    aplicadas.push({ codigo, valor });
    log(`${codigo} -> ${valor}`);
  }
  return aplicadas;
}

/**
 * Salta el cuestionario y abre el formulario con TODAS las secciones.
 *
 * Es el camino por defecto a proposito: responder "no" a una pregunta oculta
 * la seccion correspondiente, y con ella casilleros que quiza haya que
 * llenar. Con el formulario completo se ve todo y el mapeo no depende de
 * haber acertado las respuestas.
 */
export async function saltarAFormularioCompleto(page) {
  const enlace = page.locator(DECLARACION_104.enlaceFormularioCompletoDesdePreguntas);
  if ((await enlace.count()) === 0) return false;
  await enlace.click();
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  log(`Paso tras saltar el cuestionario: ${await pasoResaltado(page)}`);
  return true;
}

/** Flujo completo hasta el formulario lleno, sin presentar. */
export async function llenarFormulario104(page, periodo, casilleros, opciones = {}) {
  const { periodicidad = "mensual", ruc } = opciones;

  const { respuestas } = opciones;

  await abrirPeriodo(page, periodo, periodicidad);

  // Paso 2: si se pidieron respuestas concretas se aplican; si no, se salta
  // al formulario completo, que muestra todas las secciones.
  let paso = await pasoResaltado(page);
  if (paso.includes("Preguntas")) {
    if (respuestas !== undefined) await responderPreguntas(page, respuestas);
    await saltarAFormularioCompleto(page);
    paso = await pasoResaltado(page);
  }

  if (!paso.includes("Formulario")) {
    throw new Error(
      `Se llegó al paso "${paso}" y no se pudo avanzar al formulario. ` +
        "Usá sri_inspeccionar_pantalla en esta URL para ver qué hay.",
    );
  }

  if (ruc !== undefined) await verificarCabecera(page, { ruc, periodo });

  const { escritos } = await escribirCasilleros(page, casilleros);
  const mensajes = await leerMensajes(page);

  return { escritos, mensajes, resumen: null };
}
