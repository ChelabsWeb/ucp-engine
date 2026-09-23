import { describe, expect, it } from "vitest";
import type { Observacion } from "./emision";
import { revisarCredito } from "./emision";
import { parseMT700, SWIFT_CSU2025099 } from "./index";
import { describirPropuesta, proponerRedaccion, redaccionesPara } from "./redaccion";

/**
 * Las propuestas de redacción.
 *
 * Lo que se prueba acá es sobre todo lo que **no** puede pasar: que una propuesta cambie lo que las
 * partes acordaron, que invente un dato que el motor no puede saber, o que aparezca donde el problema
 * no es de redacción.
 */

const observacion = (id: string, donde = "46A+1"): Observacion => ({
  id,
  gravedad: "AVISO",
  fuente: "UCP 600 3",
  que: "algo",
  donde,
  sugerencia: "algo",
});

describe("lo que el motor no puede saber queda como hueco", () => {
  it("un emisor vago propone nombrar al emisor, sin elegir uno", () => {
    const r = proponerRedaccion(observacion("emision-emisor-vago-0"))!;
    expect(r.accion).toBe("REEMPLAZAR");
    expect(r.texto).toContain("[");
    // Quién emite un certificado de origen depende del país y del acuerdo: inventar un emisor
    // plausible parecería una decisión tomada.
    expect(r.decidir.length).toBeGreaterThan(0);
    expect(r.decidir[0]).toMatch(/name the issuer/i);
  });

  it("cada hueco del texto aparece en «qué decidir»", () => {
    // Si un hueco no se lista, alguien manda el crédito con un «[number]» adentro.
    for (const id of [
      "emision-sin-documentos",
      "emision-emisor-vago-0",
      "emision-doc-ordenante-0",
      "emision-no-documentaria-0",
      "emision-sin-plazo",
    ]) {
      const r = proponerRedaccion(observacion(id))!;
      const enTexto = [...r.texto.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]!);
      expect(r.decidir).toEqual(enTexto);
    }
  });
});

describe("la intención comercial no se toca", () => {
  it("un documento del ordenante sigue siendo el mismo documento: cambia quién lo firma", () => {
    const r = proponerRedaccion(observacion("emision-doc-ordenante-0"))!;
    // No dice «no pidas inspección»: dice que la inspección la haga un tercero.
    expect(r.texto).toMatch(/independent third party/i);
    expect(r.texto).toMatch(/NOT BY THE APPLICANT/i);
  });

  it("una condición no documentaria no se borra: se convierte en un documento que la acredite", () => {
    const r = proponerRedaccion(observacion("emision-no-documentaria-0", "47A+3"))!;
    expect(r.accion).toBe("MOVER_A_46A");
    expect(r.campo).toBe("46A");
    // «restate the condition» es la instrucción: lo que se pedía se sigue pidiendo.
    expect(r.texto).toMatch(/restate the condition/i);
  });

  it("lo único que se propone quitar es lo que no obliga a nadie", () => {
    // Una instrucción administrativa entre bancos no es algo que el beneficiario pueda incumplir.
    const r = proponerRedaccion(observacion("emision-administrativa-0", "47A+2"))!;
    expect(r.accion).toBe("QUITAR");
  });
});

describe("dónde no se propone nada", () => {
  it("un vencimiento anterior al último embarque no se arregla redactando", () => {
    // Se arregla cambiando una fecha, y cuál de las dos es una decisión comercial. Proponer texto
    // acá dejaría tranquilo a quien lo lea sin haber arreglado nada.
    expect(proponerRedaccion(observacion("emision-embarque-tras-vencimiento"))).toBeNull();
  });

  it("tampoco un giro sobre el ordenante ni un crédito sin banco donde girar", () => {
    for (const id of ["emision-giro-sobre-ordenante", "emision-disponible", "emision-forma", "emision-vencimiento"]) {
      expect(proponerRedaccion(observacion(id))).toBeNull();
    }
  });

  it("una observación desconocida no inventa una propuesta", () => {
    expect(proponerRedaccion(observacion("emision-algo-que-no-existe"))).toBeNull();
  });
});

describe("el emisor que se sugiere sale de la práctica, no de la nada", () => {
  /**
   * Las sugerencias vienen del catálogo de tipos de documento del ERP de Cerealsur, que un trader usa
   * en producción desde 2017. No es una lista de memoria: es lo que un exportador contesta cuando le
   * preguntan quién le firma cada papel.
   */
  it.each([
    ["FIRST CLASS CERTIFICATE OF ORIGIN IN 02 FOLD", /chamber of commerce/i],
    ["FIRST CLASS HEALTH CERTIFICATE", /veterinary or health authority/i],
    ["WELL KNOWN CERTIFICATE OF ANALYSIS", /accredited surveyor/i],
    ["FIRST CLASS WEIGHT CERTIFICATE", /accredited surveyor/i],
    ["FIRST CLASS FUMIGATION CERTIFICATE", /fumigation surveyor/i],
  ])("para %s sugiere el emisor habitual", (documento, esperado) => {
    const pr = redaccionesPara([observacion("emision-emisor-vago-0", "46A+1")], {
      documentosExigidos: [documento],
    })[0]!;
    expect(pr.texto).toMatch(esperado);
    // Y el hueco sigue siendo un hueco: el emisor exacto depende del país y del acuerdo.
    expect(pr.decidir.length).toBeGreaterThan(0);
    expect(pr.texto).toMatch(/confirm the exact issuer/i);
  });

  it("un documento que no reconoce cae en la sugerencia general, no inventa un emisor", () => {
    const pr = redaccionesPara([observacion("emision-emisor-vago-0", "46A+1")], {
      documentosExigidos: ["FIRST CLASS DOCUMENT OF SOME KIND NOBODY HAS SEEN"],
    })[0]!;
    expect(pr.texto).toMatch(/name the issuer/i);
  });

  it("y a un certificado de inspección del ordenante le propone el tercero que corresponde", () => {
    const pr = redaccionesPara([observacion("emision-doc-ordenante-0", "46A+1")], {
      documentosExigidos: ["INSPECTION CERTIFICATE ISSUED AND SIGNED BY THE APPLICANT"],
    })[0]!;
    expect(pr.texto).toMatch(/named inspection company/i);
    expect(pr.texto).toMatch(/NOT BY THE APPLICANT/i);
  });

  it("al documento de seguro le recuerda que la nota de cobertura no sirve (art. 28c)", () => {
    const pr = redaccionesPara([observacion("emision-emisor-vago-0", "46A+1")], {
      documentosExigidos: ["FIRST CLASS INSURANCE POLICY FOR 110 PCT OF CIF VALUE"],
    })[0]!;
    expect(pr.texto).toMatch(/cover note/i);
    expect(pr.texto).toMatch(/28\(c\)/);
  });
});

describe("una propuesta se distingue de otra igual", () => {
  const credito = {
    documentosExigidos: ["SIGNED COMMERCIAL INVOICE", "FIRST CLASS CERTIFICATE OF ORIGIN IN 02 FOLD"],
    condicionesAdicionales: [
      "THE GOODS MUST BE OF THE FIRST QUALITY AVAILABLE IN THE MARKET",
      "SHIPMENT TO BE EFFECTED BY A VESSEL NOT OLDER THAN 20 YEARS",
    ],
  };

  it("**cita el texto que reemplaza**", () => {
    // Sin esto, un crédito con cinco condiciones no documentarias daba cinco propuestas idénticas y
    // quien las leía no sabía a cuál correspondía cada una.
    const propuestas = redaccionesPara(
      [observacion("emision-no-documentaria-0", "47A+1"), observacion("emision-no-documentaria-1", "47A+2")],
      credito,
    );
    expect(propuestas).toHaveLength(2);
    expect(propuestas[0]!.original).toBe(credito.condicionesAdicionales[0]);
    expect(propuestas[1]!.original).toBe(credito.condicionesAdicionales[1]);
    // Y el texto para pegar en un correo las distingue.
    expect(describirPropuesta(propuestas[0]!)).toContain("FIRST QUALITY");
    expect(describirPropuesta(propuestas[1]!)).toContain("NOT OLDER THAN 20 YEARS");
  });

  it("del 46A toma el documento y no la condición del mismo número", () => {
    const pr = redaccionesPara([observacion("emision-emisor-vago-1", "46A+2")], credito)[0]!;
    expect(pr.original).toBe(credito.documentosExigidos[1]);
  });

  it("sin el crédito a mano funciona igual, sin el ancla", () => {
    const pr = redaccionesPara([observacion("emision-no-documentaria-0", "47A+1")])[0]!;
    expect(pr.original).toBeNull();
    expect(pr.texto.length).toBeGreaterThan(0);
  });

  it("un original larguísimo se recorta, para que el correo siga siendo legible", () => {
    const largo = "X".repeat(400);
    const pr = redaccionesPara([observacion("emision-no-documentaria-0", "47A+1")], {
      condicionesAdicionales: [largo],
    })[0]!;
    const linea = describirPropuesta(pr).split("\n")[0]!;
    expect(linea.length).toBeLessThan(200);
    expect(linea).toContain("…");
  });
});

describe("todo lo que sale del banco va en inglés", () => {
  const TODOS = [
    "emision-sin-documentos",
    "emision-emisor-vago-0",
    "emision-doc-ordenante-0",
    "emision-sin-sentido-46a-0",
    "emision-no-documentaria-0",
    "emision-administrativa-0",
    "emision-cond-ordenante-0",
    "emision-sin-plazo",
    "emision-barra-44E",
  ];

  it("ni el texto propuesto ni su explicación tienen español", () => {
    // Esto se pega en una solicitud de apertura o en un correo al banco emisor. Una explicación en
    // español ahí no la lee nadie.
    const espanol =
      /\b(el|los|las|una|del|que|se|con|por|para|está|dice|debe|hay|más|entre|cada|día|días|fecha|número|cantidad|factura|crédito|banco|documento|documentos|mercadería|embarque|presentación|beneficiario|ordenante|emisor|sacar|poner|conviene|artículo)\b/i;
    for (const id of TODOS) {
      const pr = proponerRedaccion(observacion(id))!;
      expect(espanol.test(pr.porQue), `porQue de ${id}: ${pr.porQue.slice(0, 80)}`).toBe(false);
      expect(espanol.test(pr.texto), `texto de ${id}: ${pr.texto.slice(0, 80)}`).toBe(false);
    }
  });

  it("y cada una nombra el artículo o la sección que la funda", () => {
    for (const id of TODOS) {
      const pr = proponerRedaccion(observacion(id))!;
      expect(pr.porQue).toMatch(/[Aa]rticle \d|ISBP|UCP/);
    }
  });
});

describe("sobre el crédito real del expediente", () => {
  const credito = parseMT700(SWIFT_CSU2025099)!;
  const observaciones = revisarCredito(credito);

  it("**no tiene nada que reescribir**, y eso es el resultado correcto", () => {
    /*
     * Este test decía lo contrario —«hay observaciones que revisar»— y pasaba por los tres falsos
     * positivos del 47A: dos condiciones marcadas por estar en plural y la cláusula de tolerancia
     * tomada por condición. Arreglados, el crédito de Meridian queda limpio, que es lo que uno espera
     * de un crédito emitido por un banco que los emite todos los días.
     *
     * Vale como caso dorado al revés: si alguien agrega una regla que vuelve a marcar algo acá, tiene
     * que poder defender por qué este crédito está mal redactado.
     */
    expect(observaciones.map((o) => `${o.donde}: ${o.que}`)).toEqual([]);
    expect(redaccionesPara(observaciones, credito.lc)).toEqual([]);
  });

  /** Y con los problemas típicos metidos a propósito, sí hay qué reescribir. */
  const conProblemas = parseMT700(
    SWIFT_CSU2025099.replace(
      "+3)CERTIFICATE OF URUGUAY ORIGIN IN 02 FOLD",
      "+3)FIRST CLASS CERTIFICATE OF ORIGIN IN 02 FOLD",
    ).replace("+4)PACKING LIST IN 03 FOLD", "+4)INSPECTION CERTIFICATE ISSUED AND SIGNED BY THE APPLICANT"),
  )!;

  it("cada propuesta apunta a la observación que la motiva y a un campo del crédito", () => {
    const obs = revisarCredito(conProblemas);
    const propuestas = redaccionesPara(obs, conProblemas.lc);
    expect(propuestas.length).toBeGreaterThan(0);
    const ids = new Set(obs.map((o) => o.id));
    for (const pr of propuestas) {
      expect(ids.has(pr.observacionId)).toBe(true);
      expect(pr.campo).toMatch(/^(46A|47A|48|44E|44F)/);
      expect(pr.porQue.length).toBeGreaterThan(40);
    }
  });

  it("nunca hay más propuestas que observaciones", () => {
    // Una propuesta sin observación que la funde sería una opinión sobre un crédito que está bien.
    const obs = revisarCredito(conProblemas);
    expect(redaccionesPara(obs, conProblemas.lc).length).toBeLessThanOrEqual(obs.length);
  });

  it("el texto para pegar en un correo dice qué hacer, el texto, el porqué y qué falta decidir", () => {
    const pr = proponerRedaccion(observacion("emision-no-documentaria-0", "47A+3"))!;
    const t = describirPropuesta(pr);
    expect(t).toContain("46A");
    expect(t).toMatch(/Move to field 46A as/);
    expect(t).toMatch(/Why: /);
    expect(t).toMatch(/Before using this, decide:/);
    // Va en inglés, como el crédito.
    expect(t).not.toMatch(/\bPor qué\b|\bReemplazar\b/);
  });

  it("un crédito sin observaciones no produce propuestas", () => {
    expect(redaccionesPara([])).toEqual([]);
  });
});
