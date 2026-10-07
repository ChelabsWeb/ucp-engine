import { describe, expect, it } from "vitest";
import { generarAlertasDeOperacion } from "../alertas";
import { generarChecklist } from "../checklist";
import {
  type CamposDoc,
  compararDocumento,
  compararEntreDocumentos,
  cotejarLC,
  cotejarLCconOperacion,
} from "../consistencia";
import { SWIFT_CSU2025099 as MT710_CSU2025099 } from "../fixtures";
import { parseMT700 } from "../swift-lc";
import type { Empresa, OperationDetail } from "../types";

/**
 * DATASET DORADO — el expediente de REFERENCIA de la operación CSU2025099 que mandó Cerealsur el 8-sep-2026
 * (harina de pescado Molsur → Orient Feed, Sri Lanka, LC del Meridian Bank, embarcada el 08-abr-2025),
 * transcripto documento por documento, contra la operación tal como la importó el ETL.
 *
 * Lo que este test fija: la matriz NO inventa discrepancias donde el paquete real fue aceptado por
 * el banco, y SÍ levanta las dos cosas que en el papel real estaban mal o distintas.
 */

const EMPRESA: Empresa = {
  razonSocial: "CEREALSUR S.A.",
  rut: "210000000013",
  direccion: "Cerrito 820 of. 006",
  ciudad: "Montevideo",
  email: "operaciones@cerealsur.example",
  telefono: "+598 20000011",
};

const lcSwift = parseMT700(MT710_CSU2025099)!;

/* la operación como quedó en romai tras el ETL (unidades reales) + la LC cargada desde el SWIFT */
const OP: OperationDetail = {
  codigo: "CSU2025099",
  mercaderia: "FISH MEAL · 57 TON",
  cliente: "ORIENT FEED (PVT) LTD",
  clientePais: "LK",
  incoterm: "CFR",
  estado: "DOCS_EN_PREPARACION",
  alertas: 0,
  fechaEmbarque: "31-mar-25",
  montoVenta: 54150,
  tieneDetalle: true,
  descripcionLarga: "FISH MEAL",
  ruta: "CFR — → —",
  moneda: "USD",
  medioPago: "LC",
  legs: [
    {
      tipo: "COMPRA",
      contraparte: "MOLSUR S.A.",
      lugar: "Canelón Chico, UY",
      condicionesPago: "100% TT",
      precioUnit: 720,
      montoTotal: 41040,
      incoterm: "FOB",
    },
    {
      tipo: "VENTA",
      contraparte: "ORIENT FEED (PVT) LTD",
      lugar: "Gampaha, LK",
      condicionesPago: "LC at sight",
      precioUnit: 950,
      montoTotal: 54150,
      incoterm: "CFR",
    },
  ],
  items: [
    { descripcion: "FISH MEAL", cantidad: "57 TON", embalaje: "small bags 40 kg", precioCompra: 720, precioVenta: 950 },
  ],
  lc: lcSwift.lc,
  fleteUnit: 150,
  contenedores: [
    {
      numero: "DEMU4100371",
      precinto: "P1180119",
      tipo: "40HC",
      bultos: 680,
      tipoBulto: "bags",
      pesoNetoKg: 27310,
      pesoBrutoKg: 27350,
      lotes: "4342-4349-4356-4363",
      produccionDesde: "2024-12-21",
      produccionHasta: "2024-12-28",
      vencimiento: "2025-12-21",
    },
    {
      numero: "DEMU4100372",
      precinto: "P1180118",
      tipo: "40HC",
      bultos: 680,
      tipoBulto: "bags",
      pesoNetoKg: 26650,
      pesoBrutoKg: 26690,
      lotes: null,
      produccionDesde: null,
      produccionHasta: null,
      vencimiento: null,
    },
  ],
  resumenEjecutivo: "",
  resumenGeneradoEn: "",
  hitos: [],
  documentos: [],
  matriz: [],
  matrizCorridaEn: "",
  discrepancias: [],
  checklist: generarChecklist({ mercaderia: "OTRO", incoterm: "CFR", medioPago: "LC", destinoPais: "LK" }),
};

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

/* Commercial invoice A 4401 (08/04/25, e-factura DGI) */
const FACTURA: CamposDoc = {
  ...base,
  exportador: campo("CEREALSUR S.A"),
  importador: campo("ORIENT FEED (PVT) LTD"),
  montoTotal: campo("51.262,00", 0.99),
  moneda: campo("USD"),
  cantidad: campo("53.96"),
  unidad: campo("MTS"),
  mercaderia: campo("FISH MEAL 54PCT MIN (FOR ANIMAL FEED USE)"),
  puertoEmbarque: campo("MONTEVIDEO, URUGUAY"),
  puertoDestino: campo("COLOMBO, SRI LANKA"),
  // tal cual lo leyó Opus de la foto real (smoke): incoterm con el puerto, cantidad en KGS
  fechaEmbarque: campo("08/04/25"),
  incoterm: campo("CFR COLOMBO, SRI LANKA"),
  numeroDoc: campo("A 4401"),
  bultos: campo("1360", 0.6),
  tipoBulto: campo("BAGS"),
  pesoBruto: campo("54.040 KGS"),
};
/* Packing list (Molsur S.A. La Loma, ORIGINAL, 08-abr-2025) */
const PACKING: CamposDoc = {
  ...base,
  exportador: campo("MOLSUR S.A."),
  importador: campo("ORIENT FEED (PVT) LTD."),
  cantidad: campo("53,96"),
  unidad: campo("MT"),
  mercaderia: campo("Fish meal 54 PCT min (For Animal Feed Use)"),
  puertoEmbarque: campo("Montevideo Port, Uruguay"),
  puertoDestino: campo("Colombo, Sri Lanka"),
  fechaEmbarque: campo("08/04/2025"),
  numeroDoc: campo("PL 08-abr-25", 0.7),
  bultos: campo("1.360"),
  tipoBulto: campo("Bags"),
  pesoBruto: campo("54.040,00 Kgs"),
};
/* Bill of lading OCEANLINE MVD0990117 (copy non negotiable) */
const BL: CamposDoc = {
  ...base,
  exportador: campo("MOLSUR SA"),
  importador: campo("ORIENT FEED (PVT) LTD"),
  consignatario: campo("TO THE ORDER OF MERIDIAN BANK PLC"),
  cantidad: campo("53.96"),
  unidad: campo("MTS"),
  mercaderia: campo("FISH MEAL 54PCT MIN (FOR ANIMAL FEED USE)"),
  puertoEmbarque: campo("MONTEVIDEO, URUGUAY"),
  puertoDestino: campo("COLOMBO, SRI LANKA"),
  fechaEmbarque: campo("08-APR-2025"),
  numeroDoc: campo("MVD0990117"),
  bultos: campo("1360"),
  tipoBulto: campo("CARTONS"),
  pesoBruto: campo("54040.000 KGS"),
};

const disc = (r: { discrepancias: { titulo: string }[] }) => r.discrepancias.map((d) => d.titulo);

describe("caso dorado CSU2025099 — los papeles reales contra la operación real", () => {
  it("la LC del SWIFT quedó cargada con los datos del banco: ±10 %, 21 días, vence 30-jun-25", () => {
    expect(OP.lc).toMatchObject({
      numero: "LCMRDN25000471",
      tolerancia: 0.1,
      vencimiento: "30-jun-25",
      limiteEmbarque: "30-abr-25",
    });
  });

  it("factura: embarcó 53,96 t y facturó USD 51.262 contra 57 t / USD 54.150 → TOLERANCIA (−5,3 % dentro del 10 % de la LC), sin discrepancias", () => {
    const r = compararDocumento(FACTURA, OP, EMPRESA, "FACTURA");
    expect(disc(r)).toEqual([]);
    expect(r.matriz.find((m) => m.campo === "Monto")?.estado).toBe("TOLERANCIA");
    expect(r.matriz.find((m) => m.campo === "Cantidad")?.estado).toBe("TOLERANCIA");
    expect(r.matriz.find((m) => m.campo === "Incoterm")?.estado).toBe("OK");
    expect(r.matriz.find((m) => m.campo === "Bultos")?.estado).toBe("OK"); // 1.360 contra los 2 contenedores
  });

  it("con el ±5 % por defecto (sin la tolerancia de la LC) la misma factura habría dado dos discrepancias falsas", () => {
    const sinTol = { ...OP, lc: { ...OP.lc!, tolerancia: null } };
    expect(disc(compararDocumento(FACTURA, sinTol, EMPRESA, "FACTURA"))).toHaveLength(2);
  });

  it("packing list del productor: emisor Molsur es documento de terceros (EQUIV), bultos y peso bruto coinciden con los contenedores", () => {
    const r = compararDocumento(PACKING, OP, EMPRESA, "PACKING");
    expect(disc(r)).toEqual([]);
    expect(r.matriz.find((m) => m.campo === "Emisor / shipper")?.estado).toBe("EQUIV");
    expect(r.matriz.find((m) => m.campo === "Bultos")?.estado).toBe("OK");
    expect(r.matriz.find((m) => m.campo === "Peso bruto")?.estado).toBe("OK");
  });

  it("BL: shipper el productor, consignee a la orden del Meridian, a bordo el 08-abr (antes del 30-abr) → sin discrepancias", () => {
    const r = compararDocumento(BL, OP, EMPRESA, "BL");
    expect(disc(r)).toEqual([]);
    expect(r.matriz.find((m) => m.campo === "Consignatario")?.estado).toBe("OK");
    expect(r.matriz.find((m) => m.campo.startsWith("Fecha a bordo"))?.estado).toBe("OK");
  });

  it("ENTRE documentos sí hay una contradicción real: el BL dice CARTONS y el packing BAGS (UCP 600 14d)", () => {
    const c = compararEntreDocumentos([
      { tipo: "FACTURA", campos: FACTURA },
      { tipo: "PACKING", campos: PACKING },
      { tipo: "BL", campos: BL },
    ]);
    // y el aviso (MEDIA) de que la factura la emite Cerealsur y el BL/packing los emite Molsur
    expect(c.map((x) => [x.campo, x.severidad])).toEqual([
      ["Tipo de bulto", "ALTA"],
      ["Exportador / shipper", "MEDIA"],
    ]);
  });

  it("la LC exige 10 documentos: el checklist cubre 5 y le faltan los otros 5 (weight note, veterinario, fumigación, análisis, certificados del beneficiario)", () => {
    const co = cotejarLC(lcSwift.requisitos.documentosExigidos, OP.checklist);
    expect(co.cubiertos.map((c) => c.doc.slice(0, 30))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("SIGNED COMMERCIAL INVOICES"),
        expect.stringContaining("FULL SET OF (3/3)"),
        expect.stringContaining("CERTIFICATE OF URUGUAY ORIGIN"),
        expect.stringContaining("PACKING LIST"),
      ]),
    );
    expect(co.faltantes.length).toBeGreaterThanOrEqual(4);
    expect(co.faltantes.some((f) => /WEIGHT NOTE/.test(f))).toBe(true);
    expect(co.faltantes.some((f) => /FUMIGATION/.test(f))).toBe(true);
    expect(co.faltantes.some((f) => /CERTIFICATE OF ANALYSIS/.test(f))).toBe(true);
    expect(co.faltantes.filter((f) => /BENEFICIARY'S CERTIFICATE/.test(f))).toHaveLength(2);
  });

  it("la LC contra lo cargado: todo coincide porque la LC se cargó desde el SWIFT; con la proforma tipeada (30 días, ±5 %) habría dos diferencias", () => {
    expect(cotejarLCconOperacion(lcSwift.requisitos, lcSwift.campos, OP).every((d) => d.estado === "OK")).toBe(true);
    const tipeada = { ...OP, lc: { ...OP.lc!, plazoPresentacion: "30 días desde el embarque", tolerancia: null } };
    const dif = cotejarLCconOperacion(lcSwift.requisitos, lcSwift.campos, tipeada).filter((d) => d.estado !== "OK");
    expect(dif.map((d) => d.campo)).toEqual(["Plazo de presentación", "Tolerancia"]);
  });

  it("alertas con el BL del 08-abr: el 22-abr quedan 7 días para presentar (BL + 21 = 29-abr, antes del vencimiento) → ALTA con lo que falta", () => {
    const conBL = { ...OP, blReal: "08-abr-25", fechaEmbarque: "08-abr-25" };
    const a = generarAlertasDeOperacion(conBL, new Date(2025, 3, 22)).filter((x) =>
      x.titulo.includes("Presentar documentos al banco"),
    );
    expect(a).toHaveLength(1);
    expect(a[0].titulo).toContain("antes del 29-abr (7 días");
    // el 10-abr todavía faltan 19 días: no molesta
    expect(
      generarAlertasDeOperacion(conBL, new Date(2025, 3, 10)).some((x) => x.titulo.includes("Presentar documentos")),
    ).toBe(false);
  });

  it("alertas de embarque: el buque cambió de Ever Linking (booking) a Log-In Endurance (BL)", () => {
    const emb = {
      ...OP,
      embarque: { cutoffDocumental: "31-mar-25", buque: "STELLA AUSTRAL", buqueBooking: "EVER LINKING" },
    };
    const a = generarAlertasDeOperacion(emb, new Date(2025, 3, 10));
    expect(a.some((x) => x.titulo.includes("buque cambió"))).toBe(true);
  });
});
