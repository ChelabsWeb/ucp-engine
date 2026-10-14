import type { LcInfo } from "./types";

/**
 * Un standby no es un crédito comercial, y examinarlo como si lo fuera dice cosas falsas.
 *
 * Reproducido antes de escribir esto: pegando un standby de garantía de cumplimiento, el motor
 * afirmaba **`[OK] UCP 600 30b · Sin tolerancia en el crédito, la cantidad admite ±5 %`**. El
 * artículo 30 (b) es sobre cantidad de mercadería, y este crédito no garantiza una carga: garantiza
 * que una constructora cumpla un contrato de obra. El motor decía «cumple» sobre algo que no
 * existe, que es peor que no decir nada.
 *
 * ## Qué se puede afirmar sin tener la ISP98
 *
 * **No tenemos el texto de la ISP98** (publicación 590 de la ICC), y escribir reglas de examen de
 * standby de memoria sería inventar la práctica bancaria que falta — lo que este repositorio tiene
 * prohibido y ya decidió una vez, con la ISBP. Así que este módulo **no examina un standby**: dice
 * con qué lo está midiendo y qué de eso no corresponde.
 *
 * Lo que sí está verificado y alcanza para eso:
 *
 * - **El artículo 1 de las UCP 600** las declara aplicables a cualquier crédito documentario
 *   «incluyendo, en la medida en que puedan ser aplicables, cualquier carta de crédito standby».
 *   O sea: las UCP pueden regir un standby, pero solo hasta donde sean aplicables, y decidir hasta
 *   dónde es precisamente lo que no se puede hacer a ciegas.
 * - **Un standby no mueve mercadería.** Garantiza el incumplimiento de una obligación, y los
 *   documentos que pide son típicamente una declaración de incumplimiento y una copia del
 *   requerimiento. Las reglas de cantidad (art. 30), transporte (19 a 27), seguro (28) y
 *   descripción de la mercadería (18 c) no tienen a qué aplicarse.
 * - **Si el campo 40E nombra la ISP98 o las URDG**, el reglamento que rige no es el que este motor
 *   implementa. Eso no es un matiz: son cuerpos de reglas distintos.
 */

/** ¿El crédito es un standby? Sale del 40A, y de rebote del reglamento que nombre el 40E. */
export function esStandby(input: { formaCredito?: string | null; reglasAplicables?: string | null }): boolean {
  const forma = (input.formaCredito ?? "").toUpperCase();
  const reglas = (input.reglasAplicables ?? "").toUpperCase();
  /* «ISP» sin más es el reglamento de los standby: un crédito comercial no lo nombra nunca. */
  return /\bSTANDBY\b/.test(forma) || /\bSTANDBY\b/.test(reglas) || /\bISP\b/.test(reglas);
}

/** Qué reglamento dice regir el crédito, cuando nombra uno que no son las UCP. */
export function reglamentoAjeno(reglasAplicables?: string | null): "ISP98" | "URDG" | null {
  const r = (reglasAplicables ?? "").toUpperCase();
  if (/\bISP\b/.test(r)) return "ISP98";
  if (/\bURDG\b/.test(r)) return "URDG";
  return null;
}

export interface LimiteStandby {
  id: string;
  fuente: string;
  que: string;
  porQue: string;
}

/**
 * Lo que este examen **no** puede decir de un standby, dicho antes de que alguien lo lea mal.
 *
 * No son discrepancias ni hallazgos: son los límites del examen, y van arriba de todo porque
 * cambian cómo se lee lo que sigue. Un examinador que abre un resultado sin esto puede tomar un
 * «no encontré discrepancias» por una conformidad, cuando lo que pasa es que el motor midió con
 * la regla equivocada.
 */
export function limitesDelStandby(lc: LcInfo, reglasAplicables?: string | null): LimiteStandby[] {
  const out: LimiteStandby[] = [];
  const ajeno = reglamentoAjeno(reglasAplicables);

  if (ajeno) {
    out.push({
      id: "sb-reglamento",
      fuente: "campo 40E",
      que: `El crédito se declara sujeto a ${ajeno === "ISP98" ? "la ISP98" : "las URDG"}, que este examen no implementa`,
      /* Una sola plantilla: los fragmentos concatenados se traducen a medias. */
      porQue: `el campo 40E dice "${(reglasAplicables ?? "").trim()}" y este motor mide con las UCP 600, que son otro cuerpo de reglas`,
    });
  } else {
    out.push({
      id: "sb-ucp-en-lo-aplicable",
      fuente: "UCP 600 1",
      que: "Las UCP rigen un standby solo «en la medida en que puedan ser aplicables»",
      porQue:
        "esa medida no la fija el reglamento sino quien examina, y este examen desactivó lo que no tiene a qué aplicarse",
    });
  }

  out.push({
    id: "sb-sin-mercaderia",
    fuente: "UCP 600 1",
    que: "Un standby no mueve mercadería, así que las reglas de la carga quedan desactivadas",
    porQue:
      "quedan afuera la cantidad del artículo 30, el transporte de los artículos 19 a 27, el seguro del 28 y la descripción de la mercadería del 18 (c)",
  });

  if (lc.limiteEmbarque || lc.plazoPresentacion) {
    out.push({
      id: "sb-sin-embarque",
      fuente: "campos 44C y 48",
      que: "El crédito trae plazos atados a un embarque que un standby no tiene",
      porQue:
        "el 44C fija un último embarque y el 48 cuenta desde la fecha de embarque, y acá no hay embarque del que contar",
    });
  }

  return out;
}

/**
 * ¿Este artículo tiene algo a qué aplicarse en un standby?
 *
 * Se decide por el artículo que la regla cita y no por su identificador: el identificador es una
 * convención nuestra y puede cambiar, el artículo es el que manda. Los que quedan afuera son los
 * que presuponen una carga que se embarca:
 *
 * - **18 (c)**: la descripción de la mercadería en la factura.
 * - **19 a 28**: los siete artículos del transporte y el del seguro.
 * - **30**: la cantidad, su tolerancia y el tope del crédito por cantidad.
 *
 * Lo que sí sigue corriendo: los plazos, el examen de los documentos que el crédito sí pide, la
 * obligación del banco según su papel, el artículo 16 y el 14 en lo que no habla de mercadería.
 */
export function noAplicaAStandby(fuente: string): boolean {
  const m = /^UCP 600\s+(\d{1,2})/.exec(fuente.trim());
  if (!m) return false;
  const art = Number(m[1]);
  if (art === 30) return true;
  if (art >= 19 && art <= 28) return true;
  /* El 18 solo en su inciso (c), que es la descripción de la mercadería: el (a) —factura a nombre
     del ordenante, emitida por el beneficiario, en la moneda del crédito— aplica igual. */
  return /^UCP 600\s+18\s*c/i.test(fuente.trim());
}
