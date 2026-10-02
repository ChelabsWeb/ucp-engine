import { describe, expect, it } from "vitest";
import { DOCUMENTOS_CSU2025099, SWIFT_CSU2025099 } from "./fixtures";
import type { DocAnalizado } from "./presentacion";
import { parseMT700 } from "./swift-lc";
import { verificacionesManuales } from "./verificaciones-manuales";

const LC = parseMT700(SWIFT_CSU2025099)!.lc;
const DOCS: DocAnalizado[] = [
  { tipo: "FACTURA", campos: DOCUMENTOS_CSU2025099.FACTURA!, nombreArchivo: "Commercial invoice A 4401" },
  { tipo: "BL", campos: DOCUMENTOS_CSU2025099.BL!, nombreArchivo: "BL MVD0990117" },
];

describe("lo que queda del lado humano", () => {
  it("sin documentos presentados no hay nada que verificar a mano", () => {
    expect(verificacionesManuales({ lc: LC, docs: [] })).toEqual([]);
  });

  it("nombra siempre las cuatro que no dependen del tipo de documento", () => {
    const ids = verificacionesManuales({ lc: LC, docs: DOCS }).map((v) => v.id);
    expect(ids).toEqual(
      expect.arrayContaining(["firma-autenticidad", "original-vs-copia", "correcciones", "legibilidad"]),
    );
  });

  it("con un documento de transporte agrega contar los originales que llegaron", () => {
    const v = verificacionesManuales({ lc: LC, docs: DOCS }).find((x) => x.id === "juego-fisico");
    expect(v?.documentos).toEqual(["BL MVD0990117"]);
  });

  it("sin transporte presentado, esa verificación no aparece", () => {
    const soloFactura = [DOCS[0]!];
    expect(verificacionesManuales({ lc: LC, docs: soloFactura }).some((v) => v.id === "juego-fisico")).toBe(false);
  });

  it("el crédito real exige certificados de organismos: hay que verificar quién los emite", () => {
    const v = verificacionesManuales({ lc: LC, docs: DOCS }).find((x) => x.id === "emisor-autorizado");
    expect(v).toBeDefined();
    expect(v!.documentos.join(" ")).toMatch(/VETERINARY|ORIGIN/i);
  });

  it("el seguro entra en la lista cuando se presentó", () => {
    const v = verificacionesManuales({ lc: LC, docs: DOCS, haySeguro: true });
    expect(v[0]!.documentos).toContain("documento de seguro");
  });

  it("cada verificación explica por qué el motor no puede hacerla", () => {
    for (const v of verificacionesManuales({ lc: LC, docs: DOCS })) {
      expect(v.porQue.length).toBeGreaterThan(20);
      expect(v.fuente).toBeTruthy();
    }
  });
});

describe("de dónde sale cada verificación", () => {
  it("el emisor que el crédito nombra se exige por el 46A, no por el artículo 14 (f)", () => {
    /*
     * El 14 (f) dice lo contrario de lo que esta verificación hace: regula el caso en que el
     * crédito no dice quién emite, y ahí el banco acepta el documento como se presenta. Citarlo
     * para exigir un emisor determinado es mandar a quien lea el hallazgo a un texto que lo
     * contradice.
     */
    const v = verificacionesManuales({
      lc: { ...LC, documentosExigidos: ["CERTIFICATE OF ORIGIN ISSUED BY THE CHAMBER OF COMMERCE"] },
      docs: DOCS,
      haySeguro: false,
    }).find((x) => x.id === "emisor-autorizado");
    expect(v).toBeDefined();
    expect(v?.fuente).toBe("46A");
    expect(v?.fuente).not.toMatch(/14f/);
  });
});

describe("las condiciones del 47A que el examen no verifica", () => {
  /*
   * El motor lee cuatro cosas del 47A —la fecha de los documentos, el número del crédito, el fee de
   * discrepancia y la tolerancia— y el resto desaparecía: ni una regla ni una nota. Una condición
   * del crédito que nadie mira es exactamente lo que después se discute.
   *
   * Este test es además lo que ata las dos listas. Los patrones de «lo que el examen sí mira» están
   * escritos en `verificaciones-manuales.ts` y las reglas viven en `presentacion.ts`: si alguien
   * cambia uno y no el otro, la condición del crédito real empieza a aparecer como «sin verificar» y
   * el caso de abajo falla nombrándola.
   */
  const LC = parseMT700(SWIFT_CSU2025099)!.lc;
  const DOCS: DocAnalizado[] = [{ tipo: "FACTURA", campos: {} as never }];
  const sinVerificar = (lc = LC) =>
    verificacionesManuales({ lc, docs: DOCS }).filter((v) => v.id.startsWith("47a-sin-verificar"));

  it("el crédito real no deja ninguna condición sin mirar", () => {
    // Sus cinco condiciones: fecha y número del crédito las verifica el examen, el fee sale como
    // importe, la tolerancia es un parámetro y los documentos de terceros son una autorización.
    expect(sinVerificar().map((v) => v.que)).toEqual([]);
  });

  it("pero una condición documentaria que el motor no sabe verificar, sí", () => {
    const con = {
      ...LC,
      condicionesAdicionales: [
        ...(LC.condicionesAdicionales ?? []),
        "SHIPMENT ADVICE TO BE SENT TO THE INSURERS WITHIN 05 DAYS AND A CERTIFICATE TO THIS EFFECT MUST ACCOMPANY THE ORIGINAL DOCUMENTS",
      ],
    };
    const r = sinVerificar(con);
    expect(r).toHaveLength(1);
    expect(r[0]?.fuente).toBe("47A");
    expect(r[0]?.que).toMatch(/INSURERS/);
    expect(r[0]?.porQue).toMatch(/no sabe verificar|no está examinada/);
  });

  it.each([
    ["A TOLERANCE OF 5 PCT MORE OR LESS IN QUANTITY ALLOWED", "una tolerancia"],
    ["PARTIAL SHIPMENTS ARE NOT ALLOWED", "un permiso de embarque"],
    ["TRANSHIPMENT IS ALLOWED", "una autorización de transbordo"],
  ])("y un parámetro del crédito no genera ruido: «%s»", (condicion) => {
    // Configuran el crédito, igual que el monto: no hay documento que las acredite (arts. 30, 31, 20c).
    expect(sinVerificar({ ...LC, condicionesAdicionales: [condicion] })).toEqual([]);
  });

  it("ni una condición que no menciona ningún documento", () => {
    // Sin documento que la acredite, el artículo 14 (h) la tiene por no puesta, y de eso se ocupa
    // la revisión del crédito, no el examen de la presentación.
    expect(sinVerificar({ ...LC, condicionesAdicionales: ["GOODS MUST BE OF URUGUAYAN ORIGIN"] })).toEqual([]);
  });
});

describe("el aviso a la aseguradora del 47A", () => {
  /*
   * `avisoAseguradora` parseaba el plazo, la póliza y el correo de esa cláusula —está escrita para el
   * crédito real del expediente— y **nadie la llamaba**. Con el plazo a la vista la nota sirve: dice
   * en cuántos días hay que haber avisado, en vez de pedirle al examinador que lo lea del párrafo.
   */
  const LC = parseMT700(SWIFT_CSU2025099)!.lc;
  const DOCS: DocAnalizado[] = [{ tipo: "FACTURA", campos: {} as never }];
  const CONDICION =
    "BENEFICIARY SHOULD ADVISE FULL DETAILS OF SHIPMENT WITHIN 05 DAYS AFTER SHIPMENT DATE QUOTING POLICY NO IN0099IP000001 TO LANKASEGUROS GENERAL INSURANCE LTD ON EMAIL POLIZAS(AT)LANKASEGUROS.EXAMPLE. A CERTIFICATE TO THIS EFFECT MUST ACCOMPANY THE ORIGINAL DOCUMENTS.";

  const correr = (condiciones: string[]) =>
    verificacionesManuales({ lc: { ...LC, condicionesAdicionales: condiciones }, docs: DOCS });

  it("sale con el plazo y la póliza adentro", () => {
    const v = correr([CONDICION]).find((x) => x.id === "47a-aviso-aseguradora");
    expect(v?.que).toMatch(/5 días/);
    expect(v?.porQue).toMatch(/IN0099IP000001/);
  });

  it("y no se repite como «condición sin verificar»", () => {
    // Está dicha una vez, con más detalle; dos veces sería ruido.
    const r = correr([CONDICION]);
    expect(r.filter((x) => x.fuente === "47A")).toHaveLength(1);
  });

  it("un crédito sin esa cláusula no la inventa", () => {
    expect(
      correr(["A TOLERANCE OF 10 PCT MORE OR LESS ALLOWED"]).find((x) => x.id === "47a-aviso-aseguradora"),
    ).toBeUndefined();
  });
});
