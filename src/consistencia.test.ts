import { describe, expect, it } from "vitest";
import {
  aKg,
  type CamposDoc,
  compararDocumento,
  compararEntreDocumentos,
  cotejarLC,
  cotejarLCconOperacion,
  DOC_DEMO,
  LC_DEMO,
  normConfianza,
  parseNumero,
  type TipoDocExterno,
} from "./consistencia";
import { operationDetails } from "./mock";
import type { ChecklistRow, Empresa, MatrixRow } from "./types";

type Resultado = { matriz: MatrixRow[]; discrepancias: { titulo: string; severidad: string }[] };

const op = operationDetails["OP-2026-012"];
const empresa: Empresa = {
  razonSocial: "Oriental Trade S.A.",
  rut: "21 000000 0011",
  direccion: "Rambla 100",
  ciudad: "Montevideo",
  email: "ops@oriental.example",
  telefono: "+598 2 000 0000",
};

/** Parte de un documento "perfecto" y se van rompiendo campos por caso. */
function docBase(): CamposDoc {
  return {
    exportador: { valor: "Oriental Trade S.A.", confianza: 0.98 },
    importador: { valor: "Al Rashid Trading LLC", confianza: 0.97 },
    montoTotal: { valor: "259,200.00", confianza: 0.99 },
    moneda: { valor: "USD", confianza: 0.99 },
    cantidad: { valor: "54", confianza: 0.95 },
    unidad: { valor: "MT", confianza: 0.95 },
    mercaderia: { valor: "Cortes bovinos congelados s/hueso", confianza: 0.9 },
    puertoEmbarque: { valor: "Montevideo", confianza: 0.96 },
    puertoDestino: { valor: "Jebel Ali", confianza: 0.96 },
    fechaEmbarque: { valor: "", confianza: 0 },
    incoterm: { valor: "FOB", confianza: 0.9 },
    numeroDoc: { valor: "INV-1", confianza: 0.99 },
  };
}

const fila = (r: Resultado, campo: string) => r.matriz.find((m) => m.campo.startsWith(campo.split(" ")[0]));

describe("aKg — B6: sin unidad reconocida NO adivina", () => {
  it("convierte KG, MT/TON y LB", () => {
    expect(aKg(253000, "KG")).toBe(253000);
    expect(aKg(253, "MT")).toBe(253000);
    expect(aKg(253, "253 toneladas")).toBe(253000);
    expect(aKg(1000, "lbs")).toBeCloseTo(453.592);
  });
  it("unidad cruda del ERP (U1, U3) o vacía → null, nunca 'como si fuera KG'", () => {
    expect(aKg(6990, "U3")).toBeNull();
    expect(aKg(159000, "6.990 U1")).toBeNull();
    expect(aKg(54, "")).toBeNull();
    expect(aKg(54, "cajas")).toBeNull();
  });
});

describe("parseNumero — tolerante a locales", () => {
  it("es-UY con miles y decimales", () => expect(parseNumero("USD 259.200,00")).toBe(259200));
  it("en-US con miles y decimales", () => expect(parseNumero("259,200.00")).toBe(259200));
  it("miles con punto sin decimales", () => expect(parseNumero("4.950")).toBe(4950));
  it("número con unidad", () => expect(parseNumero("56,7 MT")).toBe(56.7));
  it("vacío → null", () => expect(parseNumero("s/d")).toBeNull());
});

describe("compararDocumento", () => {
  it("un documento consistente no levanta discrepancias", () => {
    const r = compararDocumento(docBase(), op, empresa, "FACTURA");
    expect(r.discrepancias).toHaveLength(0);
    expect(fila(r, "Monto")?.estado).toBe("OK");
  });

  it('reconoce "S.A." y "Sociedad Anónima" como la misma entidad → OK (sin falso positivo)', () => {
    const d = docBase();
    d.exportador = { valor: "Oriental Trade Sociedad Anónima", confianza: 0.95 };
    const r = compararDocumento(d, op, empresa, "FACTURA");
    expect(fila(r, "Beneficiario")?.estado).toBe("OK");
    expect(r.discrepancias.find((x) => x.titulo.startsWith("Beneficiario"))).toBeUndefined();
  });

  it("razón social realmente distinta → DISCREPANCIA", () => {
    const d = docBase();
    d.exportador = { valor: "Oriental Grains Co.", confianza: 0.95 };
    const r = compararDocumento(d, op, empresa, "FACTURA");
    expect(fila(r, "Beneficiario")?.estado).toBe("DISCREPANCIA");
  });

  it("cantidad dentro de ±5% → TOLERANCIA", () => {
    const d = docBase();
    d.cantidad = { valor: "56.7", confianza: 0.95 }; // +5% de 54
    const r = compararDocumento(d, op, empresa, "FACTURA");
    expect(fila(r, "Cantidad")?.estado).toBe("TOLERANCIA");
    expect(r.discrepancias).toHaveLength(0);
  });

  it("Etapa 2: rige la tolerancia REAL de la LC, no el ±5 % fijo", () => {
    const d = docBase();
    d.cantidad = { valor: "58.3", confianza: 0.95 }; // +8 % de 54
    // sin tolerancia en la LC → ±5 % habitual → discrepancia
    expect(fila(compararDocumento(d, op, empresa, "FACTURA"), "Cantidad")?.estado).toBe("DISCREPANCIA");
    // LC con ±10 % ("about") → dentro de tolerancia
    const conLC = { ...op, lc: { ...op.lc!, tolerancia: 0.1 } };
    expect(fila(compararDocumento(d, conLC, empresa, "FACTURA"), "Cantidad")?.estado).toBe("TOLERANCIA");
    // LC sin tolerancia (0) → hasta el +5 % habitual es discrepancia
    const exacta = { ...op, lc: { ...op.lc!, tolerancia: 0 } };
    d.cantidad = { valor: "56.7", confianza: 0.95 };
    expect(fila(compararDocumento(d, exacta, empresa, "FACTURA"), "Cantidad")?.estado).toBe("DISCREPANCIA");
  });

  it("monto fuera de tolerancia → DISCREPANCIA (ALTA)", () => {
    const d = docBase();
    d.montoTotal = { valor: "300,000.00", confianza: 0.99 };
    const r = compararDocumento(d, op, empresa, "FACTURA");
    expect(fila(r, "Monto")?.estado).toBe("DISCREPANCIA");
    const disc = r.discrepancias.find((x) => x.titulo.startsWith("Monto"));
    expect(disc?.severidad).toBe("ALTA");
  });

  it("LC con embarque de la op posterior al límite → CRÍTICO", () => {
    const d = docBase();
    // la op embarca 18-ago; la LC limita a 15-ago
    d.fechaEmbarque = { valor: "15-ago-26", confianza: 0.95 };
    const r = compararDocumento(d, op, empresa, "LC");
    const f = fila(r, "Fecha");
    expect(f?.estado).toBe("CRITICO");
    expect(r.discrepancias.some((x) => x.severidad === "CRITICA")).toBe(true);
  });

  it("cantidad en KG vs operación en MT: convierte antes de comparar (gotcha TON/KG)", () => {
    const d = docBase();
    d.cantidad = { valor: "54000", confianza: 0.95 };
    d.unidad = { valor: "KG", confianza: 0.95 };
    const r = compararDocumento(d, op, empresa, "FACTURA");
    expect(fila(r, "Cantidad")?.estado).toBe("OK"); // 54.000 KG ≡ 54 MT
  });

  it('cantidad "253.000 KG" no es un falso positivo contra 54 MT', () => {
    const d = docBase();
    d.cantidad = { valor: "253,000 KG", confianza: 0.95 };
    d.unidad = { valor: "KG", confianza: 0.95 };
    const r = compararDocumento(d, op, empresa, "FACTURA");
    // 253 MT vs 54 MT sí es una discrepancia real (no un artefacto de unidades)
    expect(fila(r, "Cantidad")?.estado).toBe("DISCREPANCIA");
  });

  it("la celda del documento lleva la confianza de extracción (RF-2.2)", () => {
    const d = docBase();
    d.mercaderia = { valor: "Beef cuts", confianza: 0.5 };
    const r = compararDocumento(d, op, empresa, "FACTURA");
    expect(fila(r, "Mercadería")?.invoice.confianza).toBe(0.5);
  });

  it("mercadería en otro idioma no es discrepancia (comparación suave)", () => {
    const d = docBase();
    d.mercaderia = { valor: "Frozen boneless beef cuts (forequarter), halal", confianza: 0.9 };
    const r = compararDocumento(d, op, empresa, "FACTURA");
    expect(fila(r, "Mercadería")?.estado).toBe("INFO");
    expect(r.discrepancias.find((x) => x.titulo.startsWith("Mercadería"))).toBeUndefined();
  });

  it("campo con confianza baja (<0.4) NO se compara: queda como INFO visible, sin discrepancia", () => {
    const d = docBase();
    d.montoTotal = { valor: "999,999.00", confianza: 0.2 };
    const r = compararDocumento(d, op, empresa, "FACTURA");
    expect(fila(r, "Monto")?.estado).toBe("INFO");
    expect(r.discrepancias.some((x) => /Monto/.test(x.titulo))).toBe(false);
  });

  it("la columna que se llena depende del tipo de documento", () => {
    const r = compararDocumento(docBase(), op, empresa, "FACTURA");
    const monto = fila(r, "Monto");
    expect(monto?.invoice.valor).toBe("259,200.00");
    expect(monto?.lc.valor).toBeNull();
  });

  it("el demo: cantidad al borde (TOLERANCIA) + monto trastocado (DISCREPANCIA)", () => {
    const r = compararDocumento(DOC_DEMO, op, empresa, "FACTURA");
    expect(fila(r, "Beneficiario")?.estado).toBe("OK"); // Sociedad Anónima ≡ S.A.
    expect(fila(r, "Cantidad")?.estado).toBe("TOLERANCIA");
    expect(fila(r, "Monto")?.estado).toBe("DISCREPANCIA");
    expect(r.discrepancias.some((x) => x.severidad === "ALTA")).toBe(true);
  });
});

describe("re-auditoría 8-sep — bordes que daban veredictos falsos", () => {
  const empresa: Empresa = {
    razonSocial: "Oriental Trade S.A.",
    rut: "1",
    direccion: "",
    ciudad: "",
    email: "",
    telefono: "",
  };
  const opSinMonto = {
    ...operationDetails["OP-2026-012"],
    legs: operationDetails["OP-2026-012"].legs.map((l) => ({ ...l, montoTotal: null })),
  };

  it("C-1: la operación SIN monto (histórico del ERP) no da discrepancia de monto — informa", () => {
    const { matriz, discrepancias } = compararDocumento(
      { ...DOC_DEMO, montoTotal: { valor: "295,200.00", confianza: 0.99 } },
      opSinMonto,
      empresa,
      "FACTURA",
    );
    const fila = matriz.find((r) => r.campo === "Monto")!;
    expect(fila.estado).toBe("INFO");
    expect(fila.operacion.valor).toMatch(/sin cargar/);
    expect(discrepancias.some((d) => /Monto/.test(d.titulo))).toBe(false);
  });

  it("datos-14: un campo con confianza < 0,4 aparece como INFO 'sin comparar' — no desaparece", () => {
    const { matriz } = compararDocumento(
      { ...DOC_DEMO, importador: { valor: "Alguien", confianza: 0.2 } },
      operationDetails["OP-2026-012"],
      empresa,
      "FACTURA",
    );
    const fila = matriz.find((r) => r.campo === "Comprador / importador")!;
    expect(fila.estado).toBe("INFO");
    expect(fila.invoice.valor).toMatch(/baja confianza/);
  });

  it("datos-12: la unidad pegada al número se reconoce", () => {
    expect(aKg(25000, "25000KG")).toBe(25000);
    expect(aKg(54, "54MT")).toBe(54000);
    expect(aKg(27, "27 TN")).toBe(27000);
    expect(aKg(1, "1 mtx")).toBeNull(); // no inventa: "mtx" no es una unidad
  });

  it("datos-13: parseNumero conserva el signo (nota de crédito, formato contable)", () => {
    expect(parseNumero("-500")).toBe(-500);
    expect(parseNumero("USD -1.200,00")).toBe(-1200);
    expect(parseNumero("(1.200,00)")).toBe(-1200);
    expect(parseNumero("259.200,00")).toBe(259200);
  });

  it("M-4: confianza en porcentaje (95) no es certeza 1.0; fuera de rango se clampa", () => {
    expect(normConfianza(95)).toBeCloseTo(0.95);
    expect(normConfianza(1)).toBe(1);
    expect(normConfianza(0.42)).toBe(0.42);
    expect(normConfianza(150)).toBe(1);
    expect(normConfianza(-3)).toBe(0);
    expect(normConfianza("alta")).toBe(0);
  });
});

describe("cotejarLC — RF-2.4", () => {
  const checklist: ChecklistRow[] = [
    { label: "Factura comercial", estado: "PENDIENTE" },
    { label: "Packing list", estado: "PENDIENTE" },
    { label: "Conocimiento de embarque (BL)", estado: "PENDIENTE" },
    { label: "Certificado sanitario oficial — MGAP·DGSG", estado: "PENDIENTE" },
    { label: "Certificado halal", estado: "PENDIENTE" },
  ];

  it("matchea documentos EN de la LC con labels ES del checklist", () => {
    const r = cotejarLC(["Signed commercial invoice", "Full set bill of lading", "Health certificate"], checklist);
    expect(r.faltantes).toHaveLength(0);
    expect(r.cubiertos.map((c) => c.label)).toContain("Factura comercial");
    expect(r.cubiertos.map((c) => c.label)).toContain("Conocimiento de embarque (BL)");
  });

  it("detecta un documento que la LC exige y el checklist no tiene", () => {
    const r = cotejarLC(["Commercial invoice", "Certificate of origin"], checklist);
    expect(r.faltantes).toEqual(["Certificate of origin"]);
  });

  it("el demo de LC exige un certificado de origen que falta en el checklist", () => {
    const r = cotejarLC(LC_DEMO.documentosExigidos, checklist);
    expect(r.faltantes.some((f) => /origin|origen/i.test(f))).toBe(true);
  });
});

describe("cotejarLCconOperacion — la LC contra lo cargado (caso CSU2025099)", () => {
  // la LC real dice 21 días, ±10 %, vence 30-jun-25, último embarque 30-abr-25, USD 54.150
  const req = {
    documentosExigidos: [],
    limiteEmbarque: { valor: "30-abr-25", confianza: 1 },
    vencimiento: { valor: "30-jun-25", confianza: 1 },
    plazoPresentacion: { valor: "21 días desde la fecha de embarque (campo 48)", confianza: 1 },
    toleranciaCantidad: { valor: "±10%", confianza: 1 },
    parcialesPermitidos: { valor: "ALLOWED", confianza: 1 },
  };
  const campos = {
    ...docBase(),
    numeroDoc: { valor: "LCMRDN25000471", confianza: 1 },
    montoTotal: { valor: "54150", confianza: 1 },
    incoterm: { valor: "CFR", confianza: 1 },
  };
  const opCon = {
    ...op,
    incoterm: "CFR",
    legs: op.legs.map((l) => (l.tipo === "VENTA" ? { ...l, montoTotal: 51262, incoterm: "CFR" } : l)),
    // lo que tipeó el operador desde la PROFORMA: 30 días, sin tolerancia (→ ±5 % por defecto)
    lc: {
      numero: "LCMRDN25000471",
      bancoEmisor: "Meridian",
      bancoAvisador: "Litoral",
      vencimiento: "30-jun-25",
      limiteEmbarque: "30-abr-25",
      plazoPresentacion: "30 días desde el BL",
      tolerancia: null,
    },
  };
  it("marca lo que difiere (plazo 30 vs 21, tolerancia 5 vs 10) y lo que coincide", () => {
    const d = cotejarLCconOperacion(req, campos, opCon);
    const por = Object.fromEntries(d.map((x) => [x.campo, x]));
    expect(por["Número de la LC"].estado).toBe("OK");
    expect(por["Vencimiento"].estado).toBe("OK");
    expect(por["Último embarque"].estado).toBe("OK");
    expect(por["Plazo de presentación"]).toMatchObject({
      estado: "DIFERENTE",
      tomar: { plazoPresentacion: "21 días desde la fecha de embarque (campo 48)" },
    });
    expect(por["Tolerancia"]).toMatchObject({
      estado: "DIFERENTE",
      operacion: "±5 % (por defecto)",
      lc: "±10 %",
      tomar: { tolerancia: 0.1 },
    });
    expect(por["Monto"].estado).toBe("OK"); // la venta (51.262) entra en la LC (54.150)
    expect(por["Incoterm"].estado).toBe("OK");
  });
  it("sin LC cargada todo es SIN_DATO con qué tomar; una venta mayor que la LC + tolerancia difiere", () => {
    const sinLC = {
      ...opCon,
      lc: null,
      legs: opCon.legs.map((l) => (l.tipo === "VENTA" ? { ...l, montoTotal: 60000 } : l)),
    };
    const d = cotejarLCconOperacion(req, campos, sinLC);
    expect(d.filter((x) => x.estado === "SIN_DATO").map((x) => x.campo)).toEqual(
      expect.arrayContaining([
        "Número de la LC",
        "Vencimiento",
        "Último embarque",
        "Plazo de presentación",
        "Tolerancia",
      ]),
    );
    expect(d.find((x) => x.campo === "Monto")).toMatchObject({ estado: "DIFERENTE" }); // 60.000 > 54.150 × 1,10
  });
});

describe("BL como documento externo (caso CSU2025099)", () => {
  // el BL real: shipper MOLSUR (el productor), consignee a la orden del Meridian Bank, a bordo 08-abr-25
  const opLC = {
    ...op,
    legs: op.legs.map((l) => (l.tipo === "COMPRA" ? { ...l, contraparte: "MOLSUR S.A." } : l)),
    lc: { ...op.lc!, bancoEmisor: "MERIDIAN BANK PLC", limiteEmbarque: "30-abr-25" },
  };
  const bl = (): CamposDoc => ({
    ...docBase(),
    exportador: { valor: "MOLSUR SA", confianza: 0.95 },
    importador: { valor: "Al Rashid Trading LLC", confianza: 0.9 },
    consignatario: { valor: "TO THE ORDER OF MERIDIAN BANK PLC", confianza: 0.95 },
    montoTotal: { valor: "", confianza: 0 },
    fechaEmbarque: { valor: "08-abr-25", confianza: 0.95 },
    bultos: { valor: "1360", confianza: 0.9 },
    tipoBulto: { valor: "CARTONS", confianza: 0.9 },
    pesoBruto: { valor: "54040.000 KGS", confianza: 0.9 },
    numeroDoc: { valor: "MVD0990117", confianza: 0.99 },
  });
  it("el shipper es el productor → EQUIV con la explicación (documento de terceros), no discrepancia", () => {
    const r = compararDocumento(bl(), opLC, empresa, "BL");
    const f = r.matriz.find((m) => m.campo === "Shipper")!;
    expect(f.estado).toBe("EQUIV");
    expect(f.bl?.valor).toContain("lo emite el productor");
    expect(r.discrepancias.some((d) => d.titulo.startsWith("Shipper"))).toBe(false);
  });
  it("consignee a la orden del banco emisor de la LC → OK; otro banco → discrepancia", () => {
    expect(compararDocumento(bl(), opLC, empresa, "BL").matriz.find((m) => m.campo === "Consignatario")?.estado).toBe(
      "OK",
    );
    const otro = bl();
    otro.consignatario = { valor: "TO THE ORDER OF HSBC", confianza: 0.95 };
    expect(compararDocumento(otro, opLC, empresa, "BL").matriz.find((m) => m.campo === "Consignatario")?.estado).toBe(
      "DISCREPANCIA",
    );
  });
  it("fecha a bordo dentro del último embarque de la LC → OK; después → CRÍTICO", () => {
    expect(
      compararDocumento(bl(), opLC, empresa, "BL").matriz.find((m) => m.campo.startsWith("Fecha a bordo"))?.estado,
    ).toBe("OK");
    const tarde = bl();
    tarde.fechaEmbarque = { valor: "02-may-25", confianza: 0.95 };
    const r = compararDocumento(tarde, opLC, empresa, "BL");
    expect(r.matriz.find((m) => m.campo.startsWith("Fecha a bordo"))?.estado).toBe("CRITICO");
    expect(r.discrepancias[0].titulo).toContain("a bordo después del último embarque");
  });
  it("bultos y peso bruto: informativos sin contenedores; contra los contenedores cargados comparan", () => {
    const sin = compararDocumento(bl(), opLC, empresa, "BL");
    expect(sin.matriz.find((m) => m.campo === "Bultos")).toMatchObject({ estado: "INFO" });
    const con = {
      ...opLC,
      contenedores: [
        {
          numero: "DEMU4100371",
          precinto: "P1180119",
          tipo: "40HC",
          bultos: 680,
          tipoBulto: "bags",
          pesoNetoKg: 27310,
          pesoBrutoKg: 27350,
          lotes: null,
          produccionDesde: null,
          produccionHasta: null,
          vencimiento: null,
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
    };
    const r = compararDocumento(bl(), con, empresa, "BL");
    expect(r.matriz.find((m) => m.campo === "Bultos")?.estado).toBe("OK"); // 1.360
    expect(r.matriz.find((m) => m.campo === "Peso bruto")?.estado).toBe("OK"); // 54.040 kg
    expect(r.matriz.find((m) => m.campo === "Bultos")?.bl?.valor).toBe("1360 CARTONS");
  });
});

describe("compararEntreDocumentos — el BL dice cartons, el packing bags (caso CSU2025099)", () => {
  const blC = {
    ...docBase(),
    bultos: { valor: "1360", confianza: 0.9 },
    tipoBulto: { valor: "CARTONS", confianza: 0.9 },
    pesoBruto: { valor: "54040.000 KGS", confianza: 0.9 },
  };
  const pl = {
    ...docBase(),
    bultos: { valor: "1.360", confianza: 0.9 },
    tipoBulto: { valor: "Bags", confianza: 0.9 },
    pesoBruto: { valor: "54.040,00 Kgs", confianza: 0.9 },
  };
  it("levanta la contradicción de tipo de bulto y nada más (bultos y peso coinciden)", () => {
    const c = compararEntreDocumentos([
      { tipo: "BL", campos: blC },
      { tipo: "PACKING", campos: pl },
    ]);
    expect(c.map((x) => x.campo)).toEqual(["Tipo de bulto"]);
    expect(c[0].severidad).toBe("ALTA");
    expect(c[0].titulo).toContain('bill of lading dice "CARTONS"');
    expect(c[0].titulo).toContain('packing list dice "Bags"');
  });
  it("cantidad se cruza EN KILOS y la LC no entra en el cruce de shipper (revisión 8-sep)", () => {
    const lc = {
      ...docBase(),
      exportador: { valor: "Oriental Trade S.A.", confianza: 1 },
      cantidad: { valor: "57", confianza: 1 },
      unidad: { valor: "MTS", confianza: 1 },
    };
    const pk = {
      ...docBase(),
      exportador: { valor: "MOLSUR S.A.", confianza: 0.95 },
      cantidad: { valor: "57.000", confianza: 0.9 },
      unidad: { valor: "KGS", confianza: 0.9 },
    };
    expect(
      compararEntreDocumentos([
        { tipo: "LC", campos: lc },
        { tipo: "PACKING", campos: pk },
      ]),
    ).toEqual([]);
    // dos versiones del mismo tipo: solo cuenta la primera (la más nueva)
    const pkViejo = { ...pk, tipoBulto: { valor: "cartons", confianza: 0.9 } };
    const pkNuevo = { ...pk, tipoBulto: { valor: "bags", confianza: 0.9 } };
    const bl = {
      ...docBase(),
      exportador: { valor: "MOLSUR SA", confianza: 0.95 },
      tipoBulto: { valor: "bags", confianza: 0.9 },
      cantidad: { valor: "57", confianza: 0.9 },
      unidad: { valor: "MTS", confianza: 0.9 },
    };
    expect(
      compararEntreDocumentos([
        { tipo: "PACKING", campos: pkNuevo },
        { tipo: "PACKING", campos: pkViejo },
        { tipo: "BL", campos: bl },
      ]),
    ).toEqual([]);
  });

  it("con un solo documento o sin datos no hay cruce; shipper productor vs beneficiario es MEDIA", () => {
    expect(compararEntreDocumentos([{ tipo: "BL", campos: blC }])).toEqual([]);
    const fac = { ...docBase(), exportador: { valor: "Oriental Trade S.A.", confianza: 0.99 } };
    const blY = {
      ...blC,
      tipoBulto: { valor: "bags", confianza: 0.9 },
      exportador: { valor: "MOLSUR S.A.", confianza: 0.95 },
    };
    const c = compararEntreDocumentos([
      { tipo: "FACTURA", campos: fac },
      { tipo: "BL", campos: blY },
    ]);
    expect(c.map((x) => [x.campo, x.severidad])).toEqual([["Exportador / shipper", "MEDIA"]]);
  });
});

describe("D4: el HS code de la LC contra el de cada documento", () => {
  const opHs = {
    ...op,
    lc: {
      ...(op.lc ?? {
        numero: "LC1",
        bancoEmisor: "B",
        bancoAvisador: "A",
        vencimiento: "30-jun-25",
        limiteEmbarque: "30-abr-25",
        plazoPresentacion: "21 días",
      }),
      hsCode: "2301.20.00",
    },
  };
  const con = (hs: string) =>
    compararDocumento({ ...DOC_DEMO, hsCode: { valor: hs, confianza: 0.9 } }, opHs, empresa, "FACTURA").matriz.find(
      (r) => r.campo === "HS code",
    );
  it("mismos dígitos con o sin puntos → OK/EQUIV; 6 dígitos comunes alcanzan; otra partida → DISCREPANCIA", () => {
    expect(con("2301.20.00")?.estado).toBe("OK");
    expect(con("23012000")?.estado).toBe("OK");
    expect(con("2301.20")?.estado).toBe("EQUIV");
    expect(con("2309.90.90")?.estado).toBe("DISCREPANCIA");
  });
  it("y entre documentos: BL con otra partida que el packing → cruce ALTA", () => {
    const c = compararEntreDocumentos([
      { tipo: "PACKING", campos: { ...DOC_DEMO, hsCode: { valor: "2301.20.00", confianza: 0.9 } } },
      { tipo: "BL", campos: { ...DOC_DEMO, hsCode: { valor: "230990", confianza: 0.9 } } },
    ]);
    expect(c.find((x) => x.campo === "HS code")).toMatchObject({ severidad: "ALTA" });
  });
});

describe("cantidades que no se miden en kilos", () => {
  /**
   * Del catálogo de unidades del ERP del trader: además de KILOGRAMS y TONES hay **CABEZAS**,
   * **CONTENEDORES**, **LITRES** y **UNIT**. El motor solo comparaba cantidades que pudiera pasar a
   * kilos, así que «120 CABEZAS» en la factura y «118 CABEZAS» en el packing **no se marcaban**: un
   * falso negativo en una operación de ganado en pie, que es algo que este trader vende.
   *
   * Cuando la unidad es la misma en los dos documentos, los números se comparan tal cual. Cuando son
   * unidades distintas y no convertibles —cabezas contra kilos— no se dice nada: son magnitudes
   * distintas y puede ser correcto.
   */
  /** Un documento con solo la cantidad y la unidad cargadas. */
  const doc = (tipo: TipoDocExterno, cantidad: string, unidad: string) => ({
    tipo,
    campos: {
      cantidad: { valor: cantidad, confianza: 1 },
      unidad: { valor: unidad, confianza: 1 },
    } as unknown as CamposDoc,
  });

  const hayCantidadDistinta = (a: ReturnType<typeof doc>, b: ReturnType<typeof doc>) =>
    compararEntreDocumentos([a, b] as never).some((d) => d.campo === "Cantidad");

  it("**120 cabezas contra 118 cabezas se marca**", () => {
    expect(hayCantidadDistinta(doc("FACTURA", "120", "CABEZAS"), doc("PACKING", "118", "CABEZAS"))).toBe(true);
  });

  it("y 120 contra 120 no molesta a nadie", () => {
    expect(hayCantidadDistinta(doc("FACTURA", "120", "CABEZAS"), doc("PACKING", "120", "CABEZAS"))).toBe(false);
  });

  it("los sinónimos del ERP son la misma unidad", () => {
    // CAB y CABEZAS, CNRS y CONTENEDORES, LTS y LITRES: el mismo campo escrito de dos formas.
    expect(hayCantidadDistinta(doc("FACTURA", "120", "CABEZAS"), doc("PACKING", "120", "CAB"))).toBe(false);
    expect(hayCantidadDistinta(doc("FACTURA", "3", "CNRS"), doc("PACKING", "3", "CONTENEDORES"))).toBe(false);
    expect(hayCantidadDistinta(doc("FACTURA", "24000", "LTS"), doc("PACKING", "24000", "LITRES"))).toBe(false);
  });

  it("y con distinto número también se marcan", () => {
    expect(hayCantidadDistinta(doc("FACTURA", "3", "CNRS"), doc("PACKING", "4", "CONTENEDORES"))).toBe(true);
  });

  it("unidades que no se pueden comparar entre sí no inventan un hallazgo", () => {
    // 120 cabezas y 53.960 kilos pueden ser la misma carga: son magnitudes distintas.
    expect(hayCantidadDistinta(doc("FACTURA", "120", "CABEZAS"), doc("PACKING", "53960", "KGS"))).toBe(false);
  });

  it("lo de siempre sigue igual: kilos contra toneladas se compara convertido", () => {
    expect(hayCantidadDistinta(doc("FACTURA", "53960", "KGS"), doc("PACKING", "53,96", "TON"))).toBe(false);
    expect(hayCantidadDistinta(doc("FACTURA", "53960", "KGS"), doc("PACKING", "48", "TON"))).toBe(true);
  });
});
