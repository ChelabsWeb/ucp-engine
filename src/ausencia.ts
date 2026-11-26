import type { CamposDoc } from "./consistencia";
import { modoDelDocumento } from "./transporte";

/**
 * Dónde la pantalla ofrece «no figura en el papel» (`CampoDoc.ausente`).
 *
 * Uno por regla que sepa qué hacer con la ausencia, y no todos de una vez: una casilla que ninguna
 * regla lee es una pregunta al vacío. Por eso la respuesta depende del **documento** y no solo del
 * campo:
 *
 * - `endoso`, en el documento de transporte: la falta rechaza (Opinión TA 814rev4, `bl-endoso`).
 * - `fechaDocumento`, **solo en un documento aéreo**: «An air transport document must always include
 *   a date of issuance» (Opinión TA 862, `ucp-23a-iii`). En una factura o en un conocimiento marítimo
 *   la falta de fecha no tiene esa autoridad detrás, así que ahí no se pregunta.
 * - `origenDeclarado`, en un certificado de origen: si el papel no indica el origen que el crédito
 *   nombra, la discrepancia vale (Opinión TA 864rev, `cert-origen`). El `tipo` de un certificado es
 *   la línea del 46A y no una clave, así que acá manda el campo: esa casilla no existe en otro papel.
 *
 * Antes era una lista plana de campos (`CAMPOS_CON_AUSENCIA`) y alcanzaba mientras el único fuera el
 * endoso, que existe en un solo tipo. La fecha existe en todos.
 */
export function ofreceAusencia(tipo: string, campo: string, campos?: CamposDoc): boolean {
  /* la casilla del origen solo existe en un certificado de origen: ahí siempre hay regla que la lea */
  if (campo === "origenDeclarado") return true;
  if (tipo !== "BL") return false;
  if (campo === "endoso") return true;
  if (campo === "fechaDocumento") return campos ? modoDelDocumento(campos).modo === "AEREO" : false;
  return false;
}
