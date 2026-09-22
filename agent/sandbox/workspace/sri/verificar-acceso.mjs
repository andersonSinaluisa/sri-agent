// Comprueba que las credenciales abren sesión en SRI en línea.
// No modifica nada en el portal.
import { ejecutar } from "./lib/runner.mjs";
import { asegurarSesion } from "./lib/portal.mjs";

await ejecutar("verificar-acceso", async ({ page, credenciales, guardarSesion }) => {
  const reautenticado = await asegurarSesion(page, credenciales, guardarSesion);
  return {
    ruc: credenciales.ruc,
    reautenticado,
    url: page.url(),
    titulo: await page.title(),
  };
});
