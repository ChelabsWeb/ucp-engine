import { describe, expect, it } from "vitest";
import { type DatosMT740, type DatosMT742, type DatosMT747, mt740, mt742, mt747 } from "./mt740";

/**
 * Los tres mensajes del reembolso entre bancos (MT740, MT742, MT747).
 *
 * Son el papeleo alrededor del artículo 13, y podrían haber sido plomería. No lo son, porque el
 * artículo le pone condiciones a estos mismos mensajes y el armador las puede hacer cumplir:
 *
 * - **13 (b) (ii): la autorización de reembolso no debería llevar vencimiento.** Una con fecha de
 *   vencimiento deja al banco que reclama sin de dónde cobrar el día que reclame tarde, y el
 *   artículo dice que no corresponde. El armador se niega.
 * - **13 (b) (iii): al banco que reclama no se le puede exigir un certificado de cumplimiento.** Un
 *   MT742 que lo lleve está aceptando una condición que el artículo le niega.
 * - **13 (b) (iv) y (v): si el reembolsador no paga a primer requerimiento, el emisor reembolsa
 *   igual**, y responde por los intereses perdidos y por los gastos del reembolsador. Eso va dicho
 *   en el reclamo, porque es lo que el banco que reclama tiene a favor.
 *
 * Y una cuenta: lo reclamado no puede pasarse de lo autorizado más su tolerancia.
 */

const AUTORIZACION: DatosMT740 = {
  referenciaPropia: "REIMB-2025-0471",
  referenciaCredito: "LCMRDN25000471",
  moneda: "USD",
  monto: 54150,
  tolerancia: 0.1,
  bancoQueReclama: "BLITUYMM",
  fecha: new Date(2025, 2, 20),
};

describe("la autorización de reembolso (MT740)", () => {
  it("sale con sus campos", () => {
    const m = mt740(AUTORIZACION);
    for (const tag of [":20:", ":21:", ":32B:"]) expect(m.texto, `falta ${tag}`).toContain(tag);
    expect(m.texto).toContain("USD54150,");
  });

  it("la tolerancia del crédito viaja en el 39A", () => {
    expect(mt740(AUTORIZACION).texto).toContain(":39A:10/10");
  });

  it("y sin tolerancia no se escribe el campo: no es lo mismo que 0/0", () => {
    /*
     * Un 39A ausente deja que rija lo que diga el crédito; un «0/0» le dice al reembolsador que no
     * hay tolerancia ninguna. Escribirlo sin que el crédito lo diga sería ajustar el reembolso por
     * nuestra cuenta.
     */
    const m = mt740({ ...AUTORIZACION, tolerancia: null });
    expect(m.texto).not.toContain(":39A:");
  });

  it("NO se emite con fecha de vencimiento (13 b ii)", () => {
    /*
     * Es el hallazgo que convierte esto en algo más que plomería. Una autorización con vencimiento
     * deja al banco que reclama sin de dónde cobrar el día que reclame tarde, y el artículo dice
     * que no corresponde ponerle una.
     */
    const m = mt740({ ...AUTORIZACION, vencimiento: new Date(2025, 5, 30) });
    expect(m.texto).toBe("");
    expect(m.avisos.join(" ")).toMatch(/13 ?\(?b\)? ?\(?ii\)?/i);
    expect(m.avisos.join(" ")).toMatch(/expiry/i);
  });
});

describe("el reclamo de reembolso (MT742)", () => {
  const RECLAMO: DatosMT742 = {
    referenciaPropia: "CLAIM-0417",
    referenciaAutorizacion: "REIMB-2025-0471",
    moneda: "USD",
    montoPrincipal: 41040,
    autorizado: { moneda: "USD", monto: 54150, tolerancia: 0.1 },
    fecha: new Date(2025, 3, 17),
  };

  it("sale con el principal y el total", () => {
    const m = mt742(RECLAMO);
    expect(m.texto).toContain(":32B:USD41040,");
    expect(m.texto).toContain(":34A:");
  });

  it("los gastos se suman al total reclamado", () => {
    const m = mt742({ ...RECLAMO, gastos: 150 });
    expect(m.texto).toContain("41190,");
  });

  it("dice lo que el artículo le da al banco que reclama (13 b iv y v)", () => {
    const seguido = mt742(RECLAMO).texto.replace(/\n/g, " ");
    expect(seguido).toMatch(/FIRST DEMAND/i);
    expect(seguido).toMatch(/13/);
  });

  it("y NO lleva certificado de cumplimiento (13 b iii)", () => {
    /*
     * El artículo dice que no se le puede exigir. Mandarlo igual sería aceptar una condición que no
     * corresponde y sentar la práctica de que se exige.
     */
    const m = mt742({ ...RECLAMO, certificarCumplimiento: true });
    expect(m.texto).not.toMatch(/CERTIF/i);
    expect(m.avisos.join(" ")).toMatch(/13 ?\(?b\)? ?\(?iii\)?/i);
  });

  it("no se emite por más de lo autorizado más su tolerancia", () => {
    // 54.150 + 10 % = 59.565
    const m = mt742({ ...RECLAMO, montoPrincipal: 60000 });
    expect(m.texto).toBe("");
    expect(m.avisos.join(" ")).toMatch(/59565|exceed/i);
  });

  it("pero dentro de la tolerancia sí", () => {
    expect(mt742({ ...RECLAMO, montoPrincipal: 59000 }).texto).not.toBe("");
  });

  it("y en otra moneda que la autorizada, tampoco", () => {
    const m = mt742({ ...RECLAMO, moneda: "EUR" });
    expect(m.texto).toBe("");
    expect(m.avisos.join(" ")).toMatch(/currency/i);
  });
});

describe("la enmienda a la autorización (MT747)", () => {
  const ENMIENDA: DatosMT747 = {
    referenciaPropia: "REIMB-AMD-1",
    referenciaAutorizacion: "REIMB-2025-0471",
    fechaDeLaAutorizacion: new Date(2025, 2, 20),
    fecha: new Date(2025, 3, 15),
    moneda: "USD",
    aumento: 5000,
  };

  it("sale con la referencia y la fecha de la autorización que enmienda", () => {
    const m = mt747(ENMIENDA);
    expect(m.texto).toContain(":21:REIMB-2025-0471");
    expect(m.texto).toContain(":30:250320");
  });

  it("el aumento va con su campo", () => {
    expect(mt747(ENMIENDA).texto).toContain(":32B:USD5000,");
  });

  it("y una disminución, con el suyo", () => {
    expect(mt747({ ...ENMIENDA, aumento: null, disminucion: 5000 }).texto).toContain(":33B:USD5000,");
  });

  it("tampoco se emite para agregarle un vencimiento (13 b ii)", () => {
    // Por la puerta de atrás es el mismo problema: la autorización terminaría con vencimiento.
    const m = mt747({ ...ENMIENDA, aumento: null, nuevoVencimiento: new Date(2025, 5, 30) });
    expect(m.texto).toBe("");
    expect(m.avisos.join(" ")).toMatch(/13 ?\(?b\)? ?\(?ii\)?/i);
  });

  it("y una enmienda que no cambia nada no es un mensaje", () => {
    const m = mt747({ ...ENMIENDA, aumento: null });
    expect(m.texto).toBe("");
    expect(m.avisos.join(" ")).toMatch(/nothing/i);
  });
});
