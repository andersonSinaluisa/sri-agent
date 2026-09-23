import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";
import { ejecutarScriptSri, leerBinarioSandbox } from "../lib/sri/ejecutar.js";
import { mismoContribuyente } from "../lib/sri/politicas.js";
import { enviarCapturasAlModelo } from "../lib/sri/capturas.js";

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
    "Abre el Formulario 104 del período en SRI en línea, escribe los casilleros y SE DETIENE antes de presentar. Devuelve una captura del formulario lleno para revisarlo. No presenta nada.",
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
  }),
  approval: (contexto) => mismoContribuyente(contexto) ?? "not-applicable",
  label: { start: ({ ruc, anio, mes }) => `Preparar 104 · ${ruc} · ${anio}-${mes}` },
  async execute({ ruc, anio, mes, casilleros }, ctx) {
    const resultado = await ejecutarScriptSri<{
      periodo: { anio: number; mes: number };
      escritos: { casillero: string; valor: string }[];
      leidos: Record<string, string>;
      resumen: string | null;
      captura: string;
      presentado: false;
    }>(ctx, "preparar-104.mjs", ruc, {
      periodo: { anio, mes },
      casilleros: comoMapa(casilleros),
    });

    const capturaBase64 = await leerBinarioSandbox(ctx, resultado.captura);
    return { ...resultado, capturaBase64 };
  },
  toModelOutput(salida) {
    const partes = [
      toolOutputPart.text(
        `Formulario 104 ${salida.periodo.anio}-${salida.periodo.mes} lleno y sin presentar.\n` +
          `Casilleros escritos: ${JSON.stringify(salida.leidos)}\n` +
          `Resumen de liquidación del portal: ${salida.resumen ?? "no disponible"}\n` +
          "Revisá que la captura coincida con los valores aprobados antes de presentar.",
      ),
    ];
    if (salida.capturaBase64 !== null && enviarCapturasAlModelo()) {
      partes.push(toolOutputPart.file(salida.capturaBase64, { mediaType: "image/png" }));
    }
    return toolOutput.content(partes);
  },
});
