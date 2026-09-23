// Lectura del listado de comprobantes que exporta el portal.
//
// El mapeo va por NOMBRE de columna, así que lo que se comprueba acá es que
// aguante lo que de verdad cambia entre exportaciones: el separador, el orden
// de las columnas, las tildes y las variantes de redacción del encabezado.
//
//   npm run test:listado
import { leerListado, totalesDelListado } from "../agent/sandbox/workspace/sri/lib/listado.mjs";

let fallos = 0;

function igual(real, esperado, nombre) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a !== b) {
    console.error(`FALLÓ ${nombre}\n  esperado ${b}\n  obtuvo   ${a}`);
    fallos += 1;
  }
}

function lanza(fn, fragmento, nombre) {
  try {
    fn();
    console.error(`FALLÓ ${nombre}: no lanzó ningún error`);
    fallos += 1;
  } catch (error) {
    if (!error.message.includes(fragmento)) {
      console.error(`FALLÓ ${nombre}\n  esperaba que dijera "${fragmento}"\n  dijo "${error.message}"`);
      fallos += 1;
    }
  }
}

// ── Formato habitual: separado por tabulador ────────────────────────────────
const conTabulador = [
  "RUC EMISOR\tRAZON SOCIAL\tTIPO COMPROBANTE\tSERIE\tCLAVE ACCESO\tFECHA EMISION\tFECHA AUTORIZACION\tVALOR SIN IMPUESTOS\tVALOR IVA\tIMPORTE TOTAL",
  "0992696036001\tCOMFARMALSA S.A.\tFactura\t016-021-000620505\t2609202601099269603600120160210006205051234567813\t26/09/2026\t26/09/2026 10:15:00\t1.26\t0.19\t1.45",
  "1790012345001\tOTRA EMPRESA CIA LTDA\tFactura\t001-001-000000042\t2509202601179001234500120010010000000421234567811\t25/09/2026\t25/09/2026 09:00:00\t100.00\t15.00\t115.00",
].join("\n");

const tab = leerListado(conTabulador);
igual(tab.separador, "tabulador", "detecta el tabulador");
igual(tab.filas.length, 2, "lee las dos filas");
igual(tab.filasDescuadradas, 0, "los totales cuadran");
igual(tab.filas[0].rucEmisor, "0992696036001", "RUC del emisor");
igual(tab.filas[0].razonSocialEmisor, "COMFARMALSA S.A.", "razón social");
igual(tab.filas[0].serie, "016-021-000620505", "serie");

// El punto es el separador DECIMAL en este portal: 1.26 son 126 centavos, no
// 12.600. Es el error que más caro sale.
igual(tab.filas[0].subtotalCentavos, 126, "1.26 -> 126 centavos");
igual(tab.filas[0].ivaCentavos, 19, "0.19 -> 19 centavos");
igual(tab.filas[0].totalCentavos, 145, "1.45 -> 145 centavos");
igual(tab.filas[1].subtotalCentavos, 10_000, "100.00 -> 10000 centavos");

igual(
  totalesDelListado(tab.filas),
  { subtotalCentavos: 10_126, ivaCentavos: 1_519, totalCentavos: 11_645 },
  "totales del listado",
);

// ── Mismo contenido, otro separador y otro orden de columnas ────────────────
const conPipe = [
  "Importe Total|Valor IVA|Valor sin impuestos|Fecha Emisión|Razón Social|RUC Emisor",
  "1.45|0.19|1.26|26/09/2026|COMFARMALSA S.A.|0992696036001",
].join("\n");

const pipe = leerListado(conPipe);
igual(pipe.separador, "|", "detecta el pipe");
igual(pipe.filas[0].rucEmisor, "0992696036001", "RUC con columnas invertidas");
igual(pipe.filas[0].subtotalCentavos, 126, "subtotal con columnas invertidas");
igual(pipe.filas[0].ivaCentavos, 19, "IVA con columnas invertidas");
igual(pipe.filas[0].totalCentavos, 145, "total con columnas invertidas");

// ── Miles con punto y decimales con coma ────────────────────────────────────
const conComa = [
  "RUC EMISOR;VALOR SIN IMPUESTOS;VALOR IVA;IMPORTE TOTAL;FECHA EMISION",
  "0992696036001;1.234,56;185,18;1.419,74;26/09/2026",
].join("\n");

const coma = leerListado(conComa);
igual(coma.filas[0].subtotalCentavos, 123_456, "1.234,56 -> 123456 centavos");
igual(coma.filas[0].totalCentavos, 141_974, "1.419,74 -> 141974 centavos");
igual(coma.filasDescuadradas, 0, "cuadra con formato de miles");

// ── Lo que tiene que fallar, y fallar diciendo por qué ──────────────────────
lanza(
  () =>
    leerListado(
      [
        "RUC EMISOR\tFECHA EMISION\tVALOR SIN IMPUESTOS\tIMPORTE TOTAL",
        "0992696036001\t26/09/2026\t1.26\t1.45",
      ].join("\n"),
    ),
  "iva",
  "avisa si falta una columna obligatoria",
);

lanza(() => leerListado(""), "vacío", "avisa si el archivo está vacío");

lanza(
  () => leerListado("esto no es un listado\ntampoco esta linea"),
  "separador",
  "avisa si no reconoce el separador",
);

// Una línea cortada se descarta avisando, en vez de leer importes corridos.
const cortada = leerListado(
  [
    "RUC EMISOR\tVALOR SIN IMPUESTOS\tVALOR IVA\tIMPORTE TOTAL\tFECHA EMISION",
    "0992696036001\t1.26\t0.19\t1.45\t26/09/2026",
    "1790012345001\t100.00",
  ].join("\n"),
);
igual(cortada.filas.length, 1, "descarta la línea cortada");
igual(cortada.lineasDescartadas, [3], "dice qué línea descartó");

// Una fila donde subtotal + IVA no da el total se cuenta, no se oculta.
const descuadrada = leerListado(
  [
    "RUC EMISOR\tVALOR SIN IMPUESTOS\tVALOR IVA\tIMPORTE TOTAL\tFECHA EMISION",
    "0992696036001\t1.26\t0.19\t99.99\t26/09/2026",
  ].join("\n"),
);
igual(descuadrada.filasDescuadradas, 1, "cuenta la fila que no cuadra");

if (fallos > 0) {
  console.error(`\n${fallos} comprobaciones fallaron.`);
  process.exit(1);
}
console.log("TODO OK");
