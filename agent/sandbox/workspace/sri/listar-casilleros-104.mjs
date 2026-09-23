// Abre el Formulario 104 de un período y lista sus casilleros. NO escribe
// nada: es de solo lectura, y sirve para saber qué casilleros existen de
// verdad para este contribuyente antes de decidir qué monto va en cada uno.
//
// El 104 no numera sus inputs por casillero (los llama `concepto450`) y qué
// secciones aparecen depende de la actividad del contribuyente y del período.
// Por eso la lista se descubre del DOM en vez de mantenerse a mano.
//
// Entrada: { periodo: {anio, mes}, periodicidad?, soloVisibles? }
// Salida:  { periodo, paso, casilleros: [...], captura }
import { ejecutar, log, rutaDatos } from "./lib/runner.mjs";
import { asegurarSesion } from "./lib/portal.mjs";
import { mapearCasilleros } from "./lib/casilleros.mjs";
import {
  abrirPeriodo,
  pasoResaltado,
  saltarAFormularioCompleto,
  verificarCabecera,
} from "./lib/formulario104.mjs";
import { mkdir, writeFile } from "node:fs/promises";

await ejecutar("listar-casilleros-104", async ({ page, entrada, credenciales, guardarSesion }) => {
  const { periodo, periodicidad = "mensual", soloVisibles = true } = entrada;
  if (!periodo?.anio || !periodo?.mes) throw new Error("Falta `periodo.anio` / `periodo.mes`.");

  await asegurarSesion(page, credenciales, guardarSesion);
  await abrirPeriodo(page, periodo, periodicidad);

  // El cuestionario del paso 2 se salta: el formulario completo muestra
  // todas las secciones, que es justamente lo que hay que inventariar.
  let paso = await pasoResaltado(page);
  if (paso.includes("Preguntas")) {
    await saltarAFormularioCompleto(page);
    paso = await pasoResaltado(page);
  }

  if (!paso.includes("Formulario")) {
    throw new Error(
      `Se llegó al paso "${paso}" y no al formulario. Nada que listar. ` +
        "Revisá la captura de diagnóstico.",
    );
  }

  // Que el período y el RUC en pantalla sean los pedidos: listar casilleros
  // de otro período llevaría a escribir montos donde no van.
  await verificarCabecera(page, { ruc: credenciales.ruc, periodo });

  const mapa = await mapearCasilleros(page);
  const entradas = Object.entries(mapa);

  // Si filtrar por aplicables dejara la lista vacía, se listan todos. Una
  // lista vacía con 156 casilleros descubiertos no es un resultado: es un
  // filtro equivocado, y devolverla en silencio esconde el problema.
  const aplicables = entradas.filter(([, d]) => !d.oculto);
  const filtrar = soloVisibles && aplicables.length > 0;
  if (soloVisibles && aplicables.length === 0 && entradas.length > 0) {
    log(
      `AVISO: los ${entradas.length} casilleros están marcados como no aplicables. ` +
        "Se listan todos igual; revisá la marca data-oculto contra la pantalla.",
    );
  }

  const casilleros = [];

  for (const [numero, destino] of entradas) {
    if (filtrar && destino.oculto) continue;
    const campo = page.locator(destino.selector);
    const existe = (await campo.count()) > 0;

    casilleros.push({
      casillero: numero,
      etiqueta: destino.etiqueta,
      concepto: destino.concepto,
      oculto: destino.oculto,
      selector: destino.selector,
      tipo: destino.tipo,
      conLugar: destino.conLugar,
      // Lo que el formulario ya trae: los calculados por el portal vienen con
      // valor, y esos NO hay que escribirlos.
      valorActual: existe ? await campo.inputValue().catch(() => null) : null,
      editable: existe && (await campo.isEditable().catch(() => false)),
    });
  }

  casilleros.sort((a, b) => Number(a.casillero) - Number(b.casillero));

  await mkdir(rutaDatos("inspeccion"), { recursive: true });
  const base = rutaDatos(
    "inspeccion",
    `casilleros-104-${periodo.anio}-${String(periodo.mes).padStart(2, "0")}`,
  );
  const captura = `${base}.png`;
  await page.screenshot({ path: captura, fullPage: true });
  // El HTML del formulario abierto: es la única forma de revisar el mapeo de
  // casilleros sin volver a recorrer los tres pasos del portal.
  await writeFile(`${base}.html`, await page.content(), "utf8");

  log(`Casilleros listados: ${casilleros.length} (paso "${paso}")`);
  return {
    periodo,
    paso,
    casilleros,
    descubiertos: entradas.length,
    aplicables: aplicables.length,
    captura,
    html: `${base}.html`,
  };
});
