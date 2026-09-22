import { ablandarPorISBP } from "./isbp";
import { prepararCampos } from "./numeros";
import type { DocAnalizado, ReglaPresentacion, ResultadoPresentacion } from "./presentacion";
import { feeDiscrepancia, precheckPresentacion } from "./presentacion";
import { type ContextoCredito, type DocSeguro, reglasUCP } from "./reglas-ucp";
import type { LcSwift } from "./swift-lc";
import type { LcInfo, OperationDetail } from "./types";
import { type VerificacionManual, verificacionesManuales } from "./verificaciones-manuales";

/**
 * El examen completo: lo que exige el crédito más lo que exigen las UCP 600.
 *
 * `precheckPresentacion` mira el propio crédito — los documentos del 46A, las condiciones
 * del 47A, los plazos, el cotejo entre documentos. `reglasUCP` agrega las reglas que las
 * UCP imponen aunque el crédito no las mencione: los puertos del documento de transporte,
 * la anotación de a bordo, el documento limpio, la cobertura mínima del seguro.
 *
 * Las dos listas se concatenan en una sola y los contadores se recalculan sobre el total,
 * porque para el examinador es un único dictamen.
 */

export interface ResultadoExamen extends ResultadoPresentacion {
  /** números que hubo que resolver o que quedaron dudosos antes de comparar */
  avisosDeLectura: string[];
  /** cuántas reglas salieron de las UCP 600 más allá de lo que pide el crédito */
  reglasUCP: number;
  /** lo que el motor no puede verificar y tiene que mirar una persona */
  manuales: VerificacionManual[];
}

/** El contexto del crédito que las reglas necesitan, sacado del propio mensaje SWIFT. */
export function contextoDesdeSwift(p: LcSwift): ContextoCredito {
  const campo = (v: { valor: string; confianza: number } | undefined): string | null =>
    v && v.valor.trim() ? v.valor.trim() : null;
  return {
    puertoEmbarque: campo(p.campos.puertoEmbarque),
    puertoDestino: campo(p.campos.puertoDestino),
    mercaderia: campo(p.campos.mercaderia),
    aplicante: p.extra.aplicante[0] ?? null,
    parciales: p.extra.parciales,
    transbordo: p.extra.transbordo,
  };
}

const CUENTA = (rs: ReglaPresentacion[], e: ReglaPresentacion["estado"]) => rs.filter((r) => r.estado === e).length;

export function examinarPresentacion(input: {
  lc: LcInfo;
  /** lo que dice el propio crédito de los puertos, la mercadería y el ordenante */
  credito?: ContextoCredito;
  docs: DocAnalizado[];
  /** el documento de seguro, cuando el crédito lo exige */
  seguro?: DocSeguro;
  op: OperationDetail;
  empresaRazonSocial: string;
  empresaDireccion?: string | null;
  hoy: Date;
}): ResultadoExamen {
  // antes de comparar, dejar los números en forma inequívoca: una cantidad escrita
  // "53,960" leída como 53.960 en vez de 53,96 inventa una discrepancia de mil veces
  const avisosDeLectura: string[] = [];
  const docs = input.docs.map((d) => {
    const p = prepararCampos(d.campos);
    for (const a of p.avisos) avisosDeLectura.push(`${d.nombreArchivo ?? d.tipo}: ${a}`);
    return { ...d, campos: p.campos };
  });

  const base = precheckPresentacion({
    lc: input.lc,
    docs,
    op: input.op,
    empresaRazonSocial: input.empresaRazonSocial,
    empresaDireccion: input.empresaDireccion,
    hoy: input.hoy,
  });

  const extra = reglasUCP({
    lc: input.lc,
    credito: input.credito,
    docs,
    seguro: input.seguro,
    hoy: input.hoy,
  });

  // la práctica bancaria estándar no solo agrega exigencias: también quita las que dejaron
  // de considerarse discrepancia, como la falta del número del crédito en un documento
  const reglas = ablandarPorISBP([...base.reglas, ...extra]);
  const faltan = CUENTA(reglas, "FALTA");
  const discrepancias = CUENTA(reglas, "DISCREPANCIA");

  return {
    reglas,
    faltan,
    discrepancias,
    atencion: CUENTA(reglas, "ATENCION"),
    listo: faltan === 0 && discrepancias === 0 && (input.lc.documentosExigidos ?? []).length > 0,
    feePorJuego: feeDiscrepancia(input.lc.condicionesAdicionales),
    diasParaPresentar: base.diasParaPresentar,
    reglasUCP: extra.length,
    manuales: verificacionesManuales({ lc: input.lc, docs, haySeguro: Boolean(input.seguro) }),
    avisosDeLectura,
  };
}
