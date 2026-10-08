import { describe, expect, it } from "vitest";
import { SWIFT_CSU2025099 as MT710_CSU2025099 } from "./fixtures";
import {
  esMensajeSwift,
  fechaSwift,
  listaSwift,
  montoSwift,
  normalizarSwiftDePdf,
  parseMT700,
  tokenizarSwift,
} from "./swift-lc";

/* La LC REAL del caso CSU2025099 (MT710 avisado por Standard Chartered a Banco Litoral el
   25-mar-2025), tal cual la reenvía el banco por mail — sin la cuenta de cobro de cargos. */

/**
 * El crédito que llega como PDF.
 *
 * El banco avisa el crédito por mail con el SWIFT adjunto en PDF, y así es como Agromeals lo
 * recibe. Al extraer ese texto **los saltos de línea no existen**: lo que en el papel se ve como
 * renglones es el renderizado, y el mensaje entero sale en una línea.
 *
 * Con eso el parser determinista no se enteraba de nada —`esMensajeSwift` false, cero campos
 * tokenizados, `parseMT700` null— y el crédito se iba al camino de la IA, que cuesta plata y
 * alucina, para leer un mensaje que es perfectamente estructurado.
 */
describe("normalizarSwiftDePdf — el mensaje viene en una sola línea", () => {
  const plano = MT710_CSU2025099.replace(/\s+/g, " ");

  it("sin normalizar, el parser determinista no reconoce nada", () => {
    expect(esMensajeSwift(plano), "si esto da true, el problema ya no existe y el test sobra").toBe(false);
    expect(tokenizarSwift(plano)).toHaveLength(0);
    expect(parseMT700(plano)).toBeNull();
  });

  it("normalizado, se parsea igual que el original", () => {
    const n = normalizarSwiftDePdf(plano);
    expect(esMensajeSwift(n)).toBe(true);
    const p = parseMT700(n);
    const original = parseMT700(MT710_CSU2025099)!;
    expect(p, "no parseó").not.toBeNull();
    expect(p!.lc.numero).toBe(original.lc.numero);
    expect(p!.lc.monto).toBe(original.lc.monto);
    expect(p!.lc.moneda).toBe(original.lc.moneda);
    expect(p!.lc.vencimiento).toBe(original.lc.vencimiento);
    expect(p!.lc.limiteEmbarque).toBe(original.lc.limiteEmbarque);
    expect((p!.lc.documentosExigidos ?? []).length, "los documentos del 46A tienen que salir todos, no uno").toBe(
      (original.lc.documentosExigidos ?? []).length,
    );
  });

  it("separa el NOMBRE del campo de su valor: sin eso el número de crédito sale con el título pegado", () => {
    const p = parseMT700(normalizarSwiftDePdf(plano))!;
    expect(p.lc.numero, "«Documentary Credit Number LCMRDN25000471» no es un número de crédito").not.toMatch(
      /Documentary|Credit Number/i,
    );
  });

  /*
   * Los renglones de ADENTRO de un campo también se recuperan.
   *
   * El 42A trae el librado en cuatro líneas —BIC, banco, sucursal, ciudad— y en el PDF eso queda
   * como una tirada de espacios. Importa porque la LETRA A LA VISTA copia ese campo **textual**,
   * sin el título, y tiene que salir en sus cuatro renglones: con los espacios pegados saldría
   * «CIBKCNBJ110             CHINA CITIC BANK…» impreso en un papel que se presenta al banco.
   */
  it("devuelve los renglones de adentro de un campo multilínea", () => {
    const multilinea = [
      "     52A: Issuing Bank - FI BIC",
      "          MRDNLKLXXXX",
      "          MERIDIAN BANK PLC",
      "          COLOMBO  LK",
      "      20: Sender's Reference",
      "          900114477-R",
      "      21: Documentary Credit Number",
      "          LCMRDN25000471",
    ].join("\n");
    const aplanado = multilinea.replace(/\n/g, "          ");
    const cs = tokenizarSwift(normalizarSwiftDePdf(aplanado));
    const banco = cs.find((c) => c.tag === "52A");
    expect(banco?.lineas, "las tres líneas del banco, no una sola con espacios").toEqual([
      "MRDNLKLXXXX",
      "MERIDIAN BANK PLC",
      "COLOMBO  LK",
    ]);
  });

  it("un mensaje que YA tiene sus renglones no se toca", () => {
    expect(normalizarSwiftDePdf(MT710_CSU2025099)).toBe(MT710_CSU2025099);
  });

  it("y un texto que no es un SWIFT tampoco", () => {
    const carta = "Estimados, adjuntamos el crédito recibido a vuestro favor. Saludos.";
    expect(normalizarSwiftDePdf(carta)).toBe(carta);
  });
});

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
  /*
   * El 46A en UNA sola línea: cómo llega cuando el crédito viene de un PDF.
   *
   * El banco avisa el crédito por mail y adjunta el SWIFT como PDF. Al extraer ese texto, los
   * saltos de línea no existen —lo que se ve como renglones es el renderizado— y el 46A entero
   * llega pegado. Separando solo por línea, los once documentos exigidos entraban como UNO.
   *
   * Y la forma de fallar es la peor posible: el motor tomaba el primer documento como el único
   * exigido y desestimaba el conocimiento de embarque y el packing list con «el crédito no lo
   * pide, así que no se examina». Veredicto: cero discrepancias sobre un paquete del que no miró
   * diez de los once papeles.
   */
  it("listaSwift: separa los ítems numerados aunque el campo venga en una sola línea", () => {
    const enUnaLinea = [
      "1. COMMERCIAL INVOICE ISSUED BY BENEFICIARY IN 3 ORIGINALS AND 3 COPIES. " +
        "2. FULL SET OF CLEAN ON BOARD BILL OF LADING IN 3 ORIGINALS, MARKED FREIGHT PREPAID. " +
        "3. PACKING LIST / WEIGHT MEMO ISSUED BY THE SHIPPER IN 3 ORIGINALS. " +
        "11. SHIPMENT NOTICE IN 1 COPY.",
    ];
    const l = listaSwift(enUnaLinea);
    expect(l.length, "once documentos en un solo ítem = el motor desestima diez").toBe(4);
    expect(l[1]).toMatch(/^FULL SET OF CLEAN ON BOARD BILL OF LADING/);
    expect(l[3]).toMatch(/^SHIPMENT NOTICE/);
  });

  it("listaSwift: pero no parte por un número que es parte del texto", () => {
    /* «NO.12,HARBOUR ROAD» y «DTD 04.03.2025» tienen dígitos con punto y no abren un ítem: sin
       esto, partir por numeración rompería direcciones y fechas. */
    const l = listaSwift([
      "1)PLEASE DESPATCH DOCUMENTS TO MERIDIAN BANK PLC, NO.12,HARBOUR ROAD, COLOMBO 03, SRI LANKA.",
      "2)GOODS SHIPPED AS PER PROFORMA INVOICE NO. 2025099 DTD 04.03.2025",
    ]);
    expect(l.length).toBe(2);
    expect(l[0]).toMatch(/NO\.12,HARBOUR ROAD/);
    expect(l[1]).toMatch(/04\.03\.2025$/);
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

describe("el beneficiario, que es quien cobra", () => {
  it("la primera línea del 59 es la razón social y el resto la dirección", () => {
    // La ficha del crédito mostraba «on file» en lugar del nombre porque el parser entregaba la
    // dirección y no la razón social, y la base no tenía dónde guardarla.
    const p = parseMT700(MT710_CSU2025099)!;
    expect(p.lc.beneficiario).toBe("CEREALSUR S.A");
    expect(p.lc.beneficiarioDireccion).toContain("CERRITO 820");
    expect(p.lc.beneficiarioDireccion).not.toContain("CEREALSUR");
  });
});

describe("el 31D trae fecha y lugar", () => {
  /*
   * Dónde vence el crédito decide si los documentos tienen que **llegar** allá o solo salir.
   *
   * Con el crédito del caso de referencia —«250630 URUGUAY»— los papeles se presentan en Montevideo. Con
   * «250630 COLOMBO» hay que sumarle el courier a Sri Lanka, tres a cinco días que nadie descuenta
   * hasta que es tarde. El campo existía en romai y se perdió al armar el motor: la regla que lo
   * usa es del beneficiario, que es quien manda los papeles.
   */
  it("el lugar sale del 31D, separado de la fecha", () => {
    expect(parseMT700(MT710_CSU2025099)?.extra.lugarVencimiento).toBe("URUGUAY");
  });

  it("y cuando el 31D solo trae la fecha, no se inventa un lugar", () => {
    const sinLugar = MT710_CSU2025099.replace("250630 URUGUAY", "250630");
    expect(parseMT700(sinLugar)?.extra.lugarVencimiento).toBeNull();
  });

  it("la fecha sigue leyéndose igual, con lugar o sin él", () => {
    expect(parseMT700(MT710_CSU2025099)?.lc.vencimiento).toBe("30-jun-25");
  });
});
