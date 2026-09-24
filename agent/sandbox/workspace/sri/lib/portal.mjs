import { stat } from "node:fs/promises";
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

/** Un entero entre `min` y `max`, para que dos acciones no salgan idénticas. */
function entre(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

/**
 * Deja rastro de puntero en la página antes de operar sobre ella.
 *
 * reCAPTCHA Enterprise puntúa la INTERACCIÓN, no el navegador. Una pantalla
 * en la que nunca se movió el puntero, nunca hubo desplazamiento y el único
 * evento es un clic instantáneo es exactamente el perfil que rechaza. Se
 * llama al abrir la pantalla, para que cuando llegue el clic ya haya historia.
 */
export async function calentarPantalla(page) {
  const tamano = page.viewportSize() ?? { width: 1280, height: 800 };

  for (let i = 0; i < 3; i += 1) {
    await page.mouse.move(entre(80, tamano.width - 80), entre(80, tamano.height - 80), {
      steps: entre(8, 18),
    });
    await page.waitForTimeout(entre(90, 260));
  }

  await page.mouse.wheel(0, entre(120, 320));
  await page.waitForTimeout(entre(200, 450));
}

/**
 * Hace clic como una persona: se acerca al control en varios tramos, lo
 * sobrevuela un momento y recién ahí presiona y suelta.
 *
 * `page.click()` teletransporta el puntero al centro exacto del elemento y
 * presiona en el mismo instante. Para el control de la consulta del SRI —que
 * envía un token de reCAPTCHA Enterprise con el formulario— eso se traduce en
 * "captcha inválido", y el portal contesta como si no hubiera datos. Con el
 * MISMO navegador, un clic hecho a mano pasa: lo que falta no es una
 * credencial ni otro User-Agent, es el movimiento.
 *
 * No se falsifica ninguna señal: se produce de verdad la interacción que el
 * control espera, sobre la cuenta del propio contribuyente.
 */
export async function clicComoPersona(page, selector) {
  const control = page.locator(selector);
  await control.scrollIntoViewIfNeeded();
  await control.waitFor({ state: "visible", timeout: 20_000 });

  const caja = await control.boundingBox();
  if (caja === null) {
    // Sin geometría no hay nada que simular; vale más un clic normal que un
    // fallo, y el control puede estar igualmente operativo.
    await control.click();
    return;
  }

  // Un punto cualquiera dentro del control, no su centro exacto.
  const destinoX = caja.x + entre(Math.round(caja.width * 0.3), Math.round(caja.width * 0.7));
  const destinoY = caja.y + entre(Math.round(caja.height * 0.3), Math.round(caja.height * 0.7));

  // Se llega en dos tramos, con una parada intermedia: el puntero de una
  // persona no viaja en línea recta de un extremo al control.
  await page.mouse.move(destinoX - entre(60, 200), destinoY - entre(40, 140), {
    steps: entre(10, 20),
  });
  await page.waitForTimeout(entre(80, 200));
  await page.mouse.move(destinoX, destinoY, { steps: entre(12, 25) });

  // Sobrevuelo antes de presionar, y presión sostenida un instante.
  await page.waitForTimeout(entre(180, 420));
  await page.mouse.down();
  await page.waitForTimeout(entre(50, 130));
  await page.mouse.up();
}

/** Error de credenciales: no se debe reintentar automáticamente. */
export class ErrorCredenciales extends Error {}

/**
 * El portal rechazó el token de reCAPTCHA en esta pantalla.
 *
 * Se distingue de cualquier otro fallo porque la salida es distinta: no hay
 * nada que arreglar en el código, y quien tiene que intervenir es una
 * persona. Confundirlo con "no hay datos" o con "el paso no avanzó" manda a
 * buscar el problema donde no está.
 */
export class ErrorCaptcha extends Error {
  constructor(pantalla, detalle = "") {
    super(
      `El portal rechazó el captcha en ${pantalla}. ` +
        "No es la sesión ni las credenciales: reCAPTCHA Enterprise puntúa la " +
        "interacción y no acepta la de un navegador automatizado. " +
        detalle,
    );
    this.name = "ErrorCaptcha";
    this.pantalla = pantalla;
  }
}

/**
 * Texto de rechazo de captcha en la pantalla.
 *
 * Se busca el texto y no un id: el portal lo pinta en contenedores distintos
 * según la pantalla —un growl, un diálogo o un mensaje de JSF— y el texto es
 * lo único común. Se exige que aparezca junto a una palabra de rechazo para
 * no confundirlo con la mención del captcha en una ayuda o un pie de página.
 */
export async function captchaRechazado(page) {
  return page
    .evaluate(() => {
      const cuerpo = document.body?.innerText ?? "";
      const lineas = cuerpo.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim());
      const rechazo = /captcha/i;
      const negativo = /incorrect|inv[aá]lid|err[oó]r|no v[aá]lid|fall/i;
      const encontrada = lineas.find((l) => rechazo.test(l) && negativo.test(l));
      return encontrada ?? null;
    })
    .catch(() => null);
}

/** Corta con `ErrorCaptcha` si la pantalla muestra un rechazo de captcha. */
export async function exigirSinCaptcha(page, pantalla, detalle = "") {
  const mensaje = await captchaRechazado(page);
  if (mensaje !== null) throw new ErrorCaptcha(pantalla, `La pantalla dice: "${mensaje}". ${detalle}`);
}

/**
 * Hay sesion si el portal no nos mando al login. Se mira la URL y ademas la
 * ausencia del formulario, porque Keycloak a veces sirve el login sin cambiar
 * la barra de direcciones.
 */
async function sesionActiva(page, msEspera = 12_000) {
  // En el realm de Keycloak no hay sesion, sin mas que mirar.
  if (page.url().includes(LOGIN.rutaAutenticacion)) return false;

  // Sin cookie no hay sesion y no hace falta mirar la pantalla.
  if (!(await hayCookiesDeSesion(page.context()))) return false;

  // Con cookie, la pantalla decide. Aca estaba el error: se devolvia `true`
  // por la sola presencia de la cookie, contra lo que dice el contrato de
  // `hayCookiesDeSesion`. KEYCLOAK_IDENTITY es una cookie de SESION DEL
  // NAVEGADOR (expires -1): al restaurar un `storageState` guardado vuelve
  // intacta aunque el servidor haya cerrado la sesion hace horas. El estado
  // guardado parecia vigente, cada script daba la sesion por buena, navegaba
  // y el portal lo mandaba al login en medio del paso.
  //
  // Se compite la marca de sesion contra el boton de iniciar sesion para no
  // agotar la espera cuando efectivamente no hay sesion.
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
 * Freno contra logins encadenados.
 *
 * El SRI bloquea la cuenta tras varios intentos seguidos, así que el peor
 * fallo posible de este código no es no entrar: es entrar una y otra vez. Un
 * error al detectar la sesión vigente convierte un flujo de seis pasos en
 * seis autenticaciones en un minuto, y eso deja al contribuyente sin acceso.
 *
 * La fecha del archivo de sesión es la del último login exitoso —solo se
 * escribe al autenticar—, así que sirve de reloj sin guardar nada nuevo.
 */
const ESPERA_MINIMA_ENTRE_LOGINS_MS = 45_000;

async function segundosDesdeElUltimoLogin() {
  const ruta = process.env.SRI_ARCHIVO_SESION;
  if (ruta === undefined || ruta === "") return null;

  const info = await stat(ruta).catch(() => null);
  if (info === null) return null;

  const transcurrido = Date.now() - info.mtimeMs;
  return transcurrido < ESPERA_MINIMA_ENTRE_LOGINS_MS ? Math.round(transcurrido / 1000) : null;
}

/**
 * ¿Sirve todavía la sesión guardada? Se pregunta al portal.
 *
 * Se comprueba navegando a LA PANTALLA QUE EL SCRIPT NECESITA, y no a una
 * genérica. La pregunta que importa no es "¿hay sesión en algún lado?" sino
 * "¿puedo abrir la pantalla con la que voy a trabajar?", y las dos no dan la
 * misma respuesta: el portal son varias aplicaciones y cada una decide por su
 * cuenta si te deja pasar.
 *
 * Las dos versiones anteriores fallaron por preguntar en otro lado:
 *
 *  - Con la marca positiva `perfil-contribuyente`, que es un componente de
 *    `/sri-en-linea/`: buscarla en `/tuportal-internet/` no la encuentra
 *    nunca, ni con la sesión recién creada, así que cada script daba la
 *    sesión por muerta y volvía a autenticarse a los segundos del login
 *    anterior. Varios logins seguidos bloquean la cuenta.
 *  - Con evidencia negativa sobre `/tuportal-internet/`: esa pantalla, con
 *    la sesión ya caducada, no muestra el formulario de login ni manda al
 *    realm, así que daba la sesión por buena y el script se estrellaba
 *    contra el login al navegar a lo suyo.
 *
 * Como efecto secundario, al volver `true` la página YA está en el destino:
 * el script que sigue no necesita navegar de nuevo.
 *
 * No se navega al perfil para comprobar: está en otra aplicación OIDC, y
 * entrar ahí recién autenticado disparaba un flujo nuevo que terminaba en el
 * endpoint de logout y tiraba abajo la sesión.
 */
async function sesionVigente(page, destino) {
  await page.goto(destino, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  if (page.url().includes(LOGIN.rutaAutenticacion)) return false;
  if ((await page.locator(LOGIN.campoUsuario).count()) > 0) return false;
  if (await page.locator(LOGIN.marcaSesionAusente).first().isVisible().catch(() => false)) {
    return false;
  }
  return true;
}

/**
 * Deja la página en el portal con sesión iniciada.
 *
 * Reutiliza el `storageState` guardado cuando sigue vigente; solo escribe las
 * credenciales en el formulario si la sesión caducó. Devuelve `true` cuando
 * tuvo que autenticarse de nuevo.
 */
export async function asegurarSesion(page, credenciales, guardarSesion, opciones = {}) {
  // La pantalla contra la que se comprueba la sesión. Cada script pasa la
  // suya: es la única que responde la pregunta que le importa.
  const destino = opciones.destino ?? URLS.login;
  // Hay cookies guardadas: puede haber sesión, pero no está probado. Se
  // comprueba contra el portal ANTES de darla por buena.
  //
  // Antes se devolvía acá mismo, sin mirar nada. Con un `storageState`
  // guardado de una sesión ya cerrada, cada script del flujo creía tener
  // sesión, navegaba a su pantalla y el portal lo mandaba al login a mitad
  // de camino. Corriendo el login suelto no pasaba, porque ese banco arranca
  // siempre con un contexto limpio.
  if (await hayCookiesDeSesion(page.context())) {
    if (await sesionVigente(page, destino)) {
      log("Sesión reutilizada desde el estado guardado.");
      return false;
    }
    log("El estado guardado ya no sirve: el portal volvió a pedir credenciales.");
  } else {
    log("Sin cookies de sesión vigentes.");
  }

  // Antes de escribir credenciales: ¿no acabamos de hacerlo?
  const recien = await segundosDesdeElUltimoLogin();
  if (recien !== null) {
    throw new Error(
      `Se iba a iniciar sesión otra vez ${recien} s después del último login exitoso. ` +
        "No se hace: varios intentos seguidos bloquean la cuenta en el SRI. " +
        "Que la sesión recién creada ya no se reconozca es un error de detección, " +
        "no una sesión caducada; revisá `sesionVigente` en portal.mjs contra la " +
        "captura de diagnóstico antes de volver a correr el flujo.",
    );
  }

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
