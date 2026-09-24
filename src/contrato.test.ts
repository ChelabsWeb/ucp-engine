import { describe, expect, it } from "vitest";
import { type ContratoDeVenta, compararConContrato, describirDesvio, resumenDesvios } from "./contrato";
import { SWIFT_CSU2025099 } from "./fixtures";
import { parseMT700 } from "./swift-lc";

/**
 * El crédito que llegó contra el contrato que se firmó.
 *
 * El caso real: la proforma 2025099 —que es el contrato de venta, firmada por las dos partes—
 * pactó seis documentos y treinta días para presentar. El crédito que emitió el Meridian Bank pide
 * diez documentos y da veintiuno. Nadie lo notó hasta ahora, y es la clase de cosa que hay que
 * ver ANTES de embarcar: después, conseguir un certificado de fumigación que no estaba en el trato
 * es problema del exportador.
 */

/** La proforma 2025099, tal como está firmada. */
const PROFORMA: ContratoDeVenta = {
  documentosExigidos: [
    "Commercial Invoice",
    "Full set of Bill of Lading",
    "Packing List",
    "Sanitary Certificate",
    "Certificate of Origin",
    "Certificate of Analysis",
  ],
  plazoPresentacionDias: 30,
  monto: 54150,
  moneda: "USD",
  tolerancia: 0.1,
  incoterm: "CFR Colombo",
  puertoEmbarque: "Montevideo Port, Uruguay",
  puertoDestino: "Colombo Port, Sri Lanka",
  parcialesPermitidos: true,
};

const LC = parseMT700(SWIFT_CSU2025099)!.lc;

describe("el crédito real contra la proforma real", () => {
  const d = compararConContrato(LC, PROFORMA);

  it("encuentra los cuatro documentos que el crédito agrega", () => {
    const extra = d.filter((x) => x.desvio === "EXIGE_MAS");
    // nota de peso, certificado de fumigación y los dos certificados del beneficiario
    expect(extra).toHaveLength(4);
    expect(extra.map((x) => x.credito).join(" | ")).toMatch(/WEIGHT/i);
    expect(extra.map((x) => x.credito).join(" | ")).toMatch(/FUMIGATION/i);
  });

  it("el certificado veterinario no se cuenta de más: es el sanitario que sí se pactó", () => {
    // La proforma dice «Sanitary Certificate» y el crédito «INTERNATIONAL VETERINARY HEALTH
    // CERTIFICATE». Son el mismo papel con otro nombre, y `claveDoc` los junta por «health», que es
    // la palabra que los dos comparten. Contarlo como agregado sería una alarma falsa, y las
    // alarmas falsas son las que hacen que dejen de mirarse.
    const extra = d.filter((x) => x.desvio === "EXIGE_MAS").map((x) => x.credito.toUpperCase());
    expect(extra.join(" | ")).not.toMatch(/VETERINARY/);
  });

  it("y los nueve días de plazo que el crédito recorta", () => {
    const plazo = d.find((x) => x.campo.includes("Plazo"));
    expect(plazo?.desvio).toBe("MAS_ESTRICTO");
    expect(plazo?.contrato).toContain("30");
    expect(plazo?.credito).toContain("21");
  });

  it("lo que coincide no se informa: una lista de cosas iguales no se lee", () => {
    expect(d.some((x) => x.campo === "Monto")).toBe(false);
    expect(d.some((x) => x.campo === "Tolerancia")).toBe(false);
  });

  it("el resumen dice de una qué pasó", () => {
    const r = resumenDesvios(d);
    expect(r.documentosDeMas).toBe(4);
    expect(r.hayQuePedirEnmienda).toBe(true);
  });
});

describe("cada desvío dice qué hacer, y desde qué artículo", () => {
  it("nombra el artículo 4: el banco no mira el contrato, así que reclamarle a él no sirve", () => {
    const d = compararConContrato(LC, PROFORMA);
    expect(d[0]!.consecuencia).toBeTruthy();
    expect(describirDesvio(d[0]!)).toMatch(/UCP 600 art\. 4/);
  });

  it("un crédito más permisivo que el contrato se informa sin alarma", () => {
    // El contrato pedía embarcar en marzo y el crédito admite hasta el 30 de abril: eso es a favor
    // del beneficiario y no hay nada que pedir.
    const d = compararConContrato(LC, { ...PROFORMA, ultimoEmbarque: "31-mar-25" });
    const emb = d.find((x) => x.campo.includes("embarque"));
    expect(emb?.desvio).toBe("MAS_PERMISIVO");
    expect(resumenDesvios(d).hayQuePedirEnmienda).toBe(true); // por los documentos, no por esto
  });

  it("sin contrato cargado no inventa nada", () => {
    expect(compararConContrato(LC, {})).toEqual([]);
  });
});

describe("las diferencias que hacen perder plata", () => {
  it("menos tolerancia en el crédito que en el contrato es un desvío", () => {
    const d = compararConContrato({ ...LC, tolerancia: 0.05 }, PROFORMA);
    const t = d.find((x) => x.campo === "Tolerancia");
    expect(t?.desvio).toBe("MAS_ESTRICTO");
  });

  it("un monto menor al pactado deja mercadería sin cobrar", () => {
    const d = compararConContrato({ ...LC, monto: 50000 }, PROFORMA);
    const m = d.find((x) => x.campo === "Monto");
    expect(m?.desvio).toBe("MAS_ESTRICTO");
    expect(m?.consecuencia).toMatch(/4\.150|cobra/i);
  });

  it("otra moneda no es «más estricto»: es otra cosa y hay que mirarla", () => {
    const d = compararConContrato({ ...LC, moneda: "EUR" }, PROFORMA);
    expect(d.find((x) => x.campo === "Moneda")?.desvio).toBe("DIFIERE");
  });

  it("si el contrato permite embarques parciales y el crédito no, cambia la logística", () => {
    const d = compararConContrato(LC, { ...PROFORMA, parcialesPermitidos: true }, { parciales: "NOT ALLOWED" });
    expect(d.find((x) => x.campo.includes("parciales"))?.desvio).toBe("MAS_ESTRICTO");
  });
});
