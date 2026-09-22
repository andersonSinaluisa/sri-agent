/**
 * Resolución de credenciales de SRI en línea.
 *
 * Las credenciales viven solo en variables de entorno del runtime de la app.
 * Nunca se escriben a disco, nunca entran al contexto del modelo y nunca
 * forman parte del resultado de una tool.
 *
 * Formato por contribuyente (permite una cartera de RUC):
 *   SRI_CRED_1790012345001="usuario:clave"
 *
 * Alternativa de un solo contribuyente:
 *   SRI_RUC=1790012345001  SRI_USUARIO=...  SRI_CLAVE=...
 */
export interface CredencialesSri {
  readonly ruc: string;
  readonly usuario: string;
  readonly clave: string;
}

export class ErrorCredencialesFaltantes extends Error {
  constructor(ruc: string) {
    super(
      `No hay credenciales configuradas para el RUC ${ruc}. ` +
        `Definí SRI_CRED_${ruc}="usuario:clave" en el entorno del runtime.`,
    );
    this.name = "ErrorCredencialesFaltantes";
  }
}

export function rucsConfigurados(): string[] {
  const desdePrefijo = Object.keys(process.env)
    .filter((clave) => clave.startsWith("SRI_CRED_"))
    .map((clave) => clave.slice("SRI_CRED_".length));
  const unico = process.env.SRI_RUC;
  if (unico !== undefined && !desdePrefijo.includes(unico)) desdePrefijo.push(unico);
  return desdePrefijo;
}

export function resolverCredenciales(ruc: string): CredencialesSri {
  const combinada = process.env[`SRI_CRED_${ruc}`];
  if (combinada !== undefined && combinada !== "") {
    const separador = combinada.indexOf(":");
    if (separador <= 0) {
      throw new Error(`SRI_CRED_${ruc} debe tener el formato "usuario:clave".`);
    }
    return {
      ruc,
      usuario: combinada.slice(0, separador),
      clave: combinada.slice(separador + 1),
    };
  }

  const { SRI_RUC, SRI_USUARIO, SRI_CLAVE } = process.env;
  if (SRI_RUC === ruc && SRI_USUARIO !== undefined && SRI_CLAVE !== undefined) {
    return { ruc, usuario: SRI_USUARIO, clave: SRI_CLAVE };
  }

  throw new ErrorCredencialesFaltantes(ruc);
}
