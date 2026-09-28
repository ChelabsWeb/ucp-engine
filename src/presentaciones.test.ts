import { describe, expect, it } from "vitest";
import { SWIFT_CSU2025099 } from "./fixtures";
import {
  operacionDesdeCredito,
  type Presentacion,
  reglasDeGiro,
  saldoDelCredito,
  vencimientoEfectivo,
} from "./presentaciones";
import { parseMT700 } from "./swift-lc";
import type { LcInfo } from "./types";

const LC = parseMT700(SWIFT_CSU2025099)!.lc;
const pres = (over: Partial<Presentacion> = {}): Presentacion => ({
  referencia: "P1",
  fecha: new Date(2025, 3, 22),
  importe: 51262,
  ...over,
});
const buscar = (rs: ReturnType<typeof reglasDeGiro>, id: string) => rs.find((r) => r.id === id);

describe("el saldo del crédito", () => {
  it("con la tolerancia que el propio crédito fija", () => {
    const s = saldoDelCredito(LC, []);
    expect(s.importe).toBe(54150);
    expect(s.tolerancia).toBe(0.1);
    expect(s.tope).toBeCloseTo(59565, 0); // 54.150 más el 10 %
    expect(s.disponible).toBeCloseTo(59565, 0);
  });

  it("descuenta lo ya girado", () => {
    const s = saldoDelCredito(LC, [pres({ importe: 30000 })]);
    expect(s.girado).toBe(30000);
    expect(s.disponible).toBeCloseTo(29565, 0);
  });

  it("nunca devuelve un disponible negativo", () => {
    expect(saldoDelCredito(LC, [pres({ importe: 99999 })]).disponible).toBe(0);
  });

  it("un crédito sin importe no tiene tope que calcular", () => {
    const sinMonto: LcInfo = { ...LC, monto: null };
    expect(saldoDelCredito(sinMonto, []).tope).toBeNull();
  });
});

describe("giros parciales — artículo 31", () => {
  it("la primera presentación no dispara la regla", () => {
    expect(buscar(reglasDeGiro({ lc: LC, actual: pres() }), "giro-parciales")).toBeUndefined();
  });

  it("un segundo giro está permitido salvo que el crédito lo prohíba", () => {
    const r = buscar(
      reglasDeGiro({ lc: LC, actual: pres(), anteriores: [pres({ importe: 20000 })], parciales: "ALLOWED" }),
      "giro-parciales",
    );
    expect(r?.estado).toBe("OK");
  });

  it("si el crédito los prohíbe, el segundo giro es discrepancia", () => {
    const r = buscar(
      reglasDeGiro({ lc: LC, actual: pres(), anteriores: [pres({ importe: 20000 })], parciales: "NOT ALLOWED" }),
      "giro-parciales",
    );
    expect(r?.estado).toBe("DISCREPANCIA");
    expect(r?.evidencia).toContain("20.000");
  });
});

describe("el tope del crédito — artículos 30 y 32B", () => {
  it("dos giros que juntos entran en el tope, pasan", () => {
    const r = buscar(
      reglasDeGiro({ lc: LC, actual: pres({ importe: 29000 }), anteriores: [pres({ importe: 30000 })] }),
      "giro-saldo",
    );
    expect(r?.estado).toBe("OK");
  });

  it("dos giros que se pasan del tope, no", () => {
    const r = buscar(
      reglasDeGiro({ lc: LC, actual: pres({ importe: 31000 }), anteriores: [pres({ importe: 30000 })] }),
      "giro-saldo",
    );
    expect(r?.estado).toBe("DISCREPANCIA");
    expect(r?.evidencia).toContain("tope");
  });

  it("la tolerancia del crédito cuenta: 54.150 admite hasta 59.565", () => {
    const justo = buscar(reglasDeGiro({ lc: LC, actual: pres({ importe: 59565 }) }), "giro-saldo");
    expect(justo?.estado).toBe("OK");
    const pasado = buscar(reglasDeGiro({ lc: LC, actual: pres({ importe: 59566 }) }), "giro-saldo");
    expect(pasado?.estado).toBe("DISCREPANCIA");
  });
});

describe("el vencimiento en día no hábil — artículo 29", () => {
  it("el del crédito real cae lunes y no se mueve", () => {
    const v = vencimientoEfectivo(LC)!;
    expect(v.segunElCredito.getDay()).toBe(1);
    expect(v.corrido).toBe(false);
  });

  it("uno que cae sábado se corre al lunes", () => {
    const enSabado: LcInfo = { ...LC, vencimiento: "28-jun-25" }; // sábado
    const v = vencimientoEfectivo(enSabado)!;
    expect(v.corrido).toBe(true);
    expect(v.efectivo.getDay()).toBe(1);
    expect(v.efectivo.getDate()).toBe(30);
  });

  it("presentar el lunes siguiente a un vencimiento del sábado está en plazo", () => {
    const enSabado: LcInfo = { ...LC, vencimiento: "28-jun-25" };
    const r = buscar(
      reglasDeGiro({ lc: enSabado, actual: pres({ fecha: new Date(2025, 5, 30) }) }),
      "giro-vencimiento",
    );
    expect(r?.estado).toBe("OK");
  });

  it("presentar después del vencimiento es discrepancia", () => {
    const r = buscar(reglasDeGiro({ lc: LC, actual: pres({ fecha: new Date(2025, 6, 5) }) }), "giro-vencimiento");
    expect(r?.estado).toBe("DISCREPANCIA");
    expect(r?.evidencia).toContain("después del vencimiento");
  });

  it("cuando el vencimiento se corre, deja dicho que el último embarque NO se corre", () => {
    const enSabado: LcInfo = { ...LC, vencimiento: "28-jun-25" };
    const r = buscar(reglasDeGiro({ lc: enSabado, actual: pres() }), "giro-embarque-no-corre");
    expect(r?.fuente).toContain("29c");
    expect(r?.evidencia).toContain(LC.limiteEmbarque);
  });
});

describe("el adaptador con el examen heredado", () => {
  it("arma la estructura que el examen base pide, sin inventar una compraventa", () => {
    const op = operacionDesdeCredito({
      lc: LC,
      presentacion: pres({ fechaEmbarque: "08-abr-25" }),
      ordenante: "ORIENT FEED (PVT) LTD",
      incoterm: "CFR",
    });
    expect(op.codigo).toBe("LCMRDN25000471");
    expect(op.blReal).toBe("08-abr-25");
    expect(op.legs).toHaveLength(1);
    expect(op.items).toEqual([]);
    expect(op.contenedores).toEqual([]);
  });
});

describe("el vencimiento en un día en que el banco está cerrado (art. 29 a)", () => {
  /*
   * El artículo extiende el vencimiento al primer día hábil siguiente cuando el banco al que se
   * presenta está cerrado «por razones distintas de las del artículo 36», y un feriado es
   * exactamente eso. El motor corre el vencimiento por fin de semana pero no sabe de feriados: no
   * tiene ni puede tener el calendario de cada plaza.
   *
   * Lo que no puede hacer es dictaminar como si el feriado no existiera. Una presentación hecha el
   * primer día hábil posterior al vencimiento puede estar perfectamente en plazo, y el motor no
   * tiene con qué decir que no: corresponde verificarlo, no rechazarlo.
   */
  const lcVence = (fecha: string) => ({ ...LC, vencimiento: fecha });
  const presentar = (vence: string, cuando: Date) =>
    reglasDeGiro({
      lc: lcVence(vence),
      actual: { referencia: "1", fecha: cuando, importe: 51262, fechaEmbarque: "08-APR-2025" },
    }).find((x) => x.id === "giro-vencimiento");

  it("presentar el primer día hábil siguiente no es discrepancia: hay que verificar el feriado", () => {
    // 1 de mayo de 2025 es jueves y feriado en casi todas las plazas; el viernes 2 es el siguiente
    // día hábil.
    const r = presentar("01-may-25", new Date(2025, 4, 2));
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toMatch(/29 ?\(?a\)?|cerrado|feriado/i);
  });

  it("pero dos días hábiles después sí lo es: ningún feriado lo salva", () => {
    const r = presentar("01-may-25", new Date(2025, 4, 5));
    expect(r?.estado).toBe("DISCREPANCIA");
  });

  it("y presentar en fecha sigue estando bien", () => {
    expect(presentar("01-may-25", new Date(2025, 3, 30))?.estado).toBe("OK");
  });

  it("con los feriados de la plaza cargados, el vencimiento se corre de verdad", () => {
    // Cuando el banco sí sabe qué días estuvo cerrado, no hay nada que verificar a mano.
    const r = reglasDeGiro({
      lc: lcVence("01-may-25"),
      actual: { referencia: "1", fecha: new Date(2025, 4, 2), importe: 51262, fechaEmbarque: "08-APR-2025" },
      feriados: [new Date(2025, 4, 1)],
    }).find((x) => x.id === "giro-vencimiento");
    expect(r?.estado).toBe("OK");
    expect(r?.fuente).toContain("29a");
  });
});

describe("el giro no puede pasarse del crédito (UCP 600 art. 30 b y c)", () => {
  /*
   * Reproducido antes de arreglarlo: un giro de 56.000 contra un crédito de 54.150 salía OK, con la
   * evidencia «tope USD 56.857,50». Ese 5 % venía del 30 (b), que es tolerancia de CANTIDAD y cuya
   * propia condición es que el total girado no exceda el crédito. El banco pagaba de más.
   */
  const sinTolerancia: LcInfo = { ...LC, tolerancia: null };
  const girar = (importe: number, lc = sinTolerancia) =>
    reglasDeGiro({
      lc,
      actual: { referencia: "1", fecha: new Date(2025, 3, 20), importe, fechaEmbarque: "08-APR-2025" },
    }).find((x) => x.id === "giro-saldo");

  it("sin 39A ni «about», girar por encima del crédito es discrepancia", () => {
    expect(girar(56000)?.estado).toBe("DISCREPANCIA");
  });

  it("y girar por el importe exacto del crédito está bien", () => {
    expect(girar(54150)?.estado).toBe("OK");
  });

  it("con 39A cargado, el margen del crédito sí se usa", () => {
    // El crédito del caso trae 39A 10/10: ahí 56.000 entra.
    expect(girar(56000, { ...LC, tolerancia: 0.1 })?.estado).toBe("OK");
    expect(girar(60000, { ...LC, tolerancia: 0.1 })?.estado).toBe("DISCREPANCIA");
  });
});
