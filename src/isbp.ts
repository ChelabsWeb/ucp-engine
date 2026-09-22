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

/** Texto comparable: sin acentos, sin puntuación y con las abreviaturas unificadas (A1). */
export function normISBP(s: string): string {
  let t = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
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
 */
export function ablandarPorISBP(reglas: ReglaPresentacion[]): ReglaPresentacion[] {
  return reglas.map((r) => {
    if (r.estado !== "DISCREPANCIA") return r;
    if (!/^lc-num-/.test(r.id)) return r;
    return {
      ...r,
      estado: "ATENCION",
      fuente: "ISBP 821, consideración preliminar viii",
      evidencia: `${r.evidencia} — por sí solo no justifica rechazo (edición 2023); sí hay que mirarlo si el país importador exige el dato`,
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
export function emisorAdmitido(textoExigencia: string): EmisorAdmitido {
  const t = normISBP(textoExigencia);
  if (/\b(independent|official|qualified|competent|first class|well known|local)\b/.test(t)) {
    return "CUALQUIERA_MENOS_BENEFICIARIO";
  }
  if (/\bissued by\b|\bemitido por\b/.test(t)) return "EL_QUE_NOMBRA_EL_CREDITO";
  return "CUALQUIERA";
}

/** ¿Es un certificado de origen? Solo ahí corre la excepción de la cámara de comercio. */
export function esCertificadoDeOrigen(textoExigencia: string): boolean {
  return /\borigin\b|\borigen\b/.test(normISBP(textoExigencia));
}
