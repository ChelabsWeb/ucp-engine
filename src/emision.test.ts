import { describe, expect, it } from "vitest";
import { revisarCredito } from "./emision";
import { revisarEnmienda } from "./enmienda-vigencia";
import { parseMT700, SWIFT_CSU2025099 } from "./index";

/**
 * La revisión de un crédito antes de emitirlo.
 *
 * Lo que más importa acá son los **falsos positivos**: decirle a un banco que el artículo 14(h) tiene
 * por no puesta una condición que sí funciona lo llevaría a sacar del crédito algo que le servía.
 */

/** Un crédito con las condiciones que se le pasen en el 47A. */
const conCondiciones = (...condiciones: string[]) => {
  const bloque = condiciones.map((c, i) => `          +${i + 1})${c}`).join("\n");
  const swift = SWIFT_CSU2025099.replace(/( {5}47A: Additional Conditions\n)[\s\S]*?(\n {5}71D:)/, `$1${bloque}$2`);
  return parseMT700(swift)!;
};

const noDocumentarias = (p: ReturnType<typeof conCondiciones>) =>
  revisarCredito(p).filter((o) => o.id.startsWith("emision-no-documentaria"));

describe("una condición que sí se acredita con un documento", () => {
  /**
   * El caso que destapó el defecto: el regex cerraba cada alternativa con `\b`, así que
   * `\bdocument\b` no coincidía con «DOCUMENTS» —la «S» no es un límite de palabra— y **toda
   * condición escrita en plural se marcaba como no documentaria**. Las dos primeras de esta lista
   * están en el crédito real del expediente, y son justamente las que el examen ya verifica: el
   * motor se contradecía consigo mismo.
   */
  it.each([
    "ALL DOCUMENTS SHOULD BEAR A DATE ON OR AFTER THE LETTER OF CREDIT DATE.",
    "ALL DOCUMENTS SHOULD INDICATE THE LETTER OF CREDIT NUMBER.",
    "COMMERCIAL INVOICES MUST BE SIGNED",
    "ALL CERTIFICATES MUST BE IN ENGLISH",
    "PACKING LISTS IN DUPLICATE",
    "COPIES OF ALL DOCUMENTS TO BE EMAILED TO THE APPLICANT",
    "STATEMENTS OF THE BENEFICIARY ARE ACCEPTABLE",
    "REPORTS ISSUED BY AN INDEPENDENT SURVEYOR",
  ])("no se marca como no documentaria: %s", (condicion) => {
    expect(noDocumentarias(conCondiciones(condicion))).toEqual([]);
  });

  it("en singular tampoco, que es lo que ya funcionaba", () => {
    expect(noDocumentarias(conCondiciones("A CERTIFICATE OF ORIGIN IS REQUIRED"))).toEqual([]);
  });
});

describe("las cláusulas que no son condiciones sino parámetros del crédito", () => {
  /**
   * Una tolerancia o un permiso de embarque parcial no se acreditan con ningún documento porque no
   * hay nada que acreditar: configuran el crédito, y las UCP las reconocen (arts. 30, 31, 20c). El
   * caso que lo destapó es del crédito real —«A TOLERANCE OF 10 PCT MORE OR LESS IN QUANTITY AND
   * VALUE ALLOWED»— y era una contradicción visible: el motor lee esa tolerancia y la aplica al
   * examen, y al mismo tiempo avisaba que el 14(h) la tenía por no puesta.
   */
  it.each([
    "A TOLERANCE OF 10 PCT MORE OR LESS IN QUANTITY AND VALUE ALLOWED.",
    "PARTIAL SHIPMENTS ALLOWED",
    "TRANSHIPMENT PROHIBITED",
    "SHIPMENT IN THREE INSTALMENTS",
  ])("no se marcan como no documentarias: %s", (condicion) => {
    expect(noDocumentarias(conCondiciones(condicion))).toEqual([]);
  });
});

describe("una condición que ningún documento acredita", () => {
  it.each([
    "THE GOODS MUST BE OF THE FIRST QUALITY AVAILABLE IN THE MARKET",
    "SHIPMENT TO BE EFFECTED BY A VESSEL NOT OLDER THAN 20 YEARS",
    "THE BENEFICIARY MUST HAVE A GOOD REPUTATION IN THE TRADE",
  ])("sí se marca: %s", (condicion) => {
    const o = noDocumentarias(conCondiciones(condicion));
    expect(o).toHaveLength(1);
    expect(o[0]!.fuente).toContain("14h");
  });
});

describe("el crédito real del expediente", () => {
  it("sus condiciones del 47A no se marcan como no documentarias", () => {
    // Las cuatro del caso hablan de fechas de documentos, del número del crédito citado en ellos, de
    // un cargo por discrepancias y de una tolerancia. Ninguna es de las que el 14(h) descarta.
    const marcadas = noDocumentarias(parseMT700(SWIFT_CSU2025099)!);
    expect(marcadas.map((o) => o.donde)).toEqual([]);
  });
});

describe("el que no es el crédito operativo (UCP 600 art. 11)", () => {
  /*
   * Un pre-aviso y un télex que anuncia que el operativo sigue por correo NO son el crédito. El
   * motor los leía igual y dictaminaba sobre ellos, con lo cual el examen, el aviso de rechazo y la
   * hoja firmada quedaban referidos a un instrumento que las UCP dicen que no es el crédito.
   */
  const mt705 = SWIFT_CSU2025099.replace(
    "FIN 710 Adv Third or Non Bank Doc Cred",
    "FIN 705 Pre-Advice of a Documentary Credit",
  );
  const con72Z = (texto: string) =>
    SWIFT_CSU2025099.replace(
      "     72Z: Sender to Receiver Information\n          /ACK/",
      `     72Z: Sender to Receiver Information\n          ${texto}`,
    );
  const revisar = (swift: string) => revisarCredito(parseMT700(swift)!);

  it("11 b: un MT705 es un pre-aviso y no se examina nada contra él", () => {
    const o = revisar(mt705).find((x) => x.id === "ucp-11b");
    expect(o?.gravedad).toBe("IMPIDE");
    expect(o?.fuente).toContain("11b");
  });

  it.each([
    "FULL DETAILS TO FOLLOW BY MAIL",
    "DETAILS TO FOLLOW",
    "MAIL CONFIRMATION WILL BE THE OPERATIVE CREDIT",
    "THIS TELETRANSMISSION IS NOT THE OPERATIVE INSTRUMENT",
  ])("11 a: «%s» dice que el operativo sigue", (texto) => {
    const o = revisar(con72Z(texto)).find((x) => x.id === "ucp-11a");
    expect(o?.gravedad).toBe("IMPIDE");
  });

  it("y el crédito real no se marca: dice «FULL DETAILS» hablando de otra cosa", () => {
    /*
     * La trampa. El 47A del expediente dice «BENEFICIARY SHOULD ADVISE FULL DETAILS OF SHIPMENT
     * WITHIN 05 DAYS». Un patrón que buscara «full details» marcaría como no operativo el crédito
     * con el que se validó el motor entero.
     */
    expect(revisar(SWIFT_CSU2025099).find((x) => x.id === "ucp-11a")).toBeUndefined();
    expect(revisar(SWIFT_CSU2025099).find((x) => x.id === "ucp-11b")).toBeUndefined();
  });
});

describe("la política interna que el crédito se reserva aplicar «a su sola discreción»", () => {
  /*
   * Lo encontró la auditoría de los guardianes del banco de pruebas: el caso TA 884rev afirmaba que
   * el motor leía esta cláusula y **era falso**. No aparecía en ninguna regla del examen, en ninguna
   * verificación manual ni en esta revisión — `verificaciones-manuales.ts` la filtra con razón,
   * porque no es una condición documentaria y no hay papel contra el que verificarla, pero entonces
   * no la miraba nadie.
   *
   * Y es justo lo que un banco necesita ver antes de aceptar una designación, porque la Banking
   * Commission ya resolvió dos veces que la cláusula no vale lo que parece valer: en TA 884rev, que
   * el emisor «is obligated to honour a complying presentation»; en TA 956rev, que invocar el riesgo
   * de compliance interno «would not constitute a valid reason to refuse the presentation» y que
   * nombrar políticas internas en un crédito no es práctica bancaria prudente.
   */
  const politica = (p: ReturnType<typeof conCondiciones>) =>
    revisarCredito(p).filter((o) => o.id === "emision-politica-interna");

  it("la cláusula del caso TA 884rev sale como aviso", () => {
    const o = politica(
      conCondiciones(
        "OUR BANK PROCESS TRANSACTIONS IN ACCORDANCE WITH LOCAL AND INTERNATIONAL LAWS AND REGULATIONS, AND RESERVE THE RIGHT TO COMPLY WITH FOREIGN SANCTIONS AS WELL. CONSEQUENTLY DOCUMENTS ISSUED BY OR SHOWING ANY INVOLVEMENT OF PARTIES SANCTIONED BY ANY COMPETENT AUTHORITY OR CONTAINED ANY INFORMATION THEREON MIGHT NOT BE PROCESSED BY OUR BANK AT OUR SOLE DISCRETION AND WITHOUT ANY LIABILITY ON OUR PART.",
      ),
    );
    expect(o).toHaveLength(1);
    expect(o[0]?.gravedad, "el crédito sigue siendo operable: no impide, avisa").toBe("AVISO");
    expect(o[0]?.fuente).toMatch(/TA 884rev/);
  });

  it("lo que se busca es la discrecionalidad, no la palabra «sanciones»", () => {
    /*
     * Un crédito puede nombrar las sanciones por obligación regulatoria sin reservarse nada, y
     * marcar eso sería ruido en la mitad de los créditos del mundo. Lo que no corresponde es
     * reservarse no procesar «a sola discreción» y sin responsabilidad.
     */
    for (const sinReserva of [
      "THIS CREDIT IS SUBJECT TO APPLICABLE SANCTIONS LAWS AND REGULATIONS.",
      "ALL PARTIES ARE SCREENED AGAINST INTERNATIONAL SANCTIONS LISTS.",
      "OUR BANK COMPLIES WITH AML AND CTF REGULATIONS.",
    ]) {
      expect(politica(conCondiciones(sinReserva)), sinReserva).toEqual([]);
    }
  });

  it("y hacen falta las dos mitades: reservarse el derecho y poder no procesar", () => {
    /* Solo la discrecionalidad, sin decir que podría no procesar: no alcanza. */
    expect(politica(conCondiciones("CHARGES ARE APPLIED AT OUR SOLE DISCRETION."))).toEqual([]);
    /* Y solo la reserva, sin discrecionalidad, tampoco. */
    expect(politica(conCondiciones("DOCUMENTS MIGHT NOT BE PROCESSED IF A COURT ORDER SO REQUIRES."))).toEqual([]);
  });
});

/**
 * «Third party documents are acceptable», que la ICC desaconseja (laudo DOCDEX 206)
 *
 * El panel la desarma: *«a very obscure provision which does not clarify: — in respect of which parties
 * a party has to be considered a "third party"; — whether a document (and which document) is acceptable
 * when issued by a party not mentioned in the credit […]»*. Y lo que importa de verdad, porque es lo que
 * un banco cree que la cláusula le da: *«this clause does not support documents which appear on their
 * face to be inconsistent with one another»*.
 *
 * La propia ICC se negó a interpretarla —publicación 565, R 246— *«with the aim not to support in any way
 * this term and to discourage applicants and issuing banks from adopting such terminology»*. Es de las
 * pocas veces que dice explícitamente que una redacción no se debería usar.
 */
describe("la cláusula del tercero que la ICC desaconseja (DOCDEX 206)", () => {
  const tercero = (p: ReturnType<typeof conCondiciones>) =>
    revisarCredito(p).filter((o) => o.id === "emision-tercero-aceptable");

  it("la cláusula pelada sale como aviso y nombra el laudo", () => {
    const o = tercero(conCondiciones("THIRD PARTY DOCUMENTS ARE ACCEPTABLE"));
    expect(o).toHaveLength(1);
    expect(o[0]?.gravedad, "el crédito sigue siendo operable: no impide, avisa").toBe("AVISO");
    expect(o[0]?.fuente).toMatch(/DOCDEX 206/);
  });

  /*
   * **Y el freno lo decidió el crédito real del expediente.**
   *
   * Su 47A dice «THIRD PARTY DOCUMENTS **EXCEPT DRAFT AND COMMERCIAL INVOICE** ACCEPTABLE», o sea que
   * **sí aclara qué documentos** — que es exactamente la primera de las tres cosas que el panel echa en
   * falta. Un banco que escribe la excepción está escribiendo la cláusula bien, y marcarlo sería ruido
   * en un crédito mejor redactado que el del laudo. La primera versión de la regla lo marcaba y el test
   * de «el crédito real no tiene nada que reescribir» se puso rojo.
   */
  it("pero la que aclara qué documentos no se marca, que es la del crédito real", () => {
    for (const c of [
      "THIRD PARTY DOCUMENTS EXCEPT DRAFT AND COMMERCIAL INVOICE ACCEPTABLE",
      "THIRD PARTY DOCUMENTS OTHER THAN THE INVOICE ARE ACCEPTABLE",
      "THIRD PARTY DOCUMENTS EXCLUDING THE DRAFT ACCEPTABLE",
    ])
      expect(tercero(conCondiciones(c))).toHaveLength(0);
  });

  it("y un crédito que no la tiene no gana ninguna observación", () => {
    expect(tercero(conCondiciones("ALL DOCUMENTS MUST BEAR THE CREDIT NUMBER"))).toHaveLength(0);
  });
});
/**
 * Un calendario de embarques es el artículo 32, no una condición no documentaria (laudo DOCDEX 204)
 *
 * El 47A del laudo es un calendario de tres fechas, y el motor lo mandaba por el peor camino posible:
 * `revisarCredito` le decía al banco que era una condición no documentaria **tenida por no puesta**
 * (14 h), justo la cláusula cuyo incumplimiento deja el crédito sin disponibilidad para esa cuota y las
 * siguientes. Ahora sale como AVISO nombrando el artículo 32 y mandando a transcribirla al calendario de
 * cuotas, que es la respuesta que el motor tiene para eso.
 *
 * Y el aviso lleva adentro la trampa que el laudo resuelve: *«The shipment schedule does not demand that
 * at least 40 pct of the goods quantity shall be shipped after 97-07-31 but before 97-08-31»*. Una fecha
 * límite acumulada no es un período con inicio y fin.
 */
describe("un calendario de embarques (laudo DOCDEX 204)", () => {
  const CALENDARIO =
    "SHIPPING SCHEDULE: AT LEAST 40 PCT OF THE GOODS QUANTITY TO BE SHIPPED BEFORE 31.07.97, AT LEAST 40 PCT OF THE GOODS QUANTITY TO BE SHIPPED BEFORE 31.08.97.";

  it("no se tiene por no puesta", () => {
    expect(noDocumentarias(conCondiciones(CALENDARIO)), "es un término del crédito, no una condición").toEqual([]);
  });

  it("y sale un aviso que nombra el artículo 32 y manda a transcribir el calendario", () => {
    const r = revisarCredito(conCondiciones(CALENDARIO)).find((o) => o.id.startsWith("emision-calendario"));
    expect(r?.gravedad, "el crédito sigue siendo operable: avisa, no impide").toBe("AVISO");
    expect(r?.fuente).toContain("32");
    expect(r?.sugerencia, "la trampa que el laudo resuelve va adentro del aviso").toContain("acumulada");
  });

  it("y un crédito sin calendario no gana ningún aviso", () => {
    expect(
      revisarCredito(conCondiciones("ALL DOCUMENTS MUST INDICATE THE LC NUMBER.")).filter((o) =>
        o.id.startsWith("emision-calendario"),
      ),
    ).toEqual([]);
  });
});
/**
 * Un documento que **el ordenante presenta él mismo** (laudo DOCDEX 209)
 *
 * El motor ya avisaba sobre un documento que el ordenante **emite** —deja el cobro a voluntad del
 * comprador— y faltaba el caso peor: uno que el ordenante **presenta directo al banco emisor**. Ahí el
 * beneficiario no tiene manera de saber si la presentación está completa, y si no está no tiene nada que
 * hacer.
 *
 * El laudo es ese expediente: el beneficiario embarcó, presentó todo lo que estaba bajo su control, el
 * consignatario alcanzó a retirar un tercio de la mercadería y el panel decidió que *«the issuing bank is
 * not liable to pay under its credit»*, porque *«UCP and international standard banking practice require
 * the presentation of all documents as stipulated in the credit […] before the issuing bank's obligation
 * under the credit comes into effect»*. El argumento del beneficiario —haber presentado *«all stipulated
 * documents within the beneficiary's control»*— no alcanzó.
 */
describe("un documento que el ordenante presenta él mismo (laudo DOCDEX 209)", () => {
  const con = (exigencia: string) => {
    const swift = SWIFT_CSU2025099.replace(/( {5}46A: Documents Required\n)/, `$1          +99)${exigencia}\n`);
    return revisarCredito(parseMT700(swift)!).filter((o) => o.id.startsWith("emision-presenta-ordenante"));
  };

  it("sale como CONFLICTO y nombra el laudo", () => {
    const [r] = con(
      "INSPECTION CERTIFICATE TO BE ISSUED BY THE APPLICANT AND PRESENTED BY THE APPLICANT DIRECTLY TO THE ISSUING BANK.",
    );
    expect(r?.gravedad, "el beneficiario no puede completar la presentación").toBe("CONFLICTO");
    expect(r?.fuente).toContain("DOCDEX 209");
    expect(r?.sugerencia).toContain("no nace");
  });

  it("y «the applicant will present» también", () => {
    expect(con("CERTIFICATE OF QUALITY WHICH THE APPLICANT WILL PRESENT TO US.")).toHaveLength(1);
  });

  /*
   * Y el freno: un documento que el beneficiario presenta no entra, ni siquiera cuando el ordenante
   * aparece nombrado en la línea por otra razón —que es la mitad del 46A de cualquier crédito—.
   */
  it("un documento que el beneficiario presenta no entra", () => {
    expect(con("BENEFICIARY'S CERTIFICATE STATING THAT ONE SET OF COPY DOCUMENTS WAS SENT TO THE APPLICANT.")).toEqual(
      [],
    );
    expect(con("CERTIFICATE OF ORIGIN ISSUED BY CHAMBER OF COMMERCE SHOWING THE APPLICANT AS CONSIGNEE.")).toEqual([]);
  });
});
/**
 * Una cláusula que deja deducir del cobro lo que el ordenante reclame (laudo DOCDEX 212)
 *
 * Un crédito de USD 2.417.000 con la cláusula *«The opening bank have the right to deduct the claim amount
 * from the payment under negotiation mentioned above directly with the applicant's applications»*, y el
 * emisor se negó a pagar un vencimiento de USD 966.800 porque *«the applicant had asked not to pay the
 * bill due to serious quality problems of goods»*.
 *
 * El panel la detesta y la hace valer, que es la combinación que importa: *«It is most unusual (and
 * certainly against the spirit of UCP 500)»* pero *«the issuing bank is entitled to deduct the claim
 * amount from payments under the letter of credit»*, y *«a beneficiary who accepts a letter of credit
 * containing a clause permitting the issuing bank to deduct certain amounts […] does so at his own
 * risk»*.
 *
 * Lo que esto corrige es un **consejo**: la cláusula no menciona ningún documento, así que salía como
 * condición no documentaria tenida por no puesta (14 h). Segunda vez que ese consejo es el peligroso — la
 * primera fue el calendario de embarques del laudo 204.
 */
describe("una cláusula que deja deducir del cobro (laudo DOCDEX 212)", () => {
  const CLAUSULA =
    "THE OPENING BANK HAVE THE RIGHT TO DEDUCT THE CLAIM AMOUNT FROM THE PAYMENT UNDER NEGOTIATION MENTIONED ABOVE DIRECTLY WITH THE APPLICANT'S APPLICATIONS.";

  it("sale como CONFLICTO y nombra el laudo", () => {
    const r = revisarCredito(conCondiciones(CLAUSULA)).find((o) => o.id.startsWith("emision-deduccion"));
    expect(r?.gravedad).toBe("CONFLICTO");
    expect(r?.fuente).toContain("DOCDEX 212");
    expect(r?.sugerencia, "la sugerencia dice qué le falta a la cláusula si se queda").toContain("tope");
  });

  it("y NO se tiene por no puesta: el panel la hace valer", () => {
    expect(noDocumentarias(conCondiciones(CLAUSULA)), "decirle al banco que la ignore es el consejo contrario").toEqual(
      [],
    );
  });

  /* El freno es el fee de discrepancia, que es una deducción legítima y está en el crédito real. */
  it("el fee de discrepancia no es una cláusula de deducción", () => {
    for (const c of [
      "A DISCREPANCY FEE OF USD 80/- OR ITS EQUIVALENT WILL BE DEDUCTED FROM PROCEEDS FOR EACH SET OF DOCUMENTS PRESENTED WITH DISCREPANCIES.",
      "ALL BANK CHARGES OUTSIDE THE ISSUING BANK'S COUNTRY WILL BE DEDUCTED FROM THE PROCEEDS.",
    ])
      expect(
        revisarCredito(conCondiciones(c)).filter((o) => o.id.startsWith("emision-deduccion")),
        c,
      ).toEqual([]);
  });

  it("y el crédito real del expediente no gana ninguna observación nueva", () => {
    expect(revisarCredito(parseMT700(SWIFT_CSU2025099)!).filter((o) => o.id.startsWith("emision-deduccion"))).toEqual(
      [],
    );
  });

  /*
   * Y la cláusula penal, que escribe el reclamo primero y la deducción después (laudo DOCDEX 385)
   *
   * Es **la tercera cara del consejo del 14 (h)** —después del calendario de embarques del 204 y de la
   * deducción por instrucción del ordenante del 212— y acá el defecto era peor, porque dependía de una
   * palabra: con «invoice value» adentro la cláusula mencionaba un documento y el motor se callaba; con
   * «value of the goods» salía SE_DESCARTA, o sea «los bancos la tienen por no puesta». El panel decide lo
   * contrario y cobra la penalidad: *«the penalty clause was not non-documentary due to its linkage to
   * shipment date on the bill of lading»*, y *«as the penalty condition applied, the approval of the
   * Claimant was not required»*.
   */
  const PENAL =
    "IN CASE OF LATE SHIPMENT A PENALTY OF 10 PCT OF THE VALUE OF THE GOODS FOR A DELAY OF 1 OR MORE DAYS WILL BE DEDUCTED FROM THE PAYMENT.";

  it("la cláusula penal sale como CONFLICTO y no se tiene por no puesta", () => {
    const r = revisarCredito(conCondiciones(PENAL));
    expect(r.find((o) => o.id.startsWith("emision-deduccion"))?.gravedad).toBe("CONFLICTO");
    expect(
      r.filter((o) => o.id.startsWith("emision-no-documentaria")),
      "el panel la hace valer: aconsejar ignorarla es el consejo contrario",
    ).toEqual([]);
  });

  it("y la misma cláusula con «invoice value» da lo mismo: no dependía de la palabra", () => {
    const conFactura = PENAL.replace("THE VALUE OF THE GOODS", "THE INVOICE VALUE");
    expect(revisarCredito(conCondiciones(conFactura)).find((o) => o.id.startsWith("emision-deduccion"))?.gravedad).toBe(
      "CONFLICTO",
    );
  });
});
/**
 * Una cláusula de pago que nombra menos documentos de los que el crédito exige (laudo DOCDEX 362)
 *
 * Un crédito de pago mixto en tres tramos donde el último, del 10 %, pedía *«an acceptance certificate and
 * a performance bank guarantee»* y además decía que el banco pagaría **solo** contra factura y garantía. El
 * beneficiario presentó la factura y la garantía, el emisor rechazó, hubo una medida judicial de por medio,
 * y el panel: *«Usage of the word "only" and the missing requirement for an acceptance certificate gave
 * rise to ambiguity as to the requirements for payment […] the risk of misinterpretation must be borne by
 * the Respondent»*, y *«the Respondent bore responsibility for ambiguous instructions. Hence the Respondent
 * should have honoured presentation of the invoice and bank guarantee alone»*.
 */
describe("el pago «solo contra» menos documentos de los que el crédito pide (laudo DOCDEX 362)", () => {
  const con = (condicion: string, exigidos?: string[]) => {
    const swift = SWIFT_CSU2025099.replace(/( {5}47A: Additional Conditions\n)/, `$1          +99)${condicion}\n`);
    const p = parseMT700(swift)!;
    const lc = exigidos ? { ...p.lc, documentosExigidos: exigidos } : p.lc;
    return revisarCredito({ ...p, lc }).filter((o) => o.id.startsWith("emision-pago-contra-menos"));
  };

  const TRES = [
    "1. SIGNED COMMERCIAL INVOICE IN 3 ORIGINALS",
    "2. PACKING LIST IN 3 ORIGINALS",
    "3. CERTIFICATE OF ORIGIN ISSUED BY CHAMBER OF COMMERCE",
  ];

  it("sale como CONFLICTO y nombra el laudo", () => {
    const [r] = con("PAYMENT WILL BE MADE ONLY AGAINST COMMERCIAL INVOICE AND CERTIFICATE OF ORIGIN.", TRES);
    expect(r?.gravedad).toBe("CONFLICTO");
    expect(r?.fuente).toContain("DOCDEX 362");
    expect(r?.sugerencia).toContain("lista más corta");
  });

  /* Y los tres frenos, que son lo que lo hace usable. */
  it("si la cláusula nombra todo lo que el crédito pide, no se marca", () => {
    expect(
      con("PAYMENT WILL BE MADE ONLY AGAINST COMMERCIAL INVOICE, PACKING LIST AND CERTIFICATE OF ORIGIN.", TRES),
    ).toEqual([]);
  });

  it("sin la palabra «only» tampoco: un pago mixto puede nombrar los documentos de cada tramo", () => {
    expect(con("PAYMENT OF THE FINAL TRANCHE WILL BE MADE AGAINST COMMERCIAL INVOICE AND GUARANTEE.", TRES)).toEqual(
      [],
    );
  });

  it("y una cláusula que no nombra ningún documento concreto tampoco", () => {
    expect(con("PAYMENT WILL BE MADE ONLY AGAINST PRESENTATION OF THE DOCUMENTS SPECIFIED ABOVE.", TRES)).toEqual([]);
  });

  it("y el crédito real del expediente no gana ninguna observación", () => {
    expect(
      revisarCredito(parseMT700(SWIFT_CSU2025099)!).filter((o) => o.id.startsWith("emision-pago-contra-menos")),
    ).toEqual([]);
  });
});

/**
 * La cláusula que hace fluctuar el importe (laudo DOCDEX 281 y Korea Exchange Bank v SCB)
 *
 * La revisión del crédito la sacaba como condición no documentaria **tenida por no puesta**, que es la
 * séptima cara del consejo del 14 (h) y la primera que contradice al propio motor: `importeFluctuaPorElCredito`
 * existe desde *Korea Exchange Bank v Standard Chartered Bank* [2005] SGHC 220 y ablanda `fac-monto` y
 * `giro-saldo` porque esa sentencia dice que sin la cláusula *«the credit would be unworkable»*.
 *
 * Y el laudo DOCDEX 281 agrega la redacción que el motor **no reconocía**: la prueba pedía la palabra
 * «automatic» y esta cláusula dice «without any further amendment on our part». El panel: *«Such wording
 * must be considered automatic and unlimited»*.
 */
describe("el importe que el 47A deja fluctuar (laudo DOCDEX 281)", () => {
  const con = (condicion: string) => {
    const swift = SWIFT_CSU2025099.replace(/( {5}47A: Additional Conditions\n)/, `$1          +99)${condicion}\n`);
    return revisarCredito(parseMT700(swift)!).filter(
      (o) => o.id.startsWith("emision-importe-fluctuante") || o.id.startsWith("emision-no-documentaria"),
    );
  };

  const DEL_LAUDO =
    "K) THE VALUE OF THE L/C MAY ESCALATE DEESCALATE IN RELATION TO ABOVE PRICE CLAUSE WITHOUT ANY FURTHER AMENDMENT ON OUR PART";

  it("sale como AVISO y nombra las dos autoridades", () => {
    const r = con(DEL_LAUDO).find((o) => o.id.startsWith("emision-importe-fluctuante"));
    expect(r?.gravedad).toBe("AVISO");
    expect(r?.fuente).toContain("DOCDEX 281");
    expect(r?.fuente).toContain("Korea Exchange Bank");
  });

  it("y ya no se aconseja tenerla por no puesta", () => {
    expect(con(DEL_LAUDO).filter((o) => o.id.startsWith("emision-no-documentaria"))).toEqual([]);
  });

  it("y la redacción de la sentencia también entra", () => {
    const r = con(
      "THE AMOUNT OF THIS LETTER OF CREDIT SHALL AUTOMATICALLY FLUCTUATE TO COVER ANY INCREASE/DECREASE ACCORDING TO THE PRICE CLAUSE",
    ).find((o) => o.id.startsWith("emision-importe-fluctuante"));
    expect(r?.gravedad).toBe("AVISO");
  });

  /* El freno: el precio de la mercadería que fluctúa no es el importe del crédito. */
  it("pero una cláusula sobre el precio y no sobre el importe no se marca", () => {
    expect(
      con("THE PRICE SHALL AUTOMATICALLY FLUCTUATE WITH THE PLATTS QUOTATION ON THE B/L DATE").filter((o) =>
        o.id.startsWith("emision-importe-fluctuante"),
      ),
    ).toEqual([]);
  });

  it("y el crédito real del expediente no gana ninguna observación", () => {
    expect(
      revisarCredito(parseMT700(SWIFT_CSU2025099)!).filter((o) => o.id.startsWith("emision-importe-fluctuante")),
    ).toEqual([]);
  });
});

/**
 * Un 48 que fija el plazo hasta el vencimiento no es un 48 vacío (laudo DOCDEX 262)
 *
 * `diasPresentacion` devuelve null cuando el campo no trae un número, así que un crédito que dice
 * «DOCUMENTS TO BE PRESENTED WITHIN LETTER OF CREDIT VALIDITY» caía en `emision-sin-plazo` y la revisión
 * decía «el crédito no fija plazo de presentación: rigen 21 días desde el embarque» — que es palabra por
 * palabra la lectura que el Commercial Court inglés declaró inválida en *Deutsche Bank AG v CIMB Bank
 * Berhad* [2017] EWHC 3380 (Comm), con USD 9.959.452,57 de condena.
 *
 * El examen ya lo sabía: `plazoHastaElVencimiento` existe por esa sentencia. Las dos mitades del motor
 * decían cosas distintas del mismo campo.
 */
describe("el campo 48 que fija el plazo hasta el vencimiento (laudo DOCDEX 262)", () => {
  const con = (texto48: string) => {
    const p = parseMT700(SWIFT_CSU2025099)!;
    return revisarCredito({ ...p, lc: { ...p.lc, plazoPresentacion: texto48 } }).filter(
      (o) => o.id.startsWith("emision-plazo-hasta-el-vencimiento") || o.id.startsWith("emision-sin-plazo"),
    );
  };

  it.each([
    "DOCUMENTS TO BE PRESENTED WITHIN LETTER OF CREDIT VALIDITY",
    "WITHIN THE VALIDITY OF THE CREDIT",
    "DOCUMENTS TO BE PRESENTED NOT LATER THAN THE EXPIRY DATE",
  ])("«%s» no sale como «sin plazo»", (texto) => {
    const [r] = con(texto);
    expect(r?.id).toContain("plazo-hasta-el-vencimiento");
    expect(r?.gravedad).toBe("AVISO");
    expect(r?.fuente).toContain("CIMB");
  });

  it("y un 48 vacío de verdad sigue avisando que rigen los 21 días", () => {
    const [r] = con("");
    expect(r?.id).toBe("emision-sin-plazo");
  });

  it("y el crédito real, que fija el plazo en días, no saca ninguno de los dos", () => {
    expect(
      revisarCredito(parseMT700(SWIFT_CSU2025099)!).filter(
        (o) => o.id.startsWith("emision-plazo-hasta-el-vencimiento") || o.id.startsWith("emision-sin-plazo"),
      ),
    ).toEqual([]);
  });
});

/**
 * La cláusula que prohíbe los errores de tipeo (laudo DOCDEX 249)
 *
 * El crédito se enmendó para decir *«Typographical and/or spelling errors, not be considered as
 * discrepancies except in value, unit price, goods description and quantity. But for bills of lading,
 * certificate of origin and all certificates issued by S.G.S. or [beneficiary] is prohibited showing any
 * typing error»*, y el panel la hizo valer: *«the amendment actually overrides the general provision in ISBP
 * paragraph 28»*, aunque *«words differently typed are usually not to be considered discrepancies»*. Y
 * expresó su *«strong disapproval»* de *«a specious attempt to prevent issuing banks from paying»*.
 */
describe("la cláusula que prohíbe los errores de tipeo (laudo DOCDEX 249)", () => {
  const con = (condicion: string) => {
    const swift = SWIFT_CSU2025099.replace(/( {5}47A: Additional Conditions\n)/, `$1          +99)${condicion}\n`);
    return revisarCredito(parseMT700(swift)!).filter((o) => o.id.startsWith("emision-prohibe-tipeo"));
  };

  it("sale como CONFLICTO y nombra el laudo", () => {
    const [r] = con(
      "TYPOGRAPHICAL AND/OR SPELLING ERRORS, NOT BE CONSIDERED AS DISCREPANCIES EXCEPT IN VALUE, UNIT PRICE, GOODS DESCRIPTION AND QUANTITY. BUT FOR BILLS OF LADING, CERTIFICATE OF ORIGIN AND ALL CERTIFICATES IS PROHIBITED SHOWING ANY TYPING ERROR",
    );
    expect(r?.gravedad).toBe("CONFLICTO");
    expect(r?.fuente).toContain("DOCDEX 249");
    expect(r?.que).toContain("A23");
  });

  it.each([
    "TYPING ERRORS ARE PROHIBITED ON ALL DOCUMENTS",
    "SPELLING ERRORS NOT ACCEPTABLE",
    "TYPOGRAPHICAL ERRORS IN ANY DOCUMENT ARE NOT ALLOWED",
  ])("«%s» también", (c) => {
    expect(con(c)).toHaveLength(1);
  });

  /*
   * **El freno es la dirección de la frase.** La mitad benévola es corriente, inofensiva y es lo que la
   * ISBP ya dice: marcarla sería ruido en cualquier crédito bien redactado.
   */
  it.each([
    "TYPOGRAPHICAL AND/OR SPELLING ERRORS ARE NOT TO BE CONSIDERED AS DISCREPANCIES",
    "MINOR TYPING MISTAKES SHALL BE ACCEPTABLE",
  ])("«%s» no se marca", (c) => {
    expect(con(c)).toEqual([]);
  });

  it("y el crédito real del expediente no gana ninguna observación", () => {
    expect(
      revisarCredito(parseMT700(SWIFT_CSU2025099)!).filter((o) => o.id.startsWith("emision-prohibe-tipeo")),
    ).toEqual([]);
  });

  /* Un 47A largo no puede colgar el motor: es lo que costó `importeFluctuaPorElCredito`. */
  it("y no se cuelga con una condición larga", () => {
    const largo = `${"PROHIBITED ".repeat(900)}END`;
    const t0 = Date.now();
    con(largo);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

/**
 * El endoso que el beneficiario no puede hacer (laudo DOCDEX 288)
 *
 * El crédito pedía el conocimiento «issued to the order of Bank V» —el banco emisor— «blank endorsed», el
 * beneficiario presentó el juego *«precisely as stated in the credit»* sin el endoso, y el emisor rechazó.
 * Unánime, con los dos respondentes en silencio: *«A bill of lading issued to the order of a party can only
 * be endorsed by the party stated in the "consignee" field of the bill of lading. Only when the B/L is made
 * out to order of the shipper is the shipper able to endorse in blank»*, y el emisor tiene que retirar el
 * rechazo y pagar el crédito **más la estadía**.
 *
 * La otra forma de la misma irregularidad la trae la Opinión TA 814rev4: *«A bill of lading that is straight
 * consigned to the applicant cannot be endorsed»*.
 */
describe("el endoso que el beneficiario no puede hacer (laudo DOCDEX 288)", () => {
  const con = (linea46a: string) => {
    const p = parseMT700(SWIFT_CSU2025099)!;
    return revisarCredito({ ...p, lc: { ...p.lc, documentosExigidos: [linea46a] } }).filter((o) =>
      o.id.startsWith("emision-endoso-imposible"),
    );
  };

  it("a la orden del banco emisor y endosado en blanco sale como CONFLICTO", () => {
    const [r] = con(
      "FULL SET 3/3 SHIPPED ON BOARD OCEAN BILLS OF LADING ISSUED TO THE ORDER OF BANK V, BLANK ENDORSED, MARKED FREIGHT PREPAID AND NOTIFY APPLICANT",
    );
    expect(r?.gravedad).toBe("CONFLICTO");
    expect(r?.fuente).toContain("DOCDEX 288");
    expect(r?.que).toContain("BANK V");
    expect(r?.sugerencia).toContain("estadía");
  });

  it("y consignado derecho al ordenante también, que es la mitad de TA 814rev4", () => {
    const [r] = con("FULL SET OF BILLS OF LADING CONSIGNED TO APPLICANT, BLANK ENDORSED");
    expect(r?.gravedad).toBe("CONFLICTO");
  });

  /* Los frenos: el crédito bien redactado es justamente el que el panel señala como el bueno. */
  it.each([
    "FULL SET OF ORIGINAL BILLS OF LADING MADE OUT TO ORDER AND BLANK ENDORSED",
    "FULL SET OF BILLS OF LADING TO THE ORDER OF SHIPPER AND BLANK ENDORSED",
    "FULL SET OF BILLS OF LADING TO THE ORDER OF THE BENEFICIARY, BLANK ENDORSED",
  ])("«%s» no se marca", (linea) => {
    expect(con(linea)).toEqual([]);
  });

  it("ni un crédito que consigna a un tercero sin pedir endoso", () => {
    expect(con("FULL SET OF BILLS OF LADING ISSUED TO THE ORDER OF BANK V, MARKED FREIGHT PREPAID")).toEqual([]);
  });

  it("ni cuando el nombre que el crédito pone es el del beneficiario escrito de otra manera", () => {
    /* El 59 del crédito real dice «CEREALSUR S.A»; acá va sin el punto y con la forma entera. */
    expect(con("FULL SET OF BILLS OF LADING TO THE ORDER OF CEREALSUR SA, BLANK ENDORSED")).toEqual([]);
  });

  it("y el crédito real del expediente no gana ninguna observación", () => {
    expect(
      revisarCredito(parseMT700(SWIFT_CSU2025099)!).filter((o) => o.id.startsWith("emision-endoso-imposible")),
    ).toEqual([]);
  });
});

/**
 * Una cancelación necesita el sí del beneficiario (laudo DOCDEX 358)
 *
 * El emisor le dijo al banco designado *«that the beneficiary wished to cancel the credit and that the file
 * should be closed»*, el designado presentó documentos conformes antes del vencimiento y el emisor los
 * devolvió por tener el crédito por cancelado. El panel: *«a credit cannot be cancelled without the
 * agreement of the beneficiary. A statement from the Respondent that the beneficiary wished to cancel the
 * credit does not mean that the beneficiary has accepted such cancellation»*, y *«In view of the fact that
 * the beneficiary presented documents to the Claimant, this clearly indicated that the request for
 * cancellation by the Respondent had been rejected by the beneficiary»*.
 */
describe("una cancelación necesita el sí del beneficiario (laudo DOCDEX 358)", () => {
  const con = (narrativa: string, estado: Parameters<typeof revisarEnmienda>[1] = "SIN_RESPUESTA") =>
    revisarEnmienda({ numeroCredito: "LCMRDN25000471", narrativa } as never, estado).find((o) => o.id === "ucp-10a");

  it("el pedido de cancelar sale con el artículo 10 (a) y el laudo", () => {
    const r = con("THE BENEFICIARY WISHES TO CANCEL THIS CREDIT. PLEASE CLOSE YOUR FILE.");
    expect(r?.fuente).toContain("10a");
    expect(r?.fuente).toContain("DOCDEX 358");
    expect(r?.porQue).toContain("precluye");
  });

  it("y «please close your file» solo también", () => {
    expect(con("PLEASE CLOSE YOUR FILE AND RETURN THE CREDIT TO US.")).toBeDefined();
  });

  /* Con el beneficiario de acuerdo no hay nada que avisar: el artículo lo admite. */
  it("aceptada por el beneficiario, no se avisa nada", () => {
    expect(con("THE BENEFICIARY WISHES TO CANCEL THIS CREDIT.", "ACEPTADA")).toBeUndefined();
  });

  it("y una enmienda corriente no se confunde con una cancelación", () => {
    expect(con("THE LATEST SHIPMENT DATE IS EXTENDED TO 31.05.2025.")).toBeUndefined();
  });
});
/**
 * El giro librado sobre el banco designado (laudo DOCDEX 366, ISBP 745 B10)
 *
 * Un crédito de cuatro pagos parciales confirmado por el banco con el que estaba disponible, y los giros
 * librados sobre ese mismo banco. El panel rinde el párrafo B10 —palabras del panel, no texto de la ISBP, que
 * no está comprada—: *«when a credit is available by negotiation with a nominated bank or any bank, the
 * draft is to be drawn on a bank other than the nominated bank»*, y agrega que *«neither the UCP 600 nor
 * international standard banking practice provided any guidance for negotiation of drafts by the drawee bank
 * itself»*.
 *
 * Y el final es lo que lo vuelve un CONFLICTO: la ambigüedad era del emisor **y el beneficiario igual perdió
 * el cuarto pago**. Al lado del laudo 362, que usa la misma consideración preliminar para el lado contrario.
 */
describe("el giro librado sobre el banco designado (laudo DOCDEX 366)", () => {
  const con = (disponible: string, librado: string) => {
    const swift = SWIFT_CSU2025099.replace(
      /( {5}41D: Available With\.\.\.By\.\.\. - Name&Addr\n)[\s\S]*?(\n {5}42C:)/,
      `$1${disponible}$2`,
    ).replace(/( {5}42D: Drawee - Name & Address\n)[\s\S]*?(\n {5}43P:)/, `$1${librado}$2`);
    return revisarCredito(parseMT700(swift)!).filter((o) => o.id === "emision-giro-sobre-el-designado");
  };

  it("sale como CONFLICTO y nombra el laudo y el párrafo", () => {
    const [r] = con("          MERIDIAN BANK PLC\n          BY NEGOTIATION", "          MERIDIAN BANK PLC");
    expect(r?.gravedad).toBe("CONFLICTO");
    expect(r?.fuente).toContain("DOCDEX 366");
    expect(r?.fuente).toContain("B10");
    /*
     * Y el artículo 2, que es la autoridad más fuerte de las tres: la definición de negociación de las UCP
     * dice lo mismo entre paréntesis —«the purchase by the nominated bank of drafts (drawn on a bank other
     * than the nominated bank)»— y el laudo DOCDEX 364 la transcribe. Un párrafo de la ISBP que este repo
     * no puede comprar queda como respaldo, no como la única pata.
     */
    expect(r?.fuente, "el texto de las UCP dice lo mismo que el párrafo rendido").toContain("UCP 600 2");
  });

  /* Los tres frenos, que son lo que lo hace usable en un crédito corriente. */
  it("«any bank by negotiation» con el giro sobre el emisor no se marca", () => {
    expect(con("          ANY BANK IN URUGUAY\n          BY NEGOTIATION", "          MERIDIAN BANK PLC")).toEqual([]);
  });

  it("y un designado distinto del librado tampoco", () => {
    expect(
      con("          BANCO LITORAL (URUGUAY) S.A.\n          BY NEGOTIATION", "          MERIDIAN BANK PLC"),
    ).toEqual([]);
  });

  it("y sin negociación tampoco: el párrafo habla de créditos disponibles por negociación", () => {
    expect(con("          MERIDIAN BANK PLC\n          BY ACCEPTANCE", "          MERIDIAN BANK PLC")).toEqual([]);
  });

  it("y el crédito real del expediente no gana ninguna observación", () => {
    expect(
      revisarCredito(parseMT700(SWIFT_CSU2025099)!).filter((o) => o.id === "emision-giro-sobre-el-designado"),
    ).toEqual([]);
  });
});
/**
 * El artículo 6 (b) vive en el campo 41, no en el 42C
 *
 * El 42C es el plazo del **giro** y solo existe cuando el crédito pide giro; cómo está disponible el crédito
 * lo dice el 41. Mirando el campo equivocado, un crédito disponible por pago diferido sin giro —que es
 * corriente— salía con un **IMPIDE** diciendo que no dice si es a la vista, a plazo, por aceptación o por
 * negociación.
 *
 * **Lo encontró el corpus de los créditos del banco de pruebas** —`emision-de-los-creditos.test.ts`, que
 * existe porque `revisarCredito` no llega al tablero—: disparaba en más de sesenta de los noventa y ocho. El
 * crédito real del expediente tiene las dos cosas, así que el test de «el crédito real no tiene nada que
 * reescribir» no lo podía ver.
 */
describe("el artículo 6 (b) se lee del campo 41", () => {
  const con = (campo41: string, campo42: string | null) => {
    let swift = SWIFT_CSU2025099.replace(
      /( {5}41D: Available With\.\.\.By\.\.\. - Name&Addr\n)[\s\S]*?(\n {5}42C:)/,
      `$1${campo41}$2`,
    );
    swift =
      campo42 === null
        ? swift.replace(/ {5}42C: Drafts at\.\.\.\n[\s\S]*?(\n {5}42D:)/, "$1")
        : swift.replace(/( {5}42C: Drafts at\.\.\.\n)[\s\S]*?(\n {5}42D:)/, `$1          ${campo42}$2`);
    return revisarCredito(parseMT700(swift)!).filter((o) => o.id === "emision-forma");
  };

  it.each([
    ["ANY BANK IN URUGUAY\n          BY NEGOTIATION", "por negociación"],
    ["MERIDIAN BANK PLC\n          BY DEFERRED PAYMENT", "por pago diferido"],
    ["MERIDIAN BANK PLC\n          BY ACCEPTANCE", "por aceptación"],
    ["MERIDIAN BANK PLC\n          BY PAYMENT", "por pago"],
  ])("un crédito %s sin 42C no es inoperable", (campo41) => {
    expect(con(`          ${campo41}`, null)).toEqual([]);
  });

  it("y el que no lo dice en ninguno de los dos campos sigue saliendo como IMPIDE", () => {
    const [r] = con("          MERIDIAN BANK PLC", null);
    expect(r?.gravedad).toBe("IMPIDE");
    expect(r?.donde, "y la observación nombra los dos campos").toContain("41");
  });

  it("y el 42C solo también alcanza: un crédito que pide giro a la vista lo dice ahí", () => {
    expect(con("          MERIDIAN BANK PLC", "SIGHT")).toEqual([]);
  });
});
