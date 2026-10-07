import type { CamposDoc, RequisitosLC } from "./consistencia";
import { fmtFecha } from "./fechas";
import { parseTolerancia } from "./lc";
import type { LcInfo } from "./types";

/**
 * Parser DETERMINISTA de cartas de crédito en formato SWIFT (MT700 / MT710; un MT707 —enmienda—
 * tiene otra semántica en el campo 21 y NO se parsea con esto).
 *
 * Caso de referencia CSU2025099: el banco avisador (Litoral) reenvía por mail el mensaje SWIFT tal
 * cual, con los campos numerados (31D, 44C, 46A, 47A, 48…). Eso no necesita IA: se parsea y
 * listo — gratis, exacto y sin alucinaciones. La IA queda para las LC escaneadas o en prosa.
 *
 * Soporta las dos formas habituales:
 *   :31D:250630URUGUAY                      (raw)
 *   31D: Date and Place of Expiry\n 250630 URUGUAY   (como lo imprimen los bancos)
 */

export interface CampoSwift {
  tag: string;
  lineas: string[];
}

const RE_TAG = /^\s*:?(\d{2}[A-Z]?)\s*:\s*(.*)$/;
/* la primera línea de un campo "impreso" es su nombre en inglés (sin dígitos) */
const RE_ETIQUETA = /^['"]?[A-Za-z][A-Za-z' ",./&()-]*$/;

/** ¿Parece un mensaje SWIFT? Al menos tres campos MT7xx conocidos. */
export function esMensajeSwift(texto: string): boolean {
  const tags = new Set<string>();
  for (const l of texto.split(/\r?\n/)) {
    const m = RE_TAG.exec(l);
    if (m && CONOCIDOS.has(m[1])) tags.add(m[1]);
  }
  return tags.size >= 3;
}

// incluye los campos propios del MT707 (enmienda): 26E número, 30 fecha, 31E nuevo vencimiento,
// 33B/34B monto, 46B/47B agregados y 79 texto libre — sin ellos el tokenizador los pegaba al campo anterior
const CONOCIDOS = new Set([
  "27",
  "40A",
  "40B",
  "40E",
  "20",
  "21",
  "23",
  "26E",
  "30",
  "31C",
  "31D",
  "31E",
  "32B",
  "33B",
  "34B",
  "39A",
  "39B",
  "39C",
  "41A",
  "41D",
  "42C",
  "42A",
  "42D",
  "42P",
  "43P",
  "43T",
  "44A",
  "44E",
  "44F",
  "44B",
  "44C",
  "44D",
  "45A",
  "46A",
  "46B",
  "47A",
  "47B",
  "48",
  "49",
  "50",
  "51A",
  "52A",
  "52D",
  "53A",
  "57A",
  "57D",
  "59",
  "71B",
  "71D",
  "72Z",
  "78",
  "79",
]);

/** Separa el mensaje en campos {tag, lineas}. Lo que no pertenece a un campo se ignora. */
export function tokenizarSwift(texto: string): CampoSwift[] {
  const campos: CampoSwift[] = [];
  let actual: CampoSwift | null = null;
  for (const cruda of texto.split(/\r?\n/)) {
    const m = RE_TAG.exec(cruda);
    if (m && CONOCIDOS.has(m[1])) {
      actual = { tag: m[1], lineas: [] };
      campos.push(actual);
      const resto = m[2].trim();
      // SOLO en la forma impresa (sin ':' inicial) lo que sigue al tag es el NOMBRE del campo; en la
      // forma raw ":59:CEREALSUR S.A" es el valor (revisión 8-sep: se descartaba "IRREVOCABLE", "SIGHT"…)
      const impresa = !/^\s*:/.test(cruda);
      if (resto && !(impresa && RE_ETIQUETA.test(resto))) actual.lineas.push(resto);
      continue;
    }
    // fin del bloque de texto SWIFT (trailer) → no seguir capturando
    if (/^-{5,}\s*Message Trailer/i.test(cruda) || /^\{CHK:/.test(cruda.trim())) {
      actual = null;
      continue;
    }
    if (actual) {
      const l = cruda.trim();
      if (l) actual.lineas.push(l);
    }
  }
  return campos;
}

const campo = (cs: CampoSwift[], tag: string): string[] | null => cs.find((c) => c.tag === tag)?.lineas ?? null;
const texto = (cs: CampoSwift[], tag: string): string => (campo(cs, tag) ?? []).join(" ").replace(/\s+/g, " ").trim();

/** YYMMDD → "30-jun-25"; null si no es una fecha. */
export function fechaSwift(v: string | undefined | null): string | null {
  const m = /(\d{2})(\d{2})(\d{2})/.exec(v ?? "");
  if (!m) return null;
  const y = 2000 + Number(m[1]),
    mo = Number(m[2]) - 1,
    d = Number(m[3]);
  const f = new Date(y, mo, d);
  if (f.getMonth() !== mo || f.getDate() !== d) return null;
  return fmtFecha(f);
}

/** "#54.150,00#" · "USD54150,00" · "54,150.00" → 54150. Coma decimal SWIFT, puntos de miles. */
export function montoSwift(v: string): { moneda: string | null; monto: number | null } {
  const moneda = /(?<![A-Za-z])([A-Z]{3})(?![A-Za-z])/.exec(v.replace(/\(.*?\)/g, ""))?.[1] ?? null;
  const num = /([\d][\d.,']*)/.exec(v.replace(/[A-Z()#: ]+(?=\d)/g, " "))?.[1] ?? null;
  if (!num) return { moneda, monto: null };
  let s = num.replace(/'/g, "");
  // SWIFT puro: la coma es el decimal ("54150,00"). Forma impresa: "#54.150,00#" o, en bancos
  // anglosajones, "54,150.00" — con los dos separadores, el ÚLTIMO es el decimal (revisión 8-sep)
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    // solo comas: decimal si el último grupo tiene 1-2 dígitos ("54150,00"); si no, miles ("1,234,567")
    s = /,\d{1,2}$/.test(s) ? s.replace(/,(?=\d{3}(,|$))/g, "").replace(",", ".") : s.replace(/,/g, "");
  }
  // sin coma: "54,150.00" no aplica; "54150.00" → tal cual; "54.150" (miles europeos) → ambiguo: si el
  // grupo tras el punto tiene 3 dígitos y no hay más puntos, se toma como miles
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return { moneda, monto: Number.isFinite(n) ? n : null };
}

/** Lista "+1) … +2) …" (46A/47A) → ítems; las líneas de continuación se pegan al anterior. */
export function listaSwift(lineas: string[] | null): string[] {
  if (!lineas) return [];
  const out: string[] = [];
  for (const l of lineas) {
    const m = /^\+?\s*(\d{1,2})[).]\s*(.*)$/.exec(l) ?? /^\+\s*(.*)$/.exec(l);
    if (m) out.push((m[2] ?? m[1]).trim());
    else if (out.length) out[out.length - 1] = `${out[out.length - 1]} ${l}`.replace(/\s+/g, " ");
    else out.push(l);
  }
  return out.map((s) => s.replace(/\s+/g, " ").replace(/\s+\./g, ".").trim()).filter(Boolean);
}

/** "Sender : NUBKGB2LXXX \n NORTHERN UNION BANK \n LONDON GB" → el nombre (línea siguiente al BIC). */
function senderDelHeader(texto: string): string | null {
  const lineas = texto.split(/\r?\n/);
  const i = lineas.findIndex((l) => /^\s*Sender\s*:/i.test(l));
  if (i === -1) return null;
  for (const l of lineas.slice(i + 1, i + 4)) {
    const t = l.trim();
    if (t && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(t) && !/^Receiver/i.test(t)) return t;
  }
  return null;
}

/** El nombre de un banco en 52A/57A: la línea que no es BIC (8 u 11 mayúsculas/dígitos). */
function nombreBanco(lineas: string[] | null): string | null {
  if (!lineas) return null;
  const sinBic = lineas.filter((l) => !ES_BIC.test(l.trim()));
  return sinBic[0]?.trim() || null;
}

/** La forma de un BIC: ocho caracteres, u once con el código de sucursal. */
const ES_BIC = /^[A-Z0-9]{8}([A-Z0-9]{3})?$/;

/**
 * El BIC de un campo de banco (52A, 57A, 41A), que es la primera línea.
 *
 * Hace falta además del nombre porque el nombre varía —«BANCO LITORAL (URUGUAY) S.A.» contra
 * «BANCO LITORAL URUGUAY SA»— y el BIC no. Con él se puede decir qué papel juega el banco que
 * examina, que es lo que decide qué le exigen las UCP.
 */
function bicDeCampo(lineas: string[] | null): string | null {
  return lineas?.map((l) => l.trim()).find((l) => ES_BIC.test(l)) ?? null;
}

/** El BIC del destinatario del mensaje, del encabezado. */
function receptorDelHeader(texto: string): string | null {
  const i = texto.search(/Receiver\s*:/i);
  if (i < 0) return null;
  for (const l of texto.slice(i).split("\n").slice(0, 3)) {
    const t = l.replace(/^.*Receiver\s*:/i, "").trim();
    if (ES_BIC.test(t)) return t;
  }
  return null;
}

export interface LcSwift {
  /** lo que va a la operación (letters_of_credit) */
  lc: LcInfo;
  /** lo que exige (para cotejar con el checklist) */
  requisitos: RequisitosLC;
  /** los campos comparables (para la matriz de consistencia) */
  campos: CamposDoc;
  /** extras útiles que la operación todavía no modela */
  extra: {
    tipoMensaje: string | null; // MT700 / MT710 …
    fechaEmision: string | null;
    /**
     * El 31D trae fecha **y lugar**: «250630 URUGUAY».
     *
     * Dónde vence no es un adorno: si el crédito vence en el país del emisor, los documentos no
     * alcanzan con salir a tiempo, tienen que **llegar** allá antes de esa fecha, y el courier son
     * entre tres y cinco días que nadie descuenta hasta que es tarde. Estaba en romai y se perdió al
     * armar el motor; vuelve porque la regla que lo usa —«vence afuera»— es del beneficiario, que es
     * quien manda los papeles.
     */
    lugarVencimiento: string | null;
    formaCredito: string | null; // IRREVOCABLE …
    confirmacion: string | null; // WITHOUT / CONFIRM
    disponibleCon: string | null; // 41D/41A
    /** 52A: el BIC del banco emisor */
    bicEmisor: string | null;
    /** 57A: el BIC del banco a través del cual se avisa */
    bicAvisador: string | null;
    /** 41A: el BIC del banco con el que el crédito está disponible, cuando lo nombra por BIC */
    bicDisponibleCon: string | null;
    /** el BIC a quien se mandó el mensaje, del encabezado */
    bicReceptor: string | null;
    /**
     * 53A: el banco al que el designado le reclama su reembolso.
     *
     * Si está, el artículo 13 se aplica: el crédito tiene que decir si el reembolso se sujeta a las
     * URR 725, y hay una condición que no puede poner.
     */
    bancoReembolsador: string | null;
    /** 78: instrucciones al banco pagador, aceptante o negociador */
    instruccionesAlBanco: string | null;
    giros: string | null; // 42C: SIGHT / 90 DAYS …
    parciales: string | null;
    transbordo: string | null;
    condicionesAdicionales: string[]; // 47A
    cargos: string | null; // 71D/71B
    aplicante: string[]; // 50 completo (dirección incluida)
    beneficiario: string[]; // 59 completo
    reglas: string | null; // 40E
    /** 72Z y 79: de acá sale si el mensaje dice que el crédito operativo sigue (art. 11 a) */
    infoAlDestinatario: string | null;
  };
}

/** El lugar del 31D, que viene pegado a la fecha: «250630 URUGUAY» → «URUGUAY». */
export function lugarDe(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const sinFecha = t.replace(/^\s*\d{6}\s*/, "").trim();
  return sinFecha || null;
}

const seguro = (valor: string | null | undefined, confianza = 1): { valor: string; confianza: number } =>
  valor && valor.trim() ? { valor: valor.trim(), confianza } : { valor: "", confianza: 0 };

/**
 * Parsea un MT700/MT710. Devuelve null si el texto no tiene la pinta de un SWIFT.
 * Confianza 1 en lo parseado (es determinista); 0 en lo que no aparece.
 */
export function parseMT700(textoSwift: string): LcSwift | null {
  if (!esMensajeSwift(textoSwift)) return null;
  const cs = tokenizarSwift(textoSwift);

  const numero = texto(cs, "21") || texto(cs, "20");
  const vencimientoRaw = texto(cs, "31D");
  const vencimiento = fechaSwift(vencimientoRaw);
  const limiteEmbarque = fechaSwift(texto(cs, "44C"));
  const emision = fechaSwift(texto(cs, "31C"));
  const { moneda, monto } = montoSwift(texto(cs, "32B"));

  // tolerancia: 39A "10/10" (más/menos) → la mayor; si no, buscarla en 47A ("TOLERANCE OF 10 PCT MORE OR LESS")
  const condiciones = listaSwift(campo(cs, "47A"));
  let tolerancia: number | null = null;
  const t39 = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(texto(cs, "39A"));
  if (t39) tolerancia = Math.max(Number(t39[1]), Number(t39[2])) / 100;
  else {
    const c = condiciones.find((x) => /toleran/i.test(x));
    if (c) tolerancia = parseTolerancia(c.replace(/pct/i, "%"));
  }

  /*
   * A qué se aplica la tolerancia, que el crédito dice y antes se ignoraba.
   *
   * «IN QUANTITY ONLY» con «AMOUNT NOT TO BE EXCEEDED» al lado es redacción corriente, y meterla en
   * un solo número que se aplicaba al importe admitía un giro 10 % por encima del monto. El 39A es
   * la tolerancia del importe del crédito, así que cuando viene por ahí rige para los dos salvo que
   * el 47A diga otra cosa.
   */
  const textoTolerancia = condiciones.filter((x) => /toleran|more or less/i.test(x)).join(" ");
  const soloCantidad = /\b(in\s+)?quantity\s+only\b|\bonly\s+in\s+quantity\b|\bsolo\s+en\s+cantidad\b/i.test(
    textoTolerancia,
  );
  const soloImporte =
    /\b(in\s+)?(value|amount)\s+only\b|\bonly\s+in\s+(value|amount)\b|\bsolo\s+en\s+(valor|importe)\b/i.test(
      textoTolerancia,
    );
  const toleranciaAplicaA = soloCantidad ? "CANTIDAD" : soloImporte ? "IMPORTE" : "AMBAS";

  const dias = /(\d{1,3})/.exec(texto(cs, "48"))?.[1] ?? null;
  const plazoPresentacion = dias ? `${dias} días desde la fecha de embarque (campo 48)` : "";

  const docs = listaSwift(campo(cs, "46A"));
  const bienes = (campo(cs, "45A") ?? []).join(" ").replace(/\s+/g, " ").trim();
  const cant = /(\d[\d.,]*)\s*(MTS?|MT|TONS?|TONNES?|KGS?|KILOS?|MTON)\b/i.exec(bienes);
  const incoterm = /\b(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)\b/.exec(bienes)?.[1] ?? null;
  const puertoEmb = texto(cs, "44E") || texto(cs, "44A");
  const puertoDest = texto(cs, "44F") || texto(cs, "44B");
  const aplicante = campo(cs, "50") ?? [];
  const beneficiario = campo(cs, "59") ?? [];
  // el emisor es 52A; en un MT700 directo no viene 52A y el emisor es el Sender del header
  const bancoEmisor = nombreBanco(campo(cs, "52A") ?? campo(cs, "52D")) ?? senderDelHeader(textoSwift);
  const bancoAvisador = nombreBanco(campo(cs, "57A") ?? campo(cs, "57D"));
  const parciales = texto(cs, "43P") || null;

  const lc: LcInfo = {
    numero: numero || "—",
    bancoEmisor: bancoEmisor ?? "—",
    bancoAvisador: bancoAvisador ?? "—",
    vencimiento: vencimiento ?? "—",
    limiteEmbarque: limiteEmbarque ?? "—",
    plazoPresentacion: plazoPresentacion || "—",
    tolerancia,
    toleranciaAplicaA,
    documentosExigidos: docs.length ? docs : null,
    condicionesAdicionales: condiciones.length ? condiciones : null,
    fechaEmision: emision,
    monto,
    moneda,
    giros: texto(cs, "42C") || null,
    librado: nombreBanco(campo(cs, "42D") ?? campo(cs, "42A")),
    // La primera línea del 59 es la razón social; de la segunda en adelante, la dirección.
    beneficiario: beneficiario[0]?.trim() || null,
    beneficiarioDireccion: beneficiario.slice(1).join(", ").replace(/\s+/g, " ").trim() || null,
    // un solo HS en el 45A → va a los ítems; con varios (carga mixta) no se adivina cuál es de cuál
    hsCode: (() => {
      const hs = [...bienes.matchAll(/HS\s*CODE\s*(?:NO\.?)?\s*[:.]?\s*([\d.]{4,12})/gi)].map((m) => m[1]);
      return hs.length === 1 ? hs[0] : null;
    })(),
  };
  const requisitos: RequisitosLC = {
    documentosExigidos: docs,
    limiteEmbarque: seguro(limiteEmbarque),
    vencimiento: seguro(vencimiento),
    plazoPresentacion: seguro(plazoPresentacion),
    toleranciaCantidad: seguro(tolerancia != null ? `±${Math.round(tolerancia * 1000) / 10}%` : null),
    parcialesPermitidos: seguro(parciales),
  };
  const campos: CamposDoc = {
    exportador: seguro(beneficiario[0]),
    importador: seguro(aplicante[0]),
    montoTotal: seguro(monto != null ? String(monto) : null),
    moneda: seguro(moneda),
    cantidad: seguro(cant?.[1] ?? null),
    unidad: seguro(cant?.[2] ?? null),
    mercaderia: seguro(bienes.split(/\s(?=CFR|CIF|FOB|HS CODE|INCOTERM)/i)[0]?.replace(/^\+?\s*\d\)\s*/, "") ?? null),
    puertoEmbarque: seguro(puertoEmb),
    puertoDestino: seguro(puertoDest),
    fechaEmbarque: seguro(limiteEmbarque),
    incoterm: seguro(incoterm),
    numeroDoc: seguro(numero),
  };
  const tipoMensaje = /FIN\s*(7\d\d)/.exec(textoSwift)?.[1] ?? null;
  return {
    lc,
    requisitos,
    campos,
    extra: {
      tipoMensaje: tipoMensaje ? `MT${tipoMensaje}` : null,
      fechaEmision: emision,
      lugarVencimiento: lugarDe(vencimientoRaw),
      formaCredito: texto(cs, "40B") || texto(cs, "40A") || null,
      confirmacion: texto(cs, "49") || null,
      disponibleCon: texto(cs, "41D") || texto(cs, "41A") || null,
      /*
       * Los BIC de los bancos que el crédito nombra, y el del destinatario del mensaje.
       *
       * De acá sale qué papel juega el banco que examina —emisor, designado, avisador— y eso decide
       * qué le exigen las UCP: el emisor tiene que honrar una presentación conforme (art. 7 a), un
       * designado que no confirmó **no** está obligado (art. 12 a) y un avisador que no está
       * designado no examina para honrar (art. 9). Son conclusiones distintas sobre el mismo juego
       * de papeles.
       */
      bicEmisor: bicDeCampo(campo(cs, "52A")),
      bicAvisador: bicDeCampo(campo(cs, "57A")),
      bicDisponibleCon: bicDeCampo(campo(cs, "41A")),
      bicReceptor: receptorDelHeader(textoSwift),
      bancoReembolsador: bicDeCampo(campo(cs, "53A")) ?? nombreBanco(campo(cs, "53A")),
      instruccionesAlBanco: texto(cs, "78") || null,
      giros: texto(cs, "42C") || null,
      parciales,
      transbordo: texto(cs, "43T") || null,
      condicionesAdicionales: condiciones,
      cargos: texto(cs, "71D") || texto(cs, "71B") || null,
      aplicante,
      beneficiario,
      reglas: texto(cs, "40E") || null,
      infoAlDestinatario: [texto(cs, "72Z"), texto(cs, "72"), texto(cs, "79")].filter(Boolean).join(" ") || null,
    },
  };
}
