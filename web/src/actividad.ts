/**
 * Proyecta el stream crudo de eve en una lista de actividades para mostrar en
 * vivo lo que está haciendo el agente.
 *
 * Los tres eventos de acción traen `presentation` indexado por `callId`, con
 * el `label` que producen `label.start` / `label.delta` / `label.complete` de
 * cada tool. Se correlaciona por `callId`, nunca por orden: las llamadas
 * pueden solaparse y llegar entrelazadas.
 *
 * Los eventos se tipan a mano y se navegan de forma defensiva porque vienen
 * del stream, no de un contrato que el compilador pueda verificar acá.
 */

export type EstadoActividad = "corriendo" | "hecho" | "fallado";

export interface Actividad {
  readonly callId: string;
  readonly etiqueta: string;
  readonly estado: EstadoActividad;
  readonly orden: number;
}

function comoRegistro(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null ? (valor as Record<string, unknown>) : null;
}

/** Devuelve las etiquetas de un evento de acción, indexadas por callId. */
function etiquetasDe(datos: Record<string, unknown>): Map<string, string> {
  const etiquetas = new Map<string, string>();
  const presentacion = comoRegistro(datos["presentation"]);
  if (presentacion === null) return etiquetas;
  for (const [callId, valor] of Object.entries(presentacion)) {
    const etiqueta = comoRegistro(valor)?.["label"];
    if (typeof etiqueta === "string" && etiqueta.length > 0) etiquetas.set(callId, etiqueta);
  }
  return etiquetas;
}

/** Los callId que un evento de acción toca, con o sin etiqueta. */
function callIdsDe(tipo: string, datos: Record<string, unknown>): string[] {
  if (tipo === "actions.requested") {
    const acciones = datos["actions"];
    if (!Array.isArray(acciones)) return [];
    return acciones
      .map((accion) => comoRegistro(accion)?.["callId"])
      .filter((id): id is string => typeof id === "string");
  }
  const callId = comoRegistro(datos["result"])?.["callId"];
  return typeof callId === "string" ? [callId] : [];
}

export function proyectarActividades(eventos: readonly unknown[]): Actividad[] {
  const porCallId = new Map<string, Actividad>();
  let orden = 0;

  for (const evento of eventos) {
    const registro = comoRegistro(evento);
    const tipo = registro?.["type"];
    if (typeof tipo !== "string") continue;
    if (tipo !== "actions.requested" && tipo !== "action.partial" && tipo !== "action.result") {
      continue;
    }

    const datos = comoRegistro(registro?.["data"]);
    if (datos === null) continue;

    const etiquetas = etiquetasDe(datos);
    const fallo = tipo === "action.result" && datos["error"] !== undefined;
    const estado: EstadoActividad =
      tipo === "action.result" ? (fallo ? "fallado" : "hecho") : "corriendo";

    for (const callId of callIdsDe(tipo, datos)) {
      const previa = porCallId.get(callId);
      porCallId.set(callId, {
        callId,
        // Una etiqueta ausente no borra la anterior: `label.complete` no corre
        // en llamadas fallidas, y ahí queremos conservar la de inicio.
        etiqueta: etiquetas.get(callId) ?? previa?.etiqueta ?? "trabajando",
        estado,
        orden: previa?.orden ?? orden++,
      });
    }
  }

  return [...porCallId.values()].sort((a, b) => a.orden - b.orden);
}
