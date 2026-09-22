import { defineTool } from "eve/tools";
import { z } from "zod";
import { ejecutarScriptSri } from "../lib/sri/ejecutar.js";
import { mismoContribuyente } from "../lib/sri/politicas.js";

const SalidaSchema = z.object({
  url: z.string(),
  estadoHttp: z.number().int().nullable(),
  ms: z.number().int(),
  titulo: z.string(),
  bytesHtml: z.number().int(),
  inicioDelTexto: z.string(),
});

type Salida = z.infer<typeof SalidaSchema>;

export default defineTool({
  description:
    "Diagnóstico de red: comprueba si Chromium puede ALCANZAR el portal del SRI. No inicia sesión ni usa la clave del portal. Usalo cuando una operación falle por timeout, para separar un bloqueo de red de un selector que cambió.",
  inputSchema: z.object({
    ruc: z.string().regex(/^\d{13}$/),
  }),
  outputSchema: SalidaSchema,
  approval: (contexto) => mismoContribuyente(contexto) ?? "not-applicable",
  label: {
    start: ({ ruc }) => `Probar conexión al SRI · ${ruc}`,
    complete: (_entrada, salida) =>
      `Portal alcanzable · HTTP ${salida.estadoHttp} en ${salida.ms}ms`,
  },
  async execute({ ruc }, ctx) {
    return ejecutarScriptSri<Salida>(ctx, "probar-conexion.mjs", ruc, {});
  },
});
