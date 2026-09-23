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
  // Descarte por cookies: si no hay ninguna vigente, no hay sesion posible y
  // se evita una navegacion al perfil que solo puede terminar en el login.
  if (await hayCookiesDeSesion(page.context())) {
    // Al perfil y no a la home: la home publica carga con o sin sesion, asi
    // que no sirve para saber si hay que autenticarse.
    await page.goto(URLS.perfil, { waitUntil: "domcontentloaded" });

    if (await sesionActiva(page)) {
      log("Sesión reutilizada desde el estado guardado.");
      return false;
    }
    log("Las cookies estaban vigentes pero el portal no reconoció la sesión.");
  } else {
    log("Sin cookies de sesión vigentes.");
  }

  // Se empieza de cero. Keycloak guarda el estado del flujo de autenticacion
  // en cookies (AUTH_SESSION_ID, KC_RESTART); si quedaron viciadas de un
  // intento anterior, vuelve a pintar el formulario SIN mensaje de error, que
  // es indistinguible de una clave equivocada.
  await page.context().clearCookies();
  log("Autenticando desde una sesión limpia.");

  await page.goto(URLS.login, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(LOGIN.campoUsuario, { timeout: 30_000 });

  await escribirComoPersona(page, LOGIN.campoUsuario, credenciales.usuario, "usuario");
  await escribirComoPersona(page, LOGIN.campoClave, credenciales.clave, "clave");

  // Enter en el campo de clave: es como envia una persona y dispara el submit
  // del formulario. Si a los pocos segundos seguimos en el login, se prueba
  // el boton como respaldo.
  await page.locator(LOGIN.campoClave).press("Enter");
  const salio = await page
    .waitForURL((u) => !u.href.includes(LOGIN.rutaAutenticacion), { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);

  if (!salio) {
    log("El Enter no envió el formulario; se prueba el botón.");
    await page.click(LOGIN.botonIngresar).catch(() => {});
  }

  // Se espera a salir del realm de Keycloak, o a que aparezca el error.
  await Promise.race([
    page.waitForURL((u) => !u.href.includes(LOGIN.rutaAutenticacion), { timeout: 45_000 }),
    page.waitForSelector(LOGIN.mensajeError, { timeout: 45_000 }),
  ]).catch(() => {});

  // Si seguimos en el login, el intento no prosperó. Se lee AQUI lo que dice
  // la pantalla, antes de navegar a ningún lado: antes se iba al perfil
  // primero y eso destruía la única página que explicaba el motivo, dejando
  // como diagnóstico una suposición nuestra en vez de la razón del portal.
  const siguePidiendoLogin =
    page.url().includes(LOGIN.rutaAutenticacion) ||
    (await page.locator(LOGIN.campoUsuario).count()) > 0;

  if (siguePidiendoLogin) {
    const motivo = await motivoDelRechazo(page);
    const sinMensaje = motivo === SIN_MENSAJE;

    throw new ErrorCredenciales(
      `El SRI no aceptó el inicio de sesión del RUC ${credenciales.ruc}. ` +
        (sinMensaje
          ? "El portal volvió a mostrar el formulario SIN ningún mensaje de error. " +
            "Eso NO indica clave incorrecta ni cuenta bloqueada: cuando la clave " +
            "está mal, el portal lo dice. Sin mensaje suele significar que el " +
            "formulario no llegó a enviarse o que el flujo de autenticación caducó."
          : `La pantalla dice: "${motivo}".`) +
        " No se reintenta automáticamente: varios fallos seguidos sí bloquean la cuenta.",
    );
  }

  // Tras autenticar, el portal puede aterrizar en distintas pantallas. Se va
  // al perfil a proposito para comprobar la sesion siempre en el mismo lugar.
  await page.goto(URLS.perfil, { waitUntil: "domcontentloaded" }).catch(() => {});

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
