/**
 * ISBP — la práctica bancaria internacional estándar, publicación 821 de la ICC (2023).
 *
 * Las UCP 600 dicen qué se examina; la ISBP dice cómo se examina en la práctica. Buena
 * parte de su contenido no agrega exigencias: las QUITA. Dice que una abreviatura común
 * vale igual que la palabra entera, que un error de tipeo que no cambia el significado no
 * hace discrepante un documento, y —desde la edición 2023— que la falta del número del
 * crédito en un documento no justifica un rechazo.
 *
 * Por eso este módulo hace dos cosas distintas:
 *  1. compara con la tolerancia que la práctica manda (`comparaISBP`), y
 *  2. ablanda hallazgos del examen base que la ISBP ya no considera discrepancia
 *     (`ablandarPorISBP`).
 *
 * Las reglas citan su párrafo. Las que salen de la edición 2023 lo dicen.
 */

import { cabezaDeExigencia } from "./consistencia";
import type { ReglaPresentacion } from "./presentacion";

/* ─────────────────────── A1 — abreviaturas de uso común ─────────────────────── */

/** Equivalencias que la práctica da por intercambiables, en cualquier sentido (A1). */
const ABREVIATURAS: [RegExp, string][] = [
  [/\b(ltd|limited)\b/g, "ltd"],
  [/\b(co|company)\b/g, "co"],
  [/\b(corp|corporation)\b/g, "corp"],
  [/\b(inc|incorporated)\b/g, "inc"],
  [/\b(int l|intl|international)\b/g, "intl"],
  [/\b(ind|industry|industries)\b/g, "ind"], // ejemplo agregado en la edición 2023
  [/\b(mfr|manufacturer)\b/g, "mfr"],
  [/\b(kg|kgs|kos|kilogram|kilograms|kilo|kilos)\b/g, "kg"],
  [/\b(mt|mts|metric ton|metric tons)\b/g, "mt"],
  [/\b(bros|brothers)\b/g, "bros"],
  [/\b(assn|association)\b/g, "assn"],
  [/\b(pvt|private)\b/g, "pvt"],
  [/\b(pte|pty)\b/g, "pte"],
  [/\b(sa|s a)\b/g, "sa"],
];

/**
 * Las formas societarias que `ABREVIATURAS` ya canoniza, más las que no necesitan canonizarse.
 *
 * Se usa para saber qué **no** puede ser una dirección: si lo que separa dos nombres incluye una de
 * éstas, lo que cambió es la empresa y no dónde está. Sale de la misma lista de arriba a propósito —dos
 * copias de la misma pregunta es cómo se desincronizan dos respuestas— más las formas que ya llegan
 * normalizadas en una sola palabra.
 */
const FORMAS_SOCIETARIAS = new Set([
  "ltd",
  "co",
  "corp",
  "inc",
  "sa",
  "pvt",
  "pte",
  "bros",
  "assn",
  "gmbh",
  "ag",
  "nv",
  "bv",
  "srl",
  "spa",
  "llc",
  "plc",
  "kg",
  "oy",
  "ab",
  "as",
  "aps",
  "sas",
  "sarl",
  "sl",
  "lda",
  "ltda",
  "sdn",
  "bhd",
  "jsc",
  "ooo",
  "zoo",
]);

/**
 * Texto comparable: sin acentos, sin puntuación y con las abreviaturas unificadas (A1).
 *
 * **El ampersand vale como la palabra «and» en vez de desaparecer**, y eso lo decidió una sentencia.
 * En *Bulgrains & Co Ltd v Shinhan Bank* [2013] EWHC 2498 (QB) el crédito nombraba al beneficiario
 * «Bulgrains Co Ltd» y la factura decía «Bulgrains & Co Ltd»; el High Court lo dio por discrepante:
 *
 *   «I find therefore, that there was a discrepancy as to name that was not clearly and demonstrably
 *   simply a typographical error and was material … Even if there was no facility to insert an
 *   ampersand in SWIFT, the word "and" could have been used.»
 *
 * Con el signo borrado los dos nombres llegaban como `bulgrains co ltd` y `comparaISBP` devolvía
 * IGUAL: el motor daba por idénticos dos nombres que un tribunal declaró materialmente distintos.
 *
 * Convertirlo en palabra deja separadas las dos cosas que la sentencia separa, y por eso no se borra
 * ni se deja como signo:
 *
 * - «SMITH & CO» contra «SMITH AND CO» sigue siendo **IGUAL**, que es lo que corresponde: el propio
 *   tribunal dice que podría haberse usado la palabra, o sea que las dos escrituras nombran a la misma
 *   empresa, y SWIFT no transmitía el signo;
 * - «BULGRAINS & CO LTD» contra «BULGRAINS CO LTD» pasa a **DISTINTO**, porque falta una palabra
 *   entera. No es un error de tipeo: es otro nombre.
 */
/**
 * Una abreviatura escrita con puntos es **una** palabra: «S.p.A.» es «SPA» y no «s p a».
 *
 * Sin esto el punto caía en el `[^a-z0-9]+` de abajo y una forma societaria quedaba partida en
 * letras sueltas. Contra un crédito SWIFT, que las escribe sin puntos porque así las transmite el
 * mensaje, eso es un nombre de tres palabras contra uno de una: `comparaISBP` devuelve DISTINTO y
 * `fac-emisor` y `ucp-18a-i` **rechazan la factura**. Medido con el laudo DOCDEX 260, cuya factura
 * dice «DiNinni Piombino S.p.A.» contra un 59 que dice «DININNI PIOMBINO SPA» — y ahí ni el banco
 * emisor, que levantó dos discrepancias, ni el panel vieron nada en el nombre.
 *
 * Que la lista de abreviaturas ya tuviera `s a` dice que esto se encontró una vez en su forma de
 * dos letras y se tapó a mano. Es la **tercera** vez que el punto de una abreviatura rompe algo en
 * este motor: antes fue el emisor exigido que se cortaba en «GOVT.» y `parseFecha("JUL.16")`.
 *
 * El corte es angosto a propósito: una **tirada de letras sueltas separadas por puntos** que no
 * esté pegada a otra palabra. Así «S.P.A.», «S.R.L.», «N.V.», «U.S.A.» y «J.P.» se juntan, y
 * «GOVT.VETERINERY» —donde el punto separa dos palabras de verdad— no se toca, porque el «t.v» de
 * la mitad viene pegado a letras por los dos lados.
 */
const ABREVIATURA_CON_PUNTOS = /(?<![a-z0-9])[a-z](?:\.[a-z])+\.?(?![a-z0-9])/g;

export function normISBP(s: string): string {
  let t = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(ABREVIATURA_CON_PUNTOS, (m) => m.replace(/\./g, ""))
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  for (const [re, canon] of ABREVIATURAS) t = t.replace(re, canon);
  return t.replace(/\s+/g, " ").trim();
}

/* ─────────────── A23 — errores de ortografía y de tipeo ─────────────── */

/**
 * Distancia de edición contando la transposición de dos letras vecinas como UN cambio
 * (Damerau): «modle» por «model» es el error de tipeo más común que existe y con la
 * distancia clásica contaría como dos. Acotada: pasado `tope` no interesa cuántos son.
 */
function distancia(a: string, b: string, tope: number): number {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  const filas: number[][] = [Array.from({ length: b.length + 1 }, (_, i) => i)];
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    let mejor = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(filas[i - 1]![j]! + 1, fila[j - 1]! + 1, filas[i - 1]![j - 1]! + costo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, filas[i - 2]![j - 2]! + 1);
      }
      fila.push(v);
      if (v < mejor) mejor = v;
    }
    if (mejor > tope) return tope + 1;
    filas.push(fila);
  }
  return filas[a.length]![b.length]!;
}

/**
 * ¿Son la misma palabra con un error de tipeo? (A23)
 *
 * «mashine» por «machine» no es discrepancia. «model 123» por «model 321» sí lo es: ahí
 * no hay error de tipeo, hay un dato distinto. Por eso las palabras que son puro número
 * nunca se dan por equivalentes.
 */
export function esErrorDeTipeo(a: string, b: string): boolean {
  if (a === b) return false;
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return false;
  if (a.length < 4 || b.length < 4) return false;
  const tope = a.length >= 8 ? 2 : 1;
  return distancia(a, b, tope) <= tope;
}

export type VeredictoISBP = "IGUAL" | "EQUIVALENTE" | "TIPEO" | "DISTINTO";

/**
 * Compara dos textos como los compara un examinador: tolerando abreviaturas (A1) y
 * errores de tipeo que no cambian el significado (A23), pero nunca un dato distinto.
 */
export function comparaISBP(a: string, b: string): VeredictoISBP {
  const na = normISBP(a);
  const nb = normISBP(b);
  if (!na || !nb) return "DISTINTO";
  if (na === nb) return "IGUAL";

  const pa = na.split(" ");
  const pb = nb.split(" ");
  if (pa.length === pb.length) {
    let tipeos = 0;
    for (let i = 0; i < pa.length; i++) {
      if (pa[i] === pb[i]) continue;
      if (esErrorDeTipeo(pa[i]!, pb[i]!)) {
        tipeos++;
        continue;
      }
      return "DISTINTO";
    }
    return tipeos > 0 ? "TIPEO" : "IGUAL";
  }
  // longitudes distintas: uno puede ser el otro con información de más
  if (na.includes(nb) || nb.includes(na)) return "EQUIVALENTE";
  return "DISTINTO";
}

/* ────────── El nombre de una parte: tres bandas, porque los tribunales se dividen ────────── */

/**
 * La nota que acompaña a un nombre que difiere en lo que parece un tipeo.
 *
 * Va acá y no escrita en cada regla para que las reglas no puedan decir cosas distintas sobre el mismo
 * hecho, que es justo lo que pasaba: `bl-notify` tenía las tres bandas y `ucp-18a-i` comparaba con un
 * **matcher de lugares** —alcanzaba una palabra distintiva compartida— y `fac-emisor` con un
 * `includes` de la primera palabra del nombre.
 */
export const NOTA_TIPEO_DE_NOMBRE =
  "difieren en lo que parece un error de tipeo, y si eso es discrepancia lo deciden los tribunales caso por caso — en Beyene v Irving Trust «Soran» por «Sofan» sí lo fue, en Hing Yip v Daiwa «Industrial» por «Industries» no: verificar a mano";

/**
 * Cómo se compara el nombre de una parte, en las tres bandas que las sentencias obligan.
 *
 * - **iguales, o uno contenido en el otro con datos de más → OK**;
 * - **difieren en lo que parece un tipeo → ATENCION**, con las sentencias nombradas. El motor no puede
 *   medir si el error es material: eso depende de para qué sirve el nombre;
 * - **no se parecen → DISCREPANCIA**.
 *
 * La tercera banda es la que *Bulgrains & Co Ltd v Shinhan Bank* [2013] EWHC 2498 (QB) obligó a usar
 * donde antes se usaba un comparador flojo: el crédito decía «Bulgrains Co Ltd», la factura «Bulgrains
 * & Co Ltd», y el High Court lo declaró *«a discrepancy as to name that was not clearly and
 * demonstrably simply a typographical error and was material»*. Con el matcher de lugares alcanzaba
 * que compartieran «bulgrains» para dar la factura por buena.
 */
/**
 * El crédito exige que los documentos vayan en inglés.
 *
 * Vive acá porque la decide el texto del crédito y la usan las dos reglas del 18 (a) (i) — que son dos
 * y tienen que decir lo mismo, que es la lección que dejó *Bulgrains v Shinhan*.
 */
export function creditoExigeIngles(lc: { condicionesAdicionales?: string[] | null } | null | undefined): boolean {
  return (lc?.condicionesAdicionales ?? []).some((c) =>
    /\b(?:issued|written|drawn)\s+in\s+english\b|\bin\s+the\s+english\s+language\b|\bmust be in english\b/i.test(c),
  );
}

export const NOTA_NOMBRE_ILEGIBLE =
  "el nombre de una entidad y los sellos pueden ir en otro idioma (párrafo A21 (e) de la ISBP, transcripto en la Opinión TA 886rev), así que esto no es discrepancia por sí solo — verificar a mano quién emite";

export const NOTA_NOMBRE_ILEGIBLE_CON_INGLES =
  "el crédito exige los documentos en inglés, y eso cambia la práctica del párrafo A21 (e) de la ISBP — sin una indicación legible del emisor la discrepancia vale (Opinión TA 886rev)";

export function veredictoDeNombre(
  enDocumento: string,
  enCredito: string,
  /**
   * El crédito exige los documentos en inglés, lo que cambia qué hacer con un nombre ilegible.
   *
   * Ver `NOTA_NOMBRE_ILEGIBLE`. Sin esto, un nombre en un alfabeto que `normISBP` no conserva se
   * normaliza a la cadena vacía y `comparaISBP` devuelve DISTINTO: el motor rechazaba **por no poder
   * leer**, que no es lo mismo que por no coincidir, y el párrafo A21 (e) dice que el sello puede ir en
   * otro idioma. La Opinión TA 886rev decide con esa cláusula del crédito y no con el alfabeto.
   */
  exigeIngles = false,
): "OK" | "ATENCION" | "DISCREPANCIA" {
  if (enDocumento.trim() && normISBP(enDocumento).trim() === "") return exigeIngles ? "DISCREPANCIA" : "ATENCION";
  const cmp = comparaISBP(enDocumento, enCredito);
  /*
   * **Abreviar la forma societaria no es discrepancia; omitirla sí.** Lo dice la Opinión R 455.
   *
   * El panel contesta las dos mitades en una línea: *«Use of "Ltd" instead of "Limited" does not
   * constitute a discrepancy. **The absence of word(s) to the effect of the meaning of "Ltd" in the
   * name of the consignee would constitute a discrepancy.**»* La primera la cumple la tabla de
   * abreviaturas del párrafo A1 —«LTD» y «LIMITED» canonizan igual, así que el par sale IGUAL— y la
   * segunda **no la cumplía nadie**: la banda de **contención** de `comparaISBP` devuelve EQUIVALENTE
   * cuando un nombre está contenido en el otro, y «ACME ELECTRONICS» está contenido en «ACME
   * ELECTRONICS LIMITED», así que un consignatario que **se comió la forma societaria** salía en OK.
   *
   * **La dirección importa y es lo que hace seguro el arreglo.** Que el papel traiga **de más** es lo
   * que la banda existe para admitir, y hay dos autoridades sosteniéndolo: la Opinión R 474 —una
   * sucursal agregada al nombre no rechaza— y la R 733, cuya conclusión 3 dice que agregar datos de
   * contacto que el crédito no da no es motivo de rechazo. Lo que se cierra es la otra dirección: que
   * al papel le **falte** la forma societaria que el crédito escribió.
   *
   * Y el alcance es exacto a propósito: se exige que **todo** lo que falta sea forma societaria. Si al
   * papel le falta además una palabra del nombre —«ACME» contra «ACME ELECTRONICS LIMITED»— eso no es
   * lo que esta Opinión juzga, y queda donde estaba.
   *
   * Vive acá y no en `comparaISBP` porque **acá los roles tienen nombre**: `enDocumento` y
   * `enCredito`. `comparaISBP` se llama en el motor con los argumentos en cualquier orden —`cert-emisor`
   * recorre los emisores admitidos, `loEmiteElBeneficiario` compara contra el beneficiario— y volverla
   * asimétrica cambiaría su contrato para todos sus llamadores.
   */
  if (cmp === "EQUIVALENTE") {
    const doc = normISBP(enDocumento).split(" ").filter(Boolean);
    const cre = normISBP(enCredito).split(" ").filter(Boolean);
    const leFalta = cre.filter((w) => !doc.includes(w));
    if (doc.length < cre.length && leFalta.length > 0 && leFalta.every((w) => FORMAS_SOCIETARIAS.has(w))) {
      return "DISCREPANCIA";
    }
  }
  if (cmp === "IGUAL" || cmp === "EQUIVALENTE") return "OK";
  if (cmp === "TIPEO") return "ATENCION";
  /*
   * Y las mismas palabras en otro orden **son el mismo nombre**, que lo decidió otro tribunal.
   *
   * *Voest-Alpine Trading USA Corp. v Bank of China*: el crédito nombraba al beneficiario
   * «Voest-Alpine USA Trading Corp.» y los documentos decían «Voest-Alpine Trading USA Corp.» —el
   * localizador geográfico invertido—. El tribunal lo descartó: los documentos *«obviamente se
   * refieren a esta operación»* y la inversión *«no significa una entidad corporativa distinta»*.
   *
   * `comparaISBP` compara palabra por palabra **por posición**, así que una permutación le sale
   * DISTINTO: sin esta rama, apretar la comparación del nombre para que atrapara el ampersand de
   * Bulgrains hacía que el motor rechazara Voest-Alpine. Lo frenó el propio banco de pruebas, que
   * tiene las dos sentencias como casos y las contó como inventadas.
   *
   * El alcance es exacto: **el mismo conjunto de palabras, con las mismas repeticiones**. Si falta
   * una o sobra una, no es un reordenamiento — es otro nombre, que es justo lo de Bulgrains.
   */
  const ordenadas = (t: string) => normISBP(t).split(" ").filter(Boolean).sort().join(" ");
  if (ordenadas(enDocumento) === ordenadas(enCredito)) return "OK";
  /*
   * Y si lo que difiere es **la dirección**, el artículo 14 (j) dice que no tiene que coincidir.
   *
   * «Cuando las direcciones del beneficiario y del ordenante aparecen en cualquier documento exigido,
   * NO necesitan ser las mismas que las del crédito.» El motor no pide la dirección en ningún campo
   * —`exportador` es una razón social— pero el papel la imprime debajo del nombre y una extracción la
   * trae adentro: ahí los dos nombres coinciden palabra por palabra y lo que sobra es la calle o la
   * ciudad, y el veredicto salía DISCREPANCIA.
   *
   * Lo decide el laudo **DOCDEX 265**, unánime: el sello del beneficiario mostraba en la factura, el
   * packing y el endoso del conocimiento una dirección distinta de la del crédito —«WIEN» en alemán
   * contra «Vienna» en inglés— y el panel *«finds no requirement in this L/C or in UCP 500 for the
   * beneficiary's address on the documents to be identical in street number, street name, city, state,
   * country or language to that in the L/C»*.
   *
   * **Sale ATENCION y no OK, y esa mitad es deliberada**: el motor no sabe cuál parte del texto es la
   * dirección, así que afirmar que los dos papeles nombran a la misma empresa sería decidir con un dato
   * que no tiene. Lo que sí puede hacer es dejar de rechazar y poner los dos nombres delante de una
   * persona. Si esto debería ser OK es la decisión del dueño que el laudo DOCDEX 325 dejó anotada.
   *
   * Los tres frenos, y el primero es el que salva a *Bulgrains*:
   *
   * - lo que difiere **no puede contener una forma societaria** —«BULGRAINS & CO LTD» contra
   *   «BULGRAINS CO LTD» difiere en «and co ltd» contra «co ltd», y ahí hay dos, así que ese par sigue
   *   siendo DISCREPANCIA, que es lo que el High Court resolvió—;
   * - el prefijo común tiene que traer **al menos dos palabras**, para que «ACME» contra «ACME LTD
   *   VIENNA» no entre por acá;
   * - y lo que difiere no puede ser **solo números**: un número distinto es un dato distinto (A23).
   */
  const pa = normISBP(enDocumento).split(" ").filter(Boolean);
  const pb = normISBP(enCredito).split(" ").filter(Boolean);
  let i = 0;
  while (i < pa.length && i < pb.length && pa[i] === pb[i]) i++;
  const colas = [...pa.slice(i), ...pb.slice(i)];
  const esFormaSocietaria = (w: string) => FORMAS_SOCIETARIAS.has(w);
  if (
    i >= 2 &&
    colas.length > 0 &&
    !colas.some(esFormaSocietaria) &&
    colas.some((w) => /[a-z]/.test(w) && !/^\d+$/.test(w))
  ) {
    return "ATENCION";
  }
  return "DISCREPANCIA";
}

/* ────────── Consideración preliminar viii (2023) — el número del crédito ────────── */

/**
 * Ablanda los hallazgos del examen base que la ISBP 821 ya no considera discrepancia.
 *
 * Hoy solo uno, y es importante: la consideración preliminar viii de la edición 2023 dice
 * que la ausencia del número del crédito en un documento, o un error tipográfico en él,
 * **no justifica un rechazo** — salvo que el país importador lo exija por razones
 * regulatorias y el crédito lo indique. El examen base lo marcaba como discrepancia.
 *
 * No se borra el hallazgo: baja a «a verificar» y se le explica por qué.
 *
 * ## Y el ancla dejaba afuera la mitad de los papeles
 *
 * `/^lc-num-/` no matchea `cert-lc-num-…`, así que el ablandado cubría los **cuatro** documentos de la
 * matriz y **ningún** certificado — y la regla de los certificados también rechaza por un número que no es
 * el del crédito. O sea que el mismo hecho salía en ATENCION sobre una factura y en DISCREPANCIA sobre un
 * certificado de origen, que es la contradicción que este repositorio ya pagó una vez con el artículo
 * 18 (a) (i) y el sello en otro idioma. Es, además, el disfraz de siempre: desde afuera un certificado
 * rechazado por su número se ve igual que un rechazo legítimo.
 *
 * ## Y ahora tiene una autoridad que se puede leer
 *
 * La consideración preliminar viii es de la **ISBP 821, que no está comprada**: lo que había acá era una
 * paráfrasis de fuentes secundarias, y en este repositorio eso es lo más débil que puede sostener un
 * veredicto. El laudo **DOCDEX 329** decide exactamente esto, por unanimidad y con el aviso de rechazo
 * textual —«INVOICE NOT INDICATE LC NUMBER AND DATE»—:
 *
 * > Based on the statements in the referenced opinions, **the misquoting or absence of the L/C number and
 * > date were not grounds for discrepancy, even if required by the credit. Provided that the Respondent can
 * > relate the presentation of documents to the applicable credit, this was sufficient.**
 *
 * Y lo funda en cuatro Opiniones de la Banking Commission que dicen para qué está el número —R289: *«the
 * requirement is only to assist in tracing documents should they go astray […] the absence of the reference
 * number, which in itself neither adds nor detract from the purpose of the document, would seem an
 * irrelevance, and not valid grounds for rejection»*; R578, R635 y TA.774 lo reiteran—. **Con la única
 * excepción que ya estaba escrita acá:** *«The only exception would be if there was a need for the L/C
 * number to appear on the documents as a requirement of national or customs regulations»*.
 *
 * Eso cierra la pregunta que el caso Voest-Alpine dejó abierta —si el error de tipeo deja de ser
 * discrepancia **también cuando el crédito lo exige en el 47A**— y la cierra con un panel y un expediente
 * en vez de con la espera de un libro: el crédito de este laudo lo pedía en el 47A con todas las letras
 * («All required documents must indicate our L/C number and date») y el panel igual dijo que no.
 */
export function ablandarPorISBP(reglas: ReglaPresentacion[]): ReglaPresentacion[] {
  return reglas.map((r) => {
    if (r.estado !== "DISCREPANCIA") return r;
    if (!/^(cert-)?lc-num-/.test(r.id)) return r;
    return {
      ...r,
      estado: "ATENCION",
      fuente: "ISBP 821, consideración preliminar viii · Laudo DOCDEX 329",
      evidencia: `${r.evidencia} — por sí solo no justifica rechazo (edición 2023, y el laudo DOCDEX 329 por unanimidad: tampoco cuando el crédito pide citarlo); sí hay que mirarlo si el país importador exige el dato`,
    };
  });
}

/* ───────────────────────── C1 — qué es una factura comercial ───────────────────────── */

/**
 * Un documento titulado «provisional» o «proforma» no satisface la exigencia de factura
 * comercial (C1). Uno que diga «issued for tax purposes» sí la satisface.
 */
export function esFacturaComercial(titulo: string): { vale: boolean; motivo: string } {
  const t = normISBP(titulo);
  if (/\bproforma\b|\bpro forma\b/.test(t)) {
    return { vale: false, motivo: "una factura proforma no satisface la exigencia de factura comercial (ISBP 821 C1)" };
  }
  if (/\bprovisional\b/.test(t)) {
    return {
      vale: false,
      motivo: "una factura provisional no satisface la exigencia de factura comercial (ISBP 821 C1)",
    };
  }
  return { vale: true, motivo: "" };
}

/* ───────────────── C8 — el término de entrega y su versión ───────────────── */

/**
 * Si el crédito nombra la fuente del incoterm ("CFR Colombo Incoterms 2020"), la factura
 * tiene que nombrar la misma. Si el crédito no la nombra, la factura puede agregarla (C8).
 */
export function versionIncoterm(texto: string): string | null {
  return /incoterms?\s*®?\s*(\d{4})/i.exec(texto)?.[1] ?? null;
}

/**
 * Los once términos de entrega de los Incoterms, que son una lista cerrada.
 *
 * `versionIncoterm` mira el **año** y esto mira **el término**, y son dos preguntas distintas: la
 * primera es el párrafo C8 de la ISBP y la segunda el artículo 18 (c).
 */
const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"] as const;

/**
 * El término de entrega que un texto nombra, o null.
 *
 * Salió de la Opinión **TA 765rev**: el 45A decía «FOB Singapore» y la factura «FCA Singapore Changi
 * Airport», y nadie los comparaba porque el motor solo miraba la versión —y ese crédito no nombraba
 * ninguna—. La ICC:
 *
 *   «UCP 600 sub-article 18 (c) states "The description of the goods, services or performance in a
 *   commercial invoice must correspond with that appearing in the credit", and **the trade term "FOB
 *   Singapore" was part of the description appearing in the credit**.» — CONCLUSION: The second
 *   discrepancy is valid.
 *
 * Y la Opinión descarta expresamente que el término tenga que ser el **apropiado** para el medio de
 * transporte —el beneficiario argumentaba que FOB no sirve para un embarque aéreo— porque eso sería
 * investigar más allá de la cara del documento. Así que esto compara el término y nada más.
 */
/**
 * Y los mismos once términos escritos en palabras, que es como los escribe la mitad de los créditos.
 *
 * Sin esto `terminoDeEntrega` devolvía null para **«EX-WORKS»**, «FREE ON BOARD» o «COST AND FREIGHT»,
 * así que `ucp-18c-incoterm` y `isbp-c8` no corrían: el crédito nombraba su término de entrega y el
 * motor no lo veía. Lo encontró el laudo **DOCDEX 208**, cuyo 45A dice literalmente «EX-WORKS».
 *
 * El orden importa en dos pares, y por eso es una lista y no un objeto: **DPU antes que DAP**, porque
 * «delivered at place unloaded» contiene «delivered at place»; y **CIP antes que CPT** por prudencia,
 * aunque «carriage and insurance paid to» no contenga literalmente «carriage paid to».
 *
 * «C & F» va a CFR porque la Opinión TA 936rev lo dice: *«"CFR" did replace the term "C & F" in the
 * Incoterms publications because the ampersand sign caused issues with SWIFT/Telex messages. Whilst they
 * are, in essence, the same term, certain industries such as GAFTA still use C & F for grain
 * shipments»*.
 *
 * **Y el patrón de EXW es angosto a propósito.** Pide «ex» seguido de «work» o «works», así que
 * «EX-WARE HOUSE» —que es la factura que el panel de DOCDEX 208 declaró **discrepante**— no coincide.
 * Si coincidiera, el motor daría por bueno justo el papel que el laudo rechaza.
 */
const EN_PALABRAS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEX[\s-]?WORKS?\b/, "EXW"],
  [/\bFREE[\s-]?CARRIER\b/, "FCA"],
  [/\bFREE[\s-]?ALONGSIDE[\s-]?SHIP\b/, "FAS"],
  [/\bFREE[\s-]?ON[\s-]?BOARD\b/, "FOB"],
  [/\bCOST[,\s-]+INSURANCE[,\s-]+AND[\s-]?FREIGHT\b|\bCOST[,\s-]+INSURANCE[\s-]?AND[\s-]?FREIGHT\b/, "CIF"],
  [/\bCOST[\s-]?AND[\s-]?FREIGHT\b|\bC[\s-]*&[\s-]*F\b|\bC[\s-]+AND[\s-]+F\b/, "CFR"],
  [/\bCARRIAGE[\s-]?AND[\s-]?INSURANCE[\s-]?PAID[\s-]?TO\b/, "CIP"],
  [/\bCARRIAGE[\s-]?PAID[\s-]?TO\b/, "CPT"],
  [/\bDELIVERED[\s-]?AT[\s-]?PLACE[\s-]?UNLOADED\b/, "DPU"],
  [/\bDELIVERED[\s-]?AT[\s-]?PLACE\b/, "DAP"],
  [/\bDELIVERED[\s-]?DUTY[\s-]?PAID\b/, "DDP"],
];

export function terminoDeEntrega(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const t = texto.toUpperCase();
  return INCOTERMS.find((x) => new RegExp(`\\b${x}\\b`).test(t)) ?? EN_PALABRAS.find(([re]) => re.test(t))?.[1] ?? null;
}

export function cotejarIncotermISBP(
  enCredito: string,
  enFactura: string,
): { estado: "OK" | "DISCREPANCIA"; evidencia: string } {
  const vc = versionIncoterm(enCredito);
  const vf = versionIncoterm(enFactura);
  if (!vc) {
    return {
      estado: "OK",
      evidencia: vf
        ? `el crédito no fija versión y la factura agrega Incoterms ${vf}: admitido`
        : "el crédito no fija versión del término de entrega",
    };
  }
  if (!vf) {
    return {
      estado: "DISCREPANCIA",
      evidencia: `el crédito dice Incoterms ${vc} y la factura no indica la versión`,
    };
  }
  return vc === vf
    ? { estado: "OK", evidencia: `ambos indican Incoterms ${vc}` }
    : { estado: "DISCREPANCIA", evidencia: `el crédito dice Incoterms ${vc} y la factura, ${vf}` };
}

/* ─────────── A12 — certificados que pueden ser posteriores al embarque ─────────── */

/**
 * Un certificado de análisis, inspección o fumigación **puede** llevar fecha posterior al
 * embarque (A12a). Solo si el crédito pide expresamente que acredite un hecho previo —
 * «pre-shipment inspection certificate» — tiene que mostrarse anterior o igual (A12b).
 * Un «inspection certificate» a secas no obliga a que sea previo (A12c).
 */
export function exigePrevioAlEmbarque(textoExigencia: string): boolean {
  const t = normISBP(textoExigencia);
  return /\bpre shipment\b|\bpreshipment\b|\bprior to shipment\b|\bbefore shipment\b/.test(t);
}

/**
 * El espejo: un certificado que solo puede existir **después de que la mercadería llegue**.
 *
 * Salió del laudo **DOCDEX 318** —<https://library.iccwbo.org/content/tfb/DOCDEX/318.htm>, USD
 * 4.920.000—. El crédito pedía un certificado de aceptación en sitio y uno de fin de capacitación, y
 * los dos venían fechados **el mismo día que el a bordo**. El panel resolvió que era discrepancia por
 * el artículo 14 (d), y lo resolvió **sin salir de los papeles**:
 *
 *   «it was materially impossible for the SAT to have been completed on or prior to 3 February 2012,
 *   as stated in the SAT Certificate presented, given that the bill of lading showed that the commodity
 *   was shipped on board the carrying vessel on that very same date […] the commodity would
 *   necessarily have to arrive in the country of destination for the SAT to be completed, and the
 *   commodity could not have arrived on the date it was stated to have been shipped.»
 *
 * El motor tenía `exigePrevioAlEmbarque` —el certificado que el crédito pide anterior al embarque— y no
 * tenía esto, que es el caso opuesto y el que vale dinero: una aceptación en sitio fechada antes de que
 * la mercadería salga es la forma que tiene un papel falso de delatarse.
 *
 * **La lista es corta a propósito**, porque lo que la sostiene es el nombre del documento y no una
 * interpretación: una prueba de aceptación *en sitio*, una instalación, una puesta en marcha o el fin
 * de una capacitación ocurren donde está la mercadería. No entra «acceptance» sola —un inspector puede
 * aceptar la mercadería en origen— ni «inspection», que es justamente lo que se hace antes de embarcar.
 */
export function acreditaAlgoEnDestino(textoExigencia: string): boolean {
  const t = normISBP(textoExigencia);
  return /\bsite acceptance test\b|\bacceptance test\b|\bsat\b|\binstallation\b|\bcommissioning\b|\bcompletion of training\b/.test(
    t,
  );
}

/* ─────────── Q3 a Q5 y L3 — quién puede emitir un certificado ─────────── */

export type EmisorAdmitido = "CUALQUIERA" | "CUALQUIERA_MENOS_BENEFICIARIO" | "EL_QUE_NOMBRA_EL_CREDITO";

/**
 * Quién puede emitir un certificado, según cómo lo pida el crédito.
 *
 * - Si nombra la entidad, tiene que ser esa (Q3).
 * - Si no dice nada, cualquiera, incluido el beneficiario (Q4).
 * - Si usa un calificativo como «independent», «official» o «qualified», cualquiera
 *   MENOS el beneficiario (Q5).
 *
 * El certificado de origen es la excepción: aunque el crédito lo pida al beneficiario, al
 * exportador o al fabricante, se acepta emitido por una cámara de comercio si menciona a
 * alguno de ellos (L3c-i).
 */
/**
 * Los verbos con los que un crédito dice **quién** emite o firma un documento.
 *
 * Vive acá y se usa en los dos lados porque `emisorAdmitido` y `emisorQueNombra` preguntan lo mismo
 * —dónde describe el crédito al emisor— y **dos copias de la misma pregunta es cómo se desincronizan
 * dos respuestas**: con «signed by» en una sola, el laudo DOCDEX 216 salía con el certificado
 * clasificado como «cualquiera lo puede emitir» y el nombre que el crédito puso no se comparaba con
 * nada.
 */
export const NOMBRA_AL_EMISOR = /\b(?:issued|signed)\s+(?:and\s+signed\s+)?by\b|\bemitido por\b|\bfirmado por\b/;

export function emisorAdmitido(textoExigencia: string): EmisorAdmitido {
  const t = normISBP(textoExigencia);
  /*
   * El calificativo del Q5 tiene que calificar **al emisor**, no aparecer en cualquier parte.
   *
   * Se buscaba en toda la línea, así que un «BENEFICIARY'S CERTIFICATE CONFIRMING COPY DOCUMENTS
   * SENT TO APPLICANT'S LOCAL AGENT» quedaba clasificado como «cualquiera menos el beneficiario»
   * —por ese «local», que describe a quién se le manda la copia— y el certificado que el crédito le
   * pide expresamente al beneficiario salía discrepante por estar emitido por el beneficiario.
   *
   * Así que se mira solo donde el crédito describe al emisor: el tramo que sigue a «issued by», o
   * el nombre del propio documento («INDEPENDENT INSPECTION CERTIFICATE»).
   */
  /*
   * El tramo del emisor termina donde empieza lo que el documento tiene que decir.
   *
   * «ISSUED BY BENEFICIARY **CERTIFYING THAT** … APPLICANT\'S **LOCAL** AGENT» es una sola frase, y
   * mirarla entera hacía que ese «local» —que califica al agente del ordenante, no al emisor—
   * clasificara el certificado como «cualquiera menos el beneficiario». Con eso, el certificado que
   * el crédito le pide **al beneficiario** salía discrepante por estar emitido por él.
   *
   * Es el mismo arreglo que ya se hizo para el nombre del emisor: cortar donde empieza la
   * descripción.
   */
  const tramoCrudo = new RegExp(`(?:${NOMBRA_AL_EMISOR.source})(.*)$`).exec(t)?.[1] ?? "";
  const tramoDelEmisor = cabezaDeExigencia(tramoCrudo.trim());
  const donde = `${cabezaDeExigencia(t)} ${tramoDelEmisor}`;
  if (/\b(independent|official|qualified|competent|first class|well known|local)\b/.test(donde)) {
    return "CUALQUIERA_MENOS_BENEFICIARIO";
  }
  if (NOMBRA_AL_EMISOR.test(t)) return "EL_QUE_NOMBRA_EL_CREDITO";
  return "CUALQUIERA";
}

/** ¿Es un certificado de origen? Solo ahí corre la excepción de la cámara de comercio. */
export function esCertificadoDeOrigen(textoExigencia: string): boolean {
  return /\borigin\b|\borigen\b/.test(normISBP(textoExigencia));
}
