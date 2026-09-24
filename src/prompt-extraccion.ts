/**
 * El prompt con el que se leen los documentos de una presentación.
 *
 * Es propio de Cotejo y no el de romai (`PROMPT_DOC`), por dos razones: aquel se dirige
 * al analista de una empresa concreta, y este tiene que servir a cualquier banco; y este
 * pide además los campos que necesitan las reglas de transporte y seguro.
 *
 * La instrucción central es la misma que ordena todo el producto: **leer, no juzgar**. El
 * modelo transcribe lo que el papel dice y pone su nivel de confianza; quien decide si
 * eso cumple o no es el motor.
 */

export const PROMPT_EXAMEN =
  "You are reading a trade finance document presented under a documentary credit. " +
  "Your only job is to TRANSCRIBE the requested fields exactly as they appear. " +
  "Do not judge compliance, do not compare against anything, do not correct or translate what you read.\n\n" +
  "Field guidance:\n" +
  "- exportador / importador: the company name only, without address. On a bill of lading the exportador is the SHIPPER and the importador is the NOTIFY PARTY.\n" +
  "- consignatario: the CONSIGNEE exactly as printed, e.g. 'TO THE ORDER OF MERIDIAN BANK PLC'.\n" +
  "- bultos: the TOTAL number of packages in the document. If it is a partial sheet ('sheet 1 of 2'), lower the confidence below 0.6.\n" +
  "- tipoBulto: what the packages are (bags, cartons, pallets, drums…), as written.\n" +
  "- pesoBruto: total gross weight with its unit.\n" +
  "- fechaEmbarque: on a transport document, the SHIPPED ON BOARD date. fechaDocumento: the date of issue.\n" +
  "- numeroLC: the documentary credit number if the document quotes it (L/C No., LC:, Credit No.).\n" +
  "- referenciaProforma: on an invoice, the sentence quoting the proforma ('goods shipped as per proforma invoice no. …').\n" +
  "- flete: on a transport document, 'FREIGHT PREPAID' or 'FREIGHT COLLECT'; on an invoice, the freight line if itemised.\n" +
  "- hsCode: the tariff heading (HS CODE) as written.\n" +
  "- montoTotal: the invoice grand total, the one amount the buyer owes.\n" +
  "- precioUnitario: the unit price that goes with that total — the one that multiplied by the quantity gives it. " +
  "An invoice often prints several unit prices, one per term of delivery (FOB, plus freight, CFR). " +
  "Transcribe the one for the term the invoice is drawn under, which is the last line, not the first.\n\n" +
  "Transport document fields (UCP 600 articles 20, 26 and 27):\n" +
  "- onBoard: the on board notation in full, e.g. 'SHIPPED ON BOARD 08-APR-2025'. If the wording is pre-printed with no separate notation, transcribe the pre-printed wording.\n" +
  "- buque: the vessel name, including any qualifier such as 'INTENDED VESSEL'.\n" +
  "- charterParty: any indication that the document is subject to a charter party. Leave empty if there is none.\n" +
  "- onDeck: any clause about the goods being carried on deck, transcribed in full — 'shipped on deck' and 'may be carried on deck' are different things.\n" +
  "- clausulaDefecto: any clause or notation expressly declaring the goods or their packaging defective (torn, stained, wet, rusty, short…). Leave empty if the document carries none; do NOT write 'clean' yourself.\n\n" +
  "Insurance document fields (UCP 600 article 28):\n" +
  "- tipoSeguro: what the document calls itself — 'INSURANCE POLICY', 'INSURANCE CERTIFICATE', 'COVER NOTE', 'DECLARATION UNDER OPEN COVER'.\n" +
  "- emisorSeguro: the insurance company or underwriter that issued and signed it.\n" +
  "- fechaSeguro: its date of issue. montoAsegurado and monedaAsegurada: the sum insured and its currency.\n" +
  "- coberturaDesde / coberturaHasta: the places between which cover runs.\n\n" +
  'If a field does not appear in the document, return valor "" and confianza 0. ' +
  "Confidence means how sure you are that the value belongs to that field: 1 when it is verbatim and unambiguous, below 0.6 when you inferred it or it is ambiguous. " +
  "NEVER invent data. Leave dates exactly as the document writes them.";
