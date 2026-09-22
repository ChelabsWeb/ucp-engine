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
  TIPO_DOC_LABEL,
} from "./consistencia";
export type { CambioLC, Enmienda } from "./enmiendas";
/** Enmiendas MT707: qué cambia contra el crédito vigente y cómo se aplica. */
export { aplicarEnmienda, diffEnmienda, esEnmienda, montoResultante, parseMT707 } from "./enmiendas";
export type { ResultadoExamen } from "./examen";
/** El examen completo: lo que exige el crédito más lo que exigen las UCP 600. */
export { contextoDesdeSwift, examinarPresentacion } from "./examen";
/** Fechas de comercio exterior: "08-APR-2025", "16 ABR 2025", "04.03.2025", ISO. */
export { diffDias, fmtFecha, isoMontevideo, parseFecha } from "./fechas";
/** El expediente real con el que se validó el motor, para tests y demostraciones. */
export { BL_REAL_CSU2025099, DOCUMENTOS_CSU2025099, SWIFT_CSU2025099 } from "./fixtures";
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
  UCP_DIAS_EXAMEN,
  UCP_DIAS_PRESENTACION,
} from "./lc";
export type { DocAnalizado, Ejemplares, EstadoRegla, ReglaPresentacion, ResultadoPresentacion } from "./presentacion";
/** El examen previo a presentar: regla por regla, con evidencia. */
export { ejemplaresDe, feeDiscrepancia, precheckPresentacion } from "./presentacion";
/** El prompt de lectura propio de Cotejo: neutro y con los campos de transporte y seguro. */
export { PROMPT_EXAMEN } from "./prompt-extraccion";
export type { ContextoCredito, DocSeguro } from "./reglas-ucp";
/** Las reglas de las UCP 600 que el examen base no cubre (transporte, seguro, art. 14 y 18). */
export { reglasUCP } from "./reglas-ucp";
/** Higiene: qué no se le manda nunca a un modelo. */
export { scrubForLLM } from "./scrub";
export type { CampoSwift, LcSwift } from "./swift-lc";
/** Intérprete determinista de mensajes SWIFT MT700 y MT710. */
export { esMensajeSwift, fechaSwift, listaSwift, montoSwift, parseMT700, tokenizarSwift } from "./swift-lc";
/** Tipos del dominio (crédito, documentos, operación, matriz). */
export type * from "./types";
export type { VerificacionManual } from "./verificaciones-manuales";
/** Lo que el motor no puede verificar y queda del lado humano, dicho explícitamente. */
export { verificacionesManuales } from "./verificaciones-manuales";
