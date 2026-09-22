/**
 * Liquidación del Formulario 104. Función pura, sin E/S y sin modelo.
 *
 * Todo el dinero se maneja en CENTAVOS ENTEROS. Nunca usar `number` decimal
 * para montos: una declaración que difiere un centavo del portal obliga a
 * presentar una sustitutiva.
 */

export interface InsumosPeriodo {
  /** Base imponible de ventas con tarifa distinta de 0%. */
  readonly ventasGravadas: number;
  /** Base imponible de ventas con tarifa 0%. */
  readonly ventasTarifa0: number;
  /** IVA generado en ventas del período. */
  readonly ivaGenerado: number;

  /** IVA de compras destinadas exclusivamente a ventas gravadas: crédito total. */
  readonly ivaComprasCreditoTotal: number;
  /** IVA de compras de uso común: sujeto al factor de proporcionalidad. */
  readonly ivaComprasUsoComun: number;
  /** IVA de compras destinadas a ventas 0% o gastos sin derecho: sin crédito. */
  readonly ivaComprasSinCredito: number;

  /** Crédito tributario por adquisiciones arrastrado del período anterior. */
  readonly creditoAdquisicionesAnterior: number;
  /** Crédito tributario por retenciones arrastrado del período anterior. */
  readonly creditoRetencionesAnterior: number;
  /** Retenciones de IVA que terceros me efectuaron en el período. */
  readonly retencionesRecibidas: number;
}

export interface LiquidacionIva {
  /** ventasGravadas / (ventasGravadas + ventasTarifa0), en millonésimas. */
  readonly factorProporcionalidad: number;
  readonly creditoUsoComunAplicable: number;
  readonly creditoDelPeriodo: number;
  /** IVA generado menos crédito del período y arrastre por adquisiciones. */
  readonly ivaACargo: number;
  readonly creditoAdquisicionesProximoPeriodo: number;
  readonly retencionesAplicadas: number;
  readonly creditoRetencionesProximoPeriodo: number;
  /** Lo que hay que pagar, sin multas ni intereses. Nunca negativo. */
  readonly totalAPagar: number;
}

/** Factor en millonésimas (1_000_000 = 100%), para no arrastrar error flotante. */
export function calcularFactorProporcionalidad(
  ventasGravadas: number,
  ventasTarifa0: number,
): number {
  const total = ventasGravadas + ventasTarifa0;
  if (total === 0) return 0;
  return Math.round((ventasGravadas * 1_000_000) / total);
}

export function liquidarIva(insumos: InsumosPeriodo): LiquidacionIva {
  for (const [campo, valor] of Object.entries(insumos)) {
    if (!Number.isInteger(valor)) {
      throw new Error(`"${campo}" debe ser un entero de centavos; llegó ${valor}.`);
    }
    if (valor < 0) throw new Error(`"${campo}" no puede ser negativo.`);
  }

  const factorProporcionalidad = calcularFactorProporcionalidad(
    insumos.ventasGravadas,
    insumos.ventasTarifa0,
  );

  const creditoUsoComunAplicable = Math.round(
    (insumos.ivaComprasUsoComun * factorProporcionalidad) / 1_000_000,
  );
  const creditoDelPeriodo = insumos.ivaComprasCreditoTotal + creditoUsoComunAplicable;

  // 1) El crédito por adquisiciones se aplica contra el IVA generado.
  const saldoAdquisiciones =
    insumos.ivaGenerado - creditoDelPeriodo - insumos.creditoAdquisicionesAnterior;
  const ivaACargo = Math.max(saldoAdquisiciones, 0);
  const creditoAdquisicionesProximoPeriodo = Math.max(-saldoAdquisiciones, 0);

  // 2) Recién después se aplican las retenciones, que arrastran por separado.
  const retencionesDisponibles = insumos.retencionesRecibidas + insumos.creditoRetencionesAnterior;
  const retencionesAplicadas = Math.min(ivaACargo, retencionesDisponibles);
  const creditoRetencionesProximoPeriodo = retencionesDisponibles - retencionesAplicadas;

  return {
    factorProporcionalidad,
    creditoUsoComunAplicable,
    creditoDelPeriodo,
    ivaACargo,
    creditoAdquisicionesProximoPeriodo,
    retencionesAplicadas,
    creditoRetencionesProximoPeriodo,
    totalAPagar: ivaACargo - retencionesAplicadas,
  };
}
