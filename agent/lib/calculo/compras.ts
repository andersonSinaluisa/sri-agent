/**
 * Clasificación de las compras del período a partir del listado del portal.
 *
 * Qué se puede deducir del listado y qué no
 * ─────────────────────────────────────────
 * El listado trae, por comprobante: emisor, tipo, fechas, base imponible, IVA
 * y total. Con eso alcanza para deducir la TARIFA de cada comprobante —el IVA
 * dividido por la base da 15%, 5%, 8% o 0%— y para separar facturas de notas
 * de crédito y de retenciones.
 *
 * No alcanza para tres cosas, y ninguna es un detalle:
 *
 *  - Si la compra es de ACTIVO FIJO. El 104 la separa en su propio casillero
 *    (501, 511, 521) y el listado no lo dice.
 *  - A qué se DESTINA la compra: a ventas gravadas (crédito total), a ventas
 *    0% (sin crédito) o a uso común (crédito por el factor de
 *    proporcionalidad). Eso no es un dato del comprobante, es una decisión
 *    sobre el negocio.
 *  - Cómo repartir un comprobante con VARIAS tarifas en un mismo documento.
 *    El listado trae un solo subtotal y un solo IVA, así que no se puede
 *    separar sin el XML del comprobante.
 *
 * Por eso esto clasifica y CUENTA, pero no decide: lo que no se puede deducir
 * se devuelve marcado para que lo resuelva una persona. Repartir a ojo el
 * crédito tributario produce una declaración que se presenta sin problema y
 * se descubre en una auditoría.
 *
 * Todo el dinero en CENTAVOS ENTEROS.
 */

/** Tarifas de IVA vigentes, en diezmilésimas: 15% = 1500. */
const TARIFAS: readonly { readonly clave: TarifaCompra; readonly puntos: number }[] = [
  { clave: "quince", puntos: 1500 },
  { clave: "ocho", puntos: 800 },
  { clave: "cinco", puntos: 500 },
  { clave: "cero", puntos: 0 },
];

export type TarifaCompra = "quince" | "ocho" | "cinco" | "cero";

/** Una fila del listado descargado, ya convertida a centavos. */
export interface ComprobanteCompra {
  readonly rucEmisor: string;
  readonly razonSocialEmisor?: string;
  readonly tipoComprobante: string;
  readonly serie?: string;
  readonly subtotalCentavos: number;
  readonly ivaCentavos: number;
  readonly totalCentavos: number;
}

export interface TotalPorTarifa {
  readonly baseCentavos: number;
  readonly ivaCentavos: number;
  readonly comprobantes: number;
}

export interface ClasificacionCompras {
  /** Facturas y liquidaciones, agrupadas por la tarifa deducida. */
  readonly porTarifa: Readonly<Record<TarifaCompra, TotalPorTarifa>>;
  /** Notas de crédito: RESTAN, y van en casilleros propios (543, 544). */
  readonly notasCredito: TotalPorTarifa;
  /** Comprobantes de retención que terceros me emitieron (casillero 609). */
  readonly retenciones: TotalPorTarifa;
  /**
   * Comprobantes cuya tarifa no se puede deducir: el IVA no corresponde a
   * ninguna tarifa vigente. Casi siempre son documentos con varias tarifas
   * mezcladas, y hay que abrir el XML o clasificarlos a mano.
   */
  readonly sinClasificar: readonly ComprobanteCompra[];
  /** Cuántos comprobantes de cada clase, para los casilleros 111-119. */
  readonly conteos: {
    readonly facturas: number;
    readonly notasCredito: number;
    readonly liquidacionesCompra: number;
    readonly retenciones: number;
    readonly total: number;
  };
}

/** "Nota de Crédito" -> "NOTA DE CREDITO" */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Qué tarifa explica el IVA de este comprobante.
 *
 * Se tolera un centavo de diferencia porque el emisor redondea cada línea del
 * comprobante y el total no siempre coincide al centavo con base × tarifa.
 * Más tolerancia que eso empezaría a confundir tarifas entre sí.
 */
export function deducirTarifa(
  baseCentavos: number,
  ivaCentavos: number,
): TarifaCompra | null {
  for (const { clave, puntos } of TARIFAS) {
    const esperado = Math.round((baseCentavos * puntos) / 10_000);
    if (Math.abs(esperado - ivaCentavos) <= 1) return clave;
  }
  return null;
}

function vacio(): TotalPorTarifa {
  return { baseCentavos: 0, ivaCentavos: 0, comprobantes: 0 };
}

function sumar(acumulado: TotalPorTarifa, fila: ComprobanteCompra): TotalPorTarifa {
  return {
    baseCentavos: acumulado.baseCentavos + fila.subtotalCentavos,
    ivaCentavos: acumulado.ivaCentavos + fila.ivaCentavos,
    comprobantes: acumulado.comprobantes + 1,
  };
}

export function clasificarCompras(
  filas: readonly ComprobanteCompra[],
): ClasificacionCompras {
  for (const fila of filas) {
    for (const campo of ["subtotalCentavos", "ivaCentavos", "totalCentavos"] as const) {
      if (!Number.isInteger(fila[campo])) {
        throw new Error(
          `"${campo}" debe ser un entero de centavos; llegó ${fila[campo]} ` +
            `en el comprobante ${fila.serie ?? fila.rucEmisor}.`,
        );
      }
    }
  }

  const porTarifa: Record<TarifaCompra, TotalPorTarifa> = {
    quince: vacio(),
    ocho: vacio(),
    cinco: vacio(),
    cero: vacio(),
  };
  let notasCredito = vacio();
  let retenciones = vacio();
  const sinClasificar: ComprobanteCompra[] = [];

  const conteos = {
    facturas: 0,
    notasCredito: 0,
    liquidacionesCompra: 0,
    retenciones: 0,
    total: filas.length,
  };

  for (const fila of filas) {
    const tipo = normalizar(fila.tipoComprobante);

    // Las retenciones no son una compra: son IVA que me retuvieron, y van al
    // casillero 609, no al bloque de adquisiciones.
    if (tipo.includes("RETENCION")) {
      conteos.retenciones += 1;
      retenciones = sumar(retenciones, fila);
      continue;
    }

    // Las notas de crédito restan. Se acumulan aparte en vez de netearlas
    // contra las facturas: el 104 las declara en sus propios casilleros.
    if (tipo.includes("CREDITO")) {
      conteos.notasCredito += 1;
      notasCredito = sumar(notasCredito, fila);
      continue;
    }

    if (tipo.includes("LIQUIDACION")) conteos.liquidacionesCompra += 1;
    else conteos.facturas += 1;

    const tarifa = deducirTarifa(fila.subtotalCentavos, fila.ivaCentavos);
    if (tarifa === null) {
      sinClasificar.push(fila);
      continue;
    }
    porTarifa[tarifa] = sumar(porTarifa[tarifa], fila);
  }

  return { porTarifa, notasCredito, retenciones, sinClasificar, conteos };
}
