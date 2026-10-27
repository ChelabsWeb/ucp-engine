import { describe, expect, it } from "vitest";
import { claveDoc } from "./consistencia";

/**
 * El apareo de la línea del 46A, contra una batería de redacciones reales.
 *
 * **Este archivo existe porque la misma clase de defecto apareció cinco veces**, y las cinco se
 * encontraron a mano:
 *
 * 1. «INSURANCE POLICY OR CERTIFICATE **FOR 110 PCT OF INVOICE VALUE**» salía FACTURA, así que nadie
 *    exigía el seguro y el banco pagaba un CIF sin póliza con esa línea del crédito en verde.
 * 2. Trece nombres de documento de transporte —air waybill, multimodal, sea waybill, CMR, courier— no
 *    se reconocían, y con ellos se caían los artículos 19, 21, 23, 24, 25 y el último embarque del 44C.
 * 3. La abreviatura en plural: «3/3 ORIGINAL **B/LS**» no apareaba y el capítulo del transporte entero
 *    no corría.
 * 4. «BENEFICIARY'S CERTIFICATE … PLUS 1/3 ORIGINAL **BILL OF LADING** HAS BEEN SENT TO THE APPLICANT»
 *    salía BL, y «… ONE COPY OF **INVOICE** WAS SENT» salía FACTURA.
 * 5. «BENEFICIARY DRAFT **DRAWN ON** ISSUING BANK AT 90 DAYS FROM **INVOICE DATE**» salía FACTURA, y
 *    «SHIPMENT ADVICE QUOTING THE BILL OF LADING NUMBER AND THE **INVOICE VALUE**» también.
 *
 * **Las cinco tienen la misma forma y el mismo síntoma.** La forma: o un documento cuyo texto menciona
 * otro tipo se lo deja robar por la primera prueba de la lista, o un nombre que el motor no conoce cae
 * en `TXT:<línea>`. El síntoma: la línea del 46A sale **FALTA** y el papel presentado sale desestimado
 * por el artículo 14 (g) — un papel presentado y exigido, contado como ausente y de más al mismo
 * tiempo.
 *
 * Y desde afuera un FALTA **no es una discrepancia**, así que ni el banco de pruebas se pone rojo: el
 * defecto se ve igual que un documento que el beneficiario no presentó. Por eso ninguna de las cinco se
 * encontró leyendo el código, y por eso este archivo no es un test más — es el único control que esta
 * familia tiene.
 *
 * **Cómo se usa cuando falla:** si una línea da la clave equivocada, el problema casi siempre está en
 * una de dos cosas. O falta el nombre del documento en `clavePorTexto` —y ahí importa **dónde** se
 * agrega, porque la lista se prueba en orden y la factura es la primera— o falta la palabra que abre la
 * descripción en `ABRE_DESCRIPCION`, que es la que corta la cabeza de la exigencia.
 *
 * **Y cómo crece:** cada vez que un crédito real traiga una redacción que no esté acá, va. La batería
 * vale por lo que cubre.
 */

/** Las redacciones, y la clave que cada una tiene que dar. */
const BATERIA: [linea: string, clave: string][] = [
  /* ── factura ── */
  ["SIGNED COMMERCIAL INVOICE IN 3 ORIGINALS", "INVOICE"],
  ["COMMERCIAL INVOICE ISSUED BY BENEFICIARY INDICATING CONTRACT NUMBER AND NUMBER OF LETTER OF CREDIT", "INVOICE"],
  ["MANUALLY SIGNED AND DULY DATED BENEFICIARY'S COMMERCIAL INVOICE ADDRESSED TO APPLICANT", "INVOICE"],
  ["CUSTOMS INVOICE IN 2 COPIES", "INVOICE"],

  /* ── packing list ── */
  ["PACKING LIST SHOWING GROSS AND NET WEIGHT PER BILL OF LADING", "PACKING"],
  ["PACKING LIST AND WEIGHT LIST IN 3 FOLD", "PACKING"],
  ["PACKING LIST MENTIONING TOTAL QUANTITY AS PER LC AND COMMERCIAL INVOICE", "PACKING"],

  /* ── transporte: `BL` es el tipo genérico y de ahí sale la clase (arts. 19 a 25) ── */
  ["FULL SET OF CLEAN ON BOARD OCEAN BILLS OF LADING MARKED FREIGHT PREPAID", "BL"],
  ["FULL SET 3/3 ORIGINAL B/LS PLUS 2 NON NEGOTIABLE COPIES", "BL"],
  /* El plural entre paréntesis, que es como lo escribe un mensaje SWIFT: Opinión R 638 / TA 629. */
  ["FULL SET OF AT LEAST 3/3 ORIGINAL CLEAN ON BOARD MARINE BILL(S) OF LADING", "BL"],
  ["ORIGINAL AIR WAYBILL(S) CONSIGNED TO ISSUING BANK", "BL"],
  ["CHARTER PARTY BILL OF LADING IN 3 ORIGINALS", "BL"],
  ["FULL SET OF ORIGINAL AIR WAYBILLS CONSIGNED TO APPLICANT", "BL"],
  ["ORIGINAL HOUSE AIR WAYBILL CONSIGNED TO ISSUING BANK", "BL"],
  ["AIR CONSIGNMENT NOTE", "BL"],
  ["MULTIMODAL TRANSPORT DOCUMENT IN 3 ORIGINALS", "BL"],
  ["COMBINED TRANSPORT BILL OF LADING", "BL"],
  ["NON-NEGOTIABLE SEA WAYBILL CONSIGNED TO APPLICANT", "BL"],
  ["CMR ROAD CONSIGNMENT NOTE IN 2 COPIES", "BL"],
  ["RAIL WAYBILL MARKED DUPLICATE", "BL"],
  ["COURIER RECEIPT EVIDENCING DISPATCH OF ONE SET OF DOCUMENTS", "BL"],
  ["POST RECEIPT SHOWING DISPATCH TO THE APPLICANT", "BL"],

  /* ── origen ── */
  ["CERTIFICATE OF ORIGIN ISSUED BY CHAMBER OF COMMERCE IN 2 FOLD", "ORIGEN"],
  ["GSP CERTIFICATE OF ORIGIN FORM A", "ORIGEN"],
  ["CERTIFICATE OF ORIGIN ISSUED BY CHAMBER OF COMMERCE SHOWING THE INVOICE NUMBER", "ORIGEN"],

  /* ── sanitario y halal ── */
  ["PHYTOSANITARY CERTIFICATE ISSUED BY GOVT AUTHORITY", "SANITARIO"],
  ["INTERNATIONAL VETERINARY HEALTH CERTIFICATE ISSUED BY GOVT.VETERINERY AUTHORITY", "SANITARIO"],
  ["HEALTH CERTIFICATE SHOWING THE INVOICE NUMBER AND DATE", "SANITARIO"],
  ["HALAL SLAUGHTER CERTIFICATE ISSUED BY AN ISLAMIC CENTRE", "HALAL"],

  /* ── seguro: el defecto número uno de esta lista ── */
  ["INSURANCE POLICY OR CERTIFICATE FOR 110 PCT OF INVOICE VALUE", "SEGURO"],
  ["MARINE INSURANCE CERTIFICATE COVERING INSTITUTE CARGO CLAUSES A BLANK ENDORSED", "SEGURO"],
  ["INSURANCE CERTIFICATE FOR 110 PCT OF INVOICE VALUE COVERING ALL RISKS", "SEGURO"],

  /* ── peso, inspección, fumigación, análisis ── */
  ["WEIGHT NOTE IN 03 FOLD", "PESO"],
  ["CERTIFICATE OF WEIGHT AND QUALITY ISSUED BY AN INDEPENDENT SURVEYOR", "PESO"],
  ["WEIGHT CERTIFICATE SHOWING THE SAME WEIGHT AS THE BILL OF LADING", "PESO"],
  ["INSPECTION CERTIFICATE ISSUED BY SGS PRIOR TO SHIPMENT", "INSPECCION"],
  ["PRE-SHIPMENT INSPECTION CERTIFICATE ISSUED BY AN ACCREDITED SURVEYOR", "INSPECCION"],
  ["INSPECTION CERTIFICATE ISSUED BY SGS SHOWING THE PACKING LIST DETAILS", "INSPECCION"],
  ["FUMIGATION CERTIFICATE", "FUMIGACION"],
  ["FUMIGATION CERTIFICATE QUOTING THE PACKING LIST NUMBER", "FUMIGACION"],
  ["CERTIFICATE OF ANALYSIS SHOWING PROTEIN 54 PCT MIN", "ANALISIS"],
  ["QUALITY CERTIFICATE ISSUED BY MANUFACTURER", "ANALISIS"],
  ["CERTIFICATE OF ANALYSIS STATING THE INVOICE NUMBER AND THE BILL OF LADING NUMBER", "ANALISIS"],

  /* ── la letra, que salía factura por el «INVOICE DATE» del final ── */
  ["BENEFICIARY DRAFT DRAWN ON ISSUING BANK AT 90 DAYS FROM INVOICE DATE", "GIRO"],
  ["BILL OF EXCHANGE AT SIGHT DRAWN ON THE APPLICANT", "GIRO"],

  /*
   * ── el papel del beneficiario, que no siempre se llama «certificate» ──
   *
   * «BENEFICIARY'S CERTIFIED COPY OF CABLE … **ADVISING** NAME OF VESSEL, SHIPMENT DATE, QUANTITY,
   * **WEIGHT**, VALUE…» es cómo se pide el aviso de embarque, y el patrón pedía la palabra
   * «certificate»: con eso la cabeza de la línea era la línea entera y **la palabra «WEIGHT» de su
   * propio texto se lo llevaba al certificado de peso**. Décima vez que un documento cuyo texto
   * menciona otro tipo se lo deja robar (laudo DOCDEX 235), y la redacción está en el crédito real.
   */
  [
    "BENEFICIARY'S CERTIFIED COPY OF CABLE DISPATCHED TO THE APPLICANT ADVISING NAME OF VESSEL, SHIPMENT DATE, QUANTITY, WEIGHT, VALUE OF SHIPMENT GOODS AND THIS L/C NO.",
    "BENEFICIARIO:beneficiary s certified copy of cable di",
  ],
  [
    "BENEFICIARY'S STATEMENT ADVISING THE GROSS WEIGHT OF EACH PACKAGE",
    "BENEFICIARIO:beneficiary s statement advising the gro",
  ],
  /* Y las pruebas de más arriba siguen mandando: el origen se queda con su línea antes de llegar acá. */
  ["CERTIFICATE OF ORIGIN ISSUED BY THE BENEFICIARY", "ORIGEN"],
  /* Y un certificado de peso de verdad sigue siendo PESO. */
  ["WEIGHT CERTIFICATE ISSUED BY AN INDEPENDENT SURVEYOR", "PESO"],

  /* ── el aviso de embarque, que se escribe «advice» más seguido que «notice» ── */
  ["SHIPMENT ADVICE SENT TO THE INSURERS WITHIN 5 DAYS AFTER SHIPMENT DATE", "AVISO_EMBARQUE"],
  ["SHIPMENT ADVICE QUOTING THE BILL OF LADING NUMBER AND THE INVOICE VALUE", "AVISO_EMBARQUE"],
  ["ADVICE OF SHIPMENT SENT BY FAX TO THE APPLICANT", "AVISO_EMBARQUE"],
  ["SHIPMENT NOTICE IN 2 COPIES", "AVISO_EMBARQUE"],
  /* El FCR, textual del crédito del laudo DOCDEX 282 — y el conocimiento del transitario, que sí es
     transporte y no tiene que confundirse con él. */
  [
    "FORWARDERS CERTIFICATE OF RECEIPT FCR IN 1 ORIGINAL AND 1 COPY DATED NOT LATER THAN 30TH AUGUST 2008 ISSUED BY COMPANY N",
    "FCR",
  ],
  ["FORWARDER'S CERTIFICATE OF RECEIPT IN 2 ORIGINALS", "FCR"],
  /* El mill's test certificate, textual del crédito del laudo DOCDEX 285 */
  [
    "SET OF MILL'S TEST CERTIFICATES IN 1 ORIGINAL AND 3 COPIES ISSUED BY THE MANUFACTURER OF EACH LOT, ACCORDING TO EN 101112 INCL. CE-SIGN, ADDITIONALLY 14 ELEMENTS AND VALUES OF TENSILE AND IMPACT TEST AT MINUS 20 DEGREE C TO BE STATED IN THE MTC",
    "MTC",
  ],
  ["MILL TEST CERTIFICATE IN 1 ORIGINAL", "MTC"],
  ["FULL SET OF FORWARDERS BILL OF LADING CONSIGNED TO ISSUING BANK", "BL"],
  /* La aceptación en sitio y la capacitación: laudo DOCDEX 318 */
  [
    "ONE (1) ORIGINAL AND FOUR (4) COPIES OF BENEFICIARY'S SIGNED CERTIFICATE OF SITE ACCEPTANCE TEST (SAT)",
    "ACEPTACION",
  ],
  [
    "ONE (1) ORIGINAL AND FOUR (4) COPIES OF BENEFICIARY'S SIGNED CERTIFICATE OF COMPLETION OF TRAINING",
    "CAPACITACION",
  ],
  /* Y el freno: una inspección no es una aceptación en sitio, aunque las dos las firme un surveyor. */
  ["SITE ACCEPTANCE TEST REPORT ISSUED BY AN INDEPENDENT SURVEYOR", "ACEPTACION"],
  /* Y el mismo plural sobre las otras familias, que es lo que hace general al arreglo. */
  ["SIGNED COMMERCIAL INVOICE(S) IN TRIPLICATE", "INVOICE"],
  ["CERTIFICATE(S) OF ORIGIN ISSUED BY CHAMBER OF COMMERCE", "ORIGEN"],
];

describe("el apareo de la línea del 46A", () => {
  it.each(BATERIA)("«%s» → %s", (linea, clave) => {
    expect(claveDoc(linea)).toBe(clave);
  });

  /*
   * El certificado del beneficiario va aparte porque su clave **lleva el texto adentro**: es lo único
   * que distingue dos certificados que se llaman igual, y el crédito real pide dos.
   */
  describe("el certificado del beneficiario, cuya clave lleva su texto", () => {
    const CERTIFICADOS = [
      "BENEFICIARY'S CERTIFICATE CONFIRMING ALL BANK CHARGES HAVE BEEN SETTLED",
      "BENEFICIARY'S CERTIFICATE CONFIRMING THAT A FULL SET OF COPY DOCUMENTS HAVE BEEN EMAILED",
      "BENEFICIARY'S CERTIFICATE ALONG WITH RELEVANT COURIER RECEIPT CERTIFYING THAT 1/3 ORIGINAL BILL OF LADING HAS BEEN SENT TO THE APPLICANT",
      "BENEFICIARY CERTIFICATE STATING THAT ONE COPY OF INVOICE WAS SENT TO APPLICANT",
    ];

    it.each(CERTIFICADOS)("«%s» es un certificado del beneficiario", (linea) => {
      expect(claveDoc(linea)).toMatch(/^BENEFICIARIO:/);
    });

    it("y los cuatro dan claves distintas: presentar uno no cumple los otros", () => {
      expect(new Set(CERTIFICADOS.map(claveDoc)).size).toBe(CERTIFICADOS.length);
    });
  });

  /*
   * El control del control: que la batería siga cubriendo todos los tipos que el motor reconoce.
   *
   * Sin esto, agregar un tipo nuevo y olvidarse de darle una línea acá lo dejaría sin red — que es
   * exactamente cómo se perdieron los trece nombres de documento de transporte.
   */
  it("cubre todas las claves que el motor reconoce", () => {
    const cubiertas = new Set(BATERIA.map(([, clave]) => clave));
    const TODAS = [
      "INVOICE",
      "PACKING",
      "BL",
      "ORIGEN",
      "SANITARIO",
      "HALAL",
      "SEGURO",
      "PESO",
      "INSPECCION",
      "FUMIGACION",
      "ANALISIS",
      "GIRO",
      "AVISO_EMBARQUE",
      "ACEPTACION",
      "CAPACITACION",
      "FCR",
      "MTC",
    ];
    expect(TODAS.filter((k) => !cubiertas.has(k))).toEqual([]);
  });

  /* Y que ninguna línea quede sin aparear, que es la forma más silenciosa del defecto. */
  it("ninguna línea cae en TXT:, que es el síntoma de un nombre que el motor no conoce", () => {
    expect(BATERIA.filter(([l]) => claveDoc(l).startsWith("TXT:")).map(([l]) => l)).toEqual([]);
  });
});
/**
 * La carta de indemnidad, y el séptimo documento que otro tipo se roba (laudo DOCDEX 372)
 *
 * El laudo es un crédito que admite presentar factura y **letter of indemnity** en lugar del juego de
 * conocimientos, y la presentación de esos dos es la que el panel declara conforme. Antes de tener clave
 * propia, esa línea caía en el capítulo del transporte —la línea menciona los conocimientos— y la línea que
 * ofrece la alternativa se la llevaba **la factura**, que es la primera prueba de la lista.
 *
 * Los dos son la misma forma, la séptima vez: **un documento cuyo texto nombra otro tipo y se lo deja robar
 * por la primera prueba que coincida.** El corte en «in lieu of» hace que mande la cabeza de la línea, que
 * es donde el crédito nombra el documento.
 */
describe("la carta de indemnidad (laudo DOCDEX 372)", () => {
  it("tiene clave propia y no se la lleva el transporte", () => {
    expect(claveDoc("LETTER OF INDEMNITY ISSUED BY THE BENEFICIARY")).toBe("INDEMNIDAD");
    expect(claveDoc("BENEFICIARY'S LETTER OF INDEMNITY IN LIEU OF BILLS OF LADING")).toBe("INDEMNIDAD");
    expect(claveDoc("INVOICE AND LOI AS PER CREDIT TERMS")).not.toBe("BL");
  });

  it("y la línea que ofrece la alternativa la gobierna su cabeza, no lo que nombra después", () => {
    expect(
      claveDoc("FULL SET OF ORIGINAL BILLS OF LADING OR, IN LIEU THEREOF, COMMERCIAL INVOICE AND LETTER OF INDEMNITY"),
      "la cabeza es el juego de conocimientos",
    ).toBe("BL");
    expect(claveDoc("COMMERCIAL INVOICE AND LOI ACCEPTABLE INSTEAD OF SHIPPING DOCUMENTS")).toBe("INVOICE");
  });
});
