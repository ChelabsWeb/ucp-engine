import { describe, expect, it } from "vitest";
import { generarChecklist } from "./checklist";
import type { CamposDoc } from "./consistencia";
import { SWIFT_CSU2025099 as MT710_CSU2025099 } from "./fixtures";
import { ablandarPorISBP } from "./isbp";
import { ejemplaresDe, feeDiscrepancia, pideSoloCopiaDelTransporte, precheckPresentacion } from "./presentacion";
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

/* los tres documentos del expediente del caso, con lo que el banco mira */
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
  /*
   * Y el plazo del 48 sobre un juego **que ya se presentó**: se mide contra el día que llegó.
   *
   * Son dos preguntas distintas con la misma cuenta, y confundirlas rechazaba lo conforme. Antes se
   * usaba `hoy` siempre, así que una presentación en plazo examinada después del límite salía
   * DISCREPANCIA por tardía — y eso pasa en cuanto el examen no es el mismo día, que es lo normal:
   * el artículo 14 (b) le da al banco cinco días hábiles. El caso TA 956rev tiene esa forma exacta,
   * con una presentación en plazo y un examen diecisiete días después.
   *
   * El BL es del 08-abr-25 y el 48 son 21 días: el límite es el 29-abr.
   */
  describe("el plazo del 48 sobre una presentación que ya ocurrió", () => {
    const conFechas = (presentadaEl: Date, hoy: Date) =>
      precheckPresentacion({
        lc,
        docs,
        op: OP,
        empresaRazonSocial: "CEREALSUR S.A.",
        presentadaEl,
        hoy,
      }).reglas.find((x) => x.id === "plazo");

    it("presentada el 25-abr y examinada el 10-may: en plazo, aunque el examen sea posterior al límite", () => {
      const r = conFechas(new Date(2025, 3, 25), new Date(2025, 4, 10));
      expect(r?.estado, "el examen no es la presentación: el banco tiene cinco días hábiles").toBe("OK");
      expect(r?.evidencia).toMatch(/presentada/);
    });

    it("presentada el 2-may: ahí sí llegó tarde", () => {
      expect(conFechas(new Date(2025, 4, 2), new Date(2025, 4, 2))?.estado).toBe("DISCREPANCIA");
      /* y sigue siendo tarde aunque se examine el mismo día del límite */
      expect(conFechas(new Date(2025, 4, 2), new Date(2025, 3, 29))?.estado).toBe("DISCREPANCIA");
    });

    it("sin la fecha de presentación la regla sigue siendo la cuenta de romai, que mira hoy", () => {
      /* Allá nadie presentó nada todavía y la pregunta es cuántos días quedan. No se toca. */
      const r = precheckPresentacion({
        lc,
        docs,
        op: OP,
        empresaRazonSocial: "CEREALSUR S.A.",
        hoy: HOY,
      }).reglas.find((x) => x.id === "plazo");
      expect(r?.estado).toBe("OK");
      expect(r?.evidencia).toMatch(/quedan \d+ días/);
    });
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
      fuente: "UCP 600 14j",
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

describe("lo que el crédito NO exige, no se dictamina", () => {
  /*
   * Dos reglas inventaban una exigencia cuando el 46A callaba, y dictaminaban contra ella.
   *
   * El consignatario: si el crédito no decía a nombre de quién, se exigía «a la orden del banco
   * emisor». Un crédito que consigna al ordenante —o uno aéreo, donde el consignatario siempre va
   * nominado— daba discrepancia sobre un documento que cumplía exactamente lo pedido.
   *
   * El flete: si el crédito no lo mencionaba, se deducía del incoterm de la operación, y sin
   * incoterm se asumía PREPAID. Un BL marcado FREIGHT COLLECT contra un crédito que no habla del
   * flete salía discrepante por una marca que nadie pidió.
   *
   * El artículo 14 (a) es claro: el examen es contra los documentos y el crédito. Donde el crédito
   * calla no hay discrepancia — hay, a lo sumo, algo que mirar.
   */
  const sinMencion = (quitar: RegExp) => ({
    ...lc,
    documentosExigidos: (lc.documentosExigidos ?? []).map((d) => d.replace(quitar, "")),
  });
  const correr = (lcUsada: typeof lc, campos: CamposDoc) =>
    precheckPresentacion({
      lc: lcUsada,
      docs: [{ tipo: "BL" as const, campos, nombreArchivo: "BL.jpg" }],
      op: OP,
      empresaRazonSocial: "CEREALSUR S.A.",
      hoy: HOY,
    });

  it("sin marca de flete en el crédito, un BL FREIGHT COLLECT no es discrepancia", () => {
    const r = correr(sinMencion(/MARKED 'FREIGHT PREPAID'/i), { ...BL, flete: campo("FREIGHT COLLECT") });
    const x = r.reglas.find((y) => y.id === "bl-freight");
    expect(x?.estado).not.toBe("DISCREPANCIA");
    expect(x?.evidencia).toMatch(/FREIGHT COLLECT/);
  });

  it("pero si el crédito la pide, sigue mandando", () => {
    const x = correr(lc, { ...BL, flete: campo("FREIGHT COLLECT") }).reglas.find((y) => y.id === "bl-freight");
    expect(x?.estado).toBe("DISCREPANCIA");
  });

  it("sin destinatario en el crédito, el consignatario del BL no se compara contra el emisor", () => {
    const r = correr(sinMencion(/ISSUED TO THE ORDER OF\s+MERIDIAN BANK PLC/i), {
      ...BL,
      consignatario: campo("ORIENT FEED (PVT) LTD"),
    });
    const x = r.reglas.find((y) => y.id === "bl-consignee");
    expect(x?.estado).not.toBe("DISCREPANCIA");
    expect(x?.evidencia).toMatch(/ORIENT FEED/);
  });

  it("y si el crédito dice a la orden de quién, se compara como siempre", () => {
    const x = correr(lc, { ...BL, consignatario: campo("ORIENT FEED (PVT) LTD") }).reglas.find(
      (y) => y.id === "bl-consignee",
    );
    expect(x?.estado).toBe("DISCREPANCIA");
  });

  /*
   * «BLANK ENDORSED» dice a nombre de quién, aunque no lo parezca.
   *
   * Un crédito que exige el conocimiento endosado en blanco está exigiendo que vaya **a la orden**:
   * un documento consignado derecho a una parte nominada no se puede endosar. Lo dice la Opinión
   * TA 814rev4 —*«A bill of lading that is straight consigned to the applicant cannot be
   * endorsed»*— y el rechazo que el banco cursó, «CONSIGNED TO (applicant) INSTEAD OF 'TO THE
   * ORDER', NOT ENDORSED», era válido.
   *
   * Sin esto el motor leía «el crédito no dice a nombre de quién» y salía a verificar: perdía una
   * discrepancia que el crédito sí sostiene, y de las que dejan al emisor sin control sobre la
   * mercadería.
   */
  describe("el endoso en blanco que el crédito exige", () => {
    const conExigencia = (exigencia: string, consignatario?: string) =>
      precheckPresentacion({
        lc: { ...lc, documentosExigidos: [exigencia] },
        docs: [
          {
            tipo: "BL" as const,
            campos: { ...BL, ...(consignatario === undefined ? {} : { consignatario: campo(consignatario) }) },
          },
        ],
        op: OP,
        empresaRazonSocial: "CEREALSUR S.A.",
        hoy: HOY,
      }).reglas.find((x) => x.id === "bl-consignee");

    const PIDE_ENDOSO = "FULL SET 3/3 ORIGINAL NEGOTIABLE CLEAN ON BOARD OCEAN BILL OF LADING, BLANK ENDORSED";

    it("un conocimiento consignado derecho al ordenante es discrepancia", () => {
      const x = conExigencia(PIDE_ENDOSO, "ORIENT FEED (PVT) LTD");
      expect(x?.estado).toBe("DISCREPANCIA");
      expect(x?.evidencia).toMatch(/no se puede endosar/);
    });

    it("y uno a la orden cumple", () => {
      expect(conExigencia(PIDE_ENDOSO, "TO ORDER")?.estado).toBe("OK");
      expect(conExigencia(PIDE_ENDOSO, "TO THE ORDER OF SHIPPER")?.estado).toBe("OK");
    });

    it("sin consignatario leído se sale a verificar: el silencio no gana una discrepancia", () => {
      const x = conExigencia(PIDE_ENDOSO, "");
      expect(x?.estado).toBe("ATENCION");
      expect(x?.evidencia).toMatch(/no se leyó el consignatario/);
    });

    it("si el crédito además nombra a quién consignar, manda lo que nombra", () => {
      /*
       * «CONSIGNED TO APPLICANT, BLANK ENDORSED» es un crédito mal redactado —son dos cosas que no
       * se pueden cumplir a la vez— y el documento que obedece al crédito no puede salir discrepante
       * por eso. Esta rama no opina ahí.
       */
      const x = conExigencia("FULL SET BILL OF LADING CONSIGNED TO APPLICANT, BLANK ENDORSED", "ORIENT FEED (PVT) LTD");
      expect(x?.estado).not.toBe("DISCREPANCIA");
    });

    it("y un crédito que no pide endoso ni nombra destinatario sigue saliendo a verificar", () => {
      const x = conExigencia("FULL SET OF CLEAN ON BOARD BILLS OF LADING", "ORIENT FEED (PVT) LTD");
      expect(x?.estado).toBe("ATENCION");
      expect(x?.evidencia).toMatch(/no dice a nombre de quién/);
    });
  });
});

describe("la dirección del beneficiario (UCP 600 art. 14 j)", () => {
  /*
   * El artículo dice lo contrario de lo que el aviso sugería: «cuando las direcciones del
   * beneficiario y del ordenante aparecen en cualquier documento exigido, NO necesitan ser las
   * mismas que las del crédito… pero deben estar dentro del mismo país».
   *
   * El aviso terminaba en «usar la de la LC en factura y certificados», que suena a exigencia y no
   * lo es. Usarla evita preguntas y es un buen consejo; presentarla distinta no es discrepancia, y
   * la herramienta no puede dar a entender que sí.
   */
  const conDireccion = (direccion: string) =>
    precheckPresentacion({
      lc,
      docs: [{ tipo: "FACTURA" as const, campos: FACTURA, nombreArchivo: "A4401.jpg" }],
      op: OP,
      empresaRazonSocial: "CEREALSUR S.A.",
      empresaDireccion: direccion,
      hoy: HOY,
    }).reglas.find((x) => x.id === "beneficiario-direccion");

  it("una dirección distinta no se presenta como algo que haya que corregir", () => {
    const x = conDireccion("Colón 1498, 4to piso, Montevideo");
    expect(x?.estado).toBe("ATENCION");
    expect(x?.evidencia).not.toMatch(/usar la de la LC en factura/i);
    expect(x?.evidencia).toMatch(/no necesitan ser las mismas/i);
    expect(x?.evidencia).toMatch(/14 ?\(?j\)?/);
  });

  it("y se nombra la única exigencia que el artículo sí pone: el país", () => {
    expect(conDireccion("Colón 1498, Montevideo")?.evidencia).toMatch(/pa[ií]s/i);
  });

  it("con la misma dirección, sigue estando bien", () => {
    expect(conDireccion(lc.beneficiarioDireccion ?? "")?.estado).toBe("OK");
  });
});

/** El mismo paquete real, variando solo quién es el ordenante de la venta. */
const conOrdenante = (contraparte: string | null) =>
  precheckPresentacion({
    lc,
    docs: [
      { tipo: "FACTURA" as const, campos: FACTURA },
      { tipo: "BL" as const, campos: BL },
    ],
    op: {
      ...OP,
      legs: OP.legs.map((l) => (l.tipo === "VENTA" ? { ...l, contraparte: contraparte ?? "" } : l)),
    },
    empresaRazonSocial: "CEREALSUR S.A.",
    hoy: HOY,
  }).reglas;

describe("el notify del conocimiento cuando falta el ordenante", () => {
  /*
   * El crédito pide «NOTIFY APPLICANT AS PER FIELD 50» y el conocimiento real dice «NOTIFY SUPER
   * FEED (PVT) LTD», que es el ordenante: cumple. Pero si el campo 50 no se pudo leer, el motor
   * comparaba contra una cadena vacía y daba DISCREPANCIA, con la evidencia terminando en
   * «· ordenante » y nada después — el propio hallazgo delataba que el dato faltaba de este lado.
   *
   * Rechazar una presentación conforme por un dato que el motor no tiene es el error más caro que
   * puede cometer. Falta la mitad del control: eso se dice, no se resuelve en contra.
   */
  it("no discrepa: avisa que falta el ordenante", () => {
    const r = conOrdenante(null).find((x) => x.id === "bl-notify");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toMatch(/no se leyó el ordenante/);
  });

  it("con el ordenante, el conocimiento real cumple", () => {
    const r = conOrdenante("ORIENT FEED (PVT) LTD").find((x) => x.id === "bl-notify");
    expect(r?.estado).toBe("OK");
  });

  it("y un notify que no es el ordenante sigue siendo discrepancia", () => {
    const r = conOrdenante("OTRA EMPRESA S.A").find((x) => x.id === "bl-notify");
    expect(r?.estado).toBe("DISCREPANCIA");
  });
});

describe("el número del crédito citado en el documento, y quién lo pide", () => {
  /*
   * La regla se activaba con «hay documentos exigidos» y la fuente decía «47A», así que el motor le
   * atribuía al crédito una condición que el crédito no escribió — y la falta del número salía como
   * DISCREPANCIA apoyada en ella. El repo tiene una sola regla que no se negocia: cada hallazgo
   * tiene que poder ir a buscarse al texto que lo sostiene.
   */
  const sinLaCondicion = {
    ...lc,
    condicionesAdicionales: (lc.condicionesAdicionales ?? []).filter((x) => !/CREDIT NUMBER/i.test(x)),
  };
  const correr = (credito: typeof lc, numeroEnDoc: string) =>
    precheckPresentacion({
      lc: credito,
      docs: [{ tipo: "FACTURA" as const, campos: { ...FACTURA, numeroLC: campo(numeroEnDoc) } }],
      op: OP,
      empresaRazonSocial: "CEREALSUR S.A.",
      hoy: HOY,
    }).reglas.find((x) => x.id === "lc-num-FACTURA");

  it("si el crédito lo pide, omitirlo es discrepancia y la fuente es el 47A", () => {
    const r = correr(lc, "");
    expect(r?.estado, "el crédito lo exige y el documento no lo trae").toBe("ATENCION");
    expect(r?.fuente, "la obligación de citarlo sale del 47A").toBe("47A");
  });

  it("y citar OTRO número también, pero la fuente es el 14 (d): es conflicto, no omisión", () => {
    const r = correr(lc, "OTRO-NUMERO-123");
    expect(r?.estado).toBe("DISCREPANCIA");
    /* El 47A sostiene que hay que citarlo; que lo citado no contradiga al crédito lo sostiene el
       14 (d), que es el artículo más preciso para este caso y el que se podrá discutir con el
       banco. */
    expect(r?.fuente).toBe("UCP 600 14d");
  });

  it("si el crédito no lo pide, la fuente no lo inventa", () => {
    expect(correr(sinLaCondicion, lc.numero)?.fuente).not.toBe("47A");
  });

  /*
   * OMITIR el número y CITAR OTRO no son la misma falta.
   *
   * Que falte, cuando el crédito no lo pidió, no es discrepancia: lo dice la ISBP 2023 y es lo que
   * este bloque venía cuidando. Pero un documento que dice «LC 779101LC26000047» contra un crédito
   * 722101LC26000047 no omitió nada: afirma pertenecer a OTRO crédito, y eso es el artículo 14 (d)
   * —los datos no pueden entrar en conflicto con el crédito— sin importar quién pidió qué.
   *
   * El caso es real y caro: el banco devolvió un paquete por esto. Un dígito cambiado al tipear el
   * asunto de un mail.
   */
  it("un número DISTINTO es discrepancia por el 14 (d), aunque el crédito no pida citarlo", () => {
    const r = correr(sinLaCondicion, "779101LC26000047");
    expect(r?.estado, "no es una omisión: el documento dice pertenecer a otro crédito").toBe("DISCREPANCIA");
    expect(r?.fuente, "el 14 (d) es lo que lo sostiene, no el 47A que nadie escribió").toContain("14");
    expect(r?.evidencia, "tiene que mostrar los dos números para que se pueda discutir").toMatch(/779101/);
    expect(r?.evidencia).toMatch(/722101|LCMRDN/);
  });

  /*
   * Hay créditos que piden citar el número DENTRO del documento exigido, no en las condiciones
   * adicionales: «COMMERCIAL INVOICE … INDICATING CONTRACT NUMBER AMS2026164, NUMBER OF LETTER OF
   * CREDIT». Mirar solo el 47A lo daba por no pedido, y además la fuente tiene que decir dónde
   * está escrito: mandar al banco al 47A por algo que dice el 46A es mandarlo al lugar
   * equivocado.
   */
  it("el 46A también cuenta: si lo pide ahí, la fuente lo dice", () => {
    const enEl46A = {
      ...sinLaCondicion,
      documentosExigidos: [
        "COMMERCIAL INVOICE ISSUED BY BENEFICIARY IN 3 ORIGINALS, INDICATING CONTRACT NUMBER AMS2026164, NUMBER OF LETTER OF CREDIT, AND SHIPMENT NUMBER.",
      ],
    };
    const r = correr(enEl46A, "");
    expect(r?.fuente, "lo pide el 46A, no el 47A").toBe("46A");
  });

  /*
   * Y lo que pasa DESPUÉS, que es lo que el banco ve.
   *
   * El examen base marca la discrepancia; `ablandarPorISBP` la baja a ATENCION citando la
   * consideración preliminar viii de la ISBP 821 (2023), que dice que ni la ausencia del número
   * del crédito ni un error tipográfico en él justifican por sí solos un rechazo. Las dos cosas
   * son correctas y van juntas: el motor DICE lo que encontró y después aplica la práctica
   * bancaria que lo perdona, dejando el rastro de las dos.
   *
   * Importa fijarlo porque el banco de este caso SÍ lo devolvió por eso. Si mañana alguien sube
   * el veredicto final a discrepancia, que sea una decisión y no un descuido.
   */
  it("en el examen completo la ISBP lo ablanda a atención, y deja dicho por qué", () => {
    const base = precheckPresentacion({
      lc,
      docs: [{ tipo: "FACTURA" as const, campos: { ...FACTURA, numeroLC: campo("779101LC26000047") } }],
      op: OP,
      empresaRazonSocial: "CEREALSUR S.A.",
      hoy: HOY,
    }).reglas;
    const antes = base.find((x) => x.id === "lc-num-FACTURA");
    expect(antes?.estado, "el examen base lo marca").toBe("DISCREPANCIA");

    const despues = ablandarPorISBP(base).find((x) => x.id === "lc-num-FACTURA");
    expect(despues?.estado, "la ISBP 2023 no lo deja justificar un rechazo por sí solo").toBe("ATENCION");
    expect(despues?.evidencia, "y la evidencia conserva los dos números").toMatch(/779101/);
    expect(despues?.evidencia).toMatch(/no justifica rechazo/i);
  });

  it("pero omitirlo, cuando el crédito no lo pide, sigue sin ser discrepancia", () => {
    const r = correr(sinLaCondicion, "");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toMatch(/no se leyó|verificar/i);
  });

  it("el crédito real sí lo pide, así que ahí sigue siendo el 47A", () => {
    // La condición +2 del expediente: «ALL DOCUMENTS SHOUD INDICATE THE LETTER OF CREDIT NUMBER».
    expect(correr(lc, lc.numero)?.fuente).toBe("47A");
  });
});

describe("«listo» no es «verificado»", () => {
  /*
   * La distinción que vino del ERP y vale igual acá.
   *
   * El 46A del crédito real exige diez documentos y el producto sabe leer tres: los otros siete se
   * tildan a mano. Un resultado que dijera «conforme» sobre eso manda a alguien al banco confiado,
   * y el rechazo —con su cargo por juego— aparece allá.
   *
   * `listo` dice «nada de lo que miré está mal». `verificado` dice «además, lo miré todo». Con una
   * sola regla en ATENCION, lo primero sigue siendo cierto y lo segundo no.
   */
  it("con algo a verificar, está listo pero no verificado", () => {
    const r = precheckPresentacion({
      lc: { ...lc, documentosExigidos: ["COMMERCIAL INVOICE", "CERTIFICATE OF ORIGIN IN 02 FOLD"] },
      docs: [{ tipo: "FACTURA" as const, campos: {} as CamposDoc, nombreArchivo: "f.pdf" }],
      op: OP,
      empresaRazonSocial: "CEREALSUR S.A.",
      hoy: HOY,
    });
    const atencion = r.reglas.filter((x) => x.estado === "ATENCION").length;
    expect(atencion, "el caso no dejó nada a verificar: el test no mira lo que dice").toBeGreaterThan(0);
    expect(r.sinVerificar).toBe(atencion);
    expect(r.verificado, "se dio por verificado con cosas sin mirar").toBe(false);
  });
});

/**
 * El crédito que pide una copia del documento de transporte, y los dos plazos que no se miden.
 *
 * Lo dice el párrafo A6 (c) de la ISBP 821 y la Opinión TA 767rev: una copia de un documento de
 * transporte **no está sujeta** al plazo de veintiún días del artículo 14 (c) ni al del campo 48,
 * salvo que el crédito fije la base; y la fecha que muestra una copia **no determina** si el embarque
 * fue tardío.
 *
 * El motor los aplicaba igual que con un original, así que un crédito que pide «COPY OF AIR WAYBILL
 * EVIDENCING TELEX RELEASE» salía con **presentación tardía y embarque fuera del 44C** sobre una
 * presentación que la ICC dice que no se mide así. Dos falsos positivos, y uno en `plazo`, que es la
 * discrepancia más corriente del negocio.
 */
describe("la copia del documento de transporte y los plazos", () => {
  it.each([
    ["COPY OF AIR WAYBILL EVIDENCING TELEX RELEASE", true],
    ["PHOTOCOPY OF BILL OF LADING", true],
    ["NON-NEGOTIABLE COPY OF SEA WAYBILL", true],
    /* Y lo que NO es «solo una copia»: si pide originales, se examina como siempre. */
    ["FULL SET OF 3/3 ORIGINAL B/LS PLUS 2 NON NEGOTIABLE COPIES", false],
    ["FULL SET OF ORIGINAL AIR WAYBILLS", false],
    ["ORIGINAL HOUSE AIR WAYBILL CONSIGNED TO ISSUING BANK", false],
    /* Y una línea que no es de transporte no la activa. */
    ["COPY OF CERTIFICATE OF ORIGIN", false],
  ])("«%s» → solo copia: %s", (linea, esperado) => {
    expect(pideSoloCopiaDelTransporte(["SIGNED COMMERCIAL INVOICE", linea])).toBe(esperado);
  });
});

/**
 * El nombre del notify, y la línea que los tribunales no trazan igual.
 *
 * Antes alcanzaba con que el notify **contuviera la primera palabra** del ordenante. Con eso el caso
 * *Beyene v Irving Trust* (2d Cir. 1985) salía **OK**: el conocimiento decía «Mohammed Soran» donde el
 * crédito decía «Mohammed Sofan», y el tribunal resolvió que la discrepancia **era válida**, porque
 * Sofan era la persona a la que había que avisarle que llegó la mercadería.
 *
 * Es el mismo defecto que las once contrapartes del ERP que coincidían con las listas de sanciones por
 * la palabra «LLC»: una palabra compartida no identifica a nadie.
 *
 * Pero el otro lado también tiene sentencia —*Hing Yip Hing Fat v Daiwa*, Hong Kong 1991: «Cheergoal
 * Industrial» por «Cheergoal Industries» no era discrepancia, «an obvious typographical error»— y el
 * propio tribunal de Beyene da el contraejemplo del «Smith» escrito «Smithh». Así que el motor usa
 * **tres bandas**: igual u contenido → OK, error de tipeo → ATENCION con las dos sentencias nombradas,
 * nombres distintos → DISCREPANCIA.
 */
describe("el nombre del notify contra el del ordenante", () => {
  /** El mismo paquete real, variando el notify del conocimiento y el ordenante de la venta. */
  const notify = (enElBL: string, ordenante: string) =>
    precheckPresentacion({
      lc,
      docs: [
        { tipo: "FACTURA" as const, campos: FACTURA },
        { tipo: "BL" as const, campos: { ...BL, notify: { valor: enElBL, confianza: 1 } } },
      ],
      op: { ...OP, legs: OP.legs.map((l) => (l.tipo === "VENTA" ? { ...l, contraparte: ordenante } : l)) },
      empresaRazonSocial: "CEREALSUR S.A.",
      hoy: HOY,
    }).reglas.find((r) => r.id === "bl-notify");

  it("el mismo nombre cumple", () => {
    expect(notify("ORIENT FEED (PVT) LTD", "ORIENT FEED (PVT) LTD")?.estado).toBe("OK");
  });

  it("Beyene: «Soran» por «Sofan» ya no pasa en silencio", () => {
    const r = notify("MOHAMMED SORAN", "MOHAMMED SOFAN");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toContain("Beyene");
    expect(r?.evidencia).toContain("Hing Yip");
  });

  it("y un nombre que no se parece sigue siendo discrepancia", () => {
    expect(notify("OTRA EMPRESA S.A.", "ORIENT FEED (PVT) LTD")?.estado).toBe("DISCREPANCIA");
  });

  /*
   * Y el freno que ya estaba: sin el ordenante del crédito no se puede decir que el notify esté mal.
   * Es el invariante de `saber-menos` — saber menos no puede hacer que el motor concluya más.
   */
  it("sin el ordenante leído no se dictamina", () => {
    expect(notify("MOHAMMED SORAN", "")?.estado).toBe("ATENCION");
  });
});
/**
 * El nombre del emisor de la factura, que es la sentencia *Bulgrains v Shinhan Bank*.
 *
 * `fac-emisor` comparaba con `norm(emisor).includes(primera palabra del beneficiario)`: con eso
 * «Bulgrains & Co Ltd» contra «Bulgrains Co Ltd» salía OK, que es la discrepancia que el High Court
 * declaró material. Ahora las dos reglas del 18 (a) (i) pasan por `veredictoDeNombre`.
 */
describe("fac-emisor compara el nombre como un nombre", () => {
  const con = (emisor: string, beneficiario: string) =>
    precheckPresentacion({
      lc,
      docs: [{ tipo: "FACTURA" as const, campos: { ...FACTURA, exportador: campo(emisor) } }],
      op: OP,
      empresaRazonSocial: beneficiario,
      hoy: HOY,
    }).reglas.find((r) => r.id === "fac-emisor");

  it("el mismo nombre cumple", () => {
    expect(con("CEREALSUR S.A.", "CEREALSUR SA")?.estado).toBe("OK");
  });

  it("y un ampersand que falta es discrepancia (Bulgrains v Shinhan)", () => {
    expect(con("BULGRAINS & CO LTD", "BULGRAINS CO LTD")?.estado).toBe("DISCREPANCIA");
  });

  it("una empresa distinta que comparte una palabra también", () => {
    expect(con("SMITH LOGISTICS LTD", "SMITH TRADING SA")?.estado).toBe("DISCREPANCIA");
  });

  it("un tipeo va a verificar con las dos sentencias nombradas", () => {
    const r = con("CEREALSOR SA", "CEREALSUR SA");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toContain("Beyene");
    expect(r?.evidencia).toContain("Hing Yip");
  });

  /* Y sin el nombre del beneficiario no se concluye: vaciar un dato no puede inventar discrepancias. */
  it("sin el beneficiario del crédito no dictamina", () => {
    expect(con("CEREALSUR SA", "")?.estado).toBe("ATENCION");
  });
});
