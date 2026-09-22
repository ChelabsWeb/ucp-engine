import type { ResultadoExamen } from "./examen";
import { fmtFecha } from "./fechas";
import { sumarHabiles } from "./lc";
import type { ReglaPresentacion } from "./presentacion";
import type { LcInfo } from "./types";

/**
 * El papel que el examinador firma, y el aviso que el banco manda si rechaza.
 *
 * El examen produce hallazgos; esto los convierte en los dos documentos que de verdad
 * salen del escritorio: la hoja de revisión que queda en el expediente, y —cuando hay
 * discrepancias— el aviso del artículo 16, que tiene forma obligatoria y plazo.
 *
 * El artículo 16(c) es muy concreto sobre qué tiene que decir ese aviso: que el banco
 * rechaza, **cada** discrepancia por la que rechaza, y qué está haciendo con los
 * documentos. El 16(d) da el plazo: a más tardar al cierre del quinto día hábil siguiente
 * al de la presentación. Y el 16(f) es la razón por la que esto importa tanto: un banco
 * que no avisa en forma y en plazo **pierde el derecho a alegar que los documentos no
 * cumplían**.
 */

/* ──────────────────────────── la hoja de revisión ──────────────────────────── */

export interface EncabezadoChecking {
  /** quién presentó los documentos */
  presentador?: string | null;
  /** quién examina */
  examinador?: string | null;
  /** cuándo se presentaron */
  fechaPresentacion: Date;
}

const GRUPO: [RegExp, string][] = [
  [/^46A/, "Documentos exigidos (campo 46A)"],
  [/^47A/, "Condiciones adicionales (campo 47A)"],
  [/^ISBP/, "Práctica bancaria estándar"],
  [/^UCP 600 14d/, "Consistencia entre documentos"],
  [/^UCP 600/, "Reglas de las UCP 600"],
  [/^(48|44C)/, "Plazos"],
  [/^(32B|39A|59)/, "Importe y beneficiario"],
];

function grupoDe(fuente: string): string {
  for (const [re, nombre] of GRUPO) if (re.test(fuente)) return nombre;
  return "Otros";
}

const MARCA: Record<ReglaPresentacion["estado"], string> = {
  OK: "[ok]",
  DISCREPANCIA: "[DISCREPANCIA]",
  FALTA: "[FALTA]",
  ATENCION: "[verificar]",
  SIN_DATO: "[sin dato]",
};

/**
 * La hoja de revisión, en texto plano.
 *
 * Se imprime, se archiva o se pega en un correo tal cual. Cada renglón lleva el campo o
 * el artículo que lo funda, porque es lo que el examinador necesita si después tiene que
 * defender su decisión.
 */
export function checkingList(lc: LcInfo, r: ResultadoExamen, enc: EncabezadoChecking): string {
  const L: string[] = [];
  const linea = (s = "") => L.push(s);

  linea("HOJA DE REVISIÓN DOCUMENTAL");
  linea("===========================");
  linea();
  linea(`Crédito documentario  ${lc.numero}`);
  linea(`Banco emisor          ${lc.bancoEmisor}`);
  if (lc.monto !== null && lc.monto !== undefined) {
    linea(`Importe               ${lc.moneda ?? ""} ${lc.monto.toLocaleString("es-UY", { minimumFractionDigits: 2 })}`);
  }
  linea(`Vencimiento           ${lc.vencimiento}`);
  if (enc.presentador) linea(`Presentado por        ${enc.presentador}`);
  linea(`Fecha de presentación ${fmtFecha(enc.fechaPresentacion)}`);
  linea(
    `Plazo de examen       hasta el ${fmtFecha(sumarHabiles(enc.fechaPresentacion, 5))} (5 días hábiles, UCP 600 art. 14b)`,
  );
  linea();

  linea("RESULTADO");
  linea("---------");
  linea(`Renglones examinados  ${r.reglas.length}`);
  linea(`Discrepancias         ${r.discrepancias}`);
  linea(`Documentos faltantes  ${r.faltan}`);
  linea(`A verificar a mano    ${r.atencion}`);
  if (r.diasParaPresentar !== null) {
    linea(
      r.diasParaPresentar >= 0
        ? `Plazo de presentación quedan ${r.diasParaPresentar} días`
        : `Plazo de presentación VENCIDO hace ${-r.diasParaPresentar} días`,
    );
  }
  if (r.feePorJuego !== null) linea(`Cargo por juego con discrepancias  ${lc.moneda ?? ""} ${r.feePorJuego}`);
  linea();

  const grupos = new Map<string, ReglaPresentacion[]>();
  for (const x of r.reglas) {
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
    linea("CÓMO SE LEYERON ALGUNAS CIFRAS");
    linea("------------------------------");
    for (const a of r.avisosDeLectura) linea(`  ${a}`);
    linea();
  }

  if (r.manuales.length > 0) {
    linea("LO QUE ESTA REVISIÓN NO COMPRUEBA");
    linea("---------------------------------");
    linea("No se resuelven leyendo un escaneo. Verificar sobre el papel antes de firmar.");
    for (const m of r.manuales) linea(`  · ${m.que} (${m.fuente})`);
    linea();
  }

  linea("Examinado por: ".padEnd(40, ".") + `  ${enc.examinador ?? ""}`);
  linea("Fecha y firma: ".padEnd(40, "."));
  linea();
  linea("Esta hoja recoge el resultado de una revisión asistida. La decisión de honrar, negociar o");
  linea("rechazar la presentación corresponde al examinador que firma.");
  return L.join("\n");
}

/* ─────────────────────────── el aviso de rechazo ─────────────────────────── */

/** Qué hace el banco con los documentos, en los términos del artículo 16(c)(iii). */
export type DestinoDocumentos =
  | "RETIENE_ESPERANDO_INSTRUCCIONES"
  | "RETIENE_ESPERANDO_DISPENSA"
  | "DEVUELVE"
  | "SEGUN_INSTRUCCIONES_PREVIAS";

const TEXTO_DESTINO: Record<DestinoDocumentos, string> = {
  RETIENE_ESPERANDO_INSTRUCCIONES: "Mantenemos los documentos en nuestro poder a la espera de sus instrucciones.",
  RETIENE_ESPERANDO_DISPENSA:
    "Mantenemos los documentos en nuestro poder hasta recibir dispensa del ordenante y aceptarla, o hasta recibir instrucciones suyas anteriores a esa aceptación.",
  DEVUELVE: "Les devolvemos los documentos.",
  SEGUN_INSTRUCCIONES_PREVIAS: "Procedemos conforme a las instrucciones que nos cursaron oportunamente.",
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
 * Tiene que decir tres cosas y las tres van: que se rechaza, **cada** discrepancia por la
 * que se rechaza, y qué se hace con los documentos. Un aviso incompleto o tardío le hace
 * perder al banco el derecho a alegar el incumplimiento (art. 16f), así que el plazo se
 * calcula y se avisa si ya pasó.
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
  const motivos = r.reglas.filter((x) => x.estado === "DISCREPANCIA" || x.estado === "FALTA");
  if (motivos.length === 0) return null;

  const limite = sumarHabiles(opciones.fechaPresentacion, 5);
  const L: string[] = [];
  const linea = (s = "") => L.push(s);

  linea(`AVISO DE RECHAZO — CRÉDITO DOCUMENTARIO ${lc.numero}`);
  linea();
  if (opciones.presentador) linea(`A: ${opciones.presentador}`);
  if (opciones.banco) linea(`De: ${opciones.banco}`);
  linea(`Fecha: ${fmtFecha(opciones.hoy)}`);
  linea(`Presentación recibida el ${fmtFecha(opciones.fechaPresentacion)}`);
  linea();
  linea("Conforme al artículo 16 de las UCP 600 les comunicamos que RECHAZAMOS honrar o");
  linea("negociar la presentación referida, por las siguientes discrepancias:");
  linea();
  motivos.forEach((m, i) => {
    linea(`${String(i + 1).padStart(2, " ")}. ${m.regla}`);
    linea(`    ${m.evidencia}`);
    linea(`    (${m.fuente})`);
  });
  linea();
  linea(TEXTO_DESTINO[opciones.destino]);
  linea();
  linea("Este aviso se cursa dentro del plazo del artículo 16(d) de las UCP 600.");

  return {
    texto: L.join("\n"),
    discrepancias: motivos.length,
    limite,
    fueraDePlazo: opciones.hoy > limite,
  };
}
