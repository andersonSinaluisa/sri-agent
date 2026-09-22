import { defineTool } from "eve/tools";
import { z } from "zod";
import { ejecutarScriptSri } from "../lib/sri/ejecutar.js";
import { mismoContribuyente } from "../lib/sri/politicas.js";

export default defineTool({
  description:
    "Comprueba que las credenciales de SRI en línea de un RUC abren sesión. Solo lee; no modifica nada en el portal. Usalo antes de cualquier otra operación contra el SRI.",
  inputSchema: z.object({
    ruc: z.string().regex(/^\d{13}$/, "El RUC debe tener 13 dígitos."),
  }),
  approval: (contexto) => mismoContribuyente(contexto) ?? "not-applicable",
  label: { start: ({ ruc }) => `Verificar acceso al SRI · ${ruc}` },
  async execute({ ruc }, ctx) {
    return ejecutarScriptSri<{
      ruc: string;
      reautenticado: boolean;
      url: string;
      titulo: string;
    }>(ctx, "verificar-acceso.mjs", ruc, {});
  },
});
