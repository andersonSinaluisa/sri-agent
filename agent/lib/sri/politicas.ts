import type { ApprovalContext, ApprovalStatus } from "eve/tools/approval";

/**
 * Un agente que puede operar sobre varios RUC necesita impedir que la sesión
 * de un contribuyente toque los datos de otro. Si el principal autenticado
 * declara un `ruc`, tiene que coincidir con el de la llamada.
 */
export function mismoContribuyente(contexto: ApprovalContext): ApprovalStatus | null {
  const atributos = contexto.session.auth.current?.attributes;
  const rucDelPrincipal = atributos?.["ruc"];
  if (typeof rucDelPrincipal !== "string") return null;

  const rucSolicitado = (contexto.toolInput as { ruc?: unknown } | undefined)?.ruc;
  if (rucDelPrincipal !== rucSolicitado) {
    return { type: "denied", reason: "La sesión no tiene acceso a ese RUC." };
  }
  return null;
}

/**
 * Quién puede aprobar una presentación, por `principalId`.
 * `SRI_APROBADORES="oidc:user-a,oidc:user-b"`. Sin la variable no se restringe
 * quién responde, pero la aprobación humana sigue siendo obligatoria.
 */
export function esAprobadorAutorizado(principalId: string): boolean {
  const lista = process.env.SRI_APROBADORES;
  if (lista === undefined || lista.trim() === "") return true;
  return lista
    .split(",")
    .map((entrada) => entrada.trim())
    .includes(principalId);
}
