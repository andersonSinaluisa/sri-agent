/**
 * Lectura del listado de comprobantes que exporta el propio portal.
 *
 * La consulta en pantalla está protegida por reCAPTCHA Enterprise, que puntúa
 * la interacción y rechaza el token de un navegador automatizado aunque la
 * sesión sea válida. Insistir contra ese control no es un camino: el portal
 * está pidiendo una persona. Pero la misma pantalla ofrece "Descargar
 * reporte", y ese archivo trae exactamente los mismos datos.
 *
 * Así que la persona hace la consulta y la descarga —una vez por período— y
 * el agente sigue desde el archivo. Todo lo que viene después (liquidar,
 * llenar el 104, verificar) queda automatizado igual.
 *
 * El archivo se lee por NOMBRE DE COLUMNA, no por posición: si el SRI agrega
 * una columna o cambia el orden, el mapeo sigue funcionando. Si falta una
 * columna necesaria, falla diciendo cuál — nunca devuelve un número inventado.
 */
import { aCentavos } from "./portal.mjs";

/** "Valor sin impuestos" -> "VALOR SIN IMPUESTOS", sin tildes. */
function normalizar(texto) {
  return String(texto)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Qué columna es cuál. Cada campo lista las palabras que tienen que estar
 * TODAS en el encabezado para considerarlo esa columna.
 *
 * Se eligieron combinaciones que no se pisan entre sí: "VALOR" sola no sirve
 * porque aparece en varias, y "IVA" sola tampoco, porque "TIPO" y "IVA" se
 * cruzan en encabezados como "VALOR IVA".
 */
const COLUMNAS = {
  rucEmisor: { debe: [["RUC", "EMISOR"], ["IDENTIFICACION", "EMISOR"]], obligatoria: true },
  razonSocialEmisor: { debe: [["RAZON", "SOCIAL"]], obligatoria: false },
  tipoComprobante: { debe: [["TIPO", "COMPROBANTE"], ["COMPROBANTE"]], obligatoria: false },
  serie: { debe: [["SERIE"], ["NUMERO", "COMPROBANTE"]], obligatoria: false },
  claveAcceso: { debe: [["CLAVE", "ACCESO"]], obligatoria: false },
  fechaEmision: { debe: [["FECHA", "EMISION"]], obligatoria: true },
  fechaAutorizacion: { debe: [["FECHA", "AUTORIZACION"]], obligatoria: false },
  subtotal: { debe: [["VALOR", "SIN", "IMPUESTOS"], ["SUBTOTAL"], ["BASE", "IMPONIBLE"]], obligatoria: true },
  iva: { debe: [["VALOR", "IVA"], ["IVA"]], obligatoria: true },
  total: { debe: [["IMPORTE", "TOTAL"], ["VALOR", "TOTAL"], ["TOTAL"]], obligatoria: true },
};

/** El separador que más columnas produce en el encabezado. */
function detectarSeparador(encabezado) {
  const candidatos = ["\t", "|", ";", ","];
  let mejor = "\t";
  let columnas = 0;

  for (const separador of candidatos) {
    const cuantas = encabezado.split(separador).length;
    if (cuantas > columnas) {
      columnas = cuantas;
      mejor = separador;
    }
  }

  if (columnas < 4) {
    throw new Error(
      "No se reconoce el separador del listado: la primera línea no se parte en columnas " +
        "con tabulador, |, ; ni coma. ¿Es el archivo que descarga el portal?",
    );
  }
  return mejor;
}

/** Empareja cada campo con el índice de su columna en el encabezado. */
function mapearColumnas(encabezados) {
  const normalizados = encabezados.map(normalizar);
  const mapa = {};
  const faltantes = [];

  for (const [campo, { debe, obligatoria }] of Object.entries(COLUMNAS)) {
    // Se prueban las alternativas en orden: la primera que encaje gana, de
    // modo que "VALOR SIN IMPUESTOS" se prefiere sobre "SUBTOTAL".
    let indice = -1;
    for (const palabras of debe) {
      indice = normalizados.findIndex(
        (encabezado, i) =>
          !Object.values(mapa).includes(i) && palabras.every((p) => encabezado.includes(p)),
      );
      if (indice !== -1) break;
    }

    if (indice === -1) {
      if (obligatoria) faltantes.push(campo);
      continue;
    }
    mapa[campo] = indice;
  }

  if (faltantes.length > 0) {
    throw new Error(
      `Al listado le faltan columnas obligatorias: ${faltantes.join(", ")}. ` +
        `Encabezados encontrados: ${encabezados.join(" · ")}`,
    );
  }
  return mapa;
}

/**
 * Convierte el listado descargado en las mismas filas que produce la lectura
 * de la pantalla, para que lo que viene después no note la diferencia.
 *
 * @param {string} contenido  el archivo tal cual, ya decodificado a texto
 */
export function leerListado(contenido) {
  // OJO: las líneas NO se recortan.
  //
  // El listado del SRI termina en una columna que suele venir vacía
  // (`NUMERO_DOCUMENTO_MODIFICADO`), así que la línea acaba en separador.
  // Recortarla se lleva ese separador, la fila queda con una columna menos
  // que el encabezado y el control de línea corta la descarta. Con el archivo
  // real eso descartaba las 17 filas y devolvía un período vacío.
  const lineas = contenido.split(/\r?\n/).filter((l) => l.trim() !== "");

  if (lineas.length === 0) throw new Error("El listado está vacío.");

  const separador = detectarSeparador(lineas[0]);
  const encabezados = lineas[0].split(separador).map((c) => c.trim());
  const mapa = mapearColumnas(encabezados);

  const celda = (columnas, campo) =>
    mapa[campo] === undefined ? "" : (columnas[mapa[campo]] ?? "").trim();

  const filas = [];
  const descartadas = [];

  for (const [n, linea] of lineas.slice(1).entries()) {
    const columnas = linea.split(separador);

    // Una línea con menos columnas que el encabezado está cortada: se descarta
    // avisando, en vez de leer un importe de la columna equivocada.
    if (columnas.length < encabezados.length) {
      descartadas.push(n + 2);
      continue;
    }

    filas.push({
      rucEmisor: celda(columnas, "rucEmisor"),
      razonSocialEmisor: celda(columnas, "razonSocialEmisor"),
      tipoComprobante: celda(columnas, "tipoComprobante"),
      serie: celda(columnas, "serie"),
      claveAcceso: celda(columnas, "claveAcceso"),
      fechaEmision: celda(columnas, "fechaEmision"),
      fechaAutorizacion: celda(columnas, "fechaAutorizacion"),
      subtotalCentavos: aCentavos(celda(columnas, "subtotal")),
      ivaCentavos: aCentavos(celda(columnas, "iva")),
      totalCentavos: aCentavos(celda(columnas, "total")),
    });
  }

  // El mismo control que la lectura de pantalla: si subtotal + IVA no da el
  // total, algo se leyó de la columna que no era.
  const descuadradas = filas.filter(
    (f) => Math.abs(f.subtotalCentavos + f.ivaCentavos - f.totalCentavos) > 1,
  );

  return {
    filas,
    separador: separador === "\t" ? "tabulador" : separador,
    encabezados,
    columnasReconocidas: Object.keys(mapa),
    lineasDescartadas: descartadas,
    filasDescuadradas: descuadradas.length,
  };
}

/** Suma el IVA de las filas, que es lo que alimenta el crédito tributario. */
export function totalesDelListado(filas) {
  return filas.reduce(
    (acumulado, fila) => ({
      subtotalCentavos: acumulado.subtotalCentavos + fila.subtotalCentavos,
      ivaCentavos: acumulado.ivaCentavos + fila.ivaCentavos,
      totalCentavos: acumulado.totalCentavos + fila.totalCentavos,
    }),
    { subtotalCentavos: 0, ivaCentavos: 0, totalCentavos: 0 },
  );
}
