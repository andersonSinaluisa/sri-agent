/**
 * Si las capturas se le mandan al modelo o no.
 *
 * Por defecto NO. Una imagen en el resultado de una tool es lo mas fragil del
 * contrato con el proveedor: algunos modelos solo aceptan imagenes en mensajes
 * del usuario y devuelven 400 al recibirlas en un tool result, y ademas la
 * imagen queda en el historial y se reenvia en cada llamada posterior.
 *
 * Perder esto no cuesta casi nada: el arbol de accesibilidad y el inventario
 * de controles ya alcanzan para proponer un selector, y **la UI muestra la
 * captura igual**, porque los canales reciben la salida completa de la tool
 * aunque `toModelOutput` no la incluya.
 *
 * Activalo con SRI_CAPTURAS_AL_MODELO=1 si usas un modelo con vision que las
 * acepte y querés que razone mirando la pantalla.
 */
export function enviarCapturasAlModelo(): boolean {
  return process.env.SRI_CAPTURAS_AL_MODELO === "1";
}
