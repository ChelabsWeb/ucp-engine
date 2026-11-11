import { describe, expect, it } from "vitest";
import { articuloDelModo, buqueDeLaAnotacion, leerFirma, type ModoTransporte, modoDelDocumento } from "./transporte";

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
    /*
     * «GOODS ON BOARD» es la anotación del conocimiento del laudo DOCDEX 259, y «GOODS» no estaba en
     * la lista: el motor sacaba un aviso pidiendo verificar si era un buque de pre-acarreo sobre la
     * redacción más corriente que hay. Las palabras que nombran la carga no nombran nada que no
     * sepamos.
     */
    ["GOODS ON BOARD - 7 JUL. 2005", "MSC LIVORNO", "GENOA, ITALY"],
    ["CARGO LADEN ON BOARD IN CONTAINERS ON 20-AUG-2026", "STELLA AUSTRAL", "MONTEVIDEO, URUGUAY"],
  ])("«%s» no nombra nada que no sepamos", (anotacion, buque, puerto) => {
    expect(buqueDeLaAnotacion(anotacion, buque, puerto).sobra).toEqual([]);
  });

  it("y la anotación que nombra al buque con su prefijo también cuenta", () => {
    const r = buqueDeLaAnotacion("SHIPPED ON BOARD M/V EVER DELUXE ON 16-JUL-2013", "EVER DELUXE 0689-106E", null);
    expect(r.nombraAlBuque).toBe(true);
    expect(r.sobra).toEqual([]);
  });
});
/**
 * «SIGNED BY THE MASTER», que es el laudo DOCDEX 247
 *
 * El ancla de `leerFirma` admitía `AS`, `FOR` y `ON BEHALF OF`, así que un bloque que dice «signed by the
 * master of the vessel X» —la redacción de medio fletamento— salía **sin capacidad reconocida**: ATENCION
 * sobre una firma que el artículo 22 admite sin discusión. El panel del laudo razona con esa misma frase
 * —*«is signed by the master of that named vessel with additional means of authentication provided by the
 * seal of the vessel and the name of the master»*— y declara el documento aceptable.
 *
 * Lo que **no** se aflojó es el anclaje que la Opinión R 834 / TA 793rev obliga a tener: «SIGNED BY» entra
 * como una cuarta forma de **atribuir** la firma, no como una mención suelta.
 */
describe("«signed by the master» declara una capacidad (laudo DOCDEX 247)", () => {
  it.each(["SIGNED BY THE MASTER OF THE VESSEL MT SIAM PIONEER", "SIGNED BY MASTER", "SIGNED BY THE CAPTAIN"])(
    "«%s» es el capitán",
    (texto) => {
      expect(leerFirma(texto).capacidad).toBe("CAPITAN");
    },
  );

  it("y «signed by the carrier» es el transportista", () => {
    expect(leerFirma("SIGNED BY THE CARRIER MAERSK LINE").capacidad).toBe("TRANSPORTISTA");
  });

  /**
   * **La sexta forma de atribuir una firma va detrás y en posesivo: la casilla preimpresa (R 472).**
   *
   * Las cinco anteriores van delante —«as», «for», «on behalf of», «signed by», «firmado por»— y ésta es
   * el rótulo de la casilla: *«the B/L had a pre-printed statement "master's signature" and this box had
   * the ships stamp placed therein and a signature. **In the absence of any other details this signature
   * would be accepted as that of the master. There is no discrepancy**»*. Salía sin capacidad, o sea
   * ATENCION sobre una firma que el panel acepta sin discusión.
   *
   * Y es la misma forma que el rótulo de la casilla 23 de un CMR, «Signature of carrier», con el que la
   * Opinión R 466 decide quién puede firmarla.
   */
  it.each([
    "MASTER'S SIGNATURE: SIGNATURE OVER SHIPS STAMP OF M/V ARTHUR",
    "MASTERS SIGNATURE - SIGNED OVER STAMP M/V ARTHUR",
    "MASTER\u2019S SIGNATURE OVER THE SHIPS STAMP",
  ])("«%s» es el capitán por la casilla", (texto) => {
    expect(leerFirma(texto).capacidad).toBe("CAPITAN");
  });

  it("y «signature of carrier», que es la casilla 23 de un CMR, es el transportista", () => {
    expect(leerFirma("SIGNATURE OF CARRIER: TRANSPORTS MARTIN SARL").capacidad).toBe("TRANSPORTISTA");
    expect(leerFirma("SIGNATURE OF THE CARRIER - FINNLINES PLC").capacidad).toBe("TRANSPORTISTA");
  });

  /*
   * **Los dos frenos de la casilla, y el primero es el que la hace segura:** la palabra de la capacidad
   * tiene que estar **pegada a «signature»**. Un nombre de parte en otra casilla no la declara, y una
   * capacidad que el artículo no nombra —el embarcador— no entra por acá.
   */
  it("pero el nombre del transportista en otra casilla no declara la capacidad de la firma", () => {
    const r = leerFirma("SHIPOWNER/CARRIER: BX LINES, MASTER'S SIGNATURE OVER SHIPS STAMP");
    expect(r.capacidad, "manda la casilla de la firma, no la del transportista").toBe("CAPITAN");
    expect(r.ambigua, "y no es ambigua: solo una de las dos atribuye la firma").toBeUndefined();
  });

  it("y «signature of shipper» no es ninguna de las cinco capacidades", () => {
    expect(leerFirma("SIGNATURE OF SHIPPER: ACME EXPORTS LTD").capacidad).toBeNull();
  });

  /**
   * **Y un «successive carrier» es un transportista para esto (Opinión R 466).**
   *
   * Un CMR trae las casillas «Carrier» (16) y «Successive carriers» (17), y el motor leía «AS SUCCESSIVE
   * CARRIER» sin capacidad reconocida porque «SUCCESSIVE» no es palabra de relleno. El panel:
   * *«**The signature of the "carrier" or the "successive carrier" or a named agent signing on either of
   * their behalf(s) would be acceptable**»*.
   */
  it.each([
    "TRANSPORTS MARTIN SARL AS SUCCESSIVE CARRIER",
    "SIGNED BY THE SUCCESSIVE CARRIER TRANSPORTS MARTIN SARL",
    "AS AGENT FOR THE SUCCESSIVE CARRIERS",
  ])("«%s» es el transportista", (texto) => {
    expect(leerFirma(texto).capacidad).toBe("TRANSPORTISTA");
  });

  it("y nombrar a los dos no vuelve ambigua la firma: son la misma capacidad", () => {
    const r = leerFirma("TRANSPORTS DUPONT SA AS CARRIER AND TRANSPORTS MARTIN SARL AS SUCCESSIVE CARRIER");
    expect(r.capacidad).toBe("TRANSPORTISTA");
    expect(r.ambigua).toBeUndefined();
  });

  /*
   * Los dos frenos que R 834 / TA 793rev obliga a conservar: una mención suelta del capitán no salva la
   * firma, y el bloque de esa Opinión —que nombra un capitán y declara otra capacidad— no cambia.
   */
  it("pero una mención suelta sigue sin ser una capacidad", () => {
    expect(leerFirma("JOHN SMITH, MASTER").capacidad).toBeNull();
  });

  it("y la firma de R 834 no cambia", () => {
    expect(leerFirma("ROH AS AGENT ON BEHALF OF HAP - THE CARRIER, CAPT. J SMITH").capacidad).not.toBe("CAPITAN");
  });
});

/**
 * El capitán que firma «on behalf of Owners» (Opinión **R 835 / TA 800rev**)
 *
 * Un conocimiento de fletamento firmado por el capitán, con un sello que trae el nombre del buque, la
 * palabra «Master» y «on behalf of Owners». No son dos capacidades entre las que hubiera que tachar una
 * —el caso de R 354—: *«The signature on the CPBL is identified as that of the master (captain). The
 * master is signing for and on behalf of the owner.»* — **«The document is acceptable.»**
 */
describe("el capitán que firma por el armador (Opinión R 835)", () => {
  it("es el capitán, y no es ambigua", () => {
    for (const t of [
      "CAPT. J. SMITH AS MASTER ON BEHALF OF OWNERS",
      "SIGNED CAPT. J. SMITH · STAMP: M/V OCEAN STAR, MASTER, ON BEHALF OF OWNERS",
      "M/V OCEAN STAR MASTER FOR AND ON BEHALF OF THE OWNERS",
    ]) {
      const r = leerFirma(t);
      expect(r.capacidad, t).toBe("CAPITAN");
      expect(r.ambigua, t).toBeUndefined();
    }
  });

  it("y el preimpreso de R 354 sigue siendo ambiguo", () => {
    expect(leerFirma("FOR THE MASTER/FOR THE CARRIER").ambigua).toBe(true);
    expect(leerFirma("AS AGENTS FOR THE MASTER / FOR THE OWNERS").ambigua).toBe(true);
  });
});

/**
 * El bloque que declara **dos** capacidades a la vez (Opinión **R 354**)
 *
 * Un conocimiento preimpreso con «Signed **for the master/for the carrier** as agents», firmado por un
 * agente nombrado. *«The bill of lading presented would seem to indicate that the agent signing the bill
 * of lading **should have deleted either "for the master" or "for the carrier". With the document
 * displaying both parties, the capacity in which the agent is signing is unclear**»*, y el panel concluye
 * que el documento no cumple el artículo.
 *
 * Medido antes de arreglarlo: `leerFirma` devolvía **TRANSPORTISTA** —elegía la primera de la lista— y
 * como el artículo admite las dos, la regla salía en **OK**. El motor aprobaba un bloque que el panel
 * declara ambiguo.
 *
 * **Sale ambigua y no discrepante por un motivo del dato:** el propio panel dice que lo correcto era
 * **tachar una**, y una tachadura es exactamente lo que un campo de texto transcrito por una persona no
 * puede representar.
 */
describe("el bloque que declara dos capacidades (Opinión R 354)", () => {
  it.each([
    "SIGNED FOR THE MASTER/FOR THE CARRIER AS AGENTS - OCEAN AGENCIES LTD",
    "AS AGENT FOR THE CARRIER AND FOR THE MASTER",
    "FOR THE CARRIER / FOR THE OWNERS AS AGENTS",
  ])("«%s» sale ambigua y sin elegir", (b) => {
    const f = leerFirma(b);
    expect(f.ambigua).toBe(true);
    expect(f.capacidad).toBeNull();
  });

  /*
   * **Los tres frenos, y el primero es el que importa:** la ambigüedad necesita dos capacidades
   * **ancladas**. El bloque de R 834 menciona un capitán **sin anclar** —«CAPT. J SMITH» detrás de una
   * coma— así que no es ambiguo, es una firma sin capacidad reconocida, que es otro hecho y tiene su
   * propia evidencia. Y el del laudo DOCDEX 284 nombra «CAPT.» y «MASTER», que son **la misma**
   * capacidad escrita dos veces.
   */
  it("una mención suelta del capitán no vuelve ambiguo el bloque (R 834)", () => {
    expect(leerFirma("ROH AS AGENT ON BEHALF OF HAP - THE CARRIER, CAPT. J SMITH").ambigua).toBeUndefined();
  });

  it("y dos palabras de la misma capacidad tampoco (DOCDEX 284)", () => {
    const f = leerFirma("FOR AND/OR ON BEHALF OF CAPT. P / MASTER OF VESSEL D / FOR COMPANY S / AS AGENTS");
    expect(f.ambigua).toBeUndefined();
    expect(f.capacidad).toBe("CAPITAN");
  });

  it.each([
    ["SIGNED BY THE MASTER OF M/V DON CARLOS", "CAPITAN"],
    ["XYZ SHIPPING AS AGENT FOR THE CARRIER ABC LINES", "TRANSPORTISTA"],
  ])("y una capacidad sola sigue decidiendo: «%s» → %s", (b, esperado) => {
    const f = leerFirma(b);
    expect(f.ambigua).toBeUndefined();
    expect(f.capacidad).toBe(esperado);
  });
});

/**
 * «CAPT.» abreviado, que es el laudo DOCDEX 284.
 *
 * El fletamento del laudo está firmado «FOR AND/OR ON BEHALF OF CAPT. P / MASTER OF VESSEL D / FOR
 * COMPANY S / AS AGENTS» y el panel declaró el rechazo inválido por unanimidad. El ancla se rompía en
 * «CAPT» y la firma salía sin capacidad.
 */
describe("la abreviatura del capitán (DOCDEX 284)", () => {
  it("«on behalf of CAPT. P» es el capitán, por medio de un agente", () => {
    const f = leerFirma("FOR AND/OR ON BEHALF OF CAPT. P MASTER OF VESSEL D FOR COMPANY S AS AGENTS");
    expect(f.capacidad).toBe("CAPITAN");
    expect(f.porAgente).toBe(true);
  });

  /*
   * Y el freno sigue en pie: con el transportista nombrado en la frase de la firma manda el
   * transportista, aunque el pie mencione un capitán. Es la trampa de R834.
   */
  it("y no le roba la capacidad al transportista cuando la frase lo nombra", () => {
    const f = leerFirma(
      "XXX AS AGENT FOR AND ON BEHALF OF THE CARRIER DAMPSKIBSSELSKABET NORDEN A/S CAPTAIN: CAPT MABE T. BENAGUA",
    );
    expect(f.capacidad).toBe("TRANSPORTISTA");
  });
});
