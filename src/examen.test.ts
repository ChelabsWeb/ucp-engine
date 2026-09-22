import { describe, expect, it } from "vitest";
import type { CamposDoc } from "./consistencia";
import { contextoDesdeSwift, examinarPresentacion } from "./examen";
import { DOCUMENTOS_CSU2025099, SWIFT_CSU2025099 } from "./fixtures";
import type { DocAnalizado } from "./presentacion";
import { parseMT700 } from "./swift-lc";
import type { OperationDetail } from "./types";

/** El examen completo, sobre el expediente real. */

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
});

describe("el expediente real, examinado entero", () => {
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
