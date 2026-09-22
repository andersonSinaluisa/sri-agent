import { defineTool } from "eve/tools";
import { z } from "zod";
import { ejecutarScriptSri } from "../lib/sri/ejecutar.js";
import { mismoContribuyente } from "../lib/sri/politicas.js";

const SalidaSchema = z.object({
  url: z.string(),
  resultados: z.array(
    z.object({
      selector: z.string(),
      valido: z.boolean(),
      cantidad: z.number().int(),
      primero: z
        .object({
          etiqueta: z.string(),
          id: z.string().nullable(),
          texto: z.string().nullable(),
        })
        .nullable(),
      error: z.string().optional(),
    }),
  ),
});

type Salida = z.infer<typeof SalidaSchema>;

export default defineTool({
  description:
    "MODO EXPLORACIÓN: prueba selectores candidatos contra una pantalla real y dice cuántos elementos resuelve cada uno. Un selector sirve solo si resuelve exactamente 1. Usala siempre antes de proponer un cambio en selectores.mjs: no des por bueno un selector sin verificarlo.",
  inputSchema: z.object({
    ruc: z.string().regex(/^\d{13}$/),
    url: z.string().url(),
    selectores: z.array(z.string()).min(1).max(10),
    esperarSelector: z.string().optional(),
  }),
  outputSchema: SalidaSchema,
  approval: (contexto) => mismoContribuyente(contexto) ?? "not-applicable",
  label: {
    start: ({ selectores }) => `Validar ${selectores.length} selector(es)`,
    complete: (_entrada, salida) => {
      const buenos = salida.resultados.filter((r) => r.valido && r.cantidad === 1).length;
      return `${buenos} de ${salida.resultados.length} resuelven exactamente 1 elemento`;
    },
  },
  async execute({ ruc, url, selectores, esperarSelector }, ctx) {
    return ejecutarScriptSri<Salida>(ctx, "validar-selectores.mjs", ruc, {
      url,
      selectores,
      esperarSelector,
    });
  },
});
