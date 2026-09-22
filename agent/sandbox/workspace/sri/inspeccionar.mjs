// Inventario de una pantalla del portal, para escribir selectores reales.
//
//   npm run sri:inspeccionar -- <url>
//
// Navega a la URL, espera a que el JS termine de pintar, y vuelca:
//   - el arbol de accesibilidad (roles y nombres, que es como se direccionan
//     los elementos con getByRole)
//   - un inventario de inputs, botones, selects y enlaces con sus atributos
//   - una captura, para ver de que pantalla se trata
//
// No usa credenciales reales: sirve para pantallas publicas y, una vez con
// sesion iniciada, para las de adentro.
import { resolve } from "node:path";

process.env.SRI_RUC ??= "0000000000000";
process.env.SRI_USUARIO ??= "inspeccion";
process.env.SRI_CLAVE ??= "inspeccion";
process.env.SRI_DIR_BASE ??= resolve(process.cwd(), ".sri-datos");

const { ejecutar, log, rutaDatos } = await import("./lib/runner.mjs");
const { URLS } = await import("./lib/selectores.mjs");

await ejecutar("inspeccionar", async ({ page, entrada }) => {
  const url = entrada.url ?? process.argv[3] ?? URLS.login;
  log(`Inspeccionando ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  // El portal pinta con JS: sin esto se inventaria el esqueleto vacio.
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

  const inventario = await page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const describir = (el) => ({
      etiqueta: el.tagName.toLowerCase(),
      tipo: el.getAttribute("type"),
      id: el.id || null,
      name: el.getAttribute("name"),
      placeholder: el.getAttribute("placeholder"),
      ariaLabel: el.getAttribute("aria-label"),
      texto: (el.innerText || el.value || "").trim().slice(0, 60) || null,
      // El id del label que lo describe, que suele ser el nombre accesible.
      etiquetaAsociada:
        (el.id && document.querySelector(`label[for="${el.id}"]`)?.innerText?.trim()) || null,
    });

    // Solo controles de formulario. Los enlaces del menu lateral son cientos
    // y ahogan lo unico que sirve para escribir un selector.
    const seleccion = [...document.querySelectorAll("input, button, select, textarea")];
    return seleccion
      .filter(visible)
      .slice(0, 40)
      .map(describir)
      .filter((d) => d.id || d.name || d.texto || d.ariaLabel);
  });

  // Se recorta al area principal: el arbol completo del portal son cientos de
  // lineas de menu que no aportan nada.
  const raiz = (await page.locator("main").count()) > 0 ? page.locator("main").first() : page.locator("body");
  const arbol = await raiz.ariaSnapshot({ timeout: 15_000 }).catch(() => "");
  const captura = rutaDatos("inspeccion", `${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
  await page.screenshot({ path: captura, fullPage: true });

  return {
    url: page.url(),
    titulo: await page.title(),
    // Recortado: el arbol completo de una pantalla del SRI no entra en el
    // contexto del modelo y tampoco hace falta para escribir un selector.
    arbolAccesibilidad: arbol.split("\n").slice(0, 120).join("\n"),
    elementos: inventario,
    captura,
  };
});
