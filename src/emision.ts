import { parseFecha } from "./fechas";
import { diasPresentacion, limitePresentacion } from "./lc";
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
const DEDUCE_POR_EL_ORDENANTE =
  /\b(?:deduct|withhold|set[\s-]?off|retain)\w*\b[^.;]{0,80}\b(?:applicant|buyer|importer|opener)/i;

/** ¿La cláusula deja deducir del cobro del beneficiario algo que no es un gasto bancario? */
function deduceDelCobro(c: string): boolean {
  if (/\bdiscrepanc\w*\s+fee|\bfee\b|\bcharges?\b|\bcommission/i.test(c)) return false;
  return DEDUCE_RECLAMO.test(c) || DEDUCE_POR_EL_ORDENANTE.test(c);
}

/** Frases que la práctica manda descartar porque no significan nada. */
const SIN_SIGNIFICADO = [
  {
    re: /third\s+party\s+documents?\s+(are\s+)?not\s+acceptable/i,
    que: "«third party documents not acceptable» no tiene significado y se descarta",
  },
  {
    re: /(freight\s+forwarder'?s?|house)\s+(b\/?l|bill of lading)\s+(is\s+)?not\s+acceptable/i,
    que: "«freight forwarder's B/L not acceptable» no dice nada sobre cómo debe emitirse el documento y se descarta",
  },
];

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
export const PARAMETROS_DEL_CREDITO =
  /\b(tolerance|more or less|partial (shipment|drawing)s?|transhipment|transshipment|instal?ments?|expiry|latest shipment|revolving|confirm(ed|ation))\b|\b(shipping|shipment)\s+schedule\b|\bto be shipped (before|by|within|during)\b/i;

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
  if (!extra.giros) {
    out.push(
      obs(
        "emision-forma",
        "IMPIDE",
        "UCP 600 6b",
        "El crédito no dice si es a la vista, a plazo, por aceptación o por negociación",
        "campo 42C",
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
    if (/\b(shipping|shipment)\s+schedule\b|\bto be shipped (before|by|within|during)\b/i.test(c)) {
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
      !PARAMETROS_DEL_CREDITO.test(c) &&
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
