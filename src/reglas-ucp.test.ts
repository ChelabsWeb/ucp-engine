import { describe, expect, it } from "vitest";
import type { CamposDoc } from "./consistencia";
import { contextoDesdeSwift } from "./examen";
import { SWIFT_CSU2025099 } from "./fixtures";
import { textoEnIngles } from "./ingles";
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

  it("20a-iii: el puerto del caso de referencia coincide con el 44E del crédito", () => {
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
     * El caso de referencia de los graneles: un crédito de cereal o de harina a granel pide «CHARTER PARTY
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

describe("los transportes que no son marítimos ni aéreos", () => {
  const corr = (campos: CamposDoc, ctx: Partial<ContextoCredito> = {}) =>
    reglasUCP({ lc: LC, credito: { ...CTX, ...ctx }, docs: [{ tipo: "BL", campos }], hoy: HOY });

  describe("multimodal (art. 19)", () => {
    const multi = (over = {}) =>
      doc({
        tipoTransporte: campo("MULTIMODAL TRANSPORT DOCUMENT"),
        numeroDoc: campo("MMD-2025-0417"),
        puertoEmbarque: campo("MONTEVIDEO, URUGUAY"),
        puertoDestino: campo("COLOMBO, SRI LANKA"),
        onBoard: campo("TAKEN IN CHARGE 08-APR-2025"),
        ...over,
      });

    it("19a-ii: vale despachado, tomado a cargo o a bordo — no solo a bordo", () => {
      const r = corr(multi()).find((x) => x.id === "ucp-19a-ii");
      expect(r?.estado).toBe("OK");
    });

    /*
     * Y «received for shipment» también, por R 638 / TA 629: es la leyenda más corriente de un
     * multimodal y el motor la mandaba a verificar porque la lista decía «shipped» y no «shipment».
     */
    it("19a-ii: y «received for shipment» cumple (R 638 / TA 629)", () => {
      const r = corr(multi({ onBoard: campo("RECEIVED FOR SHIPMENT 08-APR-2025") })).find(
        (x) => x.id === "ucp-19a-ii",
      );
      expect(r?.estado).toBe("OK");
    });

    it("pero sobre un marítimo del artículo 20 no alcanza: ahí manda la anotación de a bordo", () => {
      const r = reglasUCP({
        lc: LC,
        credito: CTX,
        docs: [
          {
            tipo: "BL" as const,
            campos: doc({
              tipoTransporte: campo("OCEAN BILL OF LADING"),
              puertoEmbarque: campo("MONTEVIDEO, URUGUAY"),
              puertoDestino: campo("COLOMBO, SRI LANKA"),
              onBoard: campo("RECEIVED FOR SHIPMENT"),
            }),
          },
        ],
        hoy: HOY,
      }).find((x) => x.id === "ucp-20a-ii");
      expect(r?.estado).toBe("ATENCION");
    });

    /*
     * Y acá **cambió el veredicto**, por la Opinión R 638 / TA 629.
     *
     * Este test afirmaba DISCREPANCIA, que es exactamente el rechazo que la Opinión declara inválido:
     * en un multimodal el casillero del puerto de carga es el del tramo oceánico, y el lugar que el
     * crédito nombra aparece en el de lugar de recepción, que el motor no lee. Queda ATENCION con la
     * Opinión nombrada — el documento puede de verdad estar cargando donde no corresponde, y eso lo
     * decide una persona mirando el casillero que falta.
     */
    it("19a-iii: el lugar de carga distinto no se rechaza en un multimodal (R 638 / TA 629)", () => {
      const r = corr(multi({ puertoEmbarque: campo("BUENOS AIRES") })).find((x) => x.id === "ucp-19a-iii-carga");
      expect(r?.estado).toBe("ATENCION");
      expect(r?.evidencia).toContain("R 638");
      expect(r?.evidencia).toContain("lugar de recepción");
    });

    it("pero el lugar de destino sí: la Opinión decide el lado de la carga y nada más", () => {
      const r = corr(multi({ puertoDestino: campo("BUENOS AIRES") })).find((x) => x.id === "ucp-19a-iii-destino");
      expect(r?.estado).toBe("DISCREPANCIA");
    });

    it("19a-iii: y «intended» no lo hace discrepante, que es lo que el artículo aclara", () => {
      const r = corr(multi({ puertoEmbarque: campo("INTENDED PORT OF LOADING MONTEVIDEO, URUGUAY") })).find(
        (x) => x.id === "ucp-19a-iii-carga",
      );
      expect(r?.estado).toBe("OK");
    });

    it("19c-ii: el transbordo se acepta aunque el crédito lo prohíba", () => {
      const r = corr(multi(), { transbordo: "NOT ALLOWED" }).find((x) => x.id === "ucp-19c-ii");
      expect(r?.estado).toBe("OK");
    });

    it("19a-vi: pero sujeto a fletamento sigue sin servir", () => {
      const r = corr(multi({ charterParty: campo("SUBJECT TO CHARTER PARTY") }));
      // Con cláusula de fletamento el documento pasa a examinarse por el artículo 22, no por el 19.
      expect(r.find((x) => x.id === "ucp-transporte-clase")?.fuente).toContain("22");
    });
  });

  describe("carretera, ferrocarril o vía navegable (art. 24)", () => {
    const cmr = (over = {}) =>
      doc({
        tipoTransporte: campo("CMR CONSIGNMENT NOTE"),
        numeroDoc: campo("CMR-88213"),
        fechaDocumento: campo("08-APR-2025"),
        puertoEmbarque: campo("MONTEVIDEO, URUGUAY"),
        puertoDestino: campo("COLOMBO, SRI LANKA"),
        ...over,
      });

    it("24a-ii: sin sello de recepción fechado, la fecha de emisión es la de embarque", () => {
      const r = corr(cmr()).find((x) => x.id === "ucp-24a-ii");
      expect(r?.estado).toBe("OK");
      expect(r?.evidencia).toMatch(/08-APR-2025/);
    });

    it("24a-iii: el lugar de embarque y el de destino son los del crédito", () => {
      const malo = corr(cmr({ puertoDestino: campo("MUMBAI") })).find((x) => x.id === "ucp-24a-iii-destino");
      expect(malo?.estado).toBe("DISCREPANCIA");
    });

    it("24b-ii: un documento ferroviario marcado «duplicate» se acepta como original", () => {
      const r = corr(cmr({ tipoTransporte: campo("RAIL WAYBILL"), juegoOriginales: campo("DUPLICATE") })).find(
        (x) => x.id === "ucp-24b",
      );
      expect(r?.estado).toBe("OK");
      expect(r?.evidencia).toMatch(/duplicate/i);
    });
  });

  describe("courier (art. 25)", () => {
    const courier = (over = {}) =>
      doc({
        tipoTransporte: campo("COURIER RECEIPT"),
        numeroDoc: campo("DHL-7712340098"),
        fechaDocumento: campo("08-APR-2025"),
        exportador: campo("CEREALSUR S.A"),
        ...over,
      });

    it("25a: tiene que nombrar al courier y estar sellado o firmado", () => {
      const r = corr(courier()).find((x) => x.id === "ucp-25a-i");
      expect(r?.estado).toBe("ATENCION");
    });

    it("25b: la fecha de recogida o de recibo es la fecha de embarque", () => {
      const r = corr(courier()).find((x) => x.id === "ucp-25b");
      expect(r?.evidencia).toMatch(/08-APR-2025/);
    });
  });
});

describe("cuando el crédito indica una zona y no un puerto", () => {
  /*
   * El artículo 22 (a) (iii) lo dice para el fletamento —el puerto de descarga puede mostrarse como
   * un rango de puertos o una zona geográfica— y en la práctica aparece en cualquier crédito de
   * graneles: «EUROPEAN MAIN PORTS», «ARAG RANGE», «ANY PORT IN SRI LANKA».
   *
   * El motor no sabe geografía y no puede saber si Rotterdam está en «EUROPEAN MAIN PORTS». Lo que
   * no puede decidir no lo dictamina: lo manda a verificar. Marcar discrepancia sobre un embarque
   * correcto es peor que pedir que alguien lo mire.
   */
  const conDestino = (enCredito: string, enDoc: string, charter = true) =>
    reglasUCP({
      lc: LC,
      credito: { ...CTX, puertoDestino: enCredito },
      docs: [
        {
          tipo: "BL",
          campos: doc({
            puertoDestino: campo(enDoc),
            buque: campo("STELLA AUSTRAL"),
            ...(charter ? { charterParty: campo("SUBJECT TO CHARTER PARTY DATED 01-MAR-25") } : {}),
          }),
        },
      ],
      hoy: HOY,
    }).find((x) => x.id.includes("puertoDestino"));

  it("un puerto dentro de una zona no se marca como discrepancia: se manda a verificar", () => {
    const r = conDestino("EUROPEAN MAIN PORTS", "ROTTERDAM");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toMatch(/zona|rango/i);
  });

  it.each([
    ["ARAG RANGE", "ANTWERP"],
    ["ANY PORT IN SRI LANKA", "GALLE"],
    ["US GULF PORTS", "HOUSTON"],
    ["COLOMBO/CHENNAI", "CHENNAI"],
  ])("«%s» con «%s» tampoco", (enCredito, enDoc) => {
    expect(conDestino(enCredito, enDoc)?.estado).not.toBe("DISCREPANCIA");
  });

  /*
   * Las dos redacciones que la ICC ya resolvió, y que el motor marcaba como discrepancia.
   *
   * `\bANY\s+PORT\b` exigía las dos palabras pegadas, así que un `ANY` con el área en el medio no
   * contaba como zona — y «AIRPORT» no estaba en el vocabulario. El motor terminaba afirmando que
   * Amberes no está en el norte de Europa y que Amsterdam no es un aeropuerto europeo, cuando lo
   * que pasa es que no sabe geografía.
   *
   * En TA 796rev el banco emisor defendió su rechazo citando un sitio web que clasifica a Bélgica
   * como Europa occidental, y la ICC contestó que no le toca a un banco definir áreas geográficas:
   * la redacción vaga del crédito corre contra el ordenante, y el documento no es discrepante. En
   * TA 937, con «Any Europe Airport» y un air waybill que decía «Amsterdam», tampoco.
   */
  it.each([
    ["ANY NORTH EUROPEAN PORT", "ANTWERP", "TA 796rev"],
    ["ANY EUROPE AIRPORT", "AMSTERDAM", "TA 937"],
    ["ANY PANAMA AIRPORT", "PANAMA CIUDAD DE", "TA 937"],
    ["ANY SEAPORT IN EGYPT", "ALEXANDRIA", "TA 957rev"],
  ])("«%s» con «%s» no es discrepancia (%s)", (enCredito, enDoc) => {
    expect(conDestino(enCredito, enDoc)?.estado).not.toBe("DISCREPANCIA");
  });

  it("un aeropuerto concreto sigue siendo un aeropuerto concreto, no una zona", () => {
    /* Lo que marca la zona es `ANY`, no la palabra «airport»: sin este límite, cualquier crédito
       aéreo dejaría de dictaminar sobre la ruta y el artículo 23 (a) (iv) quedaría decorativo. */
    expect(conDestino("MONTEVIDEO AIRPORT", "SINGAPORE")?.estado).toBe("DISCREPANCIA");
  });

  it("y dos lugares distintos no coinciden por la palabra «port» que los dos llevan", () => {
    /*
     * Encontrado escribiendo el test de arriba, que pasaba por el motivo equivocado: «MONTEVIDEO
     * AIRPORT» contra «BUENOS AIRES AIRPORT» daba OK porque `coincideLugar` solo descarta las
     * palabras de tres letras o menos, y «PORT», «AIRPORT» y «TERMINAL» son más largas. Con eso
     * **cualquier** par de puertos escritos con su genérico coincidía, que es un falso negativo del
     * lado que paga de más: el documento de transporte podía ir a otro puerto y la regla salía OK.
     *
     * Es el mismo defecto que las once contrapartes del ERP que coincidían con las listas de
     * sanciones por la palabra «LLC»: una coincidencia apoyada en una palabra que está en todos los
     * nombres del rubro no dice nada.
     */
    expect(conDestino("MONTEVIDEO AIRPORT", "BUENOS AIRES AIRPORT")?.estado).toBe("DISCREPANCIA");
    expect(conDestino("MONTEVIDEO PORT", "SINGAPORE PORT")?.estado).toBe("DISCREPANCIA");
    expect(conDestino("SHANGHAI CONTAINER TERMINAL", "BUSAN CONTAINER TERMINAL")?.estado).toBe("DISCREPANCIA");
  });

  it("pero el mismo puerto escrito con y sin su genérico sigue coincidiendo", () => {
    /* Es la redacción del crédito real: «MONTEVIDEO PORT IN URUGUAY» contra «MONTEVIDEO, URUGUAY». */
    expect(conDestino("MONTEVIDEO PORT IN URUGUAY", "MONTEVIDEO, URUGUAY")?.estado).toBe("OK");
    expect(conDestino("COLOMBO PORT", "COLOMBO, SRI LANKA")?.estado).toBe("OK");
  });

  it("pero un puerto concreto contra otro puerto concreto sigue siendo discrepancia", () => {
    // El aflojamiento vale para las zonas. Si el crédito nombra un puerto, sigue mandando.
    expect(conDestino("COLOMBO,SRI LANKA", "MUMBAI, INDIA")?.estado).toBe("DISCREPANCIA");
  });

  it("y si el documento coincide con la zona tal cual, está bien sin más vueltas", () => {
    expect(conDestino("EUROPEAN MAIN PORTS", "EUROPEAN MAIN PORTS")?.estado).toBe("OK");
  });
});

describe("el contrato de fletamento, que el banco no examina (art. 22 b)", () => {
  const conExigencia = (exigidos: string[]) =>
    reglasUCP({
      lc: { ...LC, documentosExigidos: exigidos },
      credito: CTX,
      docs: [{ tipo: "BL", campos: doc({ buque: campo("STELLA AUSTRAL") }) }],
      hoy: HOY,
    }).find((x) => x.id === "ucp-22b");

  it("si el crédito lo pide, se dice que se presenta pero no se revisa", () => {
    /*
     * El artículo es terminante: el banco no examina los contratos de fletamento, aunque las
     * condiciones del crédito exijan presentarlos. Decirlo ahorra el trabajo de revisar cien
     * páginas que no cambian el resultado, y evita que alguien invoque una discrepancia sobre algo
     * que no se examina.
     */
    const r = conExigencia(["CHARTER PARTY CONTRACT", "COMMERCIAL INVOICE IN 03 FOLD"]);
    expect(r?.estado).toBe("OK");
    expect(r?.evidencia).toMatch(/no se examina|no examina/i);
  });

  it("y si no lo pide, no se dice nada: una regla de más es ruido", () => {
    expect(conExigencia(["COMMERCIAL INVOICE IN 03 FOLD"])).toBeUndefined();
  });
});

describe("quién emite y quién embarca, que no son la misma pregunta (arts. 18 a i y 14 k)", () => {
  /*
   * El motor las mezclaba en un solo aviso que terminaba diciendo «si la LC no admite documentos de
   * terceros, es discrepancia». Para el embarcador eso es falso: el artículo 14 (k) dice que el
   * shipper indicado en cualquier documento no necesita ser el beneficiario, sin condición alguna.
   * Lo que sí tiene que emitir el beneficiario es la factura (18 a i).
   */
  const conBeneficiario = (ctx: Partial<ContextoCredito>, docs: DocAnalizado[]) =>
    reglasUCP({ lc: LC, credito: { ...CTX, beneficiario: "CEREALSUR S.A", ...ctx }, docs, hoy: HOY });

  it("18 a i: una factura emitida por alguien que no es el beneficiario es discrepancia", () => {
    const r = conBeneficiario({}, [{ tipo: "FACTURA", campos: doc({ exportador: campo("MOLSUR S.A.") }) }]);
    const x = r.find((y) => y.id === "ucp-18a-i");
    expect(x?.estado).toBe("DISCREPANCIA");
    expect(x?.fuente).toContain("18a-i");
  });

  it("y emitida por el beneficiario, pasa", () => {
    const r = conBeneficiario({}, [{ tipo: "FACTURA", campos: doc({ exportador: campo("CEREALSUR S.A") }) }]);
    expect(r.find((y) => y.id === "ucp-18a-i")?.estado).toBe("OK");
  });

  it("14 k: el shipper del conocimiento NO tiene que ser el beneficiario, y eso no es discrepancia", () => {
    /*
     * Es el caso del expediente: la factura la emite Cerealsur, que es el beneficiario, y embarca
     * Molsur, que es el productor. El motor lo marcaba como «puede ser discrepancia» y el artículo
     * dice que no lo es.
     */
    const r = conBeneficiario({}, [
      { tipo: "FACTURA", campos: doc({ exportador: campo("CEREALSUR S.A") }) },
      { tipo: "BL", campos: doc({ exportador: campo("MOLSUR S.A."), buque: campo("STELLA AUSTRAL") }) },
    ]);
    const x = r.find((y) => y.id === "ucp-14k");
    expect(x?.estado).toBe("OK");
    expect(x?.regla).toMatch(/no tiene que ser el beneficiario/i);
    expect(x?.evidencia).toMatch(/admite que no coincidan/i);
    expect(r.filter((y) => y.estado === "DISCREPANCIA" && /shipper|embarcador/i.test(y.regla))).toHaveLength(0);
  });

  it("si no hay beneficiario cargado, no se inventa el veredicto", () => {
    // El contexto del caso de referencia sí lo trae, así que acá se lo saca a propósito: lo que se prueba es
    // qué hace el motor cuando el crédito llegó sin el campo 59 legible.
    const r = reglasUCP({
      lc: LC,
      credito: { ...CTX, beneficiario: null },
      docs: [{ tipo: "FACTURA", campos: doc({ exportador: campo("CUALQUIERA") }) }],
      hoy: HOY,
    });
    expect(r.find((y) => y.id === "ucp-18a-i")?.estado).toBe("ATENCION");
  });
});

describe("la cantidad en bultos (UCP 600 art. 30 b)", () => {
  /*
   * La condición del inciso es que el crédito exprese LA CANTIDAD en bultos o unidades, no que
   * mencione el embalaje. «57 MTS OF FISH MEAL PACKED IN BAGS OF 50 KG» expresa la cantidad en
   * toneladas: el ±5 % corre. El motor miraba si aparecía la palabra «bags» en cualquier parte del
   * 45A y anunciaba lo contrario.
   */
  const con45A = (mercaderia: string) =>
    reglasUCP({
      lc: { ...LC, tolerancia: null },
      credito: { ...CTX, mercaderia },
      docs: [],
      hoy: HOY,
    }).find((x) => x.id === "ucp-30b");

  it("la cantidad en toneladas admite el 5 %, aunque el crédito diga cómo va embalada", () => {
    const r = con45A("57 MTS OF FISH MEAL 54PCT MIN PACKED IN BAGS OF 50 KG");
    expect(r?.regla).toMatch(/admite ±5|±5 %/);
    expect(r?.regla).not.toMatch(/en bultos/i);
  });

  it("pero si la cantidad va en bultos, no corre", () => {
    expect(con45A("1360 BAGS OF FISH MEAL")?.regla).toMatch(/en bultos/i);
  });

  it("y con la mercadería del caso de referencia, corre el 5 %", () => {
    expect(con45A("57 MTS OF FISH MEAL 54PCT MIN (FOR ANIMAL FEED USE)")?.regla).toMatch(/±5/);
  });
});

describe("el documento de seguro (UCP 600 art. 28), lo que el artículo sí dice", () => {
  const seguro = (over: Partial<Record<keyof CamposDoc, { valor: string; confianza: number }>> = {}) => ({
    campos: doc({
      tipoSeguro: campo("INSURANCE POLICY"),
      emisorSeguro: campo("SURA SEGUROS S.A."),
      montoAsegurado: campo("56.388,20"),
      monedaAsegurada: campo("USD"),
      fechaSeguro: campo("07-APR-2025"),
      coberturaDesde: campo("MONTEVIDEO"),
      coberturaHasta: campo("COLOMBO"),
      ...over,
    }),
  });
  const conSeguro = (
    segOver: Parameters<typeof seguro>[0] = {},
    docs: DocAnalizado[] = [],
    lcOver: Partial<LcInfo> = {},
    ctxOver: Partial<ContextoCredito> = {},
  ) =>
    reglasUCP({
      lc: { ...LC, ...lcOver },
      credito: { ...CTX, ...ctxOver },
      docs,
      seguro: seguro(segOver),
      hoy: HOY,
    });

  it("28 f ii: sin el total de la factura no se cae al monto del crédito, se manda a verificar", () => {
    /*
     * El artículo nombra tres bases y ninguna es el monto del crédito: el valor CIF/CIP, y si no se
     * puede determinar, el importe girado o el valor bruto de la factura, el mayor. Con el monto del
     * crédito como base, cualquier embarque parcial cuyo total de factura no se lea sale con
     * discrepancia de seguro por un importe que nadie exige.
     */
    const r = conSeguro({ montoAsegurado: campo("30.000") }, [
      { tipo: "FACTURA", campos: doc({ montoTotal: campo("") }) },
    ]).find((x) => x.id === "ucp-28f-ii");
    expect(r?.estado).not.toBe("DISCREPANCIA");
  });

  it("28 f ii: si el crédito fija un porcentaje, ese es el mínimo, no el 110 %", () => {
    // «A requirement in the credit for insurance coverage to be for a percentage … is deemed to be
    // the minimum amount of coverage required.» Un seguro que cumple lo que el crédito pidió no
    // puede rechazarse por no llegar a un 110 % que el crédito no exigió.
    const r = conSeguro(
      { montoAsegurado: campo("51.262,00") },
      [{ tipo: "FACTURA", campos: doc({ montoTotal: campo("51.262,00") }) }],
      {
        documentosExigidos: ["INSURANCE POLICY OR CERTIFICATE FOR 100 PCT OF INVOICE VALUE"],
      },
    ).find((x) => x.id === "ucp-28f-ii");
    expect(r?.estado).toBe("OK");
    expect(r?.evidencia).toMatch(/100/);
  });

  it("28 e: la fecha de embarque sale del documento de transporte, no de la factura", () => {
    const r = conSeguro({ fechaSeguro: campo("07-APR-2025") }, [
      { tipo: "FACTURA", campos: doc({ fechaEmbarque: campo("05-APR-2025") }) },
      { tipo: "BL", campos: doc({ onBoard: campo("SHIPPED ON BOARD 08-APR-2025"), buque: campo("STELLA AUSTRAL") }) },
    ]).find((x) => x.id === "ucp-28e");
    expect(r?.estado).toBe("OK");
  });

  it("28 e: un seguro posterior al embarque con cobertura efectiva anterior no es discrepancia", () => {
    // La excepción del inciso, que es el caso corriente de los certificados bajo póliza flotante.
    const r = conSeguro(
      {
        fechaSeguro: campo("15-APR-2025"),
        coberturaDesde: campo("COVER EFFECTIVE FROM 01-APR-2025 WAREHOUSE MONTEVIDEO"),
      },
      [{ tipo: "BL", campos: doc({ onBoard: campo("SHIPPED ON BOARD 08-APR-2025") }) }],
    ).find((x) => x.id === "ucp-28e");
    expect(r?.estado).not.toBe("DISCREPANCIA");
  });

  it("28 f iii: con el destino expresado como zona, no se dictamina", () => {
    const r = conSeguro({ coberturaHasta: campo("COLOMBO") }, [], {}, { puertoDestino: "ANY PORT IN SRI LANKA" }).find(
      (x) => x.id === "ucp-28f-iii",
    );
    expect(r?.estado).not.toBe("DISCREPANCIA");
  });

  it("28 f iii: si el campo trae una cláusula y no un lugar, no se compara como lugar", () => {
    /*
     * El campo de cobertura espera un lugar, y el documento puede traer otra cosa: «COVER EFFECTIVE
     * FROM 01-APR-2025». Compararla como lugar contra el puerto del crédito da discrepancia por un
     * texto que ni siquiera nombra una plaza.
     */
    const r = conSeguro({ coberturaDesde: campo("COVER EFFECTIVE FROM 01-APR-2025") }).find(
      (x) => x.id === "ucp-28f-iii",
    );
    expect(r?.estado).toBe("ATENCION");
  });

  it("28 f iii: una cobertura más amplia que la pedida tampoco", () => {
    // «at least between … and …»: almacén a almacén cubre de más, no de menos.
    const r = conSeguro({
      coberturaDesde: campo("WAREHOUSE MONTEVIDEO"),
      coberturaHasta: campo("WAREHOUSE COLOMBO"),
    }).find((x) => x.id === "ucp-28f-iii");
    expect(r?.estado).not.toBe("DISCREPANCIA");
  });
});

describe("si las UCP 600 se aplican a este crédito (UCP 600 art. 1)", () => {
  /*
   * El primer artículo es el que habilita a todos los demás: las reglas «se aplican a cualquier
   * crédito documentario cuando el texto del crédito indica expresamente que está sujeto a ellas».
   * El motor extraía el campo 40E y no lo miraba, así que examinaba con las UCP 600 un crédito que
   * podía no estar sujeto a ellas —o estarlo a una versión anterior— sin decir una palabra.
   *
   * Y la segunda mitad: son vinculantes «salvo que el crédito las modifique o excluya
   * expresamente». Un crédito que excluye un sub-artículo se examina hoy como si no lo excluyera.
   */
  const conReglas = (reglas: string | null, condiciones: string[] = []) =>
    reglasUCP({
      lc: { ...LC, condicionesAdicionales: condiciones },
      credito: { ...CTX, reglasAplicables: reglas },
      docs: [],
      hoy: HOY,
    });

  it("con «UCP LATEST VERSION» no se dice nada: es lo normal", () => {
    expect(conReglas("UCP LATEST VERSION").find((x) => x.id === "ucp-1")).toBeUndefined();
  });

  it("sin mención a las UCP, se avisa que el examen puede no corresponder", () => {
    const r = conReglas(null).find((x) => x.id === "ucp-1");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toMatch(/no dice|expresamente/i);
  });

  it("y con una versión anterior, también: este motor examina con las 600", () => {
    const r = conReglas("UCP 500").find((x) => x.id === "ucp-1");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toMatch(/500/);
  });

  it("si el crédito excluye un sub-artículo, se dice que el examen no lo contempla", () => {
    // El propio motor ya menciona esta posibilidad en la regla del transbordo, sin implementarla.
    const r = conReglas("UCP LATEST VERSION", ["SUB-ARTICLE 20(C) OF UCP 600 IS EXPRESSLY EXCLUDED"]).find(
      (x) => x.id === "ucp-1-exclusion",
    );
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toMatch(/20/);
  });

  it("y si no excluye nada, no se inventa el aviso", () => {
    expect(
      conReglas("UCP LATEST VERSION", ["ALL DOCUMENTS IN ENGLISH"]).find((x) => x.id === "ucp-1-exclusion"),
    ).toBeUndefined();
  });
});

describe("una proforma no es una factura comercial (ISBP 821 C1)", () => {
  /*
   * El motor tenía la regla escrita, exportada y probada —`esFacturaComercial`— y nadie la
   * llamaba: código muerto en el examen. Apareció en un backtest contra los tipos de documento
   * reales del ERP, donde «Proforma invoice» se clasificaba como factura comercial.
   *
   * Importa más desde que se desestima lo no exigido (14 g): si la proforma cuenta como la factura,
   * el crédito queda dado por cumplido con un documento que no lo cumple.
   */
  const conFactura = (titulo: string) =>
    reglasUCP({
      lc: LC,
      credito: CTX,
      docs: [{ tipo: "FACTURA", campos: doc({ tipoDocumento: campo(titulo), exportador: campo("CEREALSUR S.A") }) }],
      hoy: HOY,
    }).find((x) => x.id === "isbp-c1");

  it("una factura titulada proforma no satisface la exigencia", () => {
    const r = conFactura("PROFORMA INVOICE");
    expect(r?.estado).toBe("DISCREPANCIA");
    expect(r?.fuente).toMatch(/C1/);
  });

  it("una provisional tampoco", () => {
    expect(conFactura("PROVISIONAL INVOICE")?.estado).toBe("DISCREPANCIA");
  });

  it("una factura comercial pasa", () => {
    expect(conFactura("COMMERCIAL INVOICE")?.estado).toBe("OK");
  });

  it("y si no se leyó cómo se titula, se verifica a mano", () => {
    expect(conFactura("")?.estado).toBe("ATENCION");
  });
});

describe("la descripción de la factura cuando el crédito lista mercaderías (art. 18 c)", () => {
  /*
   * Salió de cruzar 57 pares reales del ERP: la descripción de una operación contra la factura de
   * otra. El motor marcó 49 y dejó pasar 8, todas por lo mismo — compartían «WAGYU» y «BEEF», que
   * en un crédito de carne no distinguen nada. Dos palabras del rubro alcanzaban para dar por buena
   * una factura que describe un corte que el crédito no pidió.
   *
   * Cuando el 45A enumera —y en carne enumera siempre, son decenas de cortes— lo que corresponde es
   * mirar si la factura cae en alguno de los ítems, no si comparte palabras con la lista entera.
   */
  const ctxCon = (mercaderia: string) => ({ ...CTX, mercaderia });
  const conFactura = (mercaderiaCredito: string, enLaFactura: string) =>
    reglasUCP({
      lc: LC,
      credito: ctxCon(mercaderiaCredito),
      docs: [{ tipo: "FACTURA", campos: doc({ mercaderia: campo(enLaFactura) }) }],
      hoy: HOY,
    }).find((x) => x.id === "ucp-18c");

  const LISTA_REAL =
    "WAGYU SHOULDER CLOD - BMS 4-5, WAGYU CHUCK ROLL - BMS 4-5, WAGYU KNUCKLE - BMS 4-5, WAGYU NECK - BMS 6-7";

  it("un corte que está en la lista, pasa", () => {
    expect(conFactura(LISTA_REAL, "WAGYU KNUCKLE - BMS 4-5")?.estado).toBe("OK");
  });

  it("y uno que no está, se manda a verificar aunque comparta «wagyu»", () => {
    expect(conFactura(LISTA_REAL, "OUTSIDE SKIRT WAGYU BMS 4-5")?.estado).toBe("ATENCION");
  });

  it.each([
    ["BEEF SILVERSIDE FLAT WAGYU BMS 6-7", "BIFE ANCHO WAGYU (BMS 6-7), BIFE ANGOSTO WAGYU (BMS 6-7)"],
    ["BEEF OYSTER BLADE WAGYU BMS 6-7", "BEEF TENDERLOIN WAGYU BMS 4-5, BEEF RIBEYE WAGYU BMS 4-5"],
    ["FROZEN BONELESS BEEF HEEL MUSCLE", "BEEF CHUCK, BEEF CHUCK RIB MEAT, BEEF RIB PLATE"],
  ])("«%s» no está en «%s»", (factura, credito) => {
    expect(conFactura(credito, factura)?.estado).toBe("ATENCION");
  });

  it("si el crédito no enumera, sigue bastando el parecido", () => {
    // El crédito del caso de referencia describe una sola mercadería, sin lista.
    expect(conFactura("57 MTS OF FISH MEAL 54PCT MIN", "FISH MEAL 54PCT MIN (FOR ANIMAL FEED USE)")?.estado).toBe("OK");
  });
});

describe("los nombres cortos, que el motor hacía desaparecer", () => {
  /*
   * `coincideLugar` se queda con las palabras de más de tres letras —para que «S.A.» o «de» no
   * hagan coincidir a nadie— y si no sobrevive ninguna devuelve false. Con eso, un ordenante
   * llamado IBM, DHL, ABB o SMC escrito idéntico en el crédito y en la factura daba DISCREPANCIA, y
   * un puerto como GOA o RIO también.
   *
   * Es el falso positivo más barato de disparar del motor: no hace falta ningún error en los
   * documentos, solo que alguien se llame con tres letras. Y toca siete reglas: 18 a i, 18 a ii,
   * 19 a iii, 20 a iii, 23 a iv, 24 a iii y 28 f iii.
   */
  const conOrdenante = (nombre: string, enFactura: string) =>
    reglasUCP({
      lc: LC,
      credito: { ...CTX, aplicante: nombre },
      docs: [{ tipo: "FACTURA", campos: doc({ importador: campo(enFactura) }) }],
      hoy: HOY,
    }).find((x) => x.id === "ucp-18a-ii");

  it.each(["IBM", "DHL", "ABB", "SMC", "BBC"])("«%s» a nombre de sí mismo no es discrepancia", (nombre) => {
    expect(conOrdenante(nombre, nombre)?.estado).toBe("OK");
  });

  it("y dos nombres cortos distintos siguen siendo distintos", () => {
    expect(conOrdenante("IBM", "DHL")?.estado).toBe("DISCREPANCIA");
  });

  it("un nombre corto dentro de uno largo también coincide", () => {
    expect(conOrdenante("IBM", "IBM WORLD TRADE CORPORATION")?.estado).toBe("OK");
  });

  it("y los nombres largos siguen comparándose como antes", () => {
    expect(conOrdenante("ORIENT FEED (PVT) LTD", "ORIENT FEED PVT LTD")?.estado).toBe("OK");
    expect(conOrdenante("ORIENT FEED (PVT) LTD", "OTRA EMPRESA CUALQUIERA")?.estado).toBe("DISCREPANCIA");
  });
});

describe("el documento limpio del artículo 27", () => {
  /*
   * El artículo 27 define el documento limpio por lo que NO tiene: ninguna cláusula que declare
   * defectuosa la mercadería o el embalaje. Cuando el campo viene con una forma de decir «no hay»
   * —«N/A», «NIL», «NONE», un guion— eso es un documento limpio, y el motor lo marcaba discrepante
   * porque solo reconocía cuatro palabras.
   *
   * La dirección del error importa: marcaba discrepancia sobre un conocimiento impecable.
   */
  const conClausula = (texto: string) =>
    reglasUCP({
      lc: LC,
      credito: CTX,
      docs: [{ tipo: "BL", campos: doc({ clausulaDefecto: campo(texto), buque: campo("STELLA AUSTRAL") }) }],
      hoy: HOY,
    }).find((x) => x.id === "ucp-27");

  it.each(["N/A", "NIL", "NONE", "NOT APPLICABLE", "—", "-", "NO", "SIN OBSERVACIONES"])(
    "«%s» quiere decir que no hay cláusula",
    (texto) => {
      expect(conClausula(texto)?.estado).not.toBe("DISCREPANCIA");
    },
  );

  it("y «CLEAN ON BOARD» sigue pasando", () => {
    expect(conClausula("CLEAN ON BOARD")?.estado).toBe("OK");
  });

  it("pero una cláusula de verdad sigue siendo discrepancia", () => {
    expect(conClausula("BAGS TORN AND STAINED")?.estado).toBe("DISCREPANCIA");
    expect(conClausula("3 CARTONS WET")?.estado).toBe("DISCREPANCIA");
  });

  /*
   * «Expresamente» es la palabra del artículo, y la regla la ignoraba.
   *
   * El 27 pide una cláusula que **declare expresamente** defectuosa la mercadería o su embalaje. La
   * regla trataba cualquier texto que no fuera un «no hay nada» como una declaración de defecto, así
   * que daba DISCREPANCIA sobre texto que no declara nada.
   *
   * La Opinión TA 941rev es ese caso: un conocimiento que decía «Cargo Conditions As Per Survey
   * Report issued by [surveyor]», con el informe no exigido por el crédito. El banco emisor rechazó
   * porque sin ese informe no podía determinar si el conocimiento estaba limpio, y la ICC contestó
   * que «There was no wording on the bill of lading which suggested any defective condition of the
   * goods or their packaging» — y que un documento no exigido se desestima, así que «this would have
   * remained the case even if the survey report had been presented».
   *
   * Es el mismo error que la cláusula «the Carrier may carry the goods on deck» del primer
   * expediente real: una condición general del transportista leída como una declaración sobre este
   * embarque.
   */
  it.each([
    "CARGO CONDITIONS AS PER SURVEY REPORT ISSUED BY SGS",
    "SHIPPER'S LOAD, STOW AND COUNT",
    "SAID TO CONTAIN",
    "THE CARRIER MAY CARRY THE GOODS ON DECK",
  ])("«%s» no declara un defecto, así que no se dictamina", (texto) => {
    const r = conClausula(texto);
    expect(r?.estado, "declarar discrepancia acá es rechazar un conocimiento impecable").not.toBe("DISCREPANCIA");
    /* Y tampoco OK: el motor no puede afirmar que no haya defecto, solo que no lo encontró. */
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toMatch(/no declara expresamente/);
  });

  it("y la declaración de defecto se reconoce aunque venga como observación del buque", () => {
    /* El positivo verdadero del que salió la lista: óxido declarado sobre toda la carga. */
    expect(conClausula("SHIP'S REMARK: ALL CARGO ATMOSPHERIC RUSTY")?.estado).toBe("DISCREPANCIA");
    expect(conClausula("INSUFFICIENT PACKING")?.estado).toBe("DISCREPANCIA");
    expect(conClausula("2 BAGS SHORT")?.estado).toBe("DISCREPANCIA");
  });
});

describe("la cantidad de la factura contra la que pide el crédito (art. 30)", () => {
  /*
   * No existía la regla, y es un falso negativo de los que cuestan: el crédito real pide «57 MTS»
   * con 10 % de tolerancia (51,3 a 62,7) y una factura por 48 MT —un 16 % corto— pasaba en
   * silencio. El único cotejo de cantidad que había era **entre documentos**: si la factura, el
   * packing y el conocimiento decían todos 48, no había nada que marcar.
   *
   * La tolerancia sale del crédito cuando la declara (39A) y del artículo 30 (b) cuando no, que da
   * 5 % — y ese 5 % no corre cuando la cantidad está expresada en bultos o unidades, porque el
   * artículo lo limita a peso y volumen.
   */
  const conCantidad = (cantidad: string, unidad = "MT", lcOver: Partial<typeof LC> = {}) =>
    reglasUCP({
      lc: { ...LC, ...lcOver },
      credito: { ...CTX, mercaderia: "57 MTS OF FISH MEAL 54PCT MIN (FOR ANIMAL FEED USE)" },
      docs: [{ tipo: "FACTURA", campos: doc({ cantidad: campo(cantidad), unidad: campo(unidad) }) }],
      hoy: HOY,
    }).find((x) => x.id === "ucp-30b-cantidad");

  it("dentro de la tolerancia del crédito, cumple", () => {
    expect(conCantidad("57")?.estado).toBe("OK");
    expect(conCantidad("52")?.estado).toBe("OK");
    expect(conCantidad("62")?.estado).toBe("OK");
  });

  /*
   * ── Cambio de criterio (8-oct): el giro CORTO bajo 43P ALLOWED es ATENCION, no DISCREPANCIA ──
   *
   * Con embarques parciales permitidos, presentar por menos cantidad que el total del crédito es
   * un giro parcial y el banco no lo rechaza: llamarlo discrepancia era inventar un rechazo. El
   * caso que lo destapó es real — 223,27 MT contra un crédito de 500 con 43P ALLOWED, primer
   * embarque de un contrato, aceptado por el banco.
   *
   * Tampoco pasa a OK: el motor no distingue «embarqué el 45 % a propósito» de «cargué mal la
   * cantidad». Queda dicho y lo mira una persona.
   *
   * El EXCESO sigue siendo discrepancia con o sin parciales, y el corto vuelve a serlo cuando el
   * crédito los prohíbe. El crédito de referencia de estos tests tiene 43P ALLOWED, y por eso
   * varios de abajo cambiaron de veredicto.
   */
  it("un embarque corto fuera de tolerancia queda en atención: el 43P admite parciales", () => {
    const r = conCantidad("48");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toMatch(/48/);
    expect(r?.evidencia).toMatch(/57/);
  });

  it("y uno excedido también", () => {
    expect(conCantidad("70")?.estado).toBe("DISCREPANCIA");
  });

  /*
   * Los tres de abajo son indulgencias del artículo 30: el motor dejaba pasar cantidades que el
   * crédito no autoriza. Para un banco eso es peor que una discrepancia de más — la discrepancia
   * la discute el exportador, el pase libre lo paga el banco y nadie lo ve.
   */
  it("«about» en la fecha de embarque NO le da ±10 % a la cantidad", () => {
    /* El 30 (a) exige que «about» esté «used in connection with the amount of the credit, the
       quantity or the unit price». Un «SHIPMENT ABOUT MID APRIL» habla de la fecha: tomarlo como
       tolerancia de cantidad daba por buena una factura 8 % excedida citando el artículo
       equivocado en la evidencia. */
    const r = reglasUCP({
      lc: { ...LC, tolerancia: undefined },
      credito: { ...CTX, mercaderia: "57 MTS OF FISH MEAL 54PCT MIN\nSHIPMENT ABOUT MID APRIL 2025" },
      docs: [{ tipo: "FACTURA", campos: doc({ cantidad: campo("61.5"), unidad: campo("MT") }) }],
      hoy: HOY,
    }).find((x) => x.id === "ucp-30b-cantidad");
    expect(r?.estado, "+7,9 % con el 5 % del 30 (b) es discrepancia").toBe("DISCREPANCIA");
    expect(r?.fuente, "el «about» de la fecha no es el del 30 (a)").not.toBe("UCP 600 30a");
  });

  it("pero «about» pegado a la cantidad sí da el ±10 % del 30 (a)", () => {
    const r = reglasUCP({
      lc: { ...LC, tolerancia: undefined },
      credito: { ...CTX, mercaderia: "ABOUT 57 MTS OF FISH MEAL 54PCT MIN" },
      docs: [{ tipo: "FACTURA", campos: doc({ cantidad: campo("61.5"), unidad: campo("MT") }) }],
      hoy: HOY,
    }).find((x) => x.id === "ucp-30b-cantidad");
    expect(r?.estado, "+7,9 % entra en el ±10 %").toBe("OK");
    expect(r?.fuente).toBe("UCP 600 30a");
  });

  it("una tolerancia declarada MENOR al 5 % rige: no se ensancha al 30 (b)", () => {
    /* El 30 (b) da 5 % «unless the credit stipulates…». Si el crédito estipula 3 %, rige el crédito
       (art. 1): ensancharlo al 5 % con `Math.max` daba por conforme un +4,4 % que el crédito no
       autoriza, y la evidencia lo atribuía al 39A — un número que el 39A no dijo. */
    const r = conCantidad("59.5", "MT", { tolerancia: 0.03 });
    expect(r?.estado, "+4,4 % sobre un crédito que admite 3 %").toBe("DISCREPANCIA");
    expect(r?.regla, "el enunciado tiene que decir el 3 %, no el 5 %").toMatch(/±3\s*%/);
  });

  it("una tolerancia declarada MAYOR sigue rigiendo", () => {
    expect(conCantidad("62", "MT", { tolerancia: 0.1 })?.estado).toBe("OK");
  });

  it("cuando el crédito tiene dos cantidades y no hay total, lo DICE en vez de callarse", () => {
    /* `cantidadDelCredito` devuelve null a propósito —dos ítems no tienen un total deducible— y su
       comentario dice «el examen lo dice en vez de decidir». No lo decía: el llamador tenía un `if`
       sin `else` y la regla desaparecía del examen. Una regla ausente se lee como «no aplica». */
    const r = reglasUCP({
      lc: { ...LC, tolerancia: undefined },
      credito: { ...CTX, mercaderia: "500 MT OF SOYBEAN MEAL AND 300 MT OF SUNFLOWER MEAL" },
      docs: [{ tipo: "FACTURA", campos: doc({ cantidad: campo("800"), unidad: campo("MT") }) }],
      hoy: HOY,
    }).find((x) => x.id === "ucp-30b-cantidad");
    expect(r, "la regla no puede faltar: faltar se lee como «no aplica»").toBeDefined();
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia, "tiene que decir qué leyó y por qué no decide").toMatch(/500|300|a mano/i);
  });

  /*
   * Un 45A real que pone el incoterm ANTES de la cantidad.
   *
   * El crédito de AMS2026164 numera el campo: «3.UNIT PRICE: USD780/MT CFR XINGANG,CHINA» y recién
   * en el punto 4 «QUANTITY: 500MTS (+/-5%)». El parser recorta la descripción en el primer
   * incoterm —correcto para comparar descripciones contra los documentos— y con eso perdía la
   * cantidad, el total, el packing y el fabricante. Resultado: esta regla NO corría contra ese
   * crédito, y un embarque corto o excedido pasaba sin que nada lo dijera.
   */
  const CUARENTA_Y_CINCO_A = [
    "1.NAME OF COMMODITY: BOVINE MEAT AND BONE MEAL",
    "2.SPECIFICATION: PROTEIN: MIN 45% FAT: MAX 12%",
    "3.UNIT PRICE: USD780/MT CFR XINGANG,CHINA",
    "4.QUANTITY: 500MTS (+/-5%)",
    "5.TOTAL AMOUNT: USD 390,000.00",
    "6. PACKING: BULK IN CONTAINERS",
  ].join(" ");

  const conElCreditoEntero = (cantidad: string, parciales: string | null = null) =>
    reglasUCP({
      lc: { ...LC, tolerancia: undefined },
      credito: { ...CTX, mercaderia: "BOVINE MEAT AND BONE MEAL", mercaderiaCompleta: CUARENTA_Y_CINCO_A, parciales },
      docs: [{ tipo: "FACTURA", campos: doc({ cantidad: campo(cantidad), unidad: campo("MT") }) }],
      hoy: HOY,
    }).find((x) => x.id === "ucp-30b-cantidad");

  it("la cantidad se lee aunque el 45A la ponga después del incoterm", () => {
    const r = conElCreditoEntero("500");
    expect(r, "sin la cantidad del crédito la regla no existe y el examen se queda mudo").toBeDefined();
    expect(r?.estado).toBe("OK");
    expect(r?.regla, "tiene que decir contra qué compara").toMatch(/500/);
  });

  it("y entonces un embarque excedido es discrepancia", () => {
    expect(conElCreditoEntero("530")?.estado).toBe("DISCREPANCIA");
  });

  /*
   * Con parciales PERMITIDOS, un embarque corto NO es discrepancia: es un giro parcial.
   *
   * Sin esto, leer la cantidad habría sido peor que no leerla. El caso real es una factura de
   * 223,27 MT contra un crédito de 500 con 43P ALLOWED —el 45 % del total— y marcarla discrepante
   * sería inventar un rechazo sobre un paquete que el banco aceptó. Pasarse del total sigue siendo
   * discrepancia aunque los parciales estén permitidos: lo que el 30 (b) tolera es la variación de
   * la cantidad, no girar por encima del crédito.
   */
  it("con parciales permitidos, un embarque corto es un parcial y no una discrepancia", () => {
    const r = conElCreditoEntero("223.27", "ALLOWED");
    expect(r?.estado, "223 de 500 con 43P ALLOWED es un giro parcial, no un faltante").toBe("ATENCION");
    expect(r?.evidencia, "la evidencia tiene que decir por qué no se marca").toMatch(/parcial/i);
  });

  it("pero pasarse del crédito es discrepancia aunque los parciales estén permitidos", () => {
    expect(conElCreditoEntero("530", "ALLOWED")?.estado).toBe("DISCREPANCIA");
  });

  it("con parciales NO permitidos, el embarque corto vuelve a ser discrepancia", () => {
    expect(conElCreditoEntero("223.27", "NOT ALLOWED")?.estado).toBe("DISCREPANCIA");
  });

  it("la unidad se convierte: el crédito en toneladas y la factura en kilos", () => {
    expect(conCantidad("53960", "KGS")?.estado).toBe("OK");
    // corto con 43P ALLOWED → atención (ver la nota de criterio de arriba)
    expect(conCantidad("48000", "KGS")?.estado).toBe("ATENCION");
  });

  it("sin tolerancia declarada, rige el 5 % del artículo 30 (b)", () => {
    // 57 ± 5 % = 54,15 a 59,85
    expect(conCantidad("55", "MT", { tolerancia: undefined })?.estado).toBe("OK");
    expect(conCantidad("52", "MT", { tolerancia: undefined })?.estado).toBe("ATENCION");
  });

  it("pero ese 5 % no corre sobre bultos: el artículo lo limita a peso y volumen", () => {
    const r = reglasUCP({
      lc: { ...LC, tolerancia: undefined },
      credito: { ...CTX, mercaderia: "1360 BAGS OF FISH MEAL" },
      /* Por EXCESO y no por defecto: el crédito de referencia permite parciales, y un giro corto
         queda en atención por eso (ver la nota de criterio). Pasarse sigue siendo discrepancia con
         o sin parciales, así que el exceso aísla lo que este test quiere probar — que sobre bultos
         no hay 5 % que valga. */
      docs: [{ tipo: "FACTURA", campos: doc({ cantidad: campo("1390"), unidad: campo("BAGS") }) }],
      hoy: HOY,
    }).find((x) => x.id === "ucp-30b-cantidad");
    expect(r?.estado).toBe("DISCREPANCIA");
  });

  it("magnitudes que no se pueden comparar no se comparan", () => {
    // Cabezas contra kilos pueden ser la misma carga: callarse es lo correcto.
    const r = reglasUCP({
      lc: LC,
      credito: { ...CTX, mercaderia: "120 CABEZAS DE GANADO EN PIE" },
      docs: [{ tipo: "FACTURA", campos: doc({ cantidad: campo("54000"), unidad: campo("KGS") }) }],
      hoy: HOY,
    }).find((x) => x.id === "ucp-30b-cantidad");
    expect(r?.estado).not.toBe("DISCREPANCIA");
  });

  it("sin cantidad en el 45A no hay nada contra qué comparar", () => {
    const r = reglasUCP({
      lc: LC,
      /* Las DOS vistas del 45A: `mercaderia` es el campo recortado en el incoterm y
         `mercaderiaCompleta` el campo entero. Pisar una sola dejaría la cantidad del crédito de
         referencia asomando por la otra, y el test mediría contra «57 MTS» creyendo que no hay
         cantidad. */
      credito: { ...CTX, mercaderia: "FISH MEAL 54PCT MIN", mercaderiaCompleta: "FISH MEAL 54PCT MIN" },
      docs: [{ tipo: "FACTURA", campos: doc({ cantidad: campo("48"), unidad: campo("MT") }) }],
      hoy: HOY,
    }).find((x) => x.id === "ucp-30b-cantidad");
    expect(r).toBeUndefined();
  });
});

describe("el seguro fechado después del embarque (art. 28 e)", () => {
  /*
   * El artículo admite un documento de seguro fechado después del embarque si dice que la cobertura
   * rige desde una fecha no posterior a él. Esa excepción se buscaba dentro de `coberturaDesde`,
   * que es un **lugar** —la pantalla ofrece «Cover from» para escribir «MONTEVIDEO»—, así que era
   * inalcanzable: un certificado bajo póliza flotante emitido después del embarque, que es el caso
   * corriente, salía discrepante por construcción y no por lo que decía el papel.
   */
  const conSeguro = (campos: Partial<CamposDoc>) =>
    reglasUCP({
      lc: LC,
      credito: CTX,
      docs: [{ tipo: "BL", campos: doc({ fechaEmbarque: campo("08-abr-25") }) }],
      seguro: {
        campos: doc({
          tipoSeguro: campo("INSURANCE CERTIFICATE"),
          fechaSeguro: campo("10-abr-25"),
          coberturaDesde: campo("MONTEVIDEO"),
          coberturaHasta: campo("COLOMBO"),
          ...campos,
        }),
      },
      hoy: HOY,
    }).find((x) => x.id === "ucp-28e");

  it("sin cláusula de vigencia, fechado después es discrepancia", () => {
    expect(conSeguro({})?.estado).toBe("DISCREPANCIA");
  });

  it("con la cláusula, la excepción del artículo se alcanza", () => {
    const r = conSeguro({ vigenciaSeguro: campo("COVER EFFECTIVE FROM 05-APR-2025") });
    expect(r?.estado).not.toBe("DISCREPANCIA");
  });

  it("y «warehouse to warehouse» también la alcanza", () => {
    expect(conSeguro({ vigenciaSeguro: campo("WAREHOUSE TO WAREHOUSE") })?.estado).not.toBe("DISCREPANCIA");
  });

  it("un seguro fechado antes del embarque no necesita ninguna cláusula", () => {
    expect(conSeguro({ fechaSeguro: campo("05-abr-25") })?.estado).toBe("OK");
  });
});

describe("la cantidad, con lo que la auditoría encontró", () => {
  const conCantidad = (cantidad: string, unidad: string, mercaderia: string, lcOver: Partial<typeof LC> = {}) =>
    reglasUCP({
      lc: { ...LC, ...lcOver },
      credito: { ...CTX, mercaderia },
      docs: [{ tipo: "FACTURA", campos: doc({ cantidad: campo(cantidad), unidad: unidad ? campo(unidad) : vacio }) }],
      hoy: HOY,
    }).find((x) => x.id === "ucp-30b-cantidad");

  it("sin unidad en la factura no se le atribuye la del crédito", () => {
    /*
     * La pantalla ofrece «Quantity» y «Unit» por separado, así que una factura cargada con «53.960»
     * y la unidad vacía era corriente. El motor le ponía la unidad del crédito —toneladas— a un
     * número que estaba en kilos: +94567 %, la misma clase de error de mil veces de siempre.
     */
    const r = conCantidad("53.960", "", "57 MTS OF FISH MEAL");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toMatch(/unidad/i);
  });

  it("los litros llevan la tolerancia del 30 (b), que es de peso y volumen", () => {
    // El artículo excluye del 5 % los bultos y las unidades, no el volumen.
    expect(conCantidad("19600", "LITRES", "20000 LITRES OF SUNFLOWER OIL", { tolerancia: undefined })?.estado).toBe(
      "OK",
    );
    expect(conCantidad("490", "M3", "500 M3 OF SAWN TIMBER", { tolerancia: undefined })?.estado).toBe("OK");
  });

  it("pero los bultos siguen sin tolerancia", () => {
    // por exceso, para que el 43P del crédito de referencia no se cruce (ver la nota de criterio)
    expect(conCantidad("1390", "BAGS", "1360 BAGS OF FISH MEAL", { tolerancia: undefined })?.estado).toBe(
      "DISCREPANCIA",
    );
  });

  it("«about» sobre la cantidad da ±10 % y cita el 30 (a)", () => {
    /*
     * El 30 (a) dice que «about» admite ±10 %. El motor aplicaba el 5 % del 30 (b) y encima citaba
     * ese artículo, que no es el que rige el caso: un embarque a +7 % contra «ABOUT 57 MTS» cumple.
     */
    const r = conCantidad("61", "MTS", "ABOUT 57 MTS OF FISH MEAL", { tolerancia: undefined });
    expect(r?.estado).toBe("OK");
    expect(r?.fuente).toMatch(/30a/);
  });
});

describe("con qué capacidad se firmó el documento de transporte (inciso (a) (i))", () => {
  /*
   * No existía ninguna regla del inciso (a) (i) en ningún artículo del 19 al 25: se miraban puertos,
   * anotación de a bordo, originales, transbordo y cláusulas, y **quién firma no se examinaba**. Es de
   * lo primero que mira un examinador.
   *
   * Lo que decide es la capacidad declarada contra la clase del documento, porque las capacidades
   * admitidas no son las mismas: el artículo 22 admite capitán, armador o fletador y **no** al
   * transportista, al revés que el 20.
   */
  const conFirma = (firma: string, extra: Partial<Record<string, ReturnType<typeof campo>>> = {}) =>
    buscar(
      [
        {
          tipo: "BL",
          campos: doc({
            tipoTransporte: campo("BILL OF LADING"),
            buque: campo("STELLA AUSTRAL"),
            firmaTransporte: campo(firma),
            ...extra,
          } as Partial<CamposDoc>),
        },
      ],
      "ucp-firma-transporte",
    );

  /** El mismo bloque de firma sobre un conocimiento sujeto a contrato de fletamento (art. 22). */
  const enFletamento = (firma: string) =>
    conFirma(firma, { charterParty: campo("SUBJECT TO CHARTER PARTY DATED 01-MAR-2025") });

  it("TA 923rev: un agente nombrado del transportista nombrado está bien", () => {
    const r = conFirma("AS AGENT FOR THE CARRIER: XYZ SHIPPING COMPANY FOR AND ON BEHALF OF ABC LTD");
    expect(r?.estado).toBe("OK");
    expect(r?.evidencia).toMatch(/agente/);
  });

  it("R754 / TA 750rev: una sucursal del transportista, con otro nombre, también", () => {
    /*
     * Es el falso positivo que una regla nueva cometería, y la Opinión lo cierra: «Neither is the
     * fact that the name of the branch differs from the name of the carrier». Una regla que exigiera
     * que el firmante se llame como el transportista rechazaría a media línea marítima — por eso esta
     * no compara nombres, solo capacidades.
     */
    const r = conFirma("SIGNED AS THE CARRIER APM-M TRADING AS M LINE AS CARRIER / M LINE COUNTRY U BRANCH (BRANCH)");
    expect(r?.estado).toBe("OK");
  });

  it("R834 / TA 793rev: un fletamento firmado por el transportista es discrepancia", () => {
    const r = enFletamento(
      "XXX AS AGENT FOR AND ON BEHALF OF THE CARRIER DAMPSKIBSSELSKABET NORDEN A/S CAPTAIN: CAPT MABE T. BENAGUA",
    );
    expect(r?.estado).toBe("DISCREPANCIA");
    expect(r?.fuente, "y se dice con qué artículo").toMatch(/22/);
  });

  it("y el nombre de un capitán en el texto no salva esa firma", () => {
    /*
     * La trampa del caso anterior, aislada: el bloque **nombra** un capitán y la capacidad declarada
     * sigue siendo «agente del transportista». Buscar «captain» en todo el texto lo habría dado por
     * bueno, que es justo lo que la Opinión corrige.
     */
    const conCapitan = enFletamento("AS AGENT FOR THE CARRIER XYZ LINE. CAPTAIN: CAPT J. PEREYRA");
    expect(conCapitan?.estado).toBe("DISCREPANCIA");
    /* Firmado DE VERDAD por el capitán, en cambio, cumple. */
    expect(enFletamento("SIGNED AS MASTER OF THE VESSEL STELLA AUSTRAL")?.estado).toBe("OK");
  });

  it("el artículo 22 admite armador y fletador, que el 20 no", () => {
    expect(enFletamento("FOR AND ON BEHALF OF THE OWNERS")?.estado).toBe("OK");
    expect(enFletamento("AS AGENT FOR THE CHARTERERS")?.estado).toBe("OK");
    /* Y al revés: un marítimo firmado por el fletador no cumple el artículo 20. */
    const maritimo = conFirma("FOR AND ON BEHALF OF THE CHARTERERS");
    expect(maritimo?.estado).toBe("DISCREPANCIA");
    expect(maritimo?.fuente).toMatch(/20/);
  });

  it("una capacidad que no se reconoce sale a verificar y NUNCA a discrepancia", () => {
    /*
     * La dirección del error importa: los bloques de firma se redactan de mil formas, y rechazar un
     * documento bien firmado por no haber entendido cómo lo escribieron es el error que mata la
     * adopción. Acá el motor dice qué leyó y pide que alguien lo mire.
     */
    for (const raro of ["FIRMADO", "AUTHORISED SIGNATORY", "SELLO Y FIRMA", "P.P. XYZ LINE"]) {
      const r = conFirma(raro);
      expect(r?.estado, `«${raro}» no puede dar discrepancia`).toBe("ATENCION");
      expect(r?.evidencia).toContain(raro);
    }
  });

  it("sin el bloque de firma no se concluye nada, y se dice qué falta", () => {
    const r = buscar(
      [{ tipo: "BL", campos: doc({ tipoTransporte: campo("BILL OF LADING"), buque: campo("STELLA AUSTRAL") }) }],
      "ucp-firma-transporte",
    );
    expect(r?.estado).not.toBe("DISCREPANCIA");
    expect(r?.evidencia).toMatch(/firma/i);
  });

  it("con la clase sin determinar no se dictamina, porque el artículo sería una suposición", () => {
    const r = buscar(
      [{ tipo: "BL", campos: doc({ firmaTransporte: campo("FOR AND ON BEHALF OF THE CHARTERERS") }) }],
      "ucp-firma-transporte",
    );
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toMatch(/no se pudo determinar la clase/);
  });

  it("y la regla corre en las demás clases, con su artículo", () => {
    const aereo = buscar(
      [
        {
          tipo: "BL",
          campos: doc({
            tipoTransporte: campo("AIR WAYBILL"),
            numeroDoc: campo("020-12345678"),
            firmaTransporte: campo("AS AGENT FOR THE CARRIER IBERIA CARGO"),
          }),
        },
      ],
      "ucp-firma-transporte",
    );
    expect(aereo?.estado).toBe("OK");
    expect(aereo?.fuente).toMatch(/23/);

    const courier = buscar(
      [
        {
          tipo: "BL",
          campos: doc({
            tipoTransporte: campo("COURIER RECEIPT"),
            firmaTransporte: campo("STAMPED AS COURIER SERVICE DHL EXPRESS"),
          }),
        },
      ],
      "ucp-firma-transporte",
    );
    expect(courier?.estado).toBe("OK");
    expect(courier?.fuente).toMatch(/25/);
  });
});

/**
 * ISBP 821 C8 — la versión del término de entrega, que estaba escrita y no corría.
 *
 * `cotejarIncotermISBP` vivía en `isbp.ts`, exportada desde `index.ts` y con sus cuatro tests en
 * verde, y **ninguna regla la llamaba**: el párrafo C8 no se examinaba. Es el defecto que este
 * repositorio persigue —lo escrito y no ejecutado— y lo que faltaba era el nivel de la regla, que es
 * donde se decide la severidad y donde se lee el 45A entero.
 *
 * Estos tests corren contra el crédito real, que dice «CFR COLOMBO,SRI LANKA INCOTERMS 2020», así
 * que la rama se alcanza sin armar un crédito a medida.
 */
describe("la versión del término de entrega (ISBP 821 C8)", () => {
  const facturaCon = (incoterm: string) =>
    [{ tipo: "FACTURA" as const, campos: doc({ incoterm: campo(incoterm) }) }] satisfies DocAnalizado[];

  it("la misma versión cumple", () => {
    expect(buscar(facturaCon("CFR COLOMBO, SRI LANKA INCOTERMS 2020"), "isbp-c8")).toMatchObject({
      estado: "OK",
    });
  });

  it("dos versiones distintas son discrepancia: es una contradicción entre papeles (art. 14 d)", () => {
    const r = buscar(facturaCon("CFR COLOMBO, SRI LANKA INCOTERMS 2010"), "isbp-c8");
    expect(r?.estado).toBe("DISCREPANCIA");
    expect(r?.evidencia).toContain("2010");
  });

  /*
   * La omisión sale a verificar y no a discrepancia, y es deliberado: cuánto exige C8 cuando el
   * crédito nombra la versión y la factura no depende de su redacción exacta, y el texto de la
   * ISBP 821 no está comprado. Rechazar un documento apoyándose en un párrafo que no se pudo leer
   * es lo que este repositorio decidió no hacer — la misma decisión que con el certificado que no
   * dice cuándo ocurrió lo que acredita.
   */
  it("la factura que no indica la versión sale a verificar, con los dos textos a la vista", () => {
    const r = buscar(facturaCon("CFR COLOMBO, SRI LANKA"), "isbp-c8");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toContain("Incoterms 2020");
    expect(r?.evidencia).toContain("CFR COLOMBO");
  });

  it("sin término de entrega leído no se dictamina: queda como verificación pendiente", () => {
    const r = buscar([{ tipo: "FACTURA", campos: doc({}) }], "isbp-c8");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toContain("no se leyó");
  });

  /*
   * Y el freno que importa: cuando el crédito **no** nombra la versión, la regla no se emite.
   *
   * Emitir un OK en todos esos créditos —que son la mayoría— pondría en el tablero una regla que no
   * dictamina nada, y es el mismo criterio por el que las reglas del artículo 13 corren solo si el
   * crédito tiene 53A. Se comprueba sobre un contexto con el 45A sin versión.
   */
  it("no se emite cuando el crédito no nombra la versión", () => {
    const sinVersion: ContextoCredito = {
      ...CTX,
      mercaderia: "57 MTS OF FISH MEAL 54PCT MIN",
      mercaderiaCompleta: "57 MTS OF FISH MEAL 54PCT MIN CFR COLOMBO,SRI LANKA",
    };
    const reglas = reglasUCP({
      lc: LC,
      credito: sinVersion,
      docs: facturaCon("CFR COLOMBO, SRI LANKA INCOTERMS 2020"),
      hoy: HOY,
    });
    expect(reglas.find((r) => r.id === "isbp-c8")).toBeUndefined();
  });
});

/**
 * El espejo que faltaba: el crédito nombra una cantidad y la factura no declara ninguna.
 *
 * La regla resolvía una sola dirección —factura con cantidad y crédito ambiguo— y en la otra no
 * emitía nada: con el crédito pidiendo «57 MTS» y una factura que declara los renglones sin total, el
 * examen no producía **ninguna** línea de cantidad. Desde el tablero eso es indistinguible de un
 * crédito que no fija cantidad, y acá el silencio no se cuenta como conforme.
 *
 * Lo encontró la Opinión TA 962rev, que es la que dice que la ausencia de un total agregado **no es
 * discrepancia**. De ahí la severidad: ATENCION y nunca DISCREPANCIA.
 */
describe("la cantidad que el crédito pide y la factura no declara", () => {
  it("avisa en vez de callarse, y no la convierte en discrepancia", () => {
    const r = buscar(
      [{ tipo: "FACTURA", campos: doc({ mercaderia: campo("FISH MEAL IN THREE LOTS") }) }],
      "ucp-30b-cantidad",
    );
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toContain("no declara una cantidad total");
    /* Que el aviso diga contra qué no se pudo comparar, no solo que no pudo. */
    expect(r?.evidencia).toContain("57");
  });

  it("y nombra la Opinión, para que nadie la endurezca sin leerla", () => {
    const r = buscar([{ tipo: "FACTURA", campos: doc({}) }], "ucp-30b-cantidad");
    expect(r?.evidencia).toContain("TA 962rev");
  });
});

/**
 * La fuente del hallazgo es el artículo que rige, no el 20 para todos.
 *
 * Los artículos 20, 21 y 22 comparten la comprobación del inciso (a) (iii) —los puertos que el
 * crédito fija— y **no comparten el artículo**. La fuente iba fija en «UCP 600 20a-iii» para los
 * tres, así que sobre un sea waybill o un conocimiento de fletamento el motor citaba un artículo que
 * no es el que lo gobierna.
 *
 * No es cosmético: la fuente es lo que viaja en el aviso de rechazo del artículo 16 a otro banco, y
 * un aviso que invoca el artículo equivocado es un aviso que el presentador puede discutir.
 *
 * El **id** no cambia a propósito: es la clave con la que los casos del banco de pruebas nombran la
 * regla.
 */
describe("el artículo que se cita sobre los puertos depende de la clase del documento", () => {
  const conTipo = (
    tipoTransporte: string,
    extra: Partial<Record<keyof CamposDoc, { valor: string; confianza: number }>> = {},
  ) =>
    [
      {
        tipo: "BL" as const,
        campos: doc({
          tipoTransporte: campo(tipoTransporte),
          puertoEmbarque: campo("MONTEVIDEO, URUGUAY"),
          puertoDestino: campo("COLOMBO, SRI LANKA"),
          ...extra,
        }),
      },
    ] satisfies DocAnalizado[];

  it.each([
    ["BILL OF LADING", "UCP 600 20a-iii", {}],
    ["NON-NEGOTIABLE SEA WAYBILL", "UCP 600 21a-iii", {}],
    ["CHARTER PARTY BILL OF LADING", "UCP 600 22a-iii", { charterParty: campo("CHARTER PARTY DATED 01-APR-2025") }],
  ])("un %s cita %s", (tipo, fuente, extra) => {
    const r = buscar(conTipo(tipo, extra as never), "ucp-20a-iii-puertoDestino");
    expect(r?.fuente).toBe(fuente);
  });

  /*
   * Sin clase determinada se examina con el 20 igual, pero la fuente lo dice: «UCP 600 19 a 25».
   *
   * Y va sin el inciso pegado, que es por lo que existe `fuenteDelInciso`: «UCP 600 19 a 25a-iii» no
   * se lee, y esa cadena viaja en el aviso de rechazo a otro banco.
   */
  it("sin clase determinada la fuente no finge saber cuál es, y se puede leer", () => {
    const r = buscar(conTipo("TRANSPORT DOCUMENT"), "ucp-20a-iii-puertoDestino");
    expect(r?.fuente).toBe("UCP 600 19 a 25");
  });
});

/**
 * Qué buque nombra la anotación de a bordo, al nivel de la regla.
 *
 * El helper ya está probado contra los textos literales de las dos Opiniones; esto comprueba las
 * tres salidas de la regla, y sobre todo **la tercera**: que la anotación corriente no emita nada.
 * Si emitiera, el motor diría algo en casi todos los conocimientos y nadie lo leería.
 */
describe("el buque de la anotación de a bordo (R 350 contra TA 743rev)", () => {
  const conAnotacion = (onBoard: string, buque: string) =>
    [
      {
        tipo: "BL" as const,
        campos: doc({
          tipoTransporte: campo("BILL OF LADING"),
          puertoEmbarque: campo("MONTEVIDEO, URUGUAY"),
          puertoDestino: campo("COLOMBO, SRI LANKA"),
          onBoard: campo(onBoard),
          buque: campo(buque),
        }),
      },
    ] satisfies DocAnalizado[];

  it("la anotación que nombra al buque oceánico cumple", () => {
    const r = buscar(
      conAnotacion(
        "SHIPPED ON BOARD VESSEL N AT SIBU, MALAYSIA ON 18.11.2010 FOR TRANSHIPMENT VIA BINTULU ON VESSEL L",
        "Vessel L",
      ),
      "ucp-20a-ii-buque",
    );
    expect(r?.estado).toBe("OK");
  });

  it("la que nombra otro buque sale a verificar, con las dos Opiniones a la vista", () => {
    const r = buscar(conAnotacion("JUL.16, 2013 UNI-PROMOTE 198B", "EVER DELUXE 0689-106E"), "ucp-20a-ii-buque");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toContain("UNI-PROMOTE");
    expect(r?.evidencia).toContain("R 350");
    expect(r?.evidencia).toContain("TA 743rev");
  });

  /*
   * Y nunca DISCREPANCIA, por más que la Opinión R 350 diga que el rechazo valía: lo que sobra en la
   * anotación podría ser un puerto de trasbordo o una terminal, y lo que separa a las dos Opiniones
   * es la redacción. Rechazar sobre una palabra que no se entendió es el error que mata la adopción.
   */
  it("y nunca rechaza", () => {
    const r = buscar(conAnotacion("JUL.16, 2013 UNI-PROMOTE 198B", "EVER DELUXE 0689-106E"), "ucp-20a-ii-buque");
    expect(r?.estado).not.toBe("DISCREPANCIA");
  });

  it("la anotación corriente no emite nada", () => {
    expect(buscar(conAnotacion("SHIPPED ON BOARD 20-AUG-2026", "STELLA AUSTRAL"), "ucp-20a-ii-buque")).toBeUndefined();
  });

  it("y con «intended vessel» tampoco: ahí manda la otra rama del inciso", () => {
    expect(
      buscar(conAnotacion("SHIPPED ON BOARD UNI-PROMOTE ON 20-AUG-2026", "INTENDED VESSEL STELLA"), "ucp-20a-ii-buque"),
    ).toBeUndefined();
  });
});

/**
 * Lo que el crédito pidió «on board» y el artículo 19 no exige.
 *
 * El artículo 19 admite que la mercadería conste despachada, tomada a cargo o embarcada, así que a un
 * documento multimodal no se le pide la anotación de a bordo. Pero un crédito puede pedirla, y
 * entonces la pide — y esa exigencia no la miraba nadie: el motor clasificaba el papel por su título,
 * lo examinaba con el artículo 19 y la línea del 46A quedaba sin verificar.
 *
 * El fundamento es el **14 (a)** y no el 19 ni el 20, que es lo que permite afirmarlo sin el texto de
 * la ISBP: los documentos se examinan contra los términos del crédito.
 */
describe("el «on board» que pide el crédito sobre un documento multimodal", () => {
  const PIDE_ON_BOARD = ["1. SIGNED COMMERCIAL INVOICE.", "2. FULL SET CLEAN ON BOARD BILL OF LADING."];
  const NO_LO_PIDE = ["1. SIGNED COMMERCIAL INVOICE.", "2. MULTIMODAL TRANSPORT DOCUMENT IN 3 ORIGINALS."];

  const multimodal = (constancia: string) =>
    [
      {
        tipo: "BL" as const,
        campos: doc({
          tipoTransporte: campo("MULTIMODAL TRANSPORT BILL OF LADING"),
          puertoEmbarque: campo("MONTEVIDEO, URUGUAY"),
          puertoDestino: campo("COLOMBO, SRI LANKA"),
          ...(constancia ? { onBoard: campo(constancia) } : {}),
        }),
      },
    ] satisfies DocAnalizado[];

  const con = (docs: DocAnalizado[], exigidos: string[]) =>
    reglasUCP({ lc: { ...LC, documentosExigidos: exigidos }, credito: CTX, docs, hoy: HOY }).find(
      (r) => r.id === "ucp-14a-on-board",
    );

  it("«Received for Shipment» contra un 46A que pide «on board» es discrepancia", () => {
    const r = con(multimodal("Received for Shipment"), PIDE_ON_BOARD);
    expect(r?.estado).toBe("DISCREPANCIA");
    expect(r?.evidencia).toContain("Received for Shipment");
  });

  it("y con la anotación de a bordo cumple", () => {
    expect(con(multimodal("SHIPPED ON BOARD 20-AUG-2026"), PIDE_ON_BOARD)?.estado).toBe("OK");
  });

  /*
   * La anotación **sin fecha**, que es la Opinión R 641 / TA 650rev.
   *
   * «A dated on board notation is clearly required when the credit so requests»: la palabra sola no
   * alcanza cuando el crédito pidió el documento a bordo. Y sale ATENCION y no DISCREPANCIA porque el
   * párrafo 2 de la misma conclusión dice que con la leyenda **preimpresa** rige la fecha de emisión,
   * y el campo trae un solo texto copiado donde las dos se escriben igual.
   */
  it("la anotación sin fecha no cumple sola: va a verificar nombrando R 641", () => {
    const r = con(multimodal("SHIPPED ON BOARD"), PIDE_ON_BOARD);
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toContain("R 641");
    expect(r?.evidencia).toContain("preimpresa");
  });

  it("y nunca rechaza por la fecha que falta: eso lo decide una persona con el papel", () => {
    expect(con(multimodal("ON BOARD"), PIDE_ON_BOARD)?.estado).not.toBe("DISCREPANCIA");
  });

  /*
   * Y el freno: la fecha se le pide a la anotación, no al documento que no está a bordo. Un
   * «Received for Shipment» sin fecha sigue siendo la discrepancia del 14 (a) y no un aviso.
   */
  it("«Received for Shipment» sin fecha sigue siendo discrepancia, no aviso", () => {
    expect(con(multimodal("Received for Shipment"), PIDE_ON_BOARD)?.estado).toBe("DISCREPANCIA");
  });

  it("sin leer la constancia no se dictamina", () => {
    expect(con(multimodal(""), PIDE_ON_BOARD)?.estado).toBe("ATENCION");
  });

  /*
   * Y los dos frenos, que son la mitad de la decisión.
   *
   * Si el crédito no pidió «on board», el artículo 19 manda y «Received for Shipment» cumple: la
   * regla no se emite. Y sobre un aéreo no corre nunca, aunque el crédito lo escriba — un air waybill
   * no dice «on board» jamás, y rechazarlo por no parecerse a un marítimo es el error que las tres
   * reglas del artículo 23 existen para evitar.
   */
  it("si el crédito no lo pide, la regla no se emite", () => {
    expect(con(multimodal("Received for Shipment"), NO_LO_PIDE)).toBeUndefined();
  });

  it("y sobre un documento aéreo no corre, aunque el crédito escriba «on board»", () => {
    const aereo = [
      {
        tipo: "BL" as const,
        campos: doc({
          tipoTransporte: campo("AIR WAYBILL"),
          puertoEmbarque: campo("MONTEVIDEO, URUGUAY"),
          puertoDestino: campo("COLOMBO, SRI LANKA"),
          onBoard: campo("Received for carriage"),
        }),
      },
    ] satisfies DocAnalizado[];
    expect(con(aereo, ["1. FULL SET CLEAN ON BOARD BILL OF LADING."])).toBeUndefined();
  });
});

/**
 * El crédito que enumera cantidades, y la tolerancia que va por ítem.
 *
 * «No se pudo deducir una cantidad única» es cierto y no alcanza: deja al examinador frente a un 45A
 * con tres ítems sin decirle qué hacer, y lo primero que se le ocurre a cualquiera es **sumarlos y
 * comparar el total**. Ese es el error que la Opinión R 688 / TA 619 corrige — *«the tolerance is to
 * be applied against the individual quantities»*— y es el que cometió el banco negociador del caso.
 *
 * El motor no puede hacer el cotejo por ítem: ni el crédito ni la factura traen sus renglones en
 * campos. Lo que sí puede es enumerar lo que leyó y nombrar la regla.
 */
describe("el 45A que enumera cantidades (R 688 / TA 619)", () => {
  /* Las cifras de la Opinión: 1000 + 500 + 600 contratadas, 1150 + 350 + 580 embarcadas. */
  const T45 = "ITEM 1: 1000MT ITEM 2: 500MT ITEM 3: 600MT QUANTITY: MORE OR LESS 10PCT IS ACCEPTABLE";
  const conItems = (cantidad: string) =>
    reglasUCP({
      lc: LC,
      credito: { ...CTX, mercaderia: T45, mercaderiaCompleta: T45 },
      docs: [{ tipo: "FACTURA", campos: doc({ cantidad: campo(cantidad), unidad: campo("MT") }) }],
      hoy: HOY,
    }).find((r) => r.id === "ucp-30b-cantidad");

  it("enumera los tres ítems en vez de decir solo que no pudo", () => {
    const r = conItems("2080");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toContain("1000MT");
    expect(r?.evidencia).toContain("500MT");
    expect(r?.evidencia).toContain("600MT");
  });

  it("y nombra la regla, que es lo que evita sumar y comparar el total", () => {
    const r = conItems("2080");
    expect(r?.evidencia).toContain("no a la suma");
    expect(r?.evidencia).toContain("R 688 / TA 619");
    expect(r?.fuente).toBe("UCP 600 30a");
  });

  /* Y en inglés, porque esta rama no aparece en ningún escenario de cobertura. */
  it("se traduce entero", () => {
    const en = textoEnIngles(conItems("2080")?.evidencia ?? "");
    expect(en).not.toMatch(/[áéíóúñ¿¡]|\bla tolerancia\b|\bel crédito\b|\bverificar\b/i);
    expect(en).toContain("R 688 / TA 619");
  });
});
