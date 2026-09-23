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
 * Si la clave tiene caracteres que los archivos de entorno maltratan —`$`
 * dispara expansion de variables, `#` puede leerse como comentario, y los
 * parentesis rompen el sourcing en shell— conviene la variante en base64,
 * que no tiene ninguno de esos caracteres:
 *   SRI_CRED_1790012345001_B64=dXN1YXJpbzpjbGF2ZQ==
 * Tiene prioridad sobre la variante en texto plano.
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
    .map((clave) => clave.slice("SRI_CRED_".length).replace(/_B64$/, ""))
    .filter((ruc, i, todos) => todos.indexOf(ruc) === i);
  const unico = process.env.SRI_RUC;
  if (unico !== undefined && !desdePrefijo.includes(unico)) desdePrefijo.push(unico);
  return desdePrefijo;
}

/**
 * Limpia lo que se cuela al escribir un archivo de entorno.
 *
 * Dos cosas invisibles hacen que el portal rechace una clave correcta:
 *
 * - Un retorno de carro al final, cuando el archivo tiene finales de línea de
 *   Windows. systemd no lo quita: el valor llega con el `CR` pegado.
 * - Las comillas que rodean el valor, si quien lo lee no las interpreta.
 *
 * En los dos casos el archivo se ve perfecto y el SRI responde igual que ante
 * una clave equivocada, así que el diagnóstico apunta al lado que no es.
 */
function limpiar(valor: string): string {
  let limpio = valor.replace(/[\r\n]+/g, "").trim();
  for (const comilla of ['"', "'"]) {
    if (limpio.length >= 2 && limpio.startsWith(comilla) && limpio.endsWith(comilla)) {
      limpio = limpio.slice(1, -1);
      break;
    }
  }
  return limpio;
}

/** Señales de que un valor traía basura, para diagnosticar sin exponerlo. */
export interface DiagnosticoCredencial {
  readonly ruc: string;
  readonly configurada: boolean;
  readonly enBase64: boolean;
  readonly formatoValido: boolean;
  readonly teniaRetornoCarro: boolean;
  readonly teniaComillas: boolean;
  readonly teniaEspaciosAlBorde: boolean;
  readonly longitudUsuario: number;
  readonly longitudClave: number;
}

/**
 * Revisa la FORMA de la credencial y nunca devuelve su contenido.
 *
 * Las longitudes sí se informan: sirven para ver de un vistazo que la clave
 * no llegó vacía ni cortada, sin revelar nada de ella.
 */
export function diagnosticarCredencial(ruc: string): DiagnosticoCredencial {
  const enBase64 = process.env[`SRI_CRED_${ruc}_B64`] !== undefined;
  const crudo = (enBase64 ? desdeBase64(ruc) : process.env[`SRI_CRED_${ruc}`]) ?? "";
  const limpio = limpiar(crudo);
  const separador = limpio.indexOf(":");
  const recortado = crudo.trim();

  return {
    ruc,
    configurada: crudo !== "",
    enBase64,
    formatoValido: separador > 0 && limpio.length > separador + 1,
    teniaRetornoCarro: /[\r\n]/.test(crudo),
    teniaComillas: /^".*"$/.test(recortado) || /^'.*'$/.test(recortado),
    teniaEspaciosAlBorde: crudo !== recortado,
    longitudUsuario: separador > 0 ? separador : 0,
    longitudClave: separador > 0 ? limpio.length - separador - 1 : 0,
  };
}

/**
 * Lee la variante en base64, si existe.
 *
 * Es la forma segura de guardar una clave con `$`, `#`, comillas o
 * parentesis: el valor codificado es alfanumerico y ningun parser de
 * archivos de entorno lo toca.
 */
function desdeBase64(ruc: string): string | undefined {
  const codificada = process.env[`SRI_CRED_${ruc}_B64`];
  if (codificada === undefined || codificada.trim() === "") return undefined;
  try {
    return Buffer.from(limpiar(codificada), "base64").toString("utf8");
  } catch {
    throw new Error(`SRI_CRED_${ruc}_B64 no es base64 válido.`);
  }
}

export function resolverCredenciales(ruc: string): CredencialesSri {
  const crudo = desdeBase64(ruc) ?? process.env[`SRI_CRED_${ruc}`];
  if (crudo !== undefined && crudo !== "") {
    const combinada = limpiar(crudo);
    const separador = combinada.indexOf(":");
    if (separador <= 0) {
      throw new Error(`SRI_CRED_${ruc} debe tener el formato "usuario:clave".`);
    }
    const usuario = limpiar(combinada.slice(0, separador));
    const clave = limpiar(combinada.slice(separador + 1));
    if (clave === "") {
      throw new Error(`SRI_CRED_${ruc} no trae clave después de los dos puntos.`);
    }
    return { ruc, usuario, clave };
  }

  const { SRI_RUC, SRI_USUARIO, SRI_CLAVE } = process.env;
  if (SRI_RUC === ruc && SRI_USUARIO !== undefined && SRI_CLAVE !== undefined) {
    return { ruc, usuario: limpiar(SRI_USUARIO), clave: limpiar(SRI_CLAVE) };
  }

  throw new ErrorCredencialesFaltantes(ruc);
}
