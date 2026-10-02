import { parseNumero } from "./consistencia";

/**
 * La calidad que el crédito exige, contra la que el análisis certifica.
 *
 * El campo 45A no describe solo qué mercadería es: muchas veces fija su especificación.
 * El crédito del caso dice «FISH MEAL 54PCT MIN» y el certificado de análisis responde
 * «PROTEIN 61,1%». Nadie estaba comparando esos dos números.
 *
 * La comparación es sencilla cuando se entiende la forma: un parámetro, un operador y un
 * valor. Lo que no es sencillo es no equivocarse con el operador — un mínimo incumplido y
 * un máximo incumplido son discrepancias opuestas, y confundirlos sería peor que no mirar.
 */

export type Operador = "MIN" | "MAX" | "EXACTO";

export interface Especificacion {
  /** qué se mide: proteína, humedad, grasa… o vacío si el crédito no lo nombra */
  parametro: string;
  operador: Operador;
  valor: number;
  unidad: string;
  /** el texto del que salió */
  texto: string;
}

/** Los parámetros que aparecen escritos con nombre en los créditos de alimentos y granos. */
const PARAMETROS =
  /\b(protein|proteina|prote[ií]na|moisture|humedad|fat|grasa|ash|ceniza|fiber|fibre|fibra|salt|sal|ffa|acidity|acidez|tvbn|purity|pureza|broken|damaged)\b/i;

const normalizarUnidad = (u: string): string => {
  const t = u.toLowerCase().replace(/\s+/g, "");
  if (t === "pct" || t === "percent" || t === "%") return "%";
  if (t === "mg/kg") return "ppm";
  return t;
};

/**
 * Las especificaciones que declara un texto.
 *
 * Reconoce las formas en que se escriben de verdad: «54 PCT MIN», «MIN 54%»,
 * «PROTEIN 54 PCT MINIMUM», «MAX 12% MOISTURE», «PROTEIN: 61,1%».
 */
export function especificacionesDe(texto: string): Especificacion[] {
  if (!texto) return [];
  const out: Especificacion[] = [];
  const visto = new Set<string>();

  // el número con su unidad, y alrededor el parámetro y el operador
  const re = new RegExp(
    // el parámetro no puede ser el operador: sin este freno, «MIN 54%» leía «MIN» como
    // el nombre del parámetro y perdía el operador, que es lo único que no se puede errar
    String.raw`((?!(?:min|max|m[ií]n|m[áa]x)(?:imum|imo)?\b)[A-Za-zÁÉÍÓÚáéíóúñ]{3,12}\s*:?\s*)?` +
      String.raw`(min(?:imum)?|max(?:imum)?|m[ií]n(?:imo)?|m[áa]x(?:imo)?|not less than|no menos de)?\s*` +
      String.raw`(\d+(?:[.,]\d+)?)\s*` +
      String.raw`(pct|percent|%|ppm|mg\s*\/\s*kg|g\s*\/\s*kg)\s*` +
      "(min(?:imum)?|max(?:imum)?|m[ií]n(?:imo)?|m[áa]x(?:imo)?)?",
    "gi",
  );

  for (const m of texto.matchAll(re)) {
    const antes = (m[1] ?? "").trim().replace(/:$/, "");
    const opAntes = m[2] ?? "";
    const valor = parseNumero(m[3] ?? "");
    const unidad = normalizarUnidad(m[4] ?? "");
    const opDespues = m[5] ?? "";
    if (valor === null) continue;

    const op = `${opAntes} ${opDespues}`.toLowerCase();
    const operador: Operador = /max|máx/.test(op) ? "MAX" : /min|mín|not less|no menos/.test(op) ? "MIN" : "EXACTO";

    // el parámetro puede venir antes del número o después de la unidad
    const despues = texto.slice(m.index + m[0].length, m.index + m[0].length + 24);
    const nombrado = PARAMETROS.exec(antes)?.[0] ?? PARAMETROS.exec(despues)?.[0] ?? "";
    const parametro = nombrado.toLowerCase();

    const clave = `${parametro}|${operador}|${valor}|${unidad}`;
    if (visto.has(clave)) continue;
    visto.add(clave);

    out.push({ parametro, operador, valor, unidad, texto: m[0].trim() });
  }
  return out;
}

export type VeredictoSpec = "CUMPLE" | "NO_CUMPLE" | "SIN_COMPARAR";

export interface CotejoSpec {
  exigida: Especificacion;
  /** lo que el certificado declaró para ese mismo parámetro */
  medida: Especificacion | null;
  veredicto: VeredictoSpec;
  detalle: string;
}

const fmt = (n: number) => n.toLocaleString("es-UY", { maximumFractionDigits: 2 });

/**
 * Cada especificación del crédito contra lo que el análisis midió.
 *
 * Solo se comparan las que se pueden aparear: mismo parámetro y misma unidad. Una
 * especificación sin resultado equivalente queda como no comparada, nunca como cumplida.
 */
/**
 * «(protein)», o nada cuando el crédito no nombra el parámetro.
 *
 * Entre paréntesis y no con preposición: el parámetro viene del papel y no se traduce, y así la
 * frase entera se traduce de una sola pieza en vez de quedar «at least 10 % de moisture».
 */
function deParametro(ex: Especificacion): string {
  return ex.parametro ? ` (${ex.parametro})` : "";
}

export function cotejarEspecificaciones(delCredito: string, delCertificado: string): CotejoSpec[] {
  const exigidas = especificacionesDe(delCredito);
  const medidas = especificacionesDe(delCertificado);

  return exigidas.flatMap((ex): CotejoSpec[] => {
    /*
     * Se aparea por parámetro; si el crédito no lo nombra, por unidad, que es lo que suele pasar
     * con «FISH MEAL 54 PCT MIN»: el porcentaje es la proteína.
     *
     * Y entre dos candidatos gana el que no tiene operador, porque un resultado medido se escribe
     * sin él («PROTEIN 61,1%») mientras una exigencia lo lleva («54 PCT MIN»), y los certificados
     * suelen imprimir la exigencia del crédito antes de dar el resultado.
     */
    const resultados = medidas.filter((m) => m.operador === "EXACTO");
    const donde = resultados.length > 0 ? resultados : medidas;
    const medida =
      donde.find((m) => m.parametro && m.parametro === ex.parametro) ??
      (ex.parametro === "" ? (donde.find((m) => m.unidad === ex.unidad) ?? null) : null);

    /*
     * Un número suelto en el nombre de un producto no es una exigencia.
     *
     * «SOY BEAN MEAL HYPRO 48%» nombra el 48 sin decir si es mínimo, máximo o nominal. Si el
     * certificado no declara nada comparable, no se dice nada: inventar una exigencia a partir del
     * nombre comercial del producto sería peor que callarse.
     */
    if (!medida) {
      if (ex.operador === "EXACTO" && !ex.parametro) return [];
      return [
        {
          exigida: ex,
          medida: null,
          veredicto: "SIN_COMPARAR" as const,
          detalle: `el crédito pide «${ex.texto}» y no se leyó un resultado equivalente en el certificado`,
        },
      ];
    }

    /*
     * El candidato elegido lleva operador: es la exigencia repetida, no un resultado.
     *
     * Pasa cuando el certificado imprime el renglón del crédito y **no** declara el valor medido.
     * Antes se comparaba la exigencia contra sí misma y salía CUMPLE —«el crédito pide al menos
     * 54 % y el certificado declara 54 %»—, que es afirmar lo que el papel no dice. Acá el
     * silencio no se cuenta como conforme.
     */
    if (medida.operador !== "EXACTO") {
      return [
        {
          exigida: ex,
          medida,
          veredicto: "SIN_COMPARAR" as const,
          detalle: `el certificado repite la exigencia «${medida.texto}» pero no se leyó el resultado medido: verificar a mano cuánto declara`,
        },
      ];
    }

    /*
     * Un valor que el crédito nombra sin decir si es mínimo o máximo.
     *
     * Ni discrepancia ni conforme: si el certificado declara otro número, sale a verificar. Vale
     * igual cuando el crédito nombra el parámetro —«MOISTURE 10 PCT»—: nombrarlo hace el apareo
     * más preciso, no convierte un nominal en una igualdad exigida. Tratarlo como exacta rechazaba
     * un certificado que declaraba 9,999 %, y una presentación conforme rechazada es el error más
     * caro que este motor puede cometer.
     */
    if (ex.operador === "EXACTO") {
      const igual = Math.abs(medida.valor - ex.valor) < 1e-9;
      // sin interpolar dentro de la interpolación: el test de cobertura de traducción saca los
      // literales del fuente y un template anidado le llega partido
      const nombra = `el crédito nombra ${fmt(ex.valor)} ${ex.unidad}${deParametro(ex)}`;
      const declara = `${fmt(medida.valor)} ${medida.unidad}`;
      return [
        {
          exigida: ex,
          medida,
          veredicto: igual ? ("CUMPLE" as const) : ("SIN_COMPARAR" as const),
          detalle: igual
            ? `${nombra} y el certificado declara lo mismo`
            : `${nombra} y el certificado declara ${declara}; el crédito no dice si es mínimo, máximo o nominal, así que hay que verificarlo contra el contrato`,
        },
      ];
    }

    // con operador, el veredicto es tajante: un mínimo y un máximo incumplidos son discrepancias
    // opuestas, y confundirlos sería peor que no mirar
    const cumple = ex.operador === "MIN" ? medida.valor + 1e-9 >= ex.valor : medida.valor <= ex.valor + 1e-9;
    const comoDebe = ex.operador === "MIN" ? "al menos" : "como mucho";
    const pedido = `${fmt(ex.valor)} ${ex.unidad}${deParametro(ex)}`;
    return [
      {
        exigida: ex,
        medida,
        veredicto: cumple ? ("CUMPLE" as const) : ("NO_CUMPLE" as const),
        detalle: `el crédito pide ${comoDebe} ${pedido} y el certificado declara ${fmt(medida.valor)} ${medida.unidad}`,
      },
    ];
  });
}

/**
 * ¿Este archivo parece traer más de un documento?
 *
 * Pasa de verdad: en el expediente real, el certificado de análisis y el de fumigación
 * viajan en un mismo archivo, uno detrás del otro. Si se lee como si fuera uno solo, los
 * campos de los dos se mezclan y el examen compara cualquier cosa.
 */
export function pareceVariosDocumentos(texto: string): string[] {
  const titulos = [
    ...texto.matchAll(
      /^[^\S\n]*((?:[A-Z][A-Z\s/'()-]{6,60})?(?:CERTIFICATE|LIST|NOTE|INVOICE|DECLARATION|BILL OF LADING)(?:[A-Z\s/'()-]{0,40})?)[^\S\n]*$/gm,
    ),
  ]
    .map((m) => m[1]!.trim().replace(/\s+/g, " "))
    .filter((t) => t.length > 8);

  const unicos: string[] = [];
  for (const t of titulos) if (!unicos.includes(t)) unicos.push(t);
  return unicos.length > 1 ? unicos : [];
}
