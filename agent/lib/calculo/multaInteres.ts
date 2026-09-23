/**
 * Multa e interés por presentación tardía.
 *
 * IMPORTANTE: el portal calcula estos valores por su cuenta y los muestra
 * bloqueados. Esto NO los reemplaza: sirve para anticiparle al usuario cuánto
 * va a costar declarar tarde, y para CONTRASTAR lo que muestra el portal. Si
 * los dos no coinciden, es señal de parar y revisar, no de imponer el nuestro.
 *
 * Reglas (Código Tributario y LRTI):
 * - Multa: 3% del impuesto causado por mes o fracción de mes de retraso.
 * - Interés: la tasa que el SRI publica cada trimestre, por mes o fracción.
 *
 * La tasa de interés CAMBIA cada trimestre por resolución, así que se pasa
 * como parámetro con su vigencia en vez de quedar escrita acá.
 */

export interface InsumosMora {
  /** Impuesto causado, en centavos enteros. */
  readonly impuestoCentavos: number;
  /** Meses o fracción de retraso. Ver `mesesDeAtraso`. */
  readonly mesesAtraso: number;
  /** Tasa de interés MENSUAL en millonésimas: 0.571% = 5710. */
  readonly tasaInteresMensualMillonesimas: number;
  /** Porcentaje de multa mensual en millonésimas: 3% = 30000. */
  readonly porcentajeMultaMensualMillonesimas?: number;
}

export interface Mora {
  readonly mesesAtraso: number;
  readonly porcentajeInteresTotalMillonesimas: number;
  readonly porcentajeMultaTotalMillonesimas: number;
  readonly interesCentavos: number;
  readonly multaCentavos: number;
  readonly totalAPagarCentavos: number;
}

/** 3% mensual, el valor general del Código Tributario. */
export const MULTA_MENSUAL_POR_DEFECTO = 30_000; // 3% en millonésimas

export function calcularMora(insumos: InsumosMora): Mora {
  const {
    impuestoCentavos,
    mesesAtraso,
    tasaInteresMensualMillonesimas,
    porcentajeMultaMensualMillonesimas = MULTA_MENSUAL_POR_DEFECTO,
  } = insumos;

  if (!Number.isInteger(impuestoCentavos) || impuestoCentavos < 0) {
    throw new Error("`impuestoCentavos` debe ser un entero de centavos no negativo.");
  }
  if (!Number.isInteger(mesesAtraso) || mesesAtraso < 0) {
    throw new Error("`mesesAtraso` debe ser un entero no negativo.");
  }

  // Sin impuesto causado no hay base sobre la cual calcular: la multa por no
  // declarar a tiempo sin impuesto tiene otro régimen (multa pecuniaria fija)
  // y el portal la resuelve con un cuestionario aparte.
  if (impuestoCentavos === 0 || mesesAtraso === 0) {
    return {
      mesesAtraso,
      porcentajeInteresTotalMillonesimas: 0,
      porcentajeMultaTotalMillonesimas: 0,
      interesCentavos: 0,
      multaCentavos: 0,
      totalAPagarCentavos: impuestoCentavos,
    };
  }

  const porcentajeInteresTotalMillonesimas = tasaInteresMensualMillonesimas * mesesAtraso;
  const porcentajeMultaTotalMillonesimas = porcentajeMultaMensualMillonesimas * mesesAtraso;

  const interesCentavos = Math.round(
    (impuestoCentavos * porcentajeInteresTotalMillonesimas) / 1_000_000,
  );
  const multaCentavos = Math.round(
    (impuestoCentavos * porcentajeMultaTotalMillonesimas) / 1_000_000,
  );

  return {
    mesesAtraso,
    porcentajeInteresTotalMillonesimas,
    porcentajeMultaTotalMillonesimas,
    interesCentavos,
    multaCentavos,
    totalAPagarCentavos: impuestoCentavos + interesCentavos + multaCentavos,
  };
}

/**
 * Meses o fracción de retraso entre el vencimiento y la fecha de pago.
 *
 * Un solo día de atraso ya cuenta como un mes completo: por eso se cuenta la
 * fracción hacia arriba y no se prorratea.
 */
export function mesesDeAtraso(fechaLimite: Date, fechaPago: Date): number {
  if (fechaPago.getTime() <= fechaLimite.getTime()) return 0;

  let meses =
    (fechaPago.getUTCFullYear() - fechaLimite.getUTCFullYear()) * 12 +
    (fechaPago.getUTCMonth() - fechaLimite.getUTCMonth());

  // Si todavía no se llegó al mismo día del mes, ese mes está empezado pero
  // no cumplido: cuenta igual como fracción.
  if (fechaPago.getUTCDate() > fechaLimite.getUTCDate()) meses += 1;
  return Math.max(meses, 1);
}
