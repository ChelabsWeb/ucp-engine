import { describe, expect, it } from "vitest";
import {
  contenedoresEn,
  desambiguarCantidad,
  esAmbiguo,
  lecturasPosibles,
  mismaMoneda,
  mismoContenedor,
} from "./numeros";

/**
 * Los casos salen del expediente real CSU2025099: la factura A 4401 y el packing list de
 * Molsur escriben los mismos números de formas distintas.
 */

describe("cantidades ambiguas", () => {
  it("«53,960» de la factura real se puede leer de dos formas", () => {
    expect(esAmbiguo("53,960")).toBe(true);
    expect(lecturasPosibles("53,960")).toEqual([53960, 53.96]);
  });

  it("«53.960,00» del packing no es ambiguo: tiene los dos separadores", () => {
    expect(esAmbiguo("53.960,00 Kgs")).toBe(false);
  });

  it("«53,96» tampoco: dos decimales no son un grupo de miles", () => {
    expect(esAmbiguo("53,96 MT")).toBe(false);
  });

  it("la aritmética de la factura real resuelve la ambigüedad", () => {
    // 53,960 × USD 800,00 = USD 43.168,00 — sale del renglón FOB de la factura A 4401
    const r = desambiguarCantidad({ cantidad: "53,960", precioUnitario: "800,00", montoTotal: "43.168,00" });
    expect(r?.valor).toBe(53.96);
    expect(r?.como).toBe("POR_ARITMETICA");
    expect(r?.nota).toContain("43.168");
  });

  it("si la cuenta da la otra lectura, elige esa", () => {
    const r = desambiguarCantidad({ cantidad: "1,360", precioUnitario: "2,00", montoTotal: "2.720,00" });
    expect(r?.valor).toBe(1360);
    expect(r?.como).toBe("POR_ARITMETICA");
  });

  it("sin precio ni total, avisa que es ambiguo en vez de elegir en silencio", () => {
    const r = desambiguarCantidad({ cantidad: "53,960" });
    expect(r?.como).toBe("AMBIGUA");
    expect(r?.nota).toContain("verificar");
  });

  it("un número que se lee de una sola forma se resuelve directo", () => {
    const r = desambiguarCantidad({ cantidad: "53,96 MT" });
    expect(r?.valor).toBe(53.96);
    expect(r?.como).toBe("DIRECTA");
  });

  it("sin número no inventa uno", () => {
    expect(desambiguarCantidad({ cantidad: "sin datos" })).toBeNull();
  });

  it("el error que esto evita es de mil veces", () => {
    // leer mal «53,960 MTS» daba 53.960 toneladas contra las 53,96 reales
    const mal = lecturasPosibles("53,960")[0]!;
    const bien = desambiguarCantidad({ cantidad: "53,960", precioUnitario: "800,00", montoTotal: "43.168,00" })!.valor;
    expect(mal / bien).toBeCloseTo(1000, 0);
  });
});

describe("números de contenedor", () => {
  it("el packing y el conocimiento escriben el mismo contenedor distinto", () => {
    expect(mismoContenedor("DEMU 410037-1", "DEMU4100371")).toBe(true);
    expect(mismoContenedor("DEMU 410037-2", "DEMU4100372")).toBe(true);
  });

  it("dos contenedores distintos no se confunden", () => {
    expect(mismoContenedor("DEMU4100371", "DEMU4100372")).toBe(false);
  });

  it("los encuentra dentro de un texto, en cualquiera de las dos formas", () => {
    const delPacking = contenedoresEn("1. DEMU 410037-1 – P1180119 – 680 Bags 2. DEMU 410037-2 – P1180118");
    const delBL = contenedoresEn("DEMU4100371 SEAL P1180119 ... DEMU4100372 SEAL P1180118");
    expect(delPacking).toEqual(["DEMU4100371", "DEMU4100372"]);
    expect(delPacking).toEqual(delBL);
  });

  it("no toma cualquier código: la cuarta letra tiene que ser U, J o Z", () => {
    expect(contenedoresEn("ABCD1234567")).toEqual([]);
  });
});

describe("la misma moneda escrita de distintas maneras", () => {
  /*
   * Comparar con `includes` sobre el código del crédito daba DISCREPANCIA sobre «US$», «U$S» y
   * «US DOLLARS». Mientras los campos se carguen a mano —hoy es el único camino, sin crédito de
   * API— eso es exactamente lo que una persona tipea, y ninguna de esas formas hace discrepante
   * una factura.
   */
  it.each([
    ["US$"],
    ["U$S"],
    ["$US"],
    ["US DOLLARS"],
    ["US DOLLAR"],
    ["usd"],
    ["USD."],
    ["USD (US DOLLAR)"],
    ["dólares"],
  ])("«%s» es USD", (escrito) => {
    expect(mismaMoneda(escrito, "USD")).toBe(true);
  });

  it.each([["€"], ["EUR"], ["euros"]])("«%s» es EUR", (escrito) => {
    expect(mismaMoneda(escrito, "EUR")).toBe(true);
  });

  it("«dólares» a secas no dice cuál, pero contra un crédito en dólares coincide", () => {
    expect(mismaMoneda("dólares", "USD")).toBe(true);
    expect(mismaMoneda("$", "USD")).toBe(true);
    // y contra un crédito en otra moneda sigue siendo distinta
    expect(mismaMoneda("dólares", "EUR")).toBe(false);
  });

  it("y dos monedas distintas siguen siendo distintas, que es lo que importa no perder", () => {
    expect(mismaMoneda("EUR", "USD")).toBe(false);
    expect(mismaMoneda("€", "USD")).toBe(false);
    expect(mismaMoneda("BRL", "USD")).toBe(false);
    expect(mismaMoneda("UYU", "USD")).toBe(false);
  });

  it("sin dato no se afirma nada", () => {
    expect(mismaMoneda("", "USD")).toBe(false);
    expect(mismaMoneda("USD", null)).toBe(false);
  });
});
