/**
 * Ventas por tarifa, y su reparto determinista a los campos del Formulario 104.
 *
 * El formulario no tiene un solo renglón de ventas: separa por tarifa (15%,
 * 5%, variable del 8% turístico, 0%) y por si son o no activos fijos, y cada
 * combinación tiene tres columnas: VALOR BRUTO, VALOR NETO (bruto menos notas
 * de crédito) e IMPUESTO GENERADO.
 *
 * El reparto se calcula acá, en código con tests, y no lo decide el modelo.
 * Poner una venta al 5% en el renglón del 15% no produce ningún error visible:
 * el formulario se presenta igual y la diferencia aparece después.
 *
 * ── Por qué se trabaja con `concepto` y no con número de casillero ──────────
 * El SRI identifica cada campo con un `concepto` interno (concepto450,
 * concepto460...) y publica en el DOM a qué casillero visible corresponde
 * (401, 411...). Los números de casillero cambian entre versiones del
 * formulario; los conceptos son el identificador estable. Acá se reparte por
 * concepto, y `casilleros.mjs` resuelve concepto -> input leyendo la página.
 */

export type TarifaVenta = "general" | "cinco" | "variable" | "cero";

export interface VentaPorTarifa {
  readonly tarifa: TarifaVenta;
  /** Activos fijos van en renglones propios del formulario. */
  readonly esActivoFijo?: boolean;
  /** VALOR BRUTO del período, en centavos. */
  readonly baseBrutaCentavos: number;
  /** Notas de crédito emitidas; el formulario pide VALOR BRUTO − N/C. */
  readonly notasCreditoCentavos?: number;
  /** IMPUESTO GENERADO por estas ventas, en centavos. */
  readonly ivaGeneradoCentavos: number;
}

/**
 * Conceptos de cada renglón, VERIFICADOS contra el formulario.
 * Las etiquetas del portal los agrupan explícitamente
 * (`data-referencia="etiqueta_450_460_470"`), que es de donde salen.
 */
const CONCEPTOS: Record<string, { bruto: string; neto: string; iva: string } | undefined> = {
  "general:local": { bruto: "concepto450", neto: "concepto460", iva: "concepto470" },
  "general:activoFijo": { bruto: "concepto510", neto: "concepto520", iva: "concepto530" },
  "variable:local": { bruto: "concepto451", neto: "concepto461", iva: "concepto471" },
  "cinco:local": { bruto: "concepto452", neto: "concepto462", iva: "concepto472" },
  // "cero:*" y las filas de exentas / no objeto no están verificadas todavía:
  // se prefiere fallar nombrando lo que falta antes que escribir en el campo
  // equivocado.
};

function clave(venta: VentaPorTarifa): string {
  return `${venta.tarifa}:${venta.esActivoFijo === true ? "activoFijo" : "local"}`;
}

export interface RepartoVentas {
  /** concepto -> monto en centavos, listo para escribir en el formulario. */
  readonly porConcepto: Readonly<Record<string, number>>;
  /** Base imponible con tarifa distinta de cero (para la proporcionalidad). */
  readonly ventasGravadasCentavos: number;
  /** Base imponible con tarifa cero. */
  readonly ventasTarifa0Centavos: number;
  /** Suma del impuesto generado. */
  readonly ivaGeneradoCentavos: number;
}

export function repartirVentas(ventas: readonly VentaPorTarifa[]): RepartoVentas {
  const porConcepto: Record<string, number> = {};
  let gravadas = 0;
  let tarifa0 = 0;
  let iva = 0;

  for (const venta of ventas) {
    for (const [campo, valor] of [
      ["baseBrutaCentavos", venta.baseBrutaCentavos],
      ["notasCreditoCentavos", venta.notasCreditoCentavos ?? 0],
      ["ivaGeneradoCentavos", venta.ivaGeneradoCentavos],
    ] as const) {
      if (!Number.isInteger(valor) || valor < 0) {
        throw new Error(`"${campo}" debe ser un entero de centavos no negativo; llegó ${valor}.`);
      }
    }

    const destino = CONCEPTOS[clave(venta)];
    if (destino === undefined) {
      throw new Error(
        `No hay reparto verificado para ventas ${clave(venta)}. ` +
          "Inspeccioná esa fila del formulario y agregá sus conceptos antes de declararla.",
      );
    }

    const notas = venta.notasCreditoCentavos ?? 0;
    if (notas > venta.baseBrutaCentavos) {
      throw new Error(
        `Las notas de crédito (${notas}) superan la base bruta (${venta.baseBrutaCentavos}) ` +
          `en ventas ${clave(venta)}.`,
      );
    }
    const neto = venta.baseBrutaCentavos - notas;

    porConcepto[destino.bruto] = (porConcepto[destino.bruto] ?? 0) + venta.baseBrutaCentavos;
    porConcepto[destino.neto] = (porConcepto[destino.neto] ?? 0) + neto;
    porConcepto[destino.iva] = (porConcepto[destino.iva] ?? 0) + venta.ivaGeneradoCentavos;

    // La proporcionalidad se calcula sobre el NETO: es la base que
    // efectivamente quedó gravada en el período.
    if (venta.tarifa === "cero") tarifa0 += neto;
    else gravadas += neto;
    iva += venta.ivaGeneradoCentavos;
  }

  return {
    porConcepto,
    ventasGravadasCentavos: gravadas,
    ventasTarifa0Centavos: tarifa0,
    ivaGeneradoCentavos: iva,
  };
}
