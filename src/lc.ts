import { diffDias, parseFecha } from "./fechas";
import type { LcInfo } from "./types";

/**
 * Reglas puras de la carta de crédito (UCP 600) que hasta ahora vivían como texto:
 *  - el plazo de presentación ("21 días desde el BL") convertido en una FECHA límite
 *    real, acotada por el vencimiento de la LC (art. 14c: nunca después del vencimiento);
 *  - la tolerancia de cantidad/monto de la LC (39B / "about", "+/- 10 %") como número,
 *    para que la matriz de consistencia use la tolerancia REAL y no un ±5 % fijo.
 */

/** "21 días desde fecha de BL" · "within 21 days after B/L date" · "21 days" → 21. null si no dice. */
export function diasPresentacion(plazo: string | null | undefined): number | null {
  if (!plazo) return null;
  const m = /(\d{1,3})\s*(d[ií]as?|days?|d\b)/i.exec(plazo);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 180 ? n : null;
}

/**
 * El campo 48 que fija el plazo **hasta el vencimiento** en vez de en días.
 *
 * Es la sentencia *Deutsche Bank AG v CIMB Bank Berhad* [2017] EWHC 3380 (Comm), y costó
 * **USD 9.959.452,57**. El crédito decía «48: Period for Presentation — DOCUMENTS TO BE PRESENTED
 * WITHIN LETTER OF CREDIT VALIDITY» y el banco emisor rechazó por tardía una presentación hecha más de
 * veintiún días después del embarque pero dentro de la validez. El Commercial Court:
 *
 *   «that critical language conveys entirely clearly that the period for presenting documents is the
 *   period from the date of shipment (necessarily the start of that period if nothing else is said)
 *   until the expiry date of the credit. That is a period for presentation rule distinctly different
 *   from a rule requiring documents to be tendered within 21 days from shipment.»
 *
 *   «It is irreconcilably inconsistent to say both that the beneficiary must act within 21 days and
 *   that he may act at any time until expiry.»
 *
 * El motor buscaba **un número** en el campo 48 y, al no encontrarlo, caía al plazo por defecto del
 * artículo 14 (c): o sea que producía exactamente la discrepancia que el tribunal declaró inválida, y
 * la presentaba como si el crédito no hubiera dicho nada.
 *
 * **Y la autoridad sobre esto es la sentencia y nada más**, lo que conviene saber: los peritos de las
 * dos partes coincidieron en que *«no ICC Banking Commission opinion has ever been sought on the
 * question»* y que la ISBP 745 no lo toca. Por eso el hallazgo del motor la nombra.
 */
/**
 * Desde qué fecha cuenta el plazo del campo 48.
 *
 * Es *Fortis Bank SA/NV v Indian Overseas Bank* —[2009] EWHC 2303 (Comm) y [2011] EWCA Civ 58—, el
 * pleito de los USD 8,06 millones. El campo 48 decía «within 21 days from B/L Date but within the
 * validity of L/C»; el conocimiento tenía el a bordo el 31 de octubre y la emisión el 14 de noviembre,
 * y la presentación fue el 25. El emisor sostuvo que era tardía contando desde el embarque y la Court
 * of Appeal lo rechazó:
 *
 *   «L/C 3 expressly referred to presentation within 21 days from the date of the bill of lading, not
 *   the date of shipment. The date of the bill of lading was, as it stated on its face, 14 November
 *   2008. There is nothing in the UCP that can displace this clear provision. […] the definition in
 *   sub-article 20 (a) (ii) "The date of issuance of the bill of lading will be deemed to be the date
 *   of shipment" is a deeming provision for the date of shipment for the purpose of sub-article 14(c);
 *   it is not relevant to the construction of L/C3 which is on its face clear.»
 *
 * El motor contaba **siempre** desde el a bordo, así que sobre esos hechos producía la tardía que las
 * dos instancias rechazaron.
 *
 * **Y el cambio solo puede quitar falsos positivos, nunca agregarlos**, que es lo que lo hace seguro:
 * un conocimiento se emite el mismo día que el a bordo o después, nunca antes, así que contar desde la
 * emisión corre el límite para adelante. Cuando las dos fechas coinciden —la mayoría— no cambia nada.
 */
/* Y lo que esta función NO decide: ver la asimetría escrita en `tenorDe` (Fortis contra R 568). */
export function baseDelPlazo(plazo: string | null | undefined): "EMBARQUE" | "FECHA_DEL_BL" {
  if (!plazo) return "EMBARQUE";
  const t = plazo.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  /* «from B/L date», «from the date of the bill of lading», «after AWB date», «fecha del conocimiento» */
  if (/\b(b l|bl|bills? of lading|awb|air waybill|transport document) date\b/.test(t)) return "FECHA_DEL_BL";
  if (/date of (the )?(b l|bl|bills? of lading|air waybill|transport document)\b/.test(t)) return "FECHA_DEL_BL";
  if (/fecha (de|del) (b l|bl|conocimiento|documento de transporte|guia aerea)/.test(t)) return "FECHA_DEL_BL";
  return "EMBARQUE";
}

export function plazoHastaElVencimiento(plazo: string | null | undefined): boolean {
  if (!plazo) return false;
  const t = plazo.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  /* «within letter of credit validity», «within the validity of the credit», «within l c validity» */
  if (/within .{0,20}(l c|lc|letter of credit|credit|this credit) validity/.test(t)) return true;
  if (/within the validity (of|period)/.test(t)) return true;
  if (/(until|up to|not later than) .{0,15}(expiry|expiration)/.test(t)) return true;
  if (/dentro de la (validez|vigencia)|hasta el vencimiento/.test(t)) return true;
  return false;
}

/** UCP 600 art. 14c: plazo de presentación por defecto cuando la LC no lo fija. */
export const UCP_DIAS_PRESENTACION = 21;

export interface LimitePresentacion {
  /** fecha del BL usada (real si la hay, si no la estimada de embarque) */
  fechaBL: Date;
  /**
   * Desde qué fecha se contó: el a bordo o la emisión del documento de transporte.
   *
   * Ver `baseDelPlazo`. Va en el resultado para que el hallazgo pueda decirlo: con las dos fechas
   * distintas, un límite no explicado es un límite que nadie puede auditar.
   */
  base: "EMBARQUE" | "FECHA_DEL_BL";
  esEstimada: boolean;
  dias: number;
  /**
   * La cuenta se hizo con el plazo de UCP 600 art. 14c (21 días calendario).
   *
   * Dice **qué cuenta hizo el motor**, no si el crédito calló: con un 48 que trae texto ilegible la
   * cuenta igual es la del artículo, y eso es lo que esta bandera informa. Lo que el crédito dijo y no
   * se pudo leer lo marca `plazoNoLeido`.
   */
  plazoPorDefectoUCP: boolean;
  /**
   * El campo 48 fija el plazo **hasta el vencimiento**: el límite es el 31D y no «BL + días».
   *
   * Ver `plazoHastaElVencimiento`. Va como bandera y no disuelto en `dias` para que el hallazgo pueda
   * explicarlo y nombrar la sentencia: un plazo de veintiséis días que sale de restar fechas no se
   * puede distinguir de uno que el crédito escribió en días.
   */
  hastaElVencimiento: boolean;
  /**
   * El campo 48 **dice algo** y el motor no lo pudo leer.
   *
   * Es el hermano silencioso del caso de arriba: con un 48 que no trae un número ni una fórmula
   * conocida, el motor caía al plazo del artículo 14 (c) **y lo presentaba como si el crédito no
   * hubiera dicho nada**. Eso es el silencio contado como conformidad, que es el defecto que este
   * repositorio persigue. Con la bandera, el hallazgo sale a verificar en vez de dictaminar.
   */
  plazoNoLeido: boolean;
  /** BL + plazo, SIN acotar (para explicar la CRÍTICA cuando cae después del vencimiento) */
  porPlazo: Date;
  /** el límite operativo: min(BL + plazo, vencimiento) */
  limite: Date;
  /** true si BL + plazo cae después del vencimiento: la ventana real es más corta que el plazo */
  recortadoPorVencimiento: boolean;
}

/** Fecha límite para presentar documentos al banco. null si falta el plazo, la fecha de BL o el vencimiento. */
export function limitePresentacion(
  lc: LcInfo | null | undefined,
  fechaBL: string | null | undefined,
  fechaEmbarqueEstimada: string | null | undefined,
  /** la fecha de **emisión** del documento de transporte, cuando el crédito cuenta desde ella (Fortis) */
  fechaEmisionDelTransporte?: string | null,
): LimitePresentacion | null {
  if (!lc) return null;
  // UCP 600 art. 14c: si el crédito no dice, la presentación es dentro de los 21 días
  // calendario posteriores al embarque (y nunca después del vencimiento)
  const explicito = diasPresentacion(lc.plazoPresentacion);
  /*
   * Las dos preguntas sobre el 48 se le hacen al **texto crudo**, no a la frase armada.
   *
   * `plazoPresentacion` es «21 días desde la fecha de embarque (campo 48)» — una frase que el
   * intérprete construye con el número que encontró, y que por eso dice «embarque» siempre. Preguntarle
   * a ella desde cuándo cuenta el crédito sería preguntarle a la respuesta.
   */
  const texto48 = lc.plazoPresentacionTexto ?? lc.plazoPresentacion;
  const hastaVenc = explicito == null && plazoHastaElVencimiento(texto48);
  const base = baseDelPlazo(texto48);
  const real = fechaBL ? parseFecha(fechaBL) : null;
  const est = !real && fechaEmbarqueEstimada ? parseFecha(fechaEmbarqueEstimada) : null;
  const deEmision = base === "FECHA_DEL_BL" && fechaEmisionDelTransporte ? parseFecha(fechaEmisionDelTransporte) : null;
  const bl = deEmision ?? real ?? est;
  if (!bl) return null;
  const venc = parseFecha(lc.vencimiento);
  if (!venc) return null;
  /*
   * Con el plazo hasta el vencimiento, el límite **es** el vencimiento y los días se cuentan desde el
   * embarque: la cuenta es la misma que haría una persona leyendo el campo 48 de CIMB.
   */
  const dias = hastaVenc ? Math.max(diffDias(bl, venc), 0) : (explicito ?? UCP_DIAS_PRESENTACION);
  const porPlazo = new Date(bl.getFullYear(), bl.getMonth(), bl.getDate() + dias);
  const recortado = porPlazo > venc;
  return {
    fechaBL: bl,
    base: deEmision ? "FECHA_DEL_BL" : "EMBARQUE",
    esEstimada: !real && !deEmision,
    dias,
    plazoPorDefectoUCP: explicito == null && !hastaVenc,
    hastaElVencimiento: hastaVenc,
    /*
     * El 48 trae texto, no es un número y no es la fórmula del vencimiento: no se pudo leer.
     *
     * El guion largo queda afuera: es el relleno con que el intérprete de SWIFT marca **un campo que
     * no vino**, y un crédito sin campo 48 no dijo nada — ahí rige el artículo 14 (c) y el motor
     * concluye, que es lo correcto. Lo encontró el banco de pruebas al cambiar esto: tres casos
     * pasaron de evitada a evitada sin concluir, y dos de ellos son justamente los del 48 en blanco.
     */
    plazoNoLeido: explicito == null && !hastaVenc && /[a-z0-9]/i.test(lc.plazoPresentacion ?? ""),
    porPlazo,
    limite: recortado ? venc : porPlazo,
    recortadoPorVencimiento: recortado,
  };
}

/** Días que quedan desde `hoy` hasta el límite (negativo = vencido). */
export function diasParaPresentar(l: LimitePresentacion, hoy: Date): number {
  return diffDias(hoy, l.limite);
}

/** "±5%" · "+/- 10 %" · "5 pct more or less" · "about" (UCP 600 art. 30a: ±10 %) · "0,05" → fracción. null si no se entiende. */
export function parseTolerancia(texto: string | number | null | undefined): number | null {
  if (texto == null) return null;
  if (typeof texto === "number") return Number.isFinite(texto) && texto >= 0 && texto <= 0.5 ? texto : null;
  const t = texto.trim().toLowerCase();
  if (!t || t === "—" || t === "-") return null;
  if (/\b(about|approximately|circa|aprox)/.test(t)) return 0.1;
  // 39B/47A reales: "not allowed", "none", "nil", "no tolerance", "sin tolerancia", "exact"
  if (/\b(sin tolerancia|no tolerance|not allowed|none|nil|exact|exacto|no permitida)\b/.test(t)) return 0;
  const m = /([\d]+(?:[.,]\d+)?)\s*(%|pct|por ?ciento|percent)/.exec(t);
  if (m) {
    const n = Number(m[1].replace(",", "."));
    return Number.isFinite(n) && n >= 0 && n <= 50 ? n / 100 : null;
  }
  const f = Number(t.replace(",", "."));
  return Number.isFinite(f) && f >= 0 && f <= 0.5 ? f : null;
}

/** Caso CSU2025099, 47A: "BENEFICIARY SHOULD ADVISE FULL DETAILS OF SHIPMENT WITHIN 05 DAYS AFTER
 *  SHIPMENT DATE QUOTING POLICY NO IN0099IP000001 TO LANKASEGUROS GENERAL INSURANCE LTD … ON EMAIL
 *  POLIZAS(AT)LANKASEGUROS.EXAMPLE. A CERTIFICATE TO THIS EFFECT MUST ACCOMPANY THE ORIGINAL DOCUMENTS." */
export interface AvisoAseguradora {
  dias: number;
  poliza: string | null;
  email: string | null;
  texto: string;
}
export function avisoAseguradora(condiciones: string[] | null | undefined): AvisoAseguradora | null {
  for (const c of condiciones ?? []) {
    if (!/insur|aseguradora|seguro|policy|póliza|poliza/i.test(c)) continue;
    const m =
      /(?:advise|notify|inform|avisar|notificar|informar)[\s\S]{0,120}?(?:within|dentro de)\s*(\d{1,2})\s*(?:days?|d[ií]as)/i.exec(
        c,
      );
    if (!m) continue;
    const poliza = /policy\s*(?:no\.?|number|nº|n°)?\s*[:.]?\s*([A-Z0-9][A-Z0-9-]{4,})/i.exec(c)?.[1] ?? null;
    const email = /([\w.+-]+)\s*(?:@|\(at\))\s*([\w-]+(?:\.[\w-]+)+)/i.exec(c);
    return { dias: Number(m[1]), poliza, email: email ? `${email[1]}@${email[2]}`.toLowerCase() : null, texto: c };
  }
  return null;
}

/** La tolerancia que rige la operación: la de la LC si está cargada, si no el ±5 % habitual. */
export const TOLERANCIA_DEFAULT = 0.05;
export function toleranciaDe(lc: LcInfo | null | undefined): number {
  return lc?.tolerancia ?? TOLERANCIA_DEFAULT;
}

/**
 * La tolerancia del **importe**, que no es la misma que la de la cantidad (art. 30).
 *
 * Acá estaba el error más caro del motor: se usaba un solo número para las dos, con 5 % por
 * defecto. Ese 5 % es el del artículo 30 (b), que es una tolerancia de CANTIDAD y cuya propia
 * condición es que «el total girado no exceda el importe del crédito». Aplicárselo al importe daba
 * por conforme un giro de 56.000 contra un crédito de 54.150: el banco paga de más y no lo
 * recupera.
 *
 * Hacia arriba, sin 39A ni «about», el tope es el 32B a secas. Hacia abajo el 30 (c) admite un 5 %
 * menos con condiciones, que es otra regla y todavía no está.
 */
/**
 * El crédito deja que su propio importe fluctúe solo, por una cláusula del 47A.
 *
 * *Korea Exchange Bank v Standard Chartered Bank* [2005] SGHC 220, USD 1.961.430,67: el crédito era de
 * USD 800.000 con 39A 10/10 y el reclamo fue de USD 939.789,01, o sea USD 59.789,01 por encima del
 * techo. El emisor rechazó con «Amount Overdrawn» y el High Court de Singapur lo declaró mal, porque el
 * 47A decía *«The amount of this letter of credit shall automatically fluctuate to cover any
 * increase/decrease according to the price clause without further amendment to this credit»* y
 * *«the fluctuation in this provision is not expressed to be subject to any tolerance limits»*.
 *
 * El razonamiento es de interpretación y no del reglamento, así que no depende de la versión: si la
 * tolerancia del 39A pudiera absorber la variación del precio, la cláusula del 47A **sería superflua**;
 * y si la tolerancia se consumiera entera con el ±10 % del volumen, la cláusula quedaría sin ningún
 * efecto. Ninguna de las dos lecturas es admisible.
 *
 * **Lo que el motor hace con esto es dejar de concluir, no subir el techo.** El tribunal dice que el
 * aumento igual tiene un límite —*«the increase in the credit is limited by the increase in the price of
 * oil»*— y ese límite depende de una cotización que el motor no tiene y no va a tener. Así que con esta
 * cláusula las reglas del importe salen a **verificar** citando el caso: es la diferencia entre «no sé»
 * y «esto está mal», y el cambio solo puede quitar falsos positivos.
 *
 * El patrón pide las dos mitades —que el sujeto sea el **importe del crédito** y que la variación sea
 * automática— porque «fluctuate» a secas aparece en cualquier cláusula de precio, y una tolerancia
 * corriente no es esto.
 */
export function importeFluctuaPorElCredito(lc: LcInfo | null | undefined): boolean {
  return (lc?.condicionesAdicionales ?? []).some((c) => {
    const t = c.toLowerCase();
    /*
     * Se comprueba por partes y no con un solo patrón, y eso no es estilo.
     *
     * La primera versión era un patrón con huecos —`[\s\S]{0,60}` entre alternativas— y sobre una
     * condición larga del 47A hace **backtracking catastrófico**: un test del motor pasó de
     * milisegundos a **diecisiete minutos**, y `pnpm verificar` se cayó por tiempo. Un motor que se
     * cuelga con un crédito verboso es peor que uno que no mira la cláusula, así que acá no hay
     * huecos: tres pruebas chicas y una comparación de posiciones.
     */
    if (!/\bautomatic(?:ally)?\b/.test(t)) return false;
    const VARIA = /\b(?:fluctuat\w*|adjust\w*|vary|varied|revis\w*|increas\w*|decreas\w*|reduc\w*)\b/;
    if (!VARIA.test(t)) return false;
    const elImporte =
      /\b(?:amount|value)\s+(?:of\s+)?(?:this\s+|the\s+)?(?:letter of credit|documentary credit|credit|l\/c|lc)\b/.exec(
        t,
      );
    if (!elImporte) return false;
    /*
     * Y el sujeto tiene que ser el importe del crédito, no el precio de la mercadería.
     *
     * «the price shall automatically fluctuate with the Platts quotation» no es esto: lo que la
     * sentencia decide es una cláusula cuyo sujeto es **el importe del crédito**. Se pide que la
     * palabra de la variación aparezca cerca de ese sujeto —ciento veinte caracteres a cada lado—
     * medido con `indexOf` sobre un recorte, y no con un hueco dentro del patrón.
     */
    const desde = Math.max(0, elImporte.index - 120);
    return VARIA.test(t.slice(desde, elImporte.index + elImporte[0].length + 120));
  });
}

export function toleranciaDeImporte(lc: LcInfo | null | undefined): number {
  // una tolerancia declarada «solo en cantidad» no mueve el tope del importe: admitirla pagaba de
  // más, que es el error que no se ve hasta que alguien concilia
  if (lc?.toleranciaAplicaA === "CANTIDAD") return 0;
  return lc?.tolerancia ?? 0;
}

/**
 * La tolerancia de la **cantidad** (art. 30 b).
 *
 * El ±5 % rige salvo que el crédito exprese la cantidad en bultos o unidades, que es la primera
 * condición del inciso. No está condicionado al 39A —que es tolerancia de importe— así que un
 * crédito con 39A 00/00 sigue admitiendo el 5 % en la cantidad.
 *
 * Y cuando el crédito declara un porcentaje, **rige ese**, sea mayor o menor que el 5 %: el inciso
 * abre con «unless the credit stipulates…», así que su 5 % es el default de un crédito que no dice
 * nada. Decía «si el crédito da más, vale más», que era la mitad de la regla.
 */
export function toleranciaDeCantidad(lc: LcInfo | null | undefined, enBultos = false): number {
  if (enBultos) return 0;
  // una declarada «solo en valor» no mueve la de cantidad: ahí vuelve a regir el 5 % del 30 (b)
  if (lc?.toleranciaAplicaA === "IMPORTE") return TOLERANCIA_DEFAULT;
  /*
   * Lo que el crédito estipula RIGE, también cuando es menos que el 5 %.
   *
   * Era `Math.max(declarada, TOLERANCIA_DEFAULT)`, que solo contemplaba «si el crédito da más,
   * vale más». Pero el 30 (b) abre con «unless the credit stipulates that the quantity must not
   * be exceeded or reduced»: su 5 % es el default de un crédito que no dice nada. Un crédito con
   * 39A «PLUS/MINUS 3 PCT» sí dice, y por el artículo 1 rige el crédito — ensancharlo al 5 % daba
   * por conforme un +4,4 % que el banco no autorizó, con la evidencia citando el 39A para
   * sostener un número que el 39A no tiene.
   */
  /*
   * Y el cero NO es «sin margen»: «00/00» es la convención del 39A para no declarar tolerancia, no
   * para prohibirla. Un crédito con 00/00 de importe sigue admitiendo el ±5 % de cantidad del
   * 30 (b) —eso ya estaba probado y este arreglo no lo toca—; lo que cambia es el caso de un
   * porcentaje declarado de verdad.
   */
  if (lc?.tolerancia != null && lc.tolerancia > 0) return lc.tolerancia;
  return TOLERANCIA_DEFAULT;
}

/* ─── A6: ¿cuándo entra la plata? ──────────────────────────────────────────────
   La LC dice cómo y cuándo paga: 41D ("available by negotiation/payment/deferred
   payment") y 42C (tenor: "SIGHT", "90 DAYS AFTER B/L DATE"). Con eso, la fecha de
   presentación y el BL, sale una fecha estimada de cobro para el flujo de caja.
   Los días bancarios de examen son los de UCP 600 art. 14b: 5 días hábiles. */

export const UCP_DIAS_EXAMEN = 5;

export interface CobroEstimado {
  /** días de tenor después del hecho gatillo (0 = a la vista) */
  diasTenor: number;
  /** desde qué se cuenta el tenor: presentación (sight) o fecha de BL */
  desde: "PRESENTACION" | "BL";
  fecha: Date;
  /** cómo quedó explicado, para mostrar */
  texto: string;
}

/**
 * "90 DAYS AFTER B/L DATE" → { dias: 90, desde: 'BL' }; "AT SIGHT" → { dias: 0, desde: 'PRESENTACION' }
 *
 * ## Y «fecha del conocimiento» significa **otra cosa acá** que en `baseDelPlazo`, con autoridad por lado
 *
 * Es la asimetría más fácil de «unificar» por error de todo este archivo, así que va escrita en los dos
 * lugares. La misma frase del crédito —«B/L date»— se resuelve a dos fechas distintas según qué se esté
 * calculando, y cada lado tiene su autoridad:
 *
 * - **el plazo de presentación** del campo 48 cuenta desde la **emisión** del documento de transporte.
 *   Lo decidió *Fortis Bank SA/NV v Indian Overseas Bank*, con USD 8,06 millones de condena: *«L/C 3
 *   expressly referred to presentation within 21 days from the date of the bill of lading, not the date of
 *   shipment»*, y el 20 (a) (ii) es *«a deeming provision for the date of shipment for the purpose of
 *   sub-article 14 (c); it is not relevant to the construction of L/C3»*. Eso vive en `baseDelPlazo`.
 *
 * - **el vencimiento de un giro a plazo** cuenta desde la **anotación de a bordo**. Lo dice la Opinión
 *   **R 568**, que el laudo DOCDEX 319 transcribe: *«For the purpose of fixing the maturity date of a draft
 *   to be drawn under a credit which stipulates such draft to be drawn "X days after B/L date", **the date
 *   of the on board notation, if any, should be considered the "B/L date" irrespective of whether the date
 *   of the on board notation is later or earlier than the date of issuance of the bill of lading**»*.
 *
 * Por eso esta función manda «SHIPMENT DATE» y «B/L DATE» al mismo gatillo —para un vencimiento son lo
 * mismo— y `baseDelPlazo` los separa. Las dos son correctas para su pregunta, y juntarlas rompería una.
 *
 * **Y el llamador es el que pone la fecha**: `cobroEstimado` recibe `fechaBL` y hay que pasarle el **a
 * bordo**, no la emisión. El mismo laudo explica por qué las dos existen: *«There is nothing unusual in a
 * dated on board notation pre-dating the issuance date of the bill of lading […] an intervening weekend or
 * pressure of work might cause the bill of lading to be issued and dated some days later»*.
 */
export function tenorDe(
  giros: string | null | undefined,
  disponibleCon?: string | null,
): { dias: number; desde: "PRESENTACION" | "BL" } {
  const t = `${giros ?? ""} ${disponibleCon ?? ""}`.toUpperCase();
  const m = /(\d{1,3})\s*DAYS?/.exec(t);
  const dias = m ? Number(m[1]) : 0;
  // "AFTER B/L DATE" / "FROM SHIPMENT DATE" cuentan desde el embarque; el resto, desde la presentación
  const desdeBL = /B\/?L\s*DATE|BILL OF LADING DATE|SHIPMENT DATE|DATE OF SHIPMENT/.test(t);
  return { dias: dias > 0 && dias <= 360 ? dias : 0, desde: desdeBL ? "BL" : "PRESENTACION" };
}

/** Suma días hábiles (lunes a viernes; los feriados bancarios no se modelan). */
export function sumarHabiles(d: Date, dias: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let quedan = dias;
  while (quedan > 0) {
    r.setDate(r.getDate() + 1);
    const dow = r.getDay();
    if (dow !== 0 && dow !== 6) quedan -= 1;
  }
  return r;
}

/**
 * Fecha estimada de cobro: presentación + 5 días hábiles de examen (art. 14b) y, si el crédito es
 * a plazo, el tenor desde el gatillo que corresponda. `presentacion` es cuándo se presentan (o se
 * presentaron) los documentos; sin ella no hay estimación.
 */
export function cobroEstimado(
  lc: LcInfo | null | undefined,
  presentacion: Date | null,
  fechaBL?: string | null,
): CobroEstimado | null {
  if (!lc || !presentacion) return null;
  const { dias, desde } = tenorDe(lc.giros, lc.librado);
  const examen = sumarHabiles(presentacion, UCP_DIAS_EXAMEN);
  if (dias === 0) {
    return {
      diasTenor: 0,
      desde: "PRESENTACION",
      fecha: examen,
      texto: `A la vista: ${UCP_DIAS_EXAMEN} días hábiles de examen del banco desde la presentación.`,
    };
  }
  const bl = desde === "BL" && fechaBL ? parseFecha(fechaBL) : null;
  const base = bl ?? examen;
  const fecha = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dias);
  return {
    diasTenor: dias,
    desde: bl ? "BL" : "PRESENTACION",
    fecha,
    texto: bl
      ? `A ${dias} días de la fecha de BL (${fechaBL}).`
      : `A ${dias} días de la presentación, más ${UCP_DIAS_EXAMEN} días hábiles de examen.`,
  };
}
