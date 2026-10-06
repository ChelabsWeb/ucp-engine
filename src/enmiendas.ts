import type { EstadoEnmienda } from "./enmienda-vigencia";
import { type CampoSwift, esMensajeSwift, fechaSwift, listaSwift, montoSwift, tokenizarSwift } from "./swift-lc";
import type { LcInfo } from "./types";

/**
 * Oportunidades A5: las enmiendas llegan como MT707 ("AMENDMENT TO A DOCUMENTARY CREDIT") y hoy
 * se re-tipean. El 707 solo trae LO QUE CAMBIA: vencimiento (31E), monto (32B/33B/34B), último
 * embarque (44C), plazo de presentación (48) y agregados al 46A/47A (46B/47B) o texto libre (79).
 * Parser determinista + diff contra la LC cargada; el operador ve qué cambia antes de aplicar.
 */
export interface Enmienda {
  numeroLC: string | null;
  numeroEnmienda: string | null;
  fecha: string | null;
  /** los campos que la enmienda trae, ya normalizados (solo los presentes) */
  vencimiento?: string | null;
  limiteEmbarque?: string | null;
  plazoPresentacion?: string | null;
  monto?: number | null;
  moneda?: string | null;
  /** aumento (32B) o disminución (33B) del monto, si vino expresado así */
  aumento?: number | null;
  disminucion?: number | null;
  documentosExigidos?: string[] | null;
  condicionesAdicionales?: string[] | null;
  narrativa: string | null;
}

export interface CambioLC {
  campo: string;
  antes: string;
  despues: string;
}

const campo = (cs: CampoSwift[], tag: string): string[] | null => cs.find((c) => c.tag === tag)?.lineas ?? null;
const texto = (cs: CampoSwift[], tag: string): string => (campo(cs, tag) ?? []).join(" ").replace(/\s+/g, " ").trim();

export function esEnmienda(t: string): boolean {
  if (!esMensajeSwift(t)) return false;
  return /FIN\s*707/.test(t) || /\b707\b/.test(t) || /amendment to a documentary credit|:26E:/i.test(t);
}

export function parseMT707(t: string): Enmienda | null {
  if (!esEnmienda(t)) return null;
  const cs = tokenizarSwift(t);
  const nuevoMonto = montoSwift(texto(cs, "34B") || texto(cs, "32B"));
  const aumento = montoSwift(texto(cs, "32B"));
  const baja = montoSwift(texto(cs, "33B"));
  const docs = listaSwift(campo(cs, "46B") ?? campo(cs, "46A"));
  const cond = listaSwift(campo(cs, "47B") ?? campo(cs, "47A"));
  // el 34B es el monto nuevo total; el 32B solo, sin 34B, es un aumento sobre el vigente
  const hay34B = Boolean(texto(cs, "34B"));
  return {
    numeroLC: texto(cs, "21") || null,
    numeroEnmienda: texto(cs, "26E") || null,
    fecha: fechaSwift(texto(cs, "30")) ?? null,
    vencimiento: fechaSwift(texto(cs, "31E")) ?? undefined,
    limiteEmbarque: fechaSwift(texto(cs, "44C")) ?? undefined,
    plazoPresentacion: texto(cs, "48") || undefined,
    monto: hay34B ? nuevoMonto.monto : undefined,
    moneda: hay34B ? nuevoMonto.moneda : undefined,
    aumento: !hay34B && aumento.monto != null ? aumento.monto : undefined,
    disminucion: baja.monto ?? undefined,
    documentosExigidos: docs.length ? docs : undefined,
    condicionesAdicionales: cond.length ? cond : undefined,
    narrativa: texto(cs, "79") || null,
  };
}

const money = (n: number | null | undefined, m: string | null | undefined) =>
  n == null
    ? "—"
    : `${m ?? ""} ${new Intl.NumberFormat("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`.trim();

/** Qué cambia respecto de la LC cargada. Lista vacía = la enmienda no mueve nada que modelemos. */
export function diffEnmienda(lc: LcInfo, e: Enmienda): CambioLC[] {
  const cambios: CambioLC[] = [];
  const cmp = (nombre: string, antes: string | null | undefined, despues: string | null | undefined) => {
    if (despues == null || despues === "") return;
    if ((antes ?? "").trim().toLowerCase() === despues.trim().toLowerCase()) return;
    cambios.push({ campo: nombre, antes: antes?.trim() || "—", despues: despues.trim() });
  };
  cmp("Vencimiento", lc.vencimiento, e.vencimiento);
  cmp("Último embarque", lc.limiteEmbarque, e.limiteEmbarque);
  cmp("Plazo de presentación", lc.plazoPresentacion, e.plazoPresentacion);

  const montoNuevo = montoResultante(lc, e);
  if (montoNuevo != null && montoNuevo !== (lc.monto ?? null)) {
    cambios.push({
      campo: "Monto",
      antes: money(lc.monto, lc.moneda),
      despues: money(montoNuevo, e.moneda ?? lc.moneda),
    });
  }
  for (const d of e.documentosExigidos ?? []) {
    if (!(lc.documentosExigidos ?? []).some((x) => x.trim().toLowerCase() === d.trim().toLowerCase())) {
      cambios.push({ campo: "Documentos exigidos (46A)", antes: "no estaba", despues: d });
    }
  }
  for (const c of e.condicionesAdicionales ?? []) {
    if (!(lc.condicionesAdicionales ?? []).some((x) => x.trim().toLowerCase() === c.trim().toLowerCase())) {
      cambios.push({ campo: "Condiciones adicionales (47A)", antes: "no estaba", despues: c });
    }
  }
  return cambios;
}

/** El monto que queda después de la enmienda: total nuevo (34B), o vigente ± aumento/disminución. */
export function montoResultante(lc: LcInfo, e: Enmienda): number | null {
  if (e.monto != null) return e.monto;
  const base = lc.monto ?? null;
  if (base == null) return null;
  if (e.aumento != null) return base + e.aumento;
  if (e.disminucion != null) return base - e.disminucion;
  return null;
}

/** Aplica la enmienda sobre la LC (lo que la enmienda no menciona, no se toca). */
/**
 * El crédito que rige hoy, con todas las enmiendas que hubo (UCP 600 art. 10 c).
 *
 * El motor aceptaba **una** enmienda y la mesa precargaba la última, así que un crédito con dos
 * acumulativas —una que sube el monto y otra que acorta el vencimiento— se examinaba contra un
 * crédito que no era ni el original ni el enmendado: el original con la segunda, perdiendo la
 * primera.
 *
 * El artículo dice que la aceptación es por enmienda. De ahí sale todo lo demás:
 *
 * - las **aceptadas** se aplican todas, en el orden en que llegaron, y eso no tiene ambigüedad: el
 *   beneficiario dijo que sí a cada una;
 * - las **rechazadas** no cambian nada, aunque la de al lado sí;
 * - la que **no tiene respuesta** queda aparte, porque es la presentación misma la que dice si la
 *   acepta —y eso lo decide `examinarConEnmienda` comparando los dos exámenes.
 *
 * Y si hay más de una sin responder, se dice en vez de elegir: la aceptación tácita se decide
 * mirando un juego de documentos contra dos créditos, y con tres no hay cómo repartirla sin
 * inventar. `ambiguo` es lo que la pantalla tiene que mostrar ahí.
 */
export function creditoVigenteCon(
  lc: LcInfo,
  enmiendas: { enmienda: Enmienda; estado: EstadoEnmienda }[],
): { lc: LcInfo; sinResponder: Enmienda | null; ambiguo: boolean } {
  let vigente = lc;
  for (const { enmienda, estado } of enmiendas) {
    if (estado === "ACEPTADA") vigente = aplicarEnmienda(vigente, enmienda);
  }
  const abiertas = enmiendas.filter((x) => x.estado === "SIN_RESPUESTA" || x.estado === "ACEPTADA_EN_PARTE");
  return {
    lc: vigente,
    sinResponder: abiertas.length === 1 ? abiertas[0]!.enmienda : null,
    ambiguo: abiertas.length > 1,
  };
}

export function aplicarEnmienda(lc: LcInfo, e: Enmienda): LcInfo {
  const monto = montoResultante(lc, e);
  return {
    ...lc,
    vencimiento: e.vencimiento || lc.vencimiento,
    limiteEmbarque: e.limiteEmbarque || lc.limiteEmbarque,
    plazoPresentacion: e.plazoPresentacion || lc.plazoPresentacion,
    monto: monto ?? lc.monto ?? null,
    moneda: e.moneda ?? lc.moneda ?? null,
    documentosExigidos: e.documentosExigidos?.length
      ? [
          ...(lc.documentosExigidos ?? []),
          ...e.documentosExigidos.filter(
            (d) => !(lc.documentosExigidos ?? []).some((x) => x.trim().toLowerCase() === d.trim().toLowerCase()),
          ),
        ]
      : (lc.documentosExigidos ?? null),
    condicionesAdicionales: e.condicionesAdicionales?.length
      ? [
          ...(lc.condicionesAdicionales ?? []),
          ...e.condicionesAdicionales.filter(
            (c) => !(lc.condicionesAdicionales ?? []).some((x) => x.trim().toLowerCase() === c.trim().toLowerCase()),
          ),
        ]
      : (lc.condicionesAdicionales ?? null),
  };
}
