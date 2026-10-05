import { describe, expect, it } from "vitest";
import { cotejarPreaviso, resumenPreaviso } from "./preaviso";
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
