import { describe, expect, it } from "vitest";
import { aparearConExigencias, type DocCertificado, reglasCertificados } from "./certificados";
import type { CamposDoc } from "./consistencia";
import { SWIFT_CSU2025099 } from "./fixtures";
import type { DocAnalizado } from "./presentacion";
import { parseMT700 } from "./swift-lc";

/** Los siete documentos del 46A que hasta ahora solo se contaban como presentes o ausentes. */

const LC = parseMT700(SWIFT_CSU2025099)!.lc;
const EXIGIDOS = LC.documentosExigidos!;
const campo = (valor: string, confianza = 0.95) => ({ valor, confianza });
const vacio = { valor: "", confianza: 0 };

function doc(over: Partial<Record<keyof CamposDoc, { valor: string; confianza: number }>>): CamposDoc {
  return {
    exportador: vacio,
    importador: vacio,
    montoTotal: vacio,
    moneda: vacio,
    cantidad: vacio,
    unidad: vacio,
    mercaderia: vacio,
    puertoEmbarque: vacio,
    puertoDestino: vacio,
    fechaEmbarque: vacio,
    incoterm: vacio,
    numeroDoc: vacio,
    ...over,
  } as CamposDoc;
}

const BL: DocAnalizado = { tipo: "BL", campos: doc({ fechaEmbarque: campo("08-APR-2025") }) };
const PACKING: DocAnalizado = { tipo: "PACKING", campos: doc({ pesoBruto: campo("54.040,00 Kgs") }) };
const HOY = new Date(2025, 3, 22);

const correr = (certificados: DocCertificado[], docs: DocAnalizado[] = [BL, PACKING]) =>
  reglasCertificados({ lc: LC, certificados, docs, beneficiario: "CEREALSUR S.A", hoy: HOY });

const exigencia = (re: RegExp) => EXIGIDOS.find((e) => re.test(e))!;

describe("la nota de peso", () => {
  const item = exigencia(/WEIGHT/i);

  it("el crédito real la exige", () => {
    expect(item).toContain("WEIGHT");
  });

  it("si su peso coincide con el del packing, pasa", () => {
    const r = correr([
      { exigencia: item, campos: doc({ pesoBruto: campo("54.040,00 Kgs") }), nombreArchivo: "Weight note" },
    ]);
    const peso = r.find((x) => x.id.startsWith("cert-peso-"));
    expect(peso?.estado).toBe("OK");
  });

  it("si difiere, es discrepancia entre documentos", () => {
    const r = correr([
      { exigencia: item, campos: doc({ pesoBruto: campo("52.000,00 Kgs") }), nombreArchivo: "Weight note" },
    ]);
    const peso = r.find((x) => x.id.startsWith("cert-peso-"));
    expect(peso?.estado).toBe("DISCREPANCIA");
    expect(peso?.evidencia).toContain("54.040");
  });

  it("compara kilos contra toneladas sin confundirse", () => {
    const r = correr([
      { exigencia: item, campos: doc({ pesoBruto: campo("54,04 MT") }), nombreArchivo: "Weight note" },
    ]);
    expect(r.find((x) => x.id.startsWith("cert-peso-"))?.estado).toBe("OK");
  });

  it("sin peso legible avisa en vez de dictaminar", () => {
    const r = correr([{ exigencia: item, campos: doc({}), nombreArchivo: "Weight note" }]);
    expect(r.find((x) => x.id.startsWith("cert-peso-"))?.estado).toBe("ATENCION");
  });
});

describe("el certificado de análisis", () => {
  const item = exigencia(/ANALYSIS/i);

  it("fechado después del embarque no es discrepancia, y queda dicho", () => {
    const r = correr([
      {
        exigencia: item,
        campos: doc({ fechaDocumento: campo("15-APR-2025") }),
        nombreArchivo: "Certificate of analysis",
      },
    ]);
    const fecha = r.find((x) => x.id.startsWith("cert-fecha-"));
    expect(fecha?.estado).toBe("OK");
    expect(fecha?.evidencia).toContain("admitido");
  });

  it("pero si el crédito lo pidiera previo al embarque, entonces sí", () => {
    const r = correr([
      {
        exigencia: "PRE-SHIPMENT INSPECTION CERTIFICATE",
        campos: doc({ fechaDocumento: campo("15-APR-2025") }),
        nombreArchivo: "Inspection",
      },
    ]);
    const previo = r.find((x) => x.id.startsWith("cert-previo-"));
    expect(previo?.estado).toBe("DISCREPANCIA");
  });
});

describe("quién puede emitir cada certificado", () => {
  it("si el crédito nombra al emisor, tiene que ser ese", () => {
    const r = correr([
      {
        exigencia: "CERTIFICATE OF ANALYSIS ISSUED BY CALISET",
        campos: doc({ exportador: campo("OTRO LABORATORIO SRL") }),
        nombreArchivo: "Analysis",
      },
    ]);
    expect(r.find((x) => x.id.startsWith("cert-emisor-"))?.estado).toBe("DISCREPANCIA");
  });

  it("y si es el que nombra, pasa aunque abrevie la forma societaria", () => {
    const r = correr([
      {
        exigencia: "CERTIFICATE OF ANALYSIS ISSUED BY CALISET LIMITED",
        campos: doc({ exportador: campo("CALISET LTD") }),
        nombreArchivo: "Analysis",
      },
    ]);
    expect(r.find((x) => x.id.startsWith("cert-emisor-"))?.estado).toBe("OK");
  });

  it("un certificado «independiente» no lo puede emitir el beneficiario", () => {
    const r = correr([
      {
        exigencia: "INDEPENDENT INSPECTION CERTIFICATE",
        campos: doc({ exportador: campo("CEREALSUR S.A") }),
        nombreArchivo: "Inspection",
      },
    ]);
    expect(r.find((x) => x.id.startsWith("cert-emisor-"))?.estado).toBe("DISCREPANCIA");
  });

  it("emitido por un tercero, pasa", () => {
    const r = correr([
      {
        exigencia: "INDEPENDENT INSPECTION CERTIFICATE",
        campos: doc({ exportador: campo("CALISET S.A.") }),
        nombreArchivo: "Inspection",
      },
    ]);
    expect(r.find((x) => x.id.startsWith("cert-emisor-"))?.estado).toBe("OK");
  });
});

describe("el certificado de origen", () => {
  // ojo: /ORIGIN/ a secas agarra el ítem del conocimiento, porque "ORIGINAL BILLS OF
  // LADING" contiene la palabra. Hay que pedir el límite de palabra.
  const item = exigencia(/\bORIGIN\b/i);

  it("«ORIGINAL BILLS OF LADING» no es un certificado de origen", () => {
    const delBl = EXIGIDOS.find((e) => /ORIGINAL BILLS/i.test(e))!;
    const r = correr([{ exigencia: delBl, campos: doc({ puertoEmbarque: campo("URUGUAY") }) }]);
    expect(r.some((x) => x.id.startsWith("cert-origen-"))).toBe(false);
  });

  it("el crédito pide origen uruguayo y el documento lo dice", () => {
    const r = correr([
      { exigencia: item, campos: doc({ puertoEmbarque: campo("URUGUAY") }), nombreArchivo: "Certificate of origin" },
    ]);
    expect(r.find((x) => x.id.startsWith("cert-origen-"))?.estado).toBe("OK");
  });

  it("si no se leyó el origen, queda para verificar", () => {
    const r = correr([{ exigencia: item, campos: doc({}), nombreArchivo: "Certificate of origin" }]);
    expect(r.find((x) => x.id.startsWith("cert-origen-"))?.estado).toBe("ATENCION");
  });
});

describe("los certificados del beneficiario", () => {
  it("siempre quedan para leer a mano, con el plazo que el crédito fija", () => {
    const item = EXIGIDOS.find((e) => /EMAILED/i.test(e))!;
    const r = correr([{ exigencia: item, campos: doc({}), nombreArchivo: "Beneficiary certificate" }]);
    const b = r.find((x) => x.id.startsWith("cert-benef-"));
    expect(b?.estado).toBe("ATENCION");
    expect(b?.regla).toContain("21 días");
  });
});

describe("aparear los documentos con lo que el crédito exige", () => {
  it("empareja cada documento con su ítem del 46A", () => {
    const r = aparearConExigencias(LC, [
      { tipo: "WEIGHT NOTE", campos: doc({}) },
      { tipo: "CERTIFICATE OF ANALYSIS", campos: doc({}) },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]!.exigencia).toContain("WEIGHT");
    expect(r[1]!.exigencia).toContain("ANALYSIS");
  });

  it("no usa dos veces la misma exigencia", () => {
    const r = aparearConExigencias(LC, [
      { tipo: "WEIGHT NOTE", campos: doc({}) },
      { tipo: "WEIGHT NOTE", campos: doc({}) },
    ]);
    expect(r).toHaveLength(1);
  });

  it("un documento que el crédito no pide no se aparea con nada", () => {
    expect(aparearConExigencias(LC, [{ tipo: "SOMETHING ELSE", campos: doc({}) }])).toEqual([]);
  });
});
