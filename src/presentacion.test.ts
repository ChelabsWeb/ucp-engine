import { describe, expect, it } from "vitest";
import { generarChecklist } from "./checklist";
import type { CamposDoc } from "./consistencia";
import { SWIFT_CSU2025099 as MT710_CSU2025099 } from "./fixtures";
import { ejemplaresDe, feeDiscrepancia, precheckPresentacion } from "./presentacion";
import { parseMT700 } from "./swift-lc";
import type { OperationDetail } from "./types";

const lc = parseMT700(MT710_CSU2025099)!.lc;
const campo = (valor: string, confianza = 0.95) => ({ valor, confianza });
const vacio = { valor: "", confianza: 0 };
const base: CamposDoc = {
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
};

/* los tres documentos reales del caso, con lo que el banco mira */
const FACTURA: CamposDoc = {
  ...base,
  exportador: campo("CEREALSUR S.A"),
  importador: campo("ORIENT FEED (PVT) LTD"),
  montoTotal: campo("51.262,00"),
  moneda: campo("USD"),
  cantidad: campo("53.96"),
  unidad: campo("MTS"),
  fechaEmbarque: campo("08/04/25"),
  fechaDocumento: campo("08/04/25"),
  incoterm: campo("CFR COLOMBO, SRI LANKA"),
  numeroDoc: campo("A 4401"),
  bultos: campo("1360"),
  tipoBulto: campo("BAGS"),
  pesoBruto: campo("54.040 KGS"),
  numeroLC: campo("LCMRDN25000471"),
  referenciaProforma: campo("GOODS ARE SHIPPED AS PER THE PROFORMA INVOICE NO. 2025099 DTD 04.03.2025"),
  flete: campo("FREIGHT PREPAID 53.960 × 150,00 = 8.094,00"),
};
const PACKING: CamposDoc = {
  ...base,
  exportador: campo("MOLSUR S.A."),
  importador: campo("ORIENT FEED (PVT) LTD."),
  cantidad: campo("53,96"),
  unidad: campo("MT"),
  fechaEmbarque: campo("08/04/2025"),
  fechaDocumento: campo("April 08th, 2025"),
  bultos: campo("1.360"),
  tipoBulto: campo("Bags"),
  pesoBruto: campo("54.040,00 Kgs"),
  numeroLC: campo("LCMRDN25000471"),
};
const BL: CamposDoc = {
  ...base,
  exportador: campo("MOLSUR SA"),
  importador: campo("ORIENT FEED (PVT) LTD"),
  notify: campo("ORIENT FEED (PVT) LTD"),
  consignatario: campo("TO THE ORDER OF MERIDIAN BANK PLC"),
  cantidad: campo("53.96"),
  unidad: campo("MTS"),
  fechaEmbarque: campo("08-APR-2025"),
  fechaDocumento: campo("08 APR 2025"),
  numeroDoc: campo("MVD0990117"),
  bultos: campo("1360"),
  tipoBulto: campo("CARTONS"),
  pesoBruto: campo("54040.000 KGS"),
  numeroLC: campo("LCMRDN25000471"),
  flete: campo("FREIGHT PREPAID"),
};

const OP: OperationDetail = {
  codigo: "CSU2025099",
  mercaderia: "FISH MEAL · 57 TON",
  cliente: "ORIENT FEED (PVT) LTD",
  clientePais: "LK",
  incoterm: "CFR",
  estado: "EMBARCADA",
  alertas: 0,
  fechaEmbarque: "31-mar-25",
  montoVenta: 54150,
  tieneDetalle: true,
  descripcionLarga: "FISH MEAL",
  ruta: "CFR Montevideo → Colombo",
  moneda: "USD",
  medioPago: "LC",
  legs: [
    {
      tipo: "COMPRA",
      contraparte: "MOLSUR S.A.",
      lugar: "UY",
      condicionesPago: "TT",
      precioUnit: 720,
      montoTotal: 41040,
      incoterm: "FOB",
    },
    {
      tipo: "VENTA",
      contraparte: "ORIENT FEED (PVT) LTD",
      lugar: "LK",
      condicionesPago: "LC",
      precioUnit: 950,
      montoTotal: 54150,
      incoterm: "CFR",
    },
  ],
  items: [{ descripcion: "FISH MEAL", cantidad: "57 TON", embalaje: "bags" }],
  lc,
  blReal: "08-abr-25",
  resumenEjecutivo: "",
  resumenGeneradoEn: "",
  hitos: [],
  documentos: [],
  matriz: [],
  matrizCorridaEn: "",
  discrepancias: [],
  checklist: generarChecklist({ mercaderia: "OTRO", incoterm: "CFR", medioPago: "LC", destinoPais: "LK" }),
};
const HOY = new Date(2025, 3, 15); // 15-abr-25: BL 08-abr + 21 = 29-abr

describe("ejemplaresDe / feeDiscrepancia", () => {
  it("lee originales y copias como los escribe el 46A", () => {
    expect(ejemplaresDe("SIGNED COMMERCIAL INVOICES IN 03 FOLD")).toMatchObject({
      originales: 3,
      copias: null,
      texto: "3 originales",
    });
    expect(
      ejemplaresDe("FULL SET OF (3/3) SHIPPED ON BOARD ORIGINAL BILLS OF LADING PLUS 02 NON NEGOTIABLE COPIES"),
    ).toMatchObject({ originales: 3, copias: 2, texto: "3 originales + 2 copias" });
    expect(ejemplaresDe("CERTIFICATE OF ORIGIN IN DUPLICATE")).toMatchObject({ originales: 2 });
    expect(ejemplaresDe("FUMIGATION CERTIFICATE.")).toMatchObject({ originales: null, texto: "sin cantidad indicada" });
  });
  it("el fee del 47A", () => {
    expect(feeDiscrepancia(lc.condicionesAdicionales)).toBe(80);
    expect(feeDiscrepancia(["THIRD PARTY DOCUMENTS ACCEPTABLE"])).toBeNull();
  });
});

describe("precheckPresentacion — el paquete real del caso CSU2025099", () => {
  const docs = [
    { tipo: "FACTURA" as const, campos: FACTURA, nombreArchivo: "A4401.jpg" },
    { tipo: "PACKING" as const, campos: PACKING, nombreArchivo: "PL.pdf" },
    { tipo: "BL" as const, campos: BL, nombreArchivo: "BL.jpg" },
  ];
  const r = precheckPresentacion({ lc, docs, op: OP, empresaRazonSocial: "CEREALSUR S.A.", hoy: HOY });
  const por = (id: string) => r.reglas.find((x) => x.id === id);

  it("no está listo: faltan los documentos que el paquete no trajo y hay una discrepancia real", () => {
    expect(r.listo).toBe(false);
    expect(r.feePorJuego).toBe(80);
    expect(r.diasParaPresentar).toBe(14);
  });
  it("46A: factura, packing y BL analizados → OK con sus ejemplares; los demás FALTAN", () => {
    expect(por("46A+1")).toMatchObject({ estado: "OK", evidencia: expect.stringContaining("3 originales") });
    expect(por("46A+2")).toMatchObject({ estado: "OK", evidencia: expect.stringContaining("3 originales + 2 copias") });
    expect(por("46A+4")?.estado).toBe("OK"); // packing
    const faltan = r.reglas.filter((x) => x.estado === "FALTA").map((x) => x.regla);
    expect(faltan.some((f) => /ORIGIN/.test(f))).toBe(true);
    expect(faltan.some((f) => /WEIGHT NOTE/.test(f))).toBe(true);
    expect(faltan.some((f) => /VETERINARY/.test(f))).toBe(true);
    expect(faltan.some((f) => /FUMIGATION/.test(f))).toBe(true);
    expect(faltan.some((f) => /ANALYSIS/.test(f))).toBe(true);
    expect(faltan.filter((f) => /BENEFICIARY/.test(f))).toHaveLength(2);
    expect(r.faltan).toBe(7);
  });
  it("47A: los tres citan la LC y están fechados después de la emisión (20-mar)", () => {
    for (const t of ["FACTURA", "PACKING", "BL"]) {
      expect(por(`lc-num-${t}`)?.estado).toBe("OK");
      expect(por(`fecha-${t}`)?.estado).toBe("OK");
    }
  });
  it("BL: consignee a la orden del Meridian, freight prepaid, notify el applicant, a bordo antes del 30-abr", () => {
    expect(por("bl-consignee")?.estado).toBe("OK");
    expect(por("bl-freight")).toMatchObject({ estado: "OK", regla: 'BL marcado "FREIGHT PREPAID"' });
    expect(por("bl-notify")?.estado).toBe("OK");
    expect(por("ultimo-embarque")?.estado).toBe("OK");
  });
  it("factura: cita la proforma 2025099, desglosa el flete, entra en el monto de la LC, la emite el beneficiario", () => {
    expect(por("fac-proforma")?.estado).toBe("OK");
    expect(por("fac-flete")?.estado).toBe("OK");
    expect(por("fac-monto")).toMatchObject({ estado: "OK", regla: expect.stringContaining("54.150") });
    expect(por("fac-emisor")?.estado).toBe("OK");
  });
  it("la única discrepancia es cartons vs bags (art. 14d); plazo OK con 14 días", () => {
    const disc = r.reglas.filter((x) => x.estado === "DISCREPANCIA");
    expect(disc).toHaveLength(1);
    expect(disc[0].id).toBe("cruce-tipo-de-bulto");
    expect(por("plazo")?.estado).toBe("OK");
  });
  it("con los documentos que faltan generados y aprobados, y el packing corregido, queda LISTO", () => {
    const aprobados: OperationDetail["documentos"] = ["Weight note", "Certificado del beneficiario"].map((nombre) => ({
      nombre,
      origen: "GENERADO" as const,
      estado: "APROBADO" as const,
      version: "v1",
      fecha: "10-abr-25",
      accion: "ver" as const,
    }));
    const checklistOk = OP.checklist.map((c) =>
      /origen|sanitario|fumig|análisis|analisis/i.test(c.label) ? { ...c, estado: "COMPLETO" as const } : c,
    );
    const conFalt = [
      ...checklistOk,
      { label: "Certificado de fumigación", estado: "COMPLETO" as const },
      { label: "Certificado de análisis", estado: "COMPLETO" as const },
      { label: "Certificado veterinario internacional", estado: "COMPLETO" as const },
    ];
    const blBags = { ...BL, tipoBulto: campo("BAGS") };
    const r2 = precheckPresentacion({
      lc,
      docs: [docs[0], docs[1], { tipo: "BL", campos: blBags }],
      op: { ...OP, documentos: aprobados, checklist: conFalt },
      empresaRazonSocial: "CEREALSUR S.A.",
      hoy: HOY,
    });
    expect(r2.discrepancias).toBe(0);
    expect(r2.faltan).toBe(0);
    // lo marcado completo pero no analizado queda en ATENCIÓN (subirlo para verificarlo), no bloquea
    expect(r2.atencion).toBeGreaterThan(0);
    expect(r2.listo).toBe(true);
  });
  it("el mismo paquete presentado el 2-may está fuera de plazo y la factura que supera el monto + 10 % es discrepancia", () => {
    const tarde = precheckPresentacion({
      lc,
      docs,
      op: OP,
      empresaRazonSocial: "CEREALSUR S.A.",
      hoy: new Date(2025, 4, 2),
    });
    expect(tarde.reglas.find((x) => x.id === "plazo")?.estado).toBe("DISCREPANCIA");
    const cara = precheckPresentacion({
      lc,
      docs: [{ tipo: "FACTURA", campos: { ...FACTURA, montoTotal: campo("60.000,00") } }],
      op: OP,
      empresaRazonSocial: "CEREALSUR S.A.",
      hoy: HOY,
    });
    expect(cara.reglas.find((x) => x.id === "fac-monto")?.estado).toBe("DISCREPANCIA");
  });
  it("sin 46A en la LC no puede decir 'listo' y lo dice", () => {
    const sin = precheckPresentacion({
      lc: { ...lc, documentosExigidos: null },
      docs,
      op: OP,
      empresaRazonSocial: "CEREALSUR S.A.",
      hoy: HOY,
    });
    expect(sin.listo).toBe(false);
    expect(sin.reglas.find((x) => x.id === "46A")?.estado).toBe("SIN_DATO");
  });
});

describe("D3: la dirección del beneficiario es la de la LC", () => {
  it("Ajustes con otra dirección (Colón 1498) → ATENCIÓN; con la misma calle → OK; sin dato → sin regla", () => {
    const docs = [{ tipo: "FACTURA" as const, campos: FACTURA }];
    const otra = precheckPresentacion({
      lc,
      docs,
      op: OP,
      empresaRazonSocial: "CEREALSUR S.A.",
      empresaDireccion: "Colón 1498 of. 201",
      hoy: HOY,
    });
    expect(otra.reglas.find((x) => x.id === "beneficiario-direccion")).toMatchObject({
      estado: "ATENCION",
      fuente: "59",
    });
    const misma = precheckPresentacion({
      lc,
      docs,
      op: OP,
      empresaRazonSocial: "CEREALSUR S.A.",
      empresaDireccion: "Cerrito 820, Montevideo",
      hoy: HOY,
    });
    expect(misma.reglas.find((x) => x.id === "beneficiario-direccion")?.estado).toBe("OK");
    const sin = precheckPresentacion({ lc, docs, op: OP, empresaRazonSocial: "CEREALSUR S.A.", hoy: HOY });
    expect(sin.reglas.find((x) => x.id === "beneficiario-direccion")).toBeUndefined();
  });
});
