/**
 * Fechas del dominio: todo el mock y la UI usan `dd-mmm-yy` en español
 * ("15-ago-26"). Parser tolerante — devuelve null ante lo no parseable
 * (hitos como "+21 días" o "~fin ago"), y las reglas que dependen de la
 * fecha simplemente no corren.
 */

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Días de `a` hasta `b` (positivo si b es posterior). Ignora horas. */
/** "Hoy" en Montevideo, como Date a medianoche local. En Vercel el server corre en UTC:
 *  después de las 21:00 UY `new Date()` ya es mañana (re-auditoría M-8) — y en un
 *  producto de vencimientos de LC, un día importa. */
export function hoyMontevideo(ahora = new Date()): Date {
  const iso = isoMontevideo(ahora);
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** yyyy-mm-dd de un instante, en la zona de Montevideo (no UTC). */
export function isoMontevideo(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Montevideo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function diffDias(a: Date, b: Date): number {
  const MS_DIA = 86_400_000;
  const utc = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((utc(b) - utc(a)) / MS_DIA);
}

/** Formatea al formato del dominio: "30-sep-26". */
export function fmtFecha(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}-${MESES[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
}

/* meses en inglés (los documentos reales vienen así: "08-APR-2025", "April 08th, 2025") */
const MESES_EN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const mesDe = (txt: string): number => {
  const t = txt.toLowerCase().slice(0, 3);
  const es = MESES.indexOf(t);
  if (es !== -1) return es;
  return MESES_EN.indexOf(t === "sep" ? "sep" : t);
};
const valida = (y: number, m: number, d: number): Date | null => {
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  const f = new Date(y, m, d);
  return f.getMonth() === m && f.getDate() === d ? f : null;
};

/**
 * Fecha del dominio "30-sep-26" y, desde el caso CSU2025099, las formas en que las escriben los
 * documentos reales: "08-APR-2025" (BL), "08/04/25" (factura DGI), "08/04/2025" y "21/12/2024"
 * (packing), "April 08th, 2025" (certificados), "2025-04-08" (ISO). Numéricas = día/mes/año
 * (convención uruguaya y de los bancos de la región). Lo difuso ("+21 días", "~fin ago") → null.
 */
export function parseFecha(s: string): Date | null {
  // "April, 08th, 2025 (08/04/2025)": se prueba cada tramo (fuera y dentro del paréntesis)
  if (s.includes("(")) {
    for (const tramo of s.split(/[()]/)) {
      const f = tramo.trim() ? parseFecha(tramo) : null;
      if (f) return f;
    }
    return null;
  }
  const t = s
    .trim()
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, "$1")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ");
  let m: RegExpExecArray | null;
  // dd-mmm-yy · dd-mmm-yyyy · dd mmm yyyy · dd/mmm/yyyy (ES o EN)
  if ((m = /^(\d{1,2})[-/ ]([a-zñ]{3,10})[-/ ](\d{2}|\d{4})$/.exec(t))) {
    const mes = mesDe(m[2]);
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return mes === -1 ? null : valida(y, mes, Number(m[1]));
  }
  // "april 08 2025" · "08 april 2025" (con o sin ordinal, ya quitado)
  if ((m = /^([a-z]{3,10}) (\d{1,2}) (\d{4})$/.exec(t))) {
    const mes = mesDe(m[1]);
    return mes === -1 ? null : valida(Number(m[3]), mes, Number(m[2]));
  }
  // dd/mm/yy · dd/mm/yyyy · dd.mm.yyyy · dd-mm-yyyy
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t))) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return valida(y, Number(m[2]) - 1, Number(m[1]));
  }
  // ISO yyyy-mm-dd
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) return valida(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

/**
 * Tiempo relativo para historiales ("hace 3 días"). Una fecha absoluta obliga a
 * calcular; el trader lee un historial para saber si esto es fresco o viejo, y
 * esa es una pregunta relativa. La absoluta queda en el `title` del elemento.
 */
export function haceCuanto(s: string, hoy = new Date()): string | null {
  const d = parseFecha(s);
  if (!d) return null;
  const dias = diffDias(d, hoy);
  if (dias < 0) return null;
  if (dias === 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 30) return `hace ${dias} días`;
  const meses = Math.round(dias / 30);
  if (meses < 12) return `hace ${meses} ${meses === 1 ? "mes" : "meses"}`;
  const anios = Math.round(dias / 365);
  return `hace ${anios} ${anios === 1 ? "año" : "años"}`;
}

/**
 * Estado de un vencimiento. Devuelve el texto humano y si ya pasó, para que la
 * UI muestre el loop abierto (Zeigarnik) sin que cada pantalla recalcule días.
 */
export function vencimiento(s: string, hoy = new Date()): { label: string; vencido: boolean; dias: number } | null {
  const d = parseFecha(s);
  if (!d) return null;
  const dias = diffDias(hoy, d);
  if (dias < 0) {
    const atraso = -dias;
    return { label: atraso === 1 ? "vencido ayer" : `vencido hace ${atraso} días`, vencido: true, dias };
  }
  if (dias === 0) return { label: "vence hoy", vencido: false, dias };
  if (dias === 1) return { label: "vence mañana", vencido: false, dias };
  return { label: `vence en ${dias} días`, vencido: false, dias };
}

/**
 * Cuándo es el embarque, en palabras, para el listado.
 *
 * Distingue lo que se VIENE de lo que YA PASÓ, que no es un detalle de
 * redacción: un embarque en el pasado no está «vencido» —embarcó— y pintarlo
 * de rojo como si fuera un plazo incumplido llena la pantalla de una urgencia
 * que no existe. Lo pasado es historia y va en gris; lo que se viene dentro de
 * la semana es lo único que pide atención.
 */
export function cuandoEmbarque(fecha: string, hoy = new Date()): { label: string; clase: string } | null {
  const d = parseFecha(fecha);
  if (!d) return null;
  const dias = diffDias(hoy, d);
  if (dias === 0) return { label: "embarca hoy", clase: "es-pronto" };
  if (dias === 1) return { label: "embarca mañana", clase: "es-pronto" };
  if (dias > 0) return { label: `en ${dias} días`, clase: dias <= 7 ? "es-pronto" : "" };
  const atras = -dias;
  return { label: atras === 1 ? "embarcó ayer" : `embarcó hace ${atras} días`, clase: "es-pasado" };
}

/**
 * Clave de orden del embarque: lo que se viene primero (del más cercano al más
 * lejano), después lo ya embarcado (del más reciente al más viejo) y sin fecha
 * al fondo. Un embarque de hace tres meses no compite por la atención de hoy,
 * y ordenar por fecha cruda lo pondría arriba de todo.
 */
export function ordenEmbarque(fecha: string | null, hoy = new Date()): number {
  const d = fecha ? parseFecha(fecha) : null;
  if (!d) return Number.MAX_SAFE_INTEGER;
  const dias = diffDias(hoy, d);
  return dias >= 0 ? dias : 1_000_000 - dias;
}
