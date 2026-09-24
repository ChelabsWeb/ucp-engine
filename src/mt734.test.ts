import { describe, expect, it } from "vitest";
import { type DatosMT734, mt734 } from "./mt734";

/**
 * El aviso de rechazo como mensaje SWIFT.
 *
 * El artículo 16 (d) pide que el aviso se curse «por telecomunicación». El texto que el motor ya
 * redacta se pega en un correo y cumple, pero entre bancos el canal es SWIFT y el mensaje del
 * rechazo es el MT734, que tiene campos con largos propios: las discrepancias van en el 77J, que
 * admite setenta líneas de cincuenta caracteres, y qué se hace con los documentos en el 77B, que
 * admite tres de treinta y cinco. Un texto pensado para una hoja no entra ahí, y lo que no entra
 * no se transmite.
 */

const BASE: DatosMT734 = {
  referenciaPropia: "CSU2025099",
  referenciaPresentador: "MVD0990117",
  fechaUtilizacion: new Date(2025, 3, 22),
  moneda: "USD",
  monto: 51262,
  discrepancias: ["Bill of lading states CARTONS while packing list states BAGS (UCP 600 art. 14 d)."],
  destino: "RETIENE_ESPERANDO_INSTRUCCIONES",
};

/** Los campos de un mensaje, por etiqueta, tal como salen del bloque 4. */
function campos(texto: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  let actual: string | null = null;
  for (const linea of texto.split("\n")) {
    const e = /^:([0-9]{2}[A-Z]?):(.*)$/.exec(linea);
    if (e) {
      actual = e[1]!;
      m.set(actual, [e[2]!]);
    } else if (actual && linea !== "-}" && !linea.startsWith("{")) {
      m.get(actual)!.push(linea);
    }
  }
  return m;
}

describe("el mensaje que se transmite", () => {
  const { texto } = mt734(BASE);
  const c = campos(texto);

  it("lleva los cinco campos obligatorios del MT734", () => {
    // 20, 21, 32A, 77J y 77B son obligatorios en el estándar; sin uno el mensaje se rechaza.
    for (const tag of ["20", "21", "32A", "77J", "77B"]) {
      expect(c.has(tag), `falta el campo ${tag}`).toBe(true);
    }
  });

  it("el 32A junta fecha, moneda e importe como los escribe SWIFT", () => {
    // 6!n3!a15d: aammdd, la moneda en tres letras y el importe con coma decimal.
    expect(c.get("32A")![0]).toBe("250422USD51262,");
  });

  it("las discrepancias van en el 77J", () => {
    expect(c.get("77J")!.join(" ")).toContain("CARTONS");
  });

  it("y qué se hace con los documentos, en el 77B", () => {
    expect(c.get("77B")!.join(" ").toLowerCase()).toContain("holding");
  });

  it("sin discrepancias no hay mensaje: un rechazo sin motivo no existe", () => {
    expect(mt734({ ...BASE, discrepancias: [] }).texto).toBe("");
  });
});

describe("los largos, que es donde un mensaje se cae", () => {
  it("ninguna línea del 77J pasa de 50 caracteres", () => {
    const larga =
      "The commercial invoice describes the goods in terms that differ from those of the credit in several respects and the description cannot be reconciled.";
    const c = campos(mt734({ ...BASE, discrepancias: [larga] }).texto);
    for (const l of c.get("77J")!) expect(l.length, `«${l}»`).toBeLessThanOrEqual(50);
  });

  it("ninguna línea del 77B pasa de 35, y no son más de tres", () => {
    // El texto del 16(c)(iii)(b) es el más largo de los cuatro: si alguno no entra, es ese.
    const c = campos(mt734({ ...BASE, destino: "RETIENE_ESPERANDO_DISPENSA" }).texto);
    const l77b = c.get("77B")!;
    expect(l77b.length).toBeLessThanOrEqual(3);
    for (const l of l77b) expect(l.length, `«${l}»`).toBeLessThanOrEqual(35);
  });

  it("las referencias se recortan a 16 caracteres, que es lo que el campo admite", () => {
    const c = campos(mt734({ ...BASE, referenciaPropia: "REFERENCIA-LARGUISIMA-2025" }).texto);
    expect(c.get("20")![0]!.length).toBeLessThanOrEqual(16);
  });

  it("sin referencia del presentador va NONREF y no un campo vacío", () => {
    const c = campos(mt734({ ...BASE, referenciaPresentador: "" }).texto);
    expect(c.get("21")![0]).toBe("NONREF");
  });

  it("si las discrepancias no entran en el 77J, se avisa en vez de cortarlas", () => {
    // Setenta líneas es el tope. Se avisa porque una discrepancia que no se transmite es una
    // discrepancia que el banco no invocó, y el 16 (f) le hace perder el derecho a alegarla.
    const muchas = Array.from({ length: 80 }, (_, i) => `Discrepancy number ${i + 1} on the presentation.`);
    const r = mt734({ ...BASE, discrepancias: muchas });
    expect(r.avisos.join(" ")).toMatch(/77J|no entran/i);
    expect(campos(r.texto).get("77J")!.length).toBeLessThanOrEqual(70);
  });
});

describe("el juego de caracteres de la red", () => {
  it("lo que SWIFT no admite se reemplaza en vez de viajar y hacer rebotar el mensaje", () => {
    const r = mt734({ ...BASE, discrepancias: ["La descripción difiere: «cartones» vs bolsas — art. 14 d"] });
    const cuerpo = campos(r.texto).get("77J")!.join("\n");
    expect(cuerpo).not.toMatch(/[«»—áéíóúñ]/);
    expect(cuerpo).toContain("descripcion");
  });

  it("y se avisa que hubo que reemplazar algo", () => {
    const r = mt734({ ...BASE, discrepancias: ["Descripción con acentos"] });
    expect(r.avisos.join(" ")).toMatch(/characters/i);
  });
});

describe("el importe, que SWIFT escribe a su manera", () => {
  const con = (monto: number) => /:32A:(.*)/.exec(mt734({ ...BASE, monto }).texto)![1]!;

  it.each([
    [51262, "250422USD51262,"],
    [51262.5, "250422USD51262,5"],
    [51262.75, "250422USD51262,75"],
    [0.05, "250422USD0,05"],
    [1000000, "250422USD1000000,"],
  ])("%s se escribe %s", (monto, esperado) => {
    expect(con(monto)).toBe(esperado);
  });

  it("la coma va aunque no haya decimales, y no hay separador de miles", () => {
    // Las dos cosas hacen rebotar el mensaje si se escriben como se escriben en una factura.
    expect(con(54150)).toContain("54150,");
    expect(con(54150)).not.toContain(".");
  });
});
