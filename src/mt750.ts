import { aJuegoSwift, envolver, importeSwift, yymmdd } from "./swift-salida";

/**
 * El otro camino cuando el examen da rojo: consultar en vez de rechazar.
 *
 * Con discrepancias sobre la mesa, el banco tiene dos salidas. Una es rechazar, y se cursa con el
 * MT734. La otra es avisarle las discrepancias al emisor y pedirle que autorice honrar igual —lo
 * que el artículo 16 (b) contempla cuando el emisor, a su solo juicio, consulta al ordenante por
 * una dispensa—. Ese pedido es el **MT750** y la respuesta afirmativa, el **MT752**.
 *
 * Elegir entre los dos caminos es de la persona que examina, no del motor. Lo que el motor tiene
 * que hacer es que ninguno de los dos se caiga por un largo de campo, y recordar el plazo: el
 * 16 (b) dice con todas las letras que consultar por una dispensa **no extiende** los cinco días
 * hábiles del 14 (b). Creer lo contrario es el error caro, porque cuando llega la respuesta el
 * plazo del aviso de rechazo ya venció y el 16 (f) le hace perder al banco el derecho a alegar.
 *
 * Estructura del estándar (SRU 2025), verificada contra la implementación generada de Prowide
 * (`prowide-core`, Apache 2.0):
 *
 *     MT750 — Advice of Discrepancy      MT752 — Authorisation to Pay, Accept or Negotiate
 *     20   (M)  16x                      20   (M)  16x
 *     21   (M)  16x                      21   (M)  16x
 *     32B  (M)  3!a15d                   23   (M)  de qué manera se autoriza a honrar
 *     33B  (O)                           30   (M)  6!n
 *     71D  (O)  35z × 6  gastos          32B  (O)  3!a15d
 *     73A  (O)  35z × 6                  71D  (O) · 33A/B (O) · 53a · 54a
 *     34B  (O)  3!a15d   total a pagar   72Z  (O)  35z × 6
 *     57a  (O) · 72Z (O)                 79Z  (O)  50z × 35   condiciones
 *     77J  (M)  50z × 70  LAS DISCREPANCIAS
 *
 * Los cuatro modos de honrar del campo 23 son los del artículo 6 (b) —pago a la vista, pago
 * diferido, aceptación y negociación—, que es la fuente que se pudo verificar. Las abreviaturas
 * exactas del estándar están en la documentación de pago de SWIFT: un banco que tenga el manual va
 * a querer revisarlas antes de cursar el mensaje.
 */

export interface DatosMT750 {
  /** campo 20 */
  referenciaPropia: string;
  /** campo 21: el número del crédito, que es por donde el emisor lo ubica */
  referenciaCredito: string;
  /** campo 32B */
  moneda: string;
  monto: number;
  /** campo 77J: cada discrepancia por la que se consulta */
  discrepancias: string[];
  /** campo 71D */
  gastosDeducidos?: string[];
  /** campo 34B */
  totalAPagar?: number | null;
  /** campo 72Z */
  informacion?: string[];
}

/** Las cuatro maneras en que un crédito puede ser disponible (UCP 600 art. 6 b). */
export type ModoDeHonrar = "PAGO_A_LA_VISTA" | "PAGO_DIFERIDO" | "ACEPTACION" | "NEGOCIACION";

export interface DatosMT752 {
  referenciaPropia: string;
  referenciaCredito: string;
  /** campo 23 */
  modo: ModoDeHonrar;
  /** campo 30 */
  fecha: Date;
  moneda?: string | null;
  monto?: number | null;
  /** campo 79Z: con qué condiciones se autoriza */
  condiciones?: string[];
  /** campo 72Z */
  informacion?: string[];
}

export interface MensajeSwift {
  /** el mensaje, o "" si no había nada que cursar */
  texto: string;
  /** lo que hubo que recortar o reemplazar, y lo que conviene no olvidarse */
  avisos: string[];
}

const MAX_77J_LINEAS = 70;
const MAX_77J_LARGO = 50;
const MAX_79Z_LINEAS = 35;
const MAX_79Z_LARGO = 50;

const CODIGO_MODO: Record<ModoDeHonrar, string> = {
  PAGO_A_LA_VISTA: "SIGHT PAYMENT",
  PAGO_DIFERIDO: "DEF PAYMENT",
  ACEPTACION: "ACCEPTANCE",
  NEGOCIACION: "NEGOTIATION",
};

/** Arma el bloque de campos de un mensaje, cuidando el juego de caracteres de la red. */
function armador() {
  const lineas: string[] = [];
  let hubeQueCambiar = false;
  const limpiar = (s: string) => {
    const r = aJuegoSwift(s);
    hubeQueCambiar = hubeQueCambiar || r.hubeQueCambiar;
    return r.texto;
  };
  return {
    limpiar,
    campo(tag: string, contenido: string[]) {
      if (contenido.length === 0) return;
      lineas.push(`:${tag}:${contenido[0]}`);
      for (const extra of contenido.slice(1)) lineas.push(extra);
    },
    get texto() {
      return lineas.join("\n");
    },
    get hubeQueCambiar() {
      return hubeQueCambiar;
    },
  };
}

const avisoDeCaracteres =
  "Some characters are not admitted by the SWIFT network and were replaced by their nearest equivalent: " +
  "review the text before sending it.";

export function mt750(d: DatosMT750): MensajeSwift {
  if (d.discrepancias.length === 0) return { texto: "", avisos: [] };
  const a = armador();
  const avisos: string[] = [];

  a.campo("20", [a.limpiar(d.referenciaPropia).slice(0, 16)]);
  a.campo("21", [a.limpiar(d.referenciaCredito).slice(0, 16) || "NONREF"]);
  a.campo("32B", [`${d.moneda.toUpperCase().slice(0, 3)}${importeSwift(d.monto)}`]);
  if (d.gastosDeducidos?.length) a.campo("71D", envolver(a.limpiar(d.gastosDeducidos.join("\n")), 35).slice(0, 6));
  if (d.totalAPagar != null) a.campo("34B", [`${d.moneda.toUpperCase().slice(0, 3)}${importeSwift(d.totalAPagar)}`]);
  if (d.informacion?.length) a.campo("72Z", envolver(a.limpiar(d.informacion.join("\n")), 35).slice(0, 6));

  // Numeradas por la misma razón que en el aviso de rechazo: sobre cincuenta columnas corridas no
  // se ve dónde termina una discrepancia y empieza la otra.
  const cuerpo = d.discrepancias.map((x, i) => `${i + 1}. ${a.limpiar(x)}`).join("\n");
  const lineas = envolver(cuerpo, MAX_77J_LARGO);
  if (lineas.length > MAX_77J_LINEAS) {
    avisos.push(
      `The discrepancies do not fit in field 77J: ${lineas.length - MAX_77J_LINEAS} lines over the ` +
        `${lineas.length} needed (the field takes ${MAX_77J_LINEAS}). Shorten them or consult by another route.`,
    );
  }
  a.campo("77J", lineas.slice(0, MAX_77J_LINEAS));

  /*
   * El plazo sigue corriendo, y esto no es un detalle de formato.
   *
   * El 16 (b) dice que acercarse al ordenante por una dispensa no extiende el plazo del 14 (b). Si
   * la respuesta tarda, el aviso de rechazo tiene que salir igual dentro de los cinco días hábiles:
   * de lo contrario el 16 (f) le hace perder al banco el derecho a alegar el incumplimiento, y
   * entonces la dispensa que estaba esperando ya no le hace falta a nadie.
   */
  avisos.push(
    "Asking for a waiver does not extend the period for examination: article 16 (b) says so expressly, so the " +
      "five banking days of article 14 (b) keep running. If the answer does not arrive in time, the notice of " +
      "refusal has to be sent all the same.",
  );
  if (a.hubeQueCambiar) avisos.push(avisoDeCaracteres);
  return { texto: a.texto, avisos };
}

export function mt752(d: DatosMT752): MensajeSwift {
  const a = armador();
  const avisos: string[] = [];

  a.campo("20", [a.limpiar(d.referenciaPropia).slice(0, 16)]);
  a.campo("21", [a.limpiar(d.referenciaCredito).slice(0, 16) || "NONREF"]);
  a.campo("23", [CODIGO_MODO[d.modo]]);
  a.campo("30", [yymmdd(d.fecha)]);
  if (d.moneda && d.monto != null) a.campo("32B", [`${d.moneda.toUpperCase().slice(0, 3)}${importeSwift(d.monto)}`]);
  if (d.informacion?.length) a.campo("72Z", envolver(a.limpiar(d.informacion.join("\n")), 35).slice(0, 6));

  if (d.condiciones?.length) {
    const lineas = envolver(a.limpiar(d.condiciones.join("\n")), MAX_79Z_LARGO);
    if (lineas.length > MAX_79Z_LINEAS) {
      avisos.push(
        `The conditions do not fit in field 79Z: ${lineas.length - MAX_79Z_LINEAS} lines over ` +
          `(the field takes ${MAX_79Z_LINEAS}).`,
      );
    }
    a.campo("79Z", lineas.slice(0, MAX_79Z_LINEAS));
  }

  if (a.hubeQueCambiar) avisos.push(avisoDeCaracteres);
  return { texto: a.texto, avisos };
}
