import { describe, expect, it } from "vitest";
import { cotejarEspecificaciones, especificacionesDe, pareceVariosDocumentos } from "./especificaciones";
import { SWIFT_CSU2025099 } from "./fixtures";
import { parseMT700 } from "./swift-lc";

/* Del expediente de referencia: el crédito dice «57 MTS OF FISH MEAL 54PCT MIN» y el certificado
   de análisis de Caliset declara «PROTEIN 61,1%». */
const MERCADERIA_DEL_CREDITO = parseMT700(SWIFT_CSU2025099)!.campos.mercaderia.valor;
const CERTIFICADO_REAL = `CERTIFICATE OF ANALYSIS
DESCRIPTION OF GOODS: 53,96 MT OF FISH MEAL 54 PCT MIN (FOR ANIMAL FEED USE)
SPECIFICATIONS: THE INSPECT RESULT OF: PROTEIN 61,1%
We also certify not contain salmonella.
ANTI-OXIDANT TREATED: BUTILHIDROXITOLUENO (BTH): 700 ppm
CALISET S.A. BY AN INDEPENDENT SURVEYOR`;

/*
 * El 45A de un crédito real de harina de carne y hueso: once especificaciones, y el motor
 * conocía la mitad.
 *
 * Las que faltaban —CALCIUM, DIGESTIBILITY, PHOSPHORUS, TVN, ACID VALUE— salían como «la
 * especificación que el crédito exige», sin nombre, y DIGESTIBILITY encima mutilada a
 * «IGESTIBILITY» porque el nombre se capturaba con {3,12} y tiene trece letras. Un examen que no
 * puede nombrar lo que exige no se puede discutir con el banco.
 */
describe("las especificaciones del 45A de harina de carne (caso real)", () => {
  const CUARENTA_Y_CINCO_A =
    "2.SPECIFICATION: PROTEIN: MIN 45% FAT: MAX 12% ASH: MAX 37% CALCIUM: MIN 8% " +
    "DIGESTIBILITY: MIN 85% MOISTURE: MAX 10% FIBER: MAX 3% PHOSPHORUS: MIN 4% " +
    "TVN: MAX 50MG/100G SALMONELLA FREE ACID VALUE: MAX 5MGKOH/G";

  it("las nombra a todas, y DIGESTIBILITY entera", () => {
    const e = especificacionesDe(CUARENTA_Y_CINCO_A);
    const nombres = e.map((x) => x.parametro);
    for (const n of ["protein", "fat", "ash", "calcium", "digestibility", "moisture", "fiber", "phosphorus"]) {
      expect(nombres, `falta «${n}»: el examen no puede nombrar lo que exige`).toContain(n);
    }
    /* Como nombre EXACTO, no como substring: «digestibility» contiene «igestibility» y un
       `toMatch` daba rojo sobre el valor correcto. */
    expect(nombres, "«IGESTIBILITY» es el nombre comido por el límite de 12 letras").not.toContain("igestibility");
  });

  it("y con el operador correcto, que es lo que invierte el veredicto", () => {
    const e = especificacionesDe(CUARENTA_Y_CINCO_A);
    const de = (n: string) => e.find((x) => x.parametro === n);
    expect(de("calcium")).toMatchObject({ operador: "MIN", valor: 8 });
    expect(de("digestibility")).toMatchObject({ operador: "MIN", valor: 85 });
    expect(de("phosphorus")).toMatchObject({ operador: "MIN", valor: 4 });
    expect(de("fat")).toMatchObject({ operador: "MAX", valor: 12 });
  });
});

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
  it("el del caso de referencia trae el análisis y la fumigación juntos", () => {
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

describe("un análisis con varios parámetros, que es como vienen de verdad", () => {
  /*
   * Un certificado de análisis de harina de pescado declara proteína, humedad, grasa y cenizas en
   * una lista. El 45A real —«57 MTS OF FISH MEAL 54PCT MIN»— no nombra el parámetro, así que el
   * cotejo apareaba «por unidad» y se quedaba con el **primer** porcentaje de la lista. Si el
   * análisis imprime la humedad antes que la proteína, el 54 % mínimo se comparaba contra 9,5 % y
   * un análisis que cumple de sobra —61,1 % de proteína— salía discrepante.
   */
  it("no elige el primero: avisa que no puede decidir contra cuál comparar", () => {
    const [c] = cotejarEspecificaciones(
      "57 MTS OF FISH MEAL 54PCT MIN",
      "FISH MEAL. MOISTURE 9,5 % - PROTEIN 61,1 % - FAT 8,2 %",
    );
    expect(c?.veredicto).toBe("SIN_COMPARAR");
    expect(c?.detalle).toMatch(/cuál|varios|más de un/i);
  });

  it("con un solo resultado en la unidad, sigue comparando", () => {
    // El caso del expediente: el análisis declara la proteína y nada más.
    const [c] = cotejarEspecificaciones("57 MTS OF FISH MEAL 54PCT MIN", "FISH MEAL, PROTEIN 61,1 PCT");
    expect(c?.veredicto).toBe("CUMPLE");
  });

  it("y cuando el crédito nombra el parámetro, la lista entera no estorba", () => {
    const r = cotejarEspecificaciones(
      "FISH MEAL, PROTEIN 54 PCT MIN, MOISTURE 10 PCT MAX",
      "MOISTURE 9,5 % - PROTEIN 61,1 % - FAT 8,2 %",
    );
    expect(r.find((x) => x.exigida.parametro === "protein")?.veredicto).toBe("CUMPLE");
    expect(r.find((x) => x.exigida.parametro === "moisture")?.veredicto).toBe("CUMPLE");
  });

  it("el nombre del parámetro sale de lo que está antes del número, no de lo que sigue", () => {
    /*
     * «CRUDE PROTEIN (N x 6,25): 61,1 %» es la forma en que los laboratorios escriben la proteína.
     * El paréntesis separaba el nombre del número, así que el parámetro se tomaba del texto
     * siguiente y el 61,1 % quedaba etiquetado como **humedad**.
     */
    const e = especificacionesDe("CRUDE PROTEIN (N x 6,25): 61,1 %  MOISTURE: 9,5 %");
    expect(e.find((x) => x.valor === 61.1)?.parametro).toBe("protein");
    expect(e.find((x) => x.valor === 9.5)?.parametro).toBe("moisture");
  });

  it("pero el parámetro escrito después de la unidad se sigue leyendo", () => {
    // «MAX 12% MOISTURE» es igual de corriente, y ahí el nombre va detrás.
    expect(especificacionesDe("MAX 12% MOISTURE")[0]).toMatchObject({ parametro: "moisture", operador: "MAX" });
  });
});

describe("el operador escrito con punto", () => {
  /*
   * «MIN.» y «MAX.» con punto son abreviaturas corrientes, y el operador no se capturaba. Las dos
   * mitades fallaban en direcciones opuestas: un certificado que solo repetía «PROTEIN MIN. 54 %»
   * daba CUMPLE —el defecto de comparar la exigencia contra sí misma, resucitado por un punto— y un
   * crédito «MOISTURE MAX. 10 PCT» contra 12 % daba a verificar en vez de discrepancia.
   */
  it("«MIN. 54 %» es un mínimo", () => {
    expect(especificacionesDe("PROTEIN MIN. 54 %")[0]).toMatchObject({ operador: "MIN", parametro: "protein" });
  });

  it("«MAX. 10 PCT» es un máximo, y 12 % no lo cumple", () => {
    const [c] = cotejarEspecificaciones("FISH MEAL MOISTURE MAX. 10 PCT", "MOISTURE 12 %");
    expect(c?.veredicto).toBe("NO_CUMPLE");
  });

  it("y el certificado que solo repite «MIN. 54 %» no cumple nada", () => {
    const [c] = cotejarEspecificaciones("FISH MEAL 54 PCT MIN", "PROTEIN MIN. 54 %");
    expect(c?.veredicto).toBe("SIN_COMPARAR");
  });
});

describe("un porcentaje en el 45A no es siempre una exigencia de calidad", () => {
  /*
   * Los dos falsos positivos que esta regla producía sobre el crédito real.
   *
   * El 45A no habla solo de calidad: en el mismo campo van la tolerancia de cantidad y de importe,
   * y van escritas en por ciento. El motor las leía como una especificación más —«como mucho 5 %»—
   * y después las comparaba contra el único porcentaje del análisis, que es la proteína. Un
   * certificado que declara 61,1 % de proteína salía discrepante por no cumplir una tolerancia de
   * embarque. Peor todavía: salía discrepante **y** conforme a la vez, porque la proteína también
   * se comparaba bien contra el 54 PCT MIN.
   */
  const CON_TOLERANCIA = "57 MTS OF FISH MEAL 54 PCT MIN\nTOLERANCE MAX 5 PCT IN QUANTITY AND AMOUNT";

  it("la tolerancia de cantidad e importe no se lee como una especificación", () => {
    expect(especificacionesDe(CON_TOLERANCIA).map((e) => e.valor)).toEqual([54]);
  });

  it("y un análisis conforme no sale discrepante por la tolerancia del embarque", () => {
    const c = cotejarEspecificaciones(CON_TOLERANCIA, "CRUDE PROTEIN: 61,1 %");
    expect(c.map((x) => x.veredicto)).toEqual(["CUMPLE"]);
  });

  it("«5 PCT MORE OR LESS» tampoco, aunque la pista venga después del número", () => {
    expect(especificacionesDe("QUANTITY 5 PCT MORE OR LESS ALLOWED")).toEqual([]);
  });

  it("pero una coma corta la ventana: la proteína sobrevive a la cantidad que viene detrás", () => {
    // el freno no puede comerse lo que sí es calidad, o el módulo deja de mirar lo que vino a mirar
    const e = especificacionesDe("PROTEIN 54 PCT MIN, QUANTITY 57 MTS");
    expect(e.map((x) => x.valor)).toEqual([54]);
  });

  /*
   * Y el apareo por unidad, cuando el crédito no dice de qué es el porcentaje.
   *
   * «57 MTS OF FISH MEAL 54PCT MIN» no nombra el parámetro: cuando el análisis declara un solo
   * porcentaje, el motor asume que es ese. Si ese único resultado es la humedad, la cuenta sale
   * 9,5 contra un mínimo de 54 y el certificado sale discrepante. Nadie exige un mínimo de
   * humedad —se exige un máximo— así que el apareo estaba mal, no el certificado.
   */
  it("un mínimo sin nombre no se compara contra la humedad, que se exige al revés", () => {
    const [c] = cotejarEspecificaciones("57 MTS OF FISH MEAL 54 PCT MIN", "MOISTURE: 9,5 %");
    expect(c?.veredicto).toBe("SIN_COMPARAR");
  });

  it("y un máximo sin nombre tampoco se compara contra la proteína", () => {
    const [c] = cotejarEspecificaciones("FISH MEAL MAX 10 PCT", "CRUDE PROTEIN: 61,1 %");
    expect(c?.veredicto).toBe("SIN_COMPARAR");
  });

  it("pero el caso de referencia sigue comparándose: un mínimo sin nombre contra la proteína", () => {
    const [c] = cotejarEspecificaciones("57 MTS OF FISH MEAL 54 PCT MIN", "CRUDE PROTEIN: 61,1 %");
    expect(c?.veredicto).toBe("CUMPLE");
  });
});

describe("el freno de la tolerancia no puede comerse la calidad", () => {
  /*
   * El arreglo de la mañana estuvo demasiado ancho y produjo algo peor que lo que arregló.
   *
   * La lista traía «about», «quantity», «shipment», «value», «amount» —palabras que el artículo 30
   * usa y que están en casi cualquier 45A— y la ventana era de cuarenta caracteres. Con eso,
   * «ABOUT 57 MTS OF FISH MEAL 54 PCT MIN» perdía la exigencia de proteína **entera**: no quedaba
   * ni discrepancia ni «a verificar», quedaba nada. Un análisis de 50 % contra un mínimo de 54
   * pasaba en silencio total, con la cara de un examen normal.
   *
   * Un falso positivo rechaza algo conforme y alguien lo discute. Esto deja pasar algo que no lo
   * es, y nadie lo mira nunca.
   */
  it.each([
    ["ABOUT 57 MTS OF FISH MEAL 54 PCT MIN", "CRUDE PROTEIN: 50,0 %"],
    ["QUANTITY: 57 MTS FISH MEAL 54 PCT MIN", "CRUDE PROTEIN: 50,0 %"],
    ["57 MTS OF FISH MEAL 54 PCT MIN SHIPMENT FROM MONTEVIDEO", "CRUDE PROTEIN: 50,0 %"],
    ["FISH MEAL 54 PCT MIN CFR COLOMBO TOTAL VALUE USD 71250", "CRUDE PROTEIN: 50,0 %"],
    // el mínimo de este es 46, así que el análisis que no lo cumple es otro
    ["APPROXIMATELY 500 MT SOYBEAN MEAL 46 PCT MIN", "CRUDE PROTEIN: 44,0 %"],
  ])("«%s» sigue exigiendo su mínimo", (credito, analisis) => {
    const [c] = cotejarEspecificaciones(credito, analisis);
    expect(c?.veredicto, "la exigencia de calidad desapareció").toBe("NO_CUMPLE");
  });

  it("y la tolerancia de verdad se sigue descartando", () => {
    // lo que el arreglo vino a hacer, que no se puede perder al estrecharlo
    const con = "57 MTS OF FISH MEAL 54 PCT MIN\nTOLERANCE MAX 5 PCT IN QUANTITY AND AMOUNT";
    expect(cotejarEspecificaciones(con, "CRUDE PROTEIN: 61,1 %").map((x) => x.veredicto)).toEqual(["CUMPLE"]);
    expect(especificacionesDe("QUANTITY 5 PCT MORE OR LESS ALLOWED")).toEqual([]);
  });
});

describe("la grasa se exige en los dos sentidos, según la mercadería", () => {
  /*
   * La lista de «se pide como techo» salió de harina de pescado, donde la grasa es lo que se tolera.
   * En leche en polvo entera es al revés: la grasa es lo que se compra, y «26 PCT MIN» con un
   * análisis de 26,5 % cumple. Salía a verificar a mano.
   *
   * No hay forma de saberlo del número: lo dice la mercadería, que el crédito nombra en el mismo
   * 45A. Así que la dirección de la grasa se decide ahí, y lo que no se reconoce sigue yendo al
   * lado seguro.
   */
  it("en leche en polvo entera, un mínimo de grasa se compara", () => {
    const [c] = cotejarEspecificaciones("WHOLE MILK POWDER 26 PCT MIN", "FAT: 26,5 %");
    expect(c?.veredicto).toBe("CUMPLE");
  });

  it("y en harina de pescado sigue siendo un techo", () => {
    const [c] = cotejarEspecificaciones("57 MTS OF FISH MEAL 54 PCT MIN", "FAT: 9,5 %");
    expect(c?.veredicto, "comparó la proteína contra la grasa").toBe("SIN_COMPARAR");
  });
});
