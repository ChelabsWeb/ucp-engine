import { describe, expect, it } from "vitest";
import { fmtFecha } from "./fechas";
import {
  avisoAseguradora,
  cobroEstimado,
  diasParaPresentar,
  diasPresentacion,
  limitePresentacion,
  parseTolerancia,
  sumarHabiles,
  tenorDe,
  toleranciaDe,
  toleranciaDeCantidad,
  toleranciaDeImporte,
} from "./lc";
import type { LcInfo } from "./types";

const LC: LcInfo = {
  numero: "ECB-889174",
  bancoEmisor: "ECB",
  bancoAvisador: "BROU",
  vencimiento: "05-sep-26",
  limiteEmbarque: "15-ago-26",
  plazoPresentacion: "21 días desde fecha de BL",
};

describe("diasPresentacion — el plazo de la LC como número", () => {
  it("entiende las formas habituales en ES y EN", () => {
    expect(diasPresentacion("21 días desde fecha de BL")).toBe(21);
    expect(diasPresentacion("within 21 days after B/L date")).toBe(21);
    expect(diasPresentacion("15 days")).toBe(15);
    expect(diasPresentacion("10 d")).toBe(10);
  });
  it("sin plazo o absurdo → null (no inventa 21)", () => {
    expect(diasPresentacion(null)).toBeNull();
    expect(diasPresentacion("—")).toBeNull();
    expect(diasPresentacion("a la vista")).toBeNull();
    expect(diasPresentacion("999 días")).toBeNull();
  });
});

describe("limitePresentacion — BL + plazo, nunca después del vencimiento (UCP 600 14c)", () => {
  it("con BL real dentro del plazo: límite = BL + 21", () => {
    const l = limitePresentacion(LC, "10-ago-26", "15-ago-26")!;
    expect(l.esEstimada).toBe(false);
    expect(l.dias).toBe(21);
    expect(l.limite).toEqual(new Date(2026, 7, 31)); // 31-ago
    expect(l.recortadoPorVencimiento).toBe(false);
    expect(diasParaPresentar(l, new Date(2026, 7, 25))).toBe(6);
  });
  it("sin BL real usa el embarque estimado y lo marca", () => {
    const l = limitePresentacion(LC, null, "20-ago-26")!;
    expect(l.esEstimada).toBe(true);
    expect(l.porPlazo).toEqual(new Date(2026, 8, 10)); // 10-sep: cae después del 05-sep
    expect(l.recortadoPorVencimiento).toBe(true);
    expect(l.limite).toEqual(new Date(2026, 8, 5)); // el vencimiento manda
  });
  it("falta la LC, la fecha o el vencimiento → null", () => {
    expect(limitePresentacion(null, "10-ago-26", null)).toBeNull();
    expect(limitePresentacion(LC, null, null)).toBeNull();
    expect(limitePresentacion({ ...LC, vencimiento: "—" }, "10-ago-26", null)).toBeNull();
  });
  it("sin plazo en la LC rige el de UCP 600 art. 14c (21 días) y se marca", () => {
    const l = limitePresentacion({ ...LC, plazoPresentacion: "—" }, "10-ago-26", null)!;
    expect(l.dias).toBe(21);
    expect(l.plazoPorDefectoUCP).toBe(true);
    expect(limitePresentacion(LC, "10-ago-26", null)!.plazoPorDefectoUCP).toBe(false);
  });
});

describe("parseTolerancia — 39B / about / +/- → fracción", () => {
  it("porcentajes en cualquier notación", () => {
    expect(parseTolerancia("±5%")).toBe(0.05);
    expect(parseTolerancia("+/- 10 %")).toBe(0.1);
    expect(parseTolerancia("5 pct more or less")).toBe(0.05);
    expect(parseTolerancia("2,5 por ciento")).toBe(0.025);
  });
  it('"about" es ±10 % por UCP 600 art. 30a; "sin tolerancia" es 0; basura es null', () => {
    expect(parseTolerancia("about 54 MT")).toBe(0.1);
    expect(parseTolerancia("sin tolerancia")).toBe(0);
    expect(parseTolerancia("Not allowed")).toBe(0);
    expect(parseTolerancia("none")).toBe(0);
    expect(parseTolerancia("Tolerance: nil")).toBe(0);
    expect(parseTolerancia("—")).toBeNull();
    expect(parseTolerancia("ver cláusula 47A")).toBeNull();
    expect(parseTolerancia("80%")).toBeNull(); // fuera de rango: no es una tolerancia
  });
  it("acepta fracciones ya numéricas y descarta las absurdas", () => {
    expect(parseTolerancia(0.05)).toBe(0.05);
    expect(parseTolerancia("0,1")).toBe(0.1);
    expect(parseTolerancia(3)).toBeNull();
  });
  it("toleranciaDe: la de la LC si está, si no ±5 %", () => {
    expect(toleranciaDe(null)).toBe(0.05);
    expect(toleranciaDe(LC)).toBe(0.05);
    expect(toleranciaDe({ ...LC, tolerancia: 0.1 })).toBe(0.1);
    expect(toleranciaDe({ ...LC, tolerancia: 0 })).toBe(0);
  });
});

describe("avisoAseguradora — condición 47A del caso CSU2025099", () => {
  const cond =
    "BENEFICIARY SHOULD ADVISE FULL DETAILS OF SHIPMENT WITHIN 05 DAYS AFTER SHIPMENT DATE QUOTING POLICY NO IN0099IP000001 TO LANKASEGUROS GENERAL INSURANCE LTD, NO.10,LANKASEGUROS HOUSE, HARBOUR MAWATHA COLOMBO 01,SRI LANKA ON FAX NO 94-11-2000000,ON EMAIL POLIZAS(AT)LANKASEGUROS.EXAMPLE A CERTIFICATE TO THIS EFFECT MUST ACCOMPANY THE ORIGINAL DOCUMENTS.";
  it('saca los días, la póliza y el email (con "(at)")', () => {
    expect(avisoAseguradora([cond])).toMatchObject({ dias: 5, poliza: "IN0099IP000001", email: "polizas@lankaseguros.example" });
  });
  it("sin condición de aviso → null; otras condiciones no confunden", () => {
    expect(
      avisoAseguradora([
        "ALL DOCUMENTS SHOULD BEAR A DATE ON OR AFTER THE LETTER OF CREDIT DATE.",
        "A DISCREPANCY FEE OF USD 80/- WILL BE DEDUCTED",
      ]),
    ).toBeNull();
    expect(avisoAseguradora(null)).toBeNull();
  });
});

describe("cobroEstimado (A6) — cuándo entra la plata", () => {
  const base: LcInfo = {
    numero: "LC1",
    bancoEmisor: "MERIDIAN BANK PLC",
    bancoAvisador: "BANCO LITORAL",
    vencimiento: "30-jun-25",
    limiteEmbarque: "30-abr-25",
    plazoPresentacion: "21 días",
  };
  const pres = new Date(2025, 3, 15); // martes 15-abr-25

  it("a la vista: presentación + 5 días hábiles de examen (no cuenta el fin de semana)", () => {
    const c = cobroEstimado({ ...base, giros: "SIGHT" }, pres)!;
    expect(c.diasTenor).toBe(0);
    expect(fmtFecha(c.fecha)).toBe("22-abr-25"); // 16,17,18 + 21,22
    expect(c.texto).toContain("5 días hábiles");
  });

  it("a plazo desde el BL: BL + los días del tenor", () => {
    const c = cobroEstimado({ ...base, giros: "90 DAYS AFTER B/L DATE" }, pres, "08-abr-25")!;
    expect(c).toMatchObject({ diasTenor: 90, desde: "BL" });
    expect(fmtFecha(c.fecha)).toBe("07-jul-25");
    expect(c.texto).toContain("fecha de BL");
  });

  it("a plazo sin decir desde cuándo: cuenta desde el examen de la presentación", () => {
    const c = cobroEstimado({ ...base, giros: "30 DAYS" }, pres)!;
    expect(c.desde).toBe("PRESENTACION");
    expect(fmtFecha(c.fecha)).toBe("22-may-25");
  });

  it("sin LC o sin presentación no estima nada; el tenor se lee de giros y del librado", () => {
    expect(cobroEstimado(null, pres)).toBeNull();
    expect(cobroEstimado(base, null)).toBeNull();
    expect(tenorDe("AT SIGHT")).toEqual({ dias: 0, desde: "PRESENTACION" });
    expect(tenorDe("60 DAYS FROM SHIPMENT DATE")).toEqual({ dias: 60, desde: "BL" });
    expect(tenorDe(null)).toEqual({ dias: 0, desde: "PRESENTACION" });
    expect(sumarHabiles(new Date(2025, 3, 18), 1)).toEqual(new Date(2025, 3, 21)); // viernes → lunes
  });
});

describe("la tolerancia del importe y la de la cantidad son dos cosas (UCP 600 art. 30)", () => {
  /*
   * El motor usaba un solo número para las dos, con 5 % por defecto. Pero ese 5 % es el del
   * artículo 30 (b), que es una tolerancia de CANTIDAD y cuya propia condición es que «el total
   * girado no exceda el importe del crédito». Aplicárselo al importe daba por conforme un giro que
   * se pasa del crédito: el banco paga de más y no lo recupera.
   *
   * Hacia abajo el 30 (c) sí admite 5 % menos en el importe, con condiciones. Hacia arriba, sin
   * 39A ni «about», el tope es el 32B a secas.
   */
  const conTolerancia = (t: number | null): LcInfo => ({ ...LC, tolerancia: t });

  it("sin indicación en el crédito, el importe no tiene margen hacia arriba", () => {
    expect(toleranciaDeImporte(conTolerancia(null))).toBe(0);
  });

  it("pero la cantidad conserva el 5 % del 30 (b)", () => {
    expect(toleranciaDeCantidad(conTolerancia(null))).toBe(0.05);
  });

  it("con 39A, el importe usa lo que el crédito dice", () => {
    expect(toleranciaDeImporte(conTolerancia(0.1))).toBe(0.1);
  });

  it("y la cantidad nunca baja del 5 %, aunque el 39A diga 00/00", () => {
    // El 30 (b) no está condicionado al 39A: un crédito con 00/00 de tolerancia de IMPORTE sigue
    // admitiendo el ±5 % en la cantidad.
    expect(toleranciaDeCantidad(conTolerancia(0))).toBe(0.05);
  });

  it("si el crédito da más que el 5 %, la cantidad usa ese más", () => {
    expect(toleranciaDeCantidad(conTolerancia(0.1))).toBe(0.1);
  });

  it("cuando el crédito expresa la cantidad en bultos, no hay tolerancia de cantidad", () => {
    // Es la primera condición del 30 (b): «provided the credit does not state the quantity in terms
    // of a stipulated number of packing units or individual items».
    expect(toleranciaDeCantidad(conTolerancia(null), true)).toBe(0);
  });
});
