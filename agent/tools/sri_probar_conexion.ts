import { defineTool } from "eve/tools";
import { z } from "zod";
import { ejecutarScriptSri } from "../lib/sri/ejecutar.js";
import { mismoContribuyente } from "../lib/sri/politicas.js";

export default defineTool({
  description:
    "Diagnóstico de red: comprueba si Chromium puede ALCANZAR el portal del SRI. No inicia sesión ni usa la clave del portal. Usalo cuando una operación falle por timeout, para separar un bloqueo de red de un selector que cambió.",
  inputSchema: z.object({
    ruc: z.string().regex(/^\d{13}$/),
  }),
  approval: (contexto) => mismoContribuyente(contexto) ?? "not-applicable",
  label: { start: ({ ruc }) => `Probar conexión al SRI · ${ruc}` },
  async execute({ ruc }, ctx) {
    return ejecutarScriptSri<{
      url: string;
      estadoHttp: number | null;
      ms: number;
      titulo: string;
      bytesHtml: number;
      inicioDelTexto: string;
    }>(ctx, "probar-conexion.mjs", ruc, {});
  },
});
