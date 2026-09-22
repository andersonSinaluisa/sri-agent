// Comprueba si Chromium puede ALCANZAR el portal del SRI. No inicia sesión ni
// usa las credenciales del portal: solo navega y reporta qué contestó.
//
// Sirve para separar dos fallas que se ven igual desde afuera:
//   - el WAF del SRI corta la conexión del cliente automatizado
//   - los selectores del login no coinciden
import { ejecutar, log } from "./lib/runner.mjs";
import { URLS } from "./lib/selectores.mjs";

await ejecutar("probar-conexion", async ({ page }) => {
  const url = URLS.inicio;
  log(`Navegando a ${url}`);

  const inicio = Date.now();
  let estado = null;
  let errorNavegacion = null;

  try {
    const respuesta = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    estado = respuesta === null ? null : respuesta.status();
  } catch (error) {
    errorNavegacion = error instanceof Error ? error.message : String(error);
  }

  const ms = Date.now() - inicio;

  if (errorNavegacion !== null) {
    throw new Error(
      `Chromium no pudo cargar el portal tras ${ms}ms: ${errorNavegacion}\n` +
        "Para interpretarlo: si desde otra maquina (otra IP) el portal SI responde, " +
        "lo que falla es la salida de red de este host, no el navegador. " +
        "Configura SRI_PROXY con una salida que alcance al SRI, o corre el agente " +
        "en una maquina que ya lo alcance.",
    );
  }

  // Cuánto del DOM llegó realmente: un WAF suele devolver 200 con una página
  // de desafío, no un error.
  const texto = (await page.locator("body").innerText().catch(() => "")).slice(0, 400);
  const html = await page.content();

  return {
    url: page.url(),
    estadoHttp: estado,
    ms,
    titulo: await page.title(),
    bytesHtml: html.length,
    inicioDelTexto: texto.replace(/\s+/g, " ").trim(),
  };
});
