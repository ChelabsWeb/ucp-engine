import { describe, expect, it } from "vitest";
import {
  ablandarPorISBP,
  comparaISBP,
  cotejarIncotermISBP,
  emisorAdmitido,
  esCertificadoDeOrigen,
  esErrorDeTipeo,
  esFacturaComercial,
  exigePrevioAlEmbarque,
  normISBP,
  veredictoDeNombre,
} from "./isbp";
import type { ReglaPresentacion } from "./presentacion";

describe("A1 — abreviaturas de uso común", () => {
  it("una abreviatura vale igual que la palabra entera", () => {
    expect(comparaISBP("CEREALSUR LTD", "CEREALSUR LIMITED")).toBe("IGUAL");
    expect(comparaISBP("ORIENT FEED PVT LTD", "ORIENT FEED PRIVATE LIMITED")).toBe("IGUAL");
    expect(comparaISBP("Int'l Trading Co", "International Trading Company")).toBe("IGUAL");
  });

  it("incluye la equivalencia que agregó la edición 2023", () => {
    expect(normISBP("MOLSUR IND")).toBe(normISBP("MOLSUR INDUSTRIES"));
  });

  it("las unidades también son intercambiables", () => {
    expect(comparaISBP("54 MT", "54 METRIC TONS")).toBe("IGUAL");
    expect(comparaISBP("1000 KGS", "1000 KILOGRAMS")).toBe("IGUAL");
  });
});

describe("A23 — errores de ortografía y de tipeo", () => {
  it("los ejemplos del propio texto no son discrepancia", () => {
    expect(esErrorDeTipeo("mashine", "machine")).toBe(true);
    expect(esErrorDeTipeo("fountan", "fountain")).toBe(true);
    expect(esErrorDeTipeo("modle", "model")).toBe(true);
  });

  it("pero un dato distinto sí lo es: «model 123» no es «model 321»", () => {
    expect(comparaISBP("model 123", "model 321")).toBe("DISTINTO");
    expect(esErrorDeTipeo("123", "321")).toBe(false);
  });

  it("una palabra con un tipeo se marca como tal, no como igual ni como distinta", () => {
    expect(comparaISBP("FISH MEAL MASHINE", "FISH MEAL MACHINE")).toBe("TIPEO");
  });

  it("dos nombres realmente distintos siguen siendo distintos", () => {
    expect(comparaISBP("ORIENT FEED PVT LTD", "MEGA FEED PVT LTD")).toBe("DISTINTO");
    expect(comparaISBP("MOLSUR S.A.", "CEREALSUR S.A.")).toBe("DISTINTO");
  });

  it("no da por equivalentes palabras cortas, donde un carácter cambia el sentido", () => {
    expect(esErrorDeTipeo("cif", "fob")).toBe(false);
    expect(esErrorDeTipeo("mt", "kg")).toBe(false);
  });

  it("un texto con información de más queda como equivalente, no como igual", () => {
    expect(comparaISBP("FISH MEAL", "FISH MEAL 54PCT MIN FOR ANIMAL FEED USE")).toBe("EQUIVALENTE");
  });
});

describe("consideración preliminar viii (2023) — el número del crédito", () => {
  const base: ReglaPresentacion[] = [
    {
      id: "lc-num-FACTURA",
      fuente: "47A",
      regla: "Factura: cita el número de la LC",
      estado: "DISCREPANCIA",
      evidencia: 'dice "LCSMWN25000XXX"',
    },
    {
      id: "fac-monto",
      fuente: "32B/39A",
      regla: "Factura dentro del monto",
      estado: "DISCREPANCIA",
      evidencia: "supera el tope",
    },
  ];

  it("baja de discrepancia a verificación y explica por qué", () => {
    const r = ablandarPorISBP(base);
    expect(r[0]!.estado).toBe("ATENCION");
    expect(r[0]!.fuente).toContain("ISBP 821");
    expect(r[0]!.evidencia).toContain("no justifica rechazo");
  });

  it("no toca ninguna otra discrepancia", () => {
    expect(ablandarPorISBP(base)[1]).toEqual(base[1]);
  });

  it("no inventa discrepancias donde no las había", () => {
    const ok: ReglaPresentacion[] = [{ ...base[0]!, estado: "OK" }];
    expect(ablandarPorISBP(ok)[0]!.estado).toBe("OK");
  });
});

describe("C1 — qué satisface una exigencia de factura comercial", () => {
  it("una proforma o una provisional no sirven", () => {
    expect(esFacturaComercial("PROFORMA INVOICE 2025099").vale).toBe(false);
    expect(esFacturaComercial("PROVISIONAL INVOICE").vale).toBe(false);
  });

  it("una factura emitida a efectos fiscales sí sirve", () => {
    expect(esFacturaComercial("INVOICE issued for tax purposes").vale).toBe(true);
    expect(esFacturaComercial("COMMERCIAL INVOICE A 4401").vale).toBe(true);
  });
});

describe("C8 — la versión del término de entrega", () => {
  it("si el crédito fija la versión, la factura tiene que indicarla", () => {
    expect(cotejarIncotermISBP("CFR COLOMBO INCOTERMS 2020", "CFR COLOMBO").estado).toBe("DISCREPANCIA");
    expect(cotejarIncotermISBP("CFR COLOMBO INCOTERMS 2020", "CFR COLOMBO INCOTERMS 2020").estado).toBe("OK");
  });

  it("dos versiones distintas son discrepancia", () => {
    const r = cotejarIncotermISBP("CIF SINGAPORE INCOTERMS 2010", "CIF SINGAPORE INCOTERMS 2020");
    expect(r.estado).toBe("DISCREPANCIA");
    expect(r.evidencia).toContain("2010");
  });

  it("si el crédito no fija versión, la factura puede agregarla", () => {
    expect(cotejarIncotermISBP("CFR COLOMBO", "CFR COLOMBO INCOTERMS 2020").estado).toBe("OK");
  });
});

describe("A12 — certificados posteriores al embarque", () => {
  it("un certificado de inspección a secas no tiene que ser previo al embarque", () => {
    expect(exigePrevioAlEmbarque("CERTIFICATE OF ANALYSIS")).toBe(false);
    expect(exigePrevioAlEmbarque("INSPECTION CERTIFICATE")).toBe(false);
  });

  it("uno calificado como previo al embarque sí", () => {
    expect(exigePrevioAlEmbarque("PRE-SHIPMENT INSPECTION CERTIFICATE")).toBe(true);
  });
});

describe("Q3 a Q5 y L3 — quién puede emitir un certificado", () => {
  it("si el crédito nombra al emisor, tiene que ser ese", () => {
    expect(emisorAdmitido("CERTIFICATE OF ANALYSIS ISSUED BY CALISET")).toBe("EL_QUE_NOMBRA_EL_CREDITO");
  });

  it("si no dice nada, cualquiera, incluido el beneficiario", () => {
    expect(emisorAdmitido("CERTIFICATE OF ANALYSIS")).toBe("CUALQUIERA");
  });

  it("un calificativo como «independent» excluye al beneficiario", () => {
    expect(emisorAdmitido("INDEPENDENT INSPECTION CERTIFICATE")).toBe("CUALQUIERA_MENOS_BENEFICIARIO");
    expect(emisorAdmitido("CERTIFICATE ISSUED BY AN OFFICIAL SURVEYOR")).toBe("CUALQUIERA_MENOS_BENEFICIARIO");
  });

  it("el certificado de origen se reconoce aparte: ahí corre la excepción de la cámara", () => {
    expect(esCertificadoDeOrigen("CERTIFICATE OF URUGUAY ORIGIN IN 02 FOLD")).toBe(true);
    expect(esCertificadoDeOrigen("CERTIFICATE OF ANALYSIS")).toBe(false);
  });
});
/**
 * El ampersand, que es la sentencia *Bulgrains v Shinhan Bank* [2013] EWHC 2498 (QB).
 *
 * El motor borraba el signo con el resto de la puntuación, así que «Bulgrains & Co Ltd» y «Bulgrains
 * Co Ltd» salían IGUAL — dos nombres que un tribunal inglés declaró materialmente distintos. Ahora el
 * signo vale como la palabra «and», que es lo que deja separado el caso bueno del malo.
 */
describe("el ampersand en el nombre de una parte (Bulgrains v Shinhan)", () => {
  it("«&» y «and» nombran a la misma empresa", () => {
    expect(comparaISBP("SMITH & CO LTD", "SMITH AND CO LTD")).toBe("IGUAL");
  });

  it("pero un «&» que falta no es un error de tipeo: es otro nombre", () => {
    expect(comparaISBP("BULGRAINS & CO LTD", "BULGRAINS CO LTD")).toBe("DISTINTO");
  });

  it("y en los dos sentidos", () => {
    expect(comparaISBP("BULGRAINS CO LTD", "BULGRAINS & CO LTD")).toBe("DISTINTO");
  });

  it("el resto de la puntuación sigue sin contar", () => {
    expect(comparaISBP("SMITH CO., LTD.", "SMITH CO LTD")).toBe("IGUAL");
  });
});

/**
 * Las tres bandas del nombre de una parte, con las cuatro sentencias que las trazan.
 *
 * `veredictoDeNombre` existe para que las reglas no puedan decir cosas distintas sobre el mismo hecho:
 * antes `bl-notify` tenía las tres bandas, `ucp-18a-i` comparaba con un matcher de lugares y
 * `fac-emisor` con un prefijo.
 */
describe("veredictoDeNombre", () => {
  it("el mismo nombre con otra abreviatura cumple", () => {
    expect(veredictoDeNombre("CEREALSUR S.A.", "CEREALSUR SA")).toBe("OK");
  });

  it("las mismas palabras en otro orden son el mismo nombre (Voest-Alpine v Bank of China)", () => {
    expect(veredictoDeNombre("Voest-Alpine Trading USA Corp.", "Voest-Alpine USA Trading Corp.")).toBe("OK");
  });

  it("un tipeo va a verificar: los tribunales no coinciden (Beyene contra Hing Yip)", () => {
    expect(veredictoDeNombre("MOHAMMED SORAN", "MOHAMMED SOFAN")).toBe("ATENCION");
  });

  /*
   * Y el par de *Hing Yip Hing Fat v Daiwa* **no** cae en la banda del medio, que es un desacuerdo
   * conocido y acá queda medido con su causa.
   *
   * El tribunal de Hong Kong dijo que «Industrial» por «Industries» era *«an obvious typographical
   * error»*; el motor lo rechaza. La causa es la lista de abreviaturas de A1, que la edición 2023 amplió
   * con `ind / industry / industries`: «industries» se canoniza en `ind` y «industrial» no, así que las
   * dos palabras quedan a distancia máxima en vez de a dos letras. Sin esa canonización
   * `esErrorDeTipeo` las daría por tipeo —distancia 2 sobre diez letras— y el par caería en el medio.
   *
   * No se cambia acá: tocar `comparaISBP` para comparar también las formas sin abreviar afecta al
   * examen entero, y la decisión de qué hace cada regla con un tipeo en el nombre de una parte sigue
   * siendo del dueño. Lo que este test hace es que el desacuerdo no sea una sorpresa.
   */
  it("el par de Hing Yip queda del lado del rechazo, por la canonización de «industries»", () => {
    expect(veredictoDeNombre("CHEERGOAL INDUSTRIAL", "CHEERGOAL INDUSTRIES")).toBe("DISCREPANCIA");
    expect(normISBP("CHEERGOAL INDUSTRIES")).toBe("cheergoal ind");
    expect(normISBP("CHEERGOAL INDUSTRIAL")).toBe("cheergoal industrial");
  });

  it("un ampersand que falta es discrepancia (Bulgrains v Shinhan)", () => {
    expect(veredictoDeNombre("BULGRAINS & CO LTD", "BULGRAINS CO LTD")).toBe("DISCREPANCIA");
  });

  /* Y el freno del reordenamiento: una palabra de más o de menos no es una permutación. */
  it("una palabra que sobra no es un reordenamiento", () => {
    expect(veredictoDeNombre("SMITH TRADING LOGISTICS LTD", "SMITH TRADING LTD")).toBe("DISCREPANCIA");
  });
});
