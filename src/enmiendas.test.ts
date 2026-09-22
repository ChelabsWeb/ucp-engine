import { describe, expect, it } from "vitest";
import { aplicarEnmienda, diffEnmienda, esEnmienda, montoResultante, parseMT707 } from "./enmiendas";
import { SWIFT_CSU2025099 as MT710_CSU2025099 } from "./fixtures";
import { parseMT700 } from "./swift-lc";

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
