// ┌──────────────────────────────────────────────────────────────────────────┐
// │  ÚNICO ARCHIVO ACOPLADO AL DOM DE SRI EN LÍNEA                           │
// │                                                                          │
// │  Los valores de abajo son PLACEHOLDERS. Hay que capturarlos contra el    │
// │  portal real antes del primer uso, y volver a capturarlos cada vez que   │
// │  el SRI rediseñe una pantalla. Ningún otro archivo del proyecto conoce   │
// │  selectores, de modo que una actualización del portal se arregla aquí.   │
// │                                                                          │
// │  Cómo capturarlos:                                                       │
// │    npx playwright codegen https://srienlinea.sri.gob.ec                  │
// │  Preferí, en este orden: getByRole / getByLabel / getByText  >  id       │
// │  estable  >  CSS estructural. Nunca clases autogeneradas.                │
// └──────────────────────────────────────────────────────────────────────────┘

export const URLS = {
  // Punto de entrada autenticado. Sin sesion redirige al login de Keycloak en
  // /auth/realms/Internet/..., con parametros de estado que cambian en cada
  // visita: por eso se apunta aca y no a la URL del formulario.
  login: "https://srienlinea.sri.gob.ec/tuportal-internet/",

  // Home publica. Sirve para probar conectividad sin sesion.
  inicio: "https://srienlinea.sri.gob.ec/sri-en-linea/inicio/NAT",

  // Donde aterriza el portal despues de autenticar. Sin sesion redirige al
  // login, que es justo lo que `asegurarSesion` necesita detectar.
  perfil: "https://srienlinea.sri.gob.ec/sri-en-linea/contribuyente/perfil",

  // VERIFICADA. Punto de entrada que exige sesion.
  comprobantesRecibidos:
    "https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=57&idGrupo=55",

  // VERIFICADA. Enlace directo al Formulario IVA. Se va derecho aca en vez de
  // abrir el menu hamburguesa y recorrer DECLARACIONES > Declaracion de
  // impuestos > Elaboracion y envio: menos clics y menos que se rompa.
  declaracionIva:
    "https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=310&idGrupo=201",

  // Listado de formularios, por si hiciera falta navegarlo.
  menuDeclaraciones:
    "https://srienlinea.sri.gob.ec/sri-en-linea/SriDeclaraciones/Publico/declaraciones",
};

export const LOGIN = {
  // VERIFICADOS contra el portal con `npm run sri:inspeccionar`.
  // El login es Keycloak, de ahi los ids con prefijo kc-.
  campoUsuario: "#usuario",
  campoCiAdicional: "#ciAdicional", // opcional: solo para usuarios adicionales
  campoClave: "#password",
  botonIngresar: "#kc-login",

  // La sesion se detecta por la URL del realm de Keycloak...
  rutaAutenticacion: "/auth/realms/",

  // ...y ADEMAS por una marca POSITIVA de estar autenticado. No alcanza con
  // "no veo el formulario de login": cuando la sesion caduca, el portal
  // manda a la home publica, que tampoco lo tiene. Con solo la comprobacion
  // negativa el agente creia tener sesion y seguia operando sin ella, y todo
  // fallaba despues como "selector no encontrado".
  // Estos componentes solo existen en el perfil del contribuyente.
  marcaSesionActiva: "perfil-contribuyente, sri-datos-contribuyente",

  // La home publica ofrece "Iniciar sesion"; el perfil no.
  marcaSesionAusente: "text=Iniciar sesión",

  // Mensaje de credenciales rechazadas. Sin verificar todavia: son los
  // contenedores estandar de Keycloak. Si el login falla sin decir por que,
  // revisar esto primero.
  mensajeError: "#input-error, .alert-error, .kc-feedback-text",
};

// Los ids de JSF llevan dos puntos, que en CSS son el inicio de una
// pseudo-clase. Se usan selectores de atributo en vez de "#id" escapado:
// un escape perdido produce "no es un selector valido", que es un error
// confuso y facil de introducir al editar.
/**
 * Comprobantes electronicos recibidos. VERIFICADO contra el portal.
 *
 * Los ids de JSF llevan dos puntos, que en CSS inician una pseudo-clase: van
 * como [id="..."] y no como "#form\:campo".
 *
 * OJO: la consulta esta protegida por reCAPTCHA Enterprise invisible
 * (`executeRecaptcha('consulta_cel_recibidos','SI')` sobre el boton). Es por
 * puntaje, no por desafio visual, asi que un navegador automatizado puede
 * pasar o puede ser rechazado sin mensaje claro. Si la tabla queda vacia
 * habiendo comprobantes, sospecha de esto antes que del selector.
 */
export const COMPROBANTES = {
  selectAnio: '[id="frmPrincipal:ano"]',
  selectMes: '[id="frmPrincipal:mes"]',
  selectDia: '[id="frmPrincipal:dia"]',
  selectTipoComprobante: '[id="frmPrincipal:cmbTipoComprobante"]',
  botonConsultar: '[id="frmPrincipal:btnBuscar"]',

  tablaResultados: '[id="frmPrincipal:tablaCompRecibidos"]',
  // PrimeFaces DataTable: las filas viven en el tbody con sufijo _data.
  filasResultados: '[id="frmPrincipal:tablaCompRecibidos_data"] tr[data-ri]',
  enlaceDescargarListado: '[id="frmPrincipal:lnkTxtlistado"]',
  mensajeSinResultados: "text=No se encontraron registros",
};

/**
 * Codigos del desplegable de tipo de comprobante, tal como los emite el
 * portal. No siguen la numeracion de los codigos de documento del SRI: aca
 * nota de credito es 3, no 4.
 */
export const TIPOS_COMPROBANTE = {
  factura: "1",
  liquidacionCompra: "2",
  notaCredito: "3",
  notaDebito: "4",
  retencion: "6",
};

/**
 * Columnas de la tabla de resultados, por indice. Doce columnas, y dos de
 * ellas traen dos datos juntos: el RUC y la razon social vienen separados por
 * un salto de linea, y el tipo y la serie por espacios.
 */
export const COLUMNAS_COMPROBANTES = {
  nro: 0,
  rucYRazonSocial: 1,
  tipoYSerie: 2,
  claveAcceso: 3,
  fechaHoraAutorizacion: 4,
  fechaEmision: 5,
  valorSinImpuestos: 6,
  iva: 7,
  importeTotal: 8,
};

export const DECLARACION_104 = {
  // ── Paso 1: Periodo Fiscal ── VERIFICADO contra el portal ────────────────
  formulario: 'form[id="frmFlujoDeclaracion"]',

  // SelectOneMenu de PrimeFaces: el <select> real esta oculto y hay que
  // manejar el widget. Se elige por TEXTO, nunca por value: el portal emite
  // "class ec.gob.sri.adm.catalogo.modelo.ObligacionTributaria@33", que es el
  // hash de un objeto Java y cambia entre despliegues.
  selectObligacion: "frmFlujoDeclaracion:somObligacion",
  textoObligacionMensual: "2011",
  textoObligacionSemestral: "2021",

  // Calendar de PrimeFaces en formato mm/yy, con el teclado bloqueado.
  campoPeriodo: "frmFlujoDeclaracion:calPeriodo",

  botonSiguientePeriodo: '[id="frmFlujoDeclaracion:btnObligacionSiguiente"]',

  pasos: '[id="formPasosDeclaracion:pasosDeclaracion"] .ui-steps-item',
  mensajes: '[id="mensajePrincipal"]',

  // ── Paso 2: Preguntas (perfilamiento) ── VERIFICADO ──────────────────────
  // Cada pregunta es un div con id ESTABLE (P006, P018...). Los radios viven
  // adentro con value SI/NO. Se direcciona por id de pregunta + valor, nunca
  // por el indice del repeatCuestionario, que es posicional y se corre si el
  // SRI agrega o quita una pregunta.
  panelPreguntas: '[id="frmFlujoDeclaracion:panelPerfialdor"]',
  contenedorPreguntas: "#contenedorEstiloPanel",
  preguntaPorId: (codigo) => `#${codigo}`,
  radioSi: 'input[type="radio"][value="SI"]',
  radioNo: 'input[type="radio"][value="NO"]',
  textoPregunta: '[id$=":oTxtdetallePregunta"]',

  // Atajo: salta el cuestionario y abre TODAS las secciones del formulario.
  // El propio portal dice "No es necesario contestar las preguntas del
  // perfilamiento". Conviene usarlo: responder que no a una pregunta OCULTA
  // la seccion correspondiente, y con ella sus casilleros.
  enlaceFormularioCompletoDesdePreguntas:
    '[id="frmFlujoDeclaracion:clkFormularioCompleto"]',

  // Carga de la declaracion desde archivo .json/.xml. Sin explorar: seria un
  // camino mas robusto que llenar campo por campo, pero hace falta conocer el
  // esquema que espera.
  campoArchivoDeclaracion: "#archivoInput",

  // ── Paso 3: Formulario ── VERIFICADO contra el portal ────────────────────
  // La cabecera repite RUC, periodo y tipo. Se comprueban ANTES de escribir:
  // llenar el formulario del mes equivocado es el error mas caro posible.
  cabeceraRuc: '[id="frmFlujoDeclaracion:outIdentificacion"]',
  cabeceraRazonSocial: '[id="frmFlujoDeclaracion:outRazonSocial"]',
  cabeceraPeriodo: '[id="frmFlujoDeclaracion:outPeriodoFiscal"]',
  cabeceraTipoDeclaracion: '[id="frmFlujoDeclaracion:outMarcaDeclaracion"]',

  panelFormulario: '[id="frmFlujoDeclaracion:panelFormulario"]',

  // El formulario viene por secciones plegadas; esto las abre todas.
  enlaceVerFormularioCompleto: '[id="frmFlujoDeclaracion:clkVerFormCompleto"]',
  // El boton del modal tiene id j_idt### (autogenerado por JSF, cambia entre
  // versiones): se busca por texto dentro del dialogo visible.
  dialogoFormularioCompleto: ".ui-dialog:visible",
  textoAceptarDialogo: "Aceptar",

  listaErrores: "#itemsMensajesErrores",
  listaAdvertencias: "#itemsMensajesAdvertencias",

  // Los casilleros NO se listan aca: se descubren del DOM en cada corrida.
  // Ver lib/casilleros.mjs.

  // ── Resumen (final del paso 3) ── VERIFICADO ─────────────────────────────
  // El portal calcula multa e interes por su cuenta y los muestra bloqueados.
  // Se leen para CONTRASTARLOS con nuestro calculo, no para reemplazarlos.
  resumenTotalAPagar: '[id="frmFlujoDeclaracion:totalAPagar"]',
  resumenInteres: '[id="frmFlujoDeclaracion:valorInteres_input"]',
  resumenMulta: '[id="frmFlujoDeclaracion:valorMulta_input"]',
  botonSiguienteResumen: '[id="frmFlujoDeclaracion:divBotonContinuarConfirmacionEnviar"]',
  botonAnteriorResumen: '[id="frmFlujoDeclaracion:divBotonAtrasConfirmacion"]',

  // Aparece cuando la declaracion va tarde; pide responder un cuestionario.
  dialogoSanciones: '[id="frmFlujoDeclaracion:multasPecuniariasdlq"]',

  // ── Paso 4: Pago ── VERIFICADO ───────────────────────────────────────────
  pagoPendiente: '[id="frmFlujoDeclaracion:txtPendientePago"]',
  // Los radios llevan como value un hash de objeto Java
  // (ConfiguracionMedioPagoTo@408789374), que cambia entre despliegues: se
  // eligen por indice, no por valor.
  medioPagoOtrasFormas: '[id="frmFlujoDeclaracion:sorMedioPagoSeleccionSimple:0"]',
  medioPagoConvenioDebito: '[id="frmFlujoDeclaracion:sorMedioPagoSeleccionSimple:1"]',
  panelComprobante: '[id="frmFlujoDeclaracion:panelImpresionComprobante"]',

  // ── Confirmacion ── VERIFICADO ───────────────────────────────────────────
  // OJO: el portal pinta el exito con la clase "ui-messages-fatal", la misma
  // que usa para errores. Hay que reconocerlo POR TEXTO; mirar la clase haria
  // leer una declaracion presentada como un fallo.
  panelMensajePrincipal: "#mensajePrincipal",
  textoDeclaracionPresentada: "Su declaración ha sido procesada satisfactoriamente",
};

// Cada URL tiene que ser una cadena no vacia. Sin esto, quitar o renombrar una
// entrada llega hasta Playwright como `page.goto(undefined)` y el error que se
// ve es "url: expected string, got undefined", que no dice cual falta.
for (const [nombre, valor] of Object.entries(URLS)) {
  if (typeof valor !== "string" || valor.length === 0) {
    throw new Error(`URLS.${nombre} no es una URL valida: ${JSON.stringify(valor)}`);
  }
}
