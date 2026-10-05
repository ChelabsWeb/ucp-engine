import { type DocCertificado, reglasCertificados } from "./certificados";
import { claveDoc, TIPO_DOC_LABEL } from "./consistencia";
import {
  aceptacionTacita,
  creditoVigente,
  type EstadoEnmienda,
  type ObservacionEnmienda,
  revisarEnmienda,
} from "./enmienda-vigencia";
import { aplicarEnmienda, type Enmienda } from "./enmiendas";
import { ablandarPorISBP } from "./isbp";
import { prepararCampos } from "./numeros";
import { type PapelDelBanco, papelDelBanco, reglasDelPapel } from "./papel";
import type { DocAnalizado, ReglaPresentacion, ResultadoPresentacion } from "./presentacion";
import { feeDiscrepancia, precheckPresentacion } from "./presentacion";
import {
  type Cuota,
  type HorarioDeAtencion,
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
  /**
   * Qué papel juega el banco que examina en este crédito, si declaró su BIC.
   *
   * `null` cuando no lo declaró: entonces el examen no dice nada sobre la obligación de honrar, que
   * es distinta según el papel.
   */
  papel: PapelDelBanco | null;
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
    // 40E: con qué reglas se declara el crédito (art. 1).
    reglasAplicables: p.extra.reglas,
    // los bancos que el crédito nombra: de acá sale el papel del que examina (arts. 7, 8, 9, 12)
    bicEmisor: p.extra.bicEmisor,
    bicAvisador: p.extra.bicAvisador,
    bicDisponibleCon: p.extra.bicDisponibleCon,
    bicReceptor: p.extra.bicReceptor,
    disponibleCon: p.extra.disponibleCon,
    confirmacion: p.extra.confirmacion,
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
  /*
   * Lo que el motor no puede adivinar y el banco sí sabe.
   *
   * `reglasDeGiro` los aceptaba desde el principio y esto no los recibía ni los pasaba, así que no
   * había forma de que llegaran: la promesa de «cuando están, el motor decide» no se podía cumplir.
   * Los tres cambian el veredicto, y los tres se callan solos cuando no están.
   */
  /** los días en que el banco al que se presenta estuvo cerrado (art. 29 a) */
  feriados?: Date[];
  /** el horario de atención del banco al que se presenta (art. 33) */
  horario?: HorarioDeAtencion | null;
  /** el calendario de cuotas del crédito, cuando el banco lo cargó (art. 32) */
  cuotas?: Cuota[];
  /**
   * El BIC del banco que examina, declarado una vez en sus ajustes.
   *
   * Con él el examen dice **qué papel juega en este crédito** y qué le exigen las UCP por eso: el
   * emisor tiene que honrar una presentación conforme (art. 7 a), un designado que no confirmó no
   * está obligado (12 a) y un avisador no examina para honrar (art. 9). Son conclusiones distintas
   * sobre el mismo juego de papeles, y sin el BIC el examen no dice ninguna en vez de suponer.
   */
  bicPropio?: string | null;
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
        feriados: input.feriados,
        horario: input.horario,
        cuotas: input.cuotas,
      })
    : [];

  const base = precheckPresentacion({
    lc: input.lc,
    docs: examinables,
    /*
     * Los certificados y el seguro también satisfacen su línea del 46A.
     *
     * La regla del 46A solo reconoce los cuatro tipos con extracción propia, y los otros siete del
     * crédito real quedaban en FALTA aunque estuvieran presentados y examinados acá abajo. El
     * seguro va en la misma lista: su línea del 46A es una exigencia como las demás.
     */
    otros: [
      ...(input.certificados ?? []).map((c) => ({ exigencia: c.exigencia, nombreArchivo: c.nombreArchivo })),
      ...(input.seguro ? [{ exigencia: "INSURANCE", nombreArchivo: input.seguro.nombreArchivo }] : []),
    ],
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
  const sinElPapel = ablandarPorISBP([...base.reglas, ...extra, ...deCertificados, ...deGiro, ...reglas14g]);
  const faltan = CUENTA(sinElPapel, "FALTA");
  const discrepancias = CUENTA(sinElPapel, "DISCREPANCIA");

  /*
   * El papel del banco va al final, porque depende de si la presentación cumple.
   *
   * Lo que las UCP le exigen a quien examina no es lo mismo para todos: el emisor tiene que honrar
   * un juego conforme (arts. 7 a y 15 a), un designado que no confirmó no está obligado (12 a) y un
   * avisador no examina para honrar (art. 9). Pero eso solo se puede afirmar después de saber si el
   * juego cumple —con discrepancias no hay obligación de honrar, hay artículo 16— así que se compone
   * acá y no con las demás.
   *
   * Sin el BIC del banco no se dice nada: suponer un papel sería decidir sobre la obligación de
   * pagar con un dato inventado.
   */
  const papel = papelDelBanco({
    bicPropio: input.bicPropio,
    bicEmisor: input.credito?.bicEmisor,
    bicAvisador: input.credito?.bicAvisador,
    bicDisponibleCon: input.credito?.bicDisponibleCon,
    bicReceptor: input.credito?.bicReceptor,
    disponibleCon: input.credito?.disponibleCon,
    confirmacion: input.credito?.confirmacion,
  });
  const delPapel = papel ? reglasDelPapel(papel, { conforme: faltan === 0 && discrepancias === 0 }) : [];
  const reglas = [...sinElPapel, ...delPapel];

  return {
    papel,
    reglas,
    faltan,
    discrepancias,
    atencion: CUENTA(reglas, "ATENCION"),
    listo: faltan === 0 && discrepancias === 0 && (input.lc.documentosExigidos ?? []).length > 0,
    feePorJuego: feeDiscrepancia(input.lc.condicionesAdicionales),
    diasParaPresentar: base.diasParaPresentar,
    reglasUCP: extra.length + deCertificados.length + deGiro.length + delPapel.length,
    saldo: input.presentacion ? saldoDelCredito(input.lc, input.anteriores ?? []) : null,
    manuales: verificacionesManuales({ lc: input.lc, docs: examinables, haySeguro: Boolean(input.seguro) }),
    avisosDeLectura,
  };
}

/**
 * El examen cuando hay una enmienda de por medio (UCP 600 art. 10).
 *
 * `examinarPresentacion` examina contra un crédito. Acá se decide **cuál**, que es la pregunta que
 * el artículo 10 contesta y que no es la intuitiva: el emisor queda obligado por la enmienda desde
 * que la emite (10 b), pero para el beneficiario siguen rigiendo los términos originales hasta que
 * comunique que la acepta (10 c). Examinar contra el crédito equivocado invierte el resultado
 * entero.
 *
 * Y está la otra mitad, que es la que faltaba: **una presentación puede aceptar la enmienda sin que
 * nadie la conteste**. Si cumple con el crédito y con la enmienda todavía no aceptada, eso vale
 * como notificación de aceptación, y desde ese momento el crédito queda enmendado.
 *
 * Importa para el giro **siguiente**, no para este. Una presentación que cumple con los dos tiene
 * el mismo veredicto mire contra cuál; lo que cambia es contra qué se examina el próximo. Por eso
 * `examen` sigue siendo el del crédito que regía al presentar, y `rigeDespues` es lo que hay que
 * usar de ahí en adelante.
 *
 * Los dos exámenes se corren de verdad, porque no hay manera de saber si cumple con los dos sin
 * examinarlo contra los dos. Eso lo hace el motor y no la pantalla: la pantalla no decide nada.
 */
export function examinarConEnmienda(
  input: Parameters<typeof examinarPresentacion>[0] & {
    enmienda: Enmienda;
    /** qué contestó el beneficiario, si contestó */
    estado: EstadoEnmienda;
  },
): {
  /** el examen contra el crédito que regía al presentar: es el que vale */
  examen: ResultadoExamen;
  /** el mismo juego contra el crédito enmendado, que es con qué se decide la aceptación tácita */
  contraElEnmendado: ResultadoExamen;
  rige: "ORIGINAL" | "ENMENDADO";
  /** contra cuál se examina de acá en adelante, que puede no ser el mismo */
  rigeDespues: "ORIGINAL" | "ENMENDADO";
  aceptacion: ReturnType<typeof aceptacionTacita>;
  observaciones: ObservacionEnmienda[];
} {
  const { enmienda, estado, ...base } = input;
  const enmendada = aplicarEnmienda(base.lc, enmienda);
  const rige = creditoVigente(estado);

  const contraElOriginal = examinarPresentacion({ ...base, lc: base.lc });
  const contraElEnmendado = examinarPresentacion({ ...base, lc: enmendada });
  const examen = rige === "ENMENDADO" ? contraElEnmendado : contraElOriginal;

  /*
   * «Cumple» es no tener discrepancias ni documentos faltantes.
   *
   * Lo que queda para verificar a mano no cuenta en contra: una presentación no deja de cumplir
   * porque el motor no haya podido mirar algo. Y tampoco cuenta a favor — por eso esto decide la
   * aceptación tácita y no el veredicto, que lo firma una persona.
   */
  const cumple = (r: ResultadoExamen) => r.discrepancias === 0 && r.faltan === 0;
  const aceptacion = aceptacionTacita(estado, {
    cumpleConOriginal: cumple(contraElOriginal),
    cumpleConEnmendado: cumple(contraElEnmendado),
  });

  return {
    examen,
    contraElEnmendado,
    rige,
    rigeDespues: aceptacion.aceptada ? "ENMENDADO" : rige,
    aceptacion,
    observaciones: revisarEnmienda(enmienda, estado),
  };
}
