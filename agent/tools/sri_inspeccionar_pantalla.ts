import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";
import { ejecutarScriptSri, leerBinarioSandbox } from "../lib/sri/ejecutar.js";
import { mismoContribuyente } from "../lib/sri/politicas.js";
import { enviarCapturasAlModelo } from "../lib/sri/capturas.js";

const ControlSchema = z.object({
  etiqueta: z.string(),
  tipo: z.string().nullable(),
  id: z.string().nullable(),
  name: z.string().nullable(),
  placeholder: z.string().nullable(),
  ariaLabel: z.string().nullable(),
  texto: z.string().nullable(),
  etiquetaAsociada: z.string().nullable(),
  opciones: z.number().int().optional(),
});

const SalidaSchema = z.object({
  url: z.string(),
  titulo: z.string(),
  arbolAccesibilidad: z.string(),
  controles: z.array(ControlSchema),
  captura: z.string(),
});

type Salida = z.infer<typeof SalidaSchema>;

// La captura viaja aparte: la lee el runtime del sandbox, no el script.
const SalidaConCapturaSchema = SalidaSchema.extend({
  capturaBase64: z.string().nullable(),
});

export default defineTool({
  description:
    "MODO EXPLORACIÓN: abre sesión y describe una pantalla del portal (árbol de accesibilidad, controles con sus atributos y una captura). Usala cuando un paso falle porque un selector ya no resuelve, para ver qué hay realmente en la pantalla y proponer el selector correcto. Solo lee.",
  inputSchema: z.object({
    ruc: z.string().regex(/^\d{13}$/),
    url: z.string().url().describe("Pantalla a inspeccionar. Las conocidas están en selectores.mjs."),
    esperarSelector: z
      .string()
      .optional()
      .describe("Selector a esperar antes de inventariar, si la pantalla se pinta en dos etapas."),
  }),
  outputSchema: SalidaConCapturaSchema,
  approval: (contexto) => mismoContribuyente(contexto) ?? "not-applicable",
  label: {
    start: ({ url }) => `Inspeccionar pantalla · ${url.slice(0, 60)}`,
    complete: (_entrada, salida) =>
      `${salida.controles.length} controles en "${salida.titulo}"`,
  },
  async execute({ ruc, url, esperarSelector }, ctx) {
    const salida = await ejecutarScriptSri<Salida>(ctx, "inspeccionar-pantalla.mjs", ruc, {
      url,
      esperarSelector,
    });
    const capturaBase64 = await leerBinarioSandbox(ctx, salida.captura);
    return { ...salida, capturaBase64 };
  },
  toModelOutput(salida) {
    const partes = [
      toolOutputPart.text(
        `Pantalla: ${salida.titulo}\nURL: ${salida.url}\n\n` +
          `Árbol de accesibilidad (así se direcciona con getByRole):\n${salida.arbolAccesibilidad}\n\n` +
          `Controles:\n${JSON.stringify(salida.controles, null, 1)}\n\n` +
          "Proponé el selector y verificalo con sri_validar_selector antes de darlo por bueno. " +
          "Preferí getByRole/getByLabel sobre CSS, y para ids de JSF con dos puntos usá " +
          '[id="form:campo"] en vez de "#form\\:campo".',
      ),
    ];
    // La captura solo va al modelo si esta habilitado; la UI la muestra igual
    // porque recibe la salida completa en action.result.
    if (salida.capturaBase64 !== null && enviarCapturasAlModelo()) {
      partes.push(toolOutputPart.file(salida.capturaBase64, { mediaType: "image/png" }));
    }
    return toolOutput.content(partes);
  },
});
