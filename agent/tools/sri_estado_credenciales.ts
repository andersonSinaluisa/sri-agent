import { defineTool } from "eve/tools";
import { z } from "zod";
import { rucsConfigurados } from "../lib/sri/credenciales.js";

export default defineTool({
  description:
    "Dice para qué RUC hay credenciales de SRI en línea configuradas en el entorno del runtime. Llamala ANTES de afirmar que faltan credenciales: nunca lo supongas. No devuelve usuarios ni claves.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    rucsConfigurados: z.array(z.string()),
    hayCredenciales: z.boolean(),
    variableEsperada: z.string(),
  }),
  label: {
    start: () => "Revisar credenciales configuradas",
    complete: (_entrada, salida) =>
      salida.hayCredenciales
        ? `Credenciales para ${salida.rucsConfigurados.length} RUC`
        : "Sin credenciales configuradas",
  },
  execute() {
    // Solo los nombres de RUC; los valores nunca salen de process.env.
    const rucs = rucsConfigurados();
    return {
      rucsConfigurados: rucs,
      hayCredenciales: rucs.length > 0,
      variableEsperada: 'SRI_CRED_<RUC>="usuario:clave"',
    };
  },
});
