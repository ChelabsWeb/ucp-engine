import { describe, expect, it } from "vitest";
import { cuandoEmbarque, diffDias, fmtFecha, fmtFechaEn, ordenEmbarque, parseFecha } from "./fechas";

describe("parseFecha", () => {
  it("parsea el formato del dominio dd-mmm-yy (es-UY)", () => {
    expect(parseFecha("15-ago-26")).toEqual(new Date(2026, 7, 15));
  });

  it("caso CSU2025099: las fechas como vienen en los documentos reales", () => {
    expect(parseFecha("08-APR-2025")).toEqual(new Date(2025, 3, 8)); // BL
    expect(parseFecha("08/04/25")).toEqual(new Date(2025, 3, 8)); // factura DGI
    expect(parseFecha("08/04/2025")).toEqual(new Date(2025, 3, 8)); // packing
    expect(parseFecha("21/12/2024")).toEqual(new Date(2024, 11, 21));
    expect(parseFecha("April 08th, 2025")).toEqual(new Date(2025, 3, 8)); // certificados
    expect(parseFecha("16 ABR 2025")).toEqual(new Date(2025, 3, 16)); // certificado de origen
    expect(parseFecha("2025-04-08")).toEqual(new Date(2025, 3, 8)); // ISO
    expect(parseFecha("04.03.2025")).toEqual(new Date(2025, 2, 4)); // "PROFORMA INVOICE NO. 2025099 DTD 04.03.2025"
    expect(parseFecha("April, 08th, 2025 (08/04/2025)")).toEqual(new Date(2025, 3, 8)); // como lo leyó la IA del packing real
    expect(parseFecha("08 APR 2025")).toEqual(new Date(2025, 3, 8)); // BL leído por la IA
    expect(parseFecha("31/02/2025")).toBeNull(); // fecha imposible
  });

  it('devuelve null ante fechas difusas de hitos ("+21 días", "~fin ago")', () => {
    expect(parseFecha("+21 días")).toBeNull();
    expect(parseFecha("~fin ago")).toBeNull();
    expect(parseFecha("")).toBeNull();
    expect(parseFecha("15-xxx-26")).toBeNull();
  });
});

describe("fmtFecha", () => {
  it("formatea al formato del dominio dd-mmm-yy", () => {
    expect(fmtFecha(new Date(2026, 8, 30))).toBe("30-sep-26");
    expect(fmtFecha(new Date(2026, 0, 5))).toBe("05-ene-26");
  });
});

describe("diffDias", () => {
  it("cuenta los días de a hasta b (positivo si b es después)", () => {
    expect(diffDias(new Date(2026, 6, 20), new Date(2026, 7, 15))).toBe(26);
    expect(diffDias(new Date(2026, 7, 18), new Date(2026, 7, 15))).toBe(-3);
    expect(diffDias(new Date(2026, 6, 20), new Date(2026, 6, 20))).toBe(0);
  });
});

describe("cuandoEmbarque", () => {
  const hoy = new Date(2026, 8, 10); // 10-sep-2026

  it("lo que se viene lo dice en días, y marca la semana", () => {
    expect(cuandoEmbarque("15-sep-26", hoy)).toEqual({ label: "en 5 días", clase: "es-pronto" });
    expect(cuandoEmbarque("30-sep-26", hoy)).toEqual({ label: "en 20 días", clase: "" });
  });

  it("hoy y mañana tienen nombre propio", () => {
    expect(cuandoEmbarque("10-sep-26", hoy)?.label).toBe("embarca hoy");
    expect(cuandoEmbarque("11-sep-26", hoy)?.label).toBe("embarca mañana");
  });

  /* la razón de existir de este helper: `vencimiento()` decía "vencido hace 90
     días" de un embarque que simplemente YA OCURRIÓ, y pintaba de rojo media
     pantalla con una urgencia que no existe */
  it("lo que ya pasó embarcó, no venció, y va en gris", () => {
    expect(cuandoEmbarque("18-ago-26", hoy)).toEqual({ label: "embarcó hace 23 días", clase: "es-pasado" });
    expect(cuandoEmbarque("09-sep-26", hoy)?.label).toBe("embarcó ayer");
  });

  it("una fecha que no se entiende no inventa nada", () => {
    expect(cuandoEmbarque("", hoy)).toBeNull();
  });
});

describe("ordenEmbarque", () => {
  const hoy = new Date(2026, 8, 10);
  const clave = (f: string | null) => ordenEmbarque(f, hoy);

  it("lo que se viene va primero, del más cercano al más lejano", () => {
    expect(clave("12-sep-26")).toBeLessThan(clave("30-sep-26"));
  });

  it("lo ya embarcado va DESPUÉS de todo lo que se viene", () => {
    expect(clave("18-ago-26")).toBeGreaterThan(clave("31-dic-26"));
  });

  it("entre lo pasado, lo más reciente primero", () => {
    expect(clave("18-ago-26")).toBeLessThan(clave("12-jun-26"));
  });

  it("sin fecha, al fondo", () => {
    expect(clave(null)).toBe(Number.MAX_SAFE_INTEGER);
    expect(clave(null)).toBeGreaterThan(clave("12-jun-26"));
  });
});

describe("el formato de los documentos que salen del banco", () => {
  /** Una fecha de calendario sin la trampa de la zona horaria. */
  const dia = (a: number, m: number, d: number) => new Date(a, m - 1, d);

  it("formatea en inglés: un aviso de rechazo en inglés no puede fechar «14-abr-25»", () => {
    expect(fmtFechaEn(dia(2025, 4, 14))).toBe("14-Apr-2025");
    expect(fmtFechaEn(dia(2026, 1, 3))).toBe("03-Jan-2026");
    expect(fmtFechaEn(dia(2025, 8, 31))).toBe("31-Aug-2025");
    expect(fmtFechaEn(dia(2025, 12, 1))).toBe("01-Dec-2025");
  });

  it("los cuatro meses que difieren del español son justo los que importan", () => {
    // feb, mar, may, jun, jul, sep, oct, nov se escriben igual en las dos lenguas; estos no.
    for (const [mes, es, en] of [
      [1, "ene", "Jan"],
      [4, "abr", "Apr"],
      [8, "ago", "Aug"],
      [12, "dic", "Dec"],
    ] as const) {
      expect(fmtFecha(dia(2025, mes, 15))).toContain(es);
      expect(fmtFechaEn(dia(2025, mes, 15))).toContain(en);
    }
  });

  it("el año va entero: un documento con plazos no se fecha con dos dígitos", () => {
    expect(fmtFechaEn(dia(2025, 6, 30))).toBe("30-Jun-2025");
    expect(fmtFecha(dia(2025, 6, 30))).toBe("30-jun-25");
  });
});

describe("una fecha con texto alrededor", () => {
  /**
   * Los documentos de verdad no traen la fecha sola: la traen como «place and date of issue». El
   * packing del expediente dice «Montevideo, April 08th, 2025» y el parser devolvía nulo, así que la
   * regla del 47A —fechado el día del crédito o después— quedaba en «sin fecha legible». El formato
   * ya estaba soportado; lo que faltaba era encontrarlo adentro de la línea.
   */
  it.each([
    ["Montevideo, April 08th, 2025", "2025-04-08"],
    ["Montevideo, 08 April 2025", "2025-04-08"],
    ["MONTEVIDEO 08 APR 2025", "2025-04-08"],
    ["Place and date of issue: Montevideo, 08 APR 2025", "2025-04-08"],
    ["Issued at Colombo on 30/06/2025", "2025-06-30"],
    ["SHIPPED ON BOARD 08-APR-2025 OCEANLINE Uruguay", "2025-04-08"],
  ])("lee la fecha de «%s»", (texto, esperado) => {
    const f = parseFecha(texto);
    expect(f).not.toBeNull();
    expect(
      `${f!.getFullYear()}-${String(f!.getMonth() + 1).padStart(2, "0")}-${String(f!.getDate()).padStart(2, "0")}`,
    ).toBe(esperado);
  });

  it("lo que ya andaba sigue andando", () => {
    expect(parseFecha("08/04/25")).not.toBeNull();
    expect(parseFecha("08-APR-2025")).not.toBeNull();
    expect(parseFecha("30-jun-25")).not.toBeNull();
  });

  it("y un texto sin fecha sigue devolviendo nulo", () => {
    // Que el parser busque adentro no puede volverlo crédulo: «21 días» o un número de documento
    // no son fechas.
    const nada = [
      "dentro de 21 días",
      "A 4401",
      "MVD0990117",
      "",
      "sin fecha",
      "HS CODE 2301.20.00",
      // Estos dos traen una fecha válida escondida adentro de un número que no es una fecha: la
      // referencia del expediente y un código arancelario con subpartida nacional.
      "REF MVD0990117.06.25",
      "HS CODE 2301.02.25",
    ];
    for (const t of nada) {
      expect(parseFecha(t), `«${t}» no es una fecha`).toBeNull();
    }
  });
});
