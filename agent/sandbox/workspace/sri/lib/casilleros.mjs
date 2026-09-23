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
    // ── La grilla del 104 ───────────────────────────────────────────────────
    //
    // El formulario es una MATRIZ, no una lista: cada fila es un concepto y
    // las columnas son VALOR BRUTO, VALOR NETO e IMPUESTO GENERADO. Por eso
    // 401, 411 y 421 no son tres tarifas distintas —como parecería mirando
    // solo los numeros— sino el mismo concepto en tres columnas. Sin esto,
    // el monto de una venta termina en la columna del impuesto.
    //
    // Las celdas llevan su posicion en el estilo (`-ms-grid-row` y
    // `grid-column`), asi que la matriz se reconstruye de ahi.
    const enteroDeEstilo = (elemento, propiedad) => {
      const crudo = elemento.style.getPropertyValue(propiedad);
      const numero = Number.parseInt(crudo, 10);
      return Number.isNaN(numero) ? null : numero;
    };

    /** @type {Map<number, Map<number, {texto: string|null, casillero: string|null, concepto: string|null}>>} */
    const grilla = new Map();

    for (const celda of document.querySelectorAll('div[style*="grid-column"]')) {
      const fila = enteroDeEstilo(celda, "-ms-grid-row");
      const columna =
        enteroDeEstilo(celda, "-ms-grid-column") ??
        Number.parseInt(celda.style.gridColumn, 10);
      if (fila === null || Number.isNaN(columna)) continue;

      const rotulo = celda.querySelector("label[data-referencia]");
      const referencia = rotulo?.getAttribute("data-referencia") ?? "";
      const texto = (rotulo?.textContent ?? "").replace(/\s+/g, " ").trim();
      const campo = celda.querySelector('[id^="concepto"]');

      if (!grilla.has(fila)) grilla.set(fila, new Map());
      grilla.get(fila).set(columna, {
        texto: texto === "" ? null : texto,
        casillero: referencia.endsWith(".casillero") ? texto : null,
        concepto: campo?.id ?? null,
      });
    }

    /** Una fila con casilleros o campos es de datos; el resto, de rotulos. */
    const esDatos = (fila) =>
      [...(grilla.get(fila)?.values() ?? [])].some((c) => c.casillero || c.concepto);

    /** Un titulo de seccion: mayusculas, en la primera columna, sin datos. */
    const esSeccion = (fila) => {
      if (esDatos(fila)) return false;
      const primera = grilla.get(fila)?.get(1);
      const texto = primera?.texto ?? "";
      return texto.length > 12 && texto !== "." && texto === texto.toUpperCase();
    };

    const filaDeSeccion = (fila) => {
      for (let f = fila; f > 0; f -= 1) if (esSeccion(f)) return f;
      return 1;
    };

    /**
     * El encabezado de una columna: los rotulos que hay sobre ella dentro de
     * la MISMA seccion. Buscar mas arriba traeria el encabezado de la seccion
     * anterior, que describe otra cosa.
     */
    const encabezadoDeColumna = (fila, columna) => {
      const tope = filaDeSeccion(fila);
      const partes = [];
      for (let f = tope; f < fila; f += 1) {
        if (esDatos(f)) continue;
        const celda = grilla.get(f)?.get(columna);
        if (celda?.texto && celda.texto !== ".") partes.push(celda.texto);
      }
      return partes.join(" ") || null;
    };

    /** Fila y columna donde vive un casillero dado. */
    const ubicar = (numero) => {
      for (const [fila, columnas] of grilla) {
        for (const [columna, celda] of columnas) {
          if (celda.casillero === numero) return { fila, columna };
        }
      }
      return null;
    };

    const salida = [];
    const etiquetas = document.querySelectorAll('[data-referencia$=".casillero"]');

    for (const etiqueta of etiquetas) {
      const referencia = etiqueta.getAttribute("data-referencia") ?? "";
      const concepto = referencia.replace(/\.casillero$/, "");
      const numero = (etiqueta.textContent ?? "").trim();
      if (concepto === "" || !/^\d+$/.test(numero)) continue;

      const campo = document.getElementById(concepto);
      if (campo === null) continue;

      // Si el casillero aplica o no a este contribuyente lo dice el portal
      // con `data-oculto` en la fila. Se lee ESO y no la geometria: muchos
      // controles del 104 son widgets de PrimeFaces cuyo elemento con el id
      // del concepto es un contenedor que no ocupa lugar por si mismo, y
      // medirlo daba "oculto" para los 156 casilleros del formulario.
      const celda = campo.closest("[data-oculto]");
      const marca = celda?.getAttribute("data-oculto") ?? null;
      const oculto = marca === "true";

      // La geometria se guarda aparte, como dato de diagnostico: sirve para
      // entender una pantalla rara, no para decidir que se llena.
      const caja = campo.getBoundingClientRect();

      // El input real del widget, cuando el id del concepto cuelga de un
      // contenedor en vez de estar sobre el <input>.
      const interno = campo.querySelector("input, textarea, select");

      // Dónde vive el casillero dentro de la matriz. Con la fila y la columna
      // se sabe QUÉ es: "Ventas locales gravadas tarifa distinta de cero" en
      // la columna "VALOR BRUTO" es el 401; la misma fila en "IMPUESTO
      // GENERADO" es el 421.
      const donde = ubicar(numero);
      const descripcion =
        donde === null ? null : (grilla.get(donde.fila)?.get(1)?.texto ?? null);
      const columna = donde === null ? null : encabezadoDeColumna(donde.fila, donde.columna);
      const seccion =
        donde === null
          ? null
          : (grilla.get(filaDeSeccion(donde.fila))?.get(1)?.texto ?? null);

      salida.push({
        casillero: numero,
        concepto,
        etiqueta: descripcion,
        columna,
        seccion,
        oculto,
        marcaOculto: marca,
        tipo: campo.tagName.toLowerCase(),
        // Diagnostico: con esto se ve de una corrida si el id cuelga de un
        // widget en vez de un <input>, y si ocupa lugar en la pantalla.
        idInterno: interno === null ? null : interno.id || null,
        tipoInterno: interno === null ? null : interno.tagName.toLowerCase(),
        conLugar: caja.width > 0 && caja.height > 0,
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
      // Si el id del concepto cuelga de un widget de PrimeFaces, lo que se
      // escribe es el <input> de adentro, no el contenedor. Por id directo:
      // `concepto450` no lleva dos puntos, asi que no hace falta selector de
      // atributo.
      selector: item.idInterno === null ? `#${item.concepto}` : `#${item.idInterno}`,
      selectorContenedor: `#${item.concepto}`,
      concepto: item.concepto,
      etiqueta: item.etiqueta,
      columna: item.columna,
      seccion: item.seccion,
      oculto: item.oculto,
      tipo: item.tipoInterno ?? item.tipo,
      conLugar: item.conLugar,
    };
  }

  if (duplicados.length > 0) {
    log(`AVISO: casilleros repetidos en el DOM: ${duplicados.join(", ")}`);
  }

  const total = Object.keys(mapa).length;
  const aplicables = Object.values(mapa).filter((v) => !v.oculto).length;
  const sinMarca = encontrados.filter((i) => i.marcaOculto === null).length;

  log(`Casilleros descubiertos: ${total} · aplicables: ${aplicables}`);
  if (sinMarca > 0) {
    // Sin `data-oculto` no hay forma de saber que secciones no aplican, y
    // decidirlo por geometria ya demostro ser incorrecto. Se avisa en vez de
    // filtrar a ciegas.
    log(`AVISO: ${sinMarca} casilleros sin marca data-oculto; se tratan como aplicables.`);
  }
  return mapa;
}

/** Los casilleros visibles, que son los que este contribuyente puede llenar. */
export function casillerosVisibles(mapa) {
  return Object.fromEntries(Object.entries(mapa).filter(([, v]) => !v.oculto));
}

/** "Ventas locales" -> "VENTAS LOCALES", sin tildes, para comparar textos. */
function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Encuentra EL casillero que corresponde a una fila y una columna.
 *
 * Es la forma de escribir el formulario sin numeros magicos: se pide "la
 * fila de ventas locales gravadas, columna VALOR BRUTO" y sale 401. Si el
 * SRI renumera los casilleros entre versiones del formulario —ya lo hizo—,
 * esto sigue encontrandolos; una tabla fija apuntaria al casillero
 * equivocado sin decir nada.
 *
 * Exige UNA coincidencia. Ninguna o varias es un error: escribir en el
 * casillero que no era no produce ningun aviso del portal.
 *
 * @param {Record<string, any>} mapa
 * @param {{fila: string|RegExp, columna?: string|RegExp, seccion?: string|RegExp}} criterio
 */
export function buscarCasillero(mapa, criterio) {
  // Primero se prueba con coincidencia EXACTA y solo si eso no resuelve se
  // afloja a "contiene". El encabezado "VALOR NETO (VALOR BRUTO - N/C)"
  // contiene la cadena "VALOR BRUTO", asi que buscar por subcadena hace
  // coincidir dos columnas distintas: la del valor y la del impuesto.
  const coincide = (valor, patron, exacto) => {
    if (patron === undefined) return true;
    if (valor === null || valor === undefined) return false;
    if (patron instanceof RegExp) return patron.test(valor);
    return exacto
      ? normalizar(valor) === normalizar(patron)
      : normalizar(valor).includes(normalizar(patron));
  };

  const amplios = Object.entries(mapa).filter(
    ([, destino]) =>
      coincide(destino.etiqueta, criterio.fila, false) &&
      coincide(destino.columna, criterio.columna, false) &&
      coincide(destino.seccion, criterio.seccion, false),
  );

  // Si "contiene" trae varios, se afina exigiendo columna exacta: la fila casi
  // nunca se escribe completa, pero el nombre de la columna sí.
  let hallados = amplios;
  if (amplios.length > 1) {
    const porColumna = amplios.filter(([, d]) => coincide(d.columna, criterio.columna, true));
    if (porColumna.length === 1) hallados = porColumna;
  }

  const describir = () =>
    `fila ${JSON.stringify(String(criterio.fila))}` +
    (criterio.columna === undefined ? "" : `, columna ${JSON.stringify(String(criterio.columna))}`) +
    (criterio.seccion === undefined ? "" : `, sección ${JSON.stringify(String(criterio.seccion))}`);

  if (hallados.length === 0) {
    throw new Error(`Ningún casillero coincide con ${describir()}.`);
  }
  if (hallados.length > 1) {
    throw new Error(
      `${hallados.length} casilleros coinciden con ${describir()}: ` +
        `${hallados.map(([n]) => n).join(", ")}. Afiná el criterio; escribir en el ` +
        "casillero equivocado no produce ningún aviso del portal.",
    );
  }

  const [numero, destino] = hallados[0];
  return { casillero: numero, ...destino };
}
