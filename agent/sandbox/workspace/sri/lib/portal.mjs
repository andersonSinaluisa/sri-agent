import { log } from "./runner.mjs";
import { LOGIN, URLS } from "./selectores.mjs";

/** Error de credenciales: no se debe reintentar automáticamente. */
export class ErrorCredenciales extends Error {}

/**
 * Hay sesion si el portal no nos mando al login. Se mira la URL y ademas la
 * ausencia del formulario, porque Keycloak a veces sirve el login sin cambiar
 * la barra de direcciones.
 */
async function sesionActiva(page) {
  if (page.url().includes(LOGIN.rutaAutenticacion)) return false;
  return (await page.locator(LOGIN.campoUsuario).count()) === 0;
}

/**
 * Deja la página en el portal con sesión iniciada.
 *
 * Reutiliza el `storageState` guardado cuando sigue vigente; solo escribe las
 * credenciales en el formulario si la sesión caducó. Devuelve `true` cuando
 * tuvo que autenticarse de nuevo.
 */
export async function asegurarSesion(page, credenciales, guardarSesion) {
  await page.goto(URLS.inicio, { waitUntil: "domcontentloaded" });

  if (await sesionActiva(page)) {
    log("Sesión reutilizada desde el estado guardado.");
    return false;
  }

  log("Sesión caducada o inexistente: autenticando.");
  await page.goto(URLS.login, { waitUntil: "domcontentloaded" });
  await page.fill(LOGIN.campoUsuario, credenciales.usuario);
  await page.fill(LOGIN.campoClave, credenciales.clave);
  await page.click(LOGIN.botonIngresar);

  // Se espera a salir del realm de Keycloak, o a que aparezca el error.
  await Promise.race([
    page.waitForURL((u) => !u.href.includes(LOGIN.rutaAutenticacion), { timeout: 45_000 }),
    page.waitForSelector(LOGIN.mensajeError, { timeout: 45_000 }),
  ]).catch(() => {});

  if (await page.locator(LOGIN.mensajeError).count()) {
    const detalle = (await page.locator(LOGIN.mensajeError).first().innerText()).trim();
    throw new ErrorCredenciales(`El SRI rechazó el inicio de sesión: ${detalle}`);
  }

  if (!(await sesionActiva(page))) {
    throw new Error(
      `No se confirmó el inicio de sesión; la página quedó en ${page.url()}. ` +
        "Si el formulario sigue visible, revisá LOGIN en selectores.mjs contra " +
        "la captura de diagnóstico.",
    );
  }

  await guardarSesion();
  log("Autenticación completada; estado de sesión guardado.");
  return true;
}

/** Normaliza un monto del portal ("1.234,56") a centavos enteros. */
export function aCentavos(texto) {
  const limpio = String(texto)
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const valor = Number.parseFloat(limpio);
  if (Number.isNaN(valor)) return 0;
  return Math.round(valor * 100);
}

/** Formatea centavos enteros al formato que espera el formulario del SRI. */
export function deCentavos(centavos) {
  return (centavos / 100).toFixed(2);
}
