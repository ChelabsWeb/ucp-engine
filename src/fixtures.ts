import type { CamposDoc, TipoDocExterno } from "./consistencia";

/**
 * El expediente CSU2025099 — el dataset dorado con el que se validó este motor.
 *
 * Es un embarque real: harina de pescado de Molsur a Orient Feed (Sri Lanka), cobrado con
 * una carta de crédito del Meridian Bank avisada por Banco Litoral, embarcado el 8 de
 * abril de 2025. El banco aceptó la presentación; la única contradicción del paquete es
 * que el conocimiento de embarque dice CARTONS y el packing dice BAGS (UCP 600 art. 14d).
 *
 * Sirve para tres cosas: los tests del motor, la pantalla de ejemplo de la aplicación y
 * la demostración a un banco antes de que entregue sus propios expedientes.
 */

/** El MT710 tal como lo transmitió el Standard Chartered al banco avisador. */
export const SWIFT_CSU2025099 =
  "\n-------------------- Instance Type and Transmission --------------\n     Notification (Transmission) of Original received from SWIFT\n     Priority        : Normal\n-------------------------- Message Header -------------------------\n     Swift Output              : FIN 710 Adv Third or Non Bank Doc Cred\n     Sender   : NUBKGB2LXXX\n              NORTHERN UNION BANK\n              LONDON GB\n     Receiver : BLITUYMMXXX\n              BANCO LITORAL (URUGUAY) S.A.\n              MONTEVIDEO UY\n-------------------------- Message Text ---------------------------\n      27: Sequence of Total\n          1/1\n     40B: Form of Documentary Credit\n          IRREVOCABLE\n          WITHOUT OUR CONFIRMATION\n      20: Sender's Reference\n          900114477-R\n      21: Documentary Credit Number\n          LCMRDN25000471\n     31C: Date of Issue\n          250320\n     40E: Applicable Rules\n          UCP LATEST VERSION\n     31D: Date and Place of Expiry\n          250630 URUGUAY\n     52A: Issuing Bank - FI BIC\n          MRDNLKLXXXX\n          MERIDIAN BANK PLC\n          COLOMBO  LK\n      50: Applicant\n          ORIENT FEED (PVT) LTD\n          OFF HARBOUR ROAD,\n          NEGOMBO,\n          GAMPAHA,SRI LANKA.\n      59: Beneficiary - Name & Address\n          CEREALSUR S.A\n          CERRITO 820 OF.006 CP 11500\n          MONTEVIDEO,URUGUAY\n     32B: Currency Code, Amount\n          Currency       : USD (US DOLLAR)\n          Amount         :              #54.150,00#\n     39A: Percentage Credit Amt Tolerance\n          10/10\n     41D: Available With...By... - Name&Addr\n          ANY BANK IN URUGUAY\n          BY NEGOTIATION\n     42C: Drafts at...\n          SIGHT\n     42D: Drawee - Name & Address\n          MERIDIAN BANK PLC\n          MERIDIAN TOWERS, NO,12 HARBOUR ROAD\n          COLOMBO 03,SRI LANKA.\n     43P: Partial Shipments\n          ALLOWED\n     43T: Transhipment\n          ALLOWED\n     44E: Port of Loading/Airport of Dep.\n          MONTEVIDEO PORT IN URUGUAY\n     44F: Port of Discharge/Airport of Dest\n          COLOMBO,SRI LANKA\n     44C: Latest Date of Shipment\n          250430\n     45A: Description of Goods and/or Services\n          +1) 57 MTS OF FISH MEAL 54PCT MIN (FOR ANIMAL FEED USE)\n          .\n          CFR COLOMBO,SRI LANKA INCOTERMS 2020\n          HS CODE NO.2301.20.00\n     46A: Documents Required\n          +1)SIGNED COMMERCIAL INVOICES IN 03 FOLD,INDICATING,\n            I)FOB VALUE AND FREIGHT AMOUNTS SEPARATELY.\n            II)GOODS ARE SHIPPED AS PER THE PROFORMA INVOICE NO.\n            2025099 DTD 04.03.2025\n          +2)FULL SET OF (3/3) SHIPPED ON BOARD ORIGINAL BILLS OF\n            LADING PLUS 02 NON NEGOTIABLE COPIES ISSUED TO THE ORDER OF\n            MERIDIAN BANK PLC,MARKED 'FREIGHT PREPAID' NOTIFY APPLICANT AS\n          PER FIELD 50 INDICATING NAME AND ADDRESS OF SHIPPING AGENT IN\n            SRI LANKA.\n          +3)CERTIFICATE OF URUGUAY ORIGIN IN 02 FOLD\n          +4)PACKING LIST IN 03 FOLD\n          +5)WEIGHT  NOTE IN 03 FOLD.\n          +6)INTERNATIONAL VETERINARY HEALTH CERTIFICATE ISSUED BY\n          GOVT.VETERINERY AUTHORITY IN URUGUAY.\n          +7)FUMIGATION CERTIFICATE.\n          +8)CERTIFICATE OF ANALYSIS\n          +9)BENEFICIARY'S CERTIFICATE CONFIRMING ALL ADVISING BANK\n            BANK CHARGES OUTSIDE SRI LANKA HAVE BEEN SETTLED.\n          +10)BENEFICIARY'S CERTIFICATE CONFIRMING THAT A FULL SET OF\n            COPY DOCUMENTS HAVE BEEN EMAILED TO IMPORTS(AT)ORIENTFEED.EXAMPLE\n            WITHIN 21 DAYS FROM THE DATE OF SHIPMENT.\n     47A: Additional Conditions\n          +1)ALL DOCUMENTS SHOULD BEAR A DATE ON OR AFTER THE LETTER OF\n            CREDIT DATE.\n          +2)ALL DOCUMENTS SHOUD INDICATE THE INDICATE THE LETTER OF\n          CREDIT NUMBER.\n          +3)A DISCREPANCY FEE OF USD 80/- OR ITS EQUIVALENT WILL BE\n            DEDUCTED FROM PROCEEDS FOR EACH SET OF DOCUMENTS PRESENTED\n            WITH DISCREPANCIES.\n          +7)A TOLERANCE OF 10 PCT MORE OR LESS IN QUANTITY AND\n            VALUE ALLOWED.\n          +8)THIRD PARTY DOCUMENTS EXCEPT DRAFT AND COMMERCIAL INVOICE\n          ACCEPTABLE\n     71D: Charges\n          OUTSIDE SRI LANKA ARE FOR\n          BENEFICIARY'S ACCOUNT.\n      48: Period for Presentation in Days\n          21\n      49: Confirmation Instructions\n          WITHOUT\n      78: Instr to Payg/Accptg/Negotg Bank\n          1)PLEASE DESPATCH DOCUMENTS BY COURIER IN ONE LOT TO\n            MERIDIAN BANK PLC,IMPORTS DEPARTMENT,MERIDIAN TOWERS,\n            NO.12,HARBOUR ROAD, COLOMBO 03, SRI LANKA.\n     57A: 'Advise Through' Bank - FI BIC\n          BLITUYMM\n          BANCO LITORAL (URUGUAY) S.A.\n          MONTEVIDEO  UY\n     72Z: Sender to Receiver Information\n          /ACK/\n--------------------------- Message Trailer ------------------------\n     {CHK:8BDB9CC7BF67}\n";

/** Los tres documentos del juego, con los campos ya extraídos. */
export const DOCUMENTOS_CSU2025099: Partial<Record<TipoDocExterno, CamposDoc>> = {
  FACTURA: {
    exportador: {
      valor: "CEREALSUR S.A",
      confianza: 0.95,
    },
    importador: {
      valor: "ORIENT FEED (PVT) LTD",
      confianza: 0.95,
    },
    montoTotal: {
      valor: "51.262,00",
      confianza: 0.95,
    },
    moneda: {
      valor: "USD",
      confianza: 0.95,
    },
    cantidad: {
      valor: "53.96",
      confianza: 0.95,
    },
    unidad: {
      valor: "MTS",
      confianza: 0.95,
    },
    mercaderia: {
      valor: "FISH MEAL 54PCT MIN (FOR ANIMAL FEED USE)",
      confianza: 0.95,
    },
    puertoEmbarque: {
      valor: "MONTEVIDEO, URUGUAY",
      confianza: 0.95,
    },
    puertoDestino: {
      valor: "COLOMBO, SRI LANKA",
      confianza: 0.95,
    },
    fechaEmbarque: {
      valor: "08/04/25",
      confianza: 0.95,
    },
    incoterm: {
      valor: "CFR COLOMBO, SRI LANKA",
      confianza: 0.95,
    },
    numeroDoc: {
      valor: "A 4401",
      confianza: 0.95,
    },
    bultos: {
      valor: "1360",
      confianza: 0.95,
    },
    tipoBulto: {
      valor: "BAGS",
      confianza: 0.95,
    },
    pesoBruto: {
      valor: "54.040 KGS",
      confianza: 0.95,
    },
    consignatario: {
      valor: "",
      confianza: 0,
    },
    flete: {
      valor: "FREIGHT 8.094,00",
      confianza: 0.95,
    },
    numeroLC: {
      valor: "LC LCMRDN25000471",
      confianza: 0.95,
    },
    fechaDocumento: {
      valor: "08/04/25",
      confianza: 0.95,
    },
    precioUnitario: {
      valor: "950,00",
      confianza: 0.9,
    },
    referenciaProforma: {
      valor: "GOODS ARE SHIPPED AS PER PROFORMA INVOICE NO. 2025099 DTD 04.03.2025",
      confianza: 0.95,
    },
  },
  PACKING: {
    exportador: {
      valor: "MOLSUR S.A.",
      confianza: 0.95,
    },
    importador: {
      valor: "ORIENT FEED (PVT) LTD.",
      confianza: 0.95,
    },
    montoTotal: {
      valor: "",
      confianza: 0,
    },
    moneda: {
      valor: "",
      confianza: 0,
    },
    cantidad: {
      valor: "53,96",
      confianza: 0.95,
    },
    unidad: {
      valor: "MT",
      confianza: 0.95,
    },
    mercaderia: {
      valor: "Fish meal 54 PCT min (For Animal Feed Use)",
      confianza: 0.95,
    },
    puertoEmbarque: {
      valor: "Montevideo Port, Uruguay",
      confianza: 0.95,
    },
    puertoDestino: {
      valor: "Colombo, Sri Lanka",
      confianza: 0.95,
    },
    fechaEmbarque: {
      valor: "08/04/2025",
      confianza: 0.95,
    },
    incoterm: {
      valor: "",
      confianza: 0,
    },
    numeroDoc: {
      valor: "PL 08-abr-25",
      confianza: 0.95,
    },
    bultos: {
      valor: "1.360",
      confianza: 0.95,
    },
    tipoBulto: {
      valor: "Bags",
      confianza: 0.95,
    },
    pesoBruto: {
      valor: "54.040,00 Kgs",
      confianza: 0.95,
    },
    consignatario: {
      valor: "",
      confianza: 0,
    },
    flete: {
      valor: "",
      confianza: 0,
    },
    numeroLC: {
      valor: "LC: LCMRDN25000471",
      confianza: 0.95,
    },
    fechaDocumento: {
      valor: "Montevideo, April 08th, 2025",
      confianza: 0.95,
    },
    referenciaProforma: {
      valor: "",
      confianza: 0,
    },
  },
  BL: {
    exportador: {
      valor: "MOLSUR SA",
      confianza: 0.95,
    },
    importador: {
      valor: "ORIENT FEED (PVT) LTD",
      confianza: 0.95,
    },
    montoTotal: {
      valor: "",
      confianza: 0,
    },
    moneda: {
      valor: "",
      confianza: 0,
    },
    cantidad: {
      valor: "53.96",
      confianza: 0.95,
    },
    unidad: {
      valor: "MTS",
      confianza: 0.95,
    },
    mercaderia: {
      valor: "FISH MEAL 54PCT MIN (FOR ANIMAL FEED USE)",
      confianza: 0.95,
    },
    puertoEmbarque: {
      valor: "MONTEVIDEO, URUGUAY",
      confianza: 0.95,
    },
    puertoDestino: {
      valor: "COLOMBO, SRI LANKA",
      confianza: 0.95,
    },
    fechaEmbarque: {
      valor: "08-APR-2025",
      confianza: 0.95,
    },
    incoterm: {
      valor: "",
      confianza: 0,
    },
    numeroDoc: {
      valor: "MVD0990117",
      confianza: 0.95,
    },
    bultos: {
      valor: "1360",
      confianza: 0.95,
    },
    tipoBulto: {
      valor: "CARTONS",
      confianza: 0.95,
    },
    pesoBruto: {
      valor: "54040.000 KGS",
      confianza: 0.95,
    },
    consignatario: {
      valor: "TO THE ORDER OF MERIDIAN BANK PLC",
      confianza: 0.95,
    },
    flete: {
      valor: "FREIGHT PREPAID",
      confianza: 0.95,
    },
    onBoard: {
      valor: "Shipped on Board STELLA AUSTRAL 08-APR-2025 OCEANLINE Uruguay As agents for the Carrier",
      confianza: 0.95,
    },
    buque: {
      valor: "STELLA AUSTRAL",
      confianza: 0.95,
    },
    onDeck: {
      valor:
        "The shipper acknowledges that the Carrier may carry the goods identified in this bill of lading on the deck of any vessel",
      confianza: 0.9,
    },
    /*
     * Ojo con el escaneo de este documento.
     *
     * Estos campos son los del conocimiento de embarque ORIGINAL, el que se presentó al banco y el
     * banco aceptó. El escaneo que quedó en la carpeta del expediente es otra cosa: la copia de
     * archivo, que arriba dice COPY NON NEGOTIABLE y en la casilla «number of original bills of
     * lading» dice ZERO (0). Leer ese escaneo y examinarlo da una discrepancia —se está
     * presentando una copia y el crédito pide el juego completo de 3/3— que es correcta sobre ese
     * papel y no existía en la presentación real.
     *
     * Vale saberlo antes de una demostración: si el documento que se carga sale de la carpeta y no
     * de la valija que fue al banco, el motor lo va a marcar, y hay que poder explicar por qué.
     */
    juegoOriginales: {
      valor: "three (3) original Bills of Lading",
      confianza: 0.9,
    },
    numeroLC: {
      valor: "LCMRDN25000471",
      confianza: 0.95,
    },
    fechaDocumento: {
      valor: "MONTEVIDEO 08 APR 2025",
      confianza: 0.95,
    },
    referenciaProforma: {
      valor: "",
      confianza: 0,
    },
  },
} as Partial<Record<TipoDocExterno, CamposDoc>>;

/** La fecha a bordo del conocimiento de embarque, que arranca el plazo de presentación. */
export const BL_REAL_CSU2025099 = "08-abr-25";
