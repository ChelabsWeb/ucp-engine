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

/** Un documento que solo puede emitir el ordenante: pedirlo deja el cobro en sus manos. */
const DEL_ORDENANTE =
  /\b(issued|signed|countersigned|approved|certified)\s+by\s+(the\s+)?(applicant|buyer|importer|opener)\b|applicant'?s?\s+(signature|certificate|approval|inspection)/i;

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
export const PARAMETROS_DEL_CREDITO =
  /\b(tolerance|more or less|partial (shipment|drawing)s?|transhipment|transshipment|instal?ments?|expiry|latest shipment|revolving|confirm(ed|ation))\b/i;

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
 * Tiene que ser específico o arruina todo. El 47A del expediente real dice «BENEFICIARY SHOULD
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
    if (!mencionaDocumento(c) && !/fee|charge|sanction|discrepan/i.test(c) && !PARAMETROS_DEL_CREDITO.test(c)) {
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
     * Ahora se exige que el certificado vaya **dirigido** al reembolsador: «to the reimbursing
     * bank», «to them when claiming». Si está dirigido a otro, no es lo que el artículo prohíbe.
     */
    const certificadoAlReembolsador =
      /certif\w*[^.;]{0,80}?\bto\s+(the|our|your|its)?\s*reimbursing\s+bank\b|\bto\s+(the|our|your|its)?\s*reimbursing\s+bank\b[^.;]{0,40}?certif\w*/i.test(
        donde,
      );
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
      // No viene de un mensaje SWIFT, así que no hay 72Z ni 79 que mirar.
      infoAlDestinatario: null,
      fechaEmision: lc.fechaEmision ?? null,
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
