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

describe("las formas en que un crédito declara las URR de verdad", () => {
  /*
   * `\bURR\b` no matchea «URR725» —sin espacio, como lo escriben— y el campo **40E** ni se miraba,
   * cuando el código SWIFT estándar para esto es justamente «UCPURR LATEST VERSION». Los dos casos
   * daban aviso sobre un crédito que sí lo declara.
   */
  it.each([
    ["REIMBURSEMENT IS SUBJECT TO URR725.", null],
    ["REIMBURSEMENT SUBJECT TO ICC URR 725", null],
    ["CLAIMS SUBJECT TO UNIFORM RULES FOR BANK-TO-BANK REIMBURSEMENTS", null],
  ])("«%s» no deja aviso", (instrucciones) => {
    expect(del13(con({ bancoReembolsador: "CITIUS33", instruccionesAlBanco: instrucciones }))).toEqual([]);
  });

  it("y el 40E «UCPURR LATEST VERSION» tampoco, que es el código estándar", () => {
    expect(del13(con({ bancoReembolsador: "CITIUS33", reglas: "UCPURR LATEST VERSION" }))).toEqual([]);
  });

  it("pero un crédito que no lo dice sigue dando aviso", () => {
    expect(del13(con({ bancoReembolsador: "CITIUS33", reglas: "UCP LATEST VERSION" }))).toHaveLength(1);
  });
});

describe("el certificado de cumplimiento: a quién se le exige", () => {
  /*
   * La regla saltaba por **proximidad de palabras**: cualquier 78 que mencionara «certify» y
   * «reimbursing bank» en noventa caracteres daba CONFLICTO, aunque el certificado fuera para el
   * emisor. El propio comentario del código advertía contra eso.
   *
   * Lo que el artículo niega es condicionar **el reembolso** a ese papel, así que lo que hay que
   * mirar es a quién se lo exige, no si las dos palabras están cerca.
   */
  it("certificar al emisor en la carta de remesa no es lo que el artículo prohíbe", () => {
    const r = del13(
      con({
        bancoReembolsador: "CITIUS33",
        instruccionesAlBanco:
          "NEGOTIATING BANK TO CERTIFY COMPLIANCE ON ITS COVERING LETTER TO US AND CLAIM REIMBURSEMENT FROM THE REIMBURSING BANK.",
      }),
    );
    expect(r.find((o) => o.fuente.includes("13b"))).toBeUndefined();
  });

  it("ni una frase que solo nombra las dos cosas de paso", () => {
    const r = del13(
      con({
        bancoReembolsador: "CITIUS33",
        instruccionesAlBanco:
          "WE SHALL AUTHORIZE THE REIMBURSING BANK TO HONOUR YOUR CLAIM. BENEFICIARY'S CERTIFICATE IS NOT REQUIRED IN DUPLICATE.",
      }),
    );
    expect(r.find((o) => o.fuente.includes("13b"))).toBeUndefined();
  });

  /*
   * Y las tres formas que el arreglo anterior dejó pasar.
   *
   * Exigir que el certificado vaya «dirigido a» el reembolsador cerró el falso positivo y abrió
   * tres falsos negativos, todos con la redacción corriente: el artículo no habla de a quién se le
   * dirige el papel sino de **condicionar el reembolso** a él. Si el reclamo al reembolsador no se
   * paga sin el certificado, está prohibido, lo diga como lo diga.
   */
  it.each([
    "CLAIMS ON THE REIMBURSING BANK MUST BE ACCOMPANIED BY YOUR CERTIFICATE THAT ALL TERMS HAVE BEEN COMPLIED WITH.",
    "REIMBURSING BANK WILL HONOUR YOUR CLAIM ONLY AGAINST YOUR CERTIFICATE OF COMPLIANCE.",
    "WHEN CLAIMING FROM THE REIMBURSING BANK, CERTIFY THAT ALL TERMS AND CONDITIONS ARE COMPLIED WITH.",
  ])("«%s» también lo condiciona", (texto) => {
    const r = del13(con({ bancoReembolsador: "CITIUS33", instruccionesAlBanco: texto }));
    expect(r.find((o) => o.fuente.includes("13b"))?.gravedad).toBe("CONFLICTO");
  });

  it("pero exigírselo al reembolsador sigue siendo conflicto", () => {
    const r = del13(
      con({
        bancoReembolsador: "CITIUS33",
        instruccionesAlBanco:
          "WHEN CLAIMING, NEGOTIATING BANK MUST CERTIFY TO THE REIMBURSING BANK THAT ALL TERMS AND CONDITIONS OF THE CREDIT HAVE BEEN COMPLIED WITH.",
      }),
    );
    expect(r.find((o) => o.fuente.includes("13b"))?.gravedad).toBe("CONFLICTO");
  });
});
