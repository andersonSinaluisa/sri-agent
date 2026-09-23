/**
 * Descubre el mapa casillero -> input leyendo el propio formulario.
 *
 * El 104 no numera sus inputs por casillero: los llama `concepto450`,
 * `concepto460`... y publica la correspondencia en el DOM, en una etiqueta
 * con `data-referencia="concepto450.casillero"` cuyo TEXTO es el numero de
 * casillero visible ("401").
 *
 * Por eso el mapa se construye en cada corrida en vez de mantenerse a mano:
 * si el SRI agrega casilleros, cambia la numeracion interna o reordena
 * secciones, esto lo sigue sin tocar codigo. Una tabla fija se desactualiza
 * en silencio, y en una declaracion eso significa escribir un monto en el
 * casillero equivocado.
 */
import { log } from "./runner.mjs";

/**
 * @returns {Promise<Record<string, {selector: string, concepto: string, etiqueta: string|null, oculto: boolean}>>}
 *   indexado por numero de casillero ("401", "411", ...)
 */
export async function mapearCasilleros(page) {
  const encontrados = await page.evaluate(() => {
    const salida = [];
    const etiquetas = document.querySelectorAll('[data-referencia$=".casillero"]');

    for (const etiqueta of etiquetas) {
      const referencia = etiqueta.getAttribute("data-referencia") ?? "";
      const concepto = referencia.replace(/\.casillero$/, "");
      const numero = (etiqueta.textContent ?? "").trim();
      if (concepto === "" || !/^\d+$/.test(numero)) continue;

      const campo = document.getElementById(concepto);
      if (campo === null) continue;

      // La celda de la fila dice si la seccion esta oculta para este
      // contribuyente (no aplica su actividad, o el periodo no la habilita).
      const celda = campo.closest("[data-oculto]");
      const oculto =
        celda?.getAttribute("data-oculto") === "true" ||
        campo.offsetParent === null;

      // El texto descriptivo de la fila: la primera etiqueta de la misma
      // fila del grid, que es la que describe el concepto.
      const fila = campo.closest("[class*='f1-fila-']");
      const clases = [...(fila?.classList ?? [])].find((c) => c.startsWith("f1-fila-"));
      let descripcion = null;
      if (clases !== undefined) {
        const primera = document.querySelector(`.${clases} label[data-referencia^="etiqueta_"]`);
        descripcion = (primera?.textContent ?? "").trim() || null;
      }

      salida.push({
        casillero: numero,
        concepto,
        etiqueta: descripcion,
        oculto,
        tipo: campo.tagName.toLowerCase(),
      });
    }
    return salida;
  });

  const mapa = {};
  const duplicados = [];
  for (const item of encontrados) {
    if (mapa[item.casillero] !== undefined) {
      duplicados.push(item.casillero);
      continue;
    }
    mapa[item.casillero] = {
      // Por id directo: `concepto450` no lleva dos puntos, asi que no hace
      // falta selector de atributo.
      selector: `#${item.concepto}`,
      concepto: item.concepto,
      etiqueta: item.etiqueta,
      oculto: item.oculto,
      tipo: item.tipo,
    };
  }

  if (duplicados.length > 0) {
    log(`AVISO: casilleros repetidos en el DOM: ${duplicados.join(", ")}`);
  }
  log(`Casilleros descubiertos: ${Object.keys(mapa).length}`);
  return mapa;
}

/** Los casilleros visibles, que son los que este contribuyente puede llenar. */
export function casillerosVisibles(mapa) {
  return Object.fromEntries(Object.entries(mapa).filter(([, v]) => !v.oculto));
}
