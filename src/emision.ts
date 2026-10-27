import { claveDoc } from "./consistencia";
import { parseFecha } from "./fechas";
import { comparaISBP } from "./isbp";
import { diasPresentacion, limitePresentacion } from "./lc";
import { modoDeHonrar } from "./mt750";
import type { LcSwift } from "./swift-lc";
import type { LcInfo } from "./types";

/**
 * ¿Este crédito se puede cumplir?
 *
 * El otro lado del negocio. Hasta acá el motor examina lo que llega; esto revisa lo que
 * el banco está por emitir, que es donde nacen buena parte de las discrepancias que
 * después alguien tiene que encontrar.
 *
 * Un crédito puede estar perfectamente redactado y ser imposible de cumplir: pedir un
 * embarque después de su propio vencimiento, exigir un documento que solo puede firmar el
 * ordenante, o poner condiciones que ningún documento acredita y que por regla se
 * descartan. La ISBP es explícita en que muchos de esos problemas se evitan revisando la
 * solicitud **antes** de emitir.
 *
 * Cada observación dice qué artículo la funda y, cuando hay uno, qué hacer.
 */

export type Gravedad = "IMPIDE" | "CONFLICTO" | "SE_DESCARTA" | "AVISO";

export interface Observacion {
  id: string;
  gravedad: Gravedad;
  fuente: string;
  /** qué se observó */
  que: string;
  /** en qué parte del crédito */
  donde: string;
  /** qué conviene hacer */
  sugerencia: string;
}

const obs = (
  id: string,
  gravedad: Gravedad,
  fuente: string,
  que: string,
  donde: string,
  sugerencia: string,
): Observacion => ({ id, gravedad, fuente, que, donde, sugerencia });

/** Palabras que el artículo 3 deja sin efecto práctico si califican a un emisor. */
const VAGOS = /\b(first class|well known|qualified|independent|official|competent|local)\b/i;

/**
 * Un documento que **el ordenante presenta él mismo**, que es peor que uno que él emite.
 *
 * Un certificado emitido por el ordenante y entregado al beneficiario deja el cobro a voluntad del
 * comprador; uno que el ordenante **presenta directo al banco emisor** deja al beneficiario sin manera de
 * saber si la presentación está completa, y sin nada que hacer si no está. El laudo DOCDEX 209 es ese
 * expediente: el beneficiario embarcó, presentó todo lo que estaba bajo su control, el consignatario
 * alcanzó a retirar un tercio de la mercadería —lo paró una orden judicial— y el panel decidió que *«the
 * issuing bank is not liable to pay under its credit»*, porque *«UCP and international standard banking
 * practice require the presentation of all documents as stipulated in the credit […] before the issuing
 * bank's obligation under the credit comes into effect»*.
 *
 * El beneficiario había invocado el artículo 9 (a) (ii) de las UCP 500 diciendo que presentó *«all
 * stipulated documents within the beneficiary's control»*. No alcanza: la obligación del emisor nace con
 * **todos** los documentos del crédito presentados.
 */
const PRESENTA_EL_ORDENANTE =
  /\bpresent\w*\s+(?:directly\s+)?by\s+(?:the\s+)?(applicant|buyer|importer|opener)\b|\b(applicant|buyer|importer|opener)\s+(?:will|shall|to|is to)\s+present\w*/i;

/** Un documento que solo puede emitir el ordenante: pedirlo deja el cobro en sus manos. */
const DEL_ORDENANTE =
  /\b(issued|signed|countersigned|approved|certified)\s+by\s+(the\s+)?(applicant|buyer|importer|opener)\b|applicant'?s?\s+(signature|certificate|approval|inspection)/i;

/**
 * Una cláusula que **deja al banco deducir del cobro** lo que el ordenante le reclame.
 *
 * El laudo DOCDEX 212 es el expediente: un crédito de USD 2.417.000 con la cláusula *«The opening bank
 * have the right to deduct the claim amount from the payment under negotiation mentioned above directly
 * with the applicant's applications»*, y el emisor se negó a pagar un vencimiento de USD 966.800 porque
 * *«the applicant had asked not to pay the bill due to serious quality problems of goods»*.
 *
 * El panel la detesta y la hace valer, que es la combinación que importa:
 *
 * > **It is most unusual (and certainly against the spirit of UCP 500)** for a letter of credit to contain
 * > a clause giving the issuing bank the right to deduct, at the instructions of the applicant, a claim
 * > amount from the payments under negotiations **against conforming documents.**
 *
 * > Furthermore, the wording of the clause **does not contain any specific information** regarding a
 * > possible maximum claim amount, latest date for a claim to be considered, or details regarding the
 * > conditions for such a claim to be acceptable.
 *
 * > a beneficiary who accepts a letter of credit containing a clause permitting the issuing bank to deduct
 * > certain amounts from payments under the letter of credit **does so at his own risk.** Though the
 * > condition in the credit is undesirable, our conclusion is that **the issuing bank is entitled to
 * > deduct** the claim amount from payments under the letter of credit.
 *
 * Lo que esto corrige es un **consejo** del motor, no un veredicto: la cláusula no menciona ningún
 * documento, así que salía como condición no documentaria «tenida por no puesta» (14 h) — o sea que el
 * motor le decía al banco que podía ignorar justo la cláusula que el panel hace valer. **Es la segunda vez
 * que el consejo del 14 (h) es el peligroso**: la primera fue el calendario de embarques del laudo 204.
 *
 * El freno es el fee de discrepancia, que es una deducción legítima y está en el crédito real del
 * expediente: lo que se busca es el derecho a deducir **un reclamo** o a deducir **por instrucción del
 * ordenante**, que es otra cosa.
 */
const DEDUCE_RECLAMO =
  /\b(?:deduct|withhold|set[\s-]?off|retain)\w*\b[^.;]{0,80}\b(?:claim|penalt|compensat|damage|liquidated|shortage)/i;
/*
 * Y al revés, porque el orden de la frase no cambia lo que la cláusula hace.
 *
 * Una cláusula penal se escribe «a penalty of 10 pct of the invoice value […] **will be deducted from the
 * payment**»: el reclamo va primero y la deducción después. Lo encontró el laudo DOCDEX 385, que es **la
 * tercera cara del consejo del 14 (h)** —después del calendario de embarques (204) y de la deducción por
 * instrucción del ordenante (212)— y acá el defecto era peor que en las otras dos, porque dependía de una
 * palabra: con «invoice value» adentro la cláusula mencionaba un documento y el motor se callaba; con
 * «value of the goods» salía **SE_DESCARTA**, o sea «los bancos la tienen por no puesta». El panel decide
 * lo contrario y cobra la penalidad.
 *
 * El razonamiento del panel es la regla general que faltaba, y conviene tenerla escrita:
 *
 * > The ICC Opinion R212 states that **a condition is not deemed to be non-documentary if the condition can
 * > be clearly linked to a document stipulated in the credit.**
 *
 * > the penalty clause in the credit was linked to the failure of the Claimant to ship goods within the
 * > latest date of shipment. As the latest shipment date was mentioned in the credit, **it was possible to
 * > calculate the penalty amount from the shipped on board date and hence the condition was not
 * > non-documentary as it had a linkage to the date of shipment**, which could be verified from the date of
 * > shipment, which was a documentary requirement of the credit.
 *
 * > It was decided that **the penalty clause was not non-documentary** due to its linkage to shipment date
 * > on the bill of lading. Furthermore, as the penalty condition applied, **the approval of the Claimant was
 * > not required.**
 */
const RECLAMO_SE_DEDUCE =
  /\b(?:claim|penalt|compensat|damage|liquidated|shortage)\w*\b[^.;]{0,120}\b(?:deduct|withh[eo]ld|set[\s-]?off|retain)/i;
const DEDUCE_POR_EL_ORDENANTE =
  /\b(?:deduct|withhold|set[\s-]?off|retain)\w*\b[^.;]{0,80}\b(?:applicant|buyer|importer|opener)/i;

/** ¿La cláusula deja deducir del cobro del beneficiario algo que no es un gasto bancario? */
function deduceDelCobro(c: string): boolean {
  if (/\bdiscrepanc\w*\s+fee|\bfee\b|\bcharges?\b|\bcommission/i.test(c)) return false;
  return DEDUCE_RECLAMO.test(c) || RECLAMO_SE_DEDUCE.test(c) || DEDUCE_POR_EL_ORDENANTE.test(c);
}

/** Frases que la práctica manda descartar porque no significan nada. */
const SIN_SIGNIFICADO = [
  {
    re: /third\s+party\s+documents?\s+(are\s+)?not\s+acceptable/i,
    que: "«third party documents not acceptable» no tiene significado y se descarta",
  },
  {
    /*
     * Y el patrón pedía «freight forwarder» o «house», así que **no reconocía la redacción más corta**.
     *
     * Medido contra seis formas reales: cuatro no matcheaban, incluidas las dos que tenemos de casos —el
     * crédito del laudo DOCDEX 312, «BILL OF LADING ISSUED BY CARRIER OR AGENT **(FORWARDER BL NOT
     * ACCEPTABLE)**», y el 47B-G de *Malayan Banking Berhad v Punjab National Bank*, «short form, blank
     * back, stale, **freight forwarder, house of bill of lading is not acceptable**»—. Es la forma que ya
     * apareció con el término de entrega escrito en palabras, con «METRIC TONS» y con el verbo del número
     * del crédito: **el motor reconocía una redacción y no la otra.**
     *
     * Las dos alternativas van con huecos **cerrados** y no con un `{0,60}` abierto, por dos motivos: lo
     * que costó `importeFluctuaPorElCredito` —dos huecos cuelgan el motor con un 47A largo— y que un hueco
     * ancho puentearía otra exclusión. «FORWARDERS CERTIFICATE ACCEPTABLE, SHORT FORM BILL OF LADING NOT
     * ACCEPTABLE» no es esta cláusula: ahí lo que se excluye es el conocimiento abreviado, y descartarlo
     * como si no significara nada sería inventar.
     */
    re: /(?:freight\s+)?forwarder'?s?\s*(?:,\s*house\s+of)?\s*(?:b\/?ls?|bills?\s+of\s+lading)\s*(?:is|are)?\s*not\s+acceptable|house\s*(?:of)?\s*(?:b\/?ls?|bills?\s+of\s+lading)\s*(?:is|are)?\s*not\s+acceptable/i,
    que: "«forwarder's B/L not acceptable» no dice nada sobre cómo debe emitirse el documento y se descarta: la Opinión TA 727rev decidió que «freight forwarder bills of lading» no tiene significado bajo las UCP 600 —ni para admitirlos ni para excluirlos—, la cláusula no excluye el artículo 14 (l) y «a document examiner is not expected to determine the status of the signing company» (laudo DOCDEX 312, unánime)",
  },
];

/**
 * La frase sin significado que una condición del 47A contiene, si contiene alguna.
 *
 * Lo necesita `verificaciones-manuales.ts`, y por el mismo motivo por el que ese módulo ya comparte
 * `PARAMETROS_DEL_CREDITO`: **no decir dos cosas distintas sobre la misma cláusula en dos pantallas.**
 * Antes de esto, un crédito con «forwarder's B/L not acceptable» salía de `revisarCredito` diciendo que la
 * cláusula se descarta y del examen diciendo «es una condición documentaria que el motor no sabe
 * verificar: leerla contra los papeles presentados». Y lo segundo es peor que una contradicción: le pide al
 * examinador justo lo que el laudo DOCDEX 312 dice que no se le pide —*«a document examiner is not expected
 * to determine the status of the signing company»*—.
 */
export function fraseSinSignificado(condicion: string): string | null {
  return SIN_SIGNIFICADO.find((x) => x.re.test(condicion))?.que ?? null;
}

/** Condiciones que el banco pone para su propia comodidad y que no deberían estar. */
const ADMINISTRATIVAS =
  /\b(not\s+to\s+be\s+stapled|do\s+not\s+staple|extra\s+cop(y|ies)\s+for\s+our\s+(file|record)|for\s+our\s+own\s+use)\b/i;

/**
 * Las cláusulas del 47A que **no son condiciones a cumplir** sino parámetros del propio crédito.
 *
 * Una tolerancia, un permiso de embarque parcial, una autorización de transbordo: no hay documento
 * que las acredite porque no hay nada que acreditar — configuran el crédito, igual que el monto o la
 * fecha de vencimiento, y las UCP las reconocen expresamente (arts. 30, 31, 20c). Tratarlas como
 * condiciones no documentarias era una contradicción visible: el motor **lee** la tolerancia del 47A
 * y la aplica al examen, y al mismo tiempo avisaba que el artículo 14(h) la tenía por no puesta.
 */
/*
 * Y un **calendario de embarques** también configura el crédito: es el artículo 32, no una condición
 * documentaria.
 *
 * Faltaba, y el efecto era el peor de los dos mundos: `revisarCredito` le decía al banco que la cláusula
 * era una condición no documentaria **tenida por no puesta** (14 h) —justo la cláusula cuyo incumplimiento
 * deja el crédito sin disponibilidad para esa cuota y las siguientes— y `verificaciones-manuales` la
 * sacaba como «leerla contra los papeles», que tampoco es: no hay papel que la acredite. Lo encontró el
 * laudo DOCDEX 204, cuyo 47A es un calendario de tres fechas y donde **dos de los seis rechazos** son
 * sobre él.
 */
/*
 * Y **los puertos escritos en el 47A** también configuran el crédito, que es la sexta cara de esta lista.
 *
 * El crédito del laudo DOCDEX 312 pone la ruta ahí y no en los campos 44E y 44F: *«Field 47A (Additional
 * Conditions) stipulates: Port of Loading: Any Country T Port; Port of Discharge: Port M, Country M»*. El
 * motor lo sacaba como condición **no documentaria tenida por no puesta** (14 h), y eso es el consejo
 * contrario al que corresponde: el puerto de carga que el crédito fija es justamente lo que el inciso
 * (a) (iii) de los artículos del transporte compara contra el documento. Aconsejarle a un banco que puede
 * ignorarlo es ofrecerle que se quede sin la comparación de la ruta.
 *
 * **Y queda un hueco declarado, que no se arregla acá:** el examen tampoco los **lee** de ahí —`lc.puerto*`
 * sale de los campos 44, no del 47A— así que en un crédito así la ruta no se compara con nada. Cablearlo es
 * cambiar el intérprete de SWIFT, no una regla, y hay ciento cuatro casos midiendo el apareo actual.
 */
/**
 * El calendario de embarques, que es lo que el artículo 32 gobierna.
 *
 * Vive en una constante porque la pregunta se hacía en **dos lugares** —`PARAMETROS_DEL_CREDITO`, para no
 * aconsejar que se tenga por no puesto, y la regla `emision-calendario`, para avisar del artículo 32— y
 * las dos copias se desincronizaron apenas apareció una redacción nueva: el crédito del laudo DOCDEX 246
 * dice *«1st shipment covering 1x20 FCL container **to be shipped not later than** 12 March 2004»* y solo
 * una de las dos la reconoció. Dos copias de la misma pregunta es cómo se desincronizan dos respuestas, y
 * en ésta la consecuencia es la peor: el artículo 32 es el de la consecuencia más dura de las UCP.
 *
 * Es además la quinta vez que **el motor reconocía una redacción y no la otra** —el término de entrega en
 * palabras, «METRIC TONS», el verbo del número del crédito, el «forwarder B/L» sin «freight»— y acá sobre
 * la cláusula cuyo incumplimiento deja el crédito sin disponibilidad para esa cuota y las siguientes.
 */
export const CALENDARIO_DE_EMBARQUES =
  /\b(shipping|shipment)\s+schedule\b|\bto be shipped (before|by|within|during|not later than|no later than)\b|\b(shipments?|embarques?)\s+(are|is)\s+required\b/i;

export const PARAMETROS_DEL_CREDITO =
  /\b(tolerance|more or less|partial (shipment|drawing)s?|transhipment|transshipment|instal?ments?|expiry|latest shipment|revolving|confirm(ed|ation))\b|\bport\s+of\s+(loading|discharge|destination)\b|\bairport\s+of\s+(departure|destination)\b/i;

/**
 * ¿Esta cláusula del 47A **configura** el crédito en vez de pedir un papel?
 *
 * Se pregunta por acá y no contra el patrón suelto para que el calendario de embarques entre por un solo
 * lugar: antes la lista de parámetros tenía su propia copia del patrón del calendario y la regla del
 * artículo 32 tenía otra, y al aparecer una redacción nueva solo una de las dos la reconoció.
 */
export function esParametroDelCredito(condicion: string): boolean {
  return PARAMETROS_DEL_CREDITO.test(condicion) || CALENDARIO_DE_EMBARQUES.test(condicion);
}

/**
 * ¿La condición menciona un documento que la acredite?
 *
 * **Los plurales cuentan.** Antes no: el grupo cerraba con `\b`, así que `document` no coincidía con
 * «DOCUMENTS» —la «S» no es un límite de palabra— y toda condición escrita en plural se marcaba como
 * no documentaria. Con eso el motor le decía a un banco que el artículo 14(h) tenía por no puestas
 * «ALL DOCUMENTS SHOULD BEAR A DATE ON OR AFTER THE LC DATE» y «ALL DOCUMENTS SHOULD INDICATE THE LC
 * NUMBER», que son del crédito real del expediente y que el propio examen verifica. El consejo era
 * sacar del crédito dos condiciones que funcionan.
 */
export function mencionaDocumento(texto: string): boolean {
  return /\b(certificates?|certificat|invoices?|documents?|declarations?|statements?|bills? of lading|b\/ls?|packing|lists?|notes?|reports?|receipts?|cop(y|ies)|awbs?|polic(y|ies))\b/i.test(
    texto,
  );
}

/**
 * Revisa un crédito antes de emitirlo, o al recibirlo, para ver si se puede cumplir.
 *
 * `campos` son los del mensaje ya interpretado: de ahí salen los puertos y la mercadería.
 */
/**
 * Lo que dice que el crédito operativo todavía no llegó (UCP 600 art. 11 a).
 *
 * Tiene que ser específico o arruina todo. El 47A del expediente de referencia dice «BENEFICIARY SHOULD
 * ADVISE FULL DETAILS OF SHIPMENT WITHIN 05 DAYS»: un patrón que buscara «full details» marcaría
 * como no operativo el crédito con el que se validó el motor entero. Lo que importa es que los
 * detalles **sigan**, o que el mensaje diga que el operativo es otro.
 */
const OPERATIVO_SIGUE =
  /\bdetails\s+to\s+follow\b|\bmail\s+confirmation\s+(is|will\s+be|shall\s+be)\s+(the\s+)?operative\b|\boperative\s+(credit|instrument)\s+(to\s+follow|will\s+follow|by\s+(air)?mail)\b|\b(this|the)\s+(message|teletransmission|telex)\s+is\s+not\s+(the\s+)?operative\b/i;

export function revisarCredito(p: LcSwift): Observacion[] {
  const out11: Observacion[] = [];
  /*
   * Antes que nada: ¿esto es el crédito?
   *
   * Un pre-aviso (MT705) obliga al emisor a emitir el crédito operativo, pero no es el crédito
   * (art. 11 b). Y un teletransmitido que anuncia que los detalles siguen, o que el operativo es la
   * confirmación por correo, tampoco lo es (art. 11 a). Examinar documentos contra cualquiera de
   * los dos deja el dictamen —y el aviso de rechazo, y la hoja firmada— referidos a un instrumento
   * que las UCP dicen que no es el crédito.
   */
  if (/705/.test(p.extra.tipoMensaje ?? "")) {
    out11.push(
      obs(
        "ucp-11b",
        "IMPIDE",
        "UCP 600 11b",
        "Esto es un pre-aviso, no el crédito operativo",
        `el mensaje es un ${p.extra.tipoMensaje}`,
        "el emisor queda obligado a emitir el crédito operativo sin demora y en términos no inconsistentes con este aviso, pero hasta que llegue no hay contra qué examinar",
      ),
    );
  }
  if (OPERATIVO_SIGUE.test(p.extra.infoAlDestinatario ?? "")) {
    out11.push(
      obs(
        "ucp-11a",
        "IMPIDE",
        "UCP 600 11a",
        "El mensaje dice que el crédito operativo todavía no es este",
        `dice "${(p.extra.infoAlDestinatario ?? "").slice(0, 80)}"`,
        "un teletransmitido es el crédito operativo salvo que anuncie que los detalles siguen o que el operativo será la confirmación por correo: esperar el instrumento que sí lo sea",
      ),
    );
  }

  const { lc, extra, campos } = p;
  const out: Observacion[] = [];

  /* ── lo que el crédito tiene que decir de sí mismo (artículo 6) ── */
  if (!extra.disponibleCon) {
    out.push(
      obs(
        "emision-disponible",
        "IMPIDE",
        "UCP 600 6a",
        "El crédito no dice con qué banco está disponible",
        "campo 41",
        "indicar el banco, o «any bank» si es libremente negociable",
      ),
    );
  }
  /*
   * **El artículo 6 (b) vive en el campo 41, no en el 42C**, y mirar el campo equivocado hacía que el motor
   * declarara inoperable un crédito normal.
   *
   * El 42C es el plazo del **giro** —«Drafts at… SIGHT», «90 DAYS»— y solo existe cuando el crédito pide
   * giro. Cómo está disponible el crédito lo dice el 41: «BY NEGOTIATION», «BY DEFERRED PAYMENT», «BY
   * ACCEPTANCE», «BY PAYMENT». Así que un crédito disponible por pago diferido sin giro —que es corriente—
   * salía con un **IMPIDE** diciendo que no dice si es a la vista, a plazo, por aceptación o por
   * negociación. Lo dice: en el campo de al lado.
   *
   * Y es el peor lugar donde tener un falso positivo, porque ya está escrito en este archivo: «un banco que
   * ve IMPIDE donde el artículo tiene una respuesta deja de confiar en las que sí impiden».
   *
   * **Lo encontró el corpus de los créditos del banco de pruebas**, que se armó justamente porque
   * `revisarCredito` no llega al tablero: disparaba en más de sesenta de los noventa y ocho. El crédito real
   * del expediente tiene las dos cosas —41D «ANY BANK IN URUGUAY BY NEGOTIATION» y 42C «SIGHT»— así que el
   * test de «el crédito real no tiene nada que reescribir» no lo podía ver.
   *
   * La pregunta se le hace a `modoDeHonrar`, que ya existía para el campo 23 del MT752 y lee los dos campos:
   * dos funciones para la misma pregunta es cómo se desincronizan dos respuestas.
   */
  /*
   * Y el **pago mixto** dice cómo está disponible aunque `modoDeHonrar` no lo resuelva a una sola forma:
   * se reparte entre un tramo a la vista y otro a plazo (laudo DOCDEX 366), así que esa función devuelve
   * `null` a propósito —no le toca elegir— y acá eso no es un crédito que no diga nada.
   */
  const diceComoEstaDisponible =
    Boolean(modoDeHonrar(extra.disponibleCon, extra.giros)) ||
    /\bmixed\s+(?:payment|pymt)\b|\bpago\s+mixto\b/i.test(`${extra.disponibleCon ?? ""} ${extra.giros ?? ""}`);
  if (!diceComoEstaDisponible) {
    out.push(
      obs(
        "emision-forma",
        "IMPIDE",
        "UCP 600 6b",
        "El crédito no dice si es a la vista, a plazo, por aceptación o por negociación",
        "campos 41 y 42C",
        "indicarlo: sin eso el beneficiario no sabe cómo cobra",
      ),
    );
  }
  if (!lc.vencimiento || lc.vencimiento === "—") {
    out.push(
      obs(
        "emision-vencimiento",
        "IMPIDE",
        "UCP 600 6d",
        "El crédito no fija fecha de vencimiento",
        "campo 31D",
        "toda carta de crédito tiene que indicar una",
      ),
    );
  }
  /*
   * El giro librado **sobre el banco designado**, que ni las UCP ni la ISBP saben cómo resolver.
   *
   * El laudo **DOCDEX 366** es un crédito de cuatro pagos parciales confirmado por el banco con el que
   * estaba disponible, y los giros librados sobre ese mismo banco. El panel rinde el párrafo B10 de la
   * ISBP 745 —palabras del panel, no texto de la ISBP, que no está comprada— y agrega la línea que importa:
   *
   * > The ISBP 745 paragraph B10 states that **when a credit is available by negotiation with a nominated
   * > bank or any bank, the draft is to be drawn on a bank other than the nominated bank.**
   *
   * **Y lo mismo está en el texto de las UCP**, que es una autoridad más fuerte que un párrafo rendido de
   * una ISBP que no se puede comprar: el artículo 2 define la negociación como *«the purchase by the
   * nominated bank of drafts **(drawn on a bank other than the nominated bank)** and/or documents under a
   * complying presentation»*. El paréntesis es del propio artículo, y lo transcribe el laudo **DOCDEX 364**.
   *
   * > The analysis noted that **neither the UCP 600 nor international standard banking practice provided
   * > any guidance for negotiation of drafts by the drawee bank itself.**
   *
   * Y el final es lo que lo vuelve un CONFLICTO y no un aviso: *«despite the credit being ambiguous for
   * which the Respondent was responsible, the credit was available by negotiation with separate sight and
   * usance drafts required, and not by mixed payment»* — o sea que la ambigüedad era del emisor **y el
   * beneficiario igual perdió el cuarto pago**, porque no presentó el giro a plazo. Conviene leerlo al lado
   * del laudo DOCDEX 362, que usa la misma consideración preliminar para el lado contrario: ahí el emisor
   * tuvo que pagar contra la lista corta. **Que el riesgo de la ambigüedad sea del emisor no le ahorra al
   * beneficiario un documento que el crédito pide.**
   *
   * El disparador es mecánico: el crédito está disponible **por negociación** con un banco nombrado y el
   * librado del 42A/42D es **ese mismo banco**. Con «ANY BANK BY NEGOTIATION» y el giro sobre el emisor
   * —que es el crédito corriente, el del expediente real incluido— no se marca nada.
   */
  const disponible = extra.disponibleCon ?? "";
  if (/\bnegotiation\b|\bnegociaci[oó]n\b/i.test(disponible) && lc.librado && /[a-z]/i.test(lc.librado)) {
    /*
     * El 41 llega como una sola línea —«MERIDIAN BANK PLC BY NEGOTIATION»— así que el modo se recorta en
     * vez de buscarse por renglón: el intérprete une las líneas del campo y preguntarle por renglones es
     * preguntarle a la forma del mensaje y no al dato.
     */
    const nombreDisponible = disponible
      .replace(/\bby\s+(?:negotiation|acceptance|mixed\s+payment|deferred\s+payment|payment|sight\s+payment)\b.*$/i, "")
      .replace(/^[A-Z0-9]{8}([A-Z0-9]{3})?\s+/, "")
      .trim();
    const mismo =
      nombreDisponible.length > 3 && !/\bany\s+bank\b/i.test(nombreDisponible)
        ? comparaISBP(lc.librado, nombreDisponible) !== "DISTINTO"
        : false;
    if (mismo)
      out.push(
        obs(
          "emision-giro-sobre-el-designado",
          "CONFLICTO",
          "UCP 600 2 · Laudo DOCDEX 366 · ISBP 745 B10",
          "El crédito está disponible por negociación con un banco y los giros van librados sobre ese mismo banco",
          "campos 41 y 42",
          "librar el giro sobre otro banco —el emisor, normalmente—: ni las UCP ni la práctica bancaria estándar dicen cómo se negocia un giro librado sobre el propio banco designado, y la ambigüedad la paga el beneficiario que la lea de otra manera",
        ),
      );
  }

  if (/\bapplicant\b/i.test(extra.disponibleCon ?? "") || /\bapplicant\b/i.test(extra.reglas ?? "")) {
    out.push(
      obs(
        "emision-giro-sobre-ordenante",
        "IMPIDE",
        "UCP 600 6c",
        "El crédito parece estar disponible por giro sobre el ordenante",
        "campo 41 o 42",
        "no se puede emitir así: el giro va sobre un banco",
      ),
    );
  }

  /* ── fechas que no cierran entre sí ── */
  const venc = parseFecha(lc.vencimiento);
  const ultimoEmbarque = parseFecha(lc.limiteEmbarque);
  if (venc && ultimoEmbarque && ultimoEmbarque > venc) {
    out.push(
      obs(
        "emision-embarque-tras-vencimiento",
        "IMPIDE",
        "UCP 600 6e",
        "El último día de embarque es posterior al vencimiento del crédito",
        "campos 44C y 31D",
        "quien embarque sobre la fecha no llega a presentar: adelantar el embarque o correr el vencimiento",
      ),
    );
  }

  const dias = diasPresentacion(lc.plazoPresentacion);
  if (dias === null) {
    out.push(
      obs(
        "emision-sin-plazo",
        "AVISO",
        "UCP 600 14c",
        "El crédito no fija plazo de presentación: rigen 21 días desde el embarque",
        "campo 48",
        "fijarlo si se quiere otro, y verificar que entre antes del vencimiento",
      ),
    );
  } else if (venc && ultimoEmbarque) {
    const lim = limitePresentacion(lc, null, lc.limiteEmbarque);
    if (lim?.recortadoPorVencimiento) {
      out.push(
        obs(
          "emision-plazo-recortado",
          "CONFLICTO",
          "UCP 600 14c",
          `El plazo de ${dias} días no entra antes del vencimiento si se embarca sobre la fecha`,
          "campos 48, 44C y 31D",
          "la ventana real es más corta que el plazo escrito: conviene correr el vencimiento",
        ),
      );
    }
  }

  /* ── el campo 46A: qué documentos se piden ── */
  const docs = lc.documentosExigidos ?? [];
  if (docs.length === 0) {
    out.push(
      obs(
        "emision-sin-documentos",
        "IMPIDE",
        "campo 46A",
        "El crédito no enumera los documentos que hay que presentar",
        "campo 46A",
        "sin documentos exigidos no hay presentación posible",
      ),
    );
  }
  docs.forEach((d, i) => {
    if (DEL_ORDENANTE.test(d)) {
      out.push(
        obs(
          `emision-doc-ordenante-${i}`,
          "CONFLICTO",
          "ISBP 821, consideración preliminar vii",
          "Se exige un documento que emite o firma el propio ordenante",
          `46A+${i + 1}`,
          "deja el cobro del beneficiario a voluntad del comprador: conviene no pedirlo",
        ),
      );
    }
    if (PRESENTA_EL_ORDENANTE.test(d)) {
      out.push(
        obs(
          `emision-presenta-ordenante-${i}`,
          "CONFLICTO",
          "Laudo DOCDEX 209 · UCP 600 2 y 7a",
          "Un documento del 46A lo presenta el propio ordenante, así que el beneficiario no puede completar la presentación",
          `46A+${i + 1}`,
          "sacarlo del crédito o pedirlo como documento que el beneficiario presenta: mientras falte, la obligación del emisor no nace, y el beneficiario no tiene cómo saberlo ni cómo subsanarlo",
        ),
      );
    }
    if (VAGOS.test(d)) {
      const m = VAGOS.exec(d)![0];
      out.push(
        obs(
          `emision-emisor-vago-${i}`,
          "AVISO",
          "UCP 600 3",
          `«${m}» no identifica a nadie: lo puede emitir cualquiera menos el beneficiario`,
          `46A+${i + 1}`,
          "nombrar al emisor si se quiere uno determinado",
        ),
      );
    }
    for (const s of SIN_SIGNIFICADO) {
      if (s.re.test(d)) {
        out.push(
          obs(
            `emision-sin-sentido-46a-${i}`,
            "SE_DESCARTA",
            "ISBP 821 A19 y E4",
            s.que,
            `46A+${i + 1}`,
            "sacarlo o redactarlo como una exigencia concreta",
          ),
        );
      }
    }
  });

  /* ── el campo 47A: las condiciones adicionales ── */
  const cond = lc.condicionesAdicionales ?? [];

  /*
   * Una cláusula de pago que nombra **menos documentos** de los que el crédito exige.
   *
   * El laudo **DOCDEX 362** es un crédito de pago mixto en tres tramos donde el último, del 10 %, pedía
   * *«an acceptance certificate and a performance bank guarantee»* y además decía que el banco pagaría
   * **solo** contra factura y garantía. El beneficiario presentó la factura y la garantía, el emisor
   * rechazó, hubo una medida judicial de por medio, y el panel resolvió:
   *
   * > **Usage of the word "only" and the missing requirement for an acceptance certificate gave rise to
   * > ambiguity** as to the requirements for payment. Whilst the beneficiary presented only an invoice and
   * > a performance bank guarantee, **the risk of misinterpretation must be borne by the Respondent.**
   *
   * > Under the provisions of the UCP 600 and the ISBP 745, **the Respondent bore responsibility for
   * > ambiguous instructions.** Hence the Respondent should have honoured presentation of the invoice and
   * > bank guarantee alone. The Respondent was also liable for the delay in payment.
   *
   * Lo que el panel cita es la consideración preliminar (v) de la ISBP, que ya está en el repositorio por
   * la Opinión TA 796rev: *«The applicant bears the risk of any ambiguity in its instructions […] An
   * issuing bank should ensure that any credit or amendment it issues is not ambiguous or conflicting in
   * its terms and conditions»*.
   *
   * **El disparador es la palabra que el panel señala**: una cláusula que condiciona el pago con «only» y
   * nombra documentos, mientras el crédito exige además otros. Sin «only» no se marca —un crédito de pago
   * mixto puede nombrar los documentos de cada tramo sin contradecirse— y sin documentos nombrados en la
   * cláusula tampoco: «only against presentation of the documents specified above» no contradice nada.
   */
  cond.forEach((c, i) => {
    if (!/\bonly\b/i.test(c) || !/\b(?:against|upon|on)\b/i.test(c)) return;
    if (!/\b(?:payment|paid|pay|honour|honor|negotiat|reimburs)/i.test(c)) return;
    const nombrados = new Set(
      c
        .split(/\band\b|\bor\b|,|\//i)
        .map((x) => claveDoc(x))
        .filter((k) => k && !k.startsWith("TXT:")),
    );
    if (nombrados.size === 0) return;
    const faltan = (lc.documentosExigidos ?? [])
      .map((d) => claveDoc(d))
      .filter((k) => k && !k.startsWith("TXT:") && !nombrados.has(k));
    if (faltan.length === 0) return;
    out.push(
      obs(
        `emision-pago-contra-menos-${i}`,
        "CONFLICTO",
        "Laudo DOCDEX 362 · ISBP, consideración preliminar (v)",
        "Una condición dice que el pago se hace SOLO contra algunos documentos, y el crédito exige otros además: no se sabe qué hay que presentar para cobrar",
        `47A+${i + 1}`,
        "decir en un solo lugar contra qué documentos se paga cada tramo: el riesgo de una instrucción ambigua lo lleva el emisor, y el panel hizo pagar contra la lista más corta",
      ),
    );
  });

  cond.forEach((c, i) => {
    /*
     * Un calendario de embarques es el artículo 32, y el artículo 32 es la consecuencia más dura que
     * tienen las UCP: una cuota no embarcada en su período deja el crédito sin disponibilidad **para esa
     * y las siguientes**, y eso no se subsana presentando de nuevo.
     *
     * El motor no lo parsea a propósito —los créditos lo escriben de veinte maneras y equivocarse cuesta
     * demasiado—, así que su respuesta es el calendario de cuotas que una persona transcribe en la ficha
     * del crédito. Lo que faltaba es **decirlo**: antes esta cláusula salía como condición no
     * documentaria tenida por no puesta, que es el consejo contrario al que corresponde.
     *
     * Y el aviso lleva adentro la trampa que el laudo DOCDEX 204 resuelve, porque es la que hace que
     * transcribir mal el calendario invente una discrepancia: *«The shipment schedule does not demand
     * that at least 40 pct of the goods quantity shall be shipped after 97-07-31 but before 97-08-31»*.
     * Una fecha límite acumulada no es un período con inicio y fin — y eso es justo la contradicción
     * abierta entre R313, que trata una serie de fechas límite como sujeta al artículo de cuotas, y la
     * ISBP 745, que lo restringió a períodos. Este laudo apoya la línea de la ISBP.
     */
    if (CALENDARIO_DE_EMBARQUES.test(c)) {
      out.push(
        obs(
          `emision-calendario-${i}`,
          "AVISO",
          "UCP 600 32",
          "El crédito fija un calendario de embarques: transcribirlo al calendario de cuotas del crédito, porque una cuota no embarcada en su período deja el crédito sin disponibilidad para esa y las siguientes",
          `47A+${i + 1}`,
          "al transcribirlo, mirar si cada renglón es un período con inicio y fin o una fecha límite acumulada: «al menos 40 % antes del 31.08» no exige nada entre el 31.07 y el 31.08, y tomarlo por un período inventa una discrepancia (laudo DOCDEX 204)",
        ),
      );
    }
    if (deduceDelCobro(c)) {
      out.push(
        obs(
          `emision-deduccion-${i}`,
          "CONFLICTO",
          "Laudo DOCDEX 212 · UCP 600 4a",
          "El crédito deja deducir del cobro lo que el ordenante reclame, así que una presentación conforme puede no cobrarse entera",
          `47A+${i + 1}`,
          "sacarla: el panel la llama «against the spirit of UCP 500» y aun así la hace valer, porque es un término del crédito. Si el comprador necesita retener algo, va en el contrato y no acá — y si la cláusula se queda, tendría que decir al menos tope, plazo y en qué condiciones un reclamo vale",
        ),
      );
    }
    if (
      !mencionaDocumento(c) &&
      !/fee|charge|sanction|discrepan/i.test(c) &&
      !esParametroDelCredito(c) &&
      /* Y una cláusula de deducción **no** se tiene por no puesta: el laudo DOCDEX 212 la hace valer. */
      !deduceDelCobro(c)
    ) {
      out.push(
        obs(
          `emision-no-documentaria-${i}`,
          "SE_DESCARTA",
          "UCP 600 14h",
          "Condición que ningún documento acredita: los bancos la tienen por no puesta",
          `47A+${i + 1}`,
          "decir con qué documento se comprueba, o sacarla",
        ),
      );
    }
    for (const s of SIN_SIGNIFICADO) {
      if (s.re.test(c)) {
        out.push(
          obs(
            `emision-sin-sentido-47a-${i}`,
            "SE_DESCARTA",
            "ISBP 821 A19 y E4",
            s.que,
            `47A+${i + 1}`,
            "sacarlo o redactarlo como una exigencia concreta",
          ),
        );
      }
    }
    if (ADMINISTRATIVAS.test(c)) {
      out.push(
        obs(
          `emision-administrativa-${i}`,
          "SE_DESCARTA",
          "ISBP 821, consideración preliminar ix",
          "Condición administrativa del banco: su incumplimiento no es motivo de rechazo",
          `47A+${i + 1}`,
          "acordarla fuera del crédito",
        ),
      );
    }
    if (DEL_ORDENANTE.test(c)) {
      out.push(
        obs(
          `emision-cond-ordenante-${i}`,
          "CONFLICTO",
          "ISBP 821, consideración preliminar vii",
          "Una condición depende de un acto del ordenante",
          `47A+${i + 1}`,
          "deja el cobro a su voluntad: conviene reemplazarla por un documento de un tercero",
        ),
      );
    }
  });

  /* ── barras y comas que admiten cualquier combinación (ISBP A2) ── */
  for (const [campo, valor] of [
    ["44E", campos.puertoEmbarque.valor],
    ["44F", campos.puertoDestino.valor],
  ] as const) {
    if (valor && /\//.test(valor)) {
      out.push(
        obs(
          `emision-barra-${campo}`,
          "AVISO",
          "ISBP 821 A2",
          `«${valor}» lleva una barra: se admite cualquiera de las opciones o su combinación`,
          `campo ${campo}`,
          "escribir una sola, o decir expresamente que valen todas",
        ),
      );
    }
  }

  /* ── transbordo prohibido con carga en contenedor ── */
  if (extra.transbordo && /not allowed|prohibid/i.test(extra.transbordo)) {
    const enContenedor = /\bcontainer|contenedor|\bfcl\b|\d+\s*x?\s*(20|40)'?\s*(dr|hc|gp|rf)?\b/i.test(
      `${campos.mercaderia.valor} ${docs.join(" ")}`,
    );
    out.push(
      obs(
        "emision-transbordo",
        enContenedor ? "CONFLICTO" : "AVISO",
        "UCP 600 20c-ii",
        enContenedor
          ? "Se prohíbe el transbordo pero la carga va en contenedor: el documento que lo indique se acepta igual"
          : "Se prohíbe el transbordo: el artículo 20(c) admite igual algunos casos",
        "campo 43T",
        "para que la prohibición tenga efecto hay que excluir expresamente el sub-artículo 20(c)",
      ),
    );
  }

  /*
   * ── La política interna que el crédito se reserva aplicar «a su sola discreción» ──
   *
   * Hay créditos que escriben una cláusula como ésta en sus condiciones adicionales:
   *
   * > OUR BANK PROCESS TRANSACTIONS IN ACCORDANCE WITH LOCAL AND INTERNATIONAL LAWS AND REGULATIONS,
   * > AND RESERVE THE RIGHT TO COMPLY WITH FOREIGN SANCTIONS AS WELL. CONSEQUENTLY DOCUMENTS […]
   * > MIGHT NOT BE PROCESSED BY OUR BANK AT OUR SOLE DISCRETION AND WITHOUT ANY LIABILITY ON OUR PART.
   *
   * No es una condición documentaria —no pide ningún papel— así que `verificaciones-manuales.ts` la
   * filtra, con razón: no hay nada que verificar contra un documento. Pero entonces **no la miraba
   * nadie**, y es justo lo que un banco necesita ver antes de aceptar una designación. Lo encontró la
   * auditoría de los guardianes del banco de pruebas: el caso TA 884rev afirmaba que el motor la leía
   * y era falso — no aparecía en ninguna regla, en ninguna verificación manual ni en esta revisión.
   *
   * Va como AVISO y no como IMPIDE, y la gravedad es la decisión: el crédito **sigue siendo
   * operable**, y la Banking Commission de la ICC ya resolvió dos veces qué vale esa cláusula. En
   * TA 884rev dijo que el emisor *«is obligated to honour a complying presentation»* y que una
   * objeción fundada en una regulación de sanciones *«should not be construed as a refusal notice
   * under UCP 600 article 16»*. En TA 956rev agregó que invocar el riesgo de compliance interno *«would
   * not constitute a valid reason to refuse the presentation»* y que **nombrar políticas internas en
   * un crédito no es práctica bancaria prudente**. O sea: el que acepta este crédito tiene que saber
   * que la cláusula no le da al emisor el derecho que parece darle.
   *
   * Lo que se busca es la **discrecionalidad**, no la palabra «sanciones»: un crédito puede nombrar
   * las sanciones por obligación regulatoria sin reservarse nada, y marcar eso sería ruido en la
   * mitad de los créditos del mundo. Lo que no corresponde es reservarse no procesar «a sola
   * discreción» y sin responsabilidad.
   */
  {
    const texto = (p.lc.condicionesAdicionales ?? []).join(" \n ");
    const seReserva = /\b(?:SOLE|OWN|ABSOLUTE)\s+DISCRETION\b|\bAT\s+(?:OUR|ITS)\s+DISCRETION\b/i.test(texto);
    const puedeNoProcesar =
      /\bMIGHT\s+NOT\s+BE\s+PROCESSED\b|\bMAY\s+(?:NOT\s+BE\s+PROCESSED|REFUSE|DECLINE)\b|\bRESERVE\s+THE\s+RIGHT\s+(?:TO|NOT)\b/i.test(
        texto,
      );
    if (seReserva && puedeNoProcesar) {
      out.push(
        obs(
          "emision-politica-interna",
          "AVISO",
          "UCP 600 16 · Opiniones ICC TA 884rev y TA 956rev",
          "El crédito se reserva no procesar los documentos a su sola discreción: esa cláusula no releva al emisor de honrar una presentación conforme",
          "campo 47A",
          "la ICC resolvió que el emisor está obligado a honrar y que una objeción por política interna no es un aviso de rechazo del artículo 16; conviene pedir que se saque antes de aceptar la designación",
        ),
      );
    }
  }

  /*
   * ── «third party documents are acceptable», que la ICC desaconseja expresamente ──
   *
   * Es una cláusula corriente y el laudo **DOCDEX 206** la desarma: *«the clause "Third party documents
   * are acceptable" is a very obscure provision which does not clarify: — in respect of which parties a
   * party has to be considered a "third party"; — whether a document (and which document) is acceptable
   * when issued by a party not mentioned in the credit […]; — whether a document (and which document) is
   * acceptable when containing a reference to a party not mentioned in the credit»*.
   *
   * Y lo que importa de verdad, porque es lo que un banco cree que la cláusula le da: **no cubre una
   * contradicción entre documentos.** *«the Panel of Experts agrees that the clause "Third party
   * documents are acceptable" as stipulated in the L/C should not have been used and that this clause
   * does not support documents which appear on their face to be inconsistent with one another»*.
   *
   * El panel además señala que la propia ICC se negó a interpretarla —publicación 565, R 246— *«with the
   * aim not to support in any way this term and to discourage applicants and issuing banks from adopting
   * such terminology without providing some meaning thereto»*. Es de las pocas veces que la ICC dice
   * explícitamente que una redacción no se debería usar, así que avisarlo al revisar un crédito es
   * exactamente lo que `emision.ts` existe para hacer.
   *
   * **AVISO y no IMPIDE**: el crédito sigue siendo operable y la práctica bancaria le da a la cláusula un
   * sentido restringido que el propio laudo recoge —admitir un documento de transporte cuyo shipper no
   * es el beneficiario—. Lo que no hace es lo que un banco espera que haga.
   *
   * **Y solo avisa cuando la cláusula va pelada, que lo decidió el crédito real del expediente.** La
   * primera versión marcaba cualquier «third party documents acceptable» y el test que fija que el
   * crédito de referencia no tiene nada que reescribir se puso rojo — con razón: ese 47A dice «THIRD
   * PARTY DOCUMENTS **EXCEPT DRAFT AND COMMERCIAL INVOICE** ACCEPTABLE», o sea que **sí aclara qué
   * documentos**, que es exactamente la primera de las tres cosas que el panel echa en falta. Un banco
   * que escribe la excepción está escribiendo la cláusula bien, y marcarlo sería ruido en un crédito
   * mejor redactado que el del laudo.
   */
  {
    const texto = (p.lc.condicionesAdicionales ?? []).join(" \n ");
    const laCláusula = /\bTHIRD\s+PARTY\s+DOCUMENTS?\b[^.;\n]{0,60}\bACCEPTABLE\b/i.exec(texto)?.[0] ?? "";
    const aclaraCuales =
      /\bEXCEPT\b|\bOTHER\s+THAN\b|\bEXCLUDING\b|\bSAVE\s+FOR\b|\bSAVE\b|\bI\.?E\.?\b|\bSUCH\s+AS\b/i.test(laCláusula);
    if (laCláusula && !aclaraCuales) {
      out.push(
        obs(
          "emision-tercero-aceptable",
          "AVISO",
          "Laudo DOCDEX 206 · ICC pub. 565 R 246",
          "«Third party documents are acceptable» es una cláusula que la ICC desaconseja: no dice respecto de quién un tercero es tercero, ni qué documento admite",
          "campo 47A",
          "el laudo DOCDEX 206 resolvió que **no cubre una contradicción entre documentos** y que no se debería usar; si lo que se quiere es admitir un documento de transporte cuyo shipper no es el beneficiario, conviene escribirlo así",
        ),
      );
    }
  }

  /* ── «about» en el importe (artículo 30a) ── */
  if (/\b(about|approximately|circa)\b/i.test(`${extra.formaCredito ?? ""} ${campos.montoTotal.valor}`)) {
    out.push(
      obs(
        "emision-about",
        "AVISO",
        "UCP 600 30a",
        "«about» sobre el importe significa ±10 %, no una aproximación a criterio",
        "campo 32B",
        "si se quiere otra tolerancia, indicarla en el campo 39A",
      ),
    );
  }

  /*
   * ── art. 13: el reembolso entre bancos ──
   *
   * Solo cuando el crédito nombra un banco reembolsador (53A): si el designado se cobra del emisor,
   * no hay reembolso entre bancos que regular y el artículo no se aplica. Marcarlo igual sería ruido
   * en todos los créditos normales.
   */
  /*
   * La cláusula que pretende quitarle al beneficiario el derecho a volver a presentar.
   *
   * El laudo **DOCDEX 337** —unánime— es un crédito cuyo campo 78 decía *«All documents accepted on first
   * presentation which comply with L/C terms and conditions, we will remit the proceeds»*, y el emisor la
   * usó para rechazar documentos **corregidos y vueltos a presentar dentro del plazo**: *«our credit field
   * 78 point 2 […] state "on first presentation", means the docs must complying on first presentation.
   * Therefore the docs is still discrepancies although the revised docs presented to us»*.
   *
   * El panel la desarma por dos caminos, y los dos valen guardados. El primero es la Opinión
   * **R715 / TA677rev**, que el laudo transcribe:
   *
   * > **It is not for an issuing bank to dictate what a beneficiary or other presenter may or may not do in
   * > order to achieve a complying presentation.** In the normal course of events, it is within the rights
   * > of a presenter to request the return of discrepant documents and have them corrected, where possible.
   * > It is also their right to replace discrepant documents with corrected ones. **Until the documents are
   * > honoured or negotiated they remain the property of the presenter.** […] The other clauses specified in
   * > the query **represent bad practice and issuing banks should refrain from including such terms and
   * > conditions in their credit.**
   *
   * El segundo es el artículo 1: las UCP obligan *«unless expressly modified or excluded by the credit»*, y
   * una desviación así —*«a very detrimental deviation from the principles of UCP 600 and international
   * standard banking practice towards the beneficiary and/or the nominated bank»*— tendría que estar
   * *«very clearly and expressly stated»* para valer. Metida en el campo 78 y en forma vaga, **no es una
   * modificación expresa**. Y el panel cierra con el 7 (c): el emisor tenía que reembolsar igual al
   * designado que honró una presentación conforme.
   *
   * Sale como **CONFLICTO y no como aviso** por lo que el propio expediente muestra: la cláusula es
   * ineficaz y aun así el emisor rechazó dos juegos con ella, y el cobro se demoró meses. Es el mismo
   * trato que la cláusula de deducción del laudo 212 y el pago «solo contra» del 362 — una presentación
   * puede cumplir y no cobrarse igual.
   *
   * **Y mira el campo 78 además del 47A**, que es donde esta cláusula vive: el laudo es exactamente el
   * caso de una condición escondida en las instrucciones al banco. El guardián del lado del examen es el
   * de *Korea Exchange Bank v SCB*, que ya dejó escrito que una re-presentación es una presentación.
   */
  {
    const donde78 = [p.extra.instruccionesAlBanco ?? "", ...(p.lc.condicionesAdicionales ?? [])].join(" \n ");
    if (/\bon\s+first\s+presentation\b|\bfirst\s+presentation\s+only\b/i.test(donde78)) {
      out11.push(
        obs(
          "emision-primera-presentacion",
          "CONFLICTO",
          "UCP 600 1 · Opinión R715/TA677rev · Laudo DOCDEX 337",
          "El crédito ata el pago a que los documentos cumplan «on first presentation»",
          "campo 78 o 47A",
          "sacarla: el beneficiario tiene derecho a pedir los documentos de vuelta, corregirlos y volver a presentarlos hasta el vencimiento, y la Opinión R715/TA677rev dice que no le toca al emisor dictar qué puede hacer para lograr una presentación conforme. Una desviación tan perjudicial tendría que estar expresa y clarísima para valer como modificación de las UCP (art. 1), y el laudo DOCDEX 337 resolvió que escrita así no lo es — pero el emisor de ese expediente rechazó dos juegos corregidos invocándola, y el cobro se demoró meses",
        ),
      );
    }
  }

  if (p.extra.bancoReembolsador?.trim()) {
    const donde = [
      p.extra.instruccionesAlBanco ?? "",
      ...(p.lc.condicionesAdicionales ?? []),
      p.extra.infoAlDestinatario ?? "",
      // el 40E: «UCPURR LATEST VERSION» es el código estándar para declarar las URR, y no se miraba
      p.extra.reglas ?? "",
    ].join(" \n ");

    /*
     * 13 (a): el crédito tiene que decir si el reembolso se sujeta a las URR.
     *
     * No decirlo no lo deja inoperable —el 13 (b) suple las reglas que faltan— y por eso va como
     * AVISO: un banco que ve «IMPIDE» donde el artículo tiene una respuesta deja de confiar en las
     * que sí impiden. Pero conviene saberlo antes de aceptar la designación, porque lo que suple el
     * artículo no es lo mismo que lo que suplen las URR.
     */
    // «URR725» se escribe sin espacio tan seguido como «URR 725»: un `\bURR\b` no lo encuentra
    if (!/\bURR\s*\d*\b|\bUCPURR\b|uniform rules for bank[\s-]?to[\s-]?bank reimbursement/i.test(donde)) {
      out.push(
        obs(
          "ucp-13a",
          "AVISO",
          "UCP 600 13a",
          "El crédito nombra un banco reembolsador y no dice si el reembolso se sujeta a las URR",
          "campo 53A",
          "indicar en el 78 o en las condiciones si rigen las URR 725; sin eso rige el 13 (b): la autorización no puede llevar vencimiento, no se puede exigir certificado de cumplimiento al reembolsador, y el emisor reembolsa igual si el reembolsador no paga a primer requerimiento",
        ),
      );
    }

    /*
     * 13 (b) (iii): al banco que reclama no se le puede exigir un certificado de cumplimiento para
     * cobrarle **al reembolsador**.
     *
     * La distinción importa: pedirle al designado que certifique al **emisor** es otra cosa, y
     * marcarlo sería inventar una prohibición que el artículo no tiene. Lo que el artículo niega es
     * condicionar el reembolso a un papel que nadie está obligado a darle.
     */
    /*
     * Lo que el artículo niega es exigirle el certificado **al reembolsador**, no que las dos
     * palabras aparezcan cerca.
     *
     * La versión anterior saltaba por proximidad: un 78 que dijera «certify compliance on its
     * covering letter **to us** and claim reimbursement from the reimbursing bank» daba CONFLICTO
     * sobre un crédito bien redactado —el certificado es para el emisor, que es práctica universal—
     * y hasta una frase que solo nombraba las dos cosas de paso. El propio comentario de arriba
     * advertía contra eso.
     *
     * Exigir que el certificado vaya **dirigido** al reembolsador cerró el falso positivo y abrió
     * tres falsos negativos con la redacción corriente: «CLAIMS ON THE REIMBURSING BANK MUST BE
     * ACCOMPANIED BY YOUR CERTIFICATE», «REIMBURSING BANK WILL HONOUR YOUR CLAIM ONLY AGAINST YOUR
     * CERTIFICATE», «WHEN CLAIMING FROM THE REIMBURSING BANK, CERTIFY THAT…». El artículo no habla
     * de a quién se le dirige el papel: habla de **condicionar el reembolso** a él.
     *
     * Así que se mira eso —el certificado y el reclamo al reembolsador en la misma oración— y se
     * descarta el caso que había dado el falso positivo: cuando el certificado va explícitamente
     * para otro. «CERTIFY COMPLIANCE ON ITS COVERING LETTER TO US AND CLAIM REIMBURSEMENT FROM THE
     * REIMBURSING BANK» es práctica universal y no es lo que el artículo prohíbe.
     */
    const oraciones = donde.split(/[.;]/);
    const certificadoAlReembolsador = oraciones.some((o) => {
      if (!/certif/i.test(o) || !/reimburs/i.test(o)) return false;
      // el certificado dirigido a otro: a nosotros, al emisor, a ustedes
      const paraOtro = /certif\w*[^,]{0,60}?\bto\s+(us|you|yourselves|the\s+issuing\s+bank)\b/i.test(o);
      return !paraOtro;
    });
    if (certificadoAlReembolsador) {
      out.push(
        obs(
          "ucp-13b-iii",
          "CONFLICTO",
          "UCP 600 13b-iii",
          "El crédito exige un certificado de cumplimiento para cobrarle al banco reembolsador",
          "campo 78",
          "sacarlo: el artículo dice que al banco que reclama no se le puede exigir ese certificado, así que el banco designado que acepte la designación quedaría esperando un reembolso que depende de un papel que nadie tiene que darle",
        ),
      );
    }
  }

  return [...out11, ...out];
}

/** Cuántas observaciones hay de cada tipo, para mostrar un resumen. */
export function resumenRevision(o: Observacion[]) {
  const cuenta = (g: Gravedad) => o.filter((x) => x.gravedad === g).length;
  return {
    total: o.length,
    impiden: cuenta("IMPIDE"),
    conflictos: cuenta("CONFLICTO"),
    seDescartan: cuenta("SE_DESCARTA"),
    avisos: cuenta("AVISO"),
    /** un crédito con algo que lo impide no debería emitirse así */
    operable: cuenta("IMPIDE") === 0,
  };
}

/** Una observación en una línea, para listarla o exportarla. */
export function describirObservacion(o: Observacion): string {
  const etiqueta: Record<Gravedad, string> = {
    IMPIDE: "IMPIDE CUMPLIRLO",
    CONFLICTO: "conflictivo",
    SE_DESCARTA: "se descarta",
    AVISO: "aviso",
  };
  return `[${etiqueta[o.gravedad]}] ${o.donde} — ${o.que} (${o.fuente}). ${o.sugerencia}`;
}

/** Para revisar un crédito del que solo se tiene la estructura, sin el mensaje entero. */
export function revisarLcInfo(lc: LcInfo): Observacion[] {
  return revisarCredito({
    lc,
    requisitos: {
      documentosExigidos: lc.documentosExigidos ?? [],
      limiteEmbarque: { valor: lc.limiteEmbarque, confianza: 1 },
      vencimiento: { valor: lc.vencimiento, confianza: 1 },
      plazoPresentacion: { valor: lc.plazoPresentacion, confianza: 1 },
      toleranciaCantidad: { valor: "", confianza: 0 },
      parcialesPermitidos: { valor: "", confianza: 0 },
    },
    campos: {
      exportador: { valor: "", confianza: 0 },
      importador: { valor: "", confianza: 0 },
      montoTotal: { valor: String(lc.monto ?? ""), confianza: 1 },
      moneda: { valor: lc.moneda ?? "", confianza: 1 },
      cantidad: { valor: "", confianza: 0 },
      unidad: { valor: "", confianza: 0 },
      mercaderia: { valor: "", confianza: 0 },
      puertoEmbarque: { valor: "", confianza: 0 },
      puertoDestino: { valor: "", confianza: 0 },
      fechaEmbarque: { valor: lc.limiteEmbarque, confianza: 1 },
      incoterm: { valor: "", confianza: 0 },
      numeroDoc: { valor: lc.numero, confianza: 1 },
    },
    extra: {
      tipoMensaje: null,
      // No viene de un mensaje SWIFT, así que no hay 45A crudo ni 72Z ni 79 que mirar.
      bienes: null,
      libradoLineas: [],
      infoAlDestinatario: null,
      fechaEmision: lc.fechaEmision ?? null,
      // El lugar del 31D no está en una `LcInfo`: viene del mensaje, y acá no hay mensaje.
      lugarVencimiento: null,
      formaCredito: null,
      confirmacion: null,
      disponibleCon: lc.librado ?? null,
      /*
       * Sin BIC de ningún banco: esto no viene de un mensaje SWIFT.
       *
       * `revisarLcInfo` revisa un crédito cargado a mano, sin encabezado ni campos 52A/57A, así que
       * no hay con qué decir qué papel juega nadie. En null el examen no dice nada del papel, que es
       * lo correcto: suponerlo sería decidir sobre la obligación de pagar con un dato inventado.
       */
      bicEmisor: null,
      bicAvisador: null,
      bicDisponibleCon: null,
      bicReceptor: null,
      bancoReembolsador: null,
      instruccionesAlBanco: null,
      giros: lc.giros ?? null,
      parciales: null,
      transbordo: null,
      condicionesAdicionales: lc.condicionesAdicionales ?? [],
      cargos: null,
      aplicante: [],
      beneficiario: [],
      reglas: null,
    },
  });
}
