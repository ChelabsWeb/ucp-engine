import { describe, expect, it } from "vitest";
import { articuloDelModo, buqueDeLaAnotacion, type ModoTransporte, modoDelDocumento } from "./transporte";

/**
 * Qué clase de documento de transporte se presentó.
 *
 * Importa porque las UCP 600 dedican siete artículos al transporte —19 a 25— y cada uno pide cosas
 * distintas. El motor examinaba todo con el artículo 20, el marítimo: a un aéreo le pedía la
 * anotación de a bordo, que un aéreo no tiene nunca. Antes de aplicar una regla hay que saber cuál
 * corresponde.
 */

const c = (v: string) => ({ valor: v, confianza: 0.9 });
const doc = (campos: Record<string, { valor: string; confianza: number }>) =>
  ({ exportador: c(""), ...campos }) as never;

describe("de qué clase es el documento", () => {
  it.each<[string, ModoTransporte, Record<string, { valor: string; confianza: number }>]>([
    ["un conocimiento marítimo", "MARITIMO", { numeroDoc: c("MVD0990117"), buque: c("STELLA AUSTRAL") }],
    [
      "un air waybill por su número de once dígitos",
      "AEREO",
      { numeroDoc: c("020-12345678"), puertoEmbarque: c("MONTEVIDEO AIRPORT") },
    ],
    ["uno que se llama air waybill", "AEREO", { tipoTransporte: c("AIR WAYBILL") }],
    ["un sea waybill no negociable", "SEA_WAYBILL", { tipoTransporte: c("NON-NEGOTIABLE SEA WAYBILL") }],
    ["un multimodal", "MULTIMODAL", { tipoTransporte: c("MULTIMODAL TRANSPORT DOCUMENT") }],
    ["un combined transport", "MULTIMODAL", { tipoTransporte: c("COMBINED TRANSPORT BILL OF LADING") }],
    ["una carta de porte CMR", "TERRESTRE", { tipoTransporte: c("CMR CONSIGNMENT NOTE") }],
    ["un recibo de courier", "COURIER", { tipoTransporte: c("COURIER RECEIPT — DHL") }],
    ["un fletamento por su cláusula", "FLETAMENTO", { charterParty: c("SUBJECT TO CHARTER PARTY DATED 01-MAR-25") }],
  ])("%s → %s", (_nombre, esperado, campos) => {
    expect(modoDelDocumento(doc(campos)).modo).toBe(esperado);
  });

  it("cuando no hay con qué decidir, dice que no sabe en vez de suponer marítimo", () => {
    // Suponer es lo que hacía antes, y por eso examinaba un aéreo con el artículo 20.
    const m = modoDelDocumento(doc({ numeroDoc: c("A-12") }));
    expect(m.modo).toBe("SIN_DETERMINAR");
    expect(m.porQue).toMatch(/no se pudo/i);
  });

  it("dice de dónde sacó la conclusión: sin eso no se puede discutir", () => {
    const m = modoDelDocumento(doc({ tipoTransporte: c("AIR WAYBILL") }));
    expect(m.porQue).toMatch(/air waybill/i);
  });

  it("el fletamento gana sobre el marítimo: un conocimiento con esa cláusula es del artículo 22", () => {
    const m = modoDelDocumento(doc({ buque: c("STELLA AUSTRAL"), charterParty: c("SUBJECT TO CHARTER PARTY") }));
    expect(m.modo).toBe("FLETAMENTO");
  });

  it("una negación no convierte el documento en un fletamento", () => {
    // Muchos conocimientos imprimen «not subject to any charter party»: decir que no lo está no es
    // estarlo, y tomarlo al revés mandaba el documento al artículo equivocado.
    const m = modoDelDocumento(doc({ buque: c("STELLA AUSTRAL"), charterParty: c("NOT SUBJECT TO CHARTER PARTY") }));
    expect(m.modo).toBe("MARITIMO");
  });
});

describe("qué artículo gobierna cada uno", () => {
  it.each<[ModoTransporte, string]>([
    ["MULTIMODAL", "19"],
    ["MARITIMO", "20"],
    ["SEA_WAYBILL", "21"],
    ["FLETAMENTO", "22"],
    ["AEREO", "23"],
    ["TERRESTRE", "24"],
    ["COURIER", "25"],
  ])("%s → artículo %s", (modo, articulo) => {
    expect(articuloDelModo(modo)).toContain(articulo);
  });
});

/**
 * Qué buque nombra la anotación de a bordo, que es la frontera entre dos Opiniones opuestas.
 *
 * Los textos de los dos casos van **literales** de las fuentes: son lo único que separa un rechazo
 * válido de uno inválido, así que parafrasearlos haría que el test no probara nada.
 */
describe("el buque que nombra la anotación de a bordo", () => {
  it("TA 743rev: la anotación da cuenta del buque oceánico, así que lo nombra", () => {
    const r = buqueDeLaAnotacion(
      "SHIPPED ON BOARD VESSEL N AT SIBU, MALAYSIA ON 18.11.2010 FOR TRANSHIPMENT VIA BINTULU ON VESSEL L",
      "Vessel L",
      "Sibu, Malaysia",
    );
    expect(r.nombraAlBuque).toBe(true);
  });

  it("R 350: la casilla nombra el buque de pre-acarreo y no el oceánico", () => {
    const r = buqueDeLaAnotacion(
      "JUL.16, 2013 UNI-PROMOTE 198B HOCHIMINH CITY, VIETNAM",
      "EVER DELUXE 0689-106E",
      "HOCHIMINH CITY, VIETNAM",
    );
    expect(r.nombraAlBuque).toBe(false);
    /* Y lo que sobra es justamente el nombre del buque de pre-acarreo. */
    expect(r.sobra).toContain("UNI-PROMOTE");
  });

  /*
   * El caso corriente, que es el que decide si esto se puede usar: una anotación que es una fecha y
   * la frase hecha no nombra nada, así que la regla no tiene nada que decir. Si acá sobrara algo, el
   * motor gritaría en casi todos los conocimientos y nadie lo leería.
   */
  it.each([
    ["SHIPPED ON BOARD 20-AUG-2026", "STELLA AUSTRAL", "MONTEVIDEO, URUGUAY"],
    ["CLEAN ON BOARD AT MONTEVIDEO, URUGUAY ON 20-AUG-2026", "STELLA AUSTRAL", "MONTEVIDEO, URUGUAY"],
    ["LADEN ON BOARD THE VESSEL ON 20/08/2026", "STELLA AUSTRAL", "MONTEVIDEO, URUGUAY"],
  ])("«%s» no nombra nada que no sepamos", (anotacion, buque, puerto) => {
    expect(buqueDeLaAnotacion(anotacion, buque, puerto).sobra).toEqual([]);
  });

  it("y la anotación que nombra al buque con su prefijo también cuenta", () => {
    const r = buqueDeLaAnotacion("SHIPPED ON BOARD M/V EVER DELUXE ON 16-JUL-2013", "EVER DELUXE 0689-106E", null);
    expect(r.nombraAlBuque).toBe(true);
    expect(r.sobra).toEqual([]);
  });
});
