import { liquidarIva, calcularFactorProporcionalidad } from "../agent/lib/calculo/formulario104.ts";
import { fechaLimiteIva, novenoDigito } from "../agent/lib/normativa/calendario.ts";

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

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLAS`);
process.exit(fallos === 0 ? 0 : 1);
