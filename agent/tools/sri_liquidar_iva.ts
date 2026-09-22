import { defineTool } from "eve/tools";
import { z } from "zod";
import { liquidarIva } from "../lib/calculo/formulario104.js";
import { diasHastaVencimiento, fechaLimiteIva } from "../lib/normativa/calendario.js";

const Centavos = z.number().int().min(0);

export default defineTool({
  description:
    "Liquida el IVA de un período y calcula la fecha límite de presentación. Cálculo determinista en centavos enteros: usá SIEMPRE esta tool en lugar de hacer la aritmética vos mismo.",
  inputSchema: z.object({
    ruc: z.string().regex(/^\d{13}$/),
    anio: z.number().int().min(2010).max(2100),
    mes: z.number().int().min(1).max(12),
    periodicidad: z.enum(["mensual", "semestral"]).default("mensual"),
    feriados: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .default([])
      .describe("Feriados nacionales del mes de vencimiento, para correr el plazo a día hábil."),
    insumos: z.object({
      ventasGravadas: Centavos,
      ventasTarifa0: Centavos,
      ivaGenerado: Centavos,
      ivaComprasCreditoTotal: Centavos,
      ivaComprasUsoComun: Centavos,
      ivaComprasSinCredito: Centavos,
      creditoAdquisicionesAnterior: Centavos,
      creditoRetencionesAnterior: Centavos,
      retencionesRecibidas: Centavos,
    }),
  }),
  label: { start: ({ ruc, anio, mes }) => `Liquidar IVA · ${ruc} · ${anio}-${mes}` },
  execute({ ruc, anio, mes, periodicidad, feriados, insumos }) {
    const liquidacion = liquidarIva(insumos);
    const limite = fechaLimiteIva(ruc, { anio, mes }, periodicidad, feriados);
    return {
      periodo: { anio, mes },
      liquidacion,
      fechaLimite: limite.toISOString().slice(0, 10),
      diasRestantes: diasHastaVencimiento(limite),
    };
  },
});
