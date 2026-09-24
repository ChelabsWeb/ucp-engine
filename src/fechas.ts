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

/**
 * Formatea para los papeles que salen del banco: "14-Apr-2025".
 *
 * `fmtFecha` escribe los meses en español, que es la lengua del código y del dominio interno.
 * Un aviso de rechazo se transmite a un banco que puede estar en Colombo, y fechado «14-abr-25»
 * obliga a quien lo recibe a adivinar. Cuatro meses difieren entre las dos lenguas —ene/jan,
 * abr/apr, ago/aug, dic/dec— y son los que se leen mal.
 *
 * Y el año va con cuatro dígitos: en un documento del que dependen plazos, «25» es una
 * ambigüedad que no cuesta nada evitar.
 */
export function fmtFechaEn(d: Date): string {
  const mes = MESES_EN[d.getMonth()]!;
  return `${String(d.getDate()).padStart(2, "0")}-${mes[0]!.toUpperCase()}${mes.slice(1)}-${d.getFullYear()}`;
}
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
/**
 * Los formatos que reconoce, exigiendo que el texto entero sea la fecha y nada más.
 *
 * Se mantiene separada de `parseFecha` porque la búsqueda dentro de un texto necesita un juez
 * estricto: probar candidatos contra un parser indulgente devolvería cualquier cosa.
 */
function fechaExacta(s: string): Date | null {
  // "April, 08th, 2025 (08/04/2025)": se prueba cada tramo (fuera y dentro del paréntesis)
  if (s.includes("(")) {
    for (const tramo of s.split(/[()]/)) {
      const f = tramo.trim() ? fechaExacta(tramo) : null;
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
 * Los tramos de texto que podrían ser una fecha, en el orden en que aparecen.
 *
 * El texto ya viene normalizado (ordinales y comas fuera, un solo espacio). Las tres formas son
 * las mismas que reconoce `fechaExacta`; lo que cambia es que acá no están ancladas. Los
 * candidatos tienen que empezar en frontera de palabra y no terminar en dígito. Sin eso, «REF
 * MVD0990117.06.25» entrega «30.06.25» y una referencia de expediente se leería como una fecha.
 */
function candidatos(t: string): string[] {
  const guarda = String.raw`(?<![\w./-])`;
  const cierre = String.raw`(?![\d])`;
  const formas = [
    // 08-apr-2025 · 08 april 2025 · 08/abr/25
    String.raw`\d{1,2}[-/ ][a-zñ]{3,10}[-/ ](?:\d{4}|\d{2})`,
    // april 08 2025
    String.raw`[a-zñ]{3,10} \d{1,2} \d{4}`,
    // 08/04/2025 · 08.04.25 · 2025-04-08
    String.raw`\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})`,
    String.raw`\d{4}-\d{2}-\d{2}`,
  ];
  const hallados: { pos: number; texto: string }[] = [];
  for (const forma of formas) {
    for (const m of t.matchAll(new RegExp(guarda + forma + cierre, "g"))) {
      hallados.push({ pos: m.index, texto: m[0] });
    }
  }
  return hallados.sort((a, b) => a.pos - b.pos).map((h) => h.texto);
}

/**
 * Lee una fecha de un texto que puede traerla adentro.
 *
 * Los documentos de verdad no traen la fecha sola. La factura dice «Montevideo, April 08th, 2025»
 * y el conocimiento de embarque «Place and date of issue: Montevideo, 08 APR 2025», porque el
 * lugar y la fecha de emisión son un mismo campo en el formulario. Antes se exigía que el texto
 * fuera la fecha, así que el packing del expediente CSU2025099 quedaba «sin fecha legible» y la
 * regla del 47A —fechado el día del crédito o después— no se podía decidir. El formato ya estaba
 * soportado: lo que faltaba era encontrarlo.
 *
 * Primero se prueba el texto entero, que es el caso limpio y el que llega desde la base. Solo si
 * eso falla se busca adentro, y de los candidatos gana el primero que sea una fecha válida: el
 * primero de izquierda a derecha, que en un «place and date of issue» es el que corresponde.
 */
export function parseFecha(s: string): Date | null {
  const exacta = fechaExacta(s);
  if (exacta) return exacta;
  const t = s
    .trim()
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, "$1")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ");
  for (const c of candidatos(t)) {
    const f = fechaExacta(c);
    if (f) return f;
  }
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
