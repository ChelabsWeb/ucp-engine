import { describe, expect, it } from "vitest";
import { cotejarPreaviso, resumenPreaviso, sonElMismoCredito } from "./preaviso";
import type { LcInfo } from "./types";

/**
 * El pre-aviso contra el crédito que llegó después (UCP 600 art. 11 b).
 *
 * El artículo tiene dos mitades y solo estaba la primera —que un pre-aviso **no es** el crédito, así
 * que no hay contra qué examinar—. La que faltaba es la que obliga al emisor: «un banco emisor que
 * manda un pre-aviso queda irrevocablemente comprometido a emitir el crédito operativo, sin demora,
 * **en términos no inconsistentes con el pre-aviso**».
 *
 * Nadie lo coteja a mano con confianza: el pre-aviso llega semanas antes, el beneficiario empieza a
 * producir con eso, y cuando llega el operativo lo que se mira es el operativo. Si bajó el monto o
 * se adelantó el vencimiento, el emisor está en falta y el beneficiario tiene un reclamo — pero hay
 * que haberlo notado.
 *
 * **La distinción que importa: agregar detalle no es contradecir.** Un pre-aviso es breve y el
 * operativo completa. Marcar cada campo que el pre-aviso no trae convertiría el control en ruido.
 */

const PREAVISO: LcInfo = {
  numero: "LCMRDN25000471",
  bancoEmisor: "MERIDIAN BANK PLC",
  bancoAvisador: "BANCO LITORAL (URUGUAY) S.A.",
  vencimiento: "30-jun-25",
  limiteEmbarque: "30-abr-25",
  // como lo arma el parser de verdad, no un número suelto: «21» a secas no lo lee nadie
  plazoPresentacion: "21 días desde la fecha de embarque (campo 48)",
  monto: 54150,
  moneda: "USD",
  beneficiario: "CEREALSUR S.A",
};

const operativo = (over: Partial<LcInfo> = {}): LcInfo => ({ ...PREAVISO, ...over });

describe("el crédito que respeta el pre-aviso", () => {
  it("idéntico: nada que decir", () => {
    expect(cotejarPreaviso(PREAVISO, operativo())).toEqual([]);
  });

  it("y agregar lo que el pre-aviso no traía tampoco es contradecirlo", () => {
    /*
     * Un pre-aviso no lleva el 46A ni el 47A: eso llega con el operativo. Si cada campo agregado
     * contara como inconsistencia, el control gritaría en todos los casos normales y nadie lo
     * miraría el día que haya uno de verdad.
     */
    const r = cotejarPreaviso({ ...PREAVISO, limiteEmbarque: "", plazoPresentacion: "" }, operativo());
    expect(r).toEqual([]);
  });
});

describe("el crédito que contradice el pre-aviso", () => {
  it("bajar el monto deja al beneficiario peor", () => {
    const r = cotejarPreaviso(PREAVISO, operativo({ monto: 50000 }));
    expect(r).toHaveLength(1);
    expect(r[0]?.campo).toMatch(/monto|importe/i);
    expect(r[0]?.peorParaElBeneficiario).toBe(true);
    expect(r[0]?.fuente).toMatch(/11 ?b/);
  });

  it("subirlo también es inconsistente, pero no lo perjudica", () => {
    // El artículo habla de términos no inconsistentes, no de términos peores. La diferencia se
    // informa; lo que cambia es si hay alguien perjudicado.
    const r = cotejarPreaviso(PREAVISO, operativo({ monto: 60000 }));
    expect(r).toHaveLength(1);
    expect(r[0]?.peorParaElBeneficiario).toBe(false);
  });

  it("adelantar el vencimiento lo perjudica", () => {
    const r = cotejarPreaviso(PREAVISO, operativo({ vencimiento: "15-jun-25" }));
    expect(r[0]?.campo).toMatch(/vencimiento/i);
    expect(r[0]?.peorParaElBeneficiario).toBe(true);
  });

  it("extenderlo, no", () => {
    expect(cotejarPreaviso(PREAVISO, operativo({ vencimiento: "31-jul-25" }))[0]?.peorParaElBeneficiario).toBe(false);
  });

  it("adelantar el último embarque lo perjudica", () => {
    const r = cotejarPreaviso(PREAVISO, operativo({ limiteEmbarque: "15-abr-25" }));
    expect(r[0]?.peorParaElBeneficiario).toBe(true);
  });

  it("acortar el plazo de presentación lo perjudica", () => {
    const r = cotejarPreaviso(PREAVISO, operativo({ plazoPresentacion: "10 días desde la fecha de embarque" }));
    expect(r[0]?.peorParaElBeneficiario).toBe(true);
  });

  it("cambiar la moneda es inconsistente y no se puede comparar cuál es peor", () => {
    const r = cotejarPreaviso(PREAVISO, operativo({ moneda: "EUR" }));
    expect(r).toHaveLength(1);
    expect(r[0]?.campo).toMatch(/moneda/i);
  });

  it("y cambiar el beneficiario es lo más grave: es otro crédito", () => {
    const r = cotejarPreaviso(PREAVISO, operativo({ beneficiario: "OTRA EMPRESA S.A" }));
    expect(r[0]?.campo).toMatch(/beneficiario/i);
    expect(r[0]?.peorParaElBeneficiario).toBe(true);
  });

  it("un número de crédito distinto no es inconsistencia: no son el mismo crédito", () => {
    // Si el número difiere, el operativo no es el crédito que este pre-aviso anunciaba, y
    // compararlos campo por campo sería inventar un vínculo que no existe.
    expect(cotejarPreaviso(PREAVISO, operativo({ numero: "OTRO-123" }))).toEqual([]);
  });
});

describe("el resumen", () => {
  it("dice si el emisor cumplió el artículo 11 (b)", () => {
    expect(resumenPreaviso(cotejarPreaviso(PREAVISO, operativo())).consistente).toBe(true);
    const malo = cotejarPreaviso(PREAVISO, operativo({ monto: 50000, vencimiento: "15-jun-25" }));
    const r = resumenPreaviso(malo);
    expect(r.consistente).toBe(false);
    expect(r.perjudican).toBe(2);
  });
});

describe("lo que el pre-aviso no trae, y los nombres escritos distinto", () => {
  /*
   * Dos defectos que convertían este módulo —cuya afirmación más grave es «quien produjo contra el
   * pre-aviso no es quien va a poder cobrar»— en una alarma por un punto.
   */
  it("un punto en la razón social no hace que sea otro beneficiario", () => {
    /*
     * El beneficiario se comparaba con `===` al lado de reglas que usan `comparaISBP`, que tolera
     * abreviaturas (A1) y errores de tipeo (A23) justamente para esto.
     */
    const r = cotejarPreaviso(PREAVISO, operativo({ beneficiario: "CEREALSUR S.A." }));
    expect(r).toEqual([]);
  });

  it("pero otro beneficiario sigue siendo lo más grave", () => {
    const r = cotejarPreaviso(PREAVISO, operativo({ beneficiario: "OTRA EMPRESA S.A" }));
    expect(r[0]?.campo).toMatch(/beneficiario/i);
    expect(r[0]?.peorParaElBeneficiario).toBe(true);
  });

  it("el «—» con que el parser marca un campo ausente no es una fecha", () => {
    /*
     * El 31D es optativo en un MT705, y el parser deja «—» cuando no está. Eso contaba como «el
     * pre-aviso trae este campo», así que el operativo salía «inconsistente» por traer un
     * vencimiento que el pre-aviso nunca anunció — justo lo contrario de lo que el módulo promete:
     * agregar detalle no es contradecir.
     */
    const r = cotejarPreaviso({ ...PREAVISO, vencimiento: "—" }, operativo());
    expect(r).toEqual([]);
  });

  it("y cuando las fechas no se pueden leer, no se afirma que no perjudica", () => {
    // Antes decía «es inconsistente, aunque no lo perjudica» sobre algo que no se sabe.
    const r = cotejarPreaviso({ ...PREAVISO, vencimiento: "ver carta adjunta" }, operativo());
    expect(r).toEqual([]);
  });

  it("dos créditos con números distintos no se informan como consistentes", () => {
    /*
     * `cotejarPreaviso` devuelve `[]` cuando los números difieren —correcto, no son el mismo
     * crédito— y `resumenPreaviso` lo leía como «consistente: true». Decir que un emisor cumplió el
     * artículo 11 (b) porque le pasamos dos créditos que no se corresponden es peor que no decir
     * nada.
     */
    const otro = operativo({ numero: "OTRO-123" });
    const r = resumenPreaviso(cotejarPreaviso(PREAVISO, otro), sonElMismoCredito(PREAVISO, otro));
    expect(r.consistente).toBe(false);
    expect(r.comparable).toBe(false);
  });
});

describe("el beneficiario del pre-aviso: tolerar un punto no es tolerar otra empresa", () => {
  /*
   * Comparar con `comparaISBP` cerró el falso positivo del punto y abrió uno peor en el otro
   * sentido: la tolerancia de la ISBP está pensada para un dato de un documento contra el crédito
   * —abreviaturas (A1), un error de tipeo (A23)—, no para decidir si dos mensajes hablan de la
   * **misma persona jurídica**.
   *
   * «NEW CEREALSUR S.A» contiene a «CEREALSUR S.A.» y salía EQUIVALENTE, así que el módulo callaba
   * justo donde tiene que hablar más fuerte: quien produjo contra el pre-aviso no es quien va a
   * poder cobrar.
   *
   * La salida no es volver a `===` —el punto seguiría disparando— sino separar los dos casos: lo
   * que la ISBP tolera no se informa, lo demás sí.
   */
  it.each(["NEW CEREALSUR S.A", "CEREALSUR S.A. SUCURSAL PARAGUAY", "CEREALSUR SA (IN LIQUIDATION)", "ACROMEALS S.A"])(
    "«%s» no es el beneficiario del pre-aviso",
    (beneficiario) => {
      const r = cotejarPreaviso(PREAVISO, operativo({ beneficiario }));
      expect(
        r.map((x) => x.campo),
        "no dijo nada sobre el beneficiario",
      ).toContain("Beneficiario");
    },
  );

  it("pero un punto de más sigue sin ser otro beneficiario", () => {
    expect(cotejarPreaviso(PREAVISO, operativo({ beneficiario: "CEREALSUR S.A." }))).toEqual([]);
  });
});

describe("dos mensajes sin número no son el mismo crédito por omisión", () => {
  /*
   * `parseMT700` deja «—» cuando no hay campo 20, `VACIO` lo vuelve cadena vacía y la condición
   * `!a || !b` daba `true`. La pantalla entonces mostraba «el crédito operativo no es inconsistente
   * con lo que se pre-avisó» sobre dos mensajes cuyo vínculo nunca se verificó, que es exactamente
   * lo que `comparable` vino a evitar.
   */
  it("sin número en uno de los dos, no se afirma nada", () => {
    expect(sonElMismoCredito(PREAVISO, operativo({ numero: "" }))).toBe(false);
    expect(sonElMismoCredito({ ...PREAVISO, numero: "—" }, operativo())).toBe(false);
  });

  it("y con el mismo número sí", () => {
    expect(sonElMismoCredito(PREAVISO, operativo())).toBe(true);
  });
});
