import { describe, expect, it } from "vitest";
import { alertasDeRecordatorios, generarAlertasDeOperacion, ordenarAlertas, proximoHito } from "./alertas";
import { fmtFecha } from "./fechas";
import type { GlobalAlert, LcInfo, OperationDetail, Recordatorio } from "./types";

const HOY = new Date(2026, 6, 20); // 20-jul-26

const LC: LcInfo = {
  numero: "ECB-889174",
  bancoEmisor: "Emirates Commercial Bank",
  bancoAvisador: "BROU",
  vencimiento: "05-sep-26",
  limiteEmbarque: "15-ago-26",
  plazoPresentacion: "21 días desde fecha de BL",
};

/** Ficha mínima válida; cada test pisa solo lo que su regla mira. */
function op(partes: Partial<OperationDetail> = {}): OperationDetail {
  return {
    codigo: "OP-2026-099",
    mercaderia: "Cortes bovinos · 54 MT",
    cliente: "Al Rashid Trading",
    clientePais: "AE",
    incoterm: "FOB",
    estado: "DOCS_EN_PREPARACION",
    alertas: 0,
    fechaEmbarque: null,
    montoVenta: null,
    tieneDetalle: true,
    descripcionLarga: "",
    ruta: "",
    moneda: "USD",
    legs: [],
    items: [],
    lc: null,
    resumenEjecutivo: "",
    resumenGeneradoEn: "",
    hitos: [],
    documentos: [],
    checklist: [],
    matriz: [],
    matrizCorridaEn: "",
    discrepancias: [],
    ...partes,
  };
}

describe("generarAlertasDeOperacion", () => {
  it("embarque estimado posterior al límite de la LC → CRITICA", () => {
    const alertas = generarAlertasDeOperacion(op({ fechaEmbarque: "18-ago-26", lc: LC }), HOY);
    expect(alertas).toContainEqual(
      expect.objectContaining({
        severidad: "CRITICA",
        operacion: "OP-2026-099",
        titulo: "Embarque estimado (18-ago) posterior al límite de la LC (15-ago)",
      }),
    );
  });

  it("si la matriz ya levantó la discrepancia del límite, la regla de fechas no duplica", () => {
    const alertas = generarAlertasDeOperacion(
      op({
        fechaEmbarque: "18-ago-26",
        lc: LC,
        discrepancias: [
          {
            id: "d1",
            severidad: "CRITICA",
            titulo: "Embarque estimado posterior al límite de la LC",
            detalle: "Adelantar el booking o pedir enmienda.",
            acciones: [{ label: "Pedir enmienda de LC", resultado: "correo" }],
          },
        ],
      }),
      HOY,
    );
    expect(alertas.filter((a) => a.titulo.includes("límite de la LC"))).toHaveLength(1);
  });

  it("embarque dentro del límite (o sin LC) → sin alerta de límite", () => {
    const dentro = generarAlertasDeOperacion(op({ fechaEmbarque: "10-ago-26", lc: LC }), HOY);
    expect(dentro.filter((a) => a.severidad === "CRITICA")).toHaveLength(0);
    const sinLc = generarAlertasDeOperacion(op({ fechaEmbarque: "18-ago-26", lc: null }), HOY);
    expect(sinLc.filter((a) => a.severidad === "CRITICA")).toHaveLength(0);
  });

  it("las discrepancias abiertas de la matriz son alertas — resolverlas las baja", () => {
    const conDos = generarAlertasDeOperacion(
      op({
        discrepancias: [
          {
            id: "d1",
            severidad: "ALTA",
            titulo: "Razón social difiere entre LC y invoice",
            detalle: "Corregir el draft.",
            acciones: [],
          },
          {
            id: "d2",
            severidad: "CRITICA",
            titulo: "Monto excede tolerancia de la LC",
            detalle: "Pedir enmienda.",
            acciones: [],
          },
        ],
      }),
      HOY,
    );
    expect(conDos).toContainEqual(
      expect.objectContaining({ severidad: "ALTA", titulo: "Razón social difiere entre LC y invoice" }),
    );
    expect(conDos).toContainEqual(
      expect.objectContaining({ severidad: "CRITICA", titulo: "Monto excede tolerancia de la LC" }),
    );
    expect(generarAlertasDeOperacion(op({ discrepancias: [] }), HOY)).toHaveLength(0);
  });

  it("LC que vence en ≤14 días → ALTA con los días restantes", () => {
    const porVencer = generarAlertasDeOperacion(
      op({ lc: { ...LC, vencimiento: "28-jul-26" } }), // HOY = 20-jul → 8 días
      HOY,
    );
    expect(porVencer).toContainEqual(
      expect.objectContaining({
        severidad: "ALTA",
        titulo: "La LC ECB-889174 vence en 8 días (28-jul)",
      }),
    );
    const lejos = generarAlertasDeOperacion(op({ lc: LC }), HOY); // vence 05-sep
    expect(lejos.filter((a) => a.titulo.includes("vence"))).toHaveLength(0);
  });

  it("checklist con pendientes y embarque a ≤30 días → MEDIA con el detalle de qué falta", () => {
    const checklist = [
      { label: "Certificado sanitario oficial — MGAP·DGSG", estado: "PENDIENTE" as const },
      { label: "Certificado halal — Centro Islámico del Uruguay", estado: "PENDIENTE" as const },
      { label: "Packing list", estado: "COMPLETO" as const },
      { label: "Póliza de seguro", estado: "NO_APLICA" as const },
    ];
    const cerca = generarAlertasDeOperacion(op({ fechaEmbarque: "10-ago-26", checklist }), HOY); // 21 días
    expect(cerca).toContainEqual(
      expect.objectContaining({
        severidad: "MEDIA",
        titulo: "Faltan 2 documentos del checklist — embarque en 21 días",
        detalle: expect.stringContaining("Certificado sanitario oficial"),
      }),
    );
    const lejos = generarAlertasDeOperacion(op({ fechaEmbarque: "30-nov-26", checklist }), HOY);
    expect(lejos.filter((a) => a.severidad === "MEDIA")).toHaveLength(0);
    const completo = generarAlertasDeOperacion(
      op({ fechaEmbarque: "10-ago-26", checklist: checklist.map((r) => ({ ...r, estado: "COMPLETO" as const })) }),
      HOY,
    );
    expect(completo.filter((a) => a.severidad === "MEDIA")).toHaveLength(0);
  });

  it("las operaciones cerradas (cobrada/entregada/cancelada) no generan alertas", () => {
    const conTodo: Partial<OperationDetail> = {
      fechaEmbarque: "18-ago-26",
      lc: { ...LC, vencimiento: "28-jul-26" },
      checklist: [{ label: "Certificado sanitario", estado: "PENDIENTE" }],
      discrepancias: [{ id: "d1", severidad: "ALTA", titulo: "X", detalle: "Y", acciones: [] }],
    };
    for (const estado of ["COBRADA", "ENTREGADA", "CANCELADA"] as const) {
      expect(generarAlertasDeOperacion(op({ ...conTodo, estado }), HOY)).toHaveLength(0);
    }
    expect(generarAlertasDeOperacion(op({ ...conTodo, estado: "EN_TRANSITO" }), HOY).length).toBeGreaterThan(0);
  });
});

describe('contratos sin generar — "ya cargaste tal contrato, fijate" (ADR-004)', () => {
  const docs = (venta: "PENDIENTE" | "APROBADO", compra: "PENDIENTE" | "APROBADO") => [
    {
      nombre: "Contrato de compra",
      origen: null,
      estado: compra,
      version: null,
      fecha: null,
      accion: "generar" as const,
    },
    {
      nombre: "Contrato de venta",
      origen: null,
      estado: venta,
      version: null,
      fecha: null,
      accion: "generar" as const,
    },
    {
      nombre: "Packing list preliminar",
      origen: null,
      estado: "PENDIENTE" as const,
      version: null,
      fecha: null,
      accion: "generar" as const,
    },
  ];

  it("operación en marcha con contrato pendiente → MEDIA por cada contrato que falta", () => {
    const alertas = generarAlertasDeOperacion(
      op({ estado: "NEGOCIACION", documentos: docs("PENDIENTE", "APROBADO") }),
      HOY,
    );
    expect(alertas).toContainEqual(
      expect.objectContaining({ severidad: "MEDIA", titulo: "Falta generar el Contrato de venta" }),
    );
    expect(alertas.filter((a) => a.titulo.startsWith("Falta generar"))).toHaveLength(1);
  });

  /* El backlog del ERP —302 operaciones "activas" con el embarque vencido, la más vieja de 2017—
     no genera 604 avisos de contrato el primer día. Pero el corte es SOLO para lo importado: una
     operación creada en romai que se atrasó dos meses es la que más necesita el aviso. */
  it("importada del ERP con el embarque vencido hace más de 60 días → no molesta con el contrato", () => {
    const hace200 = fmtFecha(new Date(HOY.getFullYear(), HOY.getMonth(), HOY.getDate() - 200));
    const heredada = generarAlertasDeOperacion(
      op({
        estado: "DOCS_EN_PREPARACION",
        importada: true,
        fechaEmbarque: hace200,
        documentos: docs("PENDIENTE", "PENDIENTE"),
      }),
      HOY,
    );
    expect(heredada.filter((a) => a.titulo.startsWith("Falta generar"))).toHaveLength(0);
  });

  it("creada en romai con el embarque vencido hace más de 60 días → SÍ avisa: es la más atrasada", () => {
    const hace200 = fmtFecha(new Date(HOY.getFullYear(), HOY.getMonth(), HOY.getDate() - 200));
    const nuestra = generarAlertasDeOperacion(
      op({
        estado: "DOCS_EN_PREPARACION",
        importada: false,
        fechaEmbarque: hace200,
        documentos: docs("PENDIENTE", "PENDIENTE"),
      }),
      HOY,
    );
    expect(nuestra.filter((a) => a.titulo.startsWith("Falta generar"))).toHaveLength(2);
  });

  it("en borrador todavía no molesta; con los contratos generados tampoco", () => {
    const borrador = generarAlertasDeOperacion(
      op({ estado: "BORRADOR", documentos: docs("PENDIENTE", "PENDIENTE") }),
      HOY,
    );
    expect(borrador.filter((a) => a.titulo.startsWith("Falta generar"))).toHaveLength(0);
    const listos = generarAlertasDeOperacion(
      op({ estado: "CONTRATADA", documentos: docs("APROBADO", "APROBADO") }),
      HOY,
    );
    expect(listos.filter((a) => a.titulo.startsWith("Falta generar"))).toHaveLength(0);
  });
});

describe("alertasDeRecordatorios — que nada se caiga de la mesa (ADR-004)", () => {
  const r = (partes: Partial<Recordatorio>): Recordatorio => ({
    id: "r1",
    nota: "Volver a consultar por producto",
    fecha: "18-jul-26",
    ...partes,
  });

  it("recordatorio vencido y sin hacer → alerta MEDIA con la contraparte", () => {
    const alertas = alertasDeRecordatorios([r({ contraparte: "Frigorífico La Serrana" })], HOY);
    expect(alertas).toContainEqual(
      expect.objectContaining({
        severidad: "MEDIA",
        operacion: "Frigorífico La Serrana",
        titulo: "Seguimiento: Volver a consultar por producto",
      }),
    );
  });

  it("futuros, hechos o con fecha ilegible no molestan", () => {
    expect(alertasDeRecordatorios([r({ fecha: "30-ago-26" })], HOY)).toHaveLength(0);
    expect(alertasDeRecordatorios([r({ hecho: true })], HOY)).toHaveLength(0);
    expect(alertasDeRecordatorios([r({ fecha: "en unas semanas" })], HOY)).toHaveLength(0);
    // el día exacto también avisa
    expect(alertasDeRecordatorios([r({ fecha: "20-jul-26" })], HOY)).toHaveLength(1);
  });
});

describe("ordenarAlertas", () => {
  it("lo que puede costar plata primero: CRITICA > ALTA > MEDIA > INFO, estable", () => {
    const a = (severidad: GlobalAlert["severidad"], titulo: string): GlobalAlert => ({
      severidad,
      titulo,
      operacion: "OP-1",
      detalle: "",
    });
    const orden = ordenarAlertas([
      a("MEDIA", "m1"),
      a("CRITICA", "c1"),
      a("INFO", "i1"),
      a("ALTA", "a1"),
      a("MEDIA", "m2"),
    ]);
    expect(orden.map((x) => x.titulo)).toEqual(["c1", "a1", "m1", "m2", "i1"]);
  });
});

describe("plazo de presentación al banco (Etapa 2, UCP 600 14c)", () => {
  const conLC = (extra: Partial<OperationDetail>) => op({ lc: LC, ...extra });
  const deLC = (as: GlobalAlert[]) =>
    as.filter(
      (a) => a.titulo.includes("resentar") || a.titulo.includes("presentación") || a.titulo.includes("no hay cómo"),
    );

  it("BL real + 21 días → ALTA cuando quedan ≤10 días, con lo que falta exigido por la LC", () => {
    // BL 10-ago → límite 31-ago; hoy 25-ago → 6 días
    const as = deLC(
      generarAlertasDeOperacion(
        conLC({
          blReal: "10-ago-26",
          fechaEmbarque: "10-ago-26",
          checklist: [
            { label: "Certificado sanitario", estado: "PENDIENTE", exigidoPorLC: true },
            { label: "Packing list", estado: "COMPLETO", exigidoPorLC: true },
          ],
        }),
        new Date(2026, 7, 25),
      ),
    );
    expect(as).toHaveLength(1);
    expect(as[0].severidad).toBe("ALTA");
    expect(as[0].titulo).toMatch(/antes del 31-ago \(6 días/);
    expect(as[0].detalle).toContain("Certificado sanitario");
    expect(as[0].detalle).not.toContain("Packing list");
  });

  it("BL real y el plazo ya pasó → CRÍTICA", () => {
    const as = deLC(
      generarAlertasDeOperacion(conLC({ blReal: "01-ago-26", fechaEmbarque: "01-ago-26" }), new Date(2026, 7, 25)),
    );
    expect(as[0].severidad).toBe("CRITICA");
    expect(as[0].titulo).toContain("vencido el 22-ago");
  });

  it("lejos del límite, con BL real, no molesta", () => {
    expect(
      deLC(
        generarAlertasDeOperacion(conLC({ blReal: "10-ago-26", fechaEmbarque: "10-ago-26" }), new Date(2026, 7, 12)),
      ),
    ).toHaveLength(0);
  });

  it("sin BL real: el embarque estimado solo avisa si el vencimiento recorta el plazo", () => {
    // estimado 20-ago + 21 = 10-sep > vence 05-sep → ventana real 16 días → ALTA
    const as = deLC(generarAlertasDeOperacion(conLC({ fechaEmbarque: "20-ago-26" }), HOY));
    expect(as).toHaveLength(1);
    expect(as[0].severidad).toBe("ALTA");
    expect(as[0].titulo).toContain("recorta el plazo de 21 a 16 días");
    // estimado 10-ago + 21 = 31-ago ≤ 05-sep → nada (todavía no hay BL firme)
    expect(deLC(generarAlertasDeOperacion(conLC({ fechaEmbarque: "10-ago-26" }), HOY))).toHaveLength(0);
  });

  it("embarque después del vencimiento → CRÍTICA: no hay cómo presentar", () => {
    const as = deLC(generarAlertasDeOperacion(conLC({ fechaEmbarque: "10-sep-26" }), HOY));
    expect(as[0].severidad).toBe("CRITICA");
    expect(as[0].titulo).toContain("no hay cómo presentar a tiempo");
  });

  it("sin LC o sin plazo legible no hay regla", () => {
    expect(deLC(generarAlertasDeOperacion(op({ blReal: "10-ago-26" }), HOY))).toHaveLength(0);
    expect(
      deLC(generarAlertasDeOperacion(op({ lc: { ...LC, plazoPresentacion: "a la vista" }, blReal: "10-ago-26" }), HOY)),
    ).toHaveLength(0);
  });
});

describe("embarque: cut-off documental y cambio de buque (caso CSU2025099)", () => {
  const docs = (estado: "PENDIENTE" | "ENVIADO") => [
    {
      nombre: "Instrucciones de embarque",
      origen: null,
      estado,
      version: null,
      fecha: null,
      accion: "generar" as const,
    },
  ];
  it("cut-off documental en 2 días sin instrucciones enviadas → ALTA; vencido → CRÍTICA; enviadas → nada", () => {
    const base = op({
      documentos: docs("PENDIENTE"),
      embarque: { cutoffDocumental: "22-jul-26", buque: null, buqueBooking: null },
    });
    const a = generarAlertasDeOperacion(base, HOY).filter((x) => x.titulo.includes("Cut-off"));
    expect(a).toHaveLength(1);
    expect(a[0].severidad).toBe("ALTA");
    expect(a[0].titulo).toContain("en 2 días");
    const venc = generarAlertasDeOperacion(
      op({
        documentos: docs("PENDIENTE"),
        embarque: { cutoffDocumental: "18-jul-26", buque: null, buqueBooking: null },
      }),
      HOY,
    ).filter((x) => x.titulo.includes("Cut-off"));
    expect(venc[0].severidad).toBe("CRITICA");
    expect(
      generarAlertasDeOperacion(
        op({
          documentos: docs("ENVIADO"),
          embarque: { cutoffDocumental: "22-jul-26", buque: null, buqueBooking: null },
        }),
        HOY,
      ).some((x) => x.titulo.includes("Cut-off")),
    ).toBe(false);
  });
  it("el buque del BL distinto del booking → MEDIA con los dos nombres", () => {
    const a = generarAlertasDeOperacion(
      op({ embarque: { cutoffDocumental: null, buque: "STELLA AUSTRAL", buqueBooking: "Ever Linking" } }),
      HOY,
    ).filter((x) => x.titulo.includes("buque cambió"));
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ severidad: "MEDIA", tipo: "RIESGO" });
    expect(a[0].titulo).toContain("Ever Linking");
    expect(a[0].titulo).toContain("STELLA AUSTRAL");
    expect(
      generarAlertasDeOperacion(
        op({ embarque: { cutoffDocumental: null, buque: "ever linking", buqueBooking: "Ever Linking" } }),
        HOY,
      ).some((x) => x.titulo.includes("buque")),
    ).toBe(false);
  });
});

describe("aviso a la aseguradora del comprador (47A, caso CSU2025099)", () => {
  const lcCon = {
    ...LC,
    condicionesAdicionales: [
      "BENEFICIARY SHOULD ADVISE FULL DETAILS OF SHIPMENT WITHIN 05 DAYS AFTER SHIPMENT DATE QUOTING POLICY NO IN0099IP000001 TO LANKASEGUROS GENERAL INSURANCE LTD ON EMAIL POLIZAS(AT)LANKASEGUROS.EXAMPLE",
    ],
  };
  const aseg = (as: GlobalAlert[]) => as.filter((a) => a.titulo.includes("aseguradora"));
  it('con BL real corre la cuenta: MEDIA lejos, ALTA a 2 días, ALTA "venció" después', () => {
    const base = op({ lc: lcCon, blReal: "18-jul-26", fechaEmbarque: "18-jul-26" });
    const a = aseg(generarAlertasDeOperacion(base, HOY)); // 20-jul: quedan 3 días → MEDIA
    expect(a).toHaveLength(1);
    expect(a[0].severidad).toBe("MEDIA");
    expect(a[0].titulo).toContain("23-jul");
    expect(a[0].titulo).toContain("IN0099IP000001");
    expect(aseg(generarAlertasDeOperacion(base, new Date(2026, 6, 22)))[0].severidad).toBe("ALTA");
    expect(aseg(generarAlertasDeOperacion(base, new Date(2026, 6, 25)))[0].titulo).toContain("venció el 23-jul");
  });
  it("sin BL real o sin la condición no hay alerta", () => {
    expect(aseg(generarAlertasDeOperacion(op({ lc: lcCon }), HOY))).toHaveLength(0);
    expect(aseg(generarAlertasDeOperacion(op({ lc: LC, blReal: "18-jul-26" }), HOY))).toHaveLength(0);
  });
});

describe("embarque: cut-off VGM (B3)", () => {
  const emb = (cutoffVgm: string) => ({ cutoffDocumental: null, buque: null, buqueBooking: null, cutoffVgm });
  const cont = (taraKg: number | null) => ({
    numero: "DEMU4100371",
    precinto: null,
    tipo: "40HC",
    bultos: 680,
    tipoBulto: "bags",
    pesoNetoKg: 27310,
    pesoBrutoKg: 27350,
    taraKg,
    lotes: null,
    produccionDesde: null,
    produccionHasta: null,
    vencimiento: null,
  });
  const deVgm = (as: GlobalAlert[]) => as.filter((x) => x.titulo.includes("VGM"));
  it("en 2 días con un contenedor sin tara → ALTA; vencido → CRÍTICA; sin contenedores → avisa igual; con VGM completo o BL → nada", () => {
    const alta = deVgm(
      generarAlertasDeOperacion(op({ embarque: emb("22-jul-26"), contenedores: [cont(3900), cont(null)] }), HOY),
    );
    expect(alta).toHaveLength(1);
    expect(alta[0].severidad).toBe("ALTA");
    // el conteo va en el detalle: en el título cambiaría la clave de la alerta al cargar cada contenedor
    expect(alta[0].titulo).toContain("falta el peso verificado");
    expect(alta[0].detalle).toContain("1 contenedor sin peso bruto o tara");
    expect(
      deVgm(generarAlertasDeOperacion(op({ embarque: emb("18-jul-26"), contenedores: [cont(null)] }), HOY))[0]
        .severidad,
    ).toBe("CRITICA");
    expect(
      deVgm(generarAlertasDeOperacion(op({ embarque: emb("22-jul-26"), contenedores: [] }), HOY))[0].detalle,
    ).toContain("no hay contenedores");
    // vencida hace mucho no se reabre para siempre
    expect(
      deVgm(generarAlertasDeOperacion(op({ embarque: emb("01-ene-26"), contenedores: [cont(null)] }), HOY)),
    ).toHaveLength(0);
    expect(
      deVgm(generarAlertasDeOperacion(op({ embarque: emb("22-jul-26"), contenedores: [cont(3900), cont(3900)] }), HOY)),
    ).toHaveLength(0);
    expect(
      deVgm(
        generarAlertasDeOperacion(
          op({ embarque: emb("18-jul-26"), contenedores: [cont(null)], blReal: "10-jul-26" }),
          HOY,
        ),
      ),
    ).toHaveLength(0);
  });
});

describe("vida útil del lote contra la ETA (B5)", () => {
  const cont = (numero: string, vencimiento: string | null) => ({
    numero,
    precinto: null,
    tipo: "40HC",
    bultos: 680,
    tipoBulto: "bags",
    pesoNetoKg: 27000,
    pesoBrutoKg: 27040,
    taraKg: 3900,
    lotes: "4342",
    produccionDesde: null,
    produccionHasta: null,
    vencimiento,
  });
  const emb = (eta: string) => ({ cutoffDocumental: null, buque: null, buqueBooking: null, eta });
  const deVida = (as: GlobalAlert[]) => as.filter((x) => /vida útil|vence antes/.test(x.titulo));

  it("lote que vence antes de llegar → CRÍTICA; con menos de 3 meses → ALTA; con 6 o más → nada", () => {
    // HOY = 20-jul-26; ETA 20-ago-26 + 15 días de tránsito = 4-sep-26
    const vencido = deVida(
      generarAlertasDeOperacion(op({ embarque: emb("20-ago-26"), contenedores: [cont("SEGU1", "01-ago-26")] }), HOY),
    );
    expect(vencido).toHaveLength(1);
    expect(vencido[0].severidad).toBe("CRITICA");
    expect(vencido[0].titulo).toContain("vence antes de llegar");

    const poca = deVida(
      generarAlertasDeOperacion(op({ embarque: emb("20-ago-26"), contenedores: [cont("SEGU1", "01-oct-26")] }), HOY),
    );
    expect(poca[0].severidad).toBe("ALTA");
    expect(poca[0].detalle).toContain("SEGU1");

    expect(
      deVida(
        generarAlertasDeOperacion(op({ embarque: emb("20-ago-26"), contenedores: [cont("SEGU1", "01-jun-27")] }), HOY),
      ),
    ).toHaveLength(0);
  });

  it("sin ETA o sin vencimiento cargado no opina, y una sola alerta nombra a todos los contenedores", () => {
    expect(deVida(generarAlertasDeOperacion(op({ contenedores: [cont("SEGU1", "01-ago-26")] }), HOY))).toHaveLength(0);
    expect(
      deVida(generarAlertasDeOperacion(op({ embarque: emb("20-ago-26"), contenedores: [cont("SEGU1", null)] }), HOY)),
    ).toHaveLength(0);
    const dos = deVida(
      generarAlertasDeOperacion(
        op({ embarque: emb("20-ago-26"), contenedores: [cont("SEGU1", "01-oct-26"), cont("CMAU2", "15-oct-26")] }),
        HOY,
      ),
    );
    expect(dos).toHaveLength(1);
    expect(dos[0].detalle).toContain("SEGU1 vence 01-oct, CMAU2 vence 15-oct");
  });
});

describe("proximoHito", () => {
  const a = (fecha: string | null, severidad: "CRITICA" | "ALTA" | "MEDIA", titulo: string) => ({
    severidad,
    operacion: "OP-1",
    titulo,
    detalle: "",
    ...(fecha ? { fecha } : {}),
  });

  it("devuelve la fecha más cercana con su motivo", () => {
    const r = proximoHito([a("2026-10-20", "ALTA", "vence la LC"), a("2026-09-15", "MEDIA", "cut-off VGM")]);
    expect(r).toEqual({ fecha: "2026-09-15", motivo: "cut-off VGM", severidad: "MEDIA" });
  });

  it("a igual fecha manda la más grave", () => {
    const r = proximoHito([a("2026-09-15", "MEDIA", "leve"), a("2026-09-15", "CRITICA", "grave")]);
    expect(r?.motivo).toBe("grave");
  });

  /* una alerta sin fecha NO es un vencimiento: darle una inventada sería mentir
     sobre cuándo hay que hacer algo */
  it("las alertas sin fecha no compiten", () => {
    const r = proximoHito([a(null, "CRITICA", "falta el sanitario"), a("2026-12-01", "MEDIA", "vence la LC")]);
    expect(r?.motivo).toBe("vence la LC");
  });

  it("sin ninguna fecha, no hay próximo", () => {
    expect(proximoHito([a(null, "ALTA", "falta el halal")])).toBeNull();
    expect(proximoHito([])).toBeNull();
  });
});
