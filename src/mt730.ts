import type { EstadoEnmienda } from "./enmienda-vigencia";
import { aJuegoSwift, envolver, yymmdd } from "./swift-salida";

/**
 * El acuse, que es por donde viaja la aceptación de una enmienda (MT730).
 *
 * ── Por qué no es el mensaje aburrido de la lista ───────────────────────────────────────────────
 * El artículo 10 (c) dice que los términos originales siguen rigiendo para el beneficiario **hasta
 * que comunique su aceptación al banco que le avisó la enmienda**, y el MT730 es la vía por la que
 * esa comunicación llega al emisor. O sea: es el mensaje que **cambia cuál de los dos créditos
 * manda**, y mientras no salga los dos bancos pueden estar examinando contra créditos distintos.
 *
 * `examinarConEnmienda` resuelve contra cuál se examina según el estado; esto es la otra punta.
 *
 * ── La regla que es fácil transmitir mal ────────────────────────────────────────────────────────
 * **Una aceptación parcial es un rechazo** (art. 10 e). Si el mensaje dijera «aceptada en parte», el
 * emisor podría leer que la enmienda rige, y no rige. Se transmite como rechazo, nombrando el
 * artículo, y el aviso le dice al que firma qué se transmitió y por qué — porque es distinto de lo
 * que el beneficiario dijo con sus palabras.
 *
 * ── Y lo que no se inventa ──────────────────────────────────────────────────────────────────────
 * Sin respuesta del beneficiario, el acuse sale igual —el emisor sabe que su enmienda llegó— pero
 * **no se escribe nada sobre la aceptación**. Inventarla haría que el emisor pasara a creer que el
 * crédito está enmendado y examinara contra el crédito equivocado, que es el error más caro del
 * artículo 10.
 */

export interface DatosMT730 {
  /** campo 20 */
  referenciaPropia: string;
  /** campo 21: el crédito al que se refiere */
  referenciaCredito: string;
  /** campo 30: la fecha del mensaje que se acusa */
  fechaDelMensajeAcusado: Date;
  /** la fecha de este acuse */
  fecha: Date;
  /** el número de la enmienda que se contesta (26E), cuando el acuse es de una enmienda */
  numeroEnmienda?: string | null;
  /** qué contestó el beneficiario */
  estado: EstadoEnmienda;
  /** campo 72Z */
  informacion?: string[];
}

export interface MensajeMT730 {
  texto: string;
  avisos: string[];
}

const MAX_LINEA = 35;

export function mt730(d: DatosMT730): MensajeMT730 {
  const avisos: string[] = [];
  let hubeQueCambiar = false;
  const limpiar = (s: string) => {
    const r = aJuegoSwift(s);
    hubeQueCambiar = hubeQueCambiar || r.hubeQueCambiar;
    return r.texto;
  };

  const L: string[] = [];
  const campo = (tag: string, lineas: string[]) => {
    const utiles = lineas.filter((x) => x.trim().length > 0);
    if (utiles.length === 0) return;
    L.push(`:${tag}:${utiles[0]}`);
    for (const extra of utiles.slice(1)) L.push(extra);
  };

  const ref = limpiar(d.referenciaPropia).slice(0, 16);
  if (d.referenciaPropia.length > 16) {
    avisos.push(`The sender reference was trimmed to 16 characters: "${ref}".`);
  }

  campo("20", [ref]);
  campo("21", [limpiar(d.referenciaCredito).slice(0, 16) || "NONREF"]);
  campo("30", [yymmdd(d.fechaDelMensajeAcusado)]);

  /*
   * El campo 79: lo que el artículo 10 (c) manda comunicar.
   *
   * Va en narrativa porque es lo que el 730 tiene para decir, y se nombra la enmienda: un crédito
   * puede llevar varias, y un «accepted» sin número no dice cuál.
   */
  const cual = d.numeroEnmienda?.trim() ? `AMENDMENT NO. ${limpiar(d.numeroEnmienda).slice(0, 8)}` : "THE AMENDMENT";
  if (!d.numeroEnmienda?.trim()) {
    avisos.push(
      "The amendment number was not given, so the message refers to it without one: a credit may carry several amendments, and the issuing bank may not know which one is being answered.",
    );
  }

  if (d.estado === "ACEPTADA") {
    campo(
      "79",
      envolver(
        `THE BENEFICIARY HAS COMMUNICATED ITS ACCEPTANCE OF ${cual} TO THIS BANK. THE CREDIT IS AMENDED ACCORDINGLY AS OF THAT COMMUNICATION (UCP 600 ART. 10C).`,
        MAX_LINEA,
      ),
    );
  } else if (d.estado === "RECHAZADA") {
    campo(
      "79",
      envolver(
        `THE BENEFICIARY HAS REJECTED ${cual}. THE TERMS OF THE CREDIT AS THEY STOOD BEFORE THE AMENDMENT REMAIN IN FORCE (UCP 600 ART. 10C).`,
        MAX_LINEA,
      ),
    );
  } else if (d.estado === "ACEPTADA_EN_PARTE") {
    /*
     * Transmitido como rechazo, y diciendo el artículo.
     *
     * No es una interpretación nuestra: el 10 (e) dice que la aceptación parcial de una enmienda no
     * se permite y se tendrá por notificación de rechazo. Transmitirlo con las palabras del
     * beneficiario dejaría al emisor creyendo que algo de la enmienda rige.
     */
    campo(
      "79",
      envolver(
        `THE BENEFICIARY HAS ACCEPTED ${cual} IN PART ONLY. PARTIAL ACCEPTANCE IS NOT ALLOWED AND IS DEEMED NOTIFICATION OF REJECTION (UCP 600 ART. 10E), SO THE TERMS OF THE CREDIT AS THEY STOOD BEFORE THE AMENDMENT REMAIN IN FORCE.`,
        MAX_LINEA,
      ),
    );
    avisos.push(
      "The beneficiary accepted the amendment in part, and that is transmitted as a rejection: under article 10 (e) partial acceptance is deemed notification of rejection. Read the wording before signing, because it is not what the beneficiary said.",
    );
  } else {
    avisos.push(
      "The beneficiary has not yet answered the amendment, so this message only acknowledges receipt: nothing is said about acceptance, because under article 10 (c) the original terms remain in force until the beneficiary communicates it.",
    );
  }

  if (d.informacion?.length) {
    campo("72Z", envolver(limpiar(d.informacion.join("\n")), MAX_LINEA).slice(0, 6));
  }

  if (hubeQueCambiar) {
    avisos.push(
      "Some characters are not in the SWIFT X character set and were replaced with the closest equivalent: check the names before sending.",
    );
  }

  return { texto: L.join("\n"), avisos };
}
