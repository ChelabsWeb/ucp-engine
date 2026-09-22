import { describe, expect, it } from "vitest";
import { cotejarEspecificaciones, especificacionesDe, pareceVariosDocumentos } from "./especificaciones";
import { SWIFT_CSU2025099 } from "./fixtures";
import { parseMT700 } from "./swift-lc";

/* Del expediente real: el crédito dice «57 MTS OF FISH MEAL 54PCT MIN» y el certificado
   de análisis de Caliset declara «PROTEIN 61,1%». */
const MERCADERIA_DEL_CREDITO = parseMT700(SWIFT_CSU2025099)!.campos.mercaderia.valor;
const CERTIFICADO_REAL = `CERTIFICATE OF ANALYSIS
DESCRIPTION OF GOODS: 53,96 MT OF FISH MEAL 54 PCT MIN (FOR ANIMAL FEED USE)
SPECIFICATIONS: THE INSPECT RESULT OF: PROTEIN 61,1%
We also certify not contain salmonella.
ANTI-OXIDANT TREATED: BUTILHIDROXITOLUENO (BTH): 700 ppm
CALISET S.A. BY AN INDEPENDENT SURVEYOR`;

describe("leer una especificación", () => {
  it("«54PCT MIN», como lo escribe el crédito real", () => {
    const e = especificacionesDe("57 MTS OF FISH MEAL 54PCT MIN (FOR ANIMAL FEED USE)");
    expect(e[0]).toMatchObject({ operador: "MIN", valor: 54, unidad: "%" });
  });

  it("con el operador adelante: «MIN 54%»", () => {
    expect(especificacionesDe("MIN 54% PROTEIN")[0]).toMatchObject({ operador: "MIN", valor: 54 });
  });

  it("un máximo, que es lo contrario y no hay que confundir", () => {
    const e = especificacionesDe("MAX 12% MOISTURE");
    expect(e[0]).toMatchObject({ operador: "MAX", valor: 12, parametro: "moisture" });
  });

  it("el parámetro nombrado antes del número", () => {
    expect(especificacionesDe("PROTEIN 61,1%")[0]).toMatchObject({ parametro: "protein", valor: 61.1 });
  });

  it("partes por millón, como el antioxidante del certificado real", () => {
    const e = especificacionesDe("BUTILHIDROXITOLUENO (BTH): 700 ppm");
    expect(e[0]).toMatchObject({ valor: 700, unidad: "ppm" });
  });

  it("un texto sin especificaciones no inventa ninguna", () => {
    expect(especificacionesDe("FISH MEAL FOR ANIMAL FEED USE")).toEqual([]);
  });
});

describe("el crédito contra el certificado, con los papeles reales", () => {
  const r = cotejarEspecificaciones(MERCADERIA_DEL_CREDITO, CERTIFICADO_REAL);

  it("el crédito del caso exige un mínimo de 54 por ciento", () => {
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.exigida).toMatchObject({ operador: "MIN", valor: 54 });
  });

  it("y el análisis declara 61,1: cumple", () => {
    expect(r[0]!.veredicto).toBe("CUMPLE");
    expect(r[0]!.detalle).toContain("61,1");
  });

  it("si el análisis hubiera dado menos, no cumpliría", () => {
    const flojo = cotejarEspecificaciones(MERCADERIA_DEL_CREDITO, "PROTEIN 48,2%");
    expect(flojo[0]!.veredicto).toBe("NO_CUMPLE");
    expect(flojo[0]!.detalle).toContain("al menos 54");
  });

  it("un máximo se juzga al revés: pasarse es lo que incumple", () => {
    const seco = cotejarEspecificaciones("MAX 12% MOISTURE", "MOISTURE 9%");
    expect(seco[0]!.veredicto).toBe("CUMPLE");
    const humedo = cotejarEspecificaciones("MAX 12% MOISTURE", "MOISTURE 14%");
    expect(humedo[0]!.veredicto).toBe("NO_CUMPLE");
  });

  it("sin un resultado equivalente queda sin comparar, nunca como cumplida", () => {
    const sinDato = cotejarEspecificaciones("MAX 12% MOISTURE", "PROTEIN 61,1%");
    expect(sinDato[0]!.veredicto).toBe("SIN_COMPARAR");
    expect(sinDato[0]!.detalle).toContain("no se leyó");
  });
});

describe("un archivo con más de un documento adentro", () => {
  it("el del caso real trae el análisis y la fumigación juntos", () => {
    const dos = `CERTIFICATE OF ANALYSIS
VESSEL: STELLA AUSTRAL
PROTEIN 61,1%

FUMIGATION CERTIFICATE
VESSEL: STELLA AUSTRAL
ALUMINIUM PHOSPHIDE 1 G/T`;
    const t = pareceVariosDocumentos(dos);
    expect(t).toHaveLength(2);
    expect(t[0]).toContain("ANALYSIS");
    expect(t[1]).toContain("FUMIGATION");
  });

  it("un archivo con un solo documento no dispara el aviso", () => {
    expect(pareceVariosDocumentos(CERTIFICADO_REAL)).toEqual([]);
  });
});
