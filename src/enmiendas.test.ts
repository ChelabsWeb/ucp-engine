import { describe, expect, it } from "vitest";
import {
  aplicarEnmienda,
  creditoVigenteCon,
  diffEnmienda,
  type Enmienda,
  esEnmienda,
  montoResultante,
  parseMT707,
} from "./enmiendas";
import { SWIFT_CSU2025099 as MT710_CSU2025099 } from "./fixtures";
import { parseMT700 } from "./swift-lc";
import type { LcInfo } from "./types";

const LC = parseMT700(MT710_CSU2025099)!.lc;

/* enmienda típica: corre el embarque y el vencimiento, sube el monto y agrega una condición */
const MT707 = `{1:F01MRDNLKLXAXXX0000000000}{2:I707BLITUYMMXXXXN}{4:
:20:AMD25000471/1
:21:LCMRDN25000471
:26E:1
:30:250415
:31E:250731
:44C:250531
:32B:USD5415,00
:47B:+1) INSPECTION CERTIFICATE ISSUED BY SGS REQUIRED
+2) DISCREPANCY FEE OF USD 80/- WILL BE DEDUCTED
:79:ALL OTHER TERMS AND CONDITIONS REMAIN UNCHANGED
-}`;

describe("parseMT707 — la enmienda solo trae lo que cambia (A5)", () => {
  it("reconoce el 707 y saca LC, número de enmienda y fecha", () => {
    expect(esEnmienda(MT707)).toBe(true);
    expect(esEnmienda(MT710_CSU2025099)).toBe(false);
    expect(parseMT707(MT710_CSU2025099)).toBeNull();
    const e = parseMT707(MT707)!;
    expect(e).toMatchObject({ numeroLC: "LCMRDN25000471", numeroEnmienda: "1", fecha: "15-abr-25" });
  });
  it("vencimiento (31E), último embarque (44C), aumento (32B) y condiciones nuevas (47B)", () => {
    const e = parseMT707(MT707)!;
    expect(e.vencimiento).toBe("31-jul-25");
    expect(e.limiteEmbarque).toBe("31-may-25");
    expect(e.aumento).toBe(5415);
    expect(e.monto).toBeUndefined(); // sin 34B no es monto nuevo total
    expect(e.condicionesAdicionales).toHaveLength(2);
    expect(e.narrativa).toContain("REMAIN UNCHANGED");
  });
  it("con 34B el monto es el total nuevo, no un aumento", () => {
    const e = parseMT707(MT707.replace(":32B:USD5415,00", ":34B:USD60000,00"))!;
    expect(e.monto).toBe(60000);
    expect(montoResultante(LC, e)).toBe(60000);
  });
  it("con 33B el monto baja", () => {
    const e = parseMT707(MT707.replace(":32B:USD5415,00", ":33B:USD1000,00"))!;
    expect(montoResultante({ ...LC, monto: 54150 }, e)).toBe(53150);
  });
});

describe("diffEnmienda / aplicarEnmienda — qué cambia antes de tocar la LC", () => {
  const e = parseMT707(MT707)!;
  const lc = { ...LC, monto: 54150, moneda: "USD" };

  it("lista los cambios con el valor de antes y el de después", () => {
    const cambios = diffEnmienda(lc, e);
    const por = (c: string) => cambios.find((x) => x.campo === c);
    expect(por("Vencimiento")).toMatchObject({ antes: LC.vencimiento, despues: "31-jul-25" });
    expect(por("Último embarque")).toMatchObject({ antes: LC.limiteEmbarque, despues: "31-may-25" });
    expect(por("Monto")?.despues).toContain("59.565,00");
    // las dos condiciones del 47B se listan: el cotejo es por texto exacto, y el fee viene redactado
    // distinto que en la LC original — mejor mostrarlo que asumir que es el mismo
    expect(cambios.filter((c) => c.campo.startsWith("Condiciones"))).toHaveLength(2);
  });

  it("no inventa cambios: una enmienda que repite lo vigente no mueve nada", () => {
    const igual = parseMT707(
      `{1:F01X}{2:I707YN}{4:\n:21:LCMRDN25000471\n:26E:2\n:30:250420\n:31E:${LC.vencimiento === "30-jun-25" ? "250630" : "250630"}\n:79:NO CHANGES\n-}`,
    )!;
    expect(diffEnmienda({ ...lc, vencimiento: "30-jun-25" }, igual)).toHaveLength(0);
  });

  it("aplicar deja la LC con lo nuevo y conserva lo que la enmienda no menciona", () => {
    const nueva = aplicarEnmienda(lc, e);
    expect(nueva.vencimiento).toBe("31-jul-25");
    expect(nueva.limiteEmbarque).toBe("31-may-25");
    expect(nueva.monto).toBe(59565);
    expect(nueva.bancoEmisor).toBe(lc.bancoEmisor);
    expect(nueva.documentosExigidos).toEqual(lc.documentosExigidos);
    expect(nueva.condicionesAdicionales!.length).toBe((lc.condicionesAdicionales ?? []).length + 2);
    expect(nueva.condicionesAdicionales!.some((c) => /SGS/.test(c))).toBe(true);
  });
});

describe("un crédito con más de una enmienda", () => {
  /*
   * El artículo 10 (c) dice que la aceptación es **por enmienda**: el beneficiario puede aceptar una
   * y no la otra, y mientras no comunique nada siguen rigiendo los términos originales.
   *
   * El motor aceptaba una sola, y la mesa precargaba la última. Con dos enmiendas acumulativas —una
   * que cambia el monto y otra el vencimiento— se examinaba contra un crédito que no es ni el
   * original ni el enmendado: el original con la segunda, perdiendo la primera.
   *
   * Lo que no tiene ambigüedad: las que el beneficiario **aceptó** se aplican todas, en orden. Lo
   * que sí la tiene es más de una sin respuesta, porque la aceptación tácita se decide mirando la
   * presentación y no se puede repartir entre dos. Ahí el motor lo dice en vez de elegir.
   */
  const base: LcInfo = {
    numero: "LC-1",
    monto: 100000,
    moneda: "USD",
    vencimiento: "31-dic-25",
    bancoEmisor: "",
    bancoAvisador: "",
    limiteEmbarque: "",
    plazoPresentacion: "",
  };
  const enmienda = (x: Partial<Enmienda>): Enmienda => ({
    numeroLC: "LC-1",
    numeroEnmienda: "1",
    fecha: null,
    narrativa: null,
    ...x,
  });
  // el 32B de una enmienda trae el **aumento**, no el monto nuevo: por eso `aumento` y no `monto`
  const sube = enmienda({ numeroEnmienda: "1", aumento: 20000 });
  const acorta = enmienda({ numeroEnmienda: "2", vencimiento: "30-nov-25" });

  it("las aceptadas se aplican todas, en orden", () => {
    const r = creditoVigenteCon(base, [
      { enmienda: sube, estado: "ACEPTADA" },
      { enmienda: acorta, estado: "ACEPTADA" },
    ]);
    expect(r.lc.monto, "se perdió la enmienda del monto").toBe(120000);
    expect(r.lc.vencimiento, "se perdió la enmienda del vencimiento").toBe("30-nov-25");
    expect(r.sinResponder).toBeNull();
  });

  it("una rechazada no cambia nada, aunque la de al lado sí", () => {
    const r = creditoVigenteCon(base, [
      { enmienda: sube, estado: "RECHAZADA" },
      { enmienda: acorta, estado: "ACEPTADA" },
    ]);
    expect(r.lc.monto).toBe(100000);
    expect(r.lc.vencimiento).toBe("30-nov-25");
  });

  it("la que no tiene respuesta queda aparte: es la que decide la presentación (10 c)", () => {
    const r = creditoVigenteCon(base, [
      { enmienda: sube, estado: "ACEPTADA" },
      { enmienda: acorta, estado: "SIN_RESPUESTA" },
    ]);
    expect(r.lc.monto, "la aceptada tiene que estar aplicada").toBe(120000);
    expect(r.lc.vencimiento, "la que no se contestó no rige todavía").toBe("31-dic-25");
    expect(r.sinResponder?.numeroEnmienda).toBe("2");
  });

  it("**con dos sin responder no se elige: se dice**", () => {
    const r = creditoVigenteCon(base, [
      { enmienda: sube, estado: "SIN_RESPUESTA" },
      { enmienda: acorta, estado: "SIN_RESPUESTA" },
    ]);
    expect(r.sinResponder, "eligió una de las dos").toBeNull();
    expect(r.ambiguo, "no avisó que hay más de una sin responder").toBe(true);
    expect(r.lc.monto).toBe(100000);
  });

  it("sin enmiendas, el crédito es el que era", () => {
    const r = creditoVigenteCon(base, []);
    expect(r.lc).toEqual(base);
    expect(r.sinResponder).toBeNull();
    expect(r.ambiguo).toBe(false);
  });
});
