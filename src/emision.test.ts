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
