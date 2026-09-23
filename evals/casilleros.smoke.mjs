// Formateo de los casilleros del Formulario 104.
//
// Los valores de referencia salieron del formulario REAL de marzo 2026, donde
// se ve que el 104 mezcla tres tipos de campo sin declararlo en ningún lado:
// conteos sin decimales, importes con dos, y el factor de proporcionalidad
// con cuatro. Tratarlos a todos como centavos escribía "0.42" donde iban 42
// comprobantes.
//
//   npm run test:casilleros
import {
  decimalesDe,
  formatearCasillero,
} from "../agent/sandbox/workspace/sri/lib/formulario104.mjs";

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
      console.error(
        `FALLÓ ${nombre}\n  esperaba que dijera "${fragmento}"\n  dijo "${error.message}"`,
      );
      fallos += 1;
    }
  }
}

// ── Cuántos decimales usa cada campo ────────────────────────────────────────
igual(decimalesDe("0"), 0, "conteo: sin decimales");
igual(decimalesDe("0.00"), 2, "importe: dos decimales");
igual(decimalesDe("0.0000"), 4, "factor: cuatro decimales");
igual(decimalesDe("1.234,56"), 2, "importe con separador de miles");
igual(decimalesDe(""), 0, "campo vacío");
igual(decimalesDe(null), 0, "campo sin valor");

// ── Importes: lo que muestra el 401 y compañía ──────────────────────────────
igual(
  formatearCasillero("401", 123_456, "0.00"),
  { valor: "1234.56", tipo: "importe" },
  "401: centavos -> importe",
);
igual(
  formatearCasillero("500", 126, "0.00"),
  { valor: "1.26", tipo: "importe" },
  "500: 126 centavos -> 1.26",
);
igual(
  formatearCasillero("609", 0, "0.00"),
  { valor: "0.00", tipo: "importe" },
  "609: cero se escribe con decimales",
);

// ── Conteos: 111, 113, 115, 117, 119 y 486 no son dinero ────────────────────
igual(
  formatearCasillero("111", 42, "0"),
  { valor: "42", tipo: "conteo" },
  "111: 42 comprobantes, no 0.42",
);
igual(
  formatearCasillero("486", 3, "0"),
  { valor: "3", tipo: "conteo" },
  "486: mes a pagar",
);
lanza(
  () => formatearCasillero("111", -1, "0"),
  "conteo",
  "un conteo no admite negativos",
);

// ── El factor de proporcionalidad no se escribe ─────────────────────────────
lanza(
  () => formatearCasillero("563", 5000, "0.0000"),
  "4 decimales",
  "563: se niega a tratar el factor como importe",
);

// ── Un valor que no es entero es un error de unidad ─────────────────────────
lanza(
  () => formatearCasillero("401", 1234.56, "0.00"),
  "no es un entero",
  "rechaza decimales: los montos van en centavos enteros",
);

if (fallos > 0) {
  console.error(`\n${fallos} comprobaciones fallaron.`);
  process.exit(1);
}
console.log("TODO OK");
