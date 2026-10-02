import { describe, expect, it } from "vitest";
import { aparearConExigencias, type DocCertificado, emisorQueNombra, reglasCertificados } from "./certificados";
import type { CamposDoc } from "./consistencia";
import { SWIFT_CSU2025099 } from "./fixtures";
import type { DocAnalizado } from "./presentacion";
import { parseMT700 } from "./swift-lc";

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
  it("si el crédito nombra al emisor, tiene que ser ese", () => {
    const r = correr([
      {
        exigencia: "CERTIFICATE OF ANALYSIS ISSUED BY CALISET",
        campos: doc({ exportador: campo("OTRO LABORATORIO SRL") }),
        nombreArchivo: "Analysis",
      },
    ]);
    expect(r.find((x) => x.id.startsWith("cert-emisor-"))?.estado).toBe("DISCREPANCIA");
  });

  it("y si es el que nombra, pasa aunque abrevie la forma societaria", () => {
    const r = correr([
      {
        exigencia: "CERTIFICATE OF ANALYSIS ISSUED BY CALISET LIMITED",
        campos: doc({ exportador: campo("CALISET LTD") }),
        nombreArchivo: "Analysis",
      },
    ]);
    expect(r.find((x) => x.id.startsWith("cert-emisor-"))?.estado).toBe("OK");
  });

  it("un certificado «independiente» no lo puede emitir el beneficiario", () => {
    const r = correr([
      {
        exigencia: "INDEPENDENT INSPECTION CERTIFICATE",
        campos: doc({ exportador: campo("CEREALSUR S.A") }),
        nombreArchivo: "Inspection",
      },
    ]);
    expect(r.find((x) => x.id.startsWith("cert-emisor-"))?.estado).toBe("DISCREPANCIA");
  });

  it("emitido por un tercero, pasa", () => {
    const r = correr([
      {
        exigencia: "INDEPENDENT INSPECTION CERTIFICATE",
        campos: doc({ exportador: campo("CALISET S.A.") }),
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
    ["+11)SHIPPING COMPANY CERTIFICATE ISSUED BY CARRIER OR ITS AGENT STATING THE VESSEL AGE", "OCEANLINE URUGUAY S.A."],
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
