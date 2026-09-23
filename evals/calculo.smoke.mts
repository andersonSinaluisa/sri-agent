import { liquidarIva, calcularFactorProporcionalidad } from "../agent/lib/calculo/formulario104.ts";
import { fechaLimiteIva, novenoDigito } from "../agent/lib/normativa/calendario.ts";
import { calcularMora, mesesDeAtraso } from "../agent/lib/calculo/multaInteres.ts";
import { repartirVentas } from "../agent/lib/calculo/ventas.ts";

let fallos = 0;
const ok = (n: string, a: unknown, e: unknown) => {
  const bien = JSON.stringify(a) === JSON.stringify(e);
  if (!bien) fallos++;
  console.log(`${bien ? "OK  " : "FALLA"} ${n}: ${JSON.stringify(a)}${bien ? "" : ` (esperado ${JSON.stringify(e)})`}`);
};

// Ventas 10.000,00 gravadas al 15% -> IVA 1.500,00. Compras con crédito total IVA 900,00.
const a = liquidarIva({
  ventasGravadas: 1_000_000, ventasTarifa0: 0, ivaGenerado: 150_000,
  ivaComprasCreditoTotal: 90_000, ivaComprasUsoComun: 0, ivaComprasSinCredito: 0,
  creditoAdquisicionesAnterior: 0, creditoRetencionesAnterior: 0, retencionesRecibidas: 0,
});
ok("caso simple: a pagar 600,00", a.totalAPagar, 60_000);
ok("caso simple: factor 100%", a.factorProporcionalidad, 1_000_000);

// Ventas mixtas: 6.000 gravadas + 4.000 tarifa 0 -> factor 60%. Uso común IVA 1.000,00.
ok("factor mixto 60%", calcularFactorProporcionalidad(600_000, 400_000), 600_000);
const b = liquidarIva({
  ventasGravadas: 600_000, ventasTarifa0: 400_000, ivaGenerado: 90_000,
  ivaComprasCreditoTotal: 0, ivaComprasUsoComun: 100_000, ivaComprasSinCredito: 50_000,
  creditoAdquisicionesAnterior: 0, creditoRetencionesAnterior: 0, retencionesRecibidas: 0,
});
ok("proporcionalidad: crédito aplicable 600,00", b.creditoUsoComunAplicable, 60_000);
ok("proporcionalidad: a pagar 300,00", b.totalAPagar, 30_000);

// Crédito mayor al IVA generado -> arrastre, nada a pagar.
const c = liquidarIva({
  ventasGravadas: 100_000, ventasTarifa0: 0, ivaGenerado: 15_000,
  ivaComprasCreditoTotal: 40_000, ivaComprasUsoComun: 0, ivaComprasSinCredito: 0,
  creditoAdquisicionesAnterior: 5_000, creditoRetencionesAnterior: 0, retencionesRecibidas: 0,
});
ok("arrastre adquisiciones 300,00", c.creditoAdquisicionesProximoPeriodo, 30_000);
ok("arrastre: nada a pagar", c.totalAPagar, 0);

// Retenciones mayores al IVA a cargo -> arrastran por separado, no compensan adquisiciones.
const d = liquidarIva({
  ventasGravadas: 1_000_000, ventasTarifa0: 0, ivaGenerado: 150_000,
  ivaComprasCreditoTotal: 100_000, ivaComprasUsoComun: 0, ivaComprasSinCredito: 0,
  creditoAdquisicionesAnterior: 0, creditoRetencionesAnterior: 0, retencionesRecibidas: 80_000,
});
ok("retenciones: a pagar 0", d.totalAPagar, 0);
ok("retenciones: arrastre 300,00", d.creditoRetencionesProximoPeriodo, 30_000);

// Calendario: noveno dígito y corrimiento a día hábil.
ok("noveno dígito (índice 8)", novenoDigito("1790012345001"), "4");
// dígito 4 -> día 16. Período 2026-01 vence lunes 2026-02-16.
ok("vencimiento mensual", fechaLimiteIva("1790012345001", { anio: 2026, mes: 1 }).toISOString().slice(0, 10), "2026-02-16");
// dígito 2 -> día 12. Período 2026-03 vence domingo 2026-04-12 -> corre a lunes 13.
ok("corre a día hábil", fechaLimiteIva("1790012325001", { anio: 2026, mes: 3 }).toISOString().slice(0, 10), "2026-04-13");
// Diciembre cruza de año.
ok("diciembre cruza año", fechaLimiteIva("1790012345001", { anio: 2025, mes: 12 }).toISOString().slice(0, 10), "2026-01-16");
// Semestral: enero-junio vence en julio.
ok("semestral 1er semestre", fechaLimiteIva("1790012345001", { anio: 2026, mes: 6 }, "semestral").toISOString().slice(0, 10), "2026-07-16");

ok("feriado corre el plazo", fechaLimiteIva("1790012345001", { anio: 2026, mes: 1 }, "mensual", ["2026-02-16", "2026-02-17"]).toISOString().slice(0, 10), "2026-02-18");

// ── Caso real, tomado del portal ────────────────────────────────────────────
// El perfil del contribuyente 0953227857001 muestra:
//   "2011 DECLARACION DE IVA - SEPTIEMBRE 2026 - 19/10/2026"
// Noveno digito 5 -> dia 18 -> domingo -> corre al lunes 19.
ok(
  "REAL: vencimiento que muestra el portal del SRI",
  fechaLimiteIva("0953227857001", { anio: 2026, mes: 9 }).toISOString().slice(0, 10),
  "2026-10-19",
);

// ── Multa e interes: caso REAL del portal ───────────────────────────────────
// Declaracion de JUNIO 2026 presentada tarde. El portal muestra:
//   Impuesto USD 1.50 | Meses atrasados 3
//   Interes  1.7130% (3 x 0.571%) -> USD 0.03
//   Multa    9.00%    (3 x 3.00%) -> USD 0.14
//   Total a pagar                 -> USD 1.67
const mora = calcularMora({
  impuestoCentavos: 150,
  mesesAtraso: 3,
  tasaInteresMensualMillonesimas: 5_710, // 0.571%
});
ok("REAL: interes que calcula el portal", mora.interesCentavos, 3);
ok("REAL: multa que calcula el portal", mora.multaCentavos, 14);
ok("REAL: total a pagar del portal", mora.totalAPagarCentavos, 167);
ok("REAL: porcentaje de interes acumulado", mora.porcentajeInteresTotalMillonesimas, 17_130);
ok("REAL: porcentaje de multa acumulado", mora.porcentajeMultaTotalMillonesimas, 90_000);

// Vencimiento 20/07/2026; el portal cuenta 3 meses en una fecha del tercer tramo.
ok(
  "meses de atraso: un dia ya cuenta como mes",
  mesesDeAtraso(new Date(Date.UTC(2026, 6, 20)), new Date(Date.UTC(2026, 6, 21))),
  1,
);
ok(
  "meses de atraso: tercer tramo",
  mesesDeAtraso(new Date(Date.UTC(2026, 6, 20)), new Date(Date.UTC(2026, 9, 10))),
  3,
);
ok(
  "meses de atraso: al dia no hay mora",
  mesesDeAtraso(new Date(Date.UTC(2026, 6, 20)), new Date(Date.UTC(2026, 6, 20))),
  0,
);
ok("sin impuesto causado no hay interes", calcularMora({
  impuestoCentavos: 0, mesesAtraso: 5, tasaInteresMensualMillonesimas: 5_710,
}).totalAPagarCentavos, 0);

// ── Reparto de ventas por tarifa ────────────────────────────────────────────
// Mezcla realista: 15% local, 5% local, y una venta de activo fijo.
const reparto = repartirVentas([
  { tarifa: "general", baseBrutaCentavos: 100_000, notasCreditoCentavos: 10_000, ivaGeneradoCentavos: 13_500 },
  { tarifa: "cinco", baseBrutaCentavos: 40_000, ivaGeneradoCentavos: 2_000 },
  { tarifa: "general", esActivoFijo: true, baseBrutaCentavos: 50_000, ivaGeneradoCentavos: 7_500 },
]);
ok("ventas: bruto del 15% local", reparto.porConcepto["concepto450"], 100_000);
ok("ventas: neto del 15% local (bruto - N/C)", reparto.porConcepto["concepto460"], 90_000);
ok("ventas: IVA del 15% local", reparto.porConcepto["concepto470"], 13_500);
ok("ventas: bruto del 5% va a su propio renglon", reparto.porConcepto["concepto452"], 40_000);
ok("ventas: activo fijo va a su propio renglon", reparto.porConcepto["concepto510"], 50_000);
ok("ventas: el 15% local NO absorbe al 5%", reparto.porConcepto["concepto450"], 100_000);
ok("ventas: gravadas suman netos de toda tarifa distinta de cero", reparto.ventasGravadasCentavos, 180_000);
ok("ventas: sin ventas a tarifa cero", reparto.ventasTarifa0Centavos, 0);
ok("ventas: IVA generado total", reparto.ivaGeneradoCentavos, 23_000);

// Dos ventas de la misma tarifa se acumulan en el mismo concepto.
ok("ventas: se acumulan por concepto", repartirVentas([
  { tarifa: "general", baseBrutaCentavos: 1_000, ivaGeneradoCentavos: 150 },
  { tarifa: "general", baseBrutaCentavos: 2_000, ivaGeneradoCentavos: 300 },
]).porConcepto["concepto450"], 3_000);

// Una tarifa sin reparto verificado falla nombrandola, no adivina un casillero.
// Tarifa 0% todavia no tiene reparto verificado: esa fila no aparecio en los
// volcados del formulario. Debe FALLAR nombrandola, nunca adivinar un campo.
let fallo = "";
try {
  repartirVentas([{ tarifa: "cero", baseBrutaCentavos: 30_000, ivaGeneradoCentavos: 0 }]);
} catch (e) { fallo = (e as Error).message; }
ok("ventas: tarifa 0% sin reparto verificado falla", fallo.includes("cero:local"), true);

let fallo2 = "";
try {
  repartirVentas([{ tarifa: "general", baseBrutaCentavos: 100, notasCreditoCentavos: 500, ivaGeneradoCentavos: 0 }]);
} catch (e) { fallo2 = (e as Error).message; }
ok("ventas: N/C mayor que la base falla", fallo2.includes("superan la base bruta"), true);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLAS`);
process.exit(fallos === 0 ? 0 : 1);
