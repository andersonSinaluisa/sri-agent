import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";
import { ejecutarScriptSri, leerBinarioSandbox } from "../lib/sri/ejecutar.js";
import { mismoContribuyente } from "../lib/sri/politicas.js";

export default defineTool({
  description:
    "Abre el Formulario 104 del período en SRI en línea, escribe los casilleros y SE DETIENE antes de presentar. Devuelve una captura del formulario lleno para revisarlo. No presenta nada.",
  inputSchema: z.object({
    ruc: z.string().regex(/^\d{13}$/),
    anio: z.number().int().min(2010).max(2100),
    mes: z.number().int().min(1).max(12),
    casilleros: z
      .record(z.string().regex(/^\d{3}$/), z.number().int())
      .describe("Casillero del 104 -> monto en centavos enteros."),
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
    }>(ctx, "preparar-104.mjs", ruc, { periodo: { anio, mes }, casilleros });

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
    if (salida.capturaBase64 !== null) {
      partes.push(toolOutputPart.file(salida.capturaBase64, { mediaType: "image/png" }));
    }
    return toolOutput.content(partes);
  },
});
