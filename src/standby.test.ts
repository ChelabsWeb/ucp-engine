import { describe, expect, it } from "vitest";
import { contextoDesdeSwift, examinarPresentacion } from "./examen";
import { esStandby, limitesDelStandby, noAplicaAStandby, reglamentoAjeno } from "./standby";
import { parseMT700 } from "./swift-lc";

const STANDBY = `40A: Form of Documentary Credit
    IRREVOCABLE STANDBY
20: Documentary Credit Number
    SB2026000112
31C: Date of Issue
    260301
40E: Applicable Rules
    ISP LATEST VERSION
31D: Date and Place of Expiry
    270301NEW YORK
32B: Currency Code, Amount
    USD500000,00
48: Period for Presentation in Days
    21/AFTER SHIPMENT DATE
50: Applicant
    CONSTRUCTORA DEL ESTE S.A.
59: Beneficiary - Name & Address
    MUNICIPALIDAD DE SAN JOSE
45A: Description of Goods and/or Services
    PERFORMANCE GUARANTEE FOR CONTRACT 2026-114
46A: Documents Required
    1. BENEFICIARY'S SIGNED STATEMENT THAT THE APPLICANT IS IN DEFAULT.
    2. COPY OF THE DEMAND SENT TO THE APPLICANT.`;

const examinar = (swift: string) => {
  const c = parseMT700(swift);
  if (!c) throw new Error("no se pudo leer el crédito");
  return examinarPresentacion({
    lc: c.lc,
    credito: contextoDesdeSwift(c),
    docs: [],
    certificados: [],
    anteriores: [],
    feriados: [],
    horario: null,
    cuotas: [],
    bicPropio: null,
    seguro: undefined,
    hoy: new Date("2026-06-01T12:00:00"),
    empresaRazonSocial: "",
    empresaDireccion: null,
  });
};

describe("reconocer un standby", () => {
  it("por la forma del crédito", () => {
    expect(esStandby({ formaCredito: "IRREVOCABLE STANDBY" })).toBe(true);
  });

  it("por el reglamento que nombra, aunque la forma no lo diga", () => {
    expect(esStandby({ formaCredito: "IRREVOCABLE", reglasAplicables: "ISP LATEST VERSION" })).toBe(true);
  });

  it("no confunde un crédito comercial corriente", () => {
    expect(esStandby({ formaCredito: "IRREVOCABLE", reglasAplicables: "UCP LATEST VERSION" })).toBe(false);
    expect(esStandby({})).toBe(false);
  });

  it("distingue el reglamento que el crédito nombra", () => {
    expect(reglamentoAjeno("ISP LATEST VERSION")).toBe("ISP98");
    expect(reglamentoAjeno("URDG LATEST VERSION")).toBe("URDG");
    expect(reglamentoAjeno("UCP LATEST VERSION")).toBeNull();
  });
});

describe("qué artículo no tiene a qué aplicarse", () => {
  it.each(["UCP 600 30b", "UCP 600 20a-ii", "UCP 600 27", "UCP 600 28e", "UCP 600 18c"])("%s queda afuera", (f) => {
    expect(noAplicaAStandby(f)).toBe(true);
  });

  it.each(["UCP 600 14c", "UCP 600 16d", "UCP 600 18a", "UCP 600 1", "47A", "46A+1"])("%s sigue corriendo", (f) => {
    expect(noAplicaAStandby(f)).toBe(false);
  });

  it("el 18 solo queda afuera en su inciso (c), que es la descripción de la mercadería", () => {
    /* El 18 (a) —factura a nombre del ordenante, emitida por el beneficiario, en la moneda del
       crédito— aplica igual a un standby que pida una factura. */
    expect(noAplicaAStandby("UCP 600 18c")).toBe(true);
    expect(noAplicaAStandby("UCP 600 18a-ii")).toBe(false);
  });
});

describe("el examen de un standby", () => {
  /*
   * El defecto que motivó el módulo, fijado para que no vuelva.
   *
   * Antes de esto el examen afirmaba «[OK] UCP 600 30b · Sin tolerancia en el crédito, la cantidad
   * admite ±5 %» sobre un crédito que garantiza un contrato de obra y no tiene cantidad alguna.
   * Decir «cumple» sobre algo que no existe es peor que no decir nada.
   */
  it("ya no afirma nada sobre la cantidad, que no existe", () => {
    const ex = examinar(STANDBY);
    expect(ex.reglas.filter((r) => /UCP 600 30/.test(r.fuente))).toEqual([]);
  });

  it("no aplica ninguna regla de transporte ni de seguro", () => {
    const ex = examinar(STANDBY);
    const carga = ex.reglas.filter((r) => noAplicaAStandby(r.fuente));
    expect(carga.map((r) => `${r.fuente} · ${r.regla}`)).toEqual([]);
  });

  it("sigue examinando lo que sí corresponde: los documentos que el crédito pide", () => {
    const ex = examinar(STANDBY);
    expect(ex.reglas.filter((r) => r.fuente.startsWith("46A")).length).toBe(2);
  });

  it("un crédito comercial no pierde ninguna regla", () => {
    /* El filtro no puede desactivar nada fuera de un standby: si se dispara de más, el examen
       comercial deja de mirar el transporte y nadie se entera. */
    const comercial = STANDBY.replace("IRREVOCABLE STANDBY", "IRREVOCABLE").replace(
      "ISP LATEST VERSION",
      "UCP LATEST VERSION",
    );
    const ex = examinar(comercial);
    expect(ex.reglas.some((r) => /UCP 600 30/.test(r.fuente))).toBe(true);
  });
});

describe("los límites que el examen declara", () => {
  it("dice que el crédito se rige por un reglamento que no implementamos", () => {
    const c = parseMT700(STANDBY)!;
    const l = limitesDelStandby(c.lc, "ISP LATEST VERSION");
    expect(l.map((x) => x.id)).toContain("sb-reglamento");
    expect(l.find((x) => x.id === "sb-reglamento")?.que).toContain("ISP98");
  });

  it("cuando el crédito sí nombra las UCP, dice que rigen solo en lo aplicable", () => {
    const c = parseMT700(STANDBY)!;
    const l = limitesDelStandby(c.lc, "UCP LATEST VERSION");
    expect(l.map((x) => x.id)).toContain("sb-ucp-en-lo-aplicable");
    expect(l.map((x) => x.id)).not.toContain("sb-reglamento");
  });

  it("avisa de los plazos atados a un embarque que no existe", () => {
    const c = parseMT700(STANDBY)!;
    expect(limitesDelStandby(c.lc, "ISP LATEST VERSION").map((x) => x.id)).toContain("sb-sin-embarque");
  });

  it("ningún límite se parece a un hallazgo: no llevan estado ni son discrepancias", () => {
    const c = parseMT700(STANDBY)!;
    for (const l of limitesDelStandby(c.lc, "ISP LATEST VERSION")) {
      expect(Object.keys(l).sort()).toEqual(["fuente", "id", "porQue", "que"]);
    }
  });
});
