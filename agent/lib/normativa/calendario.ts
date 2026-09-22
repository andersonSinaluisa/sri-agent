/**
 * Plazos de presentación. Todo el dinero y las fechas de este proyecto son
 * deterministas: el modelo nunca los calcula.
 */

/** Noveno dígito del RUC -> día del mes siguiente en que vence la declaración. */
const DIA_POR_NOVENO_DIGITO: Record<string, number> = {
  "1": 10,
  "2": 12,
  "3": 14,
  "4": 16,
  "5": 18,
  "6": 20,
  "7": 22,
  "8": 24,
  "9": 26,
  "0": 28,
};

export type Periodicidad = "mensual" | "semestral";

export function novenoDigito(ruc: string): string {
  if (!/^\d{13}$/.test(ruc)) throw new Error(`RUC inválido: ${ruc}`);
  return ruc[8]!;
}

function esFinDeSemana(fecha: Date): boolean {
  const dia = fecha.getUTCDay();
  return dia === 0 || dia === 6;
}

/**
 * Corre la fecha al siguiente día hábil. `feriados` son fechas `YYYY-MM-DD`;
 * hay que mantenerlas por año, porque los feriados nacionales se trasladan
 * por decreto y el SRI sigue ese calendario.
 */
export function siguienteHabil(fecha: Date, feriados: readonly string[] = []): Date {
  const resultado = new Date(fecha.getTime());
  const conjunto = new Set(feriados);
  while (esFinDeSemana(resultado) || conjunto.has(resultado.toISOString().slice(0, 10))) {
    resultado.setUTCDate(resultado.getUTCDate() + 1);
  }
  return resultado;
}

/**
 * Fecha límite de la declaración de IVA del período indicado.
 *
 * `periodo` es el mes declarado (`{anio, mes}` con mes 1-12). Mensual vence en
 * el mes siguiente; semestral vence en julio (enero–junio) o en enero del año
 * siguiente (julio–diciembre).
 */
export function fechaLimiteIva(
  ruc: string,
  periodo: { readonly anio: number; readonly mes: number },
  periodicidad: Periodicidad = "mensual",
  feriados: readonly string[] = [],
): Date {
  const dia = DIA_POR_NOVENO_DIGITO[novenoDigito(ruc)]!;

  let anioVencimiento: number;
  let mesVencimiento: number; // 1-12

  if (periodicidad === "mensual") {
    anioVencimiento = periodo.mes === 12 ? periodo.anio + 1 : periodo.anio;
    mesVencimiento = periodo.mes === 12 ? 1 : periodo.mes + 1;
  } else if (periodo.mes <= 6) {
    anioVencimiento = periodo.anio;
    mesVencimiento = 7;
  } else {
    anioVencimiento = periodo.anio + 1;
    mesVencimiento = 1;
  }

  return siguienteHabil(
    new Date(Date.UTC(anioVencimiento, mesVencimiento - 1, dia)),
    feriados,
  );
}

export function diasHastaVencimiento(limite: Date, hoy: Date = new Date()): number {
  const unDia = 24 * 60 * 60 * 1000;
  const inicioHoy = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return Math.round((limite.getTime() - inicioHoy) / unDia);
}
