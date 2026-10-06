import { aJuegoSwift, envolver, importeSwift, yymmdd } from "./swift-salida";

/**
 * Los tres mensajes del reembolso entre bancos (MT740, MT742, MT747).
 *
 * ── Por qué no son plomería ─────────────────────────────────────────────────────────────────────
 * Son el papeleo alrededor del artículo 13 y podrían haber sido tres plantillas. No lo son, porque
 * el artículo le pone condiciones **a estos mismos mensajes** y el armador las puede hacer cumplir:
 *
 * - **13 (b) (ii): la autorización de reembolso no debería llevar vencimiento.** Una con fecha deja
 *   al banco que reclama sin de dónde cobrar el día que reclame tarde. El armador se niega — y
 *   también se niega a agregárselo por la puerta de atrás con un MT747.
 * - **13 (b) (iii): al banco que reclama no se le puede exigir un certificado de cumplimiento.** Un
 *   MT742 que lo lleve está aceptando una condición que el artículo le niega, y sentando la práctica
 *   de que se exige.
 * - **13 (b) (iv) y (v): si el reembolsador no paga a primer requerimiento, el emisor reembolsa
 *   igual**, y responde por los intereses perdidos y por los gastos del reembolsador. Va dicho en el
 *   reclamo, porque es lo que el banco que reclama tiene a favor y conviene que esté escrito antes
 *   de que haga falta.
 *
 * Y una cuenta que ningún artículo hace falta para justificar: lo reclamado no puede pasarse de lo
 * autorizado más su tolerancia, ni venir en otra moneda.
 *
 * ── Lo que no se escribe ────────────────────────────────────────────────────────────────────────
 * Los campos cuyos códigos no se pudieron verificar contra fuente pública no se inventan. El 740
 * admite más de lo que se arma acá —el 25 de identificación de cuenta, el 71A con las palabras
 * exactas de a cargo de quién van los gastos del reembolsador— y esos quedan afuera hasta poder
 * comprobarlos: un mensaje con un campo plausible pero equivocado es peor que uno sin el campo,
 * porque llega.
 *
 * ── Dos etiquetas sin verificar, dichas acá y en CLAUDE.md ──────────────────────────────────────
 * **En el MT740 se usan `:21:` para el número del crédito y `:30:` para la fecha, y ninguna de las
 * dos se pudo comprobar contra fuente pública** — el catálogo de campos por tipo de mensaje está en
 * la documentación de pago de SWIFT. Son razonables y siguen el patrón de los otros mensajes de
 * esta familia, pero «razonable» no es «verificado», y el repo ya tiene dos casos iguales anotados
 * (el 77B del 734 y el 23 del 752).
 *
 * Lo que sí está verificado es lo que decide: el 20, el 32B, el 39A y el 72Z, y sobre todo las
 * condiciones del artículo 13 que hacen que el armador se niegue. Antes de usar estos tres mensajes
 * con un banco de verdad hay que confirmar el catálogo; antes de usar el 734 y el 752, también.
 */

const MAX_LINEA = 35;

export interface MensajeReembolso {
  /** el mensaje, o "" si no corresponde emitirlo */
  texto: string;
  avisos: string[];
}

/** Lo que cualquiera de los tres necesita para armarse sin que la red lo rebote. */
function armador() {
  let hubeQueCambiar = false;
  const L: string[] = [];
  return {
    limpiar(s: string) {
      const r = aJuegoSwift(s);
      hubeQueCambiar = hubeQueCambiar || r.hubeQueCambiar;
      return r.texto;
    },
    campo(tag: string, lineas: string[]) {
      const utiles = lineas.filter((x) => x.trim().length > 0);
      if (utiles.length === 0) return;
      L.push(`:${tag}:${utiles[0]}`);
      for (const extra of utiles.slice(1)) L.push(extra);
    },
    cerrar(avisos: string[]): MensajeReembolso {
      if (hubeQueCambiar) {
        avisos.push(
          "Some characters are not in the SWIFT X character set and were replaced with the closest equivalent: check the names before sending.",
        );
      }
      return { texto: L.join("\n"), avisos };
    },
  };
}

const ref16 = (s: string) => s.trim().slice(0, 16);
const importe = (moneda: string, n: number) => `${moneda.toUpperCase().slice(0, 3)}${importeSwift(n)}`;

/* ─────────────────── MT740: la autorización a reembolsar ─────────────────── */

export interface DatosMT740 {
  /** campo 20 */
  referenciaPropia: string;
  /** campo 21: el crédito que se reembolsa */
  referenciaCredito: string;
  moneda: string;
  monto: number;
  /** campo 39A: la tolerancia del crédito, como fracción. Null = no escribir el campo */
  tolerancia?: number | null;
  /** campo 58A: el banco autorizado a reclamar */
  bancoQueReclama?: string | null;
  /**
   * El vencimiento que alguien quiera ponerle.
   *
   * Está en el tipo para poder **negarse**: el artículo 13 (b) (ii) dice que la autorización no
   * debería llevar uno, y si no estuviera en el tipo no habría cómo decir por qué no se emitió.
   */
  vencimiento?: Date | null;
  fecha: Date;
  /** campo 72Z */
  informacion?: string[];
}

export function mt740(d: DatosMT740): MensajeReembolso {
  /*
   * La autorización no lleva vencimiento, y por eso no se emite con uno.
   *
   * No es una preferencia de formato: una autorización que vence deja al banco que reclama sin de
   * dónde cobrar el día que reclame tarde, y lo que el artículo dice entonces es que el emisor
   * reembolsa igual (13 b iv). Emitirla con vencimiento es prometerle al reembolsador un límite que
   * el artículo no reconoce, y al que reclama un riesgo que no le corresponde.
   */
  if (d.vencimiento) {
    return {
      texto: "",
      avisos: [
        "No reimbursement authorisation was built because it carries an expiry date: under UCP 600 13 (b) (ii) a reimbursement authorisation should not be subject to an expiry date. Remove it, or state that the reimbursement is subject to URR 725 and follow those rules instead.",
      ],
    };
  }

  const a = armador();
  const avisos: string[] = [];
  const ref = a.limpiar(ref16(d.referenciaPropia));
  if (d.referenciaPropia.trim().length > 16) {
    avisos.push(`The sender reference was trimmed to 16 characters: "${ref}".`);
  }

  a.campo("20", [ref]);
  a.campo("21", [a.limpiar(ref16(d.referenciaCredito)) || "NONREF"]);
  a.campo("30", [yymmdd(d.fecha)]);
  if (d.bancoQueReclama?.trim()) a.campo("58A", [a.limpiar(d.bancoQueReclama.trim())]);
  a.campo("32B", [importe(d.moneda, d.monto)]);
  /*
   * El 39A solo si el crédito fija una tolerancia.
   *
   * Un 39A ausente deja que rija lo que diga el crédito; un «0/0» le dice al reembolsador que no hay
   * tolerancia ninguna. Escribirlo sin que el crédito lo diga sería ajustar el reembolso por cuenta
   * propia.
   */
  if (d.tolerancia != null) {
    const pct = Math.round(d.tolerancia * 100);
    a.campo("39A", [`${pct}/${pct}`]);
  }
  if (d.informacion?.length) a.campo("72Z", envolver(a.limpiar(d.informacion.join("\n")), MAX_LINEA).slice(0, 6));

  return a.cerrar(avisos);
}

/* ─────────────────── MT742: el reclamo de reembolso ─────────────────── */

export interface DatosMT742 {
  referenciaPropia: string;
  /** campo 21: la autorización contra la que se reclama */
  referenciaAutorizacion: string;
  moneda: string;
  /** campo 32B: el principal que se reclama */
  montoPrincipal: number;
  /** campo 71B: los gastos que se suman al total */
  gastos?: number | null;
  /** lo que la autorización permite, para no reclamar de más */
  autorizado: { moneda: string; monto: number; tolerancia?: number | null };
  /**
   * Si alguien quiere mandar un certificado de cumplimiento.
   *
   * Está en el tipo para poder **no mandarlo** y decir por qué: el artículo 13 (b) (iii) dice que no
   * se le puede exigir al banco que reclama.
   */
  certificarCumplimiento?: boolean;
  fecha: Date;
  informacion?: string[];
}

export function mt742(d: DatosMT742): MensajeReembolso {
  const avisos: string[] = [];

  if (d.moneda.trim().toUpperCase().slice(0, 3) !== d.autorizado.moneda.trim().toUpperCase().slice(0, 3)) {
    return {
      texto: "",
      avisos: [
        `No reimbursement claim was built: it is in ${d.moneda} and the authorisation is in ${d.autorizado.moneda}. A claim in another currency is not a claim under that authorisation.`,
      ],
    };
  }

  /*
   * El tope: lo autorizado más su tolerancia.
   *
   * Reclamar de más no lo arregla nadie del otro lado — el reembolsador paga hasta lo autorizado y
   * el resto queda colgado, con el banco que reclama creyendo que lo pidió.
   */
  const tope = d.autorizado.monto * (1 + (d.autorizado.tolerancia ?? 0));
  if (d.montoPrincipal > tope + 1e-9) {
    return {
      texto: "",
      avisos: [
        `No reimbursement claim was built: ${importeSwift(d.montoPrincipal)} exceeds what the authorisation allows (${importeSwift(tope)}, that is ${importeSwift(d.autorizado.monto)} plus ${Math.round((d.autorizado.tolerancia ?? 0) * 100)} PCT).`,
      ],
    };
  }

  if (d.certificarCumplimiento) {
    avisos.push(
      "No certificate of compliance was included: under UCP 600 13 (b) (iii) a claiming bank may not be required to supply one to the reimbursing bank. Sending it anyway would accept a condition the article denies, and would settle the practice of requiring it.",
    );
  }

  const a = armador();
  const ref = a.limpiar(ref16(d.referenciaPropia));
  if (d.referenciaPropia.trim().length > 16) {
    avisos.push(`The sender reference was trimmed to 16 characters: "${ref}".`);
  }

  a.campo("20", [ref]);
  a.campo("21", [a.limpiar(ref16(d.referenciaAutorizacion)) || "NONREF"]);
  a.campo("30", [yymmdd(d.fecha)]);
  a.campo("32B", [importe(d.moneda, d.montoPrincipal)]);
  if (d.gastos != null && d.gastos > 0) a.campo("71B", [importe(d.moneda, d.gastos)]);
  a.campo("34A", [`${yymmdd(d.fecha)}${importe(d.moneda, d.montoPrincipal + (d.gastos ?? 0))}`]);

  /*
   * Lo que el artículo le da al banco que reclama, dicho en el propio reclamo.
   *
   * No es una advertencia al reembolsador: es dejar escrito —antes de que haga falta— que si no
   * paga a primer requerimiento el emisor reembolsa igual y responde por los intereses perdidos y
   * por los gastos del propio reembolsador.
   */
  a.campo(
    "72Z",
    envolver(
      a.limpiar(
        [
          "IF REIMBURSEMENT IS NOT MADE ON FIRST DEMAND, THE ISSUING BANK IS NOT RELIEVED OF ITS OBLIGATION TO REIMBURSE AND IS RESPONSIBLE FOR ANY LOSS OF INTEREST AND FOR YOUR CHARGES (UCP 600 ART. 13B).",
          ...(d.informacion ?? []),
        ].join(" "),
      ),
      MAX_LINEA,
    ).slice(0, 6),
  );

  return a.cerrar(avisos);
}

/* ─────────────────── MT747: la enmienda a la autorización ─────────────────── */

export interface DatosMT747 {
  referenciaPropia: string;
  /** campo 21 */
  referenciaAutorizacion: string;
  /** campo 30: la fecha de la autorización que se enmienda */
  fechaDeLaAutorizacion: Date;
  fecha: Date;
  moneda: string;
  /** campo 32B */
  aumento?: number | null;
  /** campo 33B */
  disminucion?: number | null;
  /** el vencimiento que alguien quiera agregarle, para poder negarse (13 b ii) */
  nuevoVencimiento?: Date | null;
  informacion?: string[];
}

export function mt747(d: DatosMT747): MensajeReembolso {
  // por la puerta de atrás es el mismo problema: la autorización terminaría con vencimiento
  if (d.nuevoVencimiento) {
    return {
      texto: "",
      avisos: [
        "No amendment was built because it would give the reimbursement authorisation an expiry date: under UCP 600 13 (b) (ii) a reimbursement authorisation should not be subject to one, and adding it by amendment is the same thing.",
      ],
    };
  }

  const sube = d.aumento != null && d.aumento > 0;
  const baja = d.disminucion != null && d.disminucion > 0;
  const nota = (d.informacion ?? []).some((x) => x.trim().length > 0);
  if (!sube && !baja && !nota) {
    return {
      texto: "",
      avisos: ["No amendment was built: nothing changes and there is nothing to tell the reimbursing bank."],
    };
  }

  const a = armador();
  const avisos: string[] = [];
  const ref = a.limpiar(ref16(d.referenciaPropia));
  if (d.referenciaPropia.trim().length > 16) {
    avisos.push(`The sender reference was trimmed to 16 characters: "${ref}".`);
  }

  a.campo("20", [ref]);
  a.campo("21", [a.limpiar(ref16(d.referenciaAutorizacion)) || "NONREF"]);
  a.campo("30", [yymmdd(d.fechaDeLaAutorizacion)]);
  if (sube) a.campo("32B", [importe(d.moneda, d.aumento as number)]);
  if (baja) a.campo("33B", [importe(d.moneda, d.disminucion as number)]);
  if (nota) a.campo("72Z", envolver(a.limpiar((d.informacion ?? []).join(" ")), MAX_LINEA).slice(0, 6));

  return a.cerrar(avisos);
}
