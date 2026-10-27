import { describe, expect, it } from "vitest";
import { aparearConExigencias, type DocCertificado, emisorQueNombra, reglasCertificados } from "./certificados";
import type { CamposDoc } from "./consistencia";
import { SWIFT_CSU2025099 } from "./fixtures";
import { ablandarPorISBP } from "./isbp";
import type { DocAnalizado } from "./presentacion";
import { parseMT700 } from "./swift-lc";
import type { LcInfo } from "./types";

/** Los siete documentos del 46A que hasta ahora solo se contaban como presentes o ausentes. */

const LC = parseMT700(SWIFT_CSU2025099)!.lc;
const EXIGIDOS = LC.documentosExigidos!;
const campo = (valor: string, confianza = 0.95) => ({ valor, confianza });
const vacio = { valor: "", confianza: 0 };

function doc(over: Partial<Record<keyof CamposDoc, { valor: string; confianza: number }>>): CamposDoc {
  return {
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
    ...over,
  } as CamposDoc;
}

const BL: DocAnalizado = { tipo: "BL", campos: doc({ fechaEmbarque: campo("08-APR-2025") }) };
const PACKING: DocAnalizado = { tipo: "PACKING", campos: doc({ pesoBruto: campo("54.040,00 Kgs") }) };
const HOY = new Date(2025, 3, 22);

const correr = (certificados: DocCertificado[], docs: DocAnalizado[] = [BL, PACKING]) =>
  reglasCertificados({ lc: LC, certificados, docs, beneficiario: "CEREALSUR S.A", hoy: HOY });

const exigencia = (re: RegExp) => EXIGIDOS.find((e) => re.test(e))!;

/*
 * Quién emite un certificado NO es quién exporta.
 *
 * El crédito nombra al emisor en seis de sus once documentos: «ISSUED BY CHAMBER OF COMMERCE IN
 * URUGUAY», «ISSUED BY MINISTRY OF LIVESTOCK», «ISSUED BY AN ACCREDITED SURVEYOR». Eso es una
 * exigencia que se verifica, y el motor la verificaba contra el campo `exportador`.
 *
 * En el expediente real eso hacía que las siete reglas dijeran «el documento lo emite YARUS S.A.»
 * — el frigorífico que embarca — para el certificado de la Cámara Mercantil, el del Ministerio y
 * los cuatro de Caliset. Afirmar quién firmó un papel que va al banco, y afirmarlo mal, es peor
 * que decir que no se leyó.
 */
describe("el emisor de un certificado es un dato propio, no el exportador", () => {
  const exigencia = "CERTIFICATE OF ORIGIN ISSUED BY CHAMBER OF COMMERCE IN URUGUAY IN 1 ORIGINAL AND 2 COPIES";

  const correr = (campos: Partial<Record<keyof CamposDoc, { valor: string; confianza: number }>>) =>
    reglasCertificados({
      lc: LC,
      certificados: [{ exigencia, campos: doc(campos) }],
      docs: [],
      beneficiario: "AGROMEALS S.A.",
      hoy: HOY,
    }).find((r) => /lo emite/.test(r.regla));

  it("no dice que lo emite el exportador cuando no se leyó quién lo emite", () => {
    const r = correr({ exportador: campo("YARUS S.A.") });
    expect(r?.evidencia, "YARUS embarca; el certificado de origen lo firma la Cámara").not.toMatch(/YARUS/);
    expect(r?.estado, "sin el dato no se puede dictaminar").toBe("ATENCION");
    expect(r?.evidencia).toMatch(/no se leyó|verificar/i);
  });

  it("y cuando sí se leyó, lo usa", () => {
    const r = correr({
      exportador: campo("YARUS S.A."),
      emisor: campo("CAMARA MERCANTIL DE PRODUCTOS DEL PAIS"),
    });
    expect(r?.evidencia).toMatch(/CAMARA MERCANTIL/);
    expect(r?.evidencia).not.toMatch(/YARUS/);
  });
});

describe("la nota de peso", () => {
  const item = exigencia(/WEIGHT/i);

  it("el crédito real la exige", () => {
    expect(item).toContain("WEIGHT");
  });

  it("si su peso coincide con el del packing, pasa", () => {
    const r = correr([
      { exigencia: item, campos: doc({ pesoBruto: campo("54.040,00 Kgs") }), nombreArchivo: "Weight note" },
    ]);
    const peso = r.find((x) => x.id.startsWith("cert-peso-"));
    expect(peso?.estado).toBe("OK");
  });

  it("si difiere, es discrepancia entre documentos", () => {
    const r = correr([
      { exigencia: item, campos: doc({ pesoBruto: campo("52.000,00 Kgs") }), nombreArchivo: "Weight note" },
    ]);
    const peso = r.find((x) => x.id.startsWith("cert-peso-"));
    expect(peso?.estado).toBe("DISCREPANCIA");
    expect(peso?.evidencia).toContain("54.040");
  });

  it("compara kilos contra toneladas sin confundirse", () => {
    const r = correr([
      { exigencia: item, campos: doc({ pesoBruto: campo("54,04 MT") }), nombreArchivo: "Weight note" },
    ]);
    expect(r.find((x) => x.id.startsWith("cert-peso-"))?.estado).toBe("OK");
  });

  it("sin peso legible avisa en vez de dictaminar", () => {
    const r = correr([{ exigencia: item, campos: doc({}), nombreArchivo: "Weight note" }]);
    expect(r.find((x) => x.id.startsWith("cert-peso-"))?.estado).toBe("ATENCION");
  });
});

describe("el certificado de análisis", () => {
  const item = exigencia(/ANALYSIS/i);

  it("fechado después del embarque no es discrepancia, y queda dicho", () => {
    const r = correr([
      {
        exigencia: item,
        campos: doc({ fechaDocumento: campo("15-APR-2025") }),
        nombreArchivo: "Certificate of analysis",
      },
    ]);
    const fecha = r.find((x) => x.id.startsWith("cert-fecha-"));
    expect(fecha?.estado).toBe("OK");
    expect(fecha?.evidencia).toContain("admitido");
  });

  it("pero si el crédito lo pidiera previo al embarque, entonces sí", () => {
    const r = correr([
      {
        exigencia: "PRE-SHIPMENT INSPECTION CERTIFICATE",
        campos: doc({ fechaDocumento: campo("15-APR-2025") }),
        nombreArchivo: "Inspection",
      },
    ]);
    const previo = r.find((x) => x.id.startsWith("cert-previo-"));
    expect(previo?.estado).toBe("DISCREPANCIA");
  });
});

describe("quién puede emitir cada certificado", () => {
  /* El emisor va en su campo propio: `exportador` es quien embarca, y usarlo acá hacía que el
     motor afirmara que el certificado de la Cámara Mercantil lo firmaba el frigorífico. */
  it("si el crédito nombra al emisor, tiene que ser ese", () => {
    const r = correr([
      {
        exigencia: "CERTIFICATE OF ANALYSIS ISSUED BY CALISET",
        campos: doc({ emisor: campo("OTRO LABORATORIO SRL") }),
        nombreArchivo: "Analysis",
      },
    ]);
    expect(r.find((x) => x.id.startsWith("cert-emisor-"))?.estado).toBe("DISCREPANCIA");
  });

  it("y si es el que nombra, pasa aunque abrevie la forma societaria", () => {
    const r = correr([
      {
        exigencia: "CERTIFICATE OF ANALYSIS ISSUED BY CALISET LIMITED",
        campos: doc({ emisor: campo("CALISET LTD") }),
        nombreArchivo: "Analysis",
      },
    ]);
    expect(r.find((x) => x.id.startsWith("cert-emisor-"))?.estado).toBe("OK");
  });

  it("un certificado «independiente» no lo puede emitir el beneficiario", () => {
    const r = correr([
      {
        exigencia: "INDEPENDENT INSPECTION CERTIFICATE",
        campos: doc({ emisor: campo("CEREALSUR S.A") }),
        nombreArchivo: "Inspection",
      },
    ]);
    expect(r.find((x) => x.id.startsWith("cert-emisor-"))?.estado).toBe("DISCREPANCIA");
  });

  it("emitido por un tercero, pasa", () => {
    const r = correr([
      {
        exigencia: "INDEPENDENT INSPECTION CERTIFICATE",
        campos: doc({ emisor: campo("CALISET S.A.") }),
        nombreArchivo: "Inspection",
      },
    ]);
    expect(r.find((x) => x.id.startsWith("cert-emisor-"))?.estado).toBe("OK");
  });
});

describe("el certificado de origen", () => {
  // ojo: /ORIGIN/ a secas agarra el ítem del conocimiento, porque "ORIGINAL BILLS OF
  // LADING" contiene la palabra. Hay que pedir el límite de palabra.
  const item = exigencia(/\bORIGIN\b/i);

  it("«ORIGINAL BILLS OF LADING» no es un certificado de origen", () => {
    const delBl = EXIGIDOS.find((e) => /ORIGINAL BILLS/i.test(e))!;
    const r = correr([{ exigencia: delBl, campos: doc({ puertoEmbarque: campo("URUGUAY") }) }]);
    expect(r.some((x) => x.id.startsWith("cert-origen-"))).toBe(false);
  });

  it("el crédito pide origen uruguayo y el documento lo dice", () => {
    const r = correr([
      { exigencia: item, campos: doc({ puertoEmbarque: campo("URUGUAY") }), nombreArchivo: "Certificate of origin" },
    ]);
    expect(r.find((x) => x.id.startsWith("cert-origen-"))?.estado).toBe("OK");
  });

  it("si no se leyó el origen, queda para verificar", () => {
    const r = correr([{ exigencia: item, campos: doc({}), nombreArchivo: "Certificate of origin" }]);
    expect(r.find((x) => x.id.startsWith("cert-origen-"))?.estado).toBe("ATENCION");
  });
});

describe("los certificados del beneficiario", () => {
  it("siempre quedan para leer a mano, con el plazo que el crédito fija", () => {
    const item = EXIGIDOS.find((e) => /EMAILED/i.test(e))!;
    const r = correr([{ exigencia: item, campos: doc({}), nombreArchivo: "Beneficiary certificate" }]);
    const b = r.find((x) => x.id.startsWith("cert-benef-"));
    expect(b?.estado).toBe("ATENCION");
    expect(b?.regla).toContain("21 días");
  });
});

describe("aparear los documentos con lo que el crédito exige", () => {
  it("empareja cada documento con su ítem del 46A", () => {
    const r = aparearConExigencias(LC, [
      { tipo: "WEIGHT NOTE", campos: doc({}) },
      { tipo: "CERTIFICATE OF ANALYSIS", campos: doc({}) },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]!.exigencia).toContain("WEIGHT");
    expect(r[1]!.exigencia).toContain("ANALYSIS");
  });

  it("no usa dos veces la misma exigencia", () => {
    const r = aparearConExigencias(LC, [
      { tipo: "WEIGHT NOTE", campos: doc({}) },
      { tipo: "WEIGHT NOTE", campos: doc({}) },
    ]);
    expect(r).toHaveLength(1);
  });

  it("un documento que el crédito no pide no se aparea con nada", () => {
    expect(aparearConExigencias(LC, [{ tipo: "SOMETHING ELSE", campos: doc({}) }])).toEqual([]);
  });
});

describe("el emisor que el crédito nombra, cuando el papel lo escribe de otra forma", () => {
  /*
   * El crédito real exige el certificado veterinario «ISSUED BY GOVT.VETERINERY AUTHORITY IN
   * URUGUAY». Dos cosas pasaban con eso, y las dos rechazaban un certificado correcto.
   *
   * La primera: el nombre se cortaba en el primer punto, así que el emisor exigido quedaba en
   * «GOVT». En SWIFT las abreviaturas van pegadas —«GOVT.», «CO.LTD»— y ese punto no termina nada.
   *
   * La segunda es de fondo. Un organismo oficial casi nunca se llama como el crédito lo describe:
   * la autoridad veterinaria de Uruguay es el Ministerio de Ganadería, Agricultura y Pesca, que no
   * comparte una palabra con el texto del crédito. Comparar literales y declarar discrepancia es
   * afirmar lo que no se sabe. Lo que el motor **sí** puede decidir es un caso: que lo haya emitido
   * el propio beneficiario cuando el crédito nombra a un tercero.
   */
  const EXIGE_VETERINARIO =
    "INTERNATIONAL VETERINARY HEALTH CERTIFICATE ISSUED BY GOVT.VETERINERY AUTHORITY IN URUGUAY.";

  const conEmisor = (emisor: string, exigencia = EXIGE_VETERINARIO) =>
    reglasCertificados({
      lc: LC,
      docs: [],
      beneficiario: "CEREALSUR S.A",
      hoy: new Date(2025, 3, 20),
      certificados: [{ exigencia, campos: doc({ emisorSeguro: { valor: emisor, confianza: 0.9 } }) }],
    }).find((x) => x.id.startsWith("cert-emisor"));

  it("el nombre del emisor exigido no se corta en la abreviatura", () => {
    expect(emisorQueNombra(EXIGE_VETERINARIO)).toBe("GOVT.VETERINERY AUTHORITY IN URUGUAY");
  });

  it("pero sí en una coma, que ahí el nombre terminó", () => {
    expect(emisorQueNombra("CERTIFICATE ISSUED BY CHAMBER OF COMMERCE, MONTEVIDEO")).toBe("CHAMBER OF COMMERCE");
  });

  /*
   * Y el punto que **cierra** la abreviatura antes de un espacio, que se comía la alternativa entera.
   *
   * El 46A enmendado del laudo DOCDEX 249 pide el certificado de calidad «ISSUED BY S.G.S. OR [el
   * beneficiario]», y la captura devolvía **«S.G.S»**: admitía el punto pegado a la letra siguiente
   * —«GOVT.VETERINERY»— y no el que cierra la abreviatura. Con la alternativa perdida, el certificado
   * emitido por el beneficiario —que el crédito **admite expresamente**— salía en DISCREPANCIA con «lo
   * emite el beneficiario y el crédito nombra a un tercero».
   *
   * Quinta vez que el punto de una abreviatura rompe algo en este motor.
   */
  it("ni el punto que cierra la abreviatura, que se llevaba la alternativa del emisor", () => {
    expect(
      emisorQueNombra(
        "CERTIFICATE OF QUALITY ISSUED BY S.G.S. OR EASTERN ORE EXPORTS PVT LTD AT LOADING PORT SHOWING ACTUAL RESULTS",
      ),
    ).toBe("S.G.S. OR EASTERN ORE EXPORTS PVT LTD AT LOADING PORT");
    expect(emisorQueNombra("CERTIFICATE ISSUED BY A. SMITH AND CO LTD")).toBe("A. SMITH AND CO LTD");
  });

  /* Y el punto que sí termina una frase sigue terminándola: detrás de una palabra, no de una letra. */
  it("y el punto detrás de una palabra sigue cerrando el nombre", () => {
    expect(emisorQueNombra("CERTIFICATE ISSUED BY CALISET. THE CERTIFICATE MUST SHOW THE RESULTS")).toBe("CALISET");
  });

  /*
   * Y el certificado que el crédito admite del beneficiario, con la alternativa entera, cumple.
   *
   * Es el caso del laudo DOCDEX 249: sin el arreglo de arriba, esto es una DISCREPANCIA sobre el papel
   * que el crédito pidió.
   */
  it("un emisor que es la segunda alternativa del crédito cumple, aunque sea el beneficiario", () => {
    const r = conEmisor(
      "CEREALSUR S.A",
      "CERTIFICATE OF QUALITY ISSUED BY S.G.S. OR CEREALSUR S.A AT LOADING PORT SHOWING ACTUAL RESULTS",
    );
    expect(r?.estado).toBe("OK");
  });

  it("escrito igual, cumple", () => {
    expect(conEmisor("GOVT.VETERINERY AUTHORITY IN URUGUAY")?.estado).toBe("OK");
  });

  it("el mismo organismo escrito sin abreviar, también", () => {
    // «GOVERNMENT VETERINARY AUTHORITY OF URUGUAY» es el mismo que «GOVT.VETERINERY AUTHORITY IN
    // URUGUAY»: abreviatura (ISBP A1) y error de tipeo del propio crédito (A23).
    expect(conEmisor("GOVERNMENT VETERINARY AUTHORITY OF URUGUAY")?.estado).not.toBe("DISCREPANCIA");
  });

  it("un organismo que no se parece al texto del crédito va a verificar, no a discrepancia", () => {
    /*
     * Este es el falso positivo que importa. El Ministerio de Ganadería es quien firma de verdad
     * esos certificados en Uruguay, y no comparte ninguna palabra con «GOVT.VETERINERY AUTHORITY».
     * El motor no tiene un catálogo de organismos oficiales, así que no puede afirmar que esté mal.
     */
    const r = conEmisor("MINISTERIO DE GANADERIA, AGRICULTURA Y PESCA");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toMatch(/verificar|comprobar/i);
    // y la evidencia deja los dos nombres a la vista, que es con qué la persona decide
    expect(r?.evidencia).toMatch(/MINISTERIO/);
  });

  it("pero si lo emitió el propio beneficiario, eso sí es discrepancia", () => {
    // Acá no hay nada que averiguar: el crédito nombra a un tercero y el papel lo firma el que
    // presenta. Es el único caso que el motor puede decidir solo.
    const r = conEmisor("CEREALSUR S.A");
    expect(r?.estado).toBe("DISCREPANCIA");
    expect(r?.evidencia).toMatch(/beneficiario/i);
  });
});

describe("quién emite, con las redacciones que los créditos usan de verdad", () => {
  /*
   * Seis casos, todos de redacción corriente del 46A, y en los seis el papel cumplía y el motor
   * daba DISCREPANCIA. Tienen cuatro causas distintas:
   *
   * 1. El nombre del emisor se llevaba la frase entera: «ISSUED BY CARRIER OR ITS AGENT STATING
   *    THE VESSEL AGE» daba como emisor exigido «CARRIER OR ITS AGENT STATING THE VESSEL AGE».
   * 2. Cuando el crédito nombra **al beneficiario** como emisor, que lo emitiera el beneficiario
   *    disparaba «lo emite el beneficiario y el crédito nombra a un tercero». No nombra a un
   *    tercero: lo nombra a él.
   * 3. Una alternativa —«ISSUED BY SGS OR INTERTEK»— se comparaba como un nombre solo.
   * 4. Los roles del comercio —carrier, shipper, manufacturer, surveyor— no estaban en la lista de
   *    funciones, así que se trataban como nombres propios de empresa.
   */
  const emisorDe = (exigencia: string, emisor: string) =>
    reglasCertificados({
      lc: LC,
      docs: [],
      beneficiario: "CEREALSUR S.A",
      hoy: new Date(2025, 3, 20),
      certificados: [{ exigencia, campos: doc({ emisorSeguro: { valor: emisor, confianza: 0.9 } }) }],
    }).find((x) => x.id.startsWith("cert-emisor"));

  it("si el crédito nombra al beneficiario, que lo emita el beneficiario cumple", () => {
    const r = emisorDe("+9)CERTIFICATE ISSUED BY BENEFICIARY CONFIRMING ALL CHARGES SETTLED.", "CEREALSUR S.A");
    expect(r?.estado).toBe("OK");
  });

  it("un «beneficiary's certificate» no se vuelve ajeno porque mencione un agente local", () => {
    // El calificativo del Q5 tiene que calificar al emisor, no aparecer en cualquier parte de la
    // línea: «APPLICANT'S LOCAL AGENT» describe a quién se le manda la copia.
    const r = emisorDe(
      "+10)BENEFICIARY'S CERTIFICATE CONFIRMING COPY DOCUMENTS SENT TO APPLICANT'S LOCAL AGENT IN COLOMBO.",
      "CEREALSUR S.A",
    );
    expect(r?.estado).not.toBe("DISCREPANCIA");
  });

  it("una alternativa se cumple con cualquiera de las dos", () => {
    expect(emisorDe("+8)CERTIFICATE OF ANALYSIS ISSUED BY SGS OR INTERTEK", "SGS URUGUAY S.A.")?.estado).toBe("OK");
    expect(emisorDe("+8)CERTIFICATE OF ANALYSIS ISSUED BY SGS OR INTERTEK", "INTERTEK TESTING SERVICES")?.estado).toBe(
      "OK",
    );
  });

  it("y si no es ninguna de las dos, sigue habiendo algo que mirar", () => {
    expect(emisorDe("+8)CERTIFICATE OF ANALYSIS ISSUED BY SGS OR INTERTEK", "OTRO LABORATORIO SRL")?.estado).not.toBe(
      "OK",
    );
  });

  it.each([
    [
      "+11)SHIPPING COMPANY CERTIFICATE ISSUED BY CARRIER OR ITS AGENT STATING THE VESSEL AGE",
      "OCEANLINE URUGUAY S.A.",
    ],
    ["+8)CERTIFICATE OF ANALYSIS ISSUED BY MANUFACTURER", "MOLSUR S.A."],
    ["+12)PACKING DECLARATION ISSUED BY SHIPPER", "MOLSUR S.A."],
  ])("un rol del comercio no es un nombre propio: «%s»", (exigencia, emisor) => {
    // El motor no tiene cómo saber qué empresa es el carrier o el fabricante de esta operación, así
    // que lo deja a la vista para que lo mire una persona en vez de rechazarlo.
    expect(emisorDe(exigencia, emisor)?.estado).toBe("ATENCION");
  });

  it("«issued by an independent surveyor» sí se puede decidir, y cumple", () => {
    /*
     * Este no va a verificar y es correcto que no: «independent» es el calificativo del Q5, así
     * que lo que el crédito pide es cualquiera **menos** el beneficiario. Control Union no es el
     * beneficiario, con lo cual cumple, y eso el motor lo sabe sin ayuda.
     */
    expect(
      emisorDe("+11)INSPECTION CERTIFICATE ISSUED BY AN INDEPENDENT SURVEYOR", "CONTROL UNION URUGUAY")?.estado,
    ).toBe("OK");
  });

  it("y el mismo, emitido por el beneficiario, no", () => {
    expect(emisorDe("+11)INSPECTION CERTIFICATE ISSUED BY AN INDEPENDENT SURVEYOR", "CEREALSUR S.A")?.estado).toBe(
      "DISCREPANCIA",
    );
  });

  it("pero un laboratorio nombrado por su nombre sigue siendo tajante", () => {
    // El caso que no se puede perder: el crédito nombró CALISET y el papel es de otro.
    expect(emisorDe("+8)CERTIFICATE OF ANALYSIS ISSUED BY CALISET", "OTRO LABORATORIO SRL")?.estado).toBe(
      "DISCREPANCIA",
    );
  });

  it("y el nombre del emisor exigido no se lleva la frase entera", () => {
    expect(emisorQueNombra("+11)CERTIFICATE ISSUED BY CARRIER OR ITS AGENT STATING THE VESSEL AGE")).toBe(
      "CARRIER OR ITS AGENT",
    );
  });
});

describe("lo que el certificado declara no sale de cómo se llama el documento", () => {
  /*
   * La pantalla pasa `nombreArchivo` con la línea del 46A —es lo que el examinador ve como título
   * de la casilla— y ese texto entraba como contenido del papel. Con un crédito que pide «ANALYSIS
   * CERTIFICATE SHOWING PROTEIN 54 PCT» y la calidad todavía sin cargar, el motor leía la exigencia
   * del banco emisor y la devolvía como resultado del análisis: CUMPLE contra un papel vacío.
   */
  const EX = "+8)ANALYSIS CERTIFICATE SHOWING PROTEIN 54 PCT";

  const correrUno = (campos: CamposDoc, nombreArchivo?: string) =>
    reglasCertificados({
      lc: { ...LC, documentosExigidos: [EX] },
      docs: [],
      mercaderiaDelCredito: "57 MTS OF FISH MEAL 54PCT MIN",
      hoy: new Date(2025, 3, 20),
      certificados: [{ exigencia: EX, nombreArchivo, campos }],
    }).filter((x) => x.id.includes("spec"));

  it("sin la calidad cargada, no hay nada que comparar", () => {
    const r = correrUno(doc({}), "ANALYSIS CERTIFICATE SHOWING PROTEIN 54 PCT");
    expect(r.every((x) => x.estado !== "OK")).toBe(true);
  });

  it("con la calidad cargada, compara contra eso", () => {
    const r = correrUno(doc({ mercaderia: { valor: "PROTEIN 61,1 PCT", confianza: 0.9 } }));
    expect(r[0]?.estado).toBe("OK");
    expect(r[0]?.evidencia).toMatch(/61,1/);
  });
});

describe("el peso de la nota, con la unidad donde los papeles la escriben", () => {
  /*
   * La unidad se buscaba en todo el texto, con un patrón abierto por la derecha: «**T**OTAL GROSS
   * WEIGHT 54.040 KGS» multiplicaba por mil porque la «T» de «TOTAL» alcanzaba. Cincuenta y cuatro
   * toneladas se volvían cincuenta y cuatro mil y la nota de peso correcta salía discrepante contra
   * el packing.
   *
   * El campo todavía no se carga desde la pantalla, así que esto no estaba rechazando nada hoy —y
   * es justamente por eso que conviene arreglarlo antes de agregar la casilla.
   */
  const conPeso = (nota: string, packing: string) =>
    reglasCertificados({
      lc: LC,
      docs: [{ tipo: "PACKING", campos: doc({ pesoBruto: { valor: packing, confianza: 0.9 } }) }],
      hoy: new Date(2025, 3, 20),
      certificados: [
        { exigencia: "+5)WEIGHT NOTE IN 03 FOLD.", campos: doc({ pesoBruto: { valor: nota, confianza: 0.9 } }) },
      ],
    }).find((x) => x.id.startsWith("cert-peso"));

  it.each([
    ["TOTAL GROSS WEIGHT 54.040 KGS", "54.040 KGS"],
    ["THE GROSS WEIGHT IS 54.040 KGS", "54.040 KGS"],
    ["54.040 KGS (54,04 MT)", "54.040 KGS"],
    ["NET 54.040 KGS", "TOTAL 54.040 KGS"],
  ])("«%s» contra «%s» coincide", (nota, packing) => {
    expect(conPeso(nota, packing)?.estado).toBe("OK");
  });

  it("y una tonelada sigue siendo mil kilos", () => {
    expect(conPeso("54,04 MT", "54.040 KGS")?.estado).toBe("OK");
    expect(conPeso("57 TONS", "57.000 KGS")?.estado).toBe("OK");
  });

  it("un peso que de verdad no coincide sigue siendo discrepancia", () => {
    expect(conPeso("48.000 KGS", "54.040 KGS")?.estado).toBe("DISCREPANCIA");
  });
});

describe("un certificado que acredita un hecho anterior al embarque", () => {
  /*
   * La regla se llama «acredita un hecho anterior al embarque» y cita ISBP 821 A12b, pero comparaba
   * la fecha de **emisión** con la del a bordo. Un certificado de inspección pre-embarque emitido el
   * 10 por una inspección hecha el 7 cumple el párrafo citado, y salía DISCREPANCIA.
   *
   * La emisión posterior al embarque no prueba que el hecho fuera posterior. Cuando el documento
   * dice cuándo ocurrió, se usa esa fecha; cuando no lo dice, el motor no puede decidir y lo deja a
   * la vista, que es distinto de rechazarlo.
   */
  const EX = "+11)PRE-SHIPMENT INSPECTION CERTIFICATE ISSUED BY SGS";

  const correr = (fechaDocumento: string, queCertifica = "") =>
    reglasCertificados({
      lc: LC,
      docs: [{ tipo: "BL", campos: doc({ fechaEmbarque: { valor: "08-abr-25", confianza: 0.9 } }) }],
      hoy: new Date(2025, 3, 20),
      certificados: [
        {
          exigencia: EX,
          campos: doc({
            fechaDocumento: { valor: fechaDocumento, confianza: 0.9 },
            mercaderia: { valor: queCertifica, confianza: queCertifica ? 0.9 : 0 },
          }),
        },
      ],
    }).find((x) => x.id.startsWith("cert-previo"));

  it("emitido antes del embarque, cumple", () => {
    expect(correr("05-abr-25")?.estado).toBe("OK");
  });

  it("emitido después pero declarando la inspección anterior, también", () => {
    const r = correr("10-abr-25", "INSPECTION CARRIED OUT AT MONTEVIDEO ON 07-abr-25 PRIOR TO LOADING");
    expect(r?.estado).toBe("OK");
    expect(r?.evidencia).toMatch(/07/);
  });

  it("emitido después y sin decir cuándo fue la inspección, sigue siendo discrepancia", () => {
    /*
     * Y no por la fecha de emisión en sí: porque el documento no evidencia que el hecho fuera
     * previo, y un banco examina lo que el documento dice. La evidencia lo explica, así que el
     * examinador puede levantarla si tiene el dato. Afinar esto más necesita el texto de la ISBP
     * 821, que no está comprada.
     */
    const r = correr("10-abr-25");
    expect(r?.estado).toBe("DISCREPANCIA");
    expect(r?.evidencia).toMatch(/no dice cu[aá]ndo/i);
  });

  it("y si el hecho declarado es posterior al embarque, sí es discrepancia", () => {
    const r = correr("12-abr-25", "INSPECTION CARRIED OUT ON 11-abr-25");
    expect(r?.estado).toBe("DISCREPANCIA");
  });
});

describe("el certificado de origen y dónde está escrito el origen", () => {
  /*
   * El lugar tenía prioridad sobre los demás campos y los tapaba: un certificado que dice «COUNTRY
   * OF ORIGIN: URUGUAY» en su texto y «MONTEVIDEO» en el lugar salía a verificar **mostrando
   * «MONTEVIDEO»** como evidencia — el campo equivocado, sobre un documento que sí decía el origen.
   */
  const correrOrigen = (campos: Partial<CamposDoc>) =>
    reglasCertificados({
      lc: LC,
      docs: [],
      hoy: new Date(2025, 3, 20),
      certificados: [{ exigencia: "+3)CERTIFICATE OF URUGUAY ORIGIN IN 02 FOLD", campos: doc(campos) }],
    }).find((x) => x.id.startsWith("cert-origen"));

  it("lo encuentra en el texto aunque el lugar diga otra cosa", () => {
    const r = correrOrigen({
      mercaderia: campo("FISH MEAL — COUNTRY OF ORIGIN: URUGUAY"),
      puertoEmbarque: campo("MONTEVIDEO"),
    });
    expect(r?.estado).toBe("OK");
    expect(r?.evidencia).toMatch(/URUGUAY/);
  });

  it("y en el lugar cuando ahí está", () => {
    expect(correrOrigen({ puertoEmbarque: campo("MONTEVIDEO, URUGUAY") })?.estado).toBe("OK");
  });

  it("si no está en ninguno, va a verificar mostrando lo que sí se leyó", () => {
    const r = correrOrigen({ puertoEmbarque: campo("MONTEVIDEO"), mercaderia: campo("FISH MEAL") });
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toMatch(/MONTEVIDEO/);
    expect(r?.evidencia).toMatch(/verificar/);
  });

  /*
   * El país pegado con guion a otro no indica el origen (Opinión TA 864rev)
   *
   * El certificado del acuerdo China-Australia certifica que la mercadería «comply with the origin
   * requirements of the China-Australia Free Trade Agreement», así que el nombre del país está en el
   * papel **dentro del nombre del acuerdo**. `new RegExp(pais, "i")` era una subcadena suelta y lo daba
   * por bueno; la ICC lo desarma en una línea: esa frase *«could mean any number of origins being
   * applicable»*.
   */
  describe("el país dentro del nombre de un acuerdo (TA 864rev)", () => {
    const correrAU = (campos: Partial<CamposDoc>) =>
      reglasCertificados({
        lc: LC,
        docs: [],
        hoy: new Date(2017, 2, 22),
        certificados: [{ exigencia: "+3)CERTIFICATE OF AUSTRALIA ORIGIN OF THE COMMODITY", campos: doc(campos) }],
      }).find((x) => x.id.startsWith("cert-origen"));

    const CUERPO =
      "FEED BARLEY IN BULK · THE DESCRIBED GOODS COMPLY WITH THE ORIGIN REQUIREMENTS OF THE CHINA-AUSTRALIA FREE TRADE AGREEMENT";

    it("«CHINA-AUSTRALIA» no es una indicación de origen australiano", () => {
      const r = correrAU({ mercaderia: campo(CUERPO) });
      expect(r?.estado).toBe("ATENCION");
      expect(r?.evidencia).toMatch(/TA 864rev/);
    });

    it("pero una mención suelta del mismo país en el mismo texto sí alcanza", () => {
      expect(correrAU({ mercaderia: campo(`${CUERPO} · COUNTRY OF ORIGIN: AUSTRALIA`) })?.estado).toBe("OK");
    });

    /*
     * El criterio de origen del propio formulario, que la ICC **admite**: «or any indication of the
     * origin criterion which currently allows "WO", "WP" or "PSR"». Lo que no dice es que el acrónimo
     * signifique este país, así que se verifica y no se concluye.
     */
    it("el acrónimo del formulario va a verificar nombrando la Opinión", () => {
      const r = correrAU({ mercaderia: campo("FEED BARLEY IN BULK · ORIGIN CRITERION: WO") });
      expect(r?.estado).toBe("ATENCION");
      expect(r?.evidencia).toMatch(/WO/);
      expect(r?.evidencia).toMatch(/TA 864rev/);
    });

    /*
     * Y el freno, que es el que hizo descartar el veredicto de rechazo.
     *
     * TA 864rev concluye que la discrepancia **vale**, y el primer intento fue poner DISCREPANCIA
     * cuando el texto está cargado y no nombra el origen. Lo puso rojo el test de arriba —«FISH MEAL»
     * con el lugar «MONTEVIDEO»— y tiene razón: un campo de mercadería con el nombre del producto no
     * prueba que el papel no diga el origen, prueba que nadie lo extrajo. Es la ambigüedad de la
     * Opinión TA 862 una capa más adentro, y resolverla necesita el tercer estado del esquema.
     */
    it("y nunca rechaza, aunque la Opinión diga que la discrepancia vale", () => {
      for (const campos of [{ mercaderia: campo(CUERPO) }, { mercaderia: campo("FEED BARLEY IN BULK") }, {}])
        expect(correrAU(campos)?.estado).not.toBe("DISCREPANCIA");
    });
  });
});

describe("la fecha del hecho, cuando el certificado trae varias", () => {
  /*
   * `fechaDelHecho` tomaba **la primera fecha del texto**, y un certificado imprime su propio número
   * y fecha antes del cuerpo. Con eso:
   *
   * - un certificado que dice «CERTIFICATE NO. 4471 DATED 10-APR-2025. INSPECTION CARRIED OUT ON
   *   07-APR-2025 PRIOR TO LOADING» daba DISCREPANCIA **y afirmaba en la evidencia que el hecho era
   *   del 10**, que es una afirmación falsa sobre el papel;
   * - y al revés, cualquier fecha anterior suelta en el texto —la del crédito, por ejemplo— lo daba
   *   por bueno.
   *
   * La fecha que importa es la del **hecho**, y el papel la nombra: «carried out on», «inspected
   * on», «issued at … on». Si no se puede saber cuál es, no se elige.
   */
  const EX = "+11)PRE-SHIPMENT INSPECTION CERTIFICATE ISSUED BY SGS";

  const correrTexto = (queCertifica: string, fechaDocumento = "15-abr-25") =>
    reglasCertificados({
      lc: LC,
      docs: [{ tipo: "BL", campos: doc({ fechaEmbarque: { valor: "08-abr-25", confianza: 0.9 } }) }],
      hoy: new Date(2025, 3, 20),
      certificados: [
        {
          exigencia: EX,
          campos: doc({
            fechaDocumento: { valor: fechaDocumento, confianza: 0.9 },
            mercaderia: { valor: queCertifica, confianza: 0.9 },
          }),
        },
      ],
    }).find((x) => x.id.startsWith("cert-previo"));

  it("la fecha propia del certificado no se toma por la del hecho", () => {
    const r = correrTexto(
      "CERTIFICATE NO. 4471 DATED 15-abr-25. INSPECTION CARRIED OUT AT MONTEVIDEO ON 07-abr-25 PRIOR TO LOADING.",
    );
    expect(r?.estado).toBe("OK");
    expect(r?.evidencia).toMatch(/07/);
  });

  it("y una fecha suelta que no nombra el hecho no lo da por bueno", () => {
    // La fecha del crédito en el encabezado del certificado no dice cuándo se inspeccionó.
    const r = correrTexto("ISSUED UNDER L/C LCMRDN25000471 DATED 20-mar-25. GOODS IN GOOD ORDER.");
    expect(r?.estado).toBe("DISCREPANCIA");
    expect(r?.evidencia).toMatch(/no dice cu[aá]ndo/i);
  });

  it("el hecho nombrado y posterior al embarque sigue siendo discrepancia", () => {
    expect(correrTexto("INSPECTION CARRIED OUT ON 11-abr-25.")?.estado).toBe("DISCREPANCIA");
  });
});

describe("el calificativo del Q5 dentro de un «issued by»", () => {
  /*
   * `emisorAdmitido` mira el tramo que sigue a «issued by» entero, así que un certificado que el
   * crédito le pide **al beneficiario** y que de paso menciona un «local agent» quedaba clasificado
   * como «cualquiera menos el beneficiario» — y salía discrepante por estar emitido por quien el
   * crédito nombró. Es el mismo defecto que ya se arregló para la forma sin «issued by».
   */
  it("un certificado pedido al beneficiario no se vuelve ajeno por mencionar un agente local", () => {
    const r = reglasCertificados({
      lc: LC,
      docs: [],
      beneficiario: "CEREALSUR S.A",
      hoy: new Date(2025, 3, 20),
      certificados: [
        {
          exigencia:
            "CERTIFICATE ISSUED BY BENEFICIARY CERTIFYING THAT ONE SET OF NON-NEGOTIABLE DOCUMENTS HAS BEEN SENT TO APPLICANT'S LOCAL AGENT IN COLOMBO",
          campos: doc({ emisorSeguro: { valor: "CEREALSUR S.A", confianza: 0.9 } }),
        },
      ],
    }).find((x) => x.id.startsWith("cert-emisor"));
    expect(r?.estado).not.toBe("DISCREPANCIA");
  });

  it("pero «issued by an independent surveyor» sigue excluyendo al beneficiario", () => {
    const r = reglasCertificados({
      lc: LC,
      docs: [],
      beneficiario: "CEREALSUR S.A",
      hoy: new Date(2025, 3, 20),
      certificados: [
        {
          exigencia: "INSPECTION CERTIFICATE ISSUED BY AN INDEPENDENT SURVEYOR",
          campos: doc({ emisorSeguro: { valor: "CEREALSUR S.A", confianza: 0.9 } }),
        },
      ],
    }).find((x) => x.id.startsWith("cert-emisor"));
    expect(r?.estado).toBe("DISCREPANCIA");
  });
});

describe("cómo un certificado nombra la fecha de lo que acredita", () => {
  /*
   * La regla de la mañana solo reconocía **verbos**, y los formularios usan sustantivos.
   *
   * «DATE OF INSPECTION: 07-APR-2025» es la forma más común de todas —un formulario con su
   * etiqueta— y no entraba, así que el certificado salía discrepante **y la evidencia decía «no
   * dice cuándo ocurrió lo que acredita»** sobre un papel que lo dice en su primera línea. Afirmar
   * eso sobre el documento es peor que la discrepancia misma.
   *
   * Y la otra mitad tampoco funcionaba: la ventana de cuarenta caracteres cruzaba el punto, así que
   * «SAMPLES TAKEN. L/C DATED 20-MAR. INSPECTION ON 11-APR» tomaba la fecha del crédito por la del
   * hecho y daba el certificado por bueno. El hecho fue el 11, posterior al embarque.
   */
  const EXIGENCIA = "PRE-SHIPMENT INSPECTION CERTIFICATE ISSUED BY SGS";
  /*
   * La fecha del certificado va en **sus campos**, no en el input.
   *
   * La primera versión de este bloque la pasaba como `fechaDocumento` del input, que es la de la
   * factura: `fd` quedaba nulo y los cuatro casos caían en la rama «falta la fecha del certificado
   * o la del embarque», o sea que tres de ellos pasaban en verde sin tocar la regla que dicen
   * probar. Se vio imprimiendo la salida, no leyendo el test.
   */
  const correr = (mercaderia: string) =>
    reglasCertificados({
      certificados: [
        {
          exigencia: EXIGENCIA,
          campos: {
            mercaderia: { valor: mercaderia, confianza: 1 },
            emisorSeguro: { valor: "SGS", confianza: 1 },
            fechaDocumento: { valor: "15-abr-25", confianza: 1 },
          },
          nombreArchivo: "insp.pdf",
        },
      ],
      exigencias: [EXIGENCIA],
      /*
       * La fecha de embarque sale del conocimiento, no de un parámetro.
       *
       * Pasarla como `fechaEmbarque` del input no hacía nada: `reglasCertificados` la lee del BL que
       * viene en `docs`. Sin ella los cuatro casos caían en «falta la fecha del certificado o la del
       * embarque», que es la segunda vez que este bloque pasaba en verde sin tocar la regla.
       */
      docs: [{ tipo: "BL", campos: { fechaEmbarque: { valor: "08-abr-25", confianza: 1 } }, nombreArchivo: "bl.pdf" }],
    } as never).find((r) => r.id.startsWith("cert-previo"));

  it.each([
    "DATE OF INSPECTION: 07-abr-25. GOODS FOUND IN GOOD CONDITION PRIOR TO LOADING.",
    "INSPECTION DATE 07-abr-25 AT MONTEVIDEO PORT. QUANTITY 57 MT.",
    "SAMPLING DATE: 07-abr-25. FUMIGATION DATE: 07-abr-25.",
  ])("«%s» dice cuándo ocurrió", (texto) => {
    expect(correr(texto)?.estado, "el papel lo dice y el motor dijo que no").not.toBe("DISCREPANCIA");
  });

  it("**y una fecha de otra cosa, detrás de un punto, no es la del hecho**", () => {
    const r = correr("SAMPLES TAKEN. L/C DATED 20-mar-25. INSPECTION ON 11-abr-25.");
    expect(r?.estado, "tomó la fecha del crédito por la del hecho").toBe("DISCREPANCIA");
    expect(r?.evidencia).toContain("11-abr-25");
  });
});

/**
 * El número del crédito en los papeles que NO están en la matriz.
 *
 * La regla hermana, en `presentacion.ts`, corre sobre la factura, el packing, el conocimiento y la
 * LC. Pero un shipment notice, una carta de presentación y los certificados de un tercero entran
 * por acá — y de las tres observaciones que un banco levantó sobre una presentación real, **dos
 * eran ésta, y las dos sobre papeles que pasan por acá**. El motor no veía ninguna.
 *
 * El crédito de ese caso no exigía la cita en todos los documentos: la pedía en el 46A para la
 * factura. Por eso la discrepancia no puede colgar de «el crédito lo pidió» —se habría quedado
 * muda— sino del artículo 14 (d): un dato que contradice al crédito es conflicto, lo pida quien lo
 * pida.
 */
describe("el número del crédito en un papel del 46A", () => {
  const lcCon = (cond: string[], exigidos: string[] = []) =>
    ({
      numero: "LCMRDN25000471",
      condicionesAdicionales: cond,
      documentosExigidos: exigidos,
    }) as unknown as LcInfo;

  /*
   * La `exigencia` del certificado **es** su línea del 46A —la pantalla la copia de ahí— así que es
   * donde se lee si el crédito le pide a ESTE papel que cite el número (laudo DOCDEX 207).
   */
  const EXIGENCIA = "11. SHIPMENT NOTICE IN 1 COPY INDICATING THAT HAS EMAILED APPLICANT";

  const correr = (numeroEnElPapel: string | null, lc: LcInfo, exigencia = EXIGENCIA) =>
    (
      reglasCertificados({
        lc,
        certificados: [
          {
            exigencia,
            nombreArchivo: "shipment notice",
            campos: (numeroEnElPapel
              ? { numeroLC: { valor: numeroEnElPapel, confianza: 1 } }
              : {}) as unknown as CamposDoc,
          },
        ],
        docs: [],
        hoy: new Date(2026, 7, 13),
      } as never) as ReturnType<typeof reglasCertificados>
    ).filter((r) => r.id.startsWith("cert-lc-num-"));

  const NO_PIDE = lcCon(["1.T/T REIMBURSEMENTS ARE NOT ALLOWED."]);
  const PIDE_47A = lcCon(["2.ALL DOCUMENTS SHOUD INDICATE THE LETTER OF CREDIT NUMBER."]);
  /* El 46A lo pide en la línea de OTRO documento: a este papel no se lo pidió (laudo DOCDEX 207). */
  const PIDE_46A_A_OTRO = lcCon(
    ["1.T/T REIMBURSEMENTS ARE NOT ALLOWED."],
    ["1. COMMERCIAL INVOICE INDICATING CONTRACT NUMBER, NUMBER OF LETTER OF CREDIT"],
  );
  /* Y acá se lo pide a él, en su propia línea — que es la `exigencia` con la que llega el papel. */
  const A_ESTE = `${EXIGENCIA} AND LC NUMBER`;
  const PIDE_46A_A_ESTE = lcCon(["1.T/T REIMBURSEMENTS ARE NOT ALLOWED."], [A_ESTE]);

  it("un número que contradice al crédito es discrepancia del 14 (d), aunque el crédito no pida citarlo", () => {
    const [r] = correr("779101LC26000047", NO_PIDE);
    expect(r?.estado, "el banco lo observó sobre un crédito que no exigía la cita").toBe("DISCREPANCIA");
    expect(r?.fuente, "el 14 (d) es lo que lo sostiene, no una condición que nadie escribió").toBe("UCP 600 14d");
    expect(r?.evidencia).toContain("779101LC26000047");
    expect(r?.evidencia, "sin el número del crédito al lado no se puede verificar en el papel").toContain(
      "LCMRDN25000471",
    );
  });

  /*
   * Y el ablandado de la ISBP **no llegaba hasta acá**, así que el mismo hecho tenía dos veredictos.
   *
   * `ablandarPorISBP` anclaba en `/^lc-num-/`, que no matchea `cert-lc-num-…`: un número que no es el del
   * crédito salía en ATENCION sobre una factura y en DISCREPANCIA sobre un certificado. Es la contradicción
   * que este repositorio ya pagó con el artículo 18 (a) (i) y el sello en otro idioma, y desde afuera se ve
   * igual que un rechazo legítimo.
   *
   * Y el laudo DOCDEX 329 es lo que le da autoridad legible a ese ablandado, que hasta ahora colgaba de una
   * paráfrasis de la ISBP 821 —no comprada—: *«the misquoting or absence of the L/C number and date were not
   * grounds for discrepancy, **even if required by the credit**»*, por unanimidad y sobre cuatro Opiniones.
   */
  it("y el ablandado de la ISBP alcanza a los certificados, no solo a los cuatro de la matriz", () => {
    const base = correr("779101LC26000047", PIDE_47A);
    expect(base[0]?.estado, "el examen base lo marca, como la regla hermana").toBe("DISCREPANCIA");

    const [r] = ablandarPorISBP(base);
    expect(r?.estado, "y la práctica bancaria lo baja a verificar, igual que sobre una factura").toBe("ATENCION");
    expect(r?.fuente, "con las dos autoridades, y una de ellas se puede leer").toContain("DOCDEX 329");
    expect(r?.evidencia, "y dice que tampoco vale cuando el crédito pide citarlo").toMatch(
      /tampoco cuando el crédito pide citarlo/,
    );
    expect(r?.evidencia, "sin perder los dos números, que es con lo que se discute").toContain("779101LC26000047");
  });

  it("el mismo número con otra puntuación es el mismo, y no genera ruido", () => {
    expect(correr("LC MRDN-25000471", NO_PIDE)).toHaveLength(0);
  });

  it("si no lo cita y el crédito no lo pide, no hay regla", () => {
    expect(correr(null, NO_PIDE)).toHaveLength(0);
  });

  it("si el crédito lo pide, la fuente dice en qué campo lo pide", () => {
    expect(correr("LCMRDN25000471", PIDE_47A)[0]?.fuente).toBe("47A");
    expect(correr("LCMRDN25000471", PIDE_46A_A_ESTE, A_ESTE)[0]?.fuente, "lo pide el 46A, no el 47A").toBe("46A");
  });

  /*
   * Y si el 46A lo pide en la línea de OTRO documento, a éste no se lo pidió (laudo DOCDEX 207)
   *
   * `dondeSePideElNumeroLC` contesta si el crédito lo pide **en alguna parte**, y con eso esta regla le
   * decía a todo certificado «el crédito lo pide en el campo 46A» aunque el 46A lo hubiera pedido en la
   * línea del conocimiento. El veredicto no cambia —la omisión sale en ATENCION— pero la fuente y la
   * evidencia sí, y la fuente es lo que viaja en el aviso del artículo 16.
   *
   * Este test afirmaba lo contrario con un shipment notice y un 46A que pide el número en la factura, o
   * sea el defecto exacto. Lo corrige el laudo sobre este documento exacto: *«The credit stipulated that
   * the bill of lading and beneficiary's fax or telex must show the "L/C number", but the credit did not
   * stipulate that all documents should evidence the L/C number. Therefore the issuing bank had no reason
   * for refusing the documents on the grounds of a missing L/C number on the shipping company
   * certificate»*. Y la regla general del alcance: *«If the issuing bank meant that every document should
   * evidence the data, it should have stated "all" instead of "all relevant"»*.
   *
   * El crédito real del expediente no se mueve: su 47A dice «ALL DOCUMENTS SHOULD INDICATE THE LC
   * NUMBER», así que `pedidoEn` sigue siendo 47A y las dos observaciones que el banco levantó sobre un
   * shipment notice y una carta de presentación siguen sostenidas por el campo que las sostiene.
   */
  it("y si el 46A lo pide en la línea de otro documento, la fuente no se lo atribuye a éste", () => {
    const [r] = correr(null, PIDE_46A_A_OTRO);
    expect(r?.fuente, "el 46A se lo pide a la factura, no al shipment notice").toBe("Práctica bancaria");
    expect(r?.estado, "sigue sin concluir: que no se haya leído no es que el papel no lo traiga").toBe("ATENCION");
    expect(r?.evidencia, "y la evidencia no puede afirmar que el crédito se lo pide").not.toContain("46A");
    expect(r?.evidencia).toContain("no le pide a este documento");
  });

  it("que no se haya leído manda a verificar: no es que el papel no lo tenga", () => {
    const [r] = correr(null, PIDE_47A);
    expect(r?.estado, "dictaminar discrepancia sobre una falla de lectura es el falso positivo que no se permite").toBe(
      "ATENCION",
    );
  });
});
/**
 * El certificado que acredita algo que ocurre **en destino**, que es el laudo DOCDEX 318.
 *
 * El motor tenía `cert-previo` —el certificado que el crédito pide anterior al embarque— y no tenía el
 * espejo: una aceptación en sitio fechada el día del a bordo o antes es materialmente imposible, porque
 * la mercadería todavía no llegó. En el laudo eran USD 4.920.000 y el panel lo tomó por discrepancia
 * del 14 (d) sin salir de los papeles.
 */
describe("el certificado de algo que ocurre en destino (DOCDEX 318)", () => {
  const SAT = "ONE ORIGINAL AND FOUR COPIES OF BENEFICIARY'S SIGNED CERTIFICATE OF SITE ACCEPTANCE TEST (SAT)";
  const con = (fecha: string, exigencia = SAT) =>
    correr([{ exigencia, campos: doc({ fechaDocumento: campo(fecha) }) }]).find((r) =>
      r.id.startsWith("cert-en-destino"),
    );

  it("fechado el mismo día que el a bordo va a verificar y nombra el laudo", () => {
    const r = con("08-APR-2025");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toContain("DOCDEX 318");
  });

  it("y fechado antes también", () => {
    expect(con("01-APR-2025")?.estado).toBe("ATENCION");
  });

  /* Lo normal es que sea posterior: la mercadería llegó, se instaló y se aceptó. Ahí no se emite. */
  it("fechado después del embarque no emite nada", () => {
    expect(con("20-APR-2025")).toBeUndefined();
  });

  it("y el fin de la capacitación entra en la misma familia", () => {
    expect(con("08-APR-2025", "CERTIFICATE OF COMPLETION OF TRAINING")?.estado).toBe("ATENCION");
  });

  /*
   * Y los dos frenos del nombre: una inspección es justamente lo que se hace **antes** de embarcar, y
   * un certificado de origen no acredita nada que pase en destino.
   */
  it("una inspección no entra: se hace antes de embarcar", () => {
    expect(con("01-APR-2025", "CERTIFICATE OF INSPECTION ISSUED BY AN ACCREDITED SURVEYOR")).toBeUndefined();
  });

  it("ni un certificado de origen", () => {
    expect(con("01-APR-2025", "CERTIFICATE OF ORIGIN ISSUED BY CHAMBER OF COMMERCE")).toBeUndefined();
  });
});
/**
 * El certificado del beneficiario contra el pro forma del crédito, que es *Fortis Bank v IOB*.
 *
 * La regla decía «cotejar el texto» y nada más —su estado era `declara ? "ATENCION" : "ATENCION"`, un
 * ternario con las dos ramas iguales— y ahora señala **qué palabra falta**. Sigue sin concluir, porque
 * el texto que el crédito pide viene mezclado con la parte administrativa de la línea del 46A.
 */
describe("el certificado del beneficiario contra el pro forma (Fortis Bank v IOB)", () => {
  const CLAUSULA =
    "BENEFICIARY'S CONSOLIDATED CERTIFICATE CERTIFYING AS FOLLOWS: WE HEREBY CERTIFY THE FOLLOWING D) THAT THE NEGOTIATING BANK HAS BEEN ADVISED TO DESPATCH ORIGINAL SHIPPING DOCUMENTS ONLY BY AIR COURIER SERVICE TO THE LC OPENING BANK AT OUR COST.";
  const con = (declara: string) =>
    correr([{ exigencia: CLAUSULA, campos: doc({ mercaderia: campo(declara) }) }]).find((r) =>
      r.id.startsWith("cert-benef"),
    );

  /*
   * La única discrepancia válida de todo el pleito fue **una palabra de tres letras**: el crédito pedía
   * «AT OUR COST» y el certificado decía «AT ISSUING BANK'S COST». La Court of Appeal: «"OUR" is to be
   * identified with "WE" – i.e. the person giving the certificate».
   */
  it("señala la palabra que falta, aunque tenga tres letras", () => {
    const r = con(
      "WE HEREBY CERTIFY THE FOLLOWING: D) THAT THE NEGOTIATING BANK HAS BEEN ADVISED TO DESPATCH ORIGINAL SHIPPING DOCUMENTS ONLY BY AIR COURIER SERVICE TO THE LC OPENING BANK AT ISSUING BANK'S COST",
    );
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toContain('"our"');
  });

  it("y con el texto del crédito repetido no señala ninguna", () => {
    const r = con(
      "WE HEREBY CERTIFY THE FOLLOWING: D) THAT THE NEGOTIATING BANK HAS BEEN ADVISED TO DESPATCH ORIGINAL SHIPPING DOCUMENTS ONLY BY AIR COURIER SERVICE TO THE LC OPENING BANK AT OUR COST",
    );
    expect(r?.evidencia).toContain("repite las palabras");
  });

  /* Y nunca rechaza: el texto exigido viene mezclado con la parte administrativa del 46A. */
  it("nunca rechaza", () => {
    expect(con("WE CERTIFY SOMETHING ELSE ENTIRELY")?.estado).toBe("ATENCION");
  });

  it("sin texto en el certificado, manda a leerlo", () => {
    expect(
      correr([{ exigencia: CLAUSULA, campos: doc({}) }]).find((r) => r.id.startsWith("cert-benef"))?.evidencia,
    ).toContain("leer el texto");
  });
});

/**
 * El certificado sin fecha de emisión y lo que lo ata al embarque (laudo DOCDEX 213)
 *
 * El emisor rechazó dos certificados provisionales por no llevar fecha, y el panel —unánime— contestó
 * que no hacía falta porque mostraban el buque y la fecha del conocimiento: *«they unequivocally
 * establish that these documents relate to the shipment and the necessary linkage between the documents
 * presented»*. Y dio la regla que al motor le faltaba:
 *
 *   «A certificate must serve the purpose for which it has been issued; that is the reason why it has to
 *   show **either a date of issuance or otherwise to show the event (shipment or provision of services)
 *   to which it relates**.»
 *
 * Antes de esto el motor **no decía nada** sobre un certificado sin fecha: ninguna regla la exigía —lo
 * cual coincide con la conclusión— pero tampoco miraba lo otro, y una regla ausente se lee como «no
 * aplica» y no como «no pude».
 */
describe("el certificado sin fecha de emisión (DOCDEX 213)", () => {
  const BUQUE = "M/V ECO CHARGER";
  const conCertificado = (campos: Partial<CamposDoc>) =>
    reglasCertificados({
      lc: LC,
      docs: [{ tipo: "BL", campos: doc({ buque: campo(BUQUE), fechaEmbarque: campo("09-dic-97") }) }],
      hoy: new Date(1998, 0, 15),
      certificados: [{ exigencia: "+3)PROVISIONAL WEIGHT AND MOISTURE CERTIFICATE", campos: doc(campos) }],
    }).find((x) => x.id.startsWith("cert-vinculo"));

  it("sin fecha pero nombrando el buque, cumple y cita el laudo", () => {
    const r = conCertificado({ mercaderia: campo(`PROVISIONAL WEIGHT · ${BUQUE} · B/L DATE 9/12/97`) });
    expect(r?.estado).toBe("OK");
    expect(r?.evidencia).toContain("DOCDEX 213");
  });

  it("sin fecha y sin nada que lo ate al embarque, va a verificar", () => {
    const r = conCertificado({ mercaderia: campo("PROVISIONAL WEIGHT 5000 WMT MOISTURE 8,2 PCT") });
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toContain("DOCDEX 213");
  });

  /*
   * Con fecha no se emite nada acá: la fecha es la primera de las dos cosas que el panel admite, y las
   * reglas que la miran son otras (el 14 i, el A12b, el cruce del 14 d).
   */
  it("con fecha de emisión la regla no se emite", () => {
    expect(
      conCertificado({ fechaDocumento: campo("09-dic-97"), mercaderia: campo("PROVISIONAL WEIGHT") }),
    ).toBeUndefined();
  });

  /*
   * Y **nunca rechaza**, que no es prudencia genérica: el panel admite que la vinculación venga «de otro
   * modo» —una referencia que el motor no sepa leer— y en este motor un campo vacío significa además
   * «nadie lo cargó», que es el límite de la Opinión TA 862. Rechazar ahí sería rechazar por no haber
   * podido leer.
   */
  it("y nunca rechaza, ni con el certificado vacío", () => {
    for (const campos of [{}, { mercaderia: campo("ALGO QUE NO DICE NADA") }])
      expect(conCertificado(campos)?.estado).not.toBe("DISCREPANCIA");
  });
});
