import { log } from "./runner.mjs";
import { LOGIN, URLS } from "./selectores.mjs";

/** Error de credenciales: no se debe reintentar automáticamente. */
export class ErrorCredenciales extends Error {}

/**
 * Hay sesion si el portal no nos mando al login. Se mira la URL y ademas la
 * ausencia del formulario, porque Keycloak a veces sirve el login sin cambiar
 * la barra de direcciones.
 */
async function sesionActiva(page, msEspera = 12_000) {
  // En el realm de Keycloak no hay sesion, sin mas que mirar.
  if (page.url().includes(LOGIN.rutaAutenticacion)) return false;

  // Marca POSITIVA: no alcanza con no ver el formulario de login, porque la
  // home publica —a donde redirige el portal cuando caduca la sesion—
  // tampoco lo tiene.
  //
  // Y se ESPERA a que aparezca en vez de contarla al instante: el perfil es
  // una pagina Angular y el componente se monta despues del domcontentloaded.
  // Un count() inmediato lee 0 y concluye que no hay sesion aunque si la haya.
  // Compiten las dos marcas: la que solo existe con sesion y la que solo
  // existe sin ella. Gana la primera que aparezca, asi que resuelve rapido en
  // ambos sentidos en vez de agotar el tiempo de espera cuando no hay sesion.
  return Promise.race([
    page
      .waitForSelector(LOGIN.marcaSesionActiva, { state: "attached", timeout: msEspera })
      .then(() => true),
    page
      .waitForSelector(LOGIN.marcaSesionAusente, { state: "visible", timeout: msEspera })
      .then(() => false),
  ]).catch(() => false);
}

/**
 * Deja la página en el portal con sesión iniciada.
 *
 * Reutiliza el `storageState` guardado cuando sigue vigente; solo escribe las
 * credenciales en el formulario si la sesión caducó. Devuelve `true` cuando
 * tuvo que autenticarse de nuevo.
 */
export async function asegurarSesion(page, credenciales, guardarSesion) {
  // Al perfil y no a la home: la home publica carga con o sin sesion, asi que
  // no sirve para saber si hay que autenticarse.
  await page.goto(URLS.perfil, { waitUntil: "domcontentloaded" });

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

  // Tras autenticar, el portal puede aterrizar en distintas pantallas. Se va
  // al perfil a proposito para comprobar la sesion siempre en el mismo lugar.
  await page.goto(URLS.perfil, { waitUntil: "domcontentloaded" }).catch(() => {});

  if (!(await sesionActiva(page))) {
    // Se separan las dos causas: que el portal siga mostrando el login
    // significa credenciales rechazadas; que muestre otra cosa significa que
    // la marca de sesion ya no sirve.
    const siguePidiendoLogin =
      page.url().includes(LOGIN.rutaAutenticacion) ||
      (await page.locator(LOGIN.campoUsuario).count()) > 0;

    throw new Error(
      siguePidiendoLogin
        ? "El portal volvió a pedir credenciales: el usuario o la clave de " +
          `SRI_CRED_${credenciales.ruc} no son válidos, o la cuenta está bloqueada. ` +
          "NO se reintenta: el SRI bloquea la cuenta tras varios fallos."
        : `Se inició sesión pero no se reconoció la pantalla: quedó en ${page.url()} ` +
          `y no aparece "${LOGIN.marcaSesionActiva}". Revisá LOGIN.marcaSesionActiva ` +
          "en selectores.mjs contra la captura de diagnóstico.",
    );
  }

  await guardarSesion();
  log("Autenticación completada; estado de sesión guardado.");
  return true;
}

/**
 * Normaliza un monto del portal a centavos enteros.
 *
 * El portal no usa un formato unico: la tabla de comprobantes recibidos
 * imprime "1.26" y "115.0" (punto decimal, sin separador de miles), mientras
 * que otras pantallas usan "1.234,56". Asumir uno solo multiplicaba los
 * montos por 100 y ningun total cuadraba.
 *
 * Regla: si hay coma y punto, el ULTIMO que aparece es el decimal y el otro
 * es separador de miles. Si hay uno solo, es decimal salvo que separe grupos
 * de exactamente tres digitos hasta el final ("1.234" -> mil doscientos
 * treinta y cuatro).
 */
export function aCentavos(texto) {
  let limpio = String(texto).replace(/[^\d,.-]/g, "");
  if (limpio === "" || limpio === "-") return 0;

  const ultimaComa = limpio.lastIndexOf(",");
  const ultimoPunto = limpio.lastIndexOf(".");

  let decimal = null;
  if (ultimaComa !== -1 && ultimoPunto !== -1) {
    decimal = ultimaComa > ultimoPunto ? "," : ".";
  } else if (ultimaComa !== -1 || ultimoPunto !== -1) {
    const sep = ultimaComa !== -1 ? "," : ".";
    const posicion = ultimaComa !== -1 ? ultimaComa : ultimoPunto;
    const despues = limpio.length - posicion - 1;
    const unicaAparicion = limpio.indexOf(sep) === posicion;
    // Tres digitos despues de un separador unico: es separador de miles.
    decimal = despues === 3 && unicaAparicion ? null : sep;
  }

  if (decimal === null) {
    limpio = limpio.replace(/[.,]/g, "");
  } else {
    const otro = decimal === "," ? "." : ",";
    limpio = limpio.split(otro).join("").replace(decimal, ".");
  }

  const valor = Number.parseFloat(limpio);
  if (Number.isNaN(valor)) return 0;
  // Se redondea sobre el string en centavos para no arrastrar el error del
  // flotante: 10.55 * 100 da 1054.9999... en coma flotante binaria.
  return Math.round(valor * 100);
}

/** Formatea centavos enteros al formato que espera el formulario del SRI. */
export function deCentavos(centavos) {
  return (centavos / 100).toFixed(2);
}

/**
 * Comprueba que la pantalla esperada realmente cargo, y si no, dice por que.
 *
 * Sin esto, una sesion caida se ve igual que un selector cambiado: el portal
 * redirige a la home publica y lo unico que se reporta es que falto un
 * elemento, que manda a buscar el problema donde no esta.
 */
export async function exigirPantalla(page, selector, nombre) {
  if ((await page.locator(selector).count()) > 0) return;

  const conSesion = await sesionActiva(page);
  throw new Error(
    conSesion
      ? `Hay sesion, pero la pantalla de ${nombre} no tiene "${selector}". ` +
        `Estamos en ${page.url()}. Probablemente cambio el portal: inspeccionala.`
      : `No hay sesion iniciada al abrir ${nombre}; el portal redirigio a ${page.url()}. ` +
        "No es un selector: revisa credenciales o si caduco la sesion guardada.",
  );
}

export { sesionActiva };
