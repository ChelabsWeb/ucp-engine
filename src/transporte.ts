import type { CamposDoc } from "./consistencia";

/**
 * De qué clase es el documento de transporte que se presentó.
 *
 * Las UCP 600 dedican siete artículos al transporte —del 19 al 25— y cada uno pide cosas distintas.
 * El motor examinaba todo con el artículo 20, el marítimo, porque era el único que conocía: a un
 * air waybill le pedía la anotación de a bordo, que un aéreo no tiene nunca, y no le pedía nada de
 * lo que el artículo 23 sí exige. Antes de aplicar una regla hay que saber cuál corresponde.
 *
 * La decisión se toma con lo que el papel dice de sí mismo, en este orden:
 *
 * 1. **La cláusula de fletamento**, si la hay y no es una negación. Un conocimiento sujeto a
 *    contrato de fletamento se examina con el artículo 22 aunque por lo demás sea marítimo, y el
 *    artículo 22 pide otra firma —capitán, armador o fletador— que el 20 no admite.
 * 2. **Cómo se titula**: «AIR WAYBILL», «SEA WAYBILL», «MULTIMODAL», «CMR». Es lo que mira un
 *    examinador primero y casi siempre alcanza.
 * 3. **La forma del número**: un air waybill lleva tres dígitos de aerolínea y ocho de serie.
 * 4. **El buque**: si hay nombre de buque y nada más dice otra cosa, es marítimo.
 *
 * Si nada de eso alcanza, se dice que no se pudo determinar. Suponer marítimo es exactamente lo que
 * el motor hacía antes, y es de donde venía el problema.
 */

export type ModoTransporte =
  | "MULTIMODAL"
  | "MARITIMO"
  | "SEA_WAYBILL"
  | "FLETAMENTO"
  | "AEREO"
  | "TERRESTRE"
  | "COURIER"
  | "SIN_DETERMINAR";

export interface ClaseDeTransporte {
  modo: ModoTransporte;
  /** en qué se basó, para poder discutirlo */
  porQue: string;
}

/** El artículo de las UCP 600 que gobierna cada clase de documento. */
export function articuloDelModo(modo: ModoTransporte): string {
  const art: Record<ModoTransporte, string> = {
    MULTIMODAL: "UCP 600 19",
    MARITIMO: "UCP 600 20",
    SEA_WAYBILL: "UCP 600 21",
    FLETAMENTO: "UCP 600 22",
    AEREO: "UCP 600 23",
    TERRESTRE: "UCP 600 24",
    COURIER: "UCP 600 25",
    SIN_DETERMINAR: "UCP 600 19 a 25",
  };
  return art[modo];
}

/** Cómo se llama cada clase, para decirlo en un hallazgo. */
export const NOMBRE_MODO: Record<ModoTransporte, string> = {
  MULTIMODAL: "documento de transporte multimodal",
  MARITIMO: "conocimiento de embarque marítimo",
  SEA_WAYBILL: "sea waybill no negociable",
  FLETAMENTO: "conocimiento sujeto a contrato de fletamento",
  AEREO: "documento de transporte aéreo",
  TERRESTRE: "documento de transporte por carretera, ferrocarril o vía navegable",
  COURIER: "recibo de courier o de correo",
  SIN_DETERMINAR: "documento de transporte de clase no determinada",
};

const texto = (c: CamposDoc, k: keyof CamposDoc): string => {
  const campo = c[k] as { valor?: string } | undefined;
  return (campo?.valor ?? "").trim();
};

/**
 * Una cláusula de fletamento que niega estarlo no es una cláusula de fletamento.
 *
 * Muchos conocimientos imprimen «not subject to any charter party» justamente para dejarlo claro.
 * Leerlo al revés manda el documento al artículo 22, que pide una firma distinta, y el examen
 * entero sale mal.
 */
function sujetoAFletamento(valor: string): boolean {
  if (!valor) return false;
  return !/\bno\b|\bnot\b|\bsin\b|\bnon\b/i.test(valor);
}

export function modoDelDocumento(campos: CamposDoc): ClaseDeTransporte {
  const charter = texto(campos, "charterParty");
  if (sujetoAFletamento(charter)) {
    return { modo: "FLETAMENTO", porQue: `el documento dice «${charter.slice(0, 60)}»` };
  }

  const titulo = texto(campos, "tipoTransporte");
  const t = titulo.toUpperCase();
  if (t) {
    // El orden importa: «COMBINED TRANSPORT BILL OF LADING» es multimodal, no marítimo, así que lo
    // que nombra dos modos se decide antes de mirar si dice «bill of lading».
    if (/MULTIMODAL|COMBINED TRANSPORT|INTERMODAL|THROUGH BILL/.test(t))
      return { modo: "MULTIMODAL", porQue: `se titula «${titulo}»` };
    if (/AIR ?WAY ?BILL|\bAWB\b|AIR CONSIGNMENT|AIR TRANSPORT/.test(t))
      return { modo: "AEREO", porQue: `se titula «${titulo}»` };
    if (/SEA ?WAY ?BILL|NON.?NEGOTIABLE SEA/.test(t)) return { modo: "SEA_WAYBILL", porQue: `se titula «${titulo}»` };
    if (/\bCMR\b|CONSIGNMENT NOTE|CARTA DE PORTE|RAIL|TRUCK|ROAD|WAYBILL RAIL|INLAND WATERWAY/.test(t))
      return { modo: "TERRESTRE", porQue: `se titula «${titulo}»` };
    if (/COURIER|POST RECEIPT|CERTIFICATE OF POSTING|EXPRESS RECEIPT/.test(t))
      return { modo: "COURIER", porQue: `se titula «${titulo}»` };
    if (/BILL OF LADING|CONOCIMIENTO/.test(t)) return { modo: "MARITIMO", porQue: `se titula «${titulo}»` };
  }

  // Un air waybill se numera con tres dígitos de aerolínea y ocho de serie: «020-12345678».
  const numero = texto(campos, "numeroDoc");
  if (/^\d{3}[\s-]?\d{8}$/.test(numero.replace(/\s/g, " ").trim())) {
    return { modo: "AEREO", porQue: `el número «${numero}» tiene la forma de un air waybill` };
  }

  const buque = texto(campos, "buque");
  if (buque) return { modo: "MARITIMO", porQue: `nombra un buque, «${buque}»` };

  // Los lugares también hablan: un aéreo sale de un aeropuerto y un marítimo de un puerto.
  const lugares = `${texto(campos, "puertoEmbarque")} ${texto(campos, "puertoDestino")}`.trim();
  if (/AIRPORT|AEROPUERTO|\bAPT\b/i.test(lugares)) {
    return { modo: "AEREO", porQue: `los lugares son aeropuertos: «${lugares.slice(0, 60)}»` };
  }
  if (/\bPORT\b|PUERTO/i.test(lugares)) {
    return { modo: "MARITIMO", porQue: `los lugares son puertos: «${lugares.slice(0, 60)}»` };
  }

  return {
    modo: "SIN_DETERMINAR",
    porQue: "no se pudo determinar de qué clase es: no se leyó cómo se titula, ni un buque, ni los lugares",
  };
}
