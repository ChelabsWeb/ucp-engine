import { describe, expect, it } from "vitest";
import {
  ablandarPorISBP,
  comparaISBP,
  cotejarIncotermISBP,
  emisorAdmitido,
  esCertificadoDeOrigen,
  esErrorDeTipeo,
  esFacturaComercial,
  exigePrevioAlEmbarque,
  normISBP,
} from "./isbp";
import type { ReglaPresentacion } from "./presentacion";

describe("A1 — abreviaturas de uso común", () => {
  it("una abreviatura vale igual que la palabra entera", () => {
    expect(comparaISBP("CEREALSUR LTD", "CEREALSUR LIMITED")).toBe("IGUAL");
    expect(comparaISBP("ORIENT FEED PVT LTD", "ORIENT FEED PRIVATE LIMITED")).toBe("IGUAL");
    expect(comparaISBP("Int'l Trading Co", "International Trading Company")).toBe("IGUAL");
  });

  it("incluye la equivalencia que agregó la edición 2023", () => {
    expect(normISBP("MOLSUR IND")).toBe(normISBP("MOLSUR INDUSTRIES"));
  });

  it("las unidades también son intercambiables", () => {
    expect(comparaISBP("54 MT", "54 METRIC TONS")).toBe("IGUAL");
    expect(comparaISBP("1000 KGS", "1000 KILOGRAMS")).toBe("IGUAL");
  });
});

describe("A23 — errores de ortografía y de tipeo", () => {
  it("los ejemplos del propio texto no son discrepancia", () => {
    expect(esErrorDeTipeo("mashine", "machine")).toBe(true);
    expect(esErrorDeTipeo("fountan", "fountain")).toBe(true);
    expect(esErrorDeTipeo("modle", "model")).toBe(true);
  });

  it("pero un dato distinto sí lo es: «model 123» no es «model 321»", () => {
    expect(comparaISBP("model 123", "model 321")).toBe("DISTINTO");
    expect(esErrorDeTipeo("123", "321")).toBe(false);
  });

  it("una palabra con un tipeo se marca como tal, no como igual ni como distinta", () => {
    expect(comparaISBP("FISH MEAL MASHINE", "FISH MEAL MACHINE")).toBe("TIPEO");
  });

  it("dos nombres realmente distintos siguen siendo distintos", () => {
    expect(comparaISBP("ORIENT FEED PVT LTD", "MEGA FEED PVT LTD")).toBe("DISTINTO");
    expect(comparaISBP("MOLSUR S.A.", "CEREALSUR S.A.")).toBe("DISTINTO");
  });

  it("no da por equivalentes palabras cortas, donde un carácter cambia el sentido", () => {
    expect(esErrorDeTipeo("cif", "fob")).toBe(false);
    expect(esErrorDeTipeo("mt", "kg")).toBe(false);
  });

  it("un texto con información de más queda como equivalente, no como igual", () => {
    expect(comparaISBP("FISH MEAL", "FISH MEAL 54PCT MIN FOR ANIMAL FEED USE")).toBe("EQUIVALENTE");
  });
});

describe("consideración preliminar viii (2023) — el número del crédito", () => {
  const base: ReglaPresentacion[] = [
    {
      id: "lc-num-FACTURA",
      fuente: "47A",
      regla: "Factura: cita el número de la LC",
      estado: "DISCREPANCIA",
      evidencia: 'dice "LCSMWN25000XXX"',
    },
    {
      id: "fac-monto",
      fuente: "32B/39A",
      regla: "Factura dentro del monto",
      estado: "DISCREPANCIA",
      evidencia: "supera el tope",
    },
  ];

  it("baja de discrepancia a verificación y explica por qué", () => {
    const r = ablandarPorISBP(base);
    expect(r[0]!.estado).toBe("ATENCION");
    expect(r[0]!.fuente).toContain("ISBP 821");
    expect(r[0]!.evidencia).toContain("no justifica rechazo");
  });

  it("no toca ninguna otra discrepancia", () => {
    expect(ablandarPorISBP(base)[1]).toEqual(base[1]);
  });

  it("no inventa discrepancias donde no las había", () => {
    const ok: ReglaPresentacion[] = [{ ...base[0]!, estado: "OK" }];
    expect(ablandarPorISBP(ok)[0]!.estado).toBe("OK");
  });
});

describe("C1 — qué satisface una exigencia de factura comercial", () => {
  it("una proforma o una provisional no sirven", () => {
    expect(esFacturaComercial("PROFORMA INVOICE 2025099").vale).toBe(false);
    expect(esFacturaComercial("PROVISIONAL INVOICE").vale).toBe(false);
  });

  it("una factura emitida a efectos fiscales sí sirve", () => {
    expect(esFacturaComercial("INVOICE issued for tax purposes").vale).toBe(true);
    expect(esFacturaComercial("COMMERCIAL INVOICE A 4401").vale).toBe(true);
  });
});

describe("C8 — la versión del término de entrega", () => {
  it("si el crédito fija la versión, la factura tiene que indicarla", () => {
    expect(cotejarIncotermISBP("CFR COLOMBO INCOTERMS 2020", "CFR COLOMBO").estado).toBe("DISCREPANCIA");
    expect(cotejarIncotermISBP("CFR COLOMBO INCOTERMS 2020", "CFR COLOMBO INCOTERMS 2020").estado).toBe("OK");
  });

  it("dos versiones distintas son discrepancia", () => {
    const r = cotejarIncotermISBP("CIF SINGAPORE INCOTERMS 2010", "CIF SINGAPORE INCOTERMS 2020");
    expect(r.estado).toBe("DISCREPANCIA");
    expect(r.evidencia).toContain("2010");
  });

  it("si el crédito no fija versión, la factura puede agregarla", () => {
    expect(cotejarIncotermISBP("CFR COLOMBO", "CFR COLOMBO INCOTERMS 2020").estado).toBe("OK");
  });
});

describe("A12 — certificados posteriores al embarque", () => {
  it("un certificado de inspección a secas no tiene que ser previo al embarque", () => {
    expect(exigePrevioAlEmbarque("CERTIFICATE OF ANALYSIS")).toBe(false);
    expect(exigePrevioAlEmbarque("INSPECTION CERTIFICATE")).toBe(false);
  });

  it("uno calificado como previo al embarque sí", () => {
    expect(exigePrevioAlEmbarque("PRE-SHIPMENT INSPECTION CERTIFICATE")).toBe(true);
  });
});

describe("Q3 a Q5 y L3 — quién puede emitir un certificado", () => {
  it("si el crédito nombra al emisor, tiene que ser ese", () => {
    expect(emisorAdmitido("CERTIFICATE OF ANALYSIS ISSUED BY CALISET")).toBe("EL_QUE_NOMBRA_EL_CREDITO");
  });

  it("si no dice nada, cualquiera, incluido el beneficiario", () => {
    expect(emisorAdmitido("CERTIFICATE OF ANALYSIS")).toBe("CUALQUIERA");
  });

  it("un calificativo como «independent» excluye al beneficiario", () => {
    expect(emisorAdmitido("INDEPENDENT INSPECTION CERTIFICATE")).toBe("CUALQUIERA_MENOS_BENEFICIARIO");
    expect(emisorAdmitido("CERTIFICATE ISSUED BY AN OFFICIAL SURVEYOR")).toBe("CUALQUIERA_MENOS_BENEFICIARIO");
  });

  it("el certificado de origen se reconoce aparte: ahí corre la excepción de la cámara", () => {
    expect(esCertificadoDeOrigen("CERTIFICATE OF URUGUAY ORIGIN IN 02 FOLD")).toBe(true);
    expect(esCertificadoDeOrigen("CERTIFICATE OF ANALYSIS")).toBe(false);
  });
});
