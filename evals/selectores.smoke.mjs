// Comprueba que cada referencia a URLS.x / COMPROBANTES.x / DECLARACION_104.x
// que aparece en los scripts exista de verdad en selectores.mjs.
//
// Esta clase de error no la ve el compilador —son .mjs sin tipos— y no la ve
// nadie hasta que el navegador recibe `undefined` y responde
// "url: expected string, got undefined", que no dice cual falta.
//
//   npm run test:selectores

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  COLUMNAS_COMPROBANTES,
  COMPROBANTES,
  DECLARACION_104,
  LOGIN,
  TIPOS_COMPROBANTE,
  URLS,
} from "../agent/sandbox/workspace/sri/lib/selectores.mjs";

const OBJETOS = {
  URLS,
  LOGIN,
  COMPROBANTES,
  TIPOS_COMPROBANTE,
  COLUMNAS_COMPROBANTES,
  DECLARACION_104,
};

const RAIZ = "agent/sandbox/workspace/sri";

async function archivosMjs(dir) {
  const salida = [];
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...(await archivosMjs(ruta)));
    else if (entrada.name.endsWith(".mjs")) salida.push(ruta);
  }
  return salida;
}

const nombres = Object.keys(OBJETOS).join("|");
const patron = new RegExp(`\\b(${nombres})\\.([A-Za-z_][A-Za-z0-9_]*)`, "g");

let fallos = 0;
let revisadas = 0;

for (const archivo of await archivosMjs(RAIZ)) {
  // El propio selectores.mjs define las claves; no tiene sentido validarlo
  // contra si mismo.
  if (archivo.endsWith("selectores.mjs")) continue;

  const contenido = await readFile(archivo, "utf8");
  for (const [, objeto, clave] of contenido.matchAll(patron)) {
    revisadas++;
    if (!(clave in OBJETOS[objeto])) {
      fallos++;
      console.log(`FALLA ${archivo}: ${objeto}.${clave} no existe`);
    }
  }
}

console.log(`${revisadas} referencias revisadas en los scripts.`);

// Y que ninguna URL haya quedado vacia o con un valor que no sea texto.
for (const [nombre, valor] of Object.entries(URLS)) {
  if (typeof valor !== "string" || !valor.startsWith("https://")) {
    fallos++;
    console.log(`FALLA URLS.${nombre} no es una URL https: ${JSON.stringify(valor)}`);
  }
}

console.log(fallos === 0 ? "TODO OK" : `${fallos} FALLAS`);
process.exit(fallos === 0 ? 0 : 1);
