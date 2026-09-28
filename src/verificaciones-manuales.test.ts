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
