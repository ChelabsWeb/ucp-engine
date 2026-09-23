import type { ResultadoExamen } from "./examen";
import { fmtFechaEn } from "./fechas";
import { manualEnIngles, reglaEnIngles, textoEnIngles } from "./ingles";
import { sumarHabiles } from "./lc";
import type { ReglaPresentacion } from "./presentacion";
import type { LcInfo } from "./types";

/**
 * El papel que el examinador firma, y el aviso que el banco manda si rechaza.
 *
 * El examen produce hallazgos; esto los convierte en los dos documentos que de verdad salen del
 * escritorio: la hoja de revisión que queda en el expediente, y —cuando hay discrepancias— el
 * aviso del artículo 16, que tiene forma obligatoria y plazo.
 *
 * El artículo 16(c) es muy concreto sobre qué tiene que decir ese aviso: que el banco rechaza,
 * **cada** discrepancia por la que rechaza, y qué está haciendo con los documentos. El 16(d) da
 * el plazo: a más tardar al cierre del quinto día hábil siguiente al de la presentación. Y el
 * 16(f) es la razón por la que esto importa tanto: un banco que no avisa en forma y en plazo
 * **pierde el derecho a alegar que los documentos no cumplían**.
 *
 * Dos decisiones sobre estos textos:
 *
 * 1. **Van en inglés, fechas y hallazgos incluidos**, aunque el código esté en español. Los textos
 *    de los hallazgos los traduce `ingles.ts`, con un test que exige cobertura sobre el expediente
 *    real: una regla nueva sin traducir hace fallar la suite antes de llegar a un aviso. El aviso se transmite al banco
 *    presentador, que puede estar en Colombo o en Londres, y por telecomunicación (el MT734 de
 *    SWIFT existe justamente para esto). Un aviso en español no le sirve a quien lo recibe, y
 *    el 16(c) exige que diga cosas concretas: si el destinatario no las entiende, no las dijo.
 * 2. **Ninguno de los dos afirma nada que no sea verdad.** El aviso afirmaba «se cursa dentro
 *    del plazo del artículo 16(d)» de manera incondicional, incluso emitido tres semanas tarde.
 *    Esa frase es exactamente la que un tribunal o un banco corresponsal va a leer, y era falsa
 *    justo en el caso en que más importa. Ahora el texto dice en qué situación está de verdad,
 *    y cuando está tarde nombra el 16(f), que es la consecuencia.
 */

/* ──────────────────────────── la hoja de revisión ──────────────────────────── */

/**
 * Corta un párrafo a 96 columnas por palabras.
 *
 * Estos textos se pegan en un correo, se imprimen o se transmiten tal cual. Una línea de 300
 * caracteres —como el destino del 16(c)(iii), que sigue la letra del artículo y es larga— llega
 * cortada de cualquier manera del otro lado.
 */
function envolver(texto: string, columnas = 96): string[] {
  const out: string[] = [];
  let actual = "";
  for (const palabra of texto.split(/\s+/)) {
    if (actual === "") actual = palabra;
    else if (`${actual} ${palabra}`.length <= columnas) actual = `${actual} ${palabra}`;
    else {
      out.push(actual);
      actual = palabra;
    }
  }
  if (actual) out.push(actual);
  return out;
}

export interface EncabezadoChecking {
  /** quién presentó los documentos */
  presentador?: string | null;
  /** quién examina */
  examinador?: string | null;
  /** cuándo se presentaron */
  fechaPresentacion: Date;
}

const GRUPO: [RegExp, string][] = [
  [/^46A/, "Documents required (field 46A)"],
  [/^47A/, "Additional conditions (field 47A)"],
  [/^ISBP/, "Standard banking practice"],
  [/^UCP 600 14d/, "Consistency between documents"],
  [/^UCP 600/, "UCP 600 rules"],
  [/^(48|44C)/, "Time limits"],
  [/^(32B|39A|59)/, "Amount and beneficiary"],
];

function grupoDe(fuente: string): string {
  for (const [re, nombre] of GRUPO) if (re.test(fuente)) return nombre;
  return "Other";
}

const MARCA: Record<ReglaPresentacion["estado"], string> = {
  OK: "[ok]",
  DISCREPANCIA: "[DISCREPANCY]",
  FALTA: "[MISSING]",
  ATENCION: "[check]",
  SIN_DATO: "[no data]",
};

/**
 * La hoja de revisión, en texto plano.
 *
 * Se imprime, se archiva o se pega en un correo tal cual. Cada renglón lleva el campo o el
 * artículo que lo funda, porque es lo que el examinador necesita si después tiene que defender
 * su decisión. Y trae **todos** los renglones, no solo los hallazgos: la hoja es la constancia
 * de qué se miró, y una que solo listara problemas no dejaría ver qué quedó comprobado.
 */
export function checkingList(lc: LcInfo, r: ResultadoExamen, enc: EncabezadoChecking): string {
  const L: string[] = [];
  const linea = (s = "") => L.push(s);
  const num = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });

  linea("DOCUMENT EXAMINATION SHEET");
  linea("==========================");
  linea();
  linea(`Documentary credit    ${lc.numero}`);
  if (lc.bancoEmisor) linea(`Issuing bank          ${lc.bancoEmisor}`);
  if (lc.monto !== null && lc.monto !== undefined) {
    linea(`Amount                ${lc.moneda ?? ""} ${num(lc.monto)}`);
  }
  if (lc.vencimiento) linea(`Expiry                ${lc.vencimiento}`);
  if (enc.presentador) linea(`Presented by          ${enc.presentador}`);
  linea(`Date of presentation  ${fmtFechaEn(enc.fechaPresentacion)}`);
  linea(
    `Examination period    until ${fmtFechaEn(sumarHabiles(enc.fechaPresentacion, 5))} (5 banking days, UCP 600 art. 14(b))`,
  );
  linea();

  linea("RESULT");
  linea("------");
  linea(`Items examined        ${r.reglas.length}`);
  linea(`Discrepancies         ${r.discrepancias}`);
  linea(`Missing documents     ${r.faltan}`);
  linea(`To check by hand      ${r.atencion}`);
  if (r.diasParaPresentar !== null) {
    linea(
      r.diasParaPresentar >= 0
        ? `Presentation period   ${r.diasParaPresentar} days left`
        : `Presentation period   EXPIRED ${-r.diasParaPresentar} days ago`,
    );
  }
  if (r.feePorJuego !== null) linea(`Discrepancy fee       ${lc.moneda ?? ""} ${r.feePorJuego} per set`);
  linea();

  const grupos = new Map<string, ReglaPresentacion[]>();
  for (const cru of r.reglas) {
    const x = reglaEnIngles(cru);
    const g = grupoDe(x.fuente);
    const lista = grupos.get(g) ?? [];
    lista.push(x);
    grupos.set(g, lista);
  }
  for (const [g, items] of grupos) {
    linea(g.toUpperCase());
    linea("-".repeat(g.length));
    for (const x of items) {
      linea(`${MARCA[x.estado].padEnd(15)} ${x.fuente.padEnd(24)} ${x.regla}`);
      if (x.evidencia) linea(`${" ".repeat(16)}${x.evidencia}`);
    }
    linea();
  }

  if (r.avisosDeLectura.length > 0) {
    linea("HOW SOME FIGURES WERE READ");
    linea("--------------------------");
    for (const a of r.avisosDeLectura) linea(`  ${textoEnIngles(a)}`);
    linea();
  }

  if (r.manuales.length > 0) {
    linea("WHAT THIS EXAMINATION DOES NOT CHECK");
    linea("------------------------------------");
    linea("These cannot be settled by reading a scan. Check them on the paper before signing.");
    for (const cru of r.manuales) {
      const m = manualEnIngles(cru);
      linea(`  · ${m.que} (${m.fuente})`);
    }
    linea();
  }

  linea("Examined by: ".padEnd(40, ".") + `  ${enc.examinador ?? ""}`);
  linea("Date and signature: ".padEnd(40, "."));
  linea();
  linea("This sheet records the result of an assisted examination. The decision to honour, negotiate");
  linea("or refuse the presentation rests with the examiner who signs it.");
  return L.join("\n");
}

/* ─────────────────────────── el aviso de rechazo ─────────────────────────── */

/** Qué hace el banco con los documentos, en los términos del artículo 16(c)(iii). */
export type DestinoDocumentos =
  | "RETIENE_ESPERANDO_INSTRUCCIONES"
  | "RETIENE_ESPERANDO_DISPENSA"
  | "DEVUELVE"
  | "SEGUN_INSTRUCCIONES_PREVIAS";

/**
 * Los cuatro destinos son los del 16(c)(iii), y el texto de cada uno sigue de cerca la letra del
 * artículo: es lo único que el artículo admite decir, y una redacción propia que se aparte puede
 * hacer que el aviso no cumpla.
 */
const TEXTO_DESTINO: Record<DestinoDocumentos, string> = {
  RETIENE_ESPERANDO_INSTRUCCIONES: "We are holding the documents pending further instructions from you.",
  RETIENE_ESPERANDO_DISPENSA:
    "We are holding the documents until we receive a waiver from the applicant and agree to accept it, or until we receive further instructions from you prior to agreeing to accept a waiver.",
  DEVUELVE: "We are returning the documents to you.",
  SEGUN_INSTRUCCIONES_PREVIAS: "We are acting in accordance with instructions previously received from you.",
};

export interface AvisoRechazo {
  /** el texto listo para transmitir */
  texto: string;
  /** cuántas discrepancias se invocan */
  discrepancias: number;
  /** el último día hábil para transmitirlo (UCP 600 art. 16d) */
  limite: Date;
  /** true si al generarlo ya se pasó el plazo */
  fueraDePlazo: boolean;
}

/**
 * El aviso único del artículo 16(c).
 *
 * Tiene que decir tres cosas y las tres van, en este orden: que se rechaza, **cada** discrepancia
 * por la que se rechaza, y qué se hace con los documentos. Un aviso incompleto o tardío le hace
 * perder al banco el derecho a alegar el incumplimiento (art. 16f), así que el plazo se calcula y
 * el texto dice en qué situación está de verdad.
 *
 * Devuelve `null` si no hay nada que rechazar: un aviso sin discrepancias no existe.
 */
export function avisoDeRechazo(
  lc: LcInfo,
  r: ResultadoExamen,
  opciones: {
    fechaPresentacion: Date;
    hoy: Date;
    destino: DestinoDocumentos;
    presentador?: string | null;
    banco?: string | null;
  },
): AvisoRechazo | null {
  const motivos = r.reglas
    .filter((x) => x.estado === "DISCREPANCIA" || x.estado === "FALTA")
    // Cada discrepancia invocada va en inglés: el 16(c) exige que esté expresada, y una que el
    // destinatario no entiende no está expresada.
    .map(reglaEnIngles);
  if (motivos.length === 0) return null;

  const limite = sumarHabiles(opciones.fechaPresentacion, 5);
  // El 16(d) dice «al cierre del quinto día hábil», así que el propio día del límite está en
  // plazo. Ambas fechas son de calendario, sin hora, y la comparación es por día.
  const fueraDePlazo = opciones.hoy.getTime() > limite.getTime();

  const L: string[] = [];
  const linea = (s = "") => L.push(s);

  linea(`NOTICE OF REFUSAL — DOCUMENTARY CREDIT ${lc.numero}`);
  linea();
  if (opciones.presentador) linea(`To:      ${opciones.presentador}`);
  if (opciones.banco) linea(`From:    ${opciones.banco}`);
  linea(`Date:    ${fmtFechaEn(opciones.hoy)}`);
  linea(`Presentation received on ${fmtFechaEn(opciones.fechaPresentacion)}`);
  linea();

  // i) que el banco rechaza honrar o negociar
  linea("Under article 16 of UCP 600 we hereby give notice that we are REFUSING to honour or");
  linea("negotiate the presentation referred to above, on account of the following discrepancies:");
  linea();

  // ii) cada discrepancia por la que rechaza
  motivos.forEach((m, i) => {
    linea(`${String(i + 1).padStart(2, " ")}. ${m.regla}`);
    if (m.evidencia) linea(`    ${m.evidencia}`);
    linea(`    (${m.fuente})`);
  });
  linea();

  // iii) qué hace con los documentos
  for (const l of envolver(`${TEXTO_DESTINO[opciones.destino]} (UCP 600 art. 16(c)(iii))`)) linea(l);
  linea();

  // El plazo, diciendo la verdad sobre en qué situación está este aviso.
  if (fueraDePlazo) {
    linea(`WARNING — The time limit under UCP 600 art. 16(d) expired on ${fmtFechaEn(limite)}.`);
    linea("This notice is being given after the time limit. Under art. 16(f) a bank that fails to act");
    linea("in accordance with article 16 is not entitled to claim that the documents do not constitute");
    linea("a complying presentation. Consider this before transmitting.");
  } else {
    linea(`This notice is given within the time limit of UCP 600 art. 16(d), which runs until`);
    linea(`${fmtFechaEn(limite)} — the fifth banking day following the day of presentation.`);
  }
  linea();

  // Dos avisos al que firma, que no son parte del 16(c) pero cambian lo que tiene que hacer.
  linea("Notes for the sender, not part of the notice:");
  linea("· This is the single notice required by art. 16(c). Any discrepancy not stated above cannot");
  linea("  be raised later in respect of this presentation.");
  linea("· The time limit above counts Saturdays and Sundays as non-banking days and does not know");
  linea("  about bank holidays in your jurisdiction. Check the calendar before relying on it.");

  return { texto: L.join("\n"), discrepancias: motivos.length, limite, fueraDePlazo };
}

/* ─────────────────────── el reloj del artículo 16 ─────────────────────── */

export interface PlazoDeAviso {
  /** el último día hábil para transmitir el aviso (art. 16d) */
  limite: Date;
  /** cuántos días hábiles quedan contando hoy; 0 = hoy es el último; negativo = ya venció */
  habilesRestantes: number;
  vencido: boolean;
}

/**
 * Cuánto falta para que se cierre el plazo del artículo 16(d).
 *
 * Es la cuenta que decide si el banco todavía puede rechazar. Al quinto día hábil siguiente a la
 * presentación, al cierre, el derecho se pierde (art. 16f) y los documentos quedan honrados por
 * omisión, con discrepancias y todo. Por eso el número tiene que estar a la vista y no escondido
 * dentro de un documento que hay que generar para enterarse.
 *
 * `habilesRestantes` cuenta el día de hoy: si hoy es el último día, devuelve 0, no 1. Y los
 * feriados bancarios no se conocen, así que un 1 puede ser en realidad un 0.
 */
export function plazoDeAviso(fechaPresentacion: Date, hoy: Date): PlazoDeAviso {
  const limite = sumarHabiles(fechaPresentacion, 5);
  const dia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const h = dia(hoy);
  const l = dia(limite);

  if (h.getTime() > l.getTime()) {
    // cuántos hábiles se pasó, en negativo
    let pasados = 0;
    const cursor = new Date(l);
    while (cursor.getTime() < h.getTime()) {
      cursor.setDate(cursor.getDate() + 1);
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) pasados += 1;
    }
    return { limite, habilesRestantes: -pasados, vencido: true };
  }

  let quedan = 0;
  const cursor = new Date(h);
  while (cursor.getTime() < l.getTime()) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) quedan += 1;
  }
  return { limite, habilesRestantes: quedan, vencido: false };
}
