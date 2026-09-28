import type { Enmienda } from "./enmiendas";

/**
 * Qué crédito rige mientras una enmienda no se contesta (UCP 600 art. 10).
 *
 * `enmiendas.ts` dice **qué cambia** una enmienda. Esto dice la otra mitad, que es la que decide el
 * examen: **cuál de los dos créditos manda hoy**.
 *
 * La respuesta del artículo 10 (c) no es la intuitiva. El emisor queda irrevocablemente obligado
 * desde que emite la enmienda (10 b), pero para el beneficiario siguen rigiendo los términos
 * originales **hasta que comunique que la acepta**. Así que una enmienda emitida, avisada y nunca
 * contestada no cambió nada del lado del que presenta los documentos.
 *
 * Examinar contra el crédito equivocado invierte el resultado entero: documentos que cumplen pasan
 * a no cumplir, y al revés. Por eso esto no es un detalle de trámite.
 *
 * Y hay una cláusula que conviene conocer porque aparece en casi todas las enmiendas reales: «se
 * considerará aceptada salvo rechazo dentro de siete días». El artículo 10 (f) la **desestima**.
 * No la limita ni la condiciona: dice que se desestima. El riesgo es de los dos lados —el emisor
 * cree que la enmienda rige y no rige; el beneficiario cree que tiene un plazo que no existe— y
 * quien la escribió probablemente no sabe que no vale.
 */

export type EstadoEnmienda =
  /** el beneficiario no contestó */
  | "SIN_RESPUESTA"
  | "ACEPTADA"
  | "RECHAZADA"
  /** aceptó una parte y otra no, que el artículo 10 (e) trata como rechazo */
  | "ACEPTADA_EN_PARTE";

export interface ObservacionEnmienda {
  id: string;
  que: string;
  fuente: string;
  porQue: string;
}

/**
 * El crédito contra el que se examina una presentación del beneficiario.
 *
 * La aceptación parcial cuenta como rechazo (10 e), así que rige el original: no existe un crédito
 * a medio enmendar.
 */
export function creditoVigente(estado: EstadoEnmienda): "ORIGINAL" | "ENMENDADO" {
  return estado === "ACEPTADA" ? "ENMENDADO" : "ORIGINAL";
}

/** Las cláusulas del 10 (f): la enmienda entra en vigor salvo rechazo en cierto plazo. */
const CLAUSULA_TACITA =
  /(deemed|considered?|considerar[aá]|entender[aá])\s+(to\s+be\s+)?(accept|aceptad)|enter\s+into\s+force\s+unless|unless\s+(it\s+is\s+)?rejected|salvo\s+(que\s+)?(sea\s+)?rechaz|si\s+no\s+(es|fuera)\s+rechaz/i;

export function revisarEnmienda(e: Enmienda, estado: EstadoEnmienda): ObservacionEnmienda[] {
  const out: ObservacionEnmienda[] = [];
  const donde = [e.narrativa ?? "", ...(e.condicionesAdicionales ?? [])].join(" \n ");

  if (CLAUSULA_TACITA.test(donde)) {
    out.push({
      id: "ucp-10f",
      que: "La enmienda trae una cláusula de aceptación por silencio, y esa cláusula se desestima",
      fuente: "UCP 600 10f",
      porQue:
        "el artículo la deja sin efecto: la enmienda no entra en vigor por el paso del tiempo, solo si el beneficiario la acepta. Quien la escribió puede estar contando un plazo que no existe",
    });
  }

  if (estado === "ACEPTADA_EN_PARTE") {
    out.push({
      id: "ucp-10e",
      que: "Una aceptación parcial de la enmienda vale como rechazo",
      fuente: "UCP 600 10e",
      porQue: "no existe un crédito a medio enmendar: o se acepta entera o rigen los términos anteriores",
    });
  }

  /*
   * Mientras no haya respuesta, se recuerda contra qué se examina.
   *
   * Solo mientras no la haya: una nota que aparece siempre deja de leerse, y el día que importe va
   * a estar mezclada con otras veinte.
   */
  if (estado === "SIN_RESPUESTA" || estado === "ACEPTADA_EN_PARTE") {
    out.push({
      id: "ucp-10c",
      que: "Los documentos se examinan contra el crédito original, no contra el enmendado",
      fuente: "UCP 600 10c",
      porQue:
        "los términos originales siguen rigiendo para el beneficiario hasta que comunique que acepta la enmienda; el emisor sí quedó obligado desde que la emitió (10 b)",
    });
  }

  return out;
}

export interface Conformidad {
  /** la presentación cumple con el crédito tal como estaba */
  cumpleConOriginal: boolean;
  /** y también con la enmienda */
  cumpleConEnmendado: boolean;
}

/**
 * Si una presentación vale como aceptación de la enmienda (10 c, última parte).
 *
 * El artículo lo dice así: si el beneficiario no notificó nada, una presentación que cumpla **con
 * el crédito y con la enmienda todavía no aceptada** se tiene por notificación de aceptación, y
 * desde ese momento el crédito queda enmendado.
 *
 * Los dos, no uno. El caso incómodo es el del beneficiario que embarcó según la enmienda sin
 * aceptarla: contra el crédito que rige para él —el original— esos documentos no cumplen, y la
 * enmienda tampoco queda aceptada por haberlos presentado.
 */
export function aceptacionTacita(estado: EstadoEnmienda, c: Conformidad): { aceptada: boolean; porQue: string } {
  if (estado === "ACEPTADA") {
    return { aceptada: true, porQue: "el beneficiario ya había comunicado que la aceptaba" };
  }
  if (estado === "RECHAZADA") {
    return {
      aceptada: false,
      porQue: "la enmienda fue rechazada; una presentación conforme no la vuelve a poner en juego",
    };
  }
  if (c.cumpleConOriginal && c.cumpleConEnmendado) {
    return {
      aceptada: true,
      porQue:
        "sin notificación previa, una presentación que cumple con el crédito y con la enmienda vale como aceptación (UCP 600 10 c): desde ese momento el crédito queda enmendado",
    };
  }
  if (!c.cumpleConOriginal) {
    return {
      aceptada: false,
      porQue:
        "los documentos no cumplen con el crédito original, que es el que rige para el beneficiario mientras no acepte la enmienda",
    };
  }
  return {
    aceptada: false,
    porQue: "los documentos cumplen con el crédito original pero no con la enmienda, así que no la aceptan",
  };
}
