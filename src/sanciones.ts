import type { CamposDoc } from "./consistencia";
import { normISBP } from "./isbp";
import type { DocAnalizado } from "./presentacion";
import type { ContextoCredito } from "./reglas-ucp";
import type { LcInfo } from "./types";

/**
 * Screening de sanciones sobre las partes de una operación documentaria.
 *
 * El motor es puro: recibe las listas ya descargadas y decide. Bajar los archivos es
 * trabajo de la aplicación, porque implica red y caché.
 *
 * Dos decisiones de diseño vienen de cómo funciona esto de verdad en un banco:
 *
 * 1. **Toda coincidencia viaja con su evidencia**: qué lista, qué entrada, qué campo y
 *    qué valor coincidió. En *Kuvera Resources contra JPMorgan* el tribunal de Singapur
 *    le exigió al banco que su análisis fuera objetivo y verificable contra fuentes
 *    públicas, no un juicio interno. Un bloqueo sin evidencia trazable no se sostiene.
 * 2. **Nada se bloquea solo**: el resultado es una coincidencia para que la mire una
 *    persona. La decisión de no pagar es del banco, nunca del software.
 *
 * Lo que NO hace, a propósito: clasificar si una mercadería es de doble uso. La práctica
 * de la industria (Wolfsberg, ICC y BAFT) es explícita en que esa clasificación técnica
 * corresponde al exportador y a la aduana, no al banco.
 */

/** Una entrada de una lista de sanciones, ya normalizada por quien la descargó. */
export interface EntradaSancion {
  /** el identificador que le da su propia lista */
  id: string;
  nombre: string;
  alias?: string[];
  tipo?: "PERSONA" | "ENTIDAD" | "BUQUE" | "AERONAVE";
  /** número IMO, para buques: es permanente y no cambia con el reabanderamiento */
  imo?: string;
  /** el programa bajo el que fue designada */
  programa?: string;
}

export interface ListaSanciones {
  /** de dónde salió, tal como se cita después: "OFAC SDN", "UK Sanctions List" */
  fuente: string;
  /** cuándo se descargó o qué versión es */
  publicada: string;
  entradas: EntradaSancion[];
}

export type RolParte =
  | "BENEFICIARIO"
  | "ORDENANTE"
  | "BANCO_EMISOR"
  | "BANCO_AVISADOR"
  | "BANCO_LIBRADO"
  | "EMBARCADOR"
  | "CONSIGNATARIO"
  | "NOTIFY"
  | "BUQUE"
  | "PUERTO_CARGA"
  | "PUERTO_DESCARGA";

export interface ParteScreenear {
  rol: RolParte;
  valor: string;
  /** de dónde se sacó el dato, para poder rastrearlo */
  origen: string;
}

export interface Coincidencia {
  parte: ParteScreenear;
  fuente: string;
  entradaId: string;
  entradaNombre: string;
  /** qué hizo que coincidiera: el nombre, un alias o el número IMO */
  porQue: "NOMBRE" | "ALIAS" | "IMO";
  /** exacta, o parcial cuando un nombre contiene al otro */
  grado: "EXACTA" | "PARCIAL";
  programa?: string;
}

const ETIQUETA: Record<RolParte, string> = {
  BENEFICIARIO: "beneficiario",
  ORDENANTE: "ordenante",
  BANCO_EMISOR: "banco emisor",
  BANCO_AVISADOR: "banco avisador",
  BANCO_LIBRADO: "banco librado",
  EMBARCADOR: "embarcador",
  CONSIGNATARIO: "consignatario",
  NOTIFY: "notify party",
  BUQUE: "buque",
  PUERTO_CARGA: "puerto de carga",
  PUERTO_DESCARGA: "puerto de descarga",
};

/** Palabras que por sí solas no identifican a nadie: no alcanzan para una coincidencia. */
const VACIAS = new Set([
  "sa",
  "s",
  "a",
  "ltd",
  "co",
  "inc",
  "corp",
  "the",
  "of",
  "and",
  "de",
  "del",
  "la",
  "el",
  "pvt",
  "pte",
  "plc",
  "bank",
  "banco",
  "company",
  "limited",
  "group",
  "international",
  "intl",
  "trading",
  "trade",
  "export",
  "import",
  "shipping",
  "lines",
]);

function significativas(s: string): string[] {
  return normISBP(s)
    .split(" ")
    .filter((w) => w.length > 2 && !VACIAS.has(w));
}

const val = (c: { valor: string; confianza: number } | undefined): string | null =>
  c && c.valor.trim() && c.confianza >= 0.4 ? c.valor.trim() : null;

/**
 * Quiénes hay que screenear en esta operación.
 *
 * La lista sale de las Trade Finance Principles: las dos contrapartes, toda la cadena
 * bancaria, el embarcador y el consignatario, el notify party, el buque y los puertos.
 */
export function partesAScreenear(input: {
  lc: LcInfo;
  credito?: ContextoCredito;
  docs: DocAnalizado[];
}): ParteScreenear[] {
  const out: ParteScreenear[] = [];
  const agregar = (rol: RolParte, valor: string | null | undefined, origen: string) => {
    if (!valor || !valor.trim() || valor.trim() === "—") return;
    const limpio = valor.trim();
    if (out.some((p) => p.rol === rol && p.valor === limpio)) return;
    out.push({ rol, valor: limpio, origen });
  };

  agregar("ORDENANTE", input.credito?.aplicante, "campo 50 del crédito");
  agregar("BANCO_EMISOR", input.lc.bancoEmisor, "campo 52A del crédito");
  agregar("BANCO_AVISADOR", input.lc.bancoAvisador, "campo 57A del crédito");
  agregar("BANCO_LIBRADO", input.lc.librado, "campo 42D del crédito");
  agregar("PUERTO_CARGA", input.credito?.puertoEmbarque, "campo 44E del crédito");
  agregar("PUERTO_DESCARGA", input.credito?.puertoDestino, "campo 44F del crédito");

  for (const d of input.docs) {
    const nombre = d.nombreArchivo ?? d.tipo;
    const c: CamposDoc = d.campos;
    if (d.tipo === "FACTURA") agregar("BENEFICIARIO", val(c.exportador), nombre);
    if (d.tipo === "BL") {
      agregar("EMBARCADOR", val(c.exportador), nombre);
      agregar("CONSIGNATARIO", val(c.consignatario), nombre);
      agregar("NOTIFY", val(c.notify) ?? val(c.importador), nombre);
      agregar("BUQUE", val(c.buque), nombre);
    }
  }
  return out;
}

/** ¿Este nombre coincide con esta entrada de la lista? */
function coteja(parte: ParteScreenear, e: EntradaSancion): Omit<Coincidencia, "parte" | "fuente"> | null {
  // un buque coincide por su número IMO antes que por su nombre: el nombre cambia, el IMO no
  if (parte.rol === "BUQUE" && e.imo) {
    const imo = /\b(\d{7})\b/.exec(parte.valor)?.[1];
    if (imo && imo === e.imo.replace(/\D/g, "")) {
      return { entradaId: e.id, entradaNombre: e.nombre, porQue: "IMO", grado: "EXACTA", programa: e.programa };
    }
  }

  const pn = normISBP(parte.valor);
  const claves = significativas(parte.valor);
  if (claves.length === 0) return null;

  const candidatos: { texto: string; que: "NOMBRE" | "ALIAS" }[] = [
    { texto: e.nombre, que: "NOMBRE" },
    ...(e.alias ?? []).map((a) => ({ texto: a, que: "ALIAS" as const })),
  ];

  for (const c of candidatos) {
    const cn = normISBP(c.texto);
    if (!cn) continue;
    if (cn === pn) {
      return { entradaId: e.id, entradaNombre: e.nombre, porQue: c.que, grado: "EXACTA", programa: e.programa };
    }
    // parcial: todas las palabras propias de la entrada aparecen en la parte, o al revés
    const cc = significativas(c.texto);
    if (cc.length === 0) continue;
    const enParte = cc.every((w) => claves.includes(w));
    const enEntrada = claves.every((w) => cc.includes(w));
    if (enParte || enEntrada) {
      return { entradaId: e.id, entradaNombre: e.nombre, porQue: c.que, grado: "PARCIAL", programa: e.programa };
    }
  }
  return null;
}

/**
 * Corre las partes contra las listas. Devuelve coincidencias para revisar, nunca un
 * veredicto: quien decide no pagar es el banco.
 */
export function screenear(partes: ParteScreenear[], listas: ListaSanciones[]): Coincidencia[] {
  const out: Coincidencia[] = [];
  for (const lista of listas) {
    for (const e of lista.entradas) {
      for (const p of partes) {
        const m = coteja(p, e);
        if (m) out.push({ parte: p, fuente: lista.fuente, ...m });
      }
    }
  }
  // primero lo exacto, que es lo que hay que mirar antes
  return out.sort((a, b) => (a.grado === b.grado ? 0 : a.grado === "EXACTA" ? -1 : 1));
}

/** Una línea legible de una coincidencia, con toda su evidencia. */
export function describirCoincidencia(c: Coincidencia): string {
  const por = c.porQue === "IMO" ? "por número IMO" : c.porQue === "ALIAS" ? "por un alias" : "por nombre";
  const grado = c.grado === "EXACTA" ? "coincidencia exacta" : "coincidencia parcial";
  const prog = c.programa ? ` · programa ${c.programa}` : "";
  return `${ETIQUETA[c.parte.rol]} "${c.parte.valor}" (${c.parte.origen}) — ${grado} ${por} con "${c.entradaNombre}" de ${c.fuente}${prog}`;
}

/**
 * Los momentos en que hay que volver a correr el screening, según las Trade Finance
 * Principles. No es una vez y listo: las listas cambian y las operaciones duran meses.
 */
export const MOMENTOS_DE_SCREENING = [
  "Al abrir el crédito y en cada enmienda",
  "Al presentarse los documentos",
  "Al instruir el pago o el reembolso, incluso si aparece un banco que no estaba antes",
  "Ante cualquier cambio material en la operación",
  "De nuevo sobre las operaciones abiertas cada vez que se actualizan las listas",
] as const;
