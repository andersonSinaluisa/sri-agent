import { defineTool } from "eve/tools";
import { z } from "zod";
import { ejecutarScriptSri } from "../lib/sri/ejecutar.js";
import { esAprobadorAutorizado, mismoContribuyente } from "../lib/sri/politicas.js";

export default defineTool({
  description:
    "PRESENTA la declaración de IVA ante el SRI. Acción irreversible y con efecto jurídico: genera una obligación declarada a nombre del contribuyente. Solo llamala después de que una persona haya revisado la captura de sri_preparar_104 y con los mismos casilleros.",
  inputSchema: z.object({
    ruc: z.string().regex(/^\d{13}$/),
    anio: z.number().int().min(2010).max(2100),
    mes: z.number().int().min(1).max(12),
    casilleros: z.record(z.string().regex(/^\d{3}$/), z.number().int()),
    totalAPagarCentavos: z
      .number()
      .int()
      .min(0)
      .describe("Monto que el aprobador está confirmando; se muestra en el pedido de aprobación."),
  }),

  approval: {
    // Aprobación humana en TODAS las llamadas, incluidas las de un schedule.
    // Nada en este proyecto presenta una declaración sin que alguien lo decida.
    request: (contexto) => mismoContribuyente(contexto) ?? "user-approval",
    response: ({ responder }) =>
      esAprobadorAutorizado(responder.principalId)
        ? { status: "allowed" }
        : {
            status: "rejected",
            reason: "Este usuario no está autorizado a presentar declaraciones.",
          },
  },

  label: {
    start: ({ ruc, anio, mes, totalAPagarCentavos }) =>
      `PRESENTAR 104 · ${ruc} · ${anio}-${mes} · USD ${(totalAPagarCentavos / 100).toFixed(2)}`,
  },

  async execute({ ruc, anio, mes, casilleros }, ctx) {
    return ejecutarScriptSri<{
      periodo: { anio: number; mes: number };
      numeroComprobante: string | null;
      comprobante: string | null;
      captura: string;
      leidos: Record<string, string>;
      presentado: true;
    }>(ctx, "presentar-104.mjs", ruc, {
      periodo: { anio, mes },
      casilleros,
      confirmacion: "PRESENTAR",
    });
  },
});
