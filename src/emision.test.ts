import { describe, expect, it } from "vitest";
import { revisarCredito } from "./emision";
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
