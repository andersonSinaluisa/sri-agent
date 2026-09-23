import { log } from "./runner.mjs";
import {
  aCentavos,
  clicComoPersona,
  deCentavos,
  exigirPantalla,
  exigirSinCaptcha,
} from "./portal.mjs";
import { elegirOpcion, escribirPeriodo, esperarAjax } from "./primefaces.mjs";
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

  const pasoPrevio = await pasoResaltado(page);
  const avanzo = await avanzarPaso(page, DECLARACION_104.botonSiguientePeriodo, pasoPrevio);

  const pasoActual = await pasoResaltado(page);
  log(`Paso actual tras elegir el período: ${pasoActual}`);

  if (!avanzo) {
    // El captcha primero: si es eso, el resto del diagnóstico sobra y manda a
    // buscar el problema en el período, que no tiene nada que ver.
    await exigirSinCaptcha(page, "el paso 1 del Formulario 104");

    // El paso 1 se queda quieto sin decir nada cuando el período no está
    // disponible para declarar: ya presentado, fuera del rango de la
    // obligación, o todavía no habilitado. Se mira la pantalla y se informa,
    // en vez de dejar que falle más adelante con un error que no orienta.
    const mensajes = await leerMensajes(page);
    const dichos = [...mensajes.errores, ...mensajes.advertencias];
    const rango = await rangoDeLaObligacion(page);
    const anteriores = await declaracionesAnteriores(page);

    throw new Error(
      `El portal no avanzó del paso "${pasoActual}" con obligación "${texto}" y ` +
        `período ${String(periodo.mes).padStart(2, "0")}/${periodo.anio}. ` +
        (dichos.length > 0
          ? `La pantalla dice: ${dichos.join(" | ")}. `
          : "La pantalla no muestra ningún mensaje. ") +
        (rango !== null ? `La obligación rige ${rango}. ` : "") +
        (anteriores !== null
          ? `El período ya tiene declaraciones presentadas: ${anteriores} — ` +
            "lo que corresponde entonces es una sustitutiva, que este flujo no maneja. "
          : "") +
        "Probá con un período no declarado, o abrí el formulario a mano para ver qué ofrece.",
    );
  }

  return { pasoActual, url: page.url() };
}

/**
 * Hace clic en un botón de avance y espera a que el paso CAMBIE de verdad.
 *
 * No alcanza con esperar el AJAX: el portal responde igual cuando acepta el
 * avance y cuando lo rechaza en silencio, así que lo único que distingue un
 * caso del otro es el paso resaltado. Y el clic va con movimiento de puntero
 * porque este formulario, como la consulta de comprobantes, ignora un clic
 * instantáneo en el centro exacto del botón.
 */
async function avanzarPaso(page, selector, pasoPrevio, intentos = 2) {
  for (let intento = 1; intento <= intentos; intento += 1) {
    if (intento > 1) log(`El paso no cambió; reintento ${intento} de ${intentos}.`);

    try {
      await clicComoPersona(page, selector);
    } catch (error) {
      // Si el control ya no está, lo más probable es que el clic anterior sí
      // funcionara y el portal haya repintado: se comprueba antes de darlo
      // por fallado.
      if ((await pasoResaltado(page)) !== pasoPrevio) return true;
      throw error;
    }
    await esperarAjax(page);

    // Hasta 15 s mirando si el paso resaltado cambió.
    for (let espera = 0; espera < 30; espera += 1) {
      if ((await pasoResaltado(page)) !== pasoPrevio) return true;
      await page.waitForTimeout(500);
    }
  }
  return false;
}

/** El rango de fechas que el portal muestra para la obligación elegida. */
async function rangoDeLaObligacion(page) {
  const leer = async (selector) =>
    (await page.locator(selector).count()) > 0
      ? (await page.locator(selector).innerText()).replace(/\s+/g, " ").trim()
      : "";

  const desde = await leer(DECLARACION_104.obligacionFechaInicio);
  const hasta = await leer(DECLARACION_104.obligacionFechaFin);
  if (desde === "" && hasta === "") return null;
  return `desde ${desde || "?"} hasta ${hasta || "sin fecha de fin"}`;
}

/** Qué declaraciones ya presentadas muestra el portal para este período. */
async function declaracionesAnteriores(page) {
  const panel = page.locator(DECLARACION_104.declaracionesAnteriores);
  if ((await panel.count()) === 0) return null;
  const texto = (await panel.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  return texto === "" ? null : texto.slice(0, 200);
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

/** Para comparar "1200.00" con "1.200,00" sin que el formato moleste. */
function normalizarNumero(texto) {
  const limpio = String(texto ?? "").trim();
  if (limpio === "") return "";
  return String(aCentavos(limpio));
}

/**
 * Cuántos decimales usa un casillero, leídos de lo que el propio campo
 * muestra. El 104 mezcla tres tipos de campo y no lo declara en ningún lado:
 *
 *   "0"       conteo de comprobantes (111, 113, 115, 117, 119, 486)
 *   "0.00"    importes
 *   "0.0000"  el factor de proporcionalidad (563), que no es dinero
 */
export function decimalesDe(valorActual) {
  const coincidencia = String(valorActual ?? "").match(/[.,](\d+)\s*$/);
  return coincidencia === null ? 0 : coincidencia[1].length;
}

/**
 * Da el texto a escribir en un casillero, según el tipo de campo que sea.
 *
 * No todos los casilleros son dinero, y tratarlos a todos como centavos
 * escribía "0.42" donde iban 42 comprobantes. Cuando el campo no lleva
 * decimales, el número es una CANTIDAD y se escribe tal cual.
 */
export function formatearCasillero(casillero, valor, valorActual) {
  if (!Number.isInteger(valor)) {
    throw new Error(`El casillero ${casillero} recibió ${valor}, que no es un entero.`);
  }

  const decimales = decimalesDe(valorActual);

  if (decimales === 2) return { valor: deCentavos(valor), tipo: "importe" };

  if (decimales === 0) {
    if (valor < 0) {
      throw new Error(`El casillero ${casillero} es un conteo y no admite ${valor}.`);
    }
    return { valor: String(valor), tipo: "conteo" };
  }

  // El factor de proporcionalidad y cualquier otro campo con otra precisión:
  // no son importes, no hay contrato para escribirlos y el portal los
  // calcula. Antes que inventar una conversión, se corta.
  throw new Error(
    `El casillero ${casillero} usa ${decimales} decimales (muestra "${valorActual}"), ` +
      "así que no es un importe en centavos. Este flujo no lo escribe.",
  );
}

/**
 * Escribe un número tecleándolo, no asignándolo.
 *
 * Los campos del 104 son widgets que mantienen su propio estado y postean un
 * input oculto. `page.fill()` asigna el valor visible y dispara un `input`,
 * pero el widget puede no enterarse: el formulario se ve correcto en la
 * captura y la declaración se presenta en ceros. Tecleando pasa por el mismo
 * camino que una persona.
 */
async function escribirNumero(page, selector, valor) {
  const campo = page.locator(selector);
  await campo.click();
  await campo.press("Control+a").catch(() => {});
  await campo.press("Delete").catch(() => {});
  await campo.pressSequentially(valor, { delay: 15 });
  // `blur` es lo que dispara la validación y el recálculo del portal.
  await campo.press("Tab").catch(() => {});
  await esperarAjax(page);
}

/**
 * Escribe los casilleros en el formulario ya abierto en el paso 3.
 * NO presenta nada.
 *
 * @param {Record<string, number>} casilleros  numero de casillero -> centavos
 *   (o la cantidad, en los casilleros de conteo, que no llevan decimales)
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

    const campo = page.locator(destino.selector);
    if ((await campo.count()) === 0) {
      throw new Error(
        `El casillero ${casillero} (${destino.etiqueta ?? "sin descripción"}) no tiene ` +
          `un campo escribible en ${destino.selector}.`,
      );
    }

    // Los casilleros que calcula el portal vienen de solo lectura. Escribir
    // uno de esos no da error: el valor simplemente no queda, y la
    // declaración sale con lo que el portal haya calculado.
    if (!(await campo.isEditable().catch(() => false))) {
      throw new Error(
        `El casillero ${casillero} (${destino.etiqueta ?? "sin descripción"}) es de solo ` +
          "lectura: lo calcula el portal a partir de los demás. No se escribe.",
      );
    }

    const { valor, tipo } = formatearCasillero(casillero, centavos, await campo.inputValue());
    await escribirNumero(page, destino.selector, valor);

    // Se relee SIEMPRE. Es el único control que detecta que un widget
    // ignoró la escritura, que es como una declaración sale en ceros sin
    // que nada avise.
    const quedo = await campo.inputValue();
    if (normalizarNumero(quedo) !== normalizarNumero(valor)) {
      // Un casillero que no toma el valor puede ser el widget… o el portal
      // rechazando la interacción entera.
      await exigirSinCaptcha(page, `el casillero ${casillero} del Formulario 104`);
      throw new Error(
        `El casillero ${casillero} (${destino.etiqueta ?? "sin descripción"}) quedó en ` +
          `"${quedo}" y se pidió "${valor}". No se sigue llenando: una declaración con ` +
          "un casillero que no tomó el valor sale mal y se presenta igual.",
      );
    }

    escritos.push({
      casillero,
      valor,
      tipo,
      selector: destino.selector,
      etiqueta: destino.etiqueta,
    });
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

  // Igual que en el paso 1: se confirma que el paso resaltado CAMBIÓ. Este
  // salto repinta el formulario entero y es de los que más tardan, así que
  // sin esa confirmación se lee la pantalla anterior y el error apunta al
  // lado equivocado.
  const pasoPrevio = await pasoResaltado(page);
  const avanzo = await avanzarPaso(page, DECLARACION_104.enlaceFormularioCompletoDesdePreguntas, pasoPrevio);

  if (!avanzo) await exigirSinCaptcha(page, "el paso 2 del Formulario 104");

  log(`Paso tras saltar el cuestionario: ${await pasoResaltado(page)}`);
  return avanzo;
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
