import { describe, expect, it } from "vitest";
import { cuandoEmbarque, diffDias, fmtFecha, ordenEmbarque, parseFecha } from "./fechas";

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
