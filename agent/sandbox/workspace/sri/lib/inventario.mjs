/**
 * Inventario de una pantalla, pensado para que el modelo pueda proponer un
 * selector sin ver la página.
 *
 * Se devuelve poco y elegido: el HTML completo de una pantalla del SRI son
 * cientos de KB de menú que no caben en el contexto y tampoco hacen falta.
 */

/** Controles de formulario visibles, con los atributos que sirven de ancla. */
export async function inventariarControles(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    const describir = (el) => {
      const etiqueta = el.id
        ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText?.trim()
        : null;
      return {
        etiqueta: el.tagName.toLowerCase(),
        tipo: el.getAttribute("type"),
        id: el.id || null,
        name: el.getAttribute("name"),
        placeholder: el.getAttribute("placeholder"),
        ariaLabel: el.getAttribute("aria-label"),
        texto: (el.innerText || el.value || "").trim().slice(0, 60) || null,
        etiquetaAsociada: etiqueta || null,
        // Cuántas opciones tiene un select: distingue un desplegable ya
        // poblado de uno que el JS todavía no lleno.
        opciones: el.tagName === "SELECT" ? el.options.length : undefined,
      };
    };

    return [...document.querySelectorAll("input, button, select, textarea")]
      .filter(visible)
      .slice(0, 50)
      .map(describir)
      .filter((d) => d.id || d.name || d.texto || d.ariaLabel);
  });
}

/**
 * Árbol de accesibilidad del área principal, sin las lineas de menú.
 * Es como se direccionan los elementos con getByRole, que es el selector
 * preferido: sobrevive a cambios de id y de clases.
 */
export async function arbolPrincipal(page, maxLineas = 60) {
  const raiz =
    (await page.locator("main").count()) > 0 ? page.locator("main").first() : page.locator("body");
  const arbol = await raiz.ariaSnapshot({ timeout: 15_000 }).catch(() => "");
  return arbol
    .split("\n")
    .filter((linea) => !/- (link|listitem|list):?$/.test(linea.trim()))
    .slice(0, maxLineas)
    .join("\n");
}

/** Cuenta cuántos elementos resuelve un selector candidato. */
export async function contarCoincidencias(page, selector) {
  try {
    const cantidad = await page.locator(selector).count();
    const primero =
      cantidad > 0
        ? await page
            .locator(selector)
            .first()
            .evaluate((el) => ({
              etiqueta: el.tagName.toLowerCase(),
              id: el.id || null,
              texto: (el.innerText || el.value || "").trim().slice(0, 60) || null,
            }))
            .catch(() => null)
        : null;
    return { selector, valido: true, cantidad, primero };
  } catch (error) {
    // Un selector mal escrito (p. ej. un id de JSF sin escapar) falla acá,
    // no en el paso que lo usa.
    return {
      selector,
      valido: false,
      cantidad: 0,
      primero: null,
      error: error instanceof Error ? error.message.split("\n")[0] : String(error),
    };
  }
}
