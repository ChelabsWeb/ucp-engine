import { describe, expect, it } from "vitest";
import { parseMT700, tokenizarSwift } from "./swift-lc";

/**
 * Un campo que el parser no conoce no puede terminar adentro del campo anterior.
 *
 * `CONOCIDOS` es una lista escrita a mano —cincuenta y cuatro etiquetas— y el formato de los
 * mensajes crece: SR2026 agrega el 45H (posición arancelaria) y el 44I (incoterm), y el 49G/49H de
 * condiciones especiales de pago ya existe. Hasta este arreglo, la línea de un campo desconocido
 * caía en el `if (actual)` del final del bucle y se agregaba —con su etiqueta adentro— al campo que
 * estuviera abierto.
 *
 * Por el orden de un MT700, el campo que estaba abierto suele ser el 45A, que es de donde sale la
 * cantidad del embarque y la descripción de la mercadería de los artículos 18 (c) y 14 (e). Es
 * decir: el defecto le mete texto ajeno justo al campo que menos lo tolera.
 *
 * El corte es **los dos puntos del principio**. En la forma raw —`:49G:…`— una etiqueta es
 * inequívoca y abre campo aunque no la conozcamos. En la forma impresa no se puede: una línea de
 * texto libre como «12:00 NOON» calza con el mismo patrón, y ahí `CONOCIDOS` sigue mandando.
 */
describe("un campo que el parser no conoce", () => {
  it("no se mete adentro del campo anterior", () => {
    const msg = ":45A:57 MTS OF FISH MEAL 54PCT MIN\n:49G:PAYMENT UNDER RESERVE\n:46A:SIGNED INVOICE";
    const campos = tokenizarSwift(msg);

    const cuarenta5A = campos.find((c) => c.tag === "45A");
    expect(cuarenta5A?.lineas).toEqual(["57 MTS OF FISH MEAL 54PCT MIN"]);
    expect(campos.map((c) => c.tag)).toEqual(["45A", "49G", "46A"]);
  });

  it("vale para los campos que SR2026 agrega", () => {
    const msg = ":45A:FISH MEAL\n:45H:2301.20.00\n:44I:CFR COLOMBO\n:46A:INVOICE";
    const campos = tokenizarSwift(msg);

    expect(campos.find((c) => c.tag === "45A")?.lineas).toEqual(["FISH MEAL"]);
    expect(campos.map((c) => c.tag)).toEqual(["45A", "45H", "44I", "46A"]);
  });

  it("no parte un campo por una hora escrita en texto libre", () => {
    /* La forma impresa es ambigua y ahí no se arriesga: «12:00 NOON» calza con el patrón de
       etiqueta, así que una condición del 47A que mencione una hora tiene que seguir entera. */
    const msg = "47A: Additional Conditions\n  DOCUMENTS TO BE PRESENTED BEFORE\n  12:00 NOON";
    const campos = tokenizarSwift(msg);

    expect(campos.map((c) => c.tag)).toEqual(["47A"]);
    expect(campos[0]?.lineas.join(" ")).toContain("12:00 NOON");
  });

  it("deja la descripción de la mercadería limpia en un crédito entero", () => {
    const msg = [
      ":20:LCMRDN25000471",
      ":31D:261230URUGUAY",
      ":32B:USD54150,00",
      ":45A:57 MTS OF FISH MEAL 54PCT MIN",
      ":45H:2301.20.00",
      ":46A:1. SIGNED COMMERCIAL INVOICE IN 3 ORIGINALS",
    ].join("\n");

    const lc = parseMT700(msg);
    expect(lc?.extra.bienes).toBe("57 MTS OF FISH MEAL 54PCT MIN");
  });
});
