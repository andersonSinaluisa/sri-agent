import { eveChannel } from "eve/channels/eve";
import { httpBasic, localDev, type AuthFn } from "eve/channels/auth";

/**
 * Acceso de operador por HTTP Basic. Es lo mínimo razonable para un agente que
 * opera declaraciones tributarias: sin estas variables el canal no acepta a
 * nadie en producción, porque eve falla cerrado.
 *
 * Si el día de mañana hay una app con usuarios, poné ese autenticador primero
 * en el arreglo y dejá este como acceso de servicio.
 *
 * `vercelOidc()` se quitó a propósito: fuera de Vercel no hay emisor de esos
 * tokens y mantenerlo solo agranda la superficie.
 */
function operador(): AuthFn<Request>[] {
  const username = process.env.SRI_AGENTE_USUARIO;
  const password = process.env.SRI_AGENTE_CLAVE;
  if (!username || !password) return [];
  return [httpBasic({ username, password }, { realm: "sri-agent" })];
}

export default eveChannel({
  auth: [
    ...operador(),
    // Solo acepta mientras el proceso es un servidor `eve dev`; en producción
    // no acepta nada.
    localDev(),
  ],
});
