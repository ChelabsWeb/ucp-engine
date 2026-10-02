import { describe, expect, it } from "vitest";
import { SWIFT_CSU2025099 } from "./fixtures";
import { type DatosMT750, type DatosMT752, modoDeHonrar, mt750, mt752 } from "./mt750";
import { parseMT700 } from "./swift-lc";

/**
 * Lo que pasa cuando el examen da rojo y el banco no quiere rechazar.
 *
 * Hasta acá el motor terminaba en el aviso de rechazo. Pero rechazar es una de las dos salidas: la
 * otra es avisarle las discrepancias al emisor y pedirle que autorice pagar igual, que es lo que el
 * artículo 16 (b) contempla cuando el emisor consulta al ordenante por una dispensa. Ese pedido es
 * el MT750 y la respuesta afirmativa, el MT752.
 *
 * Elegir entre los dos caminos es la decisión del examinador, y las dos tienen plazo: el 16 (b)
 * dice expresamente que consultar por una dispensa **no** extiende los cinco días del 14 (b).
 */

const BASE: DatosMT750 = {
  referenciaPropia: "CSU2025099",
  referenciaCredito: "LCMRDN25000471",
  moneda: "USD",
  monto: 51262,
  discrepancias: ["Bill of lading states CARTONS while packing list states BAGS (UCP 600 art. 14 d)."],
};

function campos(texto: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  let actual: string | null = null;
  for (const linea of texto.split("\n")) {
    const e = /^:([0-9]{2}[A-Z]?):(.*)$/.exec(linea);
    if (e) {
      actual = e[1]!;
      m.set(actual, [e[2]!]);
    } else if (actual) {
      m.get(actual)!.push(linea);
    }
  }
  return m;
}

describe("el aviso de discrepancias (MT750)", () => {
  const c = campos(mt750(BASE).texto);

  it("lleva los cuatro campos obligatorios", () => {
    for (const tag of ["20", "21", "32B", "77J"]) {
      expect(c.has(tag), `falta el campo ${tag}`).toBe(true);
    }
  });

  it("el 21 es el número del crédito, que es lo que el emisor busca para ubicarlo", () => {
    expect(c.get("21")![0]).toBe("LCMRDN25000471");
  });

  it("el 32B lleva moneda e importe, sin fecha: no es una utilización todavía", () => {
    // El 734 usa 32A —con fecha— porque el giro ya ocurrió. Acá se está pidiendo permiso.
    expect(c.get("32B")![0]).toBe("USD51262,");
    expect(c.has("32A")).toBe(false);
  });

  it("las discrepancias van en el 77J, con los mismos cincuenta caracteres por línea", () => {
    const largo = mt750({
      ...BASE,
      discrepancias: ["The commercial invoice describes the goods in terms that differ from those of the credit."],
    });
    for (const l of campos(largo.texto).get("77J")!) expect(l.length).toBeLessThanOrEqual(50);
  });

  it("sin discrepancias no hay mensaje: no habría nada que consultar", () => {
    expect(mt750({ ...BASE, discrepancias: [] }).texto).toBe("");
  });

  it("los gastos deducidos y el total a pagar van si se informan", () => {
    const con = campos(mt750({ ...BASE, gastosDeducidos: ["DISCREPANCY FEE USD 80,00"], totalAPagar: 51182 }).texto);
    expect(con.get("71D")!.join(" ")).toContain("80");
    expect(con.get("34B")![0]).toBe("USD51182,");
  });

  it("avisa que pedir la dispensa no estira el plazo del examen", () => {
    // El 16 (b) es explícito y es el error caro: creer que consultar congela los cinco días.
    expect(mt750(BASE).avisos.join(" ")).toMatch(/16 \(b\)|does not extend|five banking days/i);
  });
});

describe("la autorización (MT752)", () => {
  const BASE752: DatosMT752 = {
    referenciaPropia: "SEY-2025-0417",
    referenciaCredito: "LCMRDN25000471",
    modo: "NEGOCIACION",
    fecha: new Date(2025, 3, 24),
    moneda: "USD",
    monto: 51262,
  };
  const c = campos(mt752(BASE752).texto);

  it("lleva los cuatro campos obligatorios", () => {
    for (const tag of ["20", "21", "23", "30"]) {
      expect(c.has(tag), `falta el campo ${tag}`).toBe(true);
    }
  });

  it("el 23 dice de qué manera se autoriza a honrar", () => {
    // Los cuatro modos son los del artículo 6 (b): pago a la vista, pago diferido, aceptación y
    // negociación. Un crédito es disponible por uno de ellos y la autorización nombra cuál.
    expect(c.get("23")![0]).toMatch(/NEGOTIATION/);
  });

  it.each([
    ["PAGO_A_LA_VISTA", "SIGHT PAYMENT"],
    ["PAGO_DIFERIDO", "DEF PAYMENT"],
    ["ACEPTACION", "ACCEPTANCE"],
    ["NEGOCIACION", "NEGOTIATION"],
  ] as const)("%s se transmite como %s", (modo, esperado) => {
    expect(campos(mt752({ ...BASE752, modo }).texto).get("23")![0]).toBe(esperado);
  });

  it("el 30 es la fecha, en el formato de seis dígitos de la red", () => {
    expect(c.get("30")![0]).toBe("250424");
  });

  it("una autorización con condiciones las lleva en el 79Z", () => {
    const con = campos(mt752({ ...BASE752, condiciones: ["PROVIDED DOCUMENTS REACH US BY 30 APR 2025"] }).texto);
    expect(con.get("79Z")!.join(" ")).toContain("30 APR 2025");
    for (const l of con.get("79Z")!) expect(l.length).toBeLessThanOrEqual(50);
  });

  it("y lo que la red no admite se reemplaza, como en los demás mensajes", () => {
    const r = mt752({ ...BASE752, condiciones: ["Sujeto a confirmación del ordenante — sin excepción"] });
    expect(campos(r.texto).get("79Z")!.join(" ")).not.toMatch(/[—óñ]/);
    expect(r.avisos.join(" ")).toMatch(/characters/i);
  });
});

describe("con qué modo se honra el crédito (campo 23 del 752)", () => {
  /*
   * El 752 lo emite el banco **emisor** autorizando honrar a pesar de las discrepancias, y su campo
   * 23 dice con qué modo. El crédito ya lo dice en el 41D y el 42C, así que no hace falta
   * preguntárselo a nadie — y cuando no se puede decidir, devuelve `null` en vez de suponer: el
   * campo 23 de un mensaje que se cursa a otro banco no es lugar para adivinar.
   */
  it("el crédito real: disponible en cualquier banco de Uruguay por negociación", () => {
    const p = parseMT700(SWIFT_CSU2025099)!;
    expect(modoDeHonrar(p.extra.disponibleCon, p.extra.giros)).toBe("NEGOCIACION");
  });

  it.each([
    ["MERIDIAN BANK PLC BY ACCEPTANCE", "90 DAYS", "ACEPTACION"],
    ["ISSUING BANK BY DEF PAYMENT", "", "PAGO_DIFERIDO"],
    ["ISSUING BANK BY PAYMENT", "SIGHT", "PAGO_A_LA_VISTA"],
    ["ANY BANK", "90 DAYS AFTER B/L DATE", "PAGO_DIFERIDO"],
  ])("«%s» + «%s» → %s", (disponible, giros, esperado) => {
    expect(modoDeHonrar(disponible, giros)).toBe(esperado);
  });

  it("sin los campos no se supone ninguno", () => {
    expect(modoDeHonrar(null, null)).toBeNull();
    expect(modoDeHonrar("ANY BANK IN URUGUAY", "")).toBeNull();
  });
});
