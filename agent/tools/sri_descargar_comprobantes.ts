import { defineTool } from "eve/tools";
import { z } from "zod";
import { ejecutarScriptSri } from "../lib/sri/ejecutar.js";
import { mismoContribuyente } from "../lib/sri/politicas.js";

const ComprobanteSchema = z.object({
  rucEmisor: z.string(),
  razonSocialEmisor: z.string(),
  tipoComprobante: z.string(),
  serie: z.string(),
  claveAcceso: z.string(),
  fechaEmision: z.string(),
  fechaAutorizacion: z.string(),
  subtotalCentavos: z.number().int(),
  ivaCentavos: z.number().int(),
  totalCentavos: z.number().int(),
});

const SalidaSchema = z.object({
  periodo: z.object({ anio: z.number().int(), mes: z.number().int() }),
  filas: z.array(ComprobanteSchema),
  archivoListado: z.string().nullable(),
});

type Salida = z.infer<typeof SalidaSchema>;

export default defineTool({
  description:
    "Descarga del portal del SRI los comprobantes electrónicos recibidos de un período. Solo lee. Devuelve montos en centavos enteros.",
  inputSchema: z.object({
    ruc: z.string().regex(/^\d{13}$/),
    anio: z.number().int().min(2010).max(2100),
    mes: z.number().int().min(1).max(12),
    tipoComprobante: z
      .string()
      .default("1")
      .describe("Código del SRI: 1 factura, 4 nota de crédito, 5 nota de débito, 7 retención."),
  }),
  outputSchema: SalidaSchema,
  label: { start: ({ ruc, anio, mes }) => `Comprobantes recibidos · ${ruc} · ${anio}-${mes}` },
  approval: (contexto) => mismoContribuyente(contexto) ?? "not-applicable",
  async execute({ ruc, anio, mes, tipoComprobante }, ctx) {
    return ejecutarScriptSri<Salida>(ctx, "descargar-comprobantes.mjs", ruc, {
      anio,
      mes,
      tipoComprobante,
    });
  },
  toModelOutput(salida) {
    const ivaTotal = salida.filas.reduce((suma, fila) => suma + fila.ivaCentavos, 0);
    return {
      type: "json",
      value: {
        periodo: salida.periodo,
        comprobantes: salida.filas.length,
        ivaTotalCentavos: ivaTotal,
        archivoListado: salida.archivoListado,
        nota: "El detalle completo quedó en el sandbox; pedilo por clave de acceso si lo necesitás.",
      },
    };
  },
});
