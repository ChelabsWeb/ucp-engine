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

describe("un porcentaje que el crédito nombra sin decir si es mínimo o máximo", () => {
  /**
   * Sale de los productos que el trader vende de verdad: «SOY BEAN MEAL HYPRO 48%». El 48 es la
   * especificación del producto, pero el crédito no dice «MIN» ni «MAX», así que el motor lo
   * descartaba y no comparaba nada. Un análisis que declara 47,2 % pasaba en silencio.
   *
   * No se puede marcar como discrepancia —nadie sabe si ese 48 es un mínimo, un valor nominal o
   * parte del nombre comercial— pero callarse tampoco corresponde: el silencio no se cuenta como
   * conforme.
   */
  it("**si el certificado declara otro número, sale a verificar**", () => {
    const r = cotejarEspecificaciones("57 MTS OF SOY BEAN MEAL HYPRO 48%", "PROTEIN 47,2%");
    expect(r).toHaveLength(1);
    expect(r[0]!.veredicto).toBe("SIN_COMPARAR");
    expect(r[0]!.detalle).toContain("48");
    expect(r[0]!.detalle).toContain("47,2");
    // Y dice por qué no se puede concluir: el crédito no fijó un operador.
    expect(r[0]!.detalle).toMatch(/mínimo|máximo|nominal/i);
  });

  it("si coinciden, cumple y no molesta a nadie", () => {
    const r = cotejarEspecificaciones("57 MTS OF SOY BEAN MEAL HYPRO 48%", "PROTEIN 48%");
    expect(r).toHaveLength(1);
    expect(r[0]!.veredicto).toBe("CUMPLE");
  });

  it("sin un resultado comparable en el certificado, no inventa un hallazgo", () => {
    // El crédito nombra un porcentaje y el análisis no da ninguno: no hay nada que decir.
    expect(cotejarEspecificaciones("57 MTS OF SOY BEAN MEAL HYPRO 48%", "GOODS IN GOOD CONDITION")).toEqual([]);
  });

  it("un número que es parte del nombre del corte no se toma por especificación", () => {
    // Productos reales del trader: los paréntesis con grados y los cortes numerados no llevan unidad.
    for (const producto of [
      "BONELESS THIN SKIRT WAGYU (BMS 6-7)",
      "WAGYU PEELED OUTSIDE SKIRT (BMS 4-5)",
      "HQB BEEF - 17 CUTS",
    ]) {
      expect(cotejarEspecificaciones(producto, "PROTEIN 20%")).toEqual([]);
    }
  });

  it("lo que ya funcionaba sigue igual: con MIN se compara y se concluye", () => {
    const r = cotejarEspecificaciones("57 MTS OF FISH MEAL 54PCT MIN", "PROTEIN 61,1%");
    expect(r[0]!.veredicto).toBe("CUMPLE");
    const malo = cotejarEspecificaciones("57 MTS OF FISH MEAL 54PCT MIN", "PROTEIN 49,0%");
    expect(malo[0]!.veredicto).toBe("NO_CUMPLE");
  });
});

describe("un certificado que solo repite la exigencia del crédito", () => {
  /*
   * Lo peor que puede hacer este módulo: decir que cumple algo que el papel no afirma.
   *
   * Los certificados suelen imprimir la exigencia del crédito antes de dar el resultado —el propio
   * código lo dice y por eso prefiere el candidato sin operador—. Pero cuando el certificado
   * **solo** la repite y no declara ningún resultado medido, el motor comparaba la exigencia
   * contra sí misma y daba CUMPLE: «el crédito pide al menos 54 % y el certificado declara 54 %».
   *
   * No declara 54: copió el renglón del crédito. Pagar contra eso es pagar contra un certificado
   * que no dice nada, y acá el silencio no se cuenta como conforme.
   */
  it("no dice que cumple: manda a verificar", () => {
    const [c] = cotejarEspecificaciones("FISH MEAL 54 PCT MIN", "FISH MEAL 54 PCT MIN");
    expect(c?.veredicto).toBe("SIN_COMPARAR");
    expect(c?.detalle).toMatch(/repite|no declara|resultado/i);
  });

  it("y con el resultado al lado, lo usa y no se confunde", () => {
    // Es el caso normal: el certificado imprime la exigencia y debajo el resultado medido.
    const [c] = cotejarEspecificaciones("FISH MEAL 54 PCT MIN", "PROTEIN 54 PCT MIN — RESULT: PROTEIN 61,1 PCT");
    expect(c?.veredicto).toBe("CUMPLE");
    expect(c?.detalle).toMatch(/61,1|61\.1/);
  });

  it("un mínimo incumplido sigue siendo discrepancia", () => {
    // El arreglo no puede volverse una excusa para no concluir nunca.
    const [c] = cotejarEspecificaciones("FISH MEAL 54 PCT MIN", "PROTEIN 47,2 PCT");
    expect(c?.veredicto).toBe("NO_CUMPLE");
  });
});

describe("un nominal sin operador, también cuando el crédito nombra el parámetro", () => {
  /*
   * La rama de «sin operador no se concluye» existía solo para el número suelto en el nombre del
   * producto («SOY BEAN MEAL HYPRO 48%»). Si el crédito nombraba el parámetro —«MOISTURE 10 PCT»—
   * el mismo número sin operador se trataba como igualdad exacta, y un certificado que declaraba
   * 9,999 % salía DISCREPANCIA.
   *
   * Nombrar el parámetro hace el apareo más preciso; no convierte un nominal en un máximo. Y una
   * presentación conforme rechazada es el error más caro que este motor puede cometer.
   */
  it("no discrepa: manda a verificar contra el contrato", () => {
    const [c] = cotejarEspecificaciones("MOISTURE 10 PCT", "MOISTURE 9,999 PCT");
    expect(c?.veredicto).toBe("SIN_COMPARAR");
    expect(c?.detalle).toMatch(/mínimo|máximo|nominal|verificar/i);
  });

  it("si coincide, cumple", () => {
    const [c] = cotejarEspecificaciones("PROTEIN 54 PCT", "PROTEIN 54,0 PCT");
    expect(c?.veredicto).toBe("CUMPLE");
  });

  it("con operador, el veredicto sigue siendo tajante", () => {
    expect(cotejarEspecificaciones("MOISTURE 10 PCT MAX", "MOISTURE 12 PCT")[0]?.veredicto).toBe("NO_CUMPLE");
    expect(cotejarEspecificaciones("MOISTURE 10 PCT MAX", "MOISTURE 8 PCT")[0]?.veredicto).toBe("CUMPLE");
  });
});
