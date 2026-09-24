import { describe, expect, it } from "vitest";
import type { CamposDoc } from "./consistencia";
import { contextoDesdeSwift } from "./examen";
import { SWIFT_CSU2025099 } from "./fixtures";
import type { DocAnalizado } from "./presentacion";
import { type ContextoCredito, reglasUCP } from "./reglas-ucp";
import { parseMT700 } from "./swift-lc";
import type { LcInfo } from "./types";

/**
 * Las reglas de las UCP 600 que el examen base no cubre, probadas contra el crédito real
 * del caso CSU2025099 y contra documentos armados para romper cada regla a propósito.
 */

const swift = parseMT700(SWIFT_CSU2025099)!;
const LC: LcInfo = swift.lc;
const CTX: ContextoCredito = contextoDesdeSwift(swift);

const campo = (valor: string, confianza = 0.95) => ({ valor, confianza });
const vacio = { valor: "", confianza: 0 };

function doc(over: Partial<Record<keyof CamposDoc, { valor: string; confianza: number }>>): CamposDoc {
  const base = {
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
  } as CamposDoc;
  return { ...base, ...over } as CamposDoc;
}

const HOY = new Date(2025, 3, 22);
const corre = (docs: DocAnalizado[], seguro?: { campos: CamposDoc }) =>
  reglasUCP({ lc: LC, credito: CTX, docs, seguro, hoy: HOY });
const buscar = (docs: DocAnalizado[], id: string, seguro?: { campos: CamposDoc }) =>
  corre(docs, seguro).find((r) => r.id === id);

describe("contexto del crédito", () => {
  it("saca del SWIFT los puertos, la mercadería y el ordenante", () => {
    expect(CTX.puertoEmbarque).toMatch(/MONTEVIDEO/i);
    expect(CTX.puertoDestino).toMatch(/COLOMBO/i);
    expect(CTX.aplicante).toBe("ORIENT FEED (PVT) LTD");
    expect(CTX.parciales).toMatch(/ALLOWED/i);
  });
});

describe("factura — artículo 18", () => {
  it("18a-ii: a nombre de quien no es el ordenante es discrepancia", () => {
    const r = buscar([{ tipo: "FACTURA", campos: doc({ importador: campo("OTRA EMPRESA LTD") }) }], "ucp-18a-ii");
    expect(r?.estado).toBe("DISCREPANCIA");
  });

  it("18a-ii: a nombre del ordenante del crédito pasa", () => {
    const r = buscar([{ tipo: "FACTURA", campos: doc({ importador: campo("ORIENT FEED (PVT) LTD") }) }], "ucp-18a-ii");
    expect(r?.estado).toBe("OK");
  });

  it("18a-iii: una factura en euros contra un crédito en dólares es discrepancia", () => {
    const r = buscar([{ tipo: "FACTURA", campos: doc({ moneda: campo("EUR") }) }], "ucp-18a-iii");
    expect(r?.estado).toBe("DISCREPANCIA");
    expect(r?.evidencia).toContain("EUR");
  });

  it("no inventa reglas cuando el campo no se leyó: queda a verificar, nunca conforme", () => {
    const r = buscar([{ tipo: "FACTURA", campos: doc({}) }], "ucp-18a-ii");
    expect(r?.estado).toBe("ATENCION");
  });

  it("un campo leído con baja confianza se trata como no leído", () => {
    const r = buscar([{ tipo: "FACTURA", campos: doc({ moneda: campo("EUR", 0.2) }) }], "ucp-18a-iii");
    expect(r?.estado).toBe("ATENCION");
  });
});

describe("documento de transporte — artículos 20, 26 y 27", () => {
  it("20a-iii: un puerto de carga distinto del que fija el crédito es discrepancia", () => {
    const r = buscar(
      [{ tipo: "BL", campos: doc({ puertoEmbarque: campo("BUENOS AIRES, ARGENTINA") }) }],
      "ucp-20a-iii-puertoEmbarque",
    );
    expect(r?.estado).toBe("DISCREPANCIA");
  });

  it("20a-iii: el puerto del caso real coincide con el 44E del crédito", () => {
    const r = buscar(
      [{ tipo: "BL", campos: doc({ puertoEmbarque: campo("MONTEVIDEO, URUGUAY") }) }],
      "ucp-20a-iii-puertoEmbarque",
    );
    expect(r?.estado).toBe("OK");
  });

  it("20a-ii: la anotación de a bordo con fecha legible pasa", () => {
    const r = buscar([{ tipo: "BL", campos: doc({ onBoard: campo("SHIPPED ON BOARD 08-APR-2025") }) }], "ucp-20a-ii");
    expect(r?.estado).toBe("OK");
  });

  it("20a-ii: «intended vessel» sin anotación de a bordo es discrepancia", () => {
    const r = buscar([{ tipo: "BL", campos: doc({ buque: campo("INTENDED VESSEL EVER LINKING") }) }], "ucp-20a-ii");
    expect(r?.estado).toBe("DISCREPANCIA");
  });

  it("20a-vi: un conocimiento sujeto a contrato de fletamento es discrepancia", () => {
    const r = buscar(
      [{ tipo: "BL", campos: doc({ charterParty: campo("SUBJECT TO CHARTER PARTY DATED 01-MAR-2025") }) }],
      "ucp-20a-vi",
    );
    expect(r?.estado).toBe("DISCREPANCIA");
  });

  it("26a: mercadería declarada sobre cubierta es discrepancia; «may be carried on deck» no lo es", () => {
    expect(buscar([{ tipo: "BL", campos: doc({ onDeck: campo("SHIPPED ON DECK") }) }], "ucp-26a")?.estado).toBe(
      "DISCREPANCIA",
    );
    expect(
      buscar([{ tipo: "BL", campos: doc({ onDeck: campo("goods may be loaded on deck") }) }], "ucp-26a")?.estado,
    ).toBe("OK");
  });

  it("27: una cláusula que declara el embalaje defectuoso ensucia el documento", () => {
    const r = buscar([{ tipo: "BL", campos: doc({ clausulaDefecto: campo("BAGS TORN AND STAINED") }) }], "ucp-27");
    expect(r?.estado).toBe("DISCREPANCIA");
  });
});

describe("seguro — artículo 28", () => {
  const facturaCIF: DocAnalizado = {
    tipo: "FACTURA",
    campos: doc({ montoTotal: campo("51.262,00"), moneda: campo("USD"), fechaEmbarque: campo("08-APR-2025") }),
  };

  it("28f-ii: cubrir menos del 110 % del valor de la mercadería es discrepancia", () => {
    const r = buscar([facturaCIF], "ucp-28f-ii", { campos: doc({ montoAsegurado: campo("52.000,00") }) });
    expect(r?.estado).toBe("DISCREPANCIA");
    expect(r?.evidencia).toContain("56.388,2");
  });

  it("28f-ii: justo el 110 % alcanza", () => {
    const r = buscar([facturaCIF], "ucp-28f-ii", { campos: doc({ montoAsegurado: campo("56.388,20") }) });
    expect(r?.estado).toBe("OK");
  });

  it("28f-i: el seguro en otra moneda que el crédito es discrepancia", () => {
    const r = buscar([facturaCIF], "ucp-28f-i", { campos: doc({ monedaAsegurada: campo("EUR") }) });
    expect(r?.estado).toBe("DISCREPANCIA");
  });

  it("28e: un seguro fechado después del embarque es discrepancia", () => {
    const r = buscar([facturaCIF], "ucp-28e", { campos: doc({ fechaSeguro: campo("15-APR-2025") }) });
    expect(r?.estado).toBe("DISCREPANCIA");
  });

  it("28e: fechado el mismo día del embarque pasa", () => {
    const r = buscar([facturaCIF], "ucp-28e", { campos: doc({ fechaSeguro: campo("08-APR-2025") }) });
    expect(r?.estado).toBe("OK");
  });

  it("28c: una nota de cobertura no se acepta", () => {
    const r = buscar([facturaCIF], "ucp-28c", { campos: doc({ tipoSeguro: campo("COVER NOTE") }) });
    expect(r?.estado).toBe("DISCREPANCIA");
  });

  it("28a: emitido por alguien que no es una aseguradora queda a verificar", () => {
    const r = buscar([facturaCIF], "ucp-28a", { campos: doc({ emisorSeguro: campo("MOLSUR S.A.") }) });
    expect(r?.estado).toBe("ATENCION");
  });

  it("no corre ninguna regla de seguro si no se presentó el documento", () => {
    expect(corre([facturaCIF]).some((r) => r.id.startsWith("ucp-28"))).toBe(false);
  });
});

describe("reglas generales", () => {
  it("14i: un documento fechado después de la presentación es discrepancia", () => {
    const r = buscar([{ tipo: "FACTURA", campos: doc({ fechaDocumento: campo("30-APR-2025") }) }], "ucp-14i-FACTURA");
    expect(r?.estado).toBe("DISCREPANCIA");
  });

  it("14i: fechado antes de la presentación pasa", () => {
    const r = buscar([{ tipo: "FACTURA", campos: doc({ fechaDocumento: campo("08-APR-2025") }) }], "ucp-14i-FACTURA");
    expect(r?.estado).toBe("OK");
  });

  it("14e: en un documento que no es la factura, una mercadería que no se parece queda a verificar", () => {
    const r = buscar([{ tipo: "PACKING", campos: doc({ mercaderia: campo("SOYBEAN MEAL") }) }], "ucp-14e-PACKING");
    expect(r?.estado).toBe("ATENCION");
  });

  it("14e: la misma mercadería del crédito pasa", () => {
    const r = buscar(
      [{ tipo: "PACKING", campos: doc({ mercaderia: campo("FISH MEAL 54PCT MIN") }) }],
      "ucp-14e-PACKING",
    );
    expect(r?.estado).toBe("OK");
  });

  it("30b: el crédito del caso fija tolerancia propia, así que la regla por defecto no aparece", () => {
    expect(LC.tolerancia).toBe(0.1);
    expect(corre([{ tipo: "FACTURA", campos: doc({}) }]).some((r) => r.id === "ucp-30b")).toBe(false);
  });

  it("30b: sin tolerancia en el crédito, se explicita el ±5 % sobre la cantidad", () => {
    const sinTol = reglasUCP({
      lc: { ...LC, tolerancia: null },
      credito: { mercaderia: "FISH MEAL IN BULK" },
      docs: [{ tipo: "FACTURA", campos: doc({}) }],
      hoy: HOY,
    });
    const r = sinTol.find((x) => x.id === "ucp-30b");
    expect(r?.evidencia).toContain("±5 %");
  });

  it("30b: cuando la cantidad va en bultos, la tolerancia del 5 % no corre", () => {
    const enBultos = reglasUCP({
      lc: { ...LC, tolerancia: null },
      credito: { mercaderia: "1360 BAGS OF FISH MEAL" },
      docs: [{ tipo: "FACTURA", campos: doc({}) }],
      hoy: HOY,
    });
    expect(enBultos.find((x) => x.id === "ucp-30b")?.regla).toContain("no corre la tolerancia");
  });
});

describe("el paquete real del caso CSU2025099", () => {
  it("no levanta ninguna discrepancia nueva sobre los documentos que el banco aceptó", () => {
    const docs: DocAnalizado[] = [
      {
        tipo: "FACTURA",
        campos: doc({
          importador: campo("ORIENT FEED (PVT) LTD"),
          moneda: campo("USD"),
          mercaderia: campo("FISH MEAL 54PCT MIN (FOR ANIMAL FEED USE)"),
          fechaDocumento: campo("08/04/25"),
        }),
      },
      {
        tipo: "BL",
        campos: doc({
          puertoEmbarque: campo("MONTEVIDEO, URUGUAY"),
          puertoDestino: campo("COLOMBO, SRI LANKA"),
          onBoard: campo("SHIPPED ON BOARD 08-APR-2025"),
          mercaderia: campo("FISH MEAL 54PCT MIN (FOR ANIMAL FEED USE)"),
        }),
      },
    ];
    const r = corre(docs);
    expect(r.filter((x) => x.estado === "DISCREPANCIA")).toEqual([]);
  });
});

describe("el conocimiento de embarque real, leído del papel escaneado", () => {
  /* Los valores salen de las dos hojas del BL MVD0990117 de OCEANLINE — el documento que el
     Meridian Bank aceptó. Si alguna de estas reglas lo marca, la regla está mal. */
  const BL_REAL: DocAnalizado = {
    tipo: "BL",
    campos: doc({
      puertoEmbarque: campo("MONTEVIDEO, URUGUAY"),
      puertoDestino: campo("COLOMBO, SRI LANKA"),
      onBoard: campo("Shipped on Board STELLA AUSTRAL 08-APR-2025 OCEANLINE Uruguay As agents for the Carrier"),
      buque: campo("STELLA AUSTRAL"),
      onDeck: campo(
        "The shipper acknowledges that the Carrier may carry the goods identified in this bill of lading on the deck of any vessel",
      ),
      juegoOriginales: campo("three (3) original Bills of Lading"),
      numeroLC: campo("LCMRDN25000471"),
    }),
  };

  it("26a: la cláusula de opción que OCEANLINE imprime en todos sus conocimientos NO es discrepancia", () => {
    expect(buscar([BL_REAL], "ucp-26a")?.estado).toBe("OK");
  });

  it("26a: pero declarar la carga sobre cubierta sí lo es", () => {
    const r = buscar(
      [{ tipo: "BL", campos: doc({ onDeck: campo("CARGO SHIPPED ON DECK AT SHIPPER'S RISK") }) }],
      "ucp-26a",
    );
    expect(r?.estado).toBe("DISCREPANCIA");
  });

  it("20a-ii: la anotación de a bordo real, con buque y fecha, pasa", () => {
    expect(buscar([BL_REAL], "ucp-20a-ii")?.estado).toBe("OK");
  });

  it("20a-iv: tres originales emitidos es el juego completo", () => {
    expect(buscar([BL_REAL], "ucp-20a-iv")?.estado).toBe("OK");
  });

  it("20a-iv: presentar la copia no negociable en lugar del original es discrepancia", () => {
    const r = buscar([{ tipo: "BL", campos: doc({ juegoOriginales: campo("COPY NON NEGOTIABLE") }) }], "ucp-20a-iv");
    expect(r?.estado).toBe("DISCREPANCIA");
  });

  it("el conocimiento real no levanta ninguna discrepancia", () => {
    expect(corre([BL_REAL]).filter((r) => r.estado === "DISCREPANCIA")).toEqual([]);
  });
});

describe("el documento de transporte se examina con el artículo que le corresponde", () => {
  /*
   * El motor examinaba todo documento de transporte con el artículo 20, el marítimo, porque era el
   * único que conocía. Las UCP dedican siete artículos al transporte —19 a 25— y cada uno pide
   * cosas distintas: a un aéreo se le pedía la anotación de a bordo, que no tiene nunca.
   */

  it("un crédito que EXIGE un conocimiento de fletamento no puede rechazarlo por serlo", () => {
    /*
     * El caso real de los graneles: un crédito de cereal o de harina a granel pide «CHARTER PARTY
     * BILL OF LADING» en el 46A, y existe el artículo 22 justamente para examinarlo. Marcarlo como
     * discrepancia por estar sujeto a fletamento es rechazar el documento que el propio crédito
     * pidió.
     */
    const lcConFletamento: LcInfo = {
      ...LC,
      documentosExigidos: ["CHARTER PARTY BILL OF LADING PLUS 02 NON NEGOTIABLE COPIES"],
    };
    const r = reglasUCP({
      lc: lcConFletamento,
      credito: CTX,
      docs: [
        {
          tipo: "BL",
          campos: doc({
            charterParty: campo("SUBJECT TO CHARTER PARTY DATED 01-MAR-2025"),
            buque: campo("STELLA AUSTRAL"),
          }),
        },
      ],
      hoy: HOY,
    });
    expect(r.find((x) => x.id === "ucp-20a-vi")?.estado).not.toBe("DISCREPANCIA");
  });

  it("pero si el crédito no lo pide, sigue siendo discrepancia", () => {
    expect(
      buscar([{ tipo: "BL", campos: doc({ charterParty: campo("SUBJECT TO CHARTER PARTY") }) }], "ucp-20a-vi")?.estado,
    ).toBe("DISCREPANCIA");
  });

  it("a un aéreo no se le pide la anotación de a bordo", () => {
    const aereo = doc({
      tipoTransporte: campo("AIR WAYBILL"),
      numeroDoc: campo("020-12345678"),
      fechaDocumento: campo("08-APR-2025"),
    });
    const r = corre([{ tipo: "BL", campos: aereo }]);
    expect(r.find((x) => x.id.startsWith("ucp-20a-ii"))).toBeUndefined();
  });

  it("y se dice con qué artículo se lo examinó: sin eso el examen no se puede discutir", () => {
    const aereo = doc({ tipoTransporte: campo("AIR WAYBILL"), numeroDoc: campo("020-12345678") });
    const clase = corre([{ tipo: "BL", campos: aereo }]).find((x) => x.id === "ucp-transporte-clase");
    expect(clase?.evidencia).toMatch(/a[ée]reo|air waybill/i);
    expect(clase?.fuente).toContain("23");
  });

  it("si no se pudo determinar la clase, se examina con el 20 pero se dice", () => {
    /*
     * No examinar sería peor que examinar con el artículo equivocado: el marítimo es el caso
     * mayoritario y el examinador ya cargó el papel como conocimiento de embarque. Lo que se
     * arriesga está acotado —las comprobaciones que un aéreo no pasa dan ATENCION, no
     * discrepancia— pero tiene que quedar escrito con qué se lo examinó.
     */
    const r = corre([{ tipo: "BL", campos: doc({ numeroDoc: campo("X-1") }) }]);
    const clase = r.find((x) => x.id === "ucp-transporte-clase");
    expect(clase?.estado).toBe("ATENCION");
    expect(clase?.evidencia).toMatch(/artículo 20/);
    expect(r.some((x) => x.id.startsWith("ucp-20a"))).toBe(true);
  });
});

describe("el documento de transporte aéreo (UCP 600 art. 23)", () => {
  const aereo = (over: Partial<Record<keyof CamposDoc, { valor: string; confianza: number }>> = {}) =>
    doc({
      tipoTransporte: campo("AIR WAYBILL"),
      numeroDoc: campo("020-12345678"),
      fechaDocumento: campo("08-APR-2025"),
      puertoEmbarque: campo("MONTEVIDEO AIRPORT, URUGUAY"),
      puertoDestino: campo("COLOMBO AIRPORT, SRI LANKA"),
      ...over,
    });
  const corrAereo = (over = {}, lc: Partial<LcInfo> = {}) =>
    reglasUCP({ lc: { ...LC, ...lc }, credito: CTX, docs: [{ tipo: "BL", campos: aereo(over) }], hoy: HOY });

  it("23a-ii: tiene que decir que la mercadería fue aceptada para transporte", () => {
    const r = corrAereo({ onBoard: campo("") }).find((x) => x.id === "ucp-23a-ii");
    expect(r?.estado).toBe("ATENCION");
    const ok = corrAereo({ onBoard: campo("RECEIVED FOR CARRIAGE 08-APR-2025") }).find((x) => x.id === "ucp-23a-ii");
    expect(ok?.estado).toBe("OK");
  });

  it("23a-iii: sin notación del embarque real, la fecha de embarque es la de emisión", () => {
    const r = corrAereo().find((x) => x.id === "ucp-23a-iii");
    expect(r?.estado).toBe("OK");
    expect(r?.evidencia).toMatch(/08-APR-2025|emisi/i);
  });

  it("23a-iii: y el número de vuelo con su fecha NO cuenta para esa fecha", () => {
    /*
     * Es la trampa del artículo: el AWB trae un recuadro con vuelo y fecha —«FLIGHT UX042 / 10
     * APR»— que no es la fecha de embarque. Tomarla corre el embarque unos días y puede inventar
     * un embarque tardío contra el 44C.
     */
    const r = corrAereo({ onBoard: campo("FLIGHT UX042 DATED 10 APR 2025") }).find((x) => x.id === "ucp-23a-iii");
    expect(r?.evidencia).toMatch(/vuelo/i);
    expect(r?.estado).not.toBe("DISCREPANCIA");
  });

  it("23a-v: alcanza el original del expedidor aunque el crédito pida el juego completo", () => {
    /*
     * El crédito real dice «FULL SET OF (3/3) ... BILLS OF LADING». En un aéreo eso no se puede
     * cumplir —el expedidor recibe un solo original— y el artículo lo resuelve: basta ese. Marcarlo
     * como juego incompleto es rechazar lo único que el transportista entrega.
     */
    const r = corrAereo({ juegoOriginales: campo("ORIGINAL 3 (FOR SHIPPER)") }).find((x) => x.id === "ucp-23a-v");
    expect(r?.estado).toBe("OK");
    expect(r?.evidencia).toMatch(/expedidor|shipper/i);
  });

  it("23c-ii: el transbordo se acepta aunque el crédito lo prohíba", () => {
    const ctxSinTransbordo = { ...CTX, transbordo: "NOT ALLOWED" };
    const r = reglasUCP({
      lc: LC,
      credito: ctxSinTransbordo,
      docs: [{ tipo: "BL", campos: aereo() }],
      hoy: HOY,
    }).find((x) => x.id === "ucp-23c-ii");
    expect(r?.estado).toBe("OK");
    expect(r?.evidencia).toMatch(/aunque el crédito lo prohíba|23 ?\(?c/i);
  });

  it("23a-iv: los aeropuertos son los que fija el crédito", () => {
    const malo = corrAereo({ puertoEmbarque: campo("BUENOS AIRES AIRPORT") }).find((x) => x.id === "ucp-23a-iv-carga");
    expect(malo?.estado).toBe("DISCREPANCIA");
  });

  it("y ninguna regla del artículo 20 se aplica a un aéreo", () => {
    expect(corrAereo().some((x) => x.id.startsWith("ucp-20a"))).toBe(false);
  });
});
