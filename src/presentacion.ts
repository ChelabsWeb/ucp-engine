import { corto as cortoDeTexto } from "./certificados";
import {
  ABRE_DESCRIPCION,
  type CamposDoc,
  claveDoc,
  compararEntreDocumentos,
  parseNumero,
  segundoDocumentoDeLaLinea,
  type TipoDocExterno,
} from "./consistencia";
import { diffDias, parseFecha } from "./fechas";
import {
  comparaISBP,
  creditoExigeIngles,
  NOTA_NOMBRE_ILEGIBLE,
  NOTA_NOMBRE_ILEGIBLE_CON_INGLES,
  NOTA_TIPEO_DE_NOMBRE,
  normISBP,
  veredictoDeNombre,
} from "./isbp";
import { importeFluctuaPorElCredito, limitePresentacion, toleranciaDeImporte } from "./lc";
import type { DocumentRow, LcInfo, OperationDetail } from "./types";

/**
 * Dónde puede estar escrito que los documentos citen el número del crédito.
 *
 * Vive a nivel de módulo y se exporta porque la misma pregunta se hace en dos lugares —los cuatro
 * documentos de la matriz y los demás papeles del 46A— y dos copias del mismo regex se separan: una
 * se corrige y la otra no, y el motor empieza a contestar distinto según por dónde entró el papel.
 */
/**
 * Si el crédito pide **solo una copia** del documento de transporte.
 *
 * Importa porque cambia dos de los tres plazos del examen, y el motor los aplicaba igual. Lo dice el
 * párrafo A6 (c) de la ISBP y la Opinión TA 767rev:
 *
 * > copies of transport documents covered by UCP600 articles 19-25 are not subject to the default
 * > presentation period of 21 calendar days stated in UCP600 sub-article 14 (c) or any presentation
 * > period stated in the credit, unless the LC explicitly states the basis for determining such
 * > presentation period
 *
 * > a photocopy of an Air Waybill is not a transport document covered by the content of UCP 600
 * > articles 19-25, and the examination thereof is to be completed only to the extent expressly
 * > stated in the LC
 *
 * O sea que con un crédito que pide «COPY OF AIR WAYBILL EVIDENCING TELEX RELEASE» el motor marcaba
 * **presentación tardía y embarque fuera del 44C** sobre una presentación que la ICC dice que no puede
 * medirse así. Dos falsos positivos, y uno de ellos en `plazo`, que es la discrepancia más corriente
 * del negocio.
 *
 * **El detector es angosto a propósito.** Pide copia *y* que no pida originales: «FULL SET OF 3/3
 * ORIGINAL B/LS PLUS 2 NON NEGOTIABLE COPIES» exige originales y se examina como siempre. Lo que
 * cambia es el crédito que pide **únicamente** una copia o fotocopia, que es el caso de la Opinión.
 */
export function pideSoloCopiaDelTransporte(documentosExigidos: string[] | null | undefined): boolean {
  /*
   * Y la línea tiene que **ser** la del documento de transporte, no una que lo mencione.
   *
   * Buscar el nombre del transporte en cualquier parte de cualquier línea es la forma que este motor ya
   * pagó siete veces —un documento cuyo texto nombra otro tipo se lo deja robar— y acá la consecuencia es
   * la peor de todas: no cambia un FALTA, **silencia el plazo de presentación**, que es la discrepancia
   * más corriente del negocio. Lo encontró el laudo DOCDEX 319, cuyo 46A pide «COPY OF AN UNPAID
   * COMMERCIAL INVOICE **STATING B/L DATE**»: eso tiene «COPY», nombra «B/L» y no dice «original», así
   * que el motor concluía que el crédito pedía una copia del documento de transporte —cuando ese crédito
   * **no pide documento de transporte en absoluto**, que es justo lo que el panel resuelve— y la regla
   * `plazo` salía en ATENCION en vez de medir nada.
   *
   * Y pega en redacción corriente, no solo en un standby: «COPY OF INVOICE SHOWING B/L NUMBER» o un
   * certificado del beneficiario que diga que mandó **una copia** del conocimiento al ordenante tienen la
   * misma forma. El del expediente real se salva por un pelo, porque dice «1/3 ORIGINAL BILL OF LADING».
   *
   * `claveDoc` ya contesta esto bien —clasifica por la **cabeza** de la línea, que es para lo que existe—
   * así que la pregunta se hace con él en vez de con un patrón propio: un concepto, un comparador.
   */
  const linea = (documentosExigidos ?? []).find((d) => claveDoc(d) === "BL");
  if (!linea) return false;
  if (/\b(original|originals|full set)\b/i.test(linea)) return false;
  /*
   * Y una **copia en lugar del original** no es lo mismo que **N ejemplares** del documento.
   *
   * Lo encontró la auditoría de las observaciones `NO_VERIFICABLE`, que es el método que este repositorio
   * se dejó escrito para después de tocar el motor: el 46A de la Opinión TA 961rev pide «CMR ROAD
   * CONSIGNMENT NOTE **IN 2 COPIES**», y eso son dos ejemplares del CMR —un CMR se emite en varias hojas
   * por diseño— y no una fotocopia en vez del original. El motor lo tomaba por lo segundo, así que ese
   * caso tenía **el plazo de presentación silenciado** desde que esta función existe, y desde el laudo
   * DOCDEX 330 perdió además el capítulo entero de los artículos 19 a 25.
   *
   * El corte es la **posición**: en una sustitución la palabra encabeza la exigencia —«COPY OF THE AIR
   * WAYBILL», «PHOTOCOPY OF CMR», «NON-NEGOTIABLE COPY OF BILL OF LADING»— y en un conteo va detrás del
   * nombre y con un número adelante. Es lo que distingue el párrafo A6 de la ISBP, que habla de un crédito
   * que **admite presentar una copia en vez de un original**.
   */
  /*
   * Los nombres van alineados con los que `clavePorTexto` reconoce como documento de transporte —de ahí
   * salió el primer intento de este corte, que se quedó sin «CMR» y le apagó la rama al laudo DOCDEX 322
   * en la misma corrida en que se la devolvía a TA 961rev—. La lista vive acá y no importada porque este
   * módulo se sincroniza con romai y no conviene cargarlo de dependencias nuevas, pero es la misma.
   */
  const NOMBRE_TRANSPORTE =
    /\b(bills?\s+of\s+lading|b\/?ls?|air\s*way\s*bills?|awbs?|air\s+consignment\s+notes?|sea\s*way\s*bills?|consignment\s+notes?|cmr|rail\s*way\s*bills?|cartas?\s+de\s+porte|inland\s+waterway|multimodal|combined\s+transport|intermodal|through\s+bill|courier\s+receipt|post\s+receipt|transport\s+document|conocimiento)\b/i;
  const COPIA = /\b(photocopy|photocopies|copy|copies)\b/i;
  const iCopia = linea.search(COPIA);
  const iNombre = linea.search(NOMBRE_TRANSPORTE);
  return iCopia >= 0 && iNombre >= 0 && iCopia < iNombre;
}

/*
 * Las formas en que un crédito pide que un documento cite su número.
 *
 * El verbo era **uno solo**, «INDICATING», y el laudo DOCDEX 207 trae el otro: su crédito pide que el
 * conocimiento *«must show the "L/C number"»*. Con «SHOWING THE LETTER OF CREDIT NUMBER» —que es
 * redacción tan corriente como la otra— el motor daba el número por **no pedido**, así que la fuente del
 * hallazgo decía «Práctica bancaria» y su omisión dejaba de ser discrepancia sobre un crédito que la
 * pedía. Es la misma forma que ya apareció con el término de entrega escrito en palabras y con la unidad
 * «METRIC TONS»: **el motor reconocía una redacción y no la otra.**
 *
 * Los verbos van anclados a su propia alternativa y el hueco sigue siendo uno, por lo que costó
 * `importeFluctuaPorElCredito`: dos huecos en un patrón cuelgan el motor con un 47A largo.
 */
/**
 * El nombre de una parte que el 46A nombra, cortado donde empieza la descripción del documento.
 *
 * Sin el corte el nombre se lleva la frase entera —«CONSIGNED TO APPLICANT **INDICATING THE TRANSPORT
 * ROUTE AS PER FIELDS 44E**»— y la comparación se hace contra algo que ninguna parte se llama. Van
 * **cinco veces** que una captura de nombre comete ese error en este motor, y las cuatro anteriores se
 * arreglaron cada una con su propio corte: por eso acá se usa `ABRE_DESCRIPCION`, que es el único patrón
 * del repositorio que sabe dónde termina el nombre de un documento, más las palabras con que un 46A sigue
 * describiendo a quién consignar.
 */
function hastaLaDescripcion(nombre: string | null): string | null {
  if (!nombre) return null;
  const low = nombre.toLowerCase();
  const cortes = [ABRE_DESCRIPCION.exec(low)?.index, /\b(?:notify|blank|endorsed|and|or)\b/.exec(low)?.index]
    .filter((i): i is number => i !== undefined && i >= 0)
    .sort((a, b) => a - b);
  const corte = cortes[0];
  const recortado = (corte === undefined ? nombre : nombre.slice(0, corte)).replace(/[\s,;.]+$/, "").trim();
  return recortado || null;
}

/**
 * Los documentos que el crédito admite presentar **en lugar de** otros.
 *
 * Un crédito de graneles lo escribe cuando los papeles no llegan a tiempo: «commercial invoice and
 * beneficiary's letter of indemnity are acceptable in lieu of the full set of bills of lading». Si el
 * beneficiario usa esa puerta, las líneas del 46A que la cláusula desplaza **no están** — y el examen las
 * sacaba en **FALTA**, que afirma «nadie presentó este documento». Eso es falso: el crédito dijo que no hacía
 * falta, y el laudo **DOCDEX 372** lo decide — *«Since a presentation solely comprising an invoice and an
 * LOI was allowed under this specific credit, the documents were seen to represent a complying
 * presentation»*.
 *
 * **Es el octavo «no se veía como una falla, se veía como un FALTA» de este repositorio**, y el más caro de
 * la familia después de los siete certificados: un crédito de crudo con LOI deja tres o cuatro líneas en
 * FALTA siempre, así que `listo` no puede ser `true` nunca.
 *
 * Lo que se devuelve son las claves **desplazadas** —lo que viene después de «in lieu of»— y nada más. No se
 * comprueba que la alternativa esté presentada: eso es lo que el examinador tiene que mirar, y afirmarlo
 * desde acá pediría recorrer el apareo dos veces. Lo único que cambia es que una línea desplazada sin papel
 * sale a **verificar** en vez de afirmar una ausencia que el crédito autorizó.
 */
export function clavesDesplazadasPorSustitucion(lc: LcInfo): { claves: Set<string>; texto: string } {
  const claves = new Set<string>();
  const partes: string[] = [];
  for (const t of [...(lc.documentosExigidos ?? []), ...(lc.condicionesAdicionales ?? [])]) {
    const m = /\b(?:in\s+lieu\s+of|instead\s+of)\b([^.;]*)/i.exec(t);
    if (!m) continue;
    /*
     * **«In lieu thereof» apunta para atrás, y ahí lo que sigue es la alternativa y no lo desplazado.**
     *
     * El inglés escribe la sustitución de las dos maneras: «A and B are acceptable **in lieu of** C» —y
     * entonces lo que viene después es lo que se reemplaza— y «C or, **in lieu thereof**, A and B», donde
     * lo que viene después es lo que se presenta. Tomar la segunda por la primera marcaría como desplazada
     * justo la línea que el crédito sí exige, que es el error exactamente al revés.
     */
    if (/^\s*(?:thereof|hereof|the\s+above|these\s+documents|said\s+documents)/i.test(m[1] ?? "")) continue;
    partes.push(m[1] ?? "");
    for (const trozo of (m[1] ?? "").split(/\band\b|\bor\b|,|\//i)) {
      const k = claveDoc(trozo);
      if (k && !k.startsWith("TXT:")) claves.add(k);
    }
  }
  return { claves, texto: aplanado(partes.join(" ")) };
}

/**
 * El nombre del documento de una línea del 46A, sin lo que el crédito le pide decir.
 *
 * Hace falta porque la mitad de los documentos del 46A **no tienen clave**: un «CERTIFICATE OF QUANTITY
 * ISSUED BY INDEPENDENT INSPECTOR» y el «certificate of quantity» que la cláusula de sustitución nombra son
 * dos claves `TXT:` distintas y no se reconocen entre sí. Comparar la **cabeza** de la línea sí: es donde el
 * crédito nombra el documento, que es la misma razón por la que `claveDoc` la usa.
 */
function cabezaDeLaExigencia(texto: string): string {
  const plano = aplanado(texto.replace(/^\s*\+?\s*\d{1,2}[).]\s*/, ""));
  const i = ABRE_DESCRIPCION.exec(plano)?.index;
  return (i === undefined ? plano : plano.slice(0, i)).trim();
}

/** Minúsculas, sin acentos y sin puntuación: para comparar nombres de documento entre dos textos. */
function aplanado(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const PIDE_CITAR_NUMERO_LC =
  /(?:INDICAT|SHOW|EVIDENC|BEAR|QUOT|MENTION)\w*.{0,40}(LETTER OF CREDIT|L\/?C|CREDIT)\s*(NUMBER|NO)|LC NUMBER|NUMBER OF LETTER OF CREDIT/;

/**
 * Y si **esta** línea del 46A lo pide, que no es lo mismo que si el 46A lo pide en alguna parte.
 *
 * Lo necesita `certificados.ts`, donde cada certificado llega con su propia `exigencia`: un crédito que
 * pide el número en el conocimiento no se lo pide al certificado de la naviera, y decirle que sí es
 * mandar al banco presentador al lugar equivocado (laudo DOCDEX 207).
 */
export function laExigenciaPideElNumeroLC(texto: string): boolean {
  return PIDE_CITAR_NUMERO_LC.test(texto.toUpperCase());
}

/** El campo donde el crédito lo pide, para que la fuente del hallazgo mande al lugar correcto. */
export function dondeSePideElNumeroLC(lc: LcInfo): "47A" | "46A" | null {
  const cond = (lc.condicionesAdicionales ?? []).join(" ").toUpperCase();
  if (PIDE_CITAR_NUMERO_LC.test(cond)) return "47A";
  const exigidos = (lc.documentosExigidos ?? []).join(" ").toUpperCase();
  return PIDE_CITAR_NUMERO_LC.test(exigidos) ? "46A" : null;
}

/**
 * Pre-check UCP 600 del paquete documental ANTES de presentarlo al banco (oportunidades A1/A2).
 *
 * El banco examina documentos, no mercadería (art. 5), y el 70 % de las presentaciones se
 * rechazan a la primera por discrepancias formales (intro UCP 600). Cada rechazo cuesta el fee
 * del 47A (USD 80 en el caso CSU2025099) y deja el cobro a voluntad del comprador. Este motor es
 * PURO: recibe la LC cargada (46A/47A/fechas/monto), los documentos externos ya analizados por
 * la IA, los documentos generados y el checklist, y devuelve regla por regla qué está bien, qué
 * falta y qué es discrepancia, con la evidencia.
 */

export type EstadoRegla = "OK" | "FALTA" | "DISCREPANCIA" | "ATENCION" | "SIN_DATO";

export interface ReglaPresentacion {
  id: string;
  /** de dónde sale la regla: "46A+2", "47A+1", "UCP 600 14c"… */
  fuente: string;
  regla: string;
  estado: EstadoRegla;
  evidencia: string;
}

export interface Ejemplares {
  originales: number | null;
  copias: number | null;
  texto: string;
}

/** "IN 03 FOLD" → 3 · "FULL SET OF (3/3) … PLUS 02 NON NEGOTIABLE COPIES" → 3 originales + 2 copias · "IN DUPLICATE" → 2. */
export function ejemplaresDe(texto: string): Ejemplares {
  const t = texto.toUpperCase();
  const set = /\((\d)\s*\/\s*(\d)\)|FULL SET OF\s*(\d)/.exec(t);
  const copias = /(\d{1,2})\s*(?:NON[- ]NEGOTIABLE\s+)?COP(?:Y|IES)/.exec(t);
  const fold = /IN\s*(\d{1,2})\s*FOLD/.exec(t);
  const palabra = /\b(DUPLICATE|TRIPLICATE|QUADRUPLICATE)\b/.exec(t);
  const originales = set
    ? Number(set[1] ?? set[3])
    : fold
      ? Number(fold[1])
      : palabra
        ? ({ DUPLICATE: 2, TRIPLICATE: 3, QUADRUPLICATE: 4 }[palabra[1]] ?? null)
        : null;
  const nCopias = copias ? Number(copias[1]) : null;
  const partes = [
    originales != null ? `${originales} original${originales > 1 ? "es" : ""}` : null,
    nCopias != null ? `${nCopias} copia${nCopias > 1 ? "s" : ""}` : null,
  ].filter(Boolean);
  return { originales, copias: nCopias, texto: partes.join(" + ") || "sin cantidad indicada" };
}

/** "A DISCREPANCY FEE OF USD 80/- OR ITS EQUIVALENT WILL BE DEDUCTED…" → 80 */
export function feeDiscrepancia(condiciones: string[] | null | undefined): number | null {
  for (const c of condiciones ?? []) {
    const m =
      /DISCREPANC\w*\s+(?:FEE|CHARGE)[^0-9]{0,40}?(?:USD|US\$|EUR|GBP)?\s*([\d.,]+)/i.exec(c) ??
      /(?:USD|US\$)\s*([\d.,]+)[^.]{0,60}DISCREPANC/i.exec(c);
    if (m) {
      const n = parseNumero(m[1]);
      if (n != null && n > 0) return n;
    }
  }
  return null;
}

/** El tipo de documento analizable que cubre una clave del 46A (INVOICE → FACTURA…). */
const TIPO_DE_CLAVE: Record<string, TipoDocExterno> = { INVOICE: "FACTURA", PACKING: "PACKING", BL: "BL" };

/**
 * **En qué documentos** el crédito pide que se cite su número.
 *
 * `null` significa «en todos»: el crédito lo pidió como condición general del 47A —«ALL DOCUMENTS SHOULD
 * INDICATE THE LETTER OF CREDIT NUMBER»— y entonces alcanza a cada papel.
 *
 * Un `Set` significa «solo en éstos»: el crédito lo escribió **dentro de la línea de un documento** del
 * 46A, y ahí la exigencia es de ese documento y no de los demás. Antes la regla miraba el 46A **entero**,
 * así que un crédito que pedía el número en el conocimiento se lo exigía también al certificado de
 * origen y al de la compañía naviera.
 *
 * Lo encontró el laudo **DOCDEX 207**, donde eso fue uno de los tres motivos de rechazo: *«The credit
 * stipulated that the bill of lading and beneficiary's fax or telex must show the "L/C number", but the
 * credit did not stipulate that all documents should evidence the L/C number. Therefore **the issuing
 * bank had no reason for refusing the documents on the grounds of a missing L/C number on the shipping
 * company certificate**»*.
 *
 * Y el mismo laudo da la regla general sobre el alcance de una exigencia, a propósito de otra cláusula
 * del mismo crédito: *«If the issuing bank meant that every document should evidence the data, **it
 * should have stated "all" instead of "all relevant"**»*. El alcance es lo que el crédito escribió.
 */
export function documentosQueDebenCitarElNumeroLC(lc: LcInfo): Set<string> | null {
  const cond = (lc.condicionesAdicionales ?? []).join(" ").toUpperCase();
  if (PIDE_CITAR_NUMERO_LC.test(cond)) return null;
  const tipos = (lc.documentosExigidos ?? [])
    .filter((d) => PIDE_CITAR_NUMERO_LC.test(d.toUpperCase()))
    .map((d) => TIPO_DE_CLAVE[claveDoc(d)])
    .filter((t): t is TipoDocExterno => Boolean(t));
  return new Set(tipos);
}

/**
 * Qué tipo con extracción propia cubre una exigencia del 46A, si alguno.
 *
 * La pantalla lo necesita para saber **qué líneas del crédito no tienen casilla**: las que
 * devuelven `undefined` son los certificados y el seguro, que se cargan aparte y se pasan en
 * `otros`. Vive acá y no en la pantalla a propósito: una lista escrita a mano del otro lado se
 * desincroniza del día que este mapa crezca, que es exactamente cómo `normalizarCamposDoc` llegó a
 * tirar los campos del seguro sin que nadie se enterara.
 */
export function tipoDeExigencia(texto: string): TipoDocExterno | undefined {
  return TIPO_DE_CLAVE[claveDoc(texto)];
}
/** Documento GENERADO por romai que cubre una clave del 46A. */
const GENERADO_DE_CLAVE: Record<string, string[]> = {
  INVOICE: ["Commercial invoice (draft)"],
  PACKING: ["Packing list preliminar"],
  PESO: ["Weight note"],
};
const APROBADO = new Set(["APROBADO", "ENVIADO", "VALIDADO"]);

export interface DocAnalizado {
  tipo: TipoDocExterno;
  campos: CamposDoc;
  nombreArchivo?: string;
}

export interface ResultadoPresentacion {
  reglas: ReglaPresentacion[];
  faltan: number;
  discrepancias: number;
  atencion: number;
  listo: boolean;
  /**
   * Además, no quedó nada sin mirar. `listo && !verificado` = «listo en lo que vi».
   *
   * No son lo mismo y confundirlos cuesta plata: el 46A del caso de referencia exige diez documentos y el
   * producto sabe analizar tres. Anunciar «conforme» sobre siete certificados tildados a mano manda
   * a alguien al banco confiado, y el rechazo —con su cargo por juego— aparece allá. `listo` dice
   * «nada de lo que miré está mal»; `verificado` dice «además, lo miré todo». Quien muestre esto
   * tiene que decir las dos cosas.
   */
  verificado: boolean;
  /** cuántas reglas quedaron en ATENCION, que es lo que falta mirar a mano */
  sinVerificar: number;
  feePorJuego: number | null;
  /** días que quedan para presentar (negativo = vencido), si se puede calcular */
  diasParaPresentar: number | null;
}

export function precheckPresentacion(input: {
  lc: LcInfo;
  docs: DocAnalizado[];
  /**
   * Los demás documentos del 46A que vinieron presentados: origen, análisis, peso, fumigación,
   * certificados del beneficiario, el seguro.
   *
   * Hace falta porque la regla del 46A de acá abajo solo reconoce los cuatro tipos que tienen
   * extracción propia (`TIPO_DE_CLAVE`), y en romai los otros se satisfacen por la rama de los
   * documentos **generados**. En cotejo no se genera nada: los papeles los presenta el
   * beneficiario, así que sin esto un certificado de análisis presentado dejaba su línea del
   * crédito en FALTA y `listo` no podía ser `true` en ningún crédito real.
   */
  otros?: { exigencia: string; nombreArchivo?: string }[];
  op: OperationDetail;
  empresaRazonSocial: string;
  /** dirección de la empresa en Ajustes (para cotejar con la de la LC, D3) */
  empresaDireccion?: string | null;
  hoy: Date;
  /**
   * El día en que el juego se presentó, cuando ya se presentó.
   *
   * Decide el plazo del campo 48, y la diferencia con `hoy` no es un detalle: **un banco examina
   * una presentación que ya ocurrió.** Sin esto la regla comparaba el límite contra el día del
   * examen, así que un juego recibido en plazo y examinado después del límite salía DISCREPANCIA por
   * tardío — y eso pasa en cuanto el examen no es el mismo día, que es lo normal: el artículo 14 (b)
   * le da al banco cinco días hábiles. El caso TA 956rev del banco de pruebas tiene exactamente esa
   * forma, con una presentación en plazo y un examen diecisiete días después.
   *
   * En romai no se pasa y la regla sigue siendo la de siempre: ahí nadie presentó nada todavía y la
   * pregunta es cuántos días quedan para hacerlo.
   */
  presentadaEl?: Date | null;
}): ResultadoPresentacion {
  const { lc, op, hoy } = input;
  // un documento analizado por tipo: el primero (la ficha los pasa del más nuevo al más viejo)
  const vistos = new Set<TipoDocExterno>();
  const docs = input.docs.filter((d) => (vistos.has(d.tipo) ? false : (vistos.add(d.tipo), true)));
  const reglas: ReglaPresentacion[] = [];
  const val = (d: DocAnalizado | undefined, k: keyof CamposDoc): string | null => {
    const c = d?.campos[k];
    return c && c.valor.trim() && c.confianza >= 0.4 ? c.valor.trim() : null;
  };
  const doc = (t: TipoDocExterno) => docs.find((d) => d.tipo === t);
  const generado = (nombres: string[]): DocumentRow | undefined =>
    op.documentos.find((d) => nombres.includes(d.nombre));
  /** Si una exigencia del 46A llegó presentada como certificado o seguro. */
  const usados = new Set<number>();
  const presentado = (texto: string): { nombreArchivo?: string } | undefined => {
    const lista = input.otros ?? [];
    const k = claveDoc(texto);
    // por el texto exacto primero —el examinador eligió contra qué línea carga cada papel— y
    // recién después por la clave, para el que se apareó solo
    const i = lista.findIndex((o, idx) => !usados.has(idx) && o.exigencia.trim() === texto.trim());
    const j = i >= 0 ? i : lista.findIndex((o, idx) => !usados.has(idx) && claveDoc(o.exigencia) === k);
    if (j < 0) return undefined;
    usados.add(j);
    return lista[j];
  };
  /*
   * Y el recorte sale de `certificados.ts`, que es donde ya estaba arreglado.
   *
   * Había **dos copias** de la misma pregunta: una cortaba en el espacio y la otra por el carácter
   * exacto, y la segunda volvió a producir el mismo síntoma que la primera ya había corregido —una
   * sílaba suelta que el control de traducción lee como castellano—. Acá fue «CON», de «CONFIRMING», en
   * la línea del 46A del laudo DOCDEX 322; allá había sido «AL», de la misma palabra. Dos copias de la
   * misma pregunta es cómo se desincronizan dos respuestas, así que queda una.
   */
  const corto = (t: string) => cortoDeTexto(t, 40);
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const emision = lc.fechaEmision ? parseFecha(lc.fechaEmision) : null;

  /* ---- 46A: cada documento exigido, ¿está y con cuántos ejemplares? ---- */
  const exigidos = lc.documentosExigidos ?? [];
  /*
   * Qué línea del 46A se llevó cada clave, para que un papel no satisfaga dos líneas.
   *
   * `presentado()` marca la entrada como usada y `doc()` no, así que con dos líneas que aparean a la
   * misma clave el **mismo** papel las daba por cumplidas las dos — y la segunda salía en OK diciendo
   * «Analizado (PACKING)», o sea afirmando que el motor miró una línea que nunca leyó. Lo encontró la
   * Opinión TA 893rev, cuyo 46A tiene una cláusula que **describe qué tiene que decir** el packing
   * list («the packing list should indicate the dimensions of the bale») y por lo tanto nombra ese
   * documento sin exigir otro.
   *
   * Las dos lecturas son posibles —el crédito pide dos papeles, o esta línea es una condición sobre el
   * que ya pidió— y el motor no puede elegir, así que lo dice. Nunca rechaza: una línea de más en el
   * 46A no es una discrepancia del beneficiario.
   */
  const claveYaExigida = new Map<string, { id: string; conPapel: boolean }>();
  /* Las líneas que el crédito admite reemplazar por otros documentos (laudo DOCDEX 372). */
  const sustitucion = clavesDesplazadasPorSustitucion(lc);
  const estaDesplazada = (clave: string, texto: string): boolean => {
    if (sustitucion.claves.has(clave)) return true;
    const cabeza = cabezaDeLaExigencia(texto);
    return cabeza.length > 8 && sustitucion.texto.includes(cabeza);
  };
  exigidos.forEach((texto, i) => {
    const k = claveDoc(texto);
    const ej = ejemplaresDe(texto);
    const id = `46A+${i + 1}`;
    const tipo = TIPO_DE_CLAVE[k];
    const analizado = tipo ? doc(tipo) : undefined;
    const gen = generado(
      GENERADO_DE_CLAVE[k] ?? (k.startsWith("BENEFICIARIO") ? ["Certificado del beneficiario"] : []),
    );
    // una sola llamada: el helper marca la entrada como usada, así que dos papeles no pueden
    // satisfacer la misma línea ni una línea consumir dos papeles
    const pres = analizado ? undefined : presentado(texto);
    const enChecklist = op.checklist.find((c) => claveDoc(c.label) === k);
    const resumen = texto.length > 90 ? `${texto.slice(0, 87)}…` : texto;
    const laPrimera = claveYaExigida.get(k);
    /*
     * Y si la línea nombra **dos** documentos, el segundo se avisa en vez de desaparecer.
     *
     * `claveDoc` devuelve una clave por línea, así que «COMMERCIAL INVOICE AND PACKING LIST EACH IN
     * TRIPLICATE» se la lleva la factura y **la exigencia del packing list no existe para el examen**:
     * el crédito queda pidiendo un documento menos y eso no se ve en ninguna parte. Lo encontró el laudo
     * DOCDEX 211, cuyo panel dice que esa línea estipula dos documentos y que el «each» prohíbe
     * combinarlos.
     *
     * No se parte la línea en dos exigencias —eso cambiaría el apareo de todo el 46A y hay ochenta casos
     * midiendo el actual— sino que se **dice**: el segundo documento que la línea nombra no se está
     * apareando por separado. Nunca rechaza; es una verificación.
     */
    const segundo = segundoDocumentoDeLaLinea(texto);
    if (segundo) {
      const tipoSegundo = TIPO_DE_CLAVE[segundo];
      reglas.push({
        id: `${id}-segundo`,
        fuente: id,
        regla: resumen,
        estado: "ATENCION",
        evidencia: `esta línea del 46A nombra dos documentos y el examen aparea el primero: el segundo (${tipoSegundo ?? segundo}) no se está verificando por separado, hay que contarlo a mano (laudo DOCDEX 211)`,
      });
    }
    if (!laPrimera) claveYaExigida.set(k, { id, conPapel: Boolean(analizado || pres) });
    /*
     * La línea repetida sale a verificar **siempre que la primera haya encontrado un papel**.
     *
     * **Y un laudo contestó la pregunta que esta regla declara que no puede contestar.** El DOCDEX 366 es un
     * crédito de cuatro pagos parciales cuyo tercer y cuarto pago se cobraban «against identical documents»,
     * el tercero a la vista y el cuarto a plazo, así que las dos líneas del giro aparean a la misma clave. El
     * panel eligió, y eligió **dos**: *«For each drawing under the third and fourth progress payments, a
     * separate set of drafts, one at sight and one at usance, were required to be presented»* — y el
     * beneficiario que presentó uno **perdió el cuarto pago**, el 25 % del crédito. O sea que no decidir es
     * correcto **y** cuesta: lo que la nota hace es poner esa pregunta delante de una persona antes de que la
     * conteste un vencimiento.
     *
     * Antes la condición era «y esta línea también aparea un papel», y eso dependía de un accidente: los
     * cuatro tipos con extracción propia se buscan con `doc()`, que **no consume**, así que la segunda
     * línea volvía a encontrar el mismo papel; los demás se buscan con `presentado()`, que sí consume, y
     * entonces la segunda línea salía **FALTA**. O sea que el mismo hecho —un papel y dos líneas— daba
     * dos respuestas distintas según el tipo de documento.
     *
     * Lo encontró el laudo **DOCDEX 211**: tres líneas del 46A piden declaraciones del embarcador, el
     * beneficiario presentó **una** que contiene las tres, y el panel dice que eso cumple porque *«the
     * number of required documents (disregarding any copies) cannot be ascertained»*. Con la condición
     * vieja el examen sacaba dos FALTA, que afirma «nadie los presentó» y es falso.
     *
     * **El freno sigue en pie y es el que importa:** si la primera línea tampoco encontró papel, las dos
     * salen FALTA. Un crédito que pide un documento que nadie presentó tiene que verse como lo que es.
     */
    if (laPrimera?.conPapel) {
      reglas.push({
        id,
        fuente: id,
        regla: resumen,
        estado: "ATENCION",
        evidencia:
          analizado || pres
            ? `la línea ${laPrimera.id} ya exige este documento y el motor aparea esta línea con el mismo papel: o el crédito pide dos, o esta línea es una condición sobre el que ya exige y hay que leerla a mano (Opinión TA 893rev)`
            : `la línea ${laPrimera.id} ya exige este documento y no quedó otro papel de ese tipo: el motor no puede saber si el crédito pide dos documentos o si alcanza uno que contenga los dos, así que hay que contarlos a mano (laudo DOCDEX 211)`,
      });
    } else if (analizado) {
      reglas.push({
        id,
        fuente: id,
        regla: resumen,
        estado: "OK",
        evidencia: `Analizado (${analizado.nombreArchivo ?? tipo}) · ${ej.texto}`,
      });
    } else if (pres) {
      /*
       * Un documento del 46A que no es de los cuatro tipos con extracción propia, pero que está
       * en el paquete. Lo que se afirma es que **está**, no que sus ejemplares estén contados:
       * igual que en la rama de arriba, el conteo del juego lo mira una persona.
       */
      reglas.push({
        id,
        fuente: id,
        regla: resumen,
        estado: "OK",
        evidencia: `Presentado (${pres.nombreArchivo ?? corto(texto)}) · ${ej.texto}`,
      });
    } else if (gen && APROBADO.has(gen.estado)) {
      reglas.push({
        id,
        fuente: id,
        regla: resumen,
        estado: "OK",
        evidencia: `Generado y aprobado: ${gen.nombre} · ${ej.texto}`,
      });
    } else if (gen) {
      reglas.push({
        id,
        fuente: id,
        regla: resumen,
        estado: "FALTA",
        evidencia: `${gen.nombre} está ${gen.estado.toLowerCase()}: aprobar antes de presentar · ${ej.texto}`,
      });
    } else if (enChecklist && enChecklist.estado === "COMPLETO") {
      reglas.push({
        id,
        fuente: id,
        regla: resumen,
        estado: "ATENCION",
        evidencia: `Marcado completo en el checklist (${enChecklist.label}) pero no analizado: subirlo para verificarlo · ${ej.texto}`,
      });
    } else if (estaDesplazada(k, texto)) {
      /*
       * El crédito admite reemplazar este documento, así que su ausencia no es un FALTA afirmado.
       *
       * Ver `clavesDesplazadasPorSustitucion`: decir «no está en el paquete» sobre una línea que el propio
       * crédito autorizó a no presentar es afirmar algo falso sobre la presentación. Sale a verificar, que
       * es lo que una persona tiene que hacer: mirar si la alternativa está.
       */
      reglas.push({
        id,
        fuente: id,
        regla: resumen,
        estado: "ATENCION",
        evidencia: `no está en el paquete, y el crédito admite presentar otros documentos en lugar de éste: verificar que la alternativa esté presentada (laudo DOCDEX 372) · ${ej.texto}`,
      });
    } else {
      reglas.push({
        id,
        fuente: id,
        regla: resumen,
        estado: "FALTA",
        evidencia: `No está en el paquete${enChecklist ? ` (checklist: ${enChecklist.estado.toLowerCase()})` : ""} · ${ej.texto}`,
      });
    }
  });
  if (!exigidos.length)
    reglas.push({
      id: "46A",
      fuente: "46A",
      regla: "Documentos exigidos por la LC",
      estado: "SIN_DATO",
      evidencia: "La LC cargada no tiene el 46A: pegá el SWIFT o cargalos.",
    });

  /* ---- 47A / UCP: reglas formales sobre lo analizado ---- */
  const cond = (lc.condicionesAdicionales ?? []).join(" ").toUpperCase();
  /*
   * Que el documento cite el número del crédito: quién lo pide cambia el veredicto y la fuente.
   *
   * La regla se activaba con `|| exigidos.length > 0` —cualquier crédito con documentos exigidos— y
   * sin embargo la fuente decía «47A». Con eso el motor le atribuía al crédito una condición que el
   * crédito no escribió, y la falta del número salía como DISCREPANCIA apoyada en ella. Es
   * exactamente lo que este repo no se permite: cada hallazgo tiene que poder ir a buscarse al
   * texto que lo sostiene.
   *
   * Cuando el crédito lo pide, es el 47A y su falta es discrepancia. Cuando no, es práctica
   * bancaria —ayuda a vincular los papeles de un expediente— y su falta no es discrepancia: la
   * propia ISBP 2023 dejó de considerarla una.
   */
  /* También el 46A: este crédito lo pide dentro del documento exigido —«COMMERCIAL INVOICE …
     INDICATING CONTRACT NUMBER AMS2026164, NUMBER OF LETTER OF CREDIT»— y mirar solo el 47A lo
     daba por no pedido. Donde el crédito lo escriba, lo escribió. */
  /* Y se guarda DÓNDE lo pide: la fuente de un hallazgo tiene que poder ir a buscarse al campo
     que lo sostiene, y «47A» sobre algo escrito en el 46A es mandar al banco al lugar
     equivocado. */
  const pedidoEn = dondeSePideElNumeroLC(lc);
  const loPideElCredito = pedidoEn !== null;
  const exigeNumeroLC = loPideElCredito || exigidos.length > 0;
  /*
   * Y en **qué** documentos lo pide, que es lo que el laudo DOCDEX 207 corrige.
   *
   * `null` = en todos (condición general del 47A). Un `Set` = solo en los que la línea del 46A nombra, y
   * exigírselo a los demás es lo que ese panel declaró sin fundamento.
   */
  const dondeDebeCitarse = documentosQueDebenCitarElNumeroLC(lc);
  const exigeFechaDesdeLC =
    /ON OR AFTER THE (LETTER OF CREDIT|L\/?C) DATE|DATED (PRIOR|BEFORE).{0,30}(LETTER OF CREDIT|L\/?C)/.test(cond);
  for (const d of docs) {
    const nombre = d.nombreArchivo ?? d.tipo;
    /*
     * Si el crédito lo pidió **en la línea de otro documento**, a éste no se lo pidió.
     *
     * La regla sigue corriendo sobre todos los papeles —que falte sale en ATENCION y eso no cambia— pero
     * la **fuente** sí: atribuirle «46A» a un certificado cuando el 46A lo pidió en el conocimiento es
     * mandar al banco presentador al lugar equivocado, y la fuente es lo que viaja en el aviso del
     * artículo 16. Es el mismo borde que se arregló en la familia de los puertos, donde el hallazgo
     * invocaba el artículo 20 sobre un fletamento.
     *
     * Lo encontró el laudo DOCDEX 207: *«The credit stipulated that the bill of lading and beneficiary's
     * fax or telex must show the "L/C number", but the credit did not stipulate that all documents should
     * evidence the L/C number. Therefore the issuing bank had no reason for refusing the documents on the
     * grounds of a missing L/C number on the shipping company certificate»*.
     */
    const seLoPideAEste =
      pedidoEn === "47A" ? "47A" : pedidoEn === "46A" && dondeDebeCitarse?.has(d.tipo) ? "46A" : null;
    if (exigeNumeroLC) {
      const n = val(d, "numeroLC");
      const cita =
        (n && norm(n).includes(norm(lc.numero))) || (n && norm(lc.numero).includes(norm(n)) && n.length >= 6);
      reglas.push({
        id: `lc-num-${d.tipo}`,
        /*
         * Omitirlo y citar OTRO no son la misma falta, y por eso no comparten fuente.
         *
         * Que falte es discrepancia solo si el crédito pidió citarlo (47A o 46A); si no lo pidió,
         * la ISBP 2023 dejó de considerarlo una. Pero un documento que dice pertenecer a un
         * crédito distinto no omitió nada: entra en conflicto con el crédito, y eso es el
         * artículo 14 (d) sin importar quién pidió qué. Un dígito cambiado al tipear ya costó un
         * paquete devuelto.
         */
        fuente: n && !cita ? "UCP 600 14d" : (seLoPideAEste ?? "Práctica bancaria"),
        regla: `${nombre}: cita el número de la LC`,
        estado: !n ? "ATENCION" : cita ? "OK" : "DISCREPANCIA",
        evidencia: !n
          ? `no se leyó un número de LC en el documento: verificar a mano. Si el papel de verdad no lo trae, su ausencia **no es motivo de rechazo aunque el crédito lo pida** (laudo DOCDEX 329, unánime, sobre las Opiniones R289, R578, R635 y TA.774: el número está para rastrear documentos que se extravíen), salvo que lo exija una regulación nacional o aduanera${seLoPideAEste ? "" : "; y acá el crédito no lo pide"}`
          : cita
            ? `dice "${n}"`
            : `dice "${n}" y el crédito es "${lc.numero}": el documento pertenece a otro expediente o está mal tipeado`,
      });
    }
    if (exigeFechaDesdeLC && emision) {
      const f = val(d, "fechaDocumento") ?? val(d, "fechaEmbarque");
      const fd = f ? parseFecha(f) : null;
      reglas.push({
        id: `fecha-${d.tipo}`,
        fuente: "47A",
        regla: `${nombre}: fechado el día de la LC o después`,
        estado: !fd ? "ATENCION" : fd >= emision ? "OK" : "DISCREPANCIA",
        evidencia: fd ? `documento ${f} · LC emitida ${lc.fechaEmision}` : "sin fecha legible",
      });
    }
  }

  /* BL: consignee a la orden del banco emisor, freight, notify */
  const bl = doc("BL");
  const reglaBL = exigidos.find((x) => claveDoc(x) === "BL") ?? "";
  if (bl) {
    const consig = val(bl, "consignatario");
    /*
     * A nombre de quién lo pide el crédito. Si no lo dice, NO se supone.
     *
     * Antes se caía al banco emisor, y con eso un crédito que consigna al ordenante —o uno aéreo,
     * donde el consignatario va siempre nominado— daba discrepancia sobre un documento que cumplía
     * exactamente lo pedido. El examen es contra el crédito (art. 14 a): donde el crédito calla no
     * hay discrepancia, hay a lo sumo algo que mirar.
     */
    /* «TO ORDER OF» sin el «THE» es la misma exigencia, y la mitad de los créditos la escribe así. */
    const ordenDe = hastaLaDescripcion(
      /TO\s+(?:THE\s+)?ORDER\s+OF\s+([A-Z0-9 .,'&()-]+)/i.exec(reglaBL)?.[1] ?? null,
    );
    /*
     * «BLANK ENDORSED» dice a nombre de quién, aunque no lo parezca.
     *
     * Un crédito que exige el conocimiento endosado en blanco **está exigiendo que vaya a la orden**:
     * un documento consignado derecho a una parte nominada no se puede endosar. Lo dice la Opinión
     * TA 814rev4 con todas las letras —*«Such a requirement means that the bill of lading be issued
     * 'to order' or 'to order of the shipper' and blank endorsed by the shipper. A bill of lading that
     * is straight consigned to the applicant cannot be endorsed»*— y la discrepancia que el banco
     * levantó, «CONSIGNED TO (applicant) INSTEAD OF 'TO THE ORDER', NOT ENDORSED», **era válida**.
     *
     * Sin esto el motor leía «el crédito no dice a nombre de quién» y salía a verificar, así que
     * perdía una discrepancia que el crédito sí sostiene. Es un falso negativo del lado que paga de
     * más: el banco emisor queda sin control sobre la mercadería.
     *
     * Dos límites para no inventar nada:
     *
     * - si el crédito **sí** nombra a quién consignar además de pedir el endoso en blanco, manda lo
     *   que nombra y esta rama no opina: un «CONSIGNED TO APPLICANT, BLANK ENDORSED» está mal
     *   redactado y el documento que obedece al crédito no puede salir discrepante por eso. El freno
     *   mira si el crédito nombra **una parte** y no si usó el verbo «consigned»: con lo segundo, un
     *   «MADE OUT TO ORDER AND BLANK ENDORSED» —que dice exactamente lo que esta rama verifica— se
     *   quedaba sin examinar y salía con «el crédito no dice a nombre de quién»;
     * - si no se leyó el consignatario, se sale a verificar. El silencio no gana una discrepancia.
     */
    const exigeEndosoEnBlanco = /\bBLANK\s+ENDORSED\b|\bENDORSED\s+IN\s+BLANK\b/i.test(reglaBL);
    /*
     * **A quién** lo consigna, cuando el crédito lo nombra derecho en vez de pedirlo a la orden.
     *
     * El nombre se corta donde empieza la descripción del documento —«MARKED», «NOTIFY», «SHOWING»,
     * «AND BLANK ENDORSED»— por el mismo motivo que el emisor de un certificado: sin el corte, el nombre
     * se lleva la frase entera. Y «TO ORDER» a secas no es un nombre: eso lo resuelve la rama del endoso
     * en blanco.
     */
    const crudoConsignadoA = hastaLaDescripcion(
      /\b(?:CONSIGNED|MADE\s+OUT)\s+TO\s+(?:THE\s+)?([A-Z0-9 .,'&()-]+)/i.exec(reglaBL)?.[1] ?? null,
    );
    const consignadoA = crudoConsignadoA && !/^ORDER\b/i.test(crudoConsignadoA) ? crudoConsignadoA : null;
    if (!ordenDe && exigeEndosoEnBlanco && !consignadoA) {
      const aLaOrden = consig ? /\bORDER\b|\bORDEN\b/i.test(consig) : null;
      reglas.push({
        id: "bl-consignee",
        fuente: "46A",
        regla: "El documento de transporte va a la orden, que es lo que exige el endoso en blanco",
        estado: aLaOrden === null ? "ATENCION" : aLaOrden ? "OK" : "DISCREPANCIA",
        evidencia:
          aLaOrden === null
            ? "el crédito pide el conocimiento endosado en blanco y no se leyó el consignatario: verificar a mano"
            : aLaOrden
              ? `el documento dice "${consig}"`
              : `el documento dice "${consig}", consignado derecho a una parte nominada: así no se puede endosar, y el crédito pide el endoso en blanco`,
      });
    } else if (!ordenDe && consignadoA) {
      /*
       * El crédito que consigna **derecho a una parte nombrada**, que el motor no comparaba.
       *
       * `ordenDe` solo entendía «TO THE ORDER OF», así que un 46A que dice «SHOWING GOODS CONSIGNED TO
       * COMPANY B» —o «CONSIGNED TO APPLICANT», que es la redacción de cualquier crédito aéreo— caía en
       * la rama de abajo y salía con «el crédito no dice a nombre de quién». Eso es **falso**: el crédito
       * lo dice, y el motor perdía la discrepancia. Es un falso negativo del lado que paga de más, el
       * mismo borde que ya había costado el endoso en blanco de TA 814rev4.
       *
       * Lo encontró el laudo DOCDEX 204, donde es el **único** motivo de rechazo válido de seis: el campo
       * 2 del CMR mostraba al ordenante y el texto adicional decía «Goods consigned to Company B» —*«By
       * adding another consignee, Company B, in the field for additional text the documents become
       * contradictory. The contradiction is a discrepancy»*—.
       *
       * El veredicto sale de `veredictoDeNombre`, que es el único comparador de nombres del motor y
       * manda a verificar lo que está a distancia de tipeo en vez de rechazarlo. Y el rol se resuelve
       * igual que en la rama de la orden: un conocimiento no dice «el ordenante», dice el nombre. Y el
       * ordenante sale de la operación, que es de donde lo saca `bl-notify`: el 50 del mensaje no está en
       * `LcInfo`.
       */
      const rol = /^(?:THE\s+)?(?:APPLICANT|ACCOUNTEE|OPENER)\b/i.test(consignadoA)
        ? (op.legs.find((l) => l.tipo === "VENTA")?.contraparte ?? "")
        : /^(?:THE\s+)?(?:ISSUING|OPENING|L\/?C\s+ISSUING)\s+BANK\b|^(?:US|OURSELVES)\b/i.test(consignadoA)
          ? (lc.bancoEmisor ?? "")
          : consignadoA;
      /* El relleno «—» del intérprete no es un nombre: ver la rama de la orden. */
      const aQuien = /[a-z0-9]/i.test(rol) ? rol.trim() : "";
      reglas.push({
        id: "bl-consignee",
        fuente: "46A",
        regla: `El documento de transporte va consignado a quien el crédito nombra (${consignadoA})`,
        estado: !consig || !aQuien ? "ATENCION" : veredictoDeNombre(consig, aQuien),
        evidencia: !consig
          ? `el crédito lo consigna a "${consignadoA}" y no se leyó el consignatario: verificar a mano`
          : !aQuien
            ? `el crédito lo consigna a "${consignadoA}" y no se leyó ese nombre en el crédito: verificar a mano`
            : `el documento dice "${consig}" · el crédito pide "${aQuien}"`,
      });
    } else if (!ordenDe) {
      reglas.push({
        id: "bl-consignee",
        fuente: "46A",
        regla: "A nombre de quién va el documento de transporte",
        estado: "ATENCION",
        evidencia: consig
          ? `el crédito no dice a nombre de quién y el documento dice "${consig}": verificar a mano`
          : "el crédito no dice a nombre de quién y no se leyó el consignatario: verificar a mano",
      });
    }
    if (ordenDe) {
      /*
       * «To the order of **the issuing bank**» es un rol, no un nombre.
       *
       * Es la redacción más corriente que hay en un 46A, y el motor la comparaba literalmente: con el
       * conocimiento consignado al banco que el crédito nombra en el 52A, la regla daba DISCREPANCIA
       * sobre un documento que cumple exactamente lo pedido. Lo encontró la Opinión TA 765rev, cuyo 46A
       * dice «consigned to the order of the issuing bank and marked freight collect» — y además el
       * extractor se llevaba el «AND» de la frase siguiente adentro del nombre.
       *
       * Cuando el crédito nombra el rol, lo que hay que comparar es **el banco de ese rol**: el del 52A
       * para el emisor, y si no se leyó, el aviso en vez del rechazo. El rol se resuelve con el nombre
       * del banco y no al revés, porque un conocimiento no dice «a la orden del banco emisor»: dice el
       * nombre.
       */
      const esRol = /^(?:THE\s+)?(?:ISSUING|OPENING|L\/?C\s+ISSUING)\s+BANK\b|^(?:US|OURSELVES)\b/i.test(ordenDe);
      /*
       * Y el guion largo no es un nombre de banco.
       *
       * El intérprete de SWIFT rellena con «—» los campos que no vinieron, así que `bancoEmisor` puede
       * traerlo. Sin este filtro la comparación daba OK —el nombre normalizado del relleno es la cadena
       * vacía, y todo la contiene— o sea que el rol se daba por cumplido contra un dato que falta. **Es
       * la tercera vez que ese relleno se cuela como si fuera un dato**: antes fue el campo 48 y antes
       * el vencimiento. Un placeholder que parece un valor es lo mismo que un valor inventado.
       */
      const nombreDelEmisor = (lc.bancoEmisor ?? "").trim();
      const delRol = esRol && /[a-z0-9]/i.test(nombreDelEmisor) ? nombreDelEmisor : "";
      const aQuien = esRol ? delRol : ordenDe;
      const ok =
        consig && aQuien
          ? norm(consig).includes(norm(aQuien)) || norm(aQuien).includes(norm(consig.replace(/to the order of/i, "")))
          : false;
      reglas.push({
        id: "bl-consignee",
        fuente: "46A",
        regla: esRol
          ? `BL consignado a la orden del banco emisor${delRol ? ` ("${delRol}")` : ""}`
          : `BL consignado "to the order of ${ordenDe}"`,
        estado: !consig || (esRol && !delRol) ? "ATENCION" : ok ? "OK" : "DISCREPANCIA",
        evidencia: !consig
          ? "no se leyó el consignee"
          : esRol && !delRol
            ? `dice "${consig}" y el crédito lo pide a la orden del banco emisor, que no se leyó: verificar a mano`
            : `dice "${consig}"`,
      });
    }
    /*
     * La marca de flete, solo si el crédito la pide.
     *
     * Antes, cuando el 46A no la mencionaba, se deducía del incoterm de la operación —y sin
     * incoterm se asumía PREPAID—, así que un BL marcado FREIGHT COLLECT contra un crédito que no
     * habla del flete salía discrepante por una marca que nadie pidió. El incoterno de la operación
     * dice cómo se pactó la venta, no qué exige el crédito, y son cosas distintas.
     */
    const flete = /FREIGHT\s+(PREPAID|COLLECT)/i.exec(reglaBL)?.[1]?.toUpperCase() ?? null;
    const fl = val(bl, "flete");
    if (flete) {
      reglas.push({
        id: "bl-freight",
        fuente: "46A",
        regla: `BL marcado "FREIGHT ${flete}"`,
        estado: !fl ? "ATENCION" : fl.toUpperCase().includes(flete) ? "OK" : "DISCREPANCIA",
        evidencia: fl ? `dice "${fl}"` : "no se leyó la marca de flete",
      });
    } else if (fl) {
      reglas.push({
        id: "bl-freight",
        fuente: "46A",
        regla: "Marca de flete del documento de transporte",
        estado: "ATENCION",
        evidencia: `el crédito no pide una marca de flete y el documento dice "${fl}": verificar contra el incoterm de la venta`,
      });
    }
    /*
     * Las formas en que un crédito pide que se notifique al ordenante.
     *
     * Era `/NOTIFY\s+APPLICANT/` y nada más, así que un 46A que dice **«NOTIFY ACCOUNTEE»** —vocabulario
     * estándar de estos créditos, y el del laudo DOCDEX 205— dejaba la exigencia **sin examinar**. Desde
     * el tablero eso se ve igual que un crédito que no pide notify, que es el disfraz que este
     * repositorio persigue.
     *
     * Las tres palabras son las que nombran al ordenante por su rol —applicant, accountee, opener— y
     * `NOTIFY PARTY:` entra porque es como lo escribe la mitad de los créditos. Lo que **no** entra es un
     * notify a nombre de un tercero: «NOTIFY PARTY: XYZ CO LTD» no activa la comparación contra el
     * ordenante, porque ahí el crédito nombró a otro y compararlo sería inventar una discrepancia.
     */
    if (/NOTIFY(?:\s+PARTY)?\s*:?\s*(?:APPLICANT|ACCOUNTEE|OPENER)\b/i.test(reglaBL)) {
      const nt = val(bl, "notify") ?? val(bl, "importador");
      const cliente = op.legs.find((l) => l.tipo === "VENTA")?.contraparte ?? "";
      /*
       * Sin saber quién es el ordenante no se puede decir que el notify esté mal.
       *
       * Faltaba la mitad del control: si el campo 50 del crédito no se pudo leer, `cliente` queda
       * vacío y el resultado era DISCREPANCIA — con la evidencia terminando en «· ordenante » y
       * nada después. El conocimiento del expediente de referencia dice «NOTIFY ORIENT FEED (PVT) LTD», que
       * es exactamente el ordenante, y salía discrepante por un dato que falta de este lado.
       */
      /*
       * Y cómo se comparan los dos nombres, que es donde los tribunales se dividen.
       *
       * Antes alcanzaba con que el notify **contuviera la primera palabra** del ordenante. Con eso,
       * el caso *Beyene v Irving Trust* (2d Cir. 1985) salía **OK**: el conocimiento decía «Mohammed
       * Soran» donde el crédito decía «Mohammed Sofan», comparten «Mohammed», y el tribunal resolvió
       * que la discrepancia **era válida** —*«"Sofan" was not a name that was inconsequential to the
       * document, for Sofan was the person to whom the shipper was to give notice of the arrival of
       * the goods, and the misspelling of his name could well have resulted in his nonreceipt of the
       * goods»*—. Es el mismo defecto que las once contrapartes del ERP que coincidían con las listas
       * de sanciones por la palabra «LLC»: una palabra compartida no identifica a nadie.
       *
       * Pero el otro lado también tiene sentencia: en *Hing Yip Hing Fat v Daiwa* (Hong Kong, 1991)
       * «Cheergoal Industrial» por «Cheergoal Industries» **no** era discrepancia, *«an obvious
       * typographical error»*. Y el propio tribunal de Beyene da el contraejemplo: *«as might be the
       * case if, for example, "Smith" were misspelled "Smithh"»*.
       *
       * O sea que la línea entre un error de tipeo inocuo y uno material **la trazan los tribunales
       * caso por caso, y no coinciden**. Así que el motor usa tres bandas y no dos:
       *
       * - nombres iguales, o uno contenido en el otro con datos de más → **OK**;
       * - nombres que difieren en lo que parece un error de tipeo → **ATENCION**, con las dos
       *   sentencias nombradas. El motor no puede medir si el error es material: eso depende de para
       *   qué sirve el nombre, y acá sirve para que a alguien le avisen que llegó la mercadería;
       * - nombres que no se parecen → **DISCREPANCIA**, como antes.
       *
       * Lo que **no** se tocó, y es la decisión grande que queda abierta: las demás reglas que usan
       * `comparaISBP` siguen tratando un TIPEO como aceptable sin decirlo. Cambiar eso toca el examen
       * entero y necesita medirse contra el expediente real antes.
       */
      const cmp = nt && cliente ? comparaISBP(nt, cliente) : null;
      reglas.push({
        id: "bl-notify",
        fuente: "46A",
        regla: "BL notify: el ordenante (applicant)",
        estado: !nt || !cliente ? "ATENCION" : veredictoDeNombre(nt, cliente),
        evidencia: !nt
          ? "no se leyó el notify"
          : !cliente
            ? `dice "${nt}" y no se leyó el ordenante del crédito: verificar a mano`
            : cmp === "TIPEO"
              ? `dice "${nt}" y el ordenante es ${cliente}: ${NOTA_TIPEO_DE_NOMBRE}`
              : `dice "${nt}" · ordenante "${cliente}"`,
      });
    }
  }

  /* Factura: "as per proforma", FOB y flete separados, dentro del monto de la LC */
  const fac = doc("FACTURA");
  const reglaFac = exigidos.find((x) => claveDoc(x) === "INVOICE") ?? "";
  if (fac) {
    if (/PROFORMA/i.test(reglaFac)) {
      const ref = val(fac, "referenciaProforma");
      const numProforma = /PROFORMA INVOICE NO\.?\s*([A-Z0-9-]+)/i.exec(reglaFac)?.[1];
      const ok = ref && (!numProforma || ref.includes(numProforma));
      reglas.push({
        id: "fac-proforma",
        fuente: "46A",
        regla: `Factura: "goods shipped as per proforma invoice${numProforma ? ` no. ${numProforma}` : ""}"`,
        estado: !ref ? "DISCREPANCIA" : ok ? "OK" : "DISCREPANCIA",
        evidencia: ref ? `dice "${ref}"` : "la factura no cita la proforma",
      });
    }
    if (/FOB VALUE AND FREIGHT|FREIGHT AMOUNTS? SEPARATELY|SHOWING.{0,30}FREIGHT/i.test(reglaFac)) {
      const fl = val(fac, "flete");
      reglas.push({
        id: "fac-flete",
        fuente: "46A",
        regla: "Factura: valor FOB y flete por separado",
        estado: fl ? "OK" : "DISCREPANCIA",
        evidencia: fl ? `flete desglosado: "${fl}"` : "no se leyó un flete desglosado en la factura",
      });
    }
    const monto = val(fac, "montoTotal");
    const n = monto ? parseNumero(monto) : null;
    if (n != null && lc.monto != null && lc.monto > 0) {
      // Tolerancia de IMPORTE: el 5 % del artículo 30 (b) es de cantidad, no de monto.
      const tol = toleranciaDeImporte(lc);
      const tope = lc.monto * (1 + tol);
      const excede = n > tope + 1e-9;
      /*
       * Y el mismo freno que `giro-saldo`: si el 47A deja fluctuar el importe, ese tope no es el techo.
       *
       * *Korea Exchange Bank v SCB* [2005] SGHC 220. Son dos reglas sobre el mismo hecho —una mira la
       * factura y la otra el acumulado— y tienen que decir lo mismo, que es la lección de *Bulgrains*.
       */
      const fluctua = excede && importeFluctuaPorElCredito(lc);
      reglas.push({
        id: "fac-monto",
        fuente: "32B/39A",
        regla: `Factura dentro del monto de la LC (${lc.moneda ?? ""} ${lc.monto.toLocaleString("es-UY")}${tol ? ` ±${Math.round(tol * 100)} %` : ""})`,
        estado: fluctua ? "ATENCION" : excede ? "DISCREPANCIA" : "OK",
        evidencia:
          `factura ${monto}${excede ? ` supera el tope ${tope.toLocaleString("es-UY")}` : ""}` +
          (fluctua
            ? ", y el 47A deja que el importe del crédito fluctúe solo con el precio: ese tope no es el techo y hay que verificarlo contra la cotización (Korea Exchange Bank v SCB)"
            : ""),
      });
    }
    const exp = val(fac, "exportador");
    if (exp) {
      /*
       * Y acá la misma comparación que `ucp-18a-i`, porque las dos reglas miran el mismo hecho.
       *
       * Esta comparaba con `norm(exp).includes(primera palabra del beneficiario)`: con eso «Bulgrains
       * & Co Ltd» contra «Bulgrains Co Ltd» salía OK, que es la discrepancia que el High Court declaró
       * material en *Bulgrains v Shinhan Bank*. Dos reglas sobre el mismo hecho con dos comparadores
       * distintos pueden contradecirse, y se contradecían: `ucp-18a-i` usaba un matcher de lugares y
       * ésta un prefijo. Las dos pasan por `veredictoDeNombre`.
       *
       * **Que las dos existan es una decisión pendiente del dueño**, no un arreglo: `fac-emisor` es la
       * versión vieja, vive en este módulo y la mesa la muestra; `ucp-18a-i` es la del artículo. Una de
       * las dos tiene que desaparecer, y cuál toca lo que la pantalla ya enseña.
       */
      /*
       * Y sin el nombre del beneficiario no se concluye nada, que es lo que el control de
       * `saber-menos` atrapó al cambiar esto: con `empresaRazonSocial` vacía, el `includes` de la
       * primera palabra daba siempre verdadero —comparaba contra la cadena vacía— así que la regla
       * salía OK por el motivo equivocado. Comparar de verdad la volvía DISCREPANCIA, y vaciar un dato
       * del crédito no puede inventar una discrepancia.
       */
      /*
       * Y el mismo trato para un nombre que el motor **no puede leer**, que es la Opinión TA 886rev.
       *
       * Las dos reglas del 18 (a) (i) tienen que decir lo mismo —la lección de *Bulgrains v Shinhan*—
       * así que el alfabeto y la cláusula del idioma se deciden en `veredictoDeNombre` y acá solo se
       * elige la frase. Sin esto, `ucp-18a-i` avisaba y ésta rechazaba sobre el mismo sello.
       */
      const ilegible = Boolean(exp.trim()) && normISBP(exp).trim() === "";
      const exigeIngles = creditoExigeIngles(lc);
      const v = input.empresaRazonSocial?.trim()
        ? veredictoDeNombre(exp, input.empresaRazonSocial, exigeIngles)
        : "ATENCION";
      reglas.push({
        id: "fac-emisor",
        fuente: "UCP 600 18a",
        regla: "Factura emitida por el beneficiario",
        estado: v,
        evidencia: !input.empresaRazonSocial?.trim()
          ? `emisor "${exp}" y no se leyó el beneficiario del crédito: verificar a mano`
          : ilegible
            ? `emisor "${exp}": ${exigeIngles ? NOTA_NOMBRE_ILEGIBLE_CON_INGLES : NOTA_NOMBRE_ILEGIBLE}`
            : v === "ATENCION"
              ? `emisor "${exp}" · beneficiario "${input.empresaRazonSocial}": ${NOTA_TIPEO_DE_NOMBRE}`
              : `emisor "${exp}" · beneficiario "${input.empresaRazonSocial}"`,
      });
    }
  }

  /* D3: la LC fija cómo figura el beneficiario; los documentos propios tienen que repetirlo (en el
     caso de referencia la proforma llevaba Colón 1498 y la LC Cerrito 820) */
  if (lc.beneficiarioDireccion && input.empresaDireccion) {
    const calle = (s: string) =>
      norm(s)
        .replace(/\b(of|oficina|office|cp|piso|fl|floor)\b.*$/, "")
        .trim()
        .split(" ")
        .slice(0, 2)
        .join(" ");
    const ok =
      norm(lc.beneficiarioDireccion).includes(calle(input.empresaDireccion)) ||
      norm(input.empresaDireccion).includes(calle(lc.beneficiarioDireccion));
    /*
     * El artículo 14 (j) dice lo contrario de lo que este aviso sugería.
     *
     * «Cuando las direcciones del beneficiario y del ordenante aparecen en cualquier documento
     * exigido, NO necesitan ser las mismas que las del crédito… pero deben estar dentro del mismo
     * país.» El aviso terminaba en «usar la de la LC en factura y certificados», que suena a
     * exigencia y no lo es: usarla evita preguntas y sigue siendo un buen consejo, pero presentarla
     * distinta no es discrepancia y la herramienta no puede dar a entender que sí.
     *
     * Lo único que el artículo sí exige —el mismo país— no se puede comprobar acá: el extractor
     * pide la razón social sin dirección, así que del documento no viene el país. Se nombra para
     * que quien revisa lo mire.
     */
    reglas.push({
      id: "beneficiario-direccion",
      fuente: "UCP 600 14j",
      regla: "Dirección del beneficiario en los documentos propios",
      estado: ok ? "OK" : "ATENCION",
      evidencia: ok
        ? `LC: "${lc.beneficiarioDireccion}" · Ajustes: "${input.empresaDireccion}"`
        : `LC: "${lc.beneficiarioDireccion}" · Ajustes: "${input.empresaDireccion}" — no necesitan ser las mismas (art. 14 j); lo único exigido es que estén en el mismo país, y usar la de la LC evita preguntas`,
    });
  }

  /* entre documentos (art. 14d) */
  for (const c of compararEntreDocumentos(docs.map((d) => ({ tipo: d.tipo, campos: d.campos })))) {
    reglas.push({
      id: `cruce-${norm(c.campo).replace(/ /g, "-")}`,
      fuente: "UCP 600 14d",
      regla: c.titulo,
      estado: c.severidad === "ALTA" ? "DISCREPANCIA" : "ATENCION",
      evidencia: c.detalle,
    });
  }

  /* plazos: último embarque, presentación, vencimiento */
  const soloCopia = pideSoloCopiaDelTransporte(lc.documentosExigidos);
  /*
   * Y el caso en que el artículo 14 (c) **no impone ningún plazo**, que es textual y no interpretativo.
   *
   * El inciso dice: «**A presentation including one or more original transport documents** under articles
   * 19 a 25 must be made by or on behalf of the beneficiary not later than 21 calendar days after the date
   * of shipment». Sin documento de transporte original en la presentación no hay plazo que correr: el único
   * límite es el vencimiento, que mira `giro-vencimiento`.
   *
   * El motor sacaba **SIN_DATO** —«sin fecha real de BL: la cuenta no arranca»— y eso dice «no pude»
   * cuando la verdad es «no aplica». Es la misma distinción que este repositorio persigue del otro lado:
   * una regla ausente se lee como «no aplica» y hay que decir «no pude»; acá era al revés.
   *
   * Lo encontró el laudo DOCDEX 319, un standby sujeto a las UCP 600 que pide una copia de factura, una
   * declaración del beneficiario y una carta de garantía, y ningún documento de transporte: *«Because no
   * transport document is required for presentation, the transport articles of UCP 600 do not apply»*.
   *
   * **Y un borde del corpus, medido en la auditoría de las observaciones:** tres casos del banco de pruebas
   * —DOCDEX 208, TA 756 y TA 873rev— entran por esta rama porque su 46A **reconstruido** no pide documento
   * de transporte: son Opiniones sobre la factura y la fuente no transcribe el 46A completo. La regla es
   * correcta sobre los datos que recibe, pero en esos tres la afirmación «el crédito no exige documento de
   * transporte» descansa en la reconstrucción y no en la Opinión. Vale saberlo antes de leer esos exámenes
   * como si dijeran algo del crédito real.
   *
   * **Las dos condiciones a la vez, y eso es a propósito**: que el crédito no lo pida y que no se haya
   * presentado. Si el beneficiario presenta uno igual, el inciso habla de la presentación y no de lo que el
   * crédito pidió, así que decidir ahí sería resolver si un documento desestimado por el 14 (g) «cuenta»
   * para el 14 (c) — una pregunta que este laudo no contesta.
   */
  const sinTransporteExigidoNiPresentado =
    !bl && !(lc.documentosExigidos ?? []).some((d) => claveDoc(d) === "BL");
  /*
   * Y se le pasa la fecha de **emisión** del documento de transporte, porque el crédito puede contar
   * desde ella: *Fortis Bank v Indian Overseas Bank*, campo 48 «within 21 days from B/L Date». Ver
   * `baseDelPlazo`. Sin este dato el motor contaba siempre desde el a bordo y producía la tardía que
   * dos instancias inglesas rechazaron.
   */
  const lim = limitePresentacion(lc, op.blReal, op.fechaEmbarque, bl ? val(bl, "fechaDocumento") : null);
  let diasParaPresentar: number | null = null;
  if (sinTransporteExigidoNiPresentado) {
    reglas.push({
      id: "plazo",
      fuente: "UCP 600 14c",
      regla: "Plazo de presentación del artículo 14 (c)",
      estado: "OK",
      evidencia:
        "el crédito no exige documento de transporte y la presentación no incluye ninguno, así que el inciso no impone plazo —habla de «a presentation including one or more original transport documents»— y el único límite es el vencimiento (laudo DOCDEX 319: «because no transport document is required for presentation, the transport articles of UCP 600 do not apply»)",
    });
  } else if (soloCopia) {
    /*
     * El crédito pide solo una copia del documento de transporte: el plazo no se mide contra su fecha.
     *
     * Ver `pideSoloCopiaDelTransporte`. Sale en ATENCION y no en OK porque el crédito **puede** fijar
     * la base del plazo —y entonces sí rige— y eso lo lee una persona; y no en SIN_DATO porque el dato
     * está, lo que no corresponde es la cuenta.
     */
    reglas.push({
      id: "plazo",
      fuente: "ISBP 821 A6c",
      regla: "Plazo de presentación con una copia del documento de transporte",
      estado: "ATENCION",
      evidencia:
        "el crédito pide una copia del documento de transporte, y una copia no está sujeta al plazo del artículo 14 (c) ni al del campo 48 salvo que el crédito fije la base (ISBP 821 A6 c y Opinión TA 767rev): verificar a mano si el crédito la fija",
    });
  } else if (lim && !lim.esEstimada) {
    /*
     * Dos preguntas distintas con la misma cuenta, y confundirlas rechazaba lo conforme.
     *
     * Si el juego **ya se presentó**, lo que decide el artículo 14 (c) es si llegó dentro del plazo
     * —se mide contra el día de la presentación— y el día del examen no entra. Si todavía no se
     * presentó, la pregunta es cuántos días quedan, y ahí sí manda `hoy`. Antes se usaba `hoy`
     * siempre: con un examen posterior al límite, una presentación en plazo salía DISCREPANCIA, y
     * eso pasa en cuanto el examen no es el mismo día. El artículo 14 (b) le da al banco cinco días
     * hábiles, así que era el caso corriente y no el raro.
     *
     * Y la banda de ATENCION tampoco se aplica a lo ya presentado: «quedan tres días» es un aviso
     * para quien va a presentar, no un hallazgo sobre un juego que está en el escritorio.
     */
    const yaPresentada = input.presentadaEl ?? null;
    diasParaPresentar = diffDias(yaPresentada ?? hoy, lim.limite);
    /*
     * Y dos cosas que el campo 48 puede decir y antes se trataban como si no dijera nada.
     *
     * **El plazo hasta el vencimiento** —*Deutsche Bank v CIMB* [2017] EWHC 3380 (Comm)— desplaza los
     * veintiún días del artículo 14 (c): el límite es el 31D. El motor caía al plazo por defecto y
     * producía justo la discrepancia que ese tribunal declaró inválida, con USD 9.959.452,57 en juego.
     * Sale OK si la presentación entró antes del vencimiento, con la sentencia nombrada — y nombrarla
     * importa, porque los peritos de las dos partes coincidieron en que la ICC nunca contestó esto.
     *
     * **Un 48 que el motor no pudo leer** sale a verificar en vez de dictaminar. Antes caía a los
     * veintiún días y lo presentaba como si el crédito no hubiera fijado plazo: el silencio contado
     * como conformidad, y encima sobre la discrepancia más corriente del negocio.
     */
    const porElVencimiento = lim.hastaElVencimiento;
    reglas.push({
      id: "plazo",
      fuente: lim.plazoPorDefectoUCP ? "UCP 600 14c" : "48",
      regla: porElVencimiento
        ? yaPresentada
          ? "Presentada antes del vencimiento, que es el plazo que fija el campo 48"
          : "Presentar antes del vencimiento, que es el plazo que fija el campo 48"
        : yaPresentada
          ? `Presentada dentro de ${lim.dias} días del BL y antes del vencimiento`
          : `Presentar dentro de ${lim.dias} días del BL y antes del vencimiento`,
      estado: lim.plazoNoLeido
        ? "ATENCION"
        : diasParaPresentar < 0
          ? "DISCREPANCIA"
          : yaPresentada
            ? "OK"
            : diasParaPresentar <= 3
              ? "ATENCION"
              : "OK",
      evidencia: lim.plazoNoLeido
        ? `el campo 48 dice "${lc.plazoPresentacion}" y no se le pudo leer un plazo: el examen usó los 21 días del artículo 14 (c) para la cuenta, pero si esa redacción fija otro plazo manda el crédito. Verificar a mano`
        : porElVencimiento
          ? yaPresentada
            ? `BL ${op.blReal} → el campo 48 fija el plazo hasta el vencimiento, ${lim.limite.toLocaleDateString("es-UY")} · presentada ${yaPresentada.toLocaleDateString("es-UY")} — un campo 48 así desplaza los 21 días del artículo 14 (c) (Deutsche Bank v CIMB, Commercial Court de Inglaterra); la ICC nunca contestó este punto`
            : `BL ${op.blReal} → el campo 48 fija el plazo hasta el vencimiento, ${lim.limite.toLocaleDateString("es-UY")} · ${diasParaPresentar >= 0 ? `quedan ${diasParaPresentar} días` : `venció hace ${-diasParaPresentar} días`}`
          : lim.base === "FECHA_DEL_BL"
            ? yaPresentada
              ? `el campo 48 cuenta desde la fecha del conocimiento, ${lim.fechaBL.toLocaleDateString("es-UY")}, y no desde el a bordo → límite ${lim.limite.toLocaleDateString("es-UY")} · presentada ${yaPresentada.toLocaleDateString("es-UY")} — así lo resolvió Fortis Bank v Indian Overseas Bank (Court of Appeal de Inglaterra)`
              : `el campo 48 cuenta desde la fecha del conocimiento, ${lim.fechaBL.toLocaleDateString("es-UY")}, y no desde el a bordo → límite ${lim.limite.toLocaleDateString("es-UY")} · ${diasParaPresentar >= 0 ? `quedan ${diasParaPresentar} días` : `venció hace ${-diasParaPresentar} días`}`
            : yaPresentada
              ? `BL ${op.blReal} → límite ${lim.limite.toLocaleDateString("es-UY")} · presentada ${yaPresentada.toLocaleDateString("es-UY")}`
              : `BL ${op.blReal} → límite ${lim.limite.toLocaleDateString("es-UY")} · ${diasParaPresentar >= 0 ? `quedan ${diasParaPresentar} días` : `venció hace ${-diasParaPresentar} días`}`,
    });
  } else {
    reglas.push({
      id: "plazo",
      fuente: "48",
      regla: "Plazo de presentación",
      estado: "SIN_DATO",
      evidencia: "sin fecha real de BL en el seguimiento: la cuenta no arranca",
    });
  }
  if (bl && lc.limiteEmbarque !== "—") {
    const ab = val(bl, "fechaEmbarque");
    const f = ab ? parseFecha(ab) : null;
    const l = parseFecha(lc.limiteEmbarque);
    if (soloCopia && ab) {
      /*
       * Y la fecha de embarque de una copia tampoco determina si el embarque fue tardío.
       *
       * La Opinión TA 767rev lo dice del otro lado: con el **original** presentado en vez de la copia,
       * «the shipment date shown on the original Air Waybill can be used to determine if the shipment
       * is within the specified time». Con la copia, no.
       */
      reglas.push({
        id: "ultimo-embarque",
        fuente: "ISBP 821 A6c",
        regla: `Último embarque ${lc.limiteEmbarque}, con una copia del documento de transporte`,
        estado: "ATENCION",
        evidencia: `la copia dice ${ab}, y la fecha de una copia no determina si el embarque fue tardío (Opinión TA 767rev): verificar a mano`,
      });
    } else if (f && l)
      reglas.push({
        id: "ultimo-embarque",
        fuente: "44C",
        regla: `A bordo a más tardar el ${lc.limiteEmbarque}`,
        estado: f > l ? "DISCREPANCIA" : "OK",
        evidencia: `BL a bordo ${ab}`,
      });
  }

  const faltan = reglas.filter((r) => r.estado === "FALTA").length;
  const discrepancias = reglas.filter((r) => r.estado === "DISCREPANCIA").length;
  const atencion = reglas.filter((r) => r.estado === "ATENCION").length;
  return {
    reglas,
    faltan,
    discrepancias,
    atencion,
    listo: faltan === 0 && discrepancias === 0 && exigidos.length > 0,
    verificado: faltan === 0 && discrepancias === 0 && atencion === 0 && exigidos.length > 0,
    sinVerificar: atencion,
    feePorJuego: feeDiscrepancia(lc.condicionesAdicionales),
    diasParaPresentar,
  };
}
