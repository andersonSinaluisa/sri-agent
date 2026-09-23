/**
 * Helpers para los widgets de PrimeFaces del portal del SRI.
 *
 * El formulario de declaraciones no son controles HTML normales: PrimeFaces
 * esconde el <select> real en un div `ui-helper-hidden-accessible` y pinta
 * encima un widget propio. Escribir en el input tampoco sirve, porque el
 * calendario tiene `onkeypress="return false"`.
 */
import { log } from "./runner.mjs";

/** Escapa un id de JSF para usarlo en un selector de atributo. */
export function porId(id) {
  return `[id="${id}"]`;
}

/**
 * Elige una opción de un PrimeFaces SelectOneMenu por su TEXTO.
 *
 * Por texto y no por value a propósito: el portal emite values como
 * `class ec.gob.sri.adm.catalogo.modelo.ObligacionTributaria@33`, que es el
 * hash de un objeto Java. Cambia entre despliegues y entre reinicios del
 * servidor; el texto visible, no.
 *
 * @param {import("playwright").Page} page
 * @param {string} idBase  id del contenedor, p. ej. "frmFlujoDeclaracion:somObligacion"
 * @param {string|RegExp} texto  texto de la opción, o parte de él
 */
export async function elegirOpcion(page, idBase, texto) {
  const contenedor = page.locator(porId(idBase));
  await contenedor.waitFor({ state: "visible", timeout: 20_000 });

  await contenedor.locator(".ui-selectonemenu-trigger").click();

  // PrimeFaces monta el panel de opciones fuera del contenedor, al final del
  // body, con el id que declara aria-owns.
  const opciones = page.locator(porId(`${idBase}_items`));
  await opciones.waitFor({ state: "visible", timeout: 10_000 });

  const opcion = opciones.locator("li").filter({ hasText: texto }).first();
  const cuantas = await opciones.locator("li").filter({ hasText: texto }).count();
  if (cuantas === 0) {
    const disponibles = await opciones.locator("li").allInnerTexts();
    throw new Error(
      `No hay ninguna opción que contenga ${texto} en ${idBase}. ` +
        `Disponibles: ${JSON.stringify(disponibles)}`,
    );
  }

  const elegido = (await opcion.innerText()).trim();
  await opcion.click();
  log(`${idBase}: elegido "${elegido}"`);

  // El widget dispara un AJAX de PrimeFaces que repinta media pantalla.
  await esperarAjax(page);
  return elegido;
}

/**
 * Escribe el período en un PrimeFaces Calendar de tipo mes/año.
 *
 * El input bloquea el teclado (`onkeypress="return false"`), así que se fija
 * el valor y se dispara el `change` que el portal ya tiene enganchado: es el
 * mismo evento que produce el datepicker al elegir con el mouse.
 *
 * SIN VERIFICAR contra el widget real. Si falla, la alternativa es abrir el
 * datepicker y hacer clic en el mes; inspeccioná la pantalla para ver su DOM.
 */
export async function escribirPeriodo(page, idCampo, mmYYYY) {
  if (!/^\d{2}\/\d{4}$/.test(mmYYYY)) {
    throw new Error(`El período debe tener formato mm/yyyy; llegó "${mmYYYY}".`);
  }

  const campo = page.locator(porId(idCampo));
  await campo.waitFor({ state: "visible", timeout: 20_000 });

  await campo.evaluate((el, valor) => {
    el.value = valor;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, mmYYYY);

  log(`${idCampo}: período ${mmYYYY}`);
  await esperarAjax(page);

  const quedo = await campo.inputValue();
  if (quedo !== mmYYYY) {
    throw new Error(
      `El período no quedó fijado: el campo muestra "${quedo}" y se pidió "${mmYYYY}". ` +
        "Probablemente haya que manejar el datepicker en vez de fijar el valor.",
    );
  }
}

/**
 * El diálogo "Espere por favor" que el portal muestra mientras procesa.
 *
 * Es la señal más confiable de que hay trabajo en curso, porque la pone el
 * propio portal. Su id es generado por JSF (`j_idt324`) y cambia con
 * cualquier recompilación, así que se lo busca por la clase que le da el
 * tema: `ajax-style` sobre un `ui-dialog`.
 */
const DIALOGO_CARGANDO = ".ui-dialog.ajax-style";

/**
 * Espera a que terminen las peticiones AJAX de PrimeFaces.
 *
 * El portal repinta por AJAX en casi cada interacción; sin esperar se lee el
 * DOM viejo y el paso siguiente falla con un error que no dice nada.
 *
 * Se espera por TRES señales, porque ninguna alcanza sola:
 *
 *  - El diálogo "Espere por favor". Es la que de verdad manda: se vio al
 *    portal con la petición en vuelo y el spinner encima mientras las otras
 *    dos ya daban vía libre.
 *  - La cola de PrimeFaces, que sólo guarda las peticiones ENCOLADAS: la que
 *    está en vuelo ya salió de ahí, así que da "listo" demasiado pronto.
 *  - `networkidle`, que en este portal se alcanza con conexiones de fondo
 *    todavía abiertas.
 */
export async function esperarAjax(page) {
  // Un respiro para que el diálogo alcance a aparecer: comprobar que no está
  // justo después del clic siempre daría "no hay nada esperando".
  await page.waitForTimeout(300);

  await page
    .waitForFunction(
      (selector) =>
        [...document.querySelectorAll(selector)].every((dialogo) => {
          const estilo = getComputedStyle(dialogo);
          return (
            estilo.display === "none" ||
            estilo.visibility === "hidden" ||
            /** @type {HTMLElement} */ (dialogo).offsetParent === null
          );
        }),
      DIALOGO_CARGANDO,
      { timeout: 90_000 },
    )
    .catch(() => {});

  await page
    .waitForFunction(
      () => {
        const pf = /** @type {any} */ (window).PrimeFaces;
        // Si PrimeFaces no está cargado todavía, no hay nada que esperar.
        return pf === undefined || (pf.ajax?.Queue?.requests?.length ?? 0) === 0;
      },
      undefined,
      { timeout: 30_000 },
    )
    .catch(() => {});

  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
}
