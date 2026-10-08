import { describe, expect, it } from "vitest";
import {
  aKg,
  CAMPOS_POR_TIPO,
  CAMPOS_SEGURO,
  type CamposDoc,
  cantidadDelCredito,
  claveDoc,
  compararDocumento,
  compararEntreDocumentos,
  cotejarLC,
  cotejarLCconOperacion,
  DOC_DEMO,
  LC_DEMO,
  normalizarCamposDoc,
  normConfianza,
  PROMPT_DOC,
  parseNumero,
  SCHEMA_DOC,
  schemaPara,
  TIPO_DOC_LABEL,
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

describe("el esquema que se le manda al modelo", () => {
  /**
   * El límite de la API no es la cantidad de campos: es la de **opcionales**. Con seis obligatorios
   * de veintitrés, los otros diecisiete se multiplican por dos —presente o ausente— y la gramática
   * explota: «Schemas contains too many optional parameters (46)». Medido contra la API de verdad.
   */
  it("**no deja ningún campo opcional**", () => {
    for (const campos of Object.values(CAMPOS_POR_TIPO)) {
      const s = schemaPara(campos);
      expect(s.required).toHaveLength(Object.keys(s.properties).length);
    }
  });

  it("ningún tipo se pasa de los veintitrés campos que la gramática admite", () => {
    // Treinta y seis, aun todos obligatorios, ya no entra. Este test es el que avisa si alguien
    // agrega un campo de más sin tener la clave de API a mano para probarlo.
    for (const [tipo, campos] of Object.entries(CAMPOS_POR_TIPO)) {
      expect(campos.length, `${tipo} tiene ${campos.length} campos`).toBeLessThanOrEqual(23);
    }
    expect(CAMPOS_SEGURO.length).toBeLessThanOrEqual(23);
  });

  it("a cada documento se le piden los campos que ese documento puede tener", () => {
    // Preguntarle a un conocimiento de embarque por el monto asegurado no solo agranda la gramática:
    // lo invita a inventar.
    expect(CAMPOS_POR_TIPO.BL).not.toContain("montoAsegurado");
    expect(CAMPOS_POR_TIPO.BL).toContain("onBoard");
    expect(CAMPOS_POR_TIPO.FACTURA).not.toContain("onBoard");
    expect(CAMPOS_POR_TIPO.FACTURA).toContain("precioUnitario");
    expect(CAMPOS_SEGURO).toContain("montoAsegurado");
  });

  it("todos los campos existen en CamposDoc", () => {
    const conocidos = new Set(Object.keys(DOC_DEMO));
    // DOC_DEMO no tiene todos, así que se compara contra el esquema completo.
    const delSchema = new Set(Object.keys(SCHEMA_DOC.properties));
    for (const campos of [...Object.values(CAMPOS_POR_TIPO), CAMPOS_SEGURO]) {
      for (const c of campos) {
        expect(delSchema.has(c) || conocidos.has(c), `${c} no está en el esquema`).toBe(true);
      }
    }
  });
});

describe("la lectura del modelo, puesta en forma", () => {
  /**
   * `normalizarCamposDoc` tenía veintidós campos escritos a mano mientras el esquema crecía a treinta
   * y seis. `onBoard`, `onDeck`, `clausulaDefecto` y `juegoOriginales` se leían del papel, se pedían
   * en el esquema, y esta función los tiraba: **las reglas de los artículos 26 y 27 nunca recibieron
   * un dato extraído**. Solo funcionaban con los fixtures escritos a mano, y así nadie lo notó hasta
   * leer un escaneo de verdad.
   */
  it("**ningún campo del esquema se pierde**", () => {
    const delEsquema = Object.keys(SCHEMA_DOC.properties);
    const normalizados = Object.keys(normalizarCamposDoc({}));
    for (const c of delEsquema) expect(normalizados, `falta ${c}`).toContain(c);
  });

  it("los campos de transporte que fundan los artículos 26 y 27 llegan", () => {
    const leido = normalizarCamposDoc({
      onDeck: { valor: "SHIPPED ON DECK", confianza: 0.9 },
      clausulaDefecto: { valor: "3 CARTONS TORN", confianza: 0.8 },
      juegoOriginales: { valor: "three (3) original Bills of Lading", confianza: 1 },
      buque: { valor: "STELLA AUSTRAL", confianza: 1 },
      onBoard: { valor: "SHIPPED ON BOARD 08-APR-2025", confianza: 1 },
    });
    expect(leido.onDeck?.valor).toBe("SHIPPED ON DECK");
    expect(leido.clausulaDefecto?.valor).toBe("3 CARTONS TORN");
    expect(leido.juegoOriginales?.valor).toContain("three");
    expect(leido.buque?.valor).toBe("STELLA AUSTRAL");
    expect(leido.onBoard?.valor).toContain("08-APR-2025");
  });

  it("y los del seguro también", () => {
    const leido = normalizarCamposDoc({
      montoAsegurado: { valor: "59.565,00", confianza: 0.95 },
      monedaAsegurada: { valor: "USD", confianza: 1 },
      tipoSeguro: { valor: "INSURANCE POLICY", confianza: 1 },
    });
    expect(leido.montoAsegurado?.valor).toBe("59.565,00");
    expect(leido.monedaAsegurada?.valor).toBe("USD");
    expect(leido.tipoSeguro?.valor).toBe("INSURANCE POLICY");
  });

  it("lo que el modelo no devuelve queda vacío con confianza cero, no ausente", () => {
    const leido = normalizarCamposDoc({ exportador: { valor: "MOLSUR SA", confianza: 1 } });
    expect(leido.onDeck).toEqual({ valor: "", confianza: 0 });
    // El silencio tiene que ser distinguible de un dato: confianza 0 es lo que las reglas miran.
    expect(leido.exportador.confianza).toBe(1);
  });

  it("una basura no rompe nada", () => {
    for (const basura of [null, undefined, 42, "texto", [], { exportador: "sin objeto" }]) {
      const leido = normalizarCamposDoc(basura);
      expect(leido.exportador).toEqual({ valor: "", confianza: 0 });
    }
  });
});

describe("un cero a la izquierda del separador no es un grupo de miles", () => {
  /*
   * Salió de pasar las 8.957 cantidades reales del ERP de un trader por el parser: 599 se leían mil
   * veces más grandes, todas con tres decimales. «7,861 TON» es genuinamente ambiguo —puede ser
   * siete mil ochocientas sesenta y una toneladas o siete coma ocho— y para eso está el
   * desambiguador, que lo resuelve con la aritmética del documento.
   *
   * Pero 464 de esos 599 empiezan con cero, y ahí no hay ambigüedad ninguna: nadie escribe «0» como
   * grupo de miles. «0,852» es cero coma ochocientos cincuenta y dos, y se leía como ochocientos
   * cincuenta y dos. Mil veces la carga de un camión.
   */
  it.each([
    ["0,852", 0.852],
    ["0,125", 0.125],
    ["0.852", 0.852],
    ["00,500", 0.5],
  ])("«%s» vale %s", (texto, esperado) => {
    expect(parseNumero(texto)).toBeCloseTo(esperado, 6);
  });

  it("con parte entera distinta de cero sigue siendo ambiguo, y no se adivina", () => {
    // El desambiguador lo resuelve con el total y el precio; el parser solo no puede.
    expect(parseNumero("7,861")).toBe(7861);
  });

  it("y lo que ya se leía bien no cambia", () => {
    expect(parseNumero("26.500")).toBe(26500);
    expect(parseNumero("292,66")).toBeCloseTo(292.66, 2);
    expect(parseNumero("1.234,5")).toBeCloseTo(1234.5, 2);
    expect(parseNumero("0")).toBe(0);
  });
});

describe("el incoterm de la LC viene con el lugar pegado", () => {
  /*
   * El 45A del crédito real dice «CFR COLOMBO,SRI LANKA INCOTERMS 2020», y el prompt de extracción
   * pide el valor tal cual aparece, así que eso es lo que llega. `cotejarLCconOperacion` lo comparaba
   * como texto completo contra el incoterm de la operación —«CFR»— y daba DIFERENTE siempre.
   *
   * La misma comparación en la matriz del mismo archivo usa `codigoIncoterm`, que extrae las tres
   * letras, y da OK. Dos funciones del mismo módulo contestando distinto sobre el mismo dato: salió
   * de cruzar los 91 puertos del ERP — 0 de 91 por una, 91 de 91 por la otra.
   */
  const req = {
    documentosExigidos: [],
    limiteEmbarque: { valor: "30-abr-25", confianza: 1 },
    vencimiento: { valor: "30-jun-25", confianza: 1 },
    plazoPresentacion: { valor: "21 días desde la fecha de embarque (campo 48)", confianza: 1 },
    toleranciaCantidad: { valor: "±10%", confianza: 1 },
    parcialesPermitidos: { valor: "ALLOWED", confianza: 1 },
  };
  const conIncoterm = (valor: string) => {
    const campos = { ...docBase(), incoterm: { valor, confianza: 1 } };
    const opCon = {
      ...op,
      incoterm: "CFR",
      legs: op.legs.map((l) => (l.tipo === "VENTA" ? { ...l, incoterm: "CFR" } : l)),
    };
    return cotejarLCconOperacion(req, campos, opCon as never).find((x) => x.campo === "Incoterm");
  };

  it.each(["CFR COLOMBO, SRI LANKA", "CFR COLOMBO,SRI LANKA INCOTERMS 2020", "CFR", "cfr colombo"])(
    "«%s» coincide con la operación en CFR",
    (texto) => {
      expect(conIncoterm(texto)?.estado).toBe("OK");
    },
  );

  it("pero un incoterm distinto sigue siendo distinto", () => {
    expect(conIncoterm("FOB MONTEVIDEO")?.estado).toBe("DIFERENTE");
  });
});

describe("qué documento pide una línea del 46A", () => {
  /*
   * `claveDoc` clasificaba por las palabras que la línea **menciona**, no por el documento que
   * pide, y la primera prueba era la factura. Eso daba el peor falso negativo que encontré:
   *
   *   «INSURANCE POLICY OR CERTIFICATE FOR 110 PCT OF INVOICE VALUE»
   *
   * —la fórmula estándar de cualquier crédito CIF— salía como FACTURA, así que la línea quedaba
   * cumplida con la factura presentada y **nadie exigía el seguro**. El banco pagaba un CIF sin
   * póliza, y en la pantalla esa línea del crédito se veía en verde.
   *
   * El arreglo: clasificar por la cabeza de la línea —el nombre del documento— y no por sus
   * cláusulas. Lo que viene después de «for», «covering», «certifying», «issued by» o «including»
   * describe el contenido, no el documento.
   */
  const CABEZA: [string, string][] = [
    ["+11)INSURANCE POLICY OR CERTIFICATE IN DUPLICATE FOR 110 PCT OF INVOICE VALUE COVERING ICC(A)", "SEGURO"],
    ["+13)CERTIFICATE OF ORIGIN ISSUED BY CHAMBER OF COMMERCE CERTIFYING THE INVOICE VALUE", "ORIGEN"],
    ["+5)WEIGHT NOTE IN 03 FOLD SHOWING THE INVOICE NUMBER", "PESO"],
    ["+8)CERTIFICATE OF ANALYSIS STATING THE INVOICE NUMBER", "ANALISIS"],
    ["+7)FUMIGATION CERTIFICATE INDICATING THE INVOICE DATE", "FUMIGACION"],
  ];

  it.each(CABEZA)("«%s» → %s", (linea, clave) => {
    expect(claveDoc(linea)).toBe(clave);
  });

  it("y la factura de verdad sigue siendo la factura", () => {
    // La línea +1 del crédito real, con su cláusula «INDICATING» detrás.
    expect(claveDoc("+1)SIGNED COMMERCIAL INVOICES IN 03 FOLD,INDICATING, I)FOB VALUE AND FREIGHT")).toBe("INVOICE");
  });

  it("y el conocimiento también, con la cláusula larga que trae el crédito real", () => {
    expect(
      claveDoc(
        "+2)FULL SET OF (3/3) SHIPPED ON BOARD ORIGINAL BILLS OF LADING PLUS 02 NON NEGOTIABLE COPIES ISSUED TO THE ORDER OF MERIDIAN BANK PLC",
      ),
    ).toBe("BL");
  });

  it("«original documents» no es un certificado de origen", () => {
    // `/origin/` sin límite de palabra: la «ORIGEN» salía de dentro de «ORIGINAL», y el
    // certificado del beneficiario perdía su propia regla.
    expect(claveDoc("+9)BENEFICIARY'S CERTIFICATE CONFIRMING ORIGINAL DOCUMENTS HAVE BEEN SENT")).toMatch(
      /^BENEFICIARIO/,
    );
  });

  it("pero el certificado de origen real sí lo es", () => {
    expect(claveDoc("+3)CERTIFICATE OF URUGUAY ORIGIN IN 02 FOLD")).toBe("ORIGEN");
  });

  it("los dos certificados del beneficiario son documentos distintos", () => {
    /*
     * Lo rompí al clasificar por la cabeza: el crédito real pide dos —uno por los gastos bancarios
     * y otro por los documentos enviados por correo— y los dos se llaman «BENEFICIARY'S
     * CERTIFICATE». Con la clave sacada de la cabeza quedaban siendo el mismo documento, así que
     * presentar uno daba por cumplidos los dos.
     */
    const a = claveDoc("+9)BENEFICIARY'S CERTIFICATE CONFIRMING ALL ADVISING BANK CHARGES OUTSIDE SRI LANKA SETTLED");
    const b = claveDoc("+10)BENEFICIARY'S CERTIFICATE CONFIRMING THAT A FULL SET OF COPY DOCUMENTS HAVE BEEN EMAILED");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^BENEFICIARIO/);
    expect(b).toMatch(/^BENEFICIARIO/);
  });
});

describe("la cantidad que el crédito pide, leída del 45A", () => {
  /*
   * El 45A es prosa y en la misma línea hay varios números que no son la cantidad: el crédito real
   * dice «57 MTS OF FISH MEAL 54PCT MIN (FOR ANIMAL FEED USE)» y más abajo «HS CODE NO.2301.20.00».
   * Tomar el 54 de la proteína o la posición arancelaria por la cantidad del embarque sería peor que
   * no mirar, así que la unidad se exige.
   */
  it("el 45A real", () => {
    expect(cantidadDelCredito("57 MTS OF FISH MEAL 54PCT MIN (FOR ANIMAL FEED USE)")).toEqual({
      valor: 57,
      unidad: "MTS",
    });
  });

  it("no confunde la proteína con la cantidad", () => {
    expect(cantidadDelCredito("FISH MEAL 54PCT MIN")).toBeNull();
  });

  it("ni la posición arancelaria", () => {
    expect(cantidadDelCredito("FISH MEAL. HS CODE NO.2301.20.00")).toBeNull();
  });

  it.each([
    ["25000 KGS OF SOY BEAN MEAL", 25000, "KGS"],
    ["1360 BAGS OF FISH MEAL", 1360, "BAGS"],
    ["120 CABEZAS DE GANADO EN PIE", 120, "CABEZAS"],
    ["54.040,00 KGS NET", 54040, "KGS"],
  ])("«%s»", (texto, valor, unidad) => {
    expect(cantidadDelCredito(texto)).toEqual({ valor, unidad });
  });

  it("sin descripción no se inventa nada", () => {
    expect(cantidadDelCredito("")).toBeNull();
    expect(cantidadDelCredito(null)).toBeNull();
  });
});

describe("la cantidad del 45A cuando el crédito describe el envase", () => {
  /*
   * `cantidadDelCredito` se quedaba con el **primer** número con unidad, y los créditos describen el
   * envase antes del total todo el tiempo: «PACKED IN 50 KG BAGS, TOTAL 57 MTS». Con eso el motor
   * comparaba la factura contra el peso de una bolsa y daba discrepancias de seis cifras sobre
   * facturas correctas — la misma clase de error de mil veces que este repo ya pagó con «53,960».
   *
   * Cuando hay más de una cantidad y no se puede decir cuál es el total, no se elige: el examen lo
   * dice. Elegir mal acá cuesta más que no decir nada.
   */
  it.each([
    ["FISH MEAL 54PCT MIN PACKED IN 50 KG BAGS, TOTAL 57 MTS", 57, "MTS"],
    ["FROZEN BEEF IN 25 KG CARTONS, TOTAL NET WEIGHT 25.000 KGS", 25000, "KGS"],
    ["57 MTS OF FISH MEAL PACKED IN BAGS OF 50 KG", 57, "MTS"],
    ["SOYBEAN MEAL IN BAGS OF 50 KGS NET EACH. QUANTITY: 1000 MT", 1000, "MT"],
  ])("«%s» → %s %s", (texto, valor, unidad) => {
    expect(cantidadDelCredito(texto)).toEqual({ valor, unidad });
  });

  it("y si hay dos cantidades y ninguna se anuncia como el total, no se elige", () => {
    // Dos ítems distintos: el crédito pide los dos y el motor no sabe cuál comparar.
    expect(cantidadDelCredito("500 MT OF SOYBEAN MEAL AND 300 MT OF SUNFLOWER MEAL")).toBeNull();
  });

  it("el 45A del crédito real sigue leyéndose igual", () => {
    expect(cantidadDelCredito("57 MTS OF FISH MEAL 54PCT MIN (FOR ANIMAL FEED USE)")).toEqual({
      valor: 57,
      unidad: "MTS",
    });
  });
});

/**
 * El documento de seguro es un tipo que el producto puede cargar, no solo uno que el motor sabe
 * examinar.
 *
 * El motor tenía las siete reglas del artículo 28 escritas y probadas desde el principio, y el ERP
 * no se las ejecutaba nunca: `examinarPresentacion` recibe el seguro por su propio parámetro y no
 * había forma de cargar una póliza, porque `TipoDocExterno` no la nombraba. Eso no se ve desde
 * adentro del motor —sus tests le pasan el seguro a mano— y por eso la red va acá: si alguien saca
 * `SEGURO` del tipo, el producto vuelve a quedarse sin poder cargarlo y este archivo lo dice.
 */
describe("el seguro es un documento que se puede cargar", () => {
  it("tiene etiqueta, campos propios y ninguna columna en la matriz", () => {
    expect(TIPO_DOC_LABEL.SEGURO, "sin etiqueta no hay botón que lo ofrezca").toBeTruthy();
    expect(CAMPOS_POR_TIPO.SEGURO, "sin campos, la extracción le pide el esquema de otro documento").toEqual(
      CAMPOS_SEGURO,
    );
    expect(CAMPOS_SEGURO).toContain("montoAsegurado");
    expect(CAMPOS_SEGURO).toContain("coberturaDesde");
    expect(CAMPOS_SEGURO).toContain("coberturaHasta");
  });

  it("no se compara como los cuatro de la matriz: se examina con el artículo 28", () => {
    /*
     * Pintar un seguro en la matriz daría cuatro columnas vacías —no tiene exportador ni cantidad
     * que cruzar contra la operación— y cuatro columnas vacías se leen como «no se pudo leer».
     */
    const r = compararDocumento(
      {
        tipoSeguro: { valor: "INSTITUTE CARGO CLAUSES (A)", confianza: 1 },
        montoAsegurado: { valor: "59.565,00", confianza: 1 },
      } as unknown as CamposDoc,
      op,
      { razonSocial: "CEREALSUR S.A.", direccion: "" } as never,
      "SEGURO",
    );
    for (const fila of r.matriz) {
      expect(
        [fila.lc?.valor, fila.invoice?.valor, fila.packing?.valor, fila.bl?.valor].every((v) => v == null),
        "el seguro aportó a una columna de la matriz: ahí no va",
      ).toBe(true);
    }
  });
});

/**
 * El prompt explica todos los campos que el esquema pide.
 *
 * Es el defecto que ya apareció dos veces en este expediente y las dos veces costó caro: el
 * esquema pide un campo, el prompt no lo explica, y el modelo lo llena por su cuenta. Con
 * `cantidad` y `unidad` eso dio 53.960.000 kg —mil veces la carga— sobre la factura real. Con los
 * campos del seguro daba fechas donde el motor espera lugares, y la regla del tramo cubierto salía
 * «a verificar» sobre pólizas correctas.
 *
 * No alcanza con que el campo aparezca en algún lado del prompt: tiene que estar explicado. Por eso
 * se exige que el nombre vaya seguido de un «=», que es como el prompt define cada uno.
 */
describe("el prompt no pide campos que no explica", () => {
  /**
   * La regla que ata la cantidad con su unidad no se puede perder.
   *
   * Ya se perdió una vez —una reescritura de historia se llevó el commit que la agregaba— y al
   * perderse el error volvió idéntico: la factura se leyó «53.960 MTS» donde el papel dice KGS, y
   * el motor la pasó a kilos como 53.960.000. Mil veces la carga, entrando en la comparación
   * contra el crédito como si fuera el papel.
   *
   * El test anterior no la cuidaba: `cantidad` y `unidad` están en la lista de campos obvios,
   * justamente porque se explican por el nombre. Lo que no se explica solo es que los dos tienen
   * que salir del mismo renglón, y eso vale un test propio.
   */
  it("la cantidad y su unidad salen del mismo renglón, y el prompt lo dice", () => {
    expect(PROMPT_DOC, "sin esto la factura se lee mil veces más grande").toMatch(/MISMO renglón/);
    expect(PROMPT_DOC, "falta el ejemplo que lo hace concreto").toMatch(/TOTAL NET WEIGHT/);
    expect(PROMPT_DOC, "falta decir qué pasa si no se puede atar: bajar la confianza").toMatch(/confianza a < 0\.6/);
  });

  it("cada campo del esquema de cada tipo está definido en PROMPT_DOC", () => {
    /*
     * Los que no necesitan definición, y por qué.
     *
     * Unos se explican solos —un puerto de embarque es un puerto de embarque— y otros están
     * definidos en prosa corrida en vez de con «campo = », como el consignatario. La lista es corta
     * a propósito: cada nombre que entra acá es una definición que alguien decidió no escribir.
     */
    const OBVIOS = new Set([
      "exportador",
      "importador",
      "cantidad",
      "unidad",
      "moneda",
      "montoTotal",
      "mercaderia",
      "puertoEmbarque",
      "puertoDestino",
      "incoterm",
      "numeroDoc",
      "consignatario",
    ]);
    const sinExplicar: string[] = [];
    for (const [tipo, campos] of Object.entries(CAMPOS_POR_TIPO)) {
      for (const campo of campos) {
        if (OBVIOS.has(campo as string)) continue;
        // el prompt define algunos de a pares: «montoAsegurado y monedaAsegurada = …»
        if (!new RegExp(`\\b${campo}( y \\w+)? = `).test(PROMPT_DOC)) sinExplicar.push(`${tipo}.${String(campo)}`);
      }
    }
    expect(
      sinExplicar,
      "el esquema los pide y el prompt no dice qué son: el modelo los va a llenar por su cuenta",
    ).toEqual([]);
  });
});
