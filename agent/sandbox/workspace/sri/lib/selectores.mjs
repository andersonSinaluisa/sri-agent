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
  // visita: por eso se apunta acá y no a la URL del formulario.
  login: "https://srienlinea.sri.gob.ec/tuportal-internet/",
  inicio: "https://srienlinea.sri.gob.ec/sri-en-linea/inicio/NAT",
  // Descubierta con `npm run sri:inspeccionar`. Es un punto de entrada que
  // exige sesion: sin autenticar redirige al login.
  comprobantesRecibidos:
    "https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=57&idGrupo=55",
  declaracionIva:
    "https://srienlinea.sri.gob.ec/sri-en-linea/SriDeclaracionesWeb/Declaraciones/Declaraciones",
};

export const LOGIN = {
  // VERIFICADOS contra el portal con `npm run sri:inspeccionar`.
  // El login es Keycloak, de ahi los ids con prefijo kc-.
  campoUsuario: "#usuario",
  campoCiAdicional: "#ciAdicional", // opcional: solo para usuarios adicionales
  campoClave: "#password",
  botonIngresar: "#kc-login",

  // La sesion se detecta por la URL, no por un elemento: estar o no en el
  // realm de Keycloak es inequivoco y no depende del diseno de la pagina.
  rutaAutenticacion: "/auth/realms/",

  // Mensaje de credenciales rechazadas. Sin verificar todavia: son los
  // contenedores estandar de Keycloak. Si el login falla sin decir por que,
  // revisar esto primero.
  mensajeError: "#input-error, .alert-error, .kc-feedback-text",
};

export const COMPROBANTES = {
  selectAnio: "#frmPrincipal\:ano",
  selectMes: "#frmPrincipal\:mes",
  selectDia: "#frmPrincipal\:dia",
  selectTipoComprobante: "#frmPrincipal\:cmbTipoComprobante",
  botonConsultar: "#frmPrincipal\:btnRecaptcha",
  tablaResultados: "#frmPrincipal\:tablaCompRecibidos",
  filasResultados: "#frmPrincipal\:tablaCompRecibidos tbody tr",
  enlaceDescargarListado: "#frmPrincipal\:lnkTxtlistado",
  mensajeSinResultados: "text=No se encontraron registros",
};

export const DECLARACION_104 = {
  enlaceNuevaDeclaracion: "text=Declaración de IVA",
  selectPeriodoAnio: "#anio",
  selectPeriodoMes: "#mes",
  botonContinuar: "text=Continuar",
  // Mapa casillero -> selector del input en el formulario.
  // Completar con los casilleros que el agente realmente llena.
  casilleros: {
    401: "#casilla401",
    411: "#casilla411",
    421: "#casilla421",
    500: "#casilla500",
    510: "#casilla510",
    520: "#casilla520",
    601: "#casilla601",
    609: "#casilla609",
    615: "#casilla615",
    619: "#casilla619",
    699: "#casilla699",
  },
  botonValidar: "text=Validar",
  resumenLiquidacion: "#resumenLiquidacion",
  // Paso final e irreversible. Solo se usa desde `presentar-104.mjs`.
  botonPresentar: "text=Presentar declaración",
  confirmacionPresentacion: "text=Declaración presentada",
  numeroComprobante: "#numeroComprobante",
  enlaceDescargarComprobante: "text=Descargar comprobante",
};
