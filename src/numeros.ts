import { type CamposDoc, parseNumero } from "./consistencia";

/**
 * Números escritos por gente distinta, en países distintos, sobre el mismo embarque.
 *
 * El expediente real CSU2025099 tiene el caso de manual: la factura escribe la cantidad
 * como «53,960» y el packing como «53.960,00 Kgs». Es el mismo embarque. La coma seguida
 * de tres dígitos es genuinamente ambigua — puede ser separador de miles (53.960) o
 * decimal (53,96) — y si se elige mal y la unidad son toneladas, el error es de mil veces.
 * Ahí el motor marcaría una discrepancia enorme donde no hay ninguna.
 *
 * Este módulo no adivina: cuando el número es ambiguo lo dice, y si el documento trae con
 * qué resolverlo —precio unitario y total— usa la aritmética para decidir.
 */

/** ¿Este texto se puede leer de dos formas distintas? «53,960» sí; «53,96» no. */
export function esAmbiguo(texto: string): boolean {
  const n = texto.match(/\d[\d.,]*/)?.[0];
  if (!n) return false;
  // exactamente un separador, seguido de tres dígitos y nada más: miles o decimal
  return /^\d{1,3}[.,]\d{3}$/.test(n);
}

/** Las dos lecturas posibles de un número ambiguo, mayor primero. */
export function lecturasPosibles(texto: string): number[] {
  const n = texto.match(/\d[\d.,]*/)?.[0];
  if (!n) return [];
  if (!esAmbiguo(texto)) {
    const v = parseNumero(texto);
    return v === null ? [] : [v];
  }
  const sinSep = Number(n.replace(/[.,]/g, ""));
  const conDecimal = Number(n.replace(/[.,]/, "."));
  return [sinSep, conDecimal];
}

export type ComoSeResolvio = "DIRECTA" | "POR_ARITMETICA" | "AMBIGUA";

export interface CantidadResuelta {
  valor: number;
  como: ComoSeResolvio;
  nota: string;
}

/**
 * La cantidad que dice un documento, resuelta.
 *
 * Si el número no es ambiguo, se lee y listo. Si lo es y el documento trae precio unitario
 * y total, se elige la lectura que hace cerrar la cuenta. Si es ambiguo y no hay con qué
 * decidir, devuelve la lectura más probable pero marcada como AMBIGUA, para que quien la
 * use la trate como algo a verificar y nunca como una discrepancia.
 *
 * (La ISBP 821, en su párrafo A22, dice que los bancos no re-verifican la aritmética
 * interna de un documento. Acá no se usa para juzgarlo: se usa para entenderlo.)
 */
export function desambiguarCantidad(input: {
  cantidad: string;
  precioUnitario?: string | null;
  montoTotal?: string | null;
}): CantidadResuelta | null {
  const lecturas = lecturasPosibles(input.cantidad);
  if (lecturas.length === 0) return null;
  if (lecturas.length === 1) {
    return { valor: lecturas[0]!, como: "DIRECTA", nota: "el número se lee de una sola forma" };
  }

  const precio = input.precioUnitario ? parseNumero(input.precioUnitario) : null;
  const total = input.montoTotal ? parseNumero(input.montoTotal) : null;
  if (precio !== null && precio > 0 && total !== null && total > 0) {
    const esperada = total / precio;
    const cerca = lecturas.filter((v) => Math.abs(v - esperada) / esperada <= 0.01);
    if (cerca.length === 1) {
      const v = cerca[0]!;
      return {
        valor: v,
        como: "POR_ARITMETICA",
        nota: `${fmt(total)} dividido ${fmt(precio)} da ${fmt(esperada)}: la cantidad es ${fmt(v)}`,
      };
    }
  }

  // sin con qué decidir: la lectura decimal es la habitual en una factura de comercio exterior
  const probable = lecturas[1]!;
  return {
    valor: probable,
    como: "AMBIGUA",
    nota: `"${input.cantidad.trim()}" se puede leer como ${fmt(lecturas[0]!)} o como ${fmt(probable)}: verificar contra el documento`,
  };
}

const fmt = (n: number) => n.toLocaleString("es-UY", { maximumFractionDigits: 3, minimumFractionDigits: 0 });

/**
 * Un número de contenedor, comparable.
 *
 * El mismo contenedor viaja escrito de dos formas: el packing del caso real dice
 * «DEMU 410037-1» y el conocimiento de embarque «DEMU4100371». Son el mismo. Comparar el
 * texto tal cual daría una contradicción entre documentos que no existe.
 */
export function normalizarContenedor(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** ¿Dos formas de escribir el mismo contenedor? */
export function mismoContenedor(a: string, b: string): boolean {
  const na = normalizarContenedor(a);
  const nb = normalizarContenedor(b);
  return na.length > 0 && na === nb;
}

/**
 * Los contenedores que menciona un texto, normalizados.
 * Formato ISO 6346: cuatro letras (la cuarta es U, J o Z) y siete dígitos, con o sin
 * espacios y guiones de por medio.
 */
export function contenedoresEn(texto: string): string[] {
  const out: string[] = [];
  const re = /\b([A-Z]{3}[UJZ])\s*-?\s*(\d{3})\s*-?\s*(\d{3})\s*-?\s*(\d)\b/gi;
  for (const m of texto.matchAll(re)) {
    const c = normalizarContenedor(`${m[1]}${m[2]}${m[3]}${m[4]}`);
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/* ───────────────── preparar los campos antes de examinarlos ───────────────── */

export interface CamposPreparados {
  campos: CamposDoc;
  /** lo que hubo que resolver o quedó dudoso, para mostrarlo junto al examen */
  avisos: string[];
}

/**
 * Deja los campos de un documento en forma inequívoca antes de compararlos.
 *
 * Hoy resuelve una sola cosa, y es la que más daño hace: una cantidad escrita «53,960»,
 * que el comparador leería como 53.960 cuando son 53,96. Si la unidad son toneladas, eso
 * es un error de mil veces y una discrepancia inventada. Cuando el documento trae precio
 * unitario y total, la cuenta lo resuelve; cuando no, el valor queda como está y el aviso
 * dice que hay que mirarlo.
 *
 * Es un paso previo, no una corrección del documento: lo que se reescribe es cómo se lee
 * el número, nunca cuánto dice el papel.
 */
export function prepararCampos(campos: CamposDoc): CamposPreparados {
  const avisos: string[] = [];
  const cant = campos.cantidad;
  if (!cant || !cant.valor.trim() || !esAmbiguo(cant.valor)) return { campos, avisos };

  const r = desambiguarCantidad({
    cantidad: cant.valor,
    precioUnitario: campos.precioUnitario?.valor ?? null,
    montoTotal: campos.montoTotal?.valor ?? null,
  });
  if (!r) return { campos, avisos };

  if (r.como === "AMBIGUA") {
    avisos.push(`Cantidad ${r.nota}`);
    // se deja como está: no hay con qué decidir y no conviene inventar una lectura
    return { campos, avisos };
  }

  avisos.push(`Cantidad "${cant.valor.trim()}" leída como ${r.valor}: ${r.nota}`);
  return {
    campos: { ...campos, cantidad: { valor: String(r.valor), confianza: cant.confianza } },
    avisos,
  };
}
