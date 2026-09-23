import { defineTool } from "eve/tools";
import { z } from "zod";
import { diagnosticarCredencial, rucsConfigurados } from "../lib/sri/credenciales.js";

export default defineTool({
  description:
    "Dice para qué RUC hay credenciales de SRI en línea configuradas en el entorno del runtime. Llamala ANTES de afirmar que faltan credenciales: nunca lo supongas. No devuelve usuarios ni claves.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    rucsConfigurados: z.array(z.string()),
    hayCredenciales: z.boolean(),
    variableEsperada: z.string(),
    // Forma de cada credencial, nunca su contenido. Con esto se distingue
    // "la clave es incorrecta" de "la clave llegó con basura invisible".
    diagnostico: z.array(
      z.object({
        ruc: z.string(),
        configurada: z.boolean(),
        enBase64: z.boolean(),
        formatoValido: z.boolean(),
        teniaRetornoCarro: z.boolean(),
        teniaComillas: z.boolean(),
        teniaEspaciosAlBorde: z.boolean(),
        longitudUsuario: z.number().int(),
        longitudClave: z.number().int(),
      }),
    ),
  }),
  label: {
    start: () => "Revisar credenciales configuradas",
    complete: (_entrada, salida) => {
      if (!salida.hayCredenciales) return "Sin credenciales configuradas";
      const sucias = salida.diagnostico.filter(
        (d) => d.teniaRetornoCarro || d.teniaComillas || !d.formatoValido,
      ).length;
      return sucias > 0
        ? `${salida.rucsConfigurados.length} RUC · ${sucias} con problemas de formato`
        : `Credenciales para ${salida.rucsConfigurados.length} RUC`;
    },
  },
  execute() {
    // Solo los nombres de RUC; los valores nunca salen de process.env.
    const rucs = rucsConfigurados();
    return {
      rucsConfigurados: rucs,
      hayCredenciales: rucs.length > 0,
      variableEsperada: 'SRI_CRED_<RUC>="usuario:clave"',
      diagnostico: rucs.map(diagnosticarCredencial),
    };
  },
});
