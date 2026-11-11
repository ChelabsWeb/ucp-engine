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
    /\b(bills?\s+of\s+lading|b\/?ls?|air\s*way\s*bills?|awbs?|air\s+consignment\s+notes?|sea\s*way\s*bills?|consignment\s+notes?|cmr|(?:rail|road|truck)\s*way\s*bills?|cartas?\s+de\s+porte|inland\s+waterway|multimodal|combined\s+transport|intermodal|through\s+bill|courier\s+receipt|post\s+receipt|transport\s+document|conocimiento)\b/i;
  const COPIA = /\b(photocopy|photocopies|copy|copies)\b/i;
  /*
   * Y el plural entre paréntesis, que es como lo escribe un mensaje SWIFT: «BILL(S) OF LADING». El apareo
   * normaliza la puntuación y esta lista no, así que «COPY OF MARINE BILL(S) OF LADING» apareaba y no
   * era «solo una copia». Lo encontró, en su primera corrida, el control que compara las dos listas
   * (`apareo-46a.test.ts`) — la tercera vez que se desalinean, después de «CMR» y de la carretera.
   */
  const sinParentesis = linea.replace(/\(s\)/gi, "s");
  const iCopia = sinParentesis.search(COPIA);
  const iNombre = sinParentesis.search(NOMBRE_TRANSPORTE);
  return iCopia >= 0 && iNombre >= 0 && iCopia < iNombre;
}

/**
 * Y el caso del medio: el crédito que **admite** original **o** copia, a elección del beneficiario.
 *
 * La función de arriba contesta «el crédito pide **únicamente** una copia» y hay un tercer estado que
 * no contestaba nadie. La Opinión **R 455** es ese crédito —su 46A dice «Bill of lading - original or
 * copy»— y el panel decide que **admitir** alcanza:
 *
 * > **Requesting or allowing a copy overrides the sub-Article 23(a)(iv) requirement** regarding the
 * > presentation of a sole original or a full set thereof.
 *
 * > Where copies (non-negotiable) are presented, they do not necessarily evidence signature by the
 * > carrier or its agent … **a copy need not be signed.** Where the agent or the carrier provides a
 * > true non-negotiable copy of the bill of lading **it will bear no signatures or other markings of
 * > authentication.**
 *
 * **Lo que esto no es: una licencia que dependa solo del crédito.** Si el crédito admite las dos cosas
 * y el beneficiario presenta un **original**, los artículos se aplican enteros — así que quien use esta
 * función tiene que mirar además **qué se presentó**. Es la misma forma que el laudo DOCDEX 238 dejó
 * escrita para el plazo del 14 (c): lo que decide es la presentación y no lo que el crédito pidió.
 */
export function admiteCopiaDelTransporte(documentosExigidos: string[] | null | undefined): boolean {
  const linea = (documentosExigidos ?? []).find((d) => claveDoc(d) === "BL");
  if (!linea) return false;
  /* «original or copy», «originals or copies», y al revés — la alternativa, no un conteo de ejemplares */
  return (
    /\b(originals?|full\s+set)\b[^.;]{0,24}\bor\b[^.;]{0,24}\b(photocopy|photocopies|copy|copies)\b/i.test(linea) ||
    /\b(photocopy|photocopies|copy|copies)\b[^.;]{0,24}\bor\b[^.;]{0,24}\b(originals?|full\s+set)\b/i.test(linea)
  );
}

/**
 * ¿El crédito **admite** un recibo de agente de carga en lugar del documento de transporte?
 *
 * La Opinión **R 640 / TA 641** lo decide, y la regla es tan tajante como la de la copia: *«A forwarding
 * agent's "goods receipt" **is not a transport document covered by the content of UCP 600 articles
 * 19-25**. As implied by its title, such a document is a receipt for goods and **is not a document
 * intended to evidence shipment having occurred between two places**, ports or airports»*. El 46A de ese
 * crédito ofrece tres alternativas —«package of consignment notes (originals), or set of bills of lading
 * (originals) **or forwarding agent's "goods receipt"** - 1 original»— y el confirmador rechazó el recibo
 * porque *«does not evidence shipment to Russia»*. El panel: **no hay discrepancia.**
 *
 * > In the context of a forwarding agent's goods receipt, **there is no requirement for the document to
 * > evidence a place of delivery, merely the receipt of goods.** The inclusion of a place of delivery (or
 * > port of discharge) **is only relevant in the context of the issuance of consignment notes or bills of
 * > lading.**
 *
 * **Y la línea del 46A aparea a `BL`**, porque su cabeza nombra los otros dos documentos: así que el
 * recibo entraba por el capítulo del transporte y el motor le pedía cinco cosas que el artículo no le
 * pide —el puerto de descarga, la anotación de a bordo, el juego de originales, la cláusula de documento
 * limpio y el bloque de firma—, las cinco en ATENCION. No rechazaba, pero **cinco avisos sobre un papel
 * que un panel declara conforme es ruido, y el ruido enseña a ignorar los avisos**.
 *
 * El freno es el mismo que la rama de la copia de la Opinión R 455, y por el mismo motivo: **se mira la
 * presentación y no solo el crédito**. Si el crédito no ofrece esta alternativa, el capítulo corre
 * entero sobre lo que se presente; y si la ofrece pero llega un conocimiento, también. Lo que apaga los
 * artículos es que el crédito lo **admita** y que el papel presentado **sea** ese recibo.
 */
export function admiteReciboDeAgente(documentosExigidos: string[] | null | undefined): boolean {
  const linea = (documentosExigidos ?? []).find((d) => claveDoc(d) === "BL");
  return linea ? ES_RECIBO_DE_AGENTE.test(linea) : false;
}

/**
 * Los nombres con que se titula un recibo de agente de carga.
 *
 * **Angosto a propósito, y el borde que no se puede pisar es el artículo 25**: un «courier receipt» y un
 * «post receipt» **sí** son documentos de transporte, y tienen su propio artículo. Lo mismo el «cargo
 * receipt» del laudo DOCDEX 215, que ahí es el papel contra el que se cobra y no un documento de
 * transporte — pero el nombre no alcanza para decidirlo, así que queda afuera: lo que entra es lo que la
 * Opinión nombra, un recibo **de un agente de carga**.
 */
export const ES_RECIBO_DE_AGENTE =
  /\b(forwarding|forwarder'?s?|freight\s+forwarder'?s?)\b[^.;]{0,24}\b(goods\s+)?receipt\b|\bgoods\s+receipt\b|\bforwarder'?s?\s+certificate\s+of\s+receipt\b|\bFCR\b/i;

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
/**
 * Las tres cosas que un 46A dice sobre a nombre de quién va el documento de transporte.
 *
 * Viven acá porque acá se examinan, y van exportadas porque **la revisión del crédito pregunta lo
 * mismo**: el laudo DOCDEX 288 declaró irregular un crédito que pide el conocimiento a la orden del
 * banco emisor **y** endosado en blanco, porque solo el consignatario puede endosarlo. Escribir una
 * segunda copia de estos patrones en `emision.ts` sería la forma de que el examen y la revisión
 * terminen diciendo cosas distintas sobre la misma línea.
 */
export const EXIGE_ENDOSO_EN_BLANCO = /\bBLANK\s+ENDORSED\b|\bENDORSED\s+IN\s+BLANK\b/i;
/**
 * A nombre de quién va el documento de transporte, cuando el crédito lo pide a la orden.
 *
 * **La forma posesiva faltaba y era un falso positivo ancho.** El 46A de la Opinión **R 358** pide el
 * conocimiento *«made out to **our order** quoting our L/C number»*, que es como un banco emisor pide el
 * documento a su propio nombre, y este patrón solo reconocía «to the order **of** X». Medido: con esa
 * línea, `A_LA_ORDEN_DE` no capturaba nada y `CONSIGNADO_A` se llevaba **«OUR ORDER QUOTING OUR L»** como
 * si fuera el nombre de una parte —arrastrando media frase siguiente adentro— así que la regla comparaba
 * el consignatario del papel contra esa cadena y **rechazaba un conocimiento que cumple exactamente lo
 * pedido**.
 *
 * Es la misma forma que la Opinión TA 765rev arregló por la otra puerta: ahí el rol era «the issuing
 * bank» escrito con todas las letras y acá es el posesivo. En los dos casos lo que hay que comparar es
 * **el banco de ese rol**, que sale del 52A — ver `esRol` más abajo.
 */
export const A_LA_ORDEN_DE = /TO\s+(?:THE\s+)?ORDER\s+OF\s+([A-Z0-9 .,'&()-]+)|TO\s+(OUR)\s+ORDER\b/i;
export const CONSIGNADO_A = /\b(?:CONSIGNED|MADE\s+OUT)\s+TO\s+(?:THE\s+)?([A-Z0-9 .,'&()-]+)/i;

/**
 * Cómo se escribe «proforma»: pegada, con guion y con espacio.
 *
 * Las tres formas están en uso y el motor reconocía una. La Opinión **R 339** escribe «pro-forma» en
 * todo su texto y su crédito nombra el número que la factura citó mal; los dos créditos del banco de
 * pruebas que la nombran usan la grafía pegada. Ver la regla `fac-proforma`.
 */
/**
 * **Cómo se marca el flete en un documento de transporte, y en qué idioma.**
 *
 * `bl-freight` comparaba la palabra del crédito contra el campo del papel con `includes`, así que solo
 * reconocía «PREPAID» y «COLLECT» **en inglés y con esa grafía exacta**. La Opinión **R 467** es el caso, y
 * el argumento del consultante es lo que lo hace grave: un ferroviario europeo trae la casilla preimpresa
 * tildada **en su idioma** —«franco de port»— y *«Railway authorities or their officers normally tick the
 * related pre-printed box and are normally not prepared to add equal wordings in another language. Since
 * the position of the issuing bank would render **almost all railway bills (at least in Europe)
 * discrepant**»*.
 *
 * El inciso 33 (b) de las UCP 500, que la Opinión transcribe:
 *
 * > "If a Credit stipulates that the transport document has to indicate that freight has been paid or
 * > prepaid, banks will accept a transport document on which **words clearly indicating payment or
 * > prepayment of freight appear by stamp or otherwise, or on which payment or prepayment of freight is
 * > indicated by other means**."
 *
 * > a document stating "franco de port (place of destination)" **would be acceptable** under a credit
 * > requiring the transport document to evidence payment of freight.
 *
 * **Y ese inciso es de las UCP 500, que las 600 no reproducen** —el 26 (c) de hoy es de los costos
 * **adicionales** al flete, que es otra cosa y tiene su propia regla, `isbp-e27`—. Así que la lección del
 * laudo DOCDEX 215 se aplica al revés y a favor: lo que caducó es una redacción **permisiva**, y que
 * desaparezca no crea una restrictiva. Hoy lo que manda es lo que el crédito escribió (14 a), que es la
 * fuente que esta regla cita, y **no hay ninguna disposición de las UCP que diga que la marca tiene que
 * estar en inglés** — o sea que el motor estaba rechazando sobre una comparación de su propia invención.
 * Eso es lo que sostiene el arreglo, y lo que hace que la salida de lo no reconocido sea verificar y no
 * rechazar: no hay inciso al que apoyarse para lo segundo. Lo que la sección E de la ISBP agregue sobre
 * las marcas de flete no se puede leer: el texto no está comprado.
 *
 * **Las dos mitades estaban mal, y la primera ya estaba sentada en el banco de pruebas:** el 46A del caso
 * de la Opinión R 354 dice «MARKED FREIGHT **PAID**», que no es «PREPAID» ni «COLLECT», así que el motor
 * contestaba «el crédito no pide una marca de flete» **sobre un crédito que la pide**. Eso no se ve como
 * una falla: se ve como un aviso.
 *
 * **La lista es corta y cerrada a propósito**, como la del párrafo A1 y la de las formas societarias: son
 * los términos con que el comercio marca el flete, cada uno con su par, y lo que **no** está reconocido
 * **no se rechaza** —sale a verificar citando el «by other means» del propio inciso—. Así una entrada que
 * falte no cuesta nada y la única equivocación caro posible, confundir un pagado con un por cobrar, tiene
 * su test en las dos direcciones.
 */
const FLETE_PREPAGO =
  /\bFREIGHT\s+PRE[\s-]?PAID\b|\bFREIGHT\s+PAID\b|\bCARRIAGE\s+PAID\b|\bFRANCO\s+DE\s+PORT\b|\bPORT\s+PAY[EÉ](?![A-Z])|\bFRACHTFREI\b|\bPORTO\s+FRANCO\b|\bFLETE\s+PAGADO\b|\bPORTE\s+PAGADO\b/i;

const FLETE_POR_COBRAR =
  /\bFREIGHT\s+COLLECT\b|\bPAYABLE\s+AT\s+DESTINATION\b|\bPORT\s+D[UÛ](?![A-Z])|\bPORTO\s+ASSEGNATO\b|\bFLETE\s+POR\s+COBRAR\b|\bPORTE\s+DEBIDO\b/i;

/** `"PREPAID"`, `"COLLECT"` o `null` cuando la marca no está en el vocabulario reconocido. */
export function marcaDeFlete(texto: string | null | undefined): "PREPAID" | "COLLECT" | null {
  if (!texto) return null;
  /* el prepago se prueba primero: «FREIGHT PREPAID - PAYABLE AT BASEL» trae las dos familias */
  if (FLETE_PREPAGO.test(texto)) return "PREPAID";
  if (FLETE_POR_COBRAR.test(texto)) return "COLLECT";
  return null;
}

/** Los números que un 46A escribe en palabras: «IN THREE ORIGINALS», «3 COMMERCIAL INVOICES». */
const PALABRA_A_NUMERO: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6 };

export const NOMBRA_PROFORMA = /\bPRO[\s-]?FORMA\b/i;

/**
 * El número que el crédito le pone a la proforma.
 *
 * Dos cosas, y cada una salió de una redacción real:
 *
 * - **acepta un calificativo en el medio**, porque el crédito de la Opinión R 339 pide la «**pro-forma
 *   export invoice**» y la Opinión usa esa frase dos veces. Sin esto el número no se leía y la regla
 *   caía a «cualquier cita alcanza», o sea daba **OK sobre la factura que el panel declara
 *   discrepante**. Es **una** palabra y no una frase, y ese límite es el freno: con un hueco de dos
 *   —«proforma **and commercial** invoice no. X»— el patrón no matchea y el número de la otra factura
 *   no entra como si fuera el de la proforma. **Un freno de conectores también estaba escrito y el
 *   mutante lo mostró decorativo**: el límite de una palabra ya cubre esos casos, así que se sacó en
 *   vez de darle una aserción forzada;
 * - **acepta barras y puntos y termina en alfanumérico**, así que «ZM/2009/118» entra entero y un punto
 *   final de frase queda afuera. Con la clase vieja —`[A-Z0-9-]+`— ese número se cortaba en «ZM» y una
 *   factura que citara otro de la misma serie pasaba por contención.
 */
export const NUMERO_DE_PROFORMA = /\bPRO[\s-]?FORMA(?:\s+[A-Z]+)?\s+INVOICE\s+NO\.?\s*([A-Z0-9/.-]*[A-Z0-9])/i;

export function hastaLaDescripcion(nombre: string | null): string | null {
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
  /*
   * **El conteo se corta donde el papel empieza a declarar lo que dice.**
   *
   * Una línea del 46A nombra el documento y lo describe, y la descripción de un certificado del
   * beneficiario enumera **los papeles que certifica haber mandado**: «BENEFICIARY'S CERTIFICATE
   * CERTIFYING THAT **2 COPIES OF EACH SHIPPING DOCUMENT** HAVE BEEN SENT TO THE APPLICANT». Leer ese 2
   * como los ejemplares del certificado es la misma forma que ya costó cinco veces con el nombre del
   * emisor y con la clave de apareo — y desde el arreglo del 17 (e) sería peor, porque el texto pasaría a
   * **afirmar** que alcanza un original.
   *
   * **Dos cortes se probaron y se descartaron, medidos sobre los créditos del banco de pruebas:**
   *
   * - cortar en `ABRE_DESCRIPCION` **pierde nueve conteos legítimos**, porque los créditos reales ponen
   *   el conteo detrás del emisor: «CERTIFICATE OF QUALITY ISSUED BY INDEPENDENT SURVEYOR **IN 1 ORIGINAL
   *   AND 1 COPY**»;
   * - y descartar cualquier «COPIES **OF** …» **pierde tres más**, porque ese «of» puede nombrar a este
   *   mismo papel: «ORIGINAL AND 3 COPIES **OF PACKING LIST**».
   *
   * Lo que los separa es el verbo de declaración **con su «that»**: «issued by», «marked», «plus» o «in»
   * describen al documento, y «certifying **that**» o «stating **that**» abren una cláusula sobre lo que
   * el papel dice de **otros**. Ahí el conteo deja de ser suyo.
   *
   * **Y hacen falta las dos condiciones, medido línea por línea sobre el banco.** Con el verbo solo, el
   * corte se lleva tres conteos propios —«BENEFICIARYS DULY SIGNED STATEMENT CONFIRMING THAT … **- 1
   * ORIGINAL**», el protocolo igual, y la factura que va «EVIDENCING DELIVERY AND PAYMENT TERMS - IN 1
   * ORIGINAL AND 1 COPY»—. Con el «of» solo se lleva otros tres, porque ese «of» puede nombrar a **este**
   * papel: «ORIGINAL AND 3 COPIES **OF PACKING LIST**». Juntas aciertan en las ocho líneas que el banco
   * tiene de esta forma: el conteo deja de ser suyo cuando está **dentro de la cláusula** que abre el
   * «that» **y además** nombra otro documento.
   */
  const DECLARA = /\b(certifying|stating|confirming|declaring|attesting)\s+that\b/;
  const DE_OTRO_PAPEL = /\b(?:COP(?:Y|IES)|ORIGINALS?|SET)\s+OF\b/;
  const abre = DECLARA.exec(texto.toLowerCase())?.index;
  const declarado = abre != null ? texto.slice(abre).toUpperCase() : "";
  const corte = abre != null && DE_OTRO_PAPEL.test(declarado) ? abre : null;
  const t = (corte != null ? texto.slice(0, corte) : texto).toUpperCase();

  /* el juego completo del artículo 20 (a) (iv): «FULL SET OF 3», «(3/3)», «3/3» — ahí sí son n originales */
  const juego = /\((\d)\s*\/\s*(\d)\)|\b(\d)\s*\/\s*\d\b|FULL SET OF\s*(\d)/.exec(t);
  const nJuego = juego ? Number(juego[1] ?? juego[3] ?? juego[4]) : null;

  /* «1 ORIGINAL», «IN THREE ORIGINALS»: el crédito dice originales y cuántos */
  const mOrig = /\b(\d{1,2}|ONE|TWO|THREE|FOUR|FIVE|SIX)\s+ORIGINAL/.exec(t);
  const nExplicitos = mOrig ? (PALABRA_A_NUMERO[mOrig[1]] ?? Number(mOrig[1])) : null;

  /* las palabras van en los dos lados: «ONE ORIGINAL AND ONE COPY» se leía a medias */
  const mCopias = /\b(\d{1,2}|ONE|TWO|THREE|FOUR|FIVE|SIX)\s*(?:NON[- ]NEGOTIABLE\s+)?COP(?:Y|IES)/.exec(t);
  const nCopias = mCopias ? (PALABRA_A_NUMERO[mCopias[1]] ?? Number(mCopias[1])) : null;

  /*
   * **Los ejemplares múltiples se satisfacen con UN original y el resto en copias**, y eso es lo que
   * esta función decía al revés.
   *
   * Decía «3 originales» sobre «PACKING LIST IN TRIPLICATE», que es palabra por palabra el razonamiento
   * que la Opinión **R 338** rechaza. Su expediente es un emisor que concluyó que *«every document
   * without an 'original' mark, presented by the negotiating bank, was not an original as stipulated in
   * Article 20»* y pidió el reembolso a dos bancos negociadores. La Banking Commission transcribe el
   * inciso que lo decide —el 20 (c) (ii) de las UCP 500, el **17 (e)** de hoy— y concluye:
   *
   * > "Credits that require multiple document(s) such as 'duplicate', 'two fold', 'two copies' and the
   * > like, **will be satisfied by the presentation of one original and the remaining number in
   * > copies** except where the document itself indicates otherwise."
   * >
   * > Where a credit requires, amongst others, **3 commercial invoices and 3 packing lists, this is
   * > satisfied by the presentation of one of each of the documents being marked original and two copies
   * > either marked copy or not marked as an original.**
   * >
   * > Of course, **if the documents appeared to be originals on their face** … **no marking "original"
   * > is required.** Also refer to the ICC Decision on original documents dated 12 July 1999.
   *
   * Esto es **texto que una persona lee**, igual que el renglón de las correcciones: ningún veredicto
   * depende de estos números —el motor no puede contar cuántos ejemplares llegaron, que es el hueco
   * declarado del laudo DOCDEX 250— así que lo único que hace la función es decirle al examinador qué
   * pide el crédito. Decirle «3 originales» lo empuja al rechazo de esta Opinión.
   *
   * **Tres frenos, y los tres salieron de medir el banco de pruebas:**
   *
   * - **el juego completo sigue siendo n originales.** «FULL SET (3/3)» es el artículo 20 (a) (iv) y ahí
   *   los tres son originales de verdad;
   * - **si la línea nombra originales, las copias son adicionales y no un total.** «FULL SET OF ORIGINAL
   *   BILLS OF LADING PLUS 2 NON-NEGOTIABLE COPIES» pide el juego **más** dos copias, así que leer el 2
   *   como el total de ejemplares perdería el juego;
   * - **y «DUPLICATE OF …» es el nombre del documento y no un conteo.** El 46A del caso de la Opinión
   *   R 690 pide «DUPLICATE OF RAIL WAYBILL DULY STAMPED AND SIGNED AT THE STATION OF DEPARTURE», que es
   *   **un** documento —el artículo 24 (b) dice que un ferroviario marcado «duplicate» es un original— y
   *   la función decía «2 originales». El conteo necesita el «IN» delante.
   */
  const mMultiples = /\bIN\s+(DUPLICATE|TRIPLICATE|QUADRUPLICATE)\b/.exec(t);
  const mFold = /\bIN\s*(\d{1,2})\s*FOLDS?\b/.exec(t);
  /* un número al principio de la exigencia: «3 COMMERCIAL INVOICES», la redacción de R 338 */
  const mAlPrincipio = /^\s*(\d{1,2}|TWO|THREE|FOUR|FIVE|SIX)\s+[A-Z]/.exec(t);

  const nMultiples = mMultiples
    ? ({ DUPLICATE: 2, TRIPLICATE: 3, QUADRUPLICATE: 4 }[mMultiples[1]] ?? null)
    : mFold
      ? Number(mFold[1])
      : mAlPrincipio
        ? (PALABRA_A_NUMERO[mAlPrincipio[1]] ?? Number(mAlPrincipio[1]))
        : null;

  const nombraOriginales = nJuego != null || nExplicitos != null || /\bORIGINAL/.test(t);

  /* el total de ejemplares, cuando el crédito pide varios sin decir que sean originales */
  const total = nombraOriginales ? null : (nMultiples ?? nCopias);

  if (total != null && total > 1) {
    const copias = total - 1;
    return {
      originales: 1,
      copias,
      texto: `${total} ejemplares: alcanza 1 original + ${copias} copia${copias > 1 ? "s" : ""} (art. 17 e)`,
    };
  }

  const originales = nJuego ?? nExplicitos ?? (nombraOriginales ? null : nMultiples);
  const copias = total != null ? total : nCopias;
  const partes = [
    originales != null ? `${originales} original${originales > 1 ? "es" : ""}` : null,
    copias != null ? `${copias} copia${copias > 1 ? "s" : ""}` : null,
  ].filter(Boolean);
  return { originales, copias, texto: partes.join(" + ") || "sin cantidad indicada" };
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
  /**
   * El **45A entero**, para la proforma que el crédito nombra ahí y no en la línea de la factura.
   *
   * Es el mismo motivo por el que `isbp-c8` lo lee entero en vez de usar `mercaderia`: los créditos
   * reales escriben «… AS PER PROFORMA INVOICE NO. X» en la descripción de la mercadería, así que una
   * regla que solo mirara la línea del 46A era inalcanzable en la redacción corriente. Opinión R 339.
   *
   * Llega vacío cuando no se pasa y la regla se comporta como antes, así que es aditivo.
   */
  mercaderia45A?: string | null;
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
  /**
   * Los feriados de la plaza, para correr el último día de presentación (art. 29 a).
   *
   * Llegan vacíos por omisión, así que donde nadie los carga la cuenta no cambia —los fines de semana se
   * cuentan siempre, igual que en `vencimientoEfectivo`—. En romai no se pasan.
   */
  feriados?: Date[];
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
    /* Dos grupos: el 1 es «to the order of X» y el 2 el posesivo «to our order», que captura «OUR». */
    const mOrden = A_LA_ORDEN_DE.exec(reglaBL);
    const ordenDe = hastaLaDescripcion(mOrden?.[1] ?? mOrden?.[2] ?? null);
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
    const exigeEndosoEnBlanco = EXIGE_ENDOSO_EN_BLANCO.test(reglaBL);
    /*
     * **A quién** lo consigna, cuando el crédito lo nombra derecho en vez de pedirlo a la orden.
     *
     * El nombre se corta donde empieza la descripción del documento —«MARKED», «NOTIFY», «SHOWING»,
     * «AND BLANK ENDORSED»— por el mismo motivo que el emisor de un certificado: sin el corte, el nombre
     * se lleva la frase entera. Y «TO ORDER» a secas no es un nombre: eso lo resuelve la rama del endoso
     * en blanco.
     */
    const crudoConsignadoA = hastaLaDescripcion(CONSIGNADO_A.exec(reglaBL)?.[1] ?? null);
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
        /*
         * El nombre va **entre comillas**, como en la evidencia de dos renglones más abajo y como en
         * todo el resto del motor cuando muestra un dato copiado de un papel.
         *
         * No es cosmético: `textoEnIngles` protege lo entrecomillado y el control de inglés del banco
         * de pruebas revisa el nombre de cada regla, así que un nombre propio interpolado **sin**
         * comillas hace que la heurística lo lea como castellano — pasó con «EXPORTADORA DEL OESTE
         * S.A.» y con «LOS ANGELES», y volvió a pasar acá con el ordenante de la Opinión R 775. Es la
         * tercera vez de la misma familia y el arreglo es el mismo que las dos anteriores.
         */
        regla: `El documento de transporte va consignado a quien el crédito nombra ("${consignadoA}")`,
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
      /* «OUR» entra por la Opinión R 358: «made out to our order» es el rol del emisor en posesivo. */
      const esRol = /^(?:THE\s+)?(?:ISSUING|OPENING|L\/?C\s+ISSUING)\s+BANK\b|^(?:US|OURSELVES|OUR)\b/i.test(ordenDe);
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
      /*
       * **«Endorsed to the order of X» no es «consigned to the order of X»**, y confundirlos rechazaba
       * el documento que el crédito pidió.
       *
       * Si el crédito dice «FULL SET OF CLEAN ON BOARD OCEAN BILL OF LADING **ENDORSED** TO THE ORDER OF
       * THE ISSUING BANK», el nombre pertenece al **endoso** y no al casillero del consignatario: el
       * conocimiento va «TO ORDER» —que es lo único que permite endosarlo, y lo dice la Opinión
       * TA 814rev4— y el endoso va al dorso. El motor comparaba el casillero contra el nombre del banco
       * y daba **DISCREPANCIA** sobre un conocimiento correcto.
       *
       * Lo encontró el laudo DOCDEX 262, cuyo 46A lo escribe así y donde el emisor levantó cuatro
       * motivos y **ninguno** fue éste.
       *
       * Y lo que corresponde es avisar y no dictaminar, porque **no hay campo para el endoso del dorso**
       * —el hueco que dejó declarado el laudo DOCDEX 363— así que el motor no puede saber si está hecho.
       */
      const porEndoso = /\bENDORSED\s+(?:TO\s+(?:THE\s+)?ORDER\s+OF|IN\s+FAVOU?R\s+OF)\b/i.test(reglaBL);
      const aLaOrdenSinNombre = Boolean(consig) && /\bORDER\b|\bORDEN\b/i.test(consig!) && !ok;
      reglas.push({
        id: "bl-consignee",
        fuente: "46A",
        regla: esRol
          ? `BL consignado a la orden del banco emisor${delRol ? ` ("${delRol}")` : ""}`
          : `BL consignado "to the order of ${ordenDe}"`,
        estado:
          !consig || (esRol && !delRol) || (porEndoso && aLaOrdenSinNombre) ? "ATENCION" : ok ? "OK" : "DISCREPANCIA",
        evidencia: !consig
          ? "no se leyó el consignee"
          : esRol && !delRol
            ? `dice "${consig}" y el crédito lo pide a la orden del banco emisor, que no se leyó: verificar a mano`
            : porEndoso && aLaOrdenSinNombre
              ? `dice "${consig}", que es lo que permite endosarlo, y el crédito pide el **endoso** a la orden de ${aQuien || ordenDe}: el endoso va al dorso y el motor no tiene campo para leerlo (laudo DOCDEX 363), así que hay que verificarlo en el papel`
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
    /* lo que el crédito pide, en cualquiera de las formas reconocidas: ver `marcaDeFlete` y R 467 */
    const flete = marcaDeFlete(reglaBL);
    const fl = val(bl, "flete");
    if (flete) {
      const marca = marcaDeFlete(fl);
      reglas.push({
        id: "bl-freight",
        fuente: "46A",
        regla: `BL marcado "FREIGHT ${flete}"`,
        estado: !fl ? "ATENCION" : marca === flete ? "OK" : marca ? "DISCREPANCIA" : "ATENCION",
        evidencia: !fl
          ? "no se leyó la marca de flete"
          : marca
            ? `dice "${fl}"`
            : `dice "${fl}", que no está entre las formas que el motor reconoce: ninguna disposición de las UCP 600 exige que la marca de flete esté en inglés, y la Opinión R 467 acepta "franco de port" como flete pagado, así que esto se verifica a mano en vez de rechazarse`,
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
    /*
     * **Y la palabra y el artículo, que eran la mitad de las redacciones.** Medido contra los 46A del
     * banco de pruebas: de 102 créditos que piden un notify en la línea del transporte, 16 no activaban
     * esta regla, y diez nombran al ordenante por su rol escrito de otra manera —«NOTIFY**ING**
     * APPLICANT», que es el crédito del expediente de referencia y el de la Opinión R 444; «NOTIFY
     * APPLICANT**S**»; «NOTIFYING **THE** APPLICANT»; «NOTIFY THE **ABOVENAMED** APPLICANT»—. Los otros
     * seis nombran a un tercero o dicen «BUYERS», y siguen afuera a propósito: el comprador no es
     * siempre el ordenante, y no hay autoridad para suponerlo.
     */
    if (
      /NOTIFY(?:ING)?(?:\s+PARTY)?\s*:?\s*(?:THE\s+)?(?:ABOVE[\s-]*NAMED\s+)?(?:APPLICANTS?|ACCOUNTEE|OPENER)\b/i.test(
        reglaBL,
      )
    ) {
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
  const mercaderia45A = input.mercaderia45A ?? "";
  if (fac) {
    /*
     * La proforma que el crédito nombra: **se busca en el 45A además de en la línea de la factura.**
     *
     * El crédito de la Opinión **R 339** exige «indication of the precise amount of goods and of the
     * certain value of the credit **referring to a specific and specified pro-forma invoice**», y la
     * factura citó otro número. El panel:
     *
     * > If the credit provided details of a specific pro-forma invoice number and this was either
     * > **mis-quoted or completely different** from the commercial invoice that was presented, **this
     * > would be considered to be a discrepancy**.
     *
     * Y eso es **lo contrario** de lo que la misma Opinión dice del número del crédito dos párrafos más
     * abajo —«purely for identification purposes and not a constituent part of the text of the document
     * required», que es la línea que el laudo DOCDEX 329 convirtió en el ablandado de `lc-num-*`—. La
     * diferencia es qué identifica cada número: el del crédito sirve para rastrear un papel extraviado,
     * y el de la proforma dice **qué se contrató**.
     *
     * Tres cosas estaban mal y las tres son la misma forma —el motor reconocía una redacción y no la
     * otra—, medidas antes de tocarlas:
     *
     * 1. **el disparador pedía la grafía de una palabra.** `/PROFORMA/i` no matchea «PRO-FORMA», que es
     *    como la escribe esta Opinión en todo su texto, ni «PRO FORMA»;
     * 2. **se buscaba solo en la línea de la factura del 46A**, y los dos créditos reales que el banco
     *    de pruebas tiene la nombran en el **45A** —R 640, «MACHINE PARTS … AS PER PROFORMA INVOICE NO.
     *    ZM/2009/118», y R 775—. O sea que la comparación era **inalcanzable en la redacción que usan
     *    los créditos de verdad**. Es la misma forma que `isbp-c8`, que lee el 45A entero por lo mismo;
     * 3. **y el número se cortaba en la primera barra.** `[A-Z0-9-]+` sobre «ZM/2009/118» captura «ZM»,
     *    así que una factura que citara «ZM/2009/999» pasaba por contención — el falso negativo exacto
     *    que esta Opinión declara discrepancia.
     *
     * **Y la cita se lee también de `mercaderia`**, porque ahí es donde el papel la imprime: una factura
     * escribe «machine parts as per proforma invoice no. X» en su descripción, y así están cargadas las
     * dos del banco. Sin ese respaldo el arreglo habría producido un aviso que afirma algo falso —«la
     * factura no cita la proforma» sobre dos facturas que la citan—, que es el defecto de `bl-notify`
     * comparando contra la cadena vacía.
     *
     * **Sin cita legible sale ATENCION y no DISCREPANCIA**, por el límite de la Opinión TA 862: un campo
     * vacío significa a la vez que el papel no la trae y que nadie la cargó, y con la regla llegando
     * ahora a los créditos que la nombran en el 45A esa rama pasó de inalcanzable a corriente.
     *
     * Queda un hueco declarado: una línea que **niega** la proforma —«COMMERCIAL INVOICE (PRO-FORMA NOT
     * ACCEPTABLE)»— dispara la regla igual y le pide a la factura una cita que el crédito no quiere. No
     * se frenó porque ningún crédito del banco lo escribe así, y agregar máquina que su propio caso no
     * mide es lo que el laudo DOCDEX 267 dejó escrito que no se hace. El día que aparezca, el freno va
     * acá y con el caso que lo pruebe.
     */
    const nombraProforma = NOMBRA_PROFORMA.test(reglaFac) || NOMBRA_PROFORMA.test(mercaderia45A);
    if (nombraProforma) {
      const ref = val(fac, "referenciaProforma") ?? val(fac, "mercaderia");
      const numProforma = NUMERO_DE_PROFORMA.exec(reglaFac)?.[1] ?? NUMERO_DE_PROFORMA.exec(mercaderia45A)?.[1];
      const cita = ref && NOMBRA_PROFORMA.test(ref) ? ref : null;
      const ok = cita && (!numProforma || cita.includes(numProforma));
      reglas.push({
        id: "fac-proforma",
        fuente: NOMBRA_PROFORMA.test(reglaFac) ? "46A" : "45A",
        regla: `Factura: "goods shipped as per proforma invoice${numProforma ? ` no. ${numProforma}` : ""}"`,
        estado: !cita ? "ATENCION" : ok ? "OK" : "DISCREPANCIA",
        evidencia: cita
          ? `dice "${cita}"`
          : "no se leyó en la factura una cita de la proforma que el crédito nombra: verificar a mano",
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
   * **Y lo que decide es la PRESENTACIÓN, no lo que el crédito pidió.** Acá había dos condiciones —que el
   * crédito no lo pidiera **y** que no se hubiera presentado— y el laudo **DOCDEX 238** contesta la mitad
   * que el 319 había dejado abierta, sobre un crédito que **sí** exige el juego de conocimientos y una
   * presentación que trajo una carta de indemnidad en su lugar:
   *
   *   «The time limit mentioned in Article 43 was not relevant for two reasons: (1) **The Article is only
   *   relevant when transport documents are presented**; and (2) the credit expressly stated that the
   *   negotiation was to be effected on or after 81 days from B/L date.»
   *
   * O sea que el inciso se lee como está escrito —«a presentation **including** one or more original
   * transport documents»— y la exigencia del crédito no entra en la cuenta. Con la condición vieja el motor
   * producía una **tardía de tres meses** sobre ese expediente, que es el lado que rechaza lo conforme: un
   * crédito de petróleo con sustitución por carta de indemnidad fija la negociación a los 81 días del
   * conocimiento justamente porque el precio sale de un promedio mensual.
   *
   * **La celda que sigue abierta es la otra**: que el crédito **no** lo pida y el beneficiario presente uno
   * igual. Ahí decidir sería resolver si un documento desestimado por el 14 (g) «cuenta» para el 14 (c), y
   * eso ningún panel lo contestó — así que esa combinación sigue midiendo el plazo, que es el
   * comportamiento conservador.
   */
  const sinTransportePresentado = !bl;
  /*
   * Y se le pasa la fecha de **emisión** del documento de transporte, porque el crédito puede contar
   * desde ella: *Fortis Bank v Indian Overseas Bank*, campo 48 «within 21 days from B/L Date». Ver
   * `baseDelPlazo`. Sin este dato el motor contaba siempre desde el a bordo y producía la tardía que
   * dos instancias inglesas rechazaron.
   */
  const lim = limitePresentacion(
    lc,
    op.blReal,
    op.fechaEmbarque,
    bl ? val(bl, "fechaDocumento") : null,
    input.feriados ?? [],
  );
  let diasParaPresentar: number | null = null;
  if (sinTransportePresentado) {
    reglas.push({
      id: "plazo",
      fuente: "UCP 600 14c",
      regla: "Plazo de presentación del artículo 14 (c)",
      estado: "OK",
      evidencia:
        "la presentación no incluye ningún documento de transporte original, así que el inciso no impone plazo —habla de «a presentation including one or more original transport documents»— y el único límite es el vencimiento (laudo DOCDEX 319: «because no transport document is required for presentation, the transport articles of UCP 600 do not apply»; y el 238, sobre un crédito que sí lo exige y una presentación que trajo una carta de indemnidad en su lugar: «the Article is only relevant when transport documents are presented»)",
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
    /*
     * Y si el límite cayó en día cerrado, la evidencia lo dice: el artículo 29 (a) lo corre al primer
     * día hábil siguiente y un límite corrido que no se explica es un límite que nadie puede auditar.
     */
    const corrido = lim.corridoPorDiaCerrado
      ? " — el límite caía en un día en que el banco está cerrado y se corre al primer día hábil siguiente (art. 29 a)"
      : "";
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
              ? `BL ${op.blReal} → límite ${lim.limite.toLocaleDateString("es-UY")} · presentada ${yaPresentada.toLocaleDateString("es-UY")}${corrido}`
              : `BL ${op.blReal} → límite ${lim.limite.toLocaleDateString("es-UY")} · ${diasParaPresentar >= 0 ? `quedan ${diasParaPresentar} días` : `venció hace ${-diasParaPresentar} días`}${corrido}`,
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
    } else if (f && l) {
      /*
       * **Dos anotaciones de a bordo, y cuál fecha decide (Opinión R 459).**
       *
       * El crédito admitía embarcar desde «Any European Port» hasta el 30 de abril, y el conocimiento
       * traía dos anotaciones: «Shipped on board Vessel A ex Dublin on 26.04.01 arrived Antwerp
       * 30/04/01» y «Shipped on board per ocean vessel F123 at Antwerp on 02 May 2001». El emisor rechazó
       * por embarque tardío tomando la segunda, y la ICC dijo que no: *«The date, 26.04.01, would be
       * taken as the date of shipment … The second on board notation relating to the shipment on the
       * vessel F123 would be considered additional information»*.
       *
       * Esta regla recibe **una** fecha —la que alguien cargó o el modelo leyó— y con la segunda
       * rechazaba igual que el emisor. Cuál manda depende de si el puerto de la primera anotación es el
       * puerto de carga que el crédito admite: acá sí; en R 350 / R 457 era un pre-acarreo y manda el
       * buque oceánico. Eso el motor no lo sabe —no sabe si Dublín está en Europa—, pero sí ve que la
       * anotación trae **otra fecha que está dentro del plazo**, y con eso no puede afirmar que el
       * embarque fue tardío. Solo ablanda: una sola fecha, o todas fuera de plazo, sigue siendo
       * discrepancia.
       */
      const otrasFechas = (val(bl, "onBoard") ?? "")
        .match(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}[\s-][a-z]{3,9}[\s-]\d{2,4}/gi)
        ?.map((t) => parseFecha(t))
        .filter((d): d is Date => d !== null);
      const hayOtraEnPlazo = f > l && (otrasFechas ?? []).some((d) => d <= l);
      reglas.push({
        id: "ultimo-embarque",
        fuente: "44C",
        regla: `A bordo a más tardar el ${lc.limiteEmbarque}`,
        estado: f > l ? (hayOtraEnPlazo ? "ATENCION" : "DISCREPANCIA") : "OK",
        evidencia: hayOtraEnPlazo
          ? `BL a bordo ${ab}, fuera de plazo, pero la anotación de a bordo trae otra fecha que está dentro: si esa primera anotación es del puerto de carga que el crédito admite, es la fecha del embarque y la segunda es información adicional (Opinión R 459 de la ICC); si es un pre-acarreo desde otro lugar, manda la del buque oceánico (Opinión R 350). Verificar en el papel`
          : `BL a bordo ${ab}`,
      });
    }
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
