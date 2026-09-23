import { log } from "./runner.mjs";
import { LOGIN, URLS } from "./selectores.mjs";

/**
 * Descarte rápido por cookies.
 *
 * Solo responde con certeza en NEGATIVO: sin cookie vigente no hay sesión.
 * Lo contrario no se puede afirmar — una cookie presente puede estar
 * invalidada del lado del servidor, que es quien decide. Por eso cuando
 * devuelve `true` todavía hay que confirmar contra la pantalla.
 */
export async function hayCookiesDeSesion(contexto) {
  const ahoraSegundos = Date.now() / 1000;
  const cookies = await contexto.cookies();

  const vigentes = cookies.filter(
    // expires === -1 es cookie de sesión del navegador: vive mientras el
    // contexto siga abierto, así que cuenta como vigente.
    (c) => c.expires === -1 || c.expires > ahoraSegundos,
  );

  return vigentes.some((c) =>
    LOGIN.cookiesSesion.some((nombre) => c.name === nombre || c.name.startsWith(nombre)),
  );
}

/**
 * Qué dice la pantalla de login cuando rechaza el intento.
 *
 * Primero se prueban los contenedores de error de Keycloak; si ninguno
 * aparece —no están verificados contra este portal— se cae a leer el texto
 * visible y quedarse con las líneas cortas, que es donde viven los mensajes.
 * Se descarta el texto fijo de la página para que no tape el mensaje real.
 */
const SIN_MENSAJE = "la pantalla no muestra ningún mensaje";

async function motivoDelRechazo(page) {
  const contenedor = page.locator(LOGIN.mensajeError);
  if ((await contenedor.count()) > 0) {
    const texto = (await contenedor.first().innerText()).replace(/\s+/g, " ").trim();
    if (texto !== "") return texto;
  }

  const relleno = [
    "Iniciar sesión",
    "Generar o recuperar clave",
    "Privacidad",
    "Microsoft Edge",
    "Servicio de Rentas Internas",
  ];

  const lineas = (await page.locator("body").innerText().catch(() => ""))
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 3 && l.length < 160)
    .filter((l) => !relleno.some((r) => l.includes(r)));

  return lineas.slice(0, 3).join(" | ") || SIN_MENSAJE;
}

/**
 * Escribe en un campo tecleando de verdad, letra por letra.
 *
 * El formulario de login del SRI bloquea pegar y validar por DOM:
 *
 *   onpaste="return false"  oncopy="return false"  ondrop="return false"
 *   onkeypress="return soloNumerosLetras(event)"
 *
 * `page.fill()` no teclea: asigna `value` y dispara un `input`. Para un
 * formulario que escucha el teclado, el campo queda como si no se hubiera
 * tocado, y el portal responde igual que ante una clave equivocada. De ahi
 * que las credenciales parecieran incorrectas estando bien.
 *
 * Despues se comprueba la LONGITUD de lo que quedo escrito —nunca el
 * contenido— para detectar un `maxlength` que corto el texto o un filtro de
 * teclas que descarto caracteres.
 */
async function escribirComoPersona(page, selector, texto, nombreCampo) {
  const campo = page.locator(selector);
  await campo.click();
  // Por si quedo algo de un intento anterior.
  await campo.press("Control+a").catch(() => {});
  await campo.press("Delete").catch(() => {});

  // Un retardo pequeno: algunos formularios descartan rafagas instantaneas.
  await campo.pressSequentially(texto, { delay: 25 });

  const escrito = await campo.inputValue();
  if (escrito.length !== texto.length) {
    throw new Error(
      `El campo "${nombreCampo}" acepto ${escrito.length} de ${texto.length} caracteres. ` +
        "Puede ser el maxlength del campo o un filtro de teclas que descarta " +
        "algun caracter de la credencial.",
    );
  }
}

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

  // La cookie de identidad de Keycloak es la señal autoritativa y no depende
  // del DOM de ninguna pantalla. Se emite al autenticar y se borra al cerrar
  // sesion, asi que basta con mirarla donde sea que estemos parados.
  if (await hayCookiesDeSesion(page.context())) return true;

  // Sin la cookie, se da una oportunidad a la marca de pantalla por si el
  // portal aun no la escribio, compitiendo contra el boton de iniciar sesion
  // para no agotar la espera cuando efectivamente no hay sesion.
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
  // Si la cookie de identidad de Keycloak sigue viva, la sesion sirve y no
  // hace falta navegar a ningun lado para comprobarlo.
  if (await hayCookiesDeSesion(page.context())) {
    log("Sesión reutilizada desde el estado guardado.");
    return false;
  }
  log("Sin cookies de sesión vigentes.");

  // Se empieza de cero. Keycloak guarda el estado del flujo de autenticacion
  // en cookies (AUTH_SESSION_ID, KC_RESTART); si quedaron viciadas de un
  // intento anterior, vuelve a pintar el formulario SIN mensaje de error, que
  // es indistinguible de una clave equivocada.
  await page.context().clearCookies();
  log("Autenticando desde una sesión limpia.");

  await page.goto(URLS.login, { waitUntil: "domcontentloaded" });

  // El portal encadena DOS flujos de autenticacion y pide las credenciales en
  // cada uno. Tras el primer login correcto hace:
  //   callback con session_state -> logout -> auth nuevo contra el cliente
  //   del perfil -> y vuelve a mostrar el formulario.
  // Como el logout intermedio se lleva la sesion SSO, ese segundo formulario
  // hay que completarlo igual que el primero. Llenarlo una sola vez dejaba el
  // proceso a mitad de camino, indistinguible de un rechazo.
  const MAX_ENVIOS = 3;
  let envios = 0;

  while (envios < MAX_ENVIOS) {
    const hayFormulario = await page
      .waitForSelector(LOGIN.campoUsuario, { state: "visible", timeout: envios === 0 ? 30_000 : 10_000 })
      .then(() => true)
      .catch(() => false);

    if (!hayFormulario) break;

    // Si el portal muestra un error, es un rechazo real: no se reintenta.
    // Reenviar credenciales contra un rechazo es lo que bloquea la cuenta.
    if ((await page.locator(LOGIN.mensajeError).count()) > 0) break;

    envios += 1;
    log(`Completando el formulario de login (envío ${envios} de ${MAX_ENVIOS}).`);

    await escribirComoPersona(page, LOGIN.campoUsuario, credenciales.usuario, "usuario");
    await escribirComoPersona(page, LOGIN.campoClave, credenciales.clave, "clave");

    // Enter es como envia una persona; el boton queda de respaldo.
    await page.locator(LOGIN.campoClave).press("Enter");
    const salio = await page
      .waitForURL((u) => !u.href.includes("login-actions/authenticate"), { timeout: 8_000 })
      .then(() => true)
      .catch(() => false);

    if (!salio) {
      log("El Enter no envió el formulario; se prueba el botón.");
      await page.click(LOGIN.botonIngresar).catch(() => {});
    }

    // No se corta por cookies: durante la cadena, KEYCLOAK_IDENTITY existe un
    // instante entre el primer POST y el logout intermedio, y cortar ahi deja
    // el segundo formulario sin completar. Quien decide es la cabecera del
    // bucle: si el formulario no vuelve a aparecer, la cadena termino.
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  }

  log(`Formulario completado ${envios} vez(ces).`);
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

  // Diagnostico del encadenamiento entre aplicaciones.
  //
  // Tras un POST de login correcto, el portal encadena: callback con
  // session_state -> logout -> auth nuevo contra `app-sri-claves-angular`,
  // que es el cliente OIDC de /sri-en-linea/ (el perfil), no una app de
  // cambio de clave. Si ese segundo flujo vuelve a mostrar el formulario, la
  // sesion SSO no sobrevivio al logout intermedio.
  const urlFinal = page.url();
  const enSegundoFlujo = urlFinal.includes(LOGIN.appPerfil);

  const siguePidiendoLogin =
    page.url().includes(LOGIN.rutaAutenticacion) ||
    (await page.locator(LOGIN.campoUsuario).count()) > 0;

  if (siguePidiendoLogin) {
    const motivo = await motivoDelRechazo(page);
    const sinMensaje = motivo === SIN_MENSAJE;

    if (sinMensaje) {
      throw new ErrorCredenciales(
        `El portal siguió pidiendo credenciales tras completar el formulario ` +
          `${envios} vez(ces), sin mostrar ningún mensaje de error. ` +
          (enSegundoFlujo
            ? "Quedó en el flujo del cliente del perfil, así que la cadena de " +
              "autenticación necesita más pasos de los previstos. "
            : "") +
          "Como el portal no reporta ningún error, la clave no es el problema; " +
          "subí MAX_ENVIOS en portal.mjs si la cadena creció. " +
          `URL final: ${urlFinal.slice(0, 160)}`,
      );
    }

    throw new ErrorCredenciales(
      `El SRI rechazó el inicio de sesión del RUC ${credenciales.ruc}. ` +
        `La pantalla dice: "${motivo}". ` +
        "No se reintenta automáticamente: varios fallos seguidos bloquean la cuenta.",
    );
  }

  // Recarga obligatoria: la pantalla donde aterriza la cadena OIDC todavia
  // esta renderizada como anonima. Las cookies de sesion ya estan en el
  // contexto, pero el HTML servido es el previo al login, asi que los
  // marcadores de sesion no aparecen y las pantallas siguientes rompen.
  // Un reload pide la misma URL ya con las cookies puestas.
  //
  // Se recarga en el sitio, sin navegar a `URLS.perfil`: ese vive en
  // /sri-en-linea/, otra aplicacion OIDC con otro client_id, e ir ahi recien
  // autenticado disparaba un flujo nuevo que terminaba en logout y tiraba
  // abajo la sesion recien creada (POST -> 302 -> callback -> .../logout).
  log("Recargando la página para que el portal renderice la sesión.");
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

  if (!(await sesionActiva(page))) {
    throw new Error(
      `Se inició sesión pero no se reconoció la pantalla: quedó en ${page.url()} ` +
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
