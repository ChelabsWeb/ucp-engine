import { type DocCertificado, reglasCertificados } from "./certificados";
import { claveDoc, TIPO_DOC_LABEL } from "./consistencia";
import { ablandarPorISBP } from "./isbp";
import { prepararCampos } from "./numeros";
import type { DocAnalizado, ReglaPresentacion, ResultadoPresentacion } from "./presentacion";
import { feeDiscrepancia, precheckPresentacion } from "./presentacion";
import {
  operacionDesdeCredito,
  type Presentacion,
  reglasDeGiro,
  type SaldoCredito,
  saldoDelCredito,
} from "./presentaciones";
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
  /** cuánto queda del crédito después de esta presentación */
  saldo: SaldoCredito | null;
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
    // El 59: sin él, la regla del artículo 18 (a) (i) no puede decidir quién emitió la factura.
    beneficiario: p.extra.beneficiario[0] ?? null,
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
  /** los demás documentos del 46A: origen, análisis, peso, certificados del beneficiario */
  certificados?: DocCertificado[];
  /** el giro que se examina; con él el motor arma solo lo que el examen base necesita */
  presentacion?: Presentacion;
  /** los giros anteriores contra el mismo crédito */
  anteriores?: Presentacion[];
  /** solo si se quiere pasar una operación ya armada, como hace romai */
  op?: OperationDetail;
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

  /*
   * Lo que el crédito no exige se aparta antes de examinar (art. 14 g).
   *
   * «Un documento presentado pero no exigido por el crédito será desestimado y puede devolverse al
   * presentador». Se desestima de verdad: no se compara contra los otros ni contra el crédito,
   * porque si no un papel de más inventa discrepancias entre documentos que el banco no tiene que
   * mirar. Que está presentado se dice igual —el examinador tiene que saber que hay algo para
   * devolver— pero como aviso, no como hallazgo.
   *
   * El crédito cargado como documento no entra acá: no es un papel presentado, es contra lo que se
   * examina.
   */
  /** Cómo se llama cada tipo en el idioma del 46A, para buscarlo entre lo exigido. */
  const COMO_LO_PIDE_EL_46A: Record<string, string> = {
    FACTURA: "commercial invoice",
    PACKING: "packing list",
    BL: "bill of lading",
  };
  const exigidos = input.lc.documentosExigidos ?? [];
  const clavesExigidas = new Set(exigidos.map(claveDoc));
  const seDesestima = (d: (typeof docs)[number]) =>
    d.tipo !== "LC" && !clavesExigidas.has(claveDoc(COMO_LO_PIDE_EL_46A[d.tipo] ?? d.tipo));
  // Sin 46A legible no se desestima nada: no saber qué pide el crédito no es lo mismo que saber
  // que no lo pide.
  const desestimados = exigidos.length > 0 ? docs.filter(seDesestima) : [];
  const examinables = docs.filter((d) => !desestimados.includes(d));
  const reglas14g: ReglaPresentacion[] = desestimados.map((d) => ({
    id: `ucp-14g-${d.tipo.toLowerCase()}`,
    fuente: "UCP 600 14g",
    regla: `${TIPO_DOC_LABEL[d.tipo]}: presentado pero no exigido por el crédito, se desestima`,
    estado: "ATENCION" as const,
    evidencia:
      "el crédito no lo pide, así que no se examina ni se compara contra los demás; puede devolverse al presentador",
  }));

  // un banco no tiene una operación de compraventa: tiene un crédito y giros contra él.
  // Si no le pasan una, se arma desde el propio crédito.
  const op =
    input.op ??
    operacionDesdeCredito({
      lc: input.lc,
      presentacion: input.presentacion ?? { referencia: "", fecha: input.hoy, importe: null },
      ordenante: input.credito?.aplicante ?? null,
      mercaderia: input.credito?.mercaderia ?? null,
    });

  const deGiro = input.presentacion
    ? reglasDeGiro({
        lc: input.lc,
        actual: input.presentacion,
        anteriores: input.anteriores,
        parciales: input.credito?.parciales,
      })
    : [];

  const base = precheckPresentacion({
    lc: input.lc,
    docs: examinables,
    op,
    empresaRazonSocial: input.empresaRazonSocial,
    empresaDireccion: input.empresaDireccion,
    hoy: input.hoy,
  });

  const deCertificados = reglasCertificados({
    lc: input.lc,
    certificados: input.certificados ?? [],
    docs: examinables,
    beneficiario: input.empresaRazonSocial,
    mercaderiaDelCredito: input.credito?.mercaderia ?? null,
    hoy: input.hoy,
  });

  const extra = reglasUCP({
    lc: input.lc,
    credito: input.credito,
    docs: examinables,
    seguro: input.seguro,
    hoy: input.hoy,
  });

  // la práctica bancaria estándar no solo agrega exigencias: también quita las que dejaron
  // de considerarse discrepancia, como la falta del número del crédito en un documento
  const reglas = ablandarPorISBP([...base.reglas, ...extra, ...deCertificados, ...deGiro, ...reglas14g]);
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
    reglasUCP: extra.length + deCertificados.length + deGiro.length,
    saldo: input.presentacion ? saldoDelCredito(input.lc, input.anteriores ?? []) : null,
    manuales: verificacionesManuales({ lc: input.lc, docs: examinables, haySeguro: Boolean(input.seguro) }),
    avisosDeLectura,
  };
}
