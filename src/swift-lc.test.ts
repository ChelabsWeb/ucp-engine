import { describe, expect, it } from "vitest";
import { SWIFT_CSU2025099 as MT710_CSU2025099 } from "./fixtures";
import { esMensajeSwift, fechaSwift, listaSwift, montoSwift, parseMT700, tokenizarSwift } from "./swift-lc";

/* La LC REAL del caso CSU2025099 (MT710 avisado por Standard Chartered a Banco Litoral el
   25-mar-2025), tal cual la reenvía el banco por mail — sin la cuenta de cobro de cargos. */

describe("swift-lc — detección y tokenización", () => {
  it("reconoce el MT710 real y NO una factura o un mail cualquiera", () => {
    expect(esMensajeSwift(MT710_CSU2025099)).toBe(true);
    expect(esMensajeSwift("INVOICE A 4401\nBILL TO ORIENT FEED\nTOTAL USD 51.262,00")).toBe(false);
    expect(esMensajeSwift("Hola, te paso la LC. Saludos.")).toBe(false);
  });
  it("separa campos y descarta el nombre impreso del campo", () => {
    const cs = tokenizarSwift(MT710_CSU2025099);
    expect(cs.find((c) => c.tag === "31D")?.lineas).toEqual(["250630 URUGUAY"]);
    expect(cs.find((c) => c.tag === "48")?.lineas).toEqual(["21"]);
    // el trailer no se captura dentro de 72Z
    expect(cs.find((c) => c.tag === "72Z")?.lineas).toEqual(["/ACK/"]);
  });
  it("también entiende el formato raw :31D:250630URUGUAY, con valores alfabéticos en la misma línea del tag", () => {
    const raw =
      "Sender : MRDNLKLXXXX\n MERIDIAN BANK PLC\n COLOMBO LK\n:27:1/1\n:40A:IRREVOCABLE\n:20:ABC123\n:31D:250630URUGUAY\n:50:ORIENT FEED (PVT) LTD\nGAMPAHA\n:59:CEREALSUR S.A\nCERRITO 820\n:32B:USD54150,00\n:42C:SIGHT\n:43P:ALLOWED\n:44E:MONTEVIDEO PORT IN URUGUAY\n:44C:250430\n:48:21\n:46A:1. INVOICE\n2. PACKING LIST";
    const r = parseMT700(raw)!;
    expect(r.lc.numero).toBe("ABC123");
    expect(r.lc.vencimiento).toBe("30-jun-25");
    expect(r.campos.montoTotal.valor).toBe("54150");
    // revisión 8-sep: en raw, "IRREVOCABLE"/"SIGHT"/"CEREALSUR S.A" son VALORES, no nombres de campo
    expect(r.extra.formaCredito).toBe("IRREVOCABLE");
    expect(r.extra.giros).toBe("SIGHT");
    expect(r.extra.parciales).toBe("ALLOWED");
    expect(r.campos.exportador.valor).toBe("CEREALSUR S.A");
    expect(r.campos.importador.valor).toBe("ORIENT FEED (PVT) LTD");
    expect(r.campos.puertoEmbarque.valor).toBe("MONTEVIDEO PORT IN URUGUAY");
    // sin 52A el emisor sale del Sender del header; los ítems "1." también se separan
    expect(r.lc.bancoEmisor).toBe("MERIDIAN BANK PLC");
    expect(r.requisitos.documentosExigidos).toEqual(["INVOICE", "PACKING LIST"]);
  });
});

describe("swift-lc — helpers", () => {
  it("fechaSwift: YYMMDD → dd-mmm-yy; basura → null", () => {
    expect(fechaSwift("250430")).toBe("30-abr-25");
    expect(fechaSwift("250630 URUGUAY")).toBe("30-jun-25");
    expect(fechaSwift("URUGUAY")).toBeNull();
    expect(fechaSwift("251345")).toBeNull();
  });
  it("montoSwift: coma decimal SWIFT, con o sin moneda", () => {
    expect(montoSwift("Currency : USD (US DOLLAR) Amount : #54.150,00#")).toEqual({ moneda: "USD", monto: 54150 });
    expect(montoSwift("USD54150,00")).toEqual({ moneda: "USD", monto: 54150 });
    expect(montoSwift("EUR1.234.567,89")).toEqual({ moneda: "EUR", monto: 1234567.89 });
    expect(montoSwift("USD 259.200")).toEqual({ moneda: "USD", monto: 259200 });
    // bancos anglosajones (revisión 8-sep): con los dos separadores manda el último
    expect(montoSwift("USD 54,150.00")).toEqual({ moneda: "USD", monto: 54150 });
    expect(montoSwift("USD 1,234,567.89")).toEqual({ moneda: "USD", monto: 1234567.89 });
    expect(montoSwift("USD 1,234,567")).toEqual({ moneda: "USD", monto: 1234567 });
  });
  it("listaSwift: pega las continuaciones al ítem anterior", () => {
    const l = listaSwift(["+1)SIGNED COMMERCIAL INVOICES IN 03 FOLD,", "II)GOODS AS PER PROFORMA", "+2)PACKING LIST"]);
    expect(l).toEqual(["SIGNED COMMERCIAL INVOICES IN 03 FOLD, II)GOODS AS PER PROFORMA", "PACKING LIST"]);
  });
});

describe("parseMT700 — la LC real del caso CSU2025099, sin IA", () => {
  const r = parseMT700(MT710_CSU2025099)!;
  it("los datos de la operación: número, bancos, fechas, plazo y tolerancia", () => {
    expect(r.lc).toMatchObject({
      numero: "LCMRDN25000471",
      bancoEmisor: "MERIDIAN BANK PLC",
      bancoAvisador: "BANCO LITORAL (URUGUAY) S.A.",
      vencimiento: "30-jun-25",
      limiteEmbarque: "30-abr-25",
      plazoPresentacion: "21 días desde la fecha de embarque (campo 48)",
      tolerancia: 0.1,
      documentosExigidos: expect.any(Array),
      condicionesAdicionales: expect.any(Array),
      fechaEmision: "20-mar-25",
      monto: 54150,
      moneda: "USD",
      giros: "SIGHT",
      librado: "MERIDIAN BANK PLC",
    });
  });
  it("los 10 documentos exigidos del 46A, cada uno entero", () => {
    expect(r.requisitos.documentosExigidos).toHaveLength(10);
    expect(r.requisitos.documentosExigidos[0]).toMatch(/^SIGNED COMMERCIAL INVOICES IN 03 FOLD/);
    expect(r.requisitos.documentosExigidos[0]).toContain("PROFORMA INVOICE NO. 2025099");
    expect(r.requisitos.documentosExigidos[1]).toContain("TO THE ORDER OF MERIDIAN BANK PLC");
    expect(r.requisitos.documentosExigidos[4]).toBe("WEIGHT  NOTE IN 03 FOLD.".replace(/\s+/g, " "));
    expect(r.requisitos.documentosExigidos[9]).toContain("WITHIN 21 DAYS FROM THE DATE OF SHIPMENT");
    expect(r.requisitos.parcialesPermitidos.valor).toBe("ALLOWED");
    expect(r.requisitos.toleranciaCantidad.valor).toBe("±10%");
  });
  it("los campos comparables para la matriz", () => {
    expect(r.campos.exportador.valor).toBe("CEREALSUR S.A");
    expect(r.campos.importador.valor).toBe("ORIENT FEED (PVT) LTD");
    expect(r.campos.montoTotal).toEqual({ valor: "54150", confianza: 1 });
    expect(r.campos.moneda.valor).toBe("USD");
    expect(r.campos.cantidad.valor).toBe("57");
    expect(r.campos.unidad.valor).toBe("MTS");
    expect(r.campos.incoterm.valor).toBe("CFR");
    expect(r.campos.puertoEmbarque.valor).toBe("MONTEVIDEO PORT IN URUGUAY");
    expect(r.campos.puertoDestino.valor).toBe("COLOMBO,SRI LANKA");
    expect(r.campos.fechaEmbarque.valor).toBe("30-abr-25");
    expect(r.campos.mercaderia.valor).toMatch(/^57 MTS OF FISH MEAL 54PCT MIN/);
  });
  it("los extras que la operación no modela pero el operador necesita leer", () => {
    expect(r.extra.tipoMensaje).toBe("MT710");
    expect(r.extra.fechaEmision).toBe("20-mar-25");
    expect(r.extra.formaCredito).toContain("IRREVOCABLE");
    expect(r.extra.confirmacion).toBe("WITHOUT");
    expect(r.extra.disponibleCon).toBe("ANY BANK IN URUGUAY BY NEGOTIATION");
    expect(r.extra.giros).toBe("SIGHT");
    expect(r.extra.transbordo).toBe("ALLOWED");
    expect(r.extra.condicionesAdicionales).toHaveLength(5);
    expect(r.extra.condicionesAdicionales[2]).toContain("DISCREPANCY FEE OF USD 80");
    expect(r.extra.cargos).toContain("BENEFICIARY'S ACCOUNT");
    expect(r.extra.reglas).toBe("UCP LATEST VERSION");
  });
  it("sin 39A toma la tolerancia del 47A; sin ninguna queda null", () => {
    const sin39 = MT710_CSU2025099.replace(/ *39A: Percentage Credit Amt Tolerance\n *10\/10\n/, "");
    expect(parseMT700(sin39)!.lc.tolerancia).toBe(0.1);
    const sinNada = sin39.replace(/ *\+7\)A TOLERANCE OF 10 PCT MORE OR LESS IN QUANTITY AND\n *VALUE ALLOWED\.\n/, "");
    expect(parseMT700(sinNada)!.lc.tolerancia).toBeNull();
  });
  it("texto que no es SWIFT → null (la IA se encarga)", () => {
    expect(parseMT700("Carta de crédito irrevocable a favor de Cerealsur por USD 54.150")).toBeNull();
  });
});

describe("parseMT700 — el 46A queda en la LC para generar lo que exige", () => {
  it("lc.documentosExigidos trae los 10 del caso; sin 46A queda null", () => {
    expect(parseMT700(MT710_CSU2025099)!.lc.documentosExigidos).toHaveLength(10);
    expect(parseMT700(":27:1/1\n:40A:IRREVOCABLE\n:20:X\n:31D:250630URUGUAY")!.lc.documentosExigidos).toBeNull();
  });
});

describe("D3/D4: lo que el 59 y el 45A fijan para los documentos propios", () => {
  it("dirección del beneficiario y HS code salen del SWIFT real", () => {
    const { lc } = parseMT700(MT710_CSU2025099)!;
    expect(lc.beneficiarioDireccion).toMatch(/CERRITO 820/);
    expect(lc.hsCode).toBe("2301.20.00");
  });
});
