// Ubicación de un casillero por fila y columna del Formulario 104.
//
// El 104 es una MATRIZ: cada fila es un concepto y las columnas son VALOR
// BRUTO, VALOR NETO e IMPUESTO GENERADO. 401, 411 y 421 son el mismo concepto
// en tres columnas, no tres tarifas. Los datos de abajo salieron del
// formulario real de marzo 2026.
//
//   npm run test:mapa104
import { buscarCasillero } from "../agent/sandbox/workspace/sri/lib/casilleros.mjs";

let fallos = 0;

function igual(real, esperado, nombre) {
  if (real !== esperado) {
    console.error(`FALLÓ ${nombre}\n  esperado ${esperado}\n  obtuvo   ${real}`);
    fallos += 1;
  }
}

function lanza(fn, fragmento, nombre) {
  try {
    fn();
    console.error(`FALLÓ ${nombre}: no lanzó ningún error`);
    fallos += 1;
  } catch (error) {
    if (!error.message.includes(fragmento)) {
      console.error(`FALLÓ ${nombre}\n  esperaba "${fragmento}"\n  dijo "${error.message}"`);
      fallos += 1;
    }
  }
}

const VENTAS = "RESUMEN DE VENTAS Y OTRAS OPERACIONES DEL PERÍODO QUE DECLARA";
const COMPRAS = "RESUMEN DE ADQUISICIONES Y PAGOS DEL PERÍODO QUE DECLARA";
const BRUTO = "VALOR BRUTO";
const NETO = "VALOR NETO (VALOR BRUTO - N/C)";
const IMPUESTO = "IMPUESTO GENERADO";

const filaVentas = "Ventas locales (excluye activos fijos) gravadas tarifa diferente de cero";
const filaCompras =
  "Adquisiciones y pagos (excluye activos fijos) gravados tarifa diferente de cero";

const mapa = {
  401: { etiqueta: filaVentas, columna: BRUTO, seccion: VENTAS },
  411: { etiqueta: filaVentas, columna: NETO, seccion: VENTAS },
  421: { etiqueta: filaVentas, columna: IMPUESTO, seccion: VENTAS },
  402: {
    etiqueta: "Ventas de activos fijos gravadas tarifa diferente de cero",
    columna: BRUTO,
    seccion: VENTAS,
  },
  500: { etiqueta: filaCompras, columna: BRUTO, seccion: COMPRAS },
  510: { etiqueta: filaCompras, columna: NETO, seccion: COMPRAS },
  520: { etiqueta: filaCompras, columna: IMPUESTO, seccion: COMPRAS },
  609: {
    etiqueta: "(-) Retenciones en la fuente de IVA que le han sido efectuadas",
    columna: IMPUESTO,
    seccion: COMPRAS,
  },
};

const numero = (criterio) => buscarCasillero(mapa, criterio).casillero;

// ── Las tres columnas de una misma fila ─────────────────────────────────────
igual(numero({ fila: "Ventas locales (excluye activos fijos)", columna: BRUTO }), "401", "401");
igual(numero({ fila: "Ventas locales (excluye activos fijos)", columna: NETO }), "411", "411");
igual(numero({ fila: "Ventas locales (excluye activos fijos)", columna: IMPUESTO }), "421", "421");

// "VALOR NETO (VALOR BRUTO - N/C)" contiene "VALOR BRUTO": sin desambiguar por
// coincidencia exacta de columna, este caso devolvía la columna equivocada.
igual(
  numero({ fila: filaVentas, columna: BRUTO }),
  "401",
  "VALOR BRUTO no se confunde con VALOR NETO",
);

// ── Filas distintas de la misma sección ─────────────────────────────────────
igual(numero({ fila: "Ventas de activos fijos", columna: BRUTO }), "402", "activos fijos");

// ── La misma columna en otra sección ────────────────────────────────────────
igual(numero({ fila: "Adquisiciones y pagos (excluye activos fijos)", columna: BRUTO }), "500", "500");
igual(numero({ fila: "Adquisiciones y pagos (excluye activos fijos)", columna: IMPUESTO }), "520", "520");
igual(numero({ fila: "Retenciones en la fuente de IVA", columna: IMPUESTO }), "609", "609");

// ── Acepta expresiones regulares ────────────────────────────────────────────
igual(numero({ fila: /^Ventas de activos fijos/, columna: BRUTO }), "402", "por expresión regular");

// ── Lo ambiguo y lo inexistente cortan ──────────────────────────────────────
lanza(
  () => numero({ fila: "Ventas locales (excluye activos fijos)" }),
  "3 casilleros coinciden",
  "sin columna es ambiguo y no elige por su cuenta",
);
lanza(
  () => numero({ fila: "Una fila que no existe" }),
  "Ningún casillero coincide",
  "una fila inexistente no devuelve nada",
);

if (fallos > 0) {
  console.error(`\n${fallos} comprobaciones fallaron.`);
  process.exit(1);
}
console.log("TODO OK");
