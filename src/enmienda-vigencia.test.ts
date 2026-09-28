import { describe, expect, it } from "vitest";
import { aceptacionTacita, creditoVigente, revisarEnmienda } from "./enmienda-vigencia";
import type { Enmienda } from "./enmiendas";

/**
 * Qué crédito rige mientras una enmienda no se contesta (UCP 600 art. 10).
 *
 * El parser de enmiendas dice qué cambia. Lo que faltaba es lo otro: **cuál de los dos créditos
 * manda hoy**. Y la respuesta del artículo 10 (c) no es la intuitiva — no manda el enmendado
 * porque el emisor lo haya emitido, sino el original, hasta que el beneficiario comunique que
 * acepta. El emisor queda obligado desde que la emite (10 b); el beneficiario, no.
 *
 * Examinar contra el crédito equivocado invierte el resultado entero: documentos que cumplen pasan
 * a no cumplir, y al revés.
 */

const BASE: Enmienda = {
  numeroLC: "LCMRDN25000471",
  numeroEnmienda: "1",
  fecha: "25-abr-25",
  vencimiento: "31-jul-25",
  narrativa: null,
};

describe("cuál de los dos créditos rige", () => {
  it("sin respuesta del beneficiario, rige el original", () => {
    // Es lo contrario de lo que parece: la enmienda ya está emitida y el emisor obligado, pero para
    // el beneficiario no cambió nada todavía.
    expect(creditoVigente("SIN_RESPUESTA")).toBe("ORIGINAL");
  });

  it("aceptada, rige el enmendado", () => {
    expect(creditoVigente("ACEPTADA")).toBe("ENMENDADO");
  });

  it("rechazada, sigue rigiendo el original", () => {
    expect(creditoVigente("RECHAZADA")).toBe("ORIGINAL");
  });
});

describe("la cláusula que se desestima (10 f)", () => {
  /*
   * Aparece en enmiendas reales todo el tiempo: «esta enmienda se considerará aceptada salvo
   * rechazo dentro de siete días». El artículo dice que esa disposición **se desestima**, sin más.
   * El riesgo es de los dos lados: el emisor cree que la enmienda rige y no rige, y el beneficiario
   * cree que tiene que contestar antes de una fecha que no existe.
   */
  it.each([
    "THIS AMENDMENT SHALL BE DEEMED ACCEPTED UNLESS REJECTED WITHIN 7 DAYS",
    "This amendment will enter into force unless rejected by the beneficiary within 10 banking days",
    "SE CONSIDERARA ACEPTADA SI NO ES RECHAZADA DENTRO DE 5 DIAS",
  ])("la detecta: «%s»", (narrativa) => {
    const o = revisarEnmienda({ ...BASE, narrativa }, "SIN_RESPUESTA").find((x) => x.id === "ucp-10f");
    expect(o).toBeDefined();
    expect(o?.fuente).toContain("10f");
    expect(o?.que).toMatch(/desestim/i);
  });

  it("y no la inventa donde no está", () => {
    const o = revisarEnmienda({ ...BASE, narrativa: "PLEASE ADVISE BENEFICIARY" }, "SIN_RESPUESTA");
    expect(o.find((x) => x.id === "ucp-10f")).toBeUndefined();
  });

  it("también cuando viene entre las condiciones adicionales y no en la narrativa", () => {
    const o = revisarEnmienda(
      { ...BASE, condicionesAdicionales: ["AMENDMENT DEEMED ACCEPTED IF NOT REJECTED WITHIN 15 DAYS"] },
      "SIN_RESPUESTA",
    );
    expect(o.find((x) => x.id === "ucp-10f")).toBeDefined();
  });
});

describe("la aceptación tácita (10 c)", () => {
  /*
   * La otra mitad del artículo: si el beneficiario no contestó pero presenta documentos que cumplen
   * con el crédito **y** con la enmienda, esa presentación vale como aceptación. Desde ese momento
   * el crédito queda enmendado. No es una formalidad: cambia contra qué se examinan los giros que
   * vengan después.
   */
  it("presentar documentos que cumplen con los dos vale como aceptar", () => {
    const r = aceptacionTacita("SIN_RESPUESTA", { cumpleConOriginal: true, cumpleConEnmendado: true });
    expect(r.aceptada).toBe(true);
    expect(r.porQue).toMatch(/10 ?\(?c\)?/);
  });

  it("si solo cumple con el original, no hay aceptación: la enmienda sigue pendiente", () => {
    expect(aceptacionTacita("SIN_RESPUESTA", { cumpleConOriginal: true, cumpleConEnmendado: false }).aceptada).toBe(
      false,
    );
  });

  it("si solo cumple con el enmendado, tampoco: contra el crédito que rige no cumple", () => {
    // Es el caso incómodo: el beneficiario embarcó según la enmienda sin aceptarla. Los documentos
    // no cumplen con el crédito vigente para él, que sigue siendo el original.
    const r = aceptacionTacita("SIN_RESPUESTA", { cumpleConOriginal: false, cumpleConEnmendado: true });
    expect(r.aceptada).toBe(false);
    expect(r.porQue).toMatch(/original/i);
  });

  it("con la enmienda ya aceptada, la pregunta no se hace", () => {
    expect(aceptacionTacita("ACEPTADA", { cumpleConOriginal: true, cumpleConEnmendado: true }).aceptada).toBe(true);
  });

  it("y rechazada, una presentación conforme no la resucita", () => {
    expect(aceptacionTacita("RECHAZADA", { cumpleConOriginal: true, cumpleConEnmendado: true }).aceptada).toBe(false);
  });
});

describe("lo demás del artículo", () => {
  it("10 e: una aceptación parcial es un rechazo", () => {
    const o = revisarEnmienda(BASE, "ACEPTADA_EN_PARTE").find((x) => x.id === "ucp-10e");
    expect(o?.que).toMatch(/rechazo/i);
    expect(creditoVigente("ACEPTADA_EN_PARTE")).toBe("ORIGINAL");
  });

  it("10 c: mientras no conteste, se recuerda contra qué se examina", () => {
    const o = revisarEnmienda(BASE, "SIN_RESPUESTA").find((x) => x.id === "ucp-10c");
    expect(o?.que).toMatch(/original/i);
  });

  it("aceptada, no se recuerda nada: una nota que siempre aparece deja de leerse", () => {
    expect(revisarEnmienda(BASE, "ACEPTADA").find((x) => x.id === "ucp-10c")).toBeUndefined();
  });
});
