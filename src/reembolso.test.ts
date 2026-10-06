import { describe, expect, it } from "vitest";
import { revisarCredito } from "./emision";
import { SWIFT_CSU2025099 } from "./fixtures";
import type { LcSwift } from "./swift-lc";
import { parseMT700 } from "./swift-lc";

/**
 * El reembolso entre bancos (UCP 600 art. 13), del lado de la revisión del crédito.
 *
 * Cuando el crédito dice que el banco designado se reembolsa reclamando a **otro** banco —el
 * reembolsador— el artículo 13 (a) le exige al crédito **decir si el reembolso se sujeta a las
 * reglas de la ICC** (URR 725) vigentes el día de la emisión. No decirlo no deja el crédito
 * inoperable: el 13 (b) suple las reglas que faltan. Pero conviene saberlo antes de aceptar la
 * designación, porque lo que suple el artículo no es lo mismo que lo que suplen las URR.
 *
 * Y hay una condición que el crédito **no puede** poner: el 13 (b) (iii) dice que al banco que
 * reclama no se le puede exigir un certificado de cumplimiento para cobrarle al reembolsador.
 * Un crédito que la pone le está pidiendo algo que el artículo le niega — y el banco designado que
 * la acepta se queda esperando un reembolso que depende de un papel que nadie tiene que darle.
 *
 * Los mensajes de reembolso (MT740, 742, 747) son otra cosa y no se arman acá: lo que se revisa es
 * el crédito, que es lo que llega al escritorio.
 */

const base = parseMT700(SWIFT_CSU2025099)!;

const con = (over: Partial<LcSwift["extra"]>): LcSwift => ({
  ...base,
  extra: { ...base.extra, ...over },
});

const del13 = (p: LcSwift) => revisarCredito(p).filter((o) => o.fuente.includes("13"));

describe("el crédito que nombra un banco reembolsador", () => {
  it("sin decir si rigen las URR, se avisa y se explica qué suple el artículo", () => {
    const r = del13(con({ bancoReembolsador: "CITIUS33" }));
    expect(r).toHaveLength(1);
    expect(r[0]?.fuente).toMatch(/13 ?a/);
    expect(r[0]?.que).toMatch(/URR|reglas de la ICC|reembolso/i);
    expect(r[0]?.sugerencia).toMatch(/URR|decir|aclarar/i);
  });

  it("no lo deja inoperable: el artículo suple lo que falta", () => {
    // La gravedad importa: un banco que ve «IMPIDE» donde el artículo tiene una respuesta deja de
    // confiar en las que sí impiden.
    expect(del13(con({ bancoReembolsador: "CITIUS33" }))[0]?.gravedad).toBe("AVISO");
  });

  it("y diciéndolo, no se observa nada", () => {
    const r = del13(
      con({
        bancoReembolsador: "CITIUS33",
        instruccionesAlBanco: "REIMBURSEMENT SUBJECT TO URR 725",
      }),
    );
    expect(r).toEqual([]);
  });

  it("también vale si lo dice en las condiciones adicionales", () => {
    const p = con({ bancoReembolsador: "CITIUS33" });
    const r = del13({
      ...p,
      lc: { ...p.lc, condicionesAdicionales: ["REIMBURSEMENT IS SUBJECT TO ICC URR 725"] },
    });
    expect(r).toEqual([]);
  });
});

describe("el crédito que no nombra reembolsador", () => {
  it("no se dice nada: el artículo 13 no se aplica", () => {
    // El crédito real se paga contra el emisor, así que no hay reembolso entre bancos que regular.
    expect(del13(base)).toEqual([]);
  });

  it("ni siquiera si menciona las URR de paso", () => {
    expect(del13(con({ instruccionesAlBanco: "URR 725 DOES NOT APPLY" }))).toEqual([]);
  });
});

describe("la condición que el artículo niega (13 b iii)", () => {
  it("exigir un certificado de cumplimiento para cobrarle al reembolsador", () => {
    const r = del13(
      con({
        bancoReembolsador: "CITIUS33",
        instruccionesAlBanco:
          "NEGOTIATING BANK TO CERTIFY COMPLIANCE WITH ALL TERMS OF THE CREDIT TO OUR REIMBURSING BANK WHEN CLAIMING",
      }),
    );
    const prohibida = r.find((o) => o.fuente.includes("13b"));
    expect(prohibida?.gravedad).toBe("CONFLICTO");
    expect(prohibida?.que).toMatch(/certificado|cumplimiento/i);
  });

  it("y pedir un certificado de cumplimiento al emisor no es lo mismo", () => {
    /*
     * El artículo niega exigírselo **al reembolsador**: es ahí donde el banco que reclama se queda
     * esperando. Un crédito que le pide al designado certificar al emisor es otra cosa, y marcarlo
     * sería inventar una prohibición que el artículo no tiene.
     */
    const r = del13(
      con({
        bancoReembolsador: "CITIUS33",
        instruccionesAlBanco: "NEGOTIATING BANK TO CERTIFY COMPLIANCE TO ISSUING BANK",
      }),
    );
    expect(r.find((o) => o.fuente.includes("13b"))).toBeUndefined();
  });
});
