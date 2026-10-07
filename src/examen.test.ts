import { describe, expect, it } from "vitest";
import type { CamposDoc } from "./consistencia";
import { contextoDesdeSwift, examinarPresentacion } from "./examen";
import { DOCUMENTOS_CSU2025099, SWIFT_CSU2025099 } from "./fixtures";
import type { DocAnalizado } from "./presentacion";
import { parseMT700 } from "./swift-lc";
import type { OperationDetail } from "./types";

/** El examen completo, sobre el expediente de referencia. */

const swift = parseMT700(SWIFT_CSU2025099)!;
const CTX = contextoDesdeSwift(swift);
const campo = (valor: string, confianza = 0.95) => ({ valor, confianza });

const OP = {
  codigo: swift.lc.numero,
  incoterm: "CFR",
  estado: "DOCS_EN_PREPARACION",
  fechaEmbarque: swift.lc.limiteEmbarque,
  montoVenta: swift.lc.monto ?? 0,
  moneda: swift.lc.moneda ?? "USD",
  medioPago: "LC",
  blReal: "08-abr-25",
  legs: [{ tipo: "VENTA", contraparte: CTX.aplicante ?? "", incoterm: "CFR", montoTotal: swift.lc.monto ?? 0 }],
  items: [],
  lc: swift.lc,
  contenedores: [],
  documentos: [],
  checklist: [],
  hitos: [],
  matriz: [],
  discrepancias: [],
} as unknown as OperationDetail;

const correr = (docs: DocAnalizado[]) =>
  examinarPresentacion({
    lc: swift.lc,
    credito: CTX,
    docs,
    op: OP,
    empresaRazonSocial: swift.extra.beneficiario[0] ?? "",
    empresaDireccion: swift.lc.beneficiarioDireccion,
    hoy: new Date(2025, 3, 22),
  });

describe("la cantidad ambigua de la factura real", () => {
  /* La factura A 4401 escribe la cantidad «53,960» y el packing «53.960,00 Kgs». Leer mal
     ese número, con la unidad en toneladas, inventa una diferencia de mil veces. */
  const facturaComoEstaEnElPapel: CamposDoc = {
    ...DOCUMENTOS_CSU2025099.FACTURA!,
    cantidad: campo("53,960"),
    unidad: campo("MTS"),
    precioUnitario: campo("800,00"),
    montoTotal: campo("43.168,00"),
  };

  it("se resuelve con la aritmética del propio documento y queda dicho", () => {
    const r = correr([{ tipo: "FACTURA", campos: facturaComoEstaEnElPapel, nombreArchivo: "Invoice A 4401" }]);
    expect(r.avisosDeLectura.join(" ")).toContain("53,960");
    expect(r.avisosDeLectura.join(" ")).toContain("43.168");
  });

  it("sin precio ni total, avisa que es ambigua en vez de elegir en silencio", () => {
    const sinCuenta: CamposDoc = {
      ...facturaComoEstaEnElPapel,
      precioUnitario: campo("", 0),
      montoTotal: campo("", 0),
    };
    const r = correr([{ tipo: "FACTURA", campos: sinCuenta, nombreArchivo: "Invoice A 4401" }]);
    expect(r.avisosDeLectura.join(" ")).toContain("verificar");
  });

  it("una cantidad que se lee de una sola forma no genera aviso", () => {
    const clara: CamposDoc = { ...facturaComoEstaEnElPapel, cantidad: campo("53,96") };
    expect(correr([{ tipo: "FACTURA", campos: clara }]).avisosDeLectura).toEqual([]);
  });

  it("con el precio de una línea y el total de otra, la cuenta no cierra y se dice", () => {
    /*
     * La factura A 4401 imprime tres precios unitarios —FOB 800, flete 150, CFR 950— y un solo
     * total, el CFR. Leer el primero y compararlo contra ese total es mezclar dos líneas: 53,96 ×
     * 800 da 43.168, no 51.262. Pasó de verdad: el modelo devolvía el FOB. La cuenta entonces no
     * resuelve nada y lo que corresponde es decir que hay que mirar el papel, no elegir una
     * lectura porque sí.
     */
    const mezclado: CamposDoc = {
      ...facturaComoEstaEnElPapel,
      precioUnitario: campo("800,00"),
      montoTotal: campo("51.262,00"),
    };
    const r = correr([{ tipo: "FACTURA", campos: mezclado, nombreArchivo: "Invoice A 4401" }]);
    expect(r.avisosDeLectura.join(" ")).toContain("verificar");
  });

  it("con el precio que va con el total, resuelve", () => {
    const coherente: CamposDoc = {
      ...facturaComoEstaEnElPapel,
      precioUnitario: campo("950,00"),
      montoTotal: campo("51.262,00"),
    };
    const r = correr([{ tipo: "FACTURA", campos: coherente, nombreArchivo: "Invoice A 4401" }]);
    expect(r.avisosDeLectura.join(" ")).toContain("51.262");
    expect(r.avisosDeLectura.join(" ")).not.toContain("verificar");
  });
});

describe("el expediente de referencia, examinado entero", () => {
  const docs: DocAnalizado[] = [
    { tipo: "FACTURA", campos: DOCUMENTOS_CSU2025099.FACTURA!, nombreArchivo: "Invoice A 4401" },
    { tipo: "PACKING", campos: DOCUMENTOS_CSU2025099.PACKING!, nombreArchivo: "Packing list Molsur" },
    { tipo: "BL", campos: DOCUMENTOS_CSU2025099.BL!, nombreArchivo: "BL MVD0990117" },
  ];

  it("la única discrepancia sigue siendo la de los bultos", () => {
    const r = correr(docs);
    const disc = r.reglas.filter((x) => x.estado === "DISCREPANCIA");
    expect(disc).toHaveLength(1);
    expect(disc[0]!.regla).toContain("Tipo de bulto");
  });

  it("el número del crédito ya no se cuenta como discrepancia", () => {
    const r = correr(docs);
    const numeroLC = r.reglas.filter((x) => x.id.startsWith("lc-num-"));
    expect(numeroLC.every((x) => x.estado !== "DISCREPANCIA")).toBe(true);
  });

  it("corren tanto las reglas del crédito como las de las UCP", () => {
    const r = correr(docs);
    expect(r.reglasUCP).toBeGreaterThan(5);
    expect(r.reglas.length).toBeGreaterThan(r.reglasUCP);
  });

  it("dice qué no revisó", () => {
    expect(correr(docs).manuales.length).toBeGreaterThan(3);
  });
});

describe("el contexto que sale del crédito", () => {
  it("lleva el beneficiario del campo 59: sin él no se puede examinar quién emitió la factura", () => {
    // Estuvo faltando y la regla del 18 (a) (i) quedaba en «verificar a mano» sobre un crédito que
    // nombra al beneficiario en su propio texto.
    expect(contextoDesdeSwift(swift).beneficiario).toContain("CEREALSUR");
  });
});

describe("un documento que el crédito no exige se desestima (UCP 600 art. 14 g)", () => {
  /*
   * El artículo es terminante: «un documento presentado pero no exigido por el crédito será
   * desestimado y puede devolverse al presentador». El motor lo examinaba igual, y con eso un papel
   * de más podía inventar una discrepancia.
   *
   * El caso que lo muestra: un crédito que no pide packing list, y un packing que contradice al
   * conocimiento en el tipo de bulto. La contradicción existe, pero es entre un documento del
   * crédito y otro que el banco no tiene que mirar.
   */
  const sinPacking = {
    ...swift.lc,
    documentosExigidos: (swift.lc.documentosExigidos ?? []).filter((d) => !/PACKING/i.test(d)),
  };
  const conPacking = [
    { tipo: "BL" as const, campos: DOCUMENTOS_CSU2025099.BL! },
    { tipo: "PACKING" as const, campos: DOCUMENTOS_CSU2025099.PACKING! },
  ];
  const correr = (lc: typeof swift.lc) =>
    examinarPresentacion({
      lc,
      credito: contextoDesdeSwift(swift),
      docs: conPacking,
      empresaRazonSocial: "CEREALSUR S.A",
      hoy: new Date(2025, 3, 22),
    });

  it("no se compara contra los demás: la contradicción de bultos no sale como discrepancia", () => {
    const r = correr(sinPacking);
    expect(r.reglas.filter((x) => x.estado === "DISCREPANCIA" && /bulto/i.test(x.regla))).toHaveLength(0);
  });

  it("pero se dice que está y que se desestima, con el artículo", () => {
    const x = correr(sinPacking).reglas.find((y) => y.id.startsWith("ucp-14g"));
    expect(x?.fuente).toContain("14g");
    expect(x?.regla).toMatch(/desestim/i);
    expect(x?.estado).toBe("ATENCION");
  });

  it("y si el crédito SÍ lo exige, se compara como siempre", () => {
    // El crédito del caso pide packing list: ahí la contradicción de bultos es una discrepancia real.
    const r = correr(swift.lc);
    expect(r.reglas.filter((x) => x.estado === "DISCREPANCIA" && /bulto/i.test(x.regla))).toHaveLength(1);
  });

  it("el crédito cargado como documento no se desestima: no es un papel presentado", () => {
    const r = examinarPresentacion({
      lc: sinPacking,
      credito: contextoDesdeSwift(swift),
      docs: [{ tipo: "LC" as const, campos: DOCUMENTOS_CSU2025099.FACTURA! }],
      empresaRazonSocial: "CEREALSUR S.A",
      hoy: new Date(2025, 3, 22),
    });
    expect(r.reglas.find((x) => x.id.startsWith("ucp-14g"))).toBeUndefined();
  });
});
