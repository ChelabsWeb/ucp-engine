import { diffDias, parseFecha } from "./fechas";
import type { LcInfo } from "./types";

/**
 * Reglas puras de la carta de crédito (UCP 600) que hasta ahora vivían como texto:
 *  - el plazo de presentación ("21 días desde el BL") convertido en una FECHA límite
 *    real, acotada por el vencimiento de la LC (art. 14c: nunca después del vencimiento);
 *  - la tolerancia de cantidad/monto de la LC (39B / "about", "+/- 10 %") como número,
 *    para que la matriz de consistencia use la tolerancia REAL y no un ±5 % fijo.
 */

/** "21 días desde fecha de BL" · "within 21 days after B/L date" · "21 days" → 21. null si no dice. */
export function diasPresentacion(plazo: string | null | undefined): number | null {
  if (!plazo) return null;
  const m = /(\d{1,3})\s*(d[ií]as?|days?|d\b)/i.exec(plazo);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 180 ? n : null;
}

/** UCP 600 art. 14c: plazo de presentación por defecto cuando la LC no lo fija. */
export const UCP_DIAS_PRESENTACION = 21;

export interface LimitePresentacion {
  /** fecha del BL usada (real si la hay, si no la estimada de embarque) */
  fechaBL: Date;
  esEstimada: boolean;
  dias: number;
  /** la LC no fija plazo: rige el de UCP 600 art. 14c (21 días calendario) */
  plazoPorDefectoUCP: boolean;
  /** BL + plazo, SIN acotar (para explicar la CRÍTICA cuando cae después del vencimiento) */
  porPlazo: Date;
  /** el límite operativo: min(BL + plazo, vencimiento) */
  limite: Date;
  /** true si BL + plazo cae después del vencimiento: la ventana real es más corta que el plazo */
  recortadoPorVencimiento: boolean;
}

/** Fecha límite para presentar documentos al banco. null si falta el plazo, la fecha de BL o el vencimiento. */
export function limitePresentacion(
  lc: LcInfo | null | undefined,
  fechaBL: string | null | undefined,
  fechaEmbarqueEstimada: string | null | undefined,
): LimitePresentacion | null {
  if (!lc) return null;
  // UCP 600 art. 14c: si el crédito no dice, la presentación es dentro de los 21 días
  // calendario posteriores al embarque (y nunca después del vencimiento)
  const explicito = diasPresentacion(lc.plazoPresentacion);
  const dias = explicito ?? UCP_DIAS_PRESENTACION;
  const real = fechaBL ? parseFecha(fechaBL) : null;
  const est = !real && fechaEmbarqueEstimada ? parseFecha(fechaEmbarqueEstimada) : null;
  const bl = real ?? est;
  if (!bl) return null;
  const venc = parseFecha(lc.vencimiento);
  if (!venc) return null;
  const porPlazo = new Date(bl.getFullYear(), bl.getMonth(), bl.getDate() + dias);
  const recortado = porPlazo > venc;
  return {
    fechaBL: bl,
    esEstimada: !real,
    dias,
    plazoPorDefectoUCP: explicito == null,
    porPlazo,
    limite: recortado ? venc : porPlazo,
    recortadoPorVencimiento: recortado,
  };
}

/** Días que quedan desde `hoy` hasta el límite (negativo = vencido). */
export function diasParaPresentar(l: LimitePresentacion, hoy: Date): number {
  return diffDias(hoy, l.limite);
}

/** "±5%" · "+/- 10 %" · "5 pct more or less" · "about" (UCP 600 art. 30a: ±10 %) · "0,05" → fracción. null si no se entiende. */
export function parseTolerancia(texto: string | number | null | undefined): number | null {
  if (texto == null) return null;
  if (typeof texto === "number") return Number.isFinite(texto) && texto >= 0 && texto <= 0.5 ? texto : null;
  const t = texto.trim().toLowerCase();
  if (!t || t === "—" || t === "-") return null;
  if (/\b(about|approximately|circa|aprox)/.test(t)) return 0.1;
  // 39B/47A reales: "not allowed", "none", "nil", "no tolerance", "sin tolerancia", "exact"
  if (/\b(sin tolerancia|no tolerance|not allowed|none|nil|exact|exacto|no permitida)\b/.test(t)) return 0;
  const m = /([\d]+(?:[.,]\d+)?)\s*(%|pct|por ?ciento|percent)/.exec(t);
  if (m) {
    const n = Number(m[1].replace(",", "."));
    return Number.isFinite(n) && n >= 0 && n <= 50 ? n / 100 : null;
  }
  const f = Number(t.replace(",", "."));
  return Number.isFinite(f) && f >= 0 && f <= 0.5 ? f : null;
}

/** Caso CSU2025099, 47A: "BENEFICIARY SHOULD ADVISE FULL DETAILS OF SHIPMENT WITHIN 05 DAYS AFTER
 *  SHIPMENT DATE QUOTING POLICY NO IN0099IP000001 TO LANKASEGUROS GENERAL INSURANCE LTD … ON EMAIL
 *  POLIZAS(AT)LANKASEGUROS.EXAMPLE. A CERTIFICATE TO THIS EFFECT MUST ACCOMPANY THE ORIGINAL DOCUMENTS." */
export interface AvisoAseguradora {
  dias: number;
  poliza: string | null;
  email: string | null;
  texto: string;
}
export function avisoAseguradora(condiciones: string[] | null | undefined): AvisoAseguradora | null {
  for (const c of condiciones ?? []) {
    if (!/insur|aseguradora|seguro|policy|póliza|poliza/i.test(c)) continue;
    const m =
      /(?:advise|notify|inform|avisar|notificar|informar)[\s\S]{0,120}?(?:within|dentro de)\s*(\d{1,2})\s*(?:days?|d[ií]as)/i.exec(
        c,
      );
    if (!m) continue;
    const poliza = /policy\s*(?:no\.?|number|nº|n°)?\s*[:.]?\s*([A-Z0-9][A-Z0-9-]{4,})/i.exec(c)?.[1] ?? null;
    const email = /([\w.+-]+)\s*(?:@|\(at\))\s*([\w-]+(?:\.[\w-]+)+)/i.exec(c);
    return { dias: Number(m[1]), poliza, email: email ? `${email[1]}@${email[2]}`.toLowerCase() : null, texto: c };
  }
  return null;
}

/** La tolerancia que rige la operación: la de la LC si está cargada, si no el ±5 % habitual. */
export const TOLERANCIA_DEFAULT = 0.05;
export function toleranciaDe(lc: LcInfo | null | undefined): number {
  return lc?.tolerancia ?? TOLERANCIA_DEFAULT;
}

/**
 * La tolerancia del **importe**, que no es la misma que la de la cantidad (art. 30).
 *
 * Acá estaba el error más caro del motor: se usaba un solo número para las dos, con 5 % por
 * defecto. Ese 5 % es el del artículo 30 (b), que es una tolerancia de CANTIDAD y cuya propia
 * condición es que «el total girado no exceda el importe del crédito». Aplicárselo al importe daba
 * por conforme un giro de 56.000 contra un crédito de 54.150: el banco paga de más y no lo
 * recupera.
 *
 * Hacia arriba, sin 39A ni «about», el tope es el 32B a secas. Hacia abajo el 30 (c) admite un 5 %
 * menos con condiciones, que es otra regla y todavía no está.
 */
export function toleranciaDeImporte(lc: LcInfo | null | undefined): number {
  return lc?.tolerancia ?? 0;
}

/**
 * La tolerancia de la **cantidad** (art. 30 b).
 *
 * El ±5 % rige salvo que el crédito exprese la cantidad en bultos o unidades, que es la primera
 * condición del inciso. No está condicionado al 39A —que es tolerancia de importe— así que un
 * crédito con 39A 00/00 sigue admitiendo el 5 % en la cantidad; si el crédito da más, vale más.
 */
export function toleranciaDeCantidad(lc: LcInfo | null | undefined, enBultos = false): number {
  if (enBultos) return 0;
  return Math.max(lc?.tolerancia ?? 0, TOLERANCIA_DEFAULT);
}

/* ─── A6: ¿cuándo entra la plata? ──────────────────────────────────────────────
   La LC dice cómo y cuándo paga: 41D ("available by negotiation/payment/deferred
   payment") y 42C (tenor: "SIGHT", "90 DAYS AFTER B/L DATE"). Con eso, la fecha de
   presentación y el BL, sale una fecha estimada de cobro para el flujo de caja.
   Los días bancarios de examen son los de UCP 600 art. 14b: 5 días hábiles. */

export const UCP_DIAS_EXAMEN = 5;

export interface CobroEstimado {
  /** días de tenor después del hecho gatillo (0 = a la vista) */
  diasTenor: number;
  /** desde qué se cuenta el tenor: presentación (sight) o fecha de BL */
  desde: "PRESENTACION" | "BL";
  fecha: Date;
  /** cómo quedó explicado, para mostrar */
  texto: string;
}

/** "90 DAYS AFTER B/L DATE" → { dias: 90, desde: 'BL' }; "AT SIGHT" → { dias: 0, desde: 'PRESENTACION' } */
export function tenorDe(
  giros: string | null | undefined,
  disponibleCon?: string | null,
): { dias: number; desde: "PRESENTACION" | "BL" } {
  const t = `${giros ?? ""} ${disponibleCon ?? ""}`.toUpperCase();
  const m = /(\d{1,3})\s*DAYS?/.exec(t);
  const dias = m ? Number(m[1]) : 0;
  // "AFTER B/L DATE" / "FROM SHIPMENT DATE" cuentan desde el embarque; el resto, desde la presentación
  const desdeBL = /B\/?L\s*DATE|BILL OF LADING DATE|SHIPMENT DATE|DATE OF SHIPMENT/.test(t);
  return { dias: dias > 0 && dias <= 360 ? dias : 0, desde: desdeBL ? "BL" : "PRESENTACION" };
}

/** Suma días hábiles (lunes a viernes; los feriados bancarios no se modelan). */
export function sumarHabiles(d: Date, dias: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let quedan = dias;
  while (quedan > 0) {
    r.setDate(r.getDate() + 1);
    const dow = r.getDay();
    if (dow !== 0 && dow !== 6) quedan -= 1;
  }
  return r;
}

/**
 * Fecha estimada de cobro: presentación + 5 días hábiles de examen (art. 14b) y, si el crédito es
 * a plazo, el tenor desde el gatillo que corresponda. `presentacion` es cuándo se presentan (o se
 * presentaron) los documentos; sin ella no hay estimación.
 */
export function cobroEstimado(
  lc: LcInfo | null | undefined,
  presentacion: Date | null,
  fechaBL?: string | null,
): CobroEstimado | null {
  if (!lc || !presentacion) return null;
  const { dias, desde } = tenorDe(lc.giros, lc.librado);
  const examen = sumarHabiles(presentacion, UCP_DIAS_EXAMEN);
  if (dias === 0) {
    return {
      diasTenor: 0,
      desde: "PRESENTACION",
      fecha: examen,
      texto: `A la vista: ${UCP_DIAS_EXAMEN} días hábiles de examen del banco desde la presentación.`,
    };
  }
  const bl = desde === "BL" && fechaBL ? parseFecha(fechaBL) : null;
  const base = bl ?? examen;
  const fecha = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dias);
  return {
    diasTenor: dias,
    desde: bl ? "BL" : "PRESENTACION",
    fecha,
    texto: bl
      ? `A ${dias} días de la fecha de BL (${fechaBL}).`
      : `A ${dias} días de la presentación, más ${UCP_DIAS_EXAMEN} días hábiles de examen.`,
  };
}
