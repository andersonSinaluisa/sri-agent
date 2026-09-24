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
  filasDescuadradas: z.number().int().default(0),
  // Cero comprobantes tiene dos causas muy distintas: que el portal diga que
  // el período no tiene ninguno, o que no se haya podido leer la tabla. Sin
  // este campo, `z.object` lo descartaba en silencio y el modelo veía las dos
  // como "no hay nada" — y liquidar un período con cero crédito tributario
  // produce una declaración incorrecta que se presenta sin protestar.
  sinDatos: z.boolean().default(false),
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
      .enum(["1", "2", "3", "4", "6"])
      .default("1")
      .describe(
        "Código del desplegable del portal: 1 factura, 2 liquidación de compra, " +
          "3 nota de crédito, 4 nota de débito, 6 comprobante de retención.",
      ),
  }),
  outputSchema: SalidaSchema,
  label: {
    start: ({ ruc, anio, mes }) => `Comprobantes recibidos · ${ruc} · ${anio}-${mes}`,
    complete: (_entrada, salida) => `${salida.filas.length} comprobantes descargados`,
  },
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
    const baseTotal = salida.filas.reduce((suma, fila) => suma + fila.subtotalCentavos, 0);

    // Una lista vacía sin confirmación del portal NO es un período sin
    // comprobantes: es una lectura que falló. Se dice explícitamente para que
    // el modelo no la use como insumo de una liquidación.
    const avisos: string[] = [];
    if (salida.filas.length === 0 && !salida.sinDatos) {
      avisos.push(
        "NO se leyó ningún comprobante y el portal TAMPOCO confirmó que el período esté " +
          "vacío. No liquides con esto: verificá el período en el portal antes de seguir.",
      );
    }
    if (salida.filasDescuadradas > 0) {
      avisos.push(
        `${salida.filasDescuadradas} comprobantes donde base + IVA no da el total. ` +
          "Puede haber cambiado el orden de las columnas del portal.",
      );
    }

    return {
      type: "json",
      value: {
        periodo: salida.periodo,
        comprobantes: salida.filas.length,
        baseTotalCentavos: baseTotal,
        ivaTotalCentavos: ivaTotal,
        periodoVacioConfirmadoPorElPortal: salida.filas.length === 0 && salida.sinDatos,
        archivoListado: salida.archivoListado,
        avisos,
        nota: "El detalle completo quedó en el sandbox; pedilo por clave de acceso si lo necesitás.",
      },
    };
  },
});
