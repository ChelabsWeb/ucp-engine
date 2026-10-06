import { describe, expect, it } from "vitest";
import type { CamposDoc, TipoDocExterno } from "./consistencia";
import { examinarPresentacion } from "./examen";
import { contextoDesdeSwift, DOCUMENTOS_CSU2025099, parseMT700, SWIFT_CSU2025099 } from "./index";
import { manualEnIngles, quedaEspanol, reglaEnIngles, textoEnIngles } from "./ingles";

/**
 * La prueba que importa es de **cobertura**: sobre el expediente real, ningún hallazgo puede
 * quedar con español afuera de las comillas. Si alguien agrega una regla nueva al motor y no la
 * traduce, este test falla antes de que el texto llegue a un aviso de rechazo.
 */

/**
 * El expediente real examinado en una fecha dada.
 *
 * La fecha es un parámetro y no una constante porque **las reglas de plazo solo existen cuando una
 * fecha pasó**. Con un solo escenario al día, «Presentar dentro de 21 días del BL» y «presentada
 * N días después del vencimiento» no se generan, y el test de cobertura los dejaba pasar: se
 * descubrieron mirando un aviso de rechazo de verdad, ya en inglés salvo esas cuatro líneas.
 */
const examenEn = (
  hoy: Date,
  anteriores: { referencia: string; fecha: Date; importe: number | null; fechaEmbarque: string | null }[] = [],
) => {
  const credito = parseMT700(SWIFT_CSU2025099)!;
  return examinarPresentacion({
    lc: credito.lc,
    credito: contextoDesdeSwift(credito),
    docs: (Object.entries(DOCUMENTOS_CSU2025099) as [TipoDocExterno, CamposDoc][]).map(([tipo, campos]) => ({
      tipo,
      exigencia: null,
      campos,
    })),
    presentacion: { referencia: `${anteriores.length + 1}`, fecha: hoy, importe: 51262, fechaEmbarque: "08-APR-2025" },
    anteriores,
    empresaRazonSocial: credito.extra.beneficiario[0] ?? "",
    hoy,
  });
};

/**
 * Los escenarios que hay que cubrir. Cada uno hace aparecer reglas que los otros no.
 */
const UN_GIRO_ANTERIOR = [
  { referencia: "1", fecha: new Date(2025, 3, 15), importe: 20000, fechaEmbarque: "08-APR-2025" },
];

const ESCENARIOS: [string, Date, typeof UN_GIRO_ANTERIOR][] = [
  ["dentro de todos los plazos", new Date(2025, 3, 20), []],
  ["pasado el plazo de presentación del 48", new Date(2025, 4, 15), []],
  ["pasado el vencimiento del crédito", new Date(2026, 8, 23), []],
  // El segundo giro trae las reglas del artículo 31 (parciales) y la cuenta del saldo con lo ya
  // girado. Faltaban en la cobertura y se descubrieron mirando una hoja de revisión de verdad.
  ["un segundo giro contra el mismo crédito", new Date(2025, 3, 20), UN_GIRO_ANTERIOR],
];

/**
 * El mismo expediente, pero con un documento de transporte aéreo.
 *
 * Hace falta porque las reglas del artículo 23 solo existen cuando el documento es aéreo, y con el
 * conocimiento marítimo del caso no se generaban: quedaban en español sin que nadie se enterara. Es
 * la misma lección que las reglas de plazo — un escenario único deja artículos enteros sin cubrir.
 */
const examenConTransporte = (over: Record<string, { valor: string; confianza: number }>) => {
  const credito = parseMT700(SWIFT_CSU2025099)!;
  const c = (valor: string) => ({ valor, confianza: 0.9 });
  const awb: CamposDoc = {
    ...DOCUMENTOS_CSU2025099.BL!,
    buque: c(""),
    charterParty: c(""),
    ...over,
  };
  return examinarPresentacion({
    lc: credito.lc,
    credito: { ...contextoDesdeSwift(credito), transbordo: "NOT ALLOWED" },
    docs: [
      { tipo: "FACTURA", campos: DOCUMENTOS_CSU2025099.FACTURA! },
      { tipo: "BL", campos: awb },
    ],
    empresaRazonSocial: credito.extra.beneficiario[0] ?? "",
    hoy: new Date(2025, 3, 20),
  });
};

const examenReal = () => ({ r: examenEn(new Date(2025, 3, 20)) });

function sinTraducirEn(r: { reglas: { regla: string; evidencia?: string | null }[] }) {
  return r.reglas
    .map((x) => reglaEnIngles(x as never))
    .flatMap((x) => [
      { donde: `regla «${x.regla}»`, palabra: quedaEspanol(x.regla) },
      { donde: `evidencia «${x.evidencia}»`, palabra: quedaEspanol(x.evidencia ?? "") },
    ])
    .filter((x) => x.palabra !== null);
}

describe("cobertura sobre el expediente real", () => {
  /*
   * Un documento de transporte de cada clase.
   *
   * Las UCP dedican siete artículos al transporte y cada uno genera reglas propias que los otros
   * no: con el conocimiento marítimo del caso, los artículos 19, 23, 24 y 25 no se producían nunca
   * y sus textos quedaban en español sin que nadie se enterara. Es la misma lección que las reglas
   * de plazo — un escenario único deja artículos enteros fuera de la cobertura.
   */
  const CLASES: [string, Record<string, { valor: string; confianza: number }>][] = [
    [
      "aéreo",
      {
        tipoTransporte: { valor: "AIR WAYBILL", confianza: 0.9 },
        numeroDoc: { valor: "020-12345678", confianza: 0.9 },
        onBoard: { valor: "FLIGHT UX042 DATED 10 APR 2025", confianza: 0.9 },
        puertoEmbarque: { valor: "MONTEVIDEO AIRPORT, URUGUAY", confianza: 0.9 },
        puertoDestino: { valor: "COLOMBO AIRPORT, SRI LANKA", confianza: 0.9 },
      },
    ],
    [
      "multimodal",
      {
        tipoTransporte: { valor: "MULTIMODAL TRANSPORT DOCUMENT", confianza: 0.9 },
        onBoard: { valor: "TAKEN IN CHARGE 08-APR-2025", confianza: 0.9 },
      },
    ],
    [
      "terrestre",
      {
        tipoTransporte: { valor: "CMR CONSIGNMENT NOTE", confianza: 0.9 },
        onBoard: { valor: "", confianza: 0 },
        juegoOriginales: { valor: "DUPLICATE", confianza: 0.9 },
      },
    ],
    [
      "ferroviario marcado duplicate",
      {
        tipoTransporte: { valor: "RAIL WAYBILL", confianza: 0.9 },
        onBoard: { valor: "", confianza: 0 },
        juegoOriginales: { valor: "DUPLICATE", confianza: 0.9 },
      },
    ],
    [
      "courier",
      {
        tipoTransporte: { valor: "COURIER RECEIPT", confianza: 0.9 },
        onBoard: { valor: "", confianza: 0 },
      },
    ],
    ["sujeto a fletamento", { charterParty: { valor: "SUBJECT TO CHARTER PARTY DATED 01-MAR-25", confianza: 0.9 } }],
    ["de clase no determinada", { numeroDoc: { valor: "X-1", confianza: 0.9 } }],
  ];

  /*
   * Un crédito que indica una zona en vez de un puerto.
   *
   * Aparece en cualquier crédito de graneles —«EUROPEAN MAIN PORTS»— y genera una nota que ningún
   * otro escenario produce: la que dice que el motor no puede decidir si el puerto está dentro.
   */
  it("ningún hallazgo queda con español: el crédito exige un contrato de fletamento", () => {
    const credito = parseMT700(SWIFT_CSU2025099)!;
    const r = examinarPresentacion({
      lc: { ...credito.lc, documentosExigidos: [...(credito.lc.documentosExigidos ?? []), "CHARTER PARTY CONTRACT"] },
      credito: contextoDesdeSwift(credito),
      docs: [{ tipo: "BL", campos: DOCUMENTOS_CSU2025099.BL! }],
      empresaRazonSocial: credito.extra.beneficiario[0] ?? "",
      hoy: new Date(2025, 3, 20),
    });
    expect(sinTraducirEn(r).map((x) => `${x.palabra} en ${x.donde}`)).toEqual([]);
  });

  /*
   * Los certificados del 46A y la calidad que el crédito exige.
   *
   * Este escenario no existía porque **no se podía escribir**: hasta que el producto pasó los
   * certificados a `examinarPresentacion`, ninguna de estas reglas se generaba. Y como los textos
   * de `especificaciones.ts` son plantillas, el test de piezas los saltea a propósito, así que
   * estaban sin traducir del todo: el aviso salía «the credit pide al menos 54 % y el certificado
   * declara 61,1 %». Justo el hallazgo que un banco corresponsal tiene que poder leer.
   */
  it.each([
    ["el análisis cumple con el mínimo", "PROTEIN 61,1 PCT"],
    ["el análisis no llega al mínimo", "PROTEIN 47,2 PCT"],
    ["el certificado solo repite la exigencia", "FISH MEAL 54 PCT MIN"],
    ["el certificado no declara nada comparable", "SAMPLE RECEIVED IN GOOD ORDER"],
    // la lista entera, que es como vienen los análisis de verdad y el 45A no dice cuál mirar
    ["el análisis declara varios parámetros", "MOISTURE 9,5 % - PROTEIN 61,1 % - FAT 8,2 % - ASH 16,0 %"],
    ["el análisis abrevia el operador con punto", "PROTEIN MIN. 54 %"],
  ])("ningún hallazgo queda con español: %s", (_nombre, analisis) => {
    const credito = parseMT700(SWIFT_CSU2025099)!;
    const c = (valor: string) => ({ valor, confianza: 0.9 });
    const campos = (mercaderia: string) =>
      ({
        exportador: c("CEREALSUR S.A"),
        emisorSeguro: c("SGS URUGUAY"),
        fechaDocumento: c("08-abr-25"),
        mercaderia: c(mercaderia),
        numeroDoc: c("LCMRDN25000471"),
        puertoEmbarque: c("MONTEVIDEO"),
      }) as unknown as CamposDoc;
    const r = examinarPresentacion({
      lc: credito.lc,
      credito: contextoDesdeSwift(credito),
      docs: [{ tipo: "FACTURA", campos: DOCUMENTOS_CSU2025099.FACTURA! }],
      // uno por cada línea del 46A que no es de los tipos con extracción propia
      certificados: (credito.lc.documentosExigidos ?? [])
        .filter((e) => !/invoice|packing|bills? of lading/i.test(e))
        .map((exigencia) => ({
          exigencia,
          campos: campos(/analysis/i.test(exigencia) ? analisis : "FISH MEAL (FOR ANIMAL FEED USE)"),
        })),
      empresaRazonSocial: credito.extra.beneficiario[0] ?? "",
      hoy: new Date(2025, 3, 20),
    });
    expect(sinTraducirEn(r).map((x) => `${x.palabra} en ${x.donde}`)).toEqual([]);
  });

  it.each([
    ["sin decir cuándo fue la inspección", ""],
    ["declarando cuándo fue", "INSPECTION CARRIED OUT AT MONTEVIDEO ON 07-abr-25 PRIOR TO LOADING"],
  ])("ningún hallazgo queda con español: certificado previo al embarque, %s", (_n, queCertifica) => {
    // El crédito real no pide ningún certificado previo al embarque, así que estas reglas no
    // aparecían en ningún escenario y sus textos quedaban sin traducir.
    const credito = parseMT700(SWIFT_CSU2025099)!;
    const c = (valor: string) => ({ valor, confianza: 0.9 });
    const r = examinarPresentacion({
      lc: credito.lc,
      credito: contextoDesdeSwift(credito),
      docs: [{ tipo: "BL", campos: DOCUMENTOS_CSU2025099.BL! }],
      certificados: [
        {
          exigencia: "+11)PRE-SHIPMENT INSPECTION CERTIFICATE ISSUED BY SGS",
          campos: {
            fechaDocumento: c("15-abr-25"),
            mercaderia: queCertifica ? c(queCertifica) : c(""),
          } as unknown as CamposDoc,
        },
      ],
      empresaRazonSocial: credito.extra.beneficiario[0] ?? "",
      hoy: new Date(2025, 3, 20),
    });
    expect(sinTraducirEn(r).map((x) => `${x.palabra} en ${x.donde}`)).toEqual([]);
  });

  it("ningún hallazgo queda con español: el crédito indica una zona de puertos", () => {
    const credito = parseMT700(SWIFT_CSU2025099)!;
    const r = examinarPresentacion({
      lc: credito.lc,
      credito: { ...contextoDesdeSwift(credito), puertoDestino: "EUROPEAN MAIN PORTS" },
      docs: [
        {
          tipo: "BL",
          campos: { ...DOCUMENTOS_CSU2025099.BL!, puertoDestino: { valor: "ROTTERDAM", confianza: 0.9 } },
        },
      ],
      empresaRazonSocial: credito.extra.beneficiario[0] ?? "",
      hoy: new Date(2025, 3, 20),
    });
    expect(sinTraducirEn(r).map((x) => `${x.palabra} en ${x.donde}`)).toEqual([]);
  });

  it.each(CLASES)("ningún hallazgo queda con español: documento de transporte %s", (_nombre, campos) => {
    const sinTraducir = sinTraducirEn(examenConTransporte(campos));
    expect(sinTraducir.map((x) => `${x.palabra} en ${x.donde}`)).toEqual([]);
  });

  it.each(ESCENARIOS)("ningún hallazgo queda con español: %s", (_nombre, hoy, anteriores) => {
    const r = examenEn(hoy, anteriores);
    const sinTraducir = r.reglas
      .map(reglaEnIngles)
      .flatMap((x) => [
        { donde: `regla «${x.regla}»`, palabra: quedaEspanol(x.regla) },
        { donde: `evidencia «${x.evidencia}»`, palabra: quedaEspanol(x.evidencia ?? "") },
      ])
      .filter((x) => x.palabra !== null);

    // El mensaje del fallo dice exactamente qué falta, para que arreglarlo no sea una búsqueda.
    expect(sinTraducir.map((x) => `${x.palabra} en ${x.donde}`)).toEqual([]);
  });

  it("los escenarios no son el mismo examen: cada uno trae reglas que los otros no", () => {
    // Si los tres dieran los mismos hallazgos, cubrir tres no valdría más que cubrir uno.
    const idsDe = (hoy: Date, ant: typeof UN_GIRO_ANTERIOR) =>
      new Set(examenEn(hoy, ant).reglas.map((x) => `${x.id}|${x.estado}`));
    const [a, b, c, d] = ESCENARIOS.map(([, hoy, ant]) => idsDe(hoy, ant));
    expect([...b!].some((x) => !a!.has(x))).toBe(true);
    expect([...c!].some((x) => !b!.has(x))).toBe(true);
    expect([...d!].some((x) => !a!.has(x))).toBe(true);
  });

  it("lo que queda a la persona tampoco", () => {
    const { r } = examenReal();
    const sinTraducir = r.manuales
      .map(manualEnIngles)
      .flatMap((m) => [quedaEspanol(m.que), quedaEspanol(m.porQue)])
      .filter((x) => x !== null);
    expect(sinTraducir).toEqual([]);
  });

  it("y el detector de español no es un colador: reconoce lo que no está traducido", () => {
    // Si `quedaEspanol` devolviera siempre null, los dos tests de arriba pasarían sin hacer nada.
    expect(quedaEspanol("No está en el paquete · 2 originales")).not.toBeNull();
    expect(quedaEspanol("la descripción de la mercadería")).not.toBeNull();
    expect(quedaEspanol("Not in the set · 2 originals")).toBeNull();
    expect(quedaEspanol("Clean transport document")).toBeNull();
  });
});

describe("las citas no se traducen", () => {
  it("lo entrecomillado queda letra por letra", () => {
    // Un aviso de rechazo que reescribiera lo que dice el papel sería inservible: el banco
    // presentador tiene que poder buscar esa frase exacta en su propio juego.
    expect(textoEnIngles('dice "FREIGHT COLLECT"')).toBe('says "FREIGHT COLLECT"');
    expect(textoEnIngles('dice "la mercadería no está a bordo"')).toBe('says "la mercadería no está a bordo"');
  });

  it("varias citas en el mismo texto vuelven cada una a su lugar", () => {
    const t = textoEnIngles('Tipo de bulto: factura comercial dice "BAGS", packing list dice "Bags"');
    expect(t).toBe('Package type: commercial invoice says "BAGS", packing list says "Bags"');
  });

  it("no quedan marcadores de sustitución en el texto", () => {
    const { r } = examenReal();
    const marcador = String.fromCharCode(0);
    for (const x of r.reglas.map(reglaEnIngles)) {
      expect(x.regla).not.toContain(marcador);
      expect(x.evidencia).not.toContain(marcador);
    }
  });
});

describe("el orden de los reemplazos no depende de cómo estén escritos", () => {
  it("una frase entera gana contra las palabras que la componen", () => {
    // Este texto contiene «beneficiario» y «dice», que por separado también se traducen. Si
    // ganaran las palabras, quedaría «Documentos propios con la dirección del beneficiary que
    // says la LC», que es peor que no tocarlo.
    expect(textoEnIngles("Documentos propios con la dirección del beneficiario que dice la LC")).toBe(
      "The beneficiary's own documents show the address stated in the credit",
    );
  });

  it("y las palabras siguen funcionando donde no hay frase que las cubra", () => {
    expect(textoEnIngles('emisor "CEREALSUR S.A" · beneficiario CEREALSUR S.A')).toBe(
      'issuer "CEREALSUR S.A" · beneficiary CEREALSUR S.A',
    );
  });
});

describe("lo que no se toca", () => {
  it("la fuente y el estado son claves, no texto para leer", () => {
    const { r } = examenReal();
    for (const [i, x] of r.reglas.entries()) {
      const t = reglaEnIngles(x);
      expect(t.fuente).toBe(x.fuente);
      expect(t.estado).toBe(x.estado);
      expect(t.id).toBe(r.reglas[i]!.id);
    }
  });

  it("los ítems del 46A ya vienen del crédito en inglés y salen igual", () => {
    expect(textoEnIngles("CERTIFICATE OF URUGUAY ORIGIN IN 02 FOLD")).toBe("CERTIFICATE OF URUGUAY ORIGIN IN 02 FOLD");
    expect(textoEnIngles("PACKING LIST IN 03 FOLD")).toBe("PACKING LIST IN 03 FOLD");
  });

  it("un texto vacío no se rompe", () => {
    expect(textoEnIngles("")).toBe("");
  });
});

describe("los números y las fechas del hallazgo, en inglés", () => {
  /*
   * El diccionario traducía las palabras y dejaba el formato de es-UY: con la interfaz en inglés,
   * un hallazgo decía «the operative credit is for less: 100.000 → 90.000» y «31-dic-25». Un punto
   * de miles donde el lector espera un punto decimal no es una molestia de estilo: «54.150» se lee
   * cincuenta y cuatro con ciento cincuenta milésimas, y el número está en un papel que se cursa a
   * otro banco.
   *
   * Lo que **no** se toca es lo que va entre comillas: ahí está lo que el documento dice, y
   * reformatearlo sería cambiar la cita.
   */
  it("el separador de miles y el decimal se dan vuelta", () => {
    expect(textoEnIngles("el crédito es por 54.150,00 y la factura por 51.262,00")).toContain("54,150.00");
    expect(textoEnIngles("el crédito es por 54.150,00 y la factura por 51.262,00")).toContain("51,262.00");
  });

  it("un decimal con coma pegado a su unidad también", () => {
    expect(textoEnIngles("el certificado declara 61,1 %")).toContain("61.1 %");
  });

  it("los meses de una fecha se escriben en inglés", () => {
    // el año se completa: eso ya lo hacía el diccionario, y conviene que el test lo diga
    expect(textoEnIngles("vence el 31-dic-25")).toContain("31-Dec-2025");
    expect(textoEnIngles("embarque 08-abr-2025")).toContain("08-Apr-2025");
  });

  it("**y lo que está entre comillas queda como está: es lo que dice el papel**", () => {
    const t = textoEnIngles('la factura dice "TOTAL USD 54.150,00 DATED 31-dic-25"');
    expect(t).toContain('"TOTAL USD 54.150,00 DATED 31-dic-25"');
  });

  it("y un número que no es una cifra no se toca", () => {
    // un número de documento o un código no tiene separadores: nada que dar vuelta
    expect(textoEnIngles("el conocimiento número 2301.20.00")).toContain("2301.20.00");
  });
});
