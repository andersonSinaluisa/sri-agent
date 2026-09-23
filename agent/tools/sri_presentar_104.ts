import { defineTool } from "eve/tools";
import { z } from "zod";
import { ejecutarScriptSri } from "../lib/sri/ejecutar.js";
import { esAprobadorAutorizado, mismoContribuyente } from "../lib/sri/politicas.js";

/** [{casillero, centavos}] -> {casillero: centavos}, que es lo que usa el script. */
function comoMapa(
  entradas: readonly { readonly casillero: string; readonly centavos: number }[],
): Record<string, number> {
  const mapa: Record<string, number> = {};
  for (const { casillero, centavos } of entradas) {
    if (mapa[casillero] !== undefined) {
      throw new Error(`El casillero ${casillero} viene repetido.`);
    }
    mapa[casillero] = centavos;
  }
  return mapa;
}

export default defineTool({
  description:
    "PRESENTA la declaración de IVA ante el SRI. Acción irreversible y con efecto jurídico: genera una obligación declarada a nombre del contribuyente. Solo llamala después de que una persona haya revisado la captura de sri_preparar_104 y con los mismos casilleros.",
  inputSchema: z.object({
    ruc: z.string().regex(/^\d{13}$/),
    anio: z.number().int().min(2010).max(2100),
    mes: z.number().int().min(1).max(12),
    // Arreglo y no un objeto indexado: `z.record` con clave por patrón genera
    // JSON Schema con `propertyNames`, que está fuera del subconjunto de
    // function-calling que aceptan los proveedores y produce un 400 sin
    // explicación. Un arreglo de objetos lo entiende cualquiera.
    casilleros: z
      .array(
        z.object({
          casillero: z.string().regex(/^\d{3}$/).describe("Número de casillero, p. ej. 401."),
          centavos: z.number().int().describe("Monto en centavos enteros."),
        }),
      )
      .min(1)
      .describe("Un elemento por casillero a escribir."),
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
      casilleros: comoMapa(casilleros),
      confirmacion: "PRESENTAR",
    });
  },
});
