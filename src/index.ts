/**
 * @cotejo/ucp-engine — el examen documental de una carta de crédito, como motor puro.
 *
 * Todo lo que hay acá adentro es determinista y sin entrada/salida: la misma entrada
 * da siempre la misma salida, y por eso se puede testear sin IA y defender ante un
 * auditor. La inteligencia artificial vive afuera (en la app) y solo EXTRAE texto de
 * documentos escaneados; el veredicto de cada regla lo decide este paquete.
 *
 * Viene de romai, donde se construyó y se validó contra el expediente real CSU2025099.
 */

/** Alertas por vencimiento, plazo de presentación y embarque. */
export { generarAlertasDeOperacion } from "./alertas";
export type { ContextoBackToBack, DescalceBackToBack, RiesgoBackToBack } from "./back-to-back";
/** Los dos créditos de un back-to-back: dónde queda descubierto el banco que emite el segundo. */
export { resumenBackToBack, revisarBackToBack } from "./back-to-back";
export type { Advertencia } from "./blindaje";
/** Blindaje: todo documento externo es DATO, nunca instrucción para el modelo. */
export {
  DELIM_ABRE,
  DELIM_CIERRA,
  desenvolverDato,
  detectarInyeccion,
  envolverDato,
  REGLA_DATO,
  sanearCampos,
} from "./blindaje";
export type { DocCertificado } from "./certificados";
/** Los demás documentos del 46A: origen, análisis, peso, certificados del beneficiario. */
export { aparearConExigencias, reglasCertificados } from "./certificados";
export type { AvisoRechazo, DestinoDocumentos, EncabezadoChecking, PlazoDeAviso } from "./checking-list";
/** La hoja que el examinador firma y el aviso de rechazo del artículo 16. */
export { avisoDeRechazo, checkingList, plazoDeAviso } from "./checking-list";
/** Checklist de documentos derivado del crédito y del incoterm. */
export { generarChecklist } from "./checklist";
export type {
  CampoDoc,
  CamposDoc,
  CruceDocumentos,
  DiferenciaLC,
  DocExternoGuardado,
  RequisitosLC,
  ResolucionDiscrepancia,
  TipoDocExterno,
} from "./consistencia";
/** Comparación campo a campo y entre documentos (UCP 600 art. 14d). */
export {
  aKg,
  CAMPOS_POR_TIPO,
  CAMPOS_SEGURO,
  claveDoc,
  compararDocumento,
  compararEntreDocumentos,
  cotejarLC,
  cotejarLCconOperacion,
  normalizarCamposDoc,
  normalizarLC,
  normConfianza,
  PROMPT_DOC,
  PROMPT_LC,
  parseNumero,
  SCHEMA_DOC,
  SCHEMA_LC,
  schemaPara,
  TIPO_DOC_LABEL,
} from "./consistencia";
export type { ContratoDeVenta, Desvio, DiferenciaContrato, ExtraCredito } from "./contrato";
/** El crédito que llegó contra el contrato que se firmó (UCP 600 art. 4 a: son cosas separadas). */
export { compararConContrato, describirDesvio, resumenDesvios } from "./contrato";
export type { Gravedad, Observacion } from "./emision";
/** La otra cara: ¿este crédito se puede cumplir? Revisión antes de emitirlo o al recibirlo. */
export { describirObservacion, resumenRevision, revisarCredito, revisarLcInfo } from "./emision";
export type { Conformidad, EstadoEnmienda, ObservacionEnmienda } from "./enmienda-vigencia";
/** Qué crédito rige mientras una enmienda no se contesta (UCP 600 art. 10). */
export { aceptacionTacita, creditoVigente, revisarEnmienda } from "./enmienda-vigencia";
export type { CambioLC, Enmienda } from "./enmiendas";
/** Enmiendas MT707: qué cambia contra el crédito vigente y cómo se aplica. */
export { aplicarEnmienda, diffEnmienda, esEnmienda, montoResultante, parseMT707 } from "./enmiendas";
export type { CotejoSpec, Especificacion, Operador, VeredictoSpec } from "./especificaciones";
/** La calidad que el crédito exige contra la que el análisis certifica. */
export { cotejarEspecificaciones, especificacionesDe, pareceVariosDocumentos } from "./especificaciones";
export type { ResultadoExamen } from "./examen";
/** El examen completo: lo que exige el crédito más lo que exigen las UCP 600. */
export { contextoDesdeSwift, examinarPresentacion } from "./examen";
/** Fechas de comercio exterior: "08-APR-2025", "16 ABR 2025", "04.03.2025", ISO. */
export { diffDias, fmtFecha, fmtFechaEn, isoMontevideo, parseFecha } from "./fechas";
/** El expediente real con el que se validó el motor, para tests y demostraciones. */
export { BL_REAL_CSU2025099, DOCUMENTOS_CSU2025099, SWIFT_CSU2025099, SWIFT_TRANSFERIBLE_DERIVADO } from "./fixtures";
export { desvioEnIngles, manualEnIngles, quedaEspanol, reglaEnIngles, textoEnIngles } from "./ingles";
export type { EmisorAdmitido, VeredictoISBP } from "./isbp";
/** Práctica bancaria estándar (ISBP 821): compara como compara un examinador. */
export {
  ablandarPorISBP,
  comparaISBP,
  cotejarIncotermISBP,
  emisorAdmitido,
  esCertificadoDeOrigen,
  esErrorDeTipeo,
  esFacturaComercial,
  exigePrevioAlEmbarque,
  normISBP,
  versionIncoterm,
} from "./isbp";
export type { Alcance, AlertaJurisdiccion, Jurisdiccion } from "./jurisdicciones";
export {
  describirAlerta,
  esLugar,
  JURISDICCIONES,
  JURISDICCIONES_REVISADAS_EN,
  screenearJurisdicciones,
} from "./jurisdicciones";
export type { AvisoAseguradora, CobroEstimado, LimitePresentacion } from "./lc";
/** Reglas de las UCP 600 como código: plazos, tolerancias, tenor, cobro estimado. */
export {
  avisoAseguradora,
  cobroEstimado,
  diasParaPresentar,
  diasPresentacion,
  limitePresentacion,
  parseTolerancia,
  sumarHabiles,
  TOLERANCIA_DEFAULT,
  tenorDe,
  toleranciaDe,
  toleranciaDeCantidad,
  toleranciaDeImporte,
  UCP_DIAS_EXAMEN,
  UCP_DIAS_PRESENTACION,
} from "./lc";
export type { FallaDeLectura } from "./lectura-fallida";
export { motivoDeFallaDeLectura } from "./lectura-fallida";
export type { DatosMT734, MensajeMT734 } from "./mt734";
/** El aviso del artículo 16 como mensaje SWIFT MT734, con los largos de campo del estándar. */
export { mt734 } from "./mt734";
export type { DatosMT750, DatosMT752, MensajeSwift, ModoDeHonrar } from "./mt750";
/** El otro camino cuando el examen da rojo: consultar la dispensa (MT750) y concederla (MT752). */
export { mt750, mt752 } from "./mt750";
export type { CamposPreparados, CantidadResuelta, ComoSeResolvio } from "./numeros";
/** Números escritos de formas distintas sobre el mismo embarque: cantidades y contenedores. */
export {
  contenedoresEn,
  desambiguarCantidad,
  esAmbiguo,
  lecturasPosibles,
  mismoContenedor,
  normalizarContenedor,
  prepararCampos,
} from "./numeros";
export type { DocAnalizado, Ejemplares, EstadoRegla, ReglaPresentacion, ResultadoPresentacion } from "./presentacion";
/** El examen previo a presentar: regla por regla, con evidencia. */
export { ejemplaresDe, feeDiscrepancia, precheckPresentacion } from "./presentacion";
export type { Cuota, Presentacion, SaldoCredito, VencimientoEfectivo } from "./presentaciones";
/** El crédito como lo ve un banco: giros contra un compromiso, no una compraventa. */
export { operacionDesdeCredito, reglasDeGiro, saldoDelCredito, vencimientoEfectivo } from "./presentaciones";
/** El prompt de lectura propio de Cotejo: neutro y con los campos de transporte y seguro. */
export { PROMPT_EXAMEN } from "./prompt-extraccion";
export type { Propuesta } from "./redaccion";
export { describirPropuesta, proponerRedaccion, redaccionesPara } from "./redaccion";
export type { ContextoCredito, DocSeguro } from "./reglas-ucp";
/** Las reglas de las UCP 600 que el examen base no cubre (transporte, seguro, art. 14 y 18). */
export { reglasUCP } from "./reglas-ucp";
export type { CambioDeScreening, ListaConsultada, MotivoRevision, Revision } from "./revision-sanciones";
export { compararScreenings, revisionNecesaria } from "./revision-sanciones";
export type { Coincidencia, EntradaSancion, ListaSanciones, ParteScreenear, RolParte } from "./sanciones";
/** Screening de sanciones: partes a revisar y cotejo contra las listas descargadas. */
export { describirCoincidencia, MOMENTOS_DE_SCREENING, partesAScreenear, screenear } from "./sanciones";
/** Higiene: qué no se le manda nunca a un modelo. */
export { scrubForLLM } from "./scrub";
export type { CampoSwift, LcSwift } from "./swift-lc";
/** Intérprete determinista de mensajes SWIFT MT700 y MT710. */
export { esMensajeSwift, fechaSwift, listaSwift, montoSwift, parseMT700, tokenizarSwift } from "./swift-lc";
export type {
  ContextoTransferencia,
  GravedadTransferencia,
  ObservacionTransferencia,
} from "./transferible";
/** El crédito transferido contra el original: la lista cerrada del artículo 38 (g). */
export { resumenTransferencia, revisarTransferencia, sePuedeTransferir } from "./transferible";
/** Tipos del dominio (crédito, documentos, operación, matriz). */
export type * from "./types";
export type { VerificacionManual } from "./verificaciones-manuales";
/** Lo que el motor no puede verificar y queda del lado humano, dicho explícitamente. */
export { verificacionesManuales } from "./verificaciones-manuales";
export { VERSION_MOTOR } from "./version";
