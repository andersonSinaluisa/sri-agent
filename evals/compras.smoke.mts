// Clasificación de compras a partir del listado del portal.
//
//   npm run test:compras
import {
  clasificarCompras,
  deducirTarifa,
  type ComprobanteCompra,
} from "../agent/lib/calculo/compras.ts";

let fallos = 0;

function igual(real: unknown, esperado: unknown, nombre: string): void {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a !== b) {
    console.error(`FALLÓ ${nombre}\n  esperado ${b}\n  obtuvo   ${a}`);
    fallos += 1;
  }
}

function comprobante(
  tipo: string,
  subtotal: number,
  iva: number,
): ComprobanteCompra {
  return {
    rucEmisor: "0992696036001",
    tipoComprobante: tipo,
    subtotalCentavos: subtotal,
    ivaCentavos: iva,
    totalCentavos: subtotal + iva,
  };
}

// ── Deducción de la tarifa ──────────────────────────────────────────────────
igual(deducirTarifa(10_000, 1_500), "quince", "15% exacto");
igual(deducirTarifa(10_000, 500), "cinco", "5% exacto");
igual(deducirTarifa(10_000, 800), "ocho", "8% exacto");
igual(deducirTarifa(10_000, 0), "cero", "tarifa 0%");
igual(deducirTarifa(0, 0), "quince", "base cero: cualquier tarifa da 0, gana la primera");

// El caso real del listado: 1.26 de base, 0.19 de IVA. 1.26 × 15% = 0.189,
// que el emisor redondeó a 0.19.
igual(deducirTarifa(126, 19), "quince", "126 centavos con 19 de IVA es 15%");

// Un IVA que no corresponde a ninguna tarifa: el comprobante mezcla varias.
igual(deducirTarifa(10_000, 900), null, "9% no es una tarifa vigente");
igual(deducirTarifa(10_000, 1_200), null, "12% ya no rige");

// ── Clasificación completa ──────────────────────────────────────────────────
const clasificacion = clasificarCompras([
  comprobante("Factura", 10_000, 1_500),
  comprobante("Factura", 5_000, 750),
  comprobante("Factura", 20_000, 0),
  comprobante("Liquidación de compra", 3_000, 450),
  comprobante("Nota de Crédito", 1_000, 150),
  comprobante("Comprobante de Retención", 0, 1_050),
  comprobante("Factura", 10_000, 1_100), // mezcla de tarifas
]);

igual(
  clasificacion.porTarifa.quince,
  { baseCentavos: 18_000, ivaCentavos: 2_700, comprobantes: 3 },
  "suma del 15% (incluye la liquidación de compra)",
);
igual(
  clasificacion.porTarifa.cero,
  { baseCentavos: 20_000, ivaCentavos: 0, comprobantes: 1 },
  "suma de tarifa 0%",
);
igual(
  clasificacion.notasCredito,
  { baseCentavos: 1_000, ivaCentavos: 150, comprobantes: 1 },
  "las notas de crédito van aparte, no netean",
);
igual(
  clasificacion.retenciones,
  { baseCentavos: 0, ivaCentavos: 1_050, comprobantes: 1 },
  "las retenciones no son una compra",
);
igual(clasificacion.sinClasificar.length, 1, "el comprobante mezclado queda marcado");
igual(
  clasificacion.sinClasificar[0]!.ivaCentavos,
  1_100,
  "y se devuelve entero para poder revisarlo",
);
igual(
  clasificacion.conteos,
  { facturas: 4, notasCredito: 1, liquidacionesCompra: 1, retenciones: 1, total: 7 },
  "conteos para los casilleros 111-119",
);

// Un comprobante que no se puede clasificar NO se suma a ninguna tarifa: su
// IVA no puede entrar al crédito tributario por la puerta de atrás.
const sumaIva = Object.values(clasificacion.porTarifa).reduce(
  (total, t) => total + t.ivaCentavos,
  0,
);
igual(sumaIva, 2_700, "el IVA del comprobante sin clasificar no se cuela");

// ── Lo que tiene que fallar ─────────────────────────────────────────────────
try {
  clasificarCompras([
    { ...comprobante("Factura", 100, 15), subtotalCentavos: 1.5 } as ComprobanteCompra,
  ]);
  console.error("FALLÓ: aceptó centavos decimales");
  fallos += 1;
} catch (error) {
  if (!(error as Error).message.includes("entero de centavos")) {
    console.error(`FALLÓ el mensaje de centavos decimales: ${(error as Error).message}`);
    fallos += 1;
  }
}

if (fallos > 0) {
  console.error(`\n${fallos} comprobaciones fallaron.`);
  process.exit(1);
}
console.log("TODO OK");
