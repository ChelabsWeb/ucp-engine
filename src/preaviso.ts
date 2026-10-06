import { parseFecha } from "./fechas";
import { comparaISBP } from "./isbp";
import { diasPresentacion } from "./lc";
import { mismaMoneda } from "./numeros";
import type { LcInfo } from "./types";

/**
 * El pre-aviso contra el crédito que llegó después (UCP 600 art. 11 b).
 *
 * ── Qué dice el artículo, y qué faltaba ─────────────────────────────────────────────────────────
 * El 11 (b) tiene dos mitades. La primera ya estaba en `emision.ts`: un pre-aviso **no es** el
 * crédito operativo, así que no hay contra qué examinar documentos. La que faltaba es la que obliga
 * al emisor: «un banco emisor que manda un pre-aviso queda irrevocablemente comprometido a emitir
 * el crédito operativo, sin demora, **en términos no inconsistentes con el pre-aviso**».
 *
 * Nadie lo coteja a mano con confianza. El pre-aviso llega semanas antes, el beneficiario empieza a
 * producir con eso, y cuando llega el operativo lo que se mira es el operativo. Si bajó el monto o
 * se adelantó el vencimiento, el emisor está en falta y el beneficiario tiene un reclamo — pero hay
 * que haberlo notado, y para notarlo hay que tener los dos mensajes al lado.
 *
 * ── Las dos decisiones ──────────────────────────────────────────────────────────────────────────
 * **Agregar detalle no es contradecir.** Un pre-aviso es breve —no lleva el 46A ni el 47A— y el
 * operativo completa. Si cada campo agregado contara como inconsistencia, el control gritaría en
 * todos los casos normales y nadie lo miraría el día que haya uno de verdad. Solo se comparan los
 * campos que **los dos** traen.
 *
 * **Se informa toda inconsistencia, y aparte si perjudica.** El artículo habla de términos no
 * inconsistentes, no de términos peores: un monto mayor también es inconsistente. Pero lo que
 * decide si hay alguien con un reclamo es si el beneficiario quedó peor, y eso se dice por separado
 * en vez de mezclarlo con el veredicto.
 */

export interface InconsistenciaPreaviso {
  campo: string;
  preaviso: string;
  operativo: string;
  /** si el cambio deja al beneficiario en peor situación que la anunciada */
  peorParaElBeneficiario: boolean;
  fuente: string;
  porQue: string;
}

const FUENTE = "UCP 600 11b";

/*
 * Lo que el parser deja cuando un campo no vino no es un dato.
 *
 * El 31D es optativo en un MT705 y el parser pone «—». Contarlo como «el pre-aviso trae este campo»
 * hacía que el operativo saliera inconsistente por traer un vencimiento que nadie anunció, que es
 * exactamente lo contrario de lo que este módulo promete: agregar detalle no es contradecir.
 */
const VACIO = /^[\s—–\-.]*$/;

const texto = (v: unknown): string => {
  const t = v === null || v === undefined ? "" : String(v).trim();
  return VACIO.test(t) ? "" : t;
};

/**
 * Si el pre-aviso y el crédito operativo son el mismo crédito.
 *
 * Sin esto, `resumenPreaviso` no puede distinguir «no encontré inconsistencias» de «no había nada
 * que comparar»: el cotejo devuelve `[]` en los dos casos, y el primero es una afirmación sobre el
 * emisor mientras el segundo es la ausencia de una.
 */
export function sonElMismoCredito(preaviso: LcInfo, operativo: LcInfo): boolean {
  const a = texto(preaviso.numero).toUpperCase();
  const b = texto(operativo.numero).toUpperCase();
  /*
   * Sin número en alguno de los dos **no** son el mismo crédito: son dos mensajes sin vínculo
   * verificado.
   *
   * Devolvía `true` y la pantalla entonces afirmaba «el crédito operativo no es inconsistente con
   * lo que se pre-avisó», que es una afirmación sobre el cumplimiento del artículo 11 (b) apoyada en
   * nada. Es la misma distinción que el resto del repo: no encontrar algo no es lo mismo que no
   * haber podido mirar.
   */
  return Boolean(a) && Boolean(b) && a === b;
}

export function cotejarPreaviso(preaviso: LcInfo, operativo: LcInfo): InconsistenciaPreaviso[] {
  /*
   * Si el número no coincide, no son el mismo crédito.
   *
   * Compararlos campo por campo sería inventar un vínculo que no existe, y el resultado —una lista
   * de diferencias entre dos créditos distintos— se leería como un incumplimiento del emisor.
   */
  const a = texto(preaviso.numero).toUpperCase();
  const b = texto(operativo.numero).toUpperCase();
  if (a && b && a !== b) return [];

  const out: InconsistenciaPreaviso[] = [];
  const marcar = (campo: string, delPreaviso: string, delOperativo: string, peor: boolean, porQue: string): void => {
    out.push({
      campo,
      preaviso: delPreaviso,
      operativo: delOperativo,
      peorParaElBeneficiario: peor,
      fuente: FUENTE,
      porQue,
    });
  };

  /* el importe */
  if (preaviso.monto != null && operativo.monto != null && preaviso.monto !== operativo.monto) {
    const menos = operativo.monto < preaviso.monto;
    marcar(
      "Monto del crédito",
      `${preaviso.monto.toLocaleString("es-UY")}`,
      `${operativo.monto.toLocaleString("es-UY")}`,
      menos,
      menos
        ? "el crédito operativo es por menos de lo anunciado: el beneficiario pudo haber producido contra el monto del pre-aviso"
        : "el crédito operativo es por más de lo anunciado: es inconsistente con el pre-aviso, aunque no lo perjudica",
    );
  }

  /* la moneda: no hay «mejor» ni «peor», es otra cosa */
  if (preaviso.moneda && operativo.moneda && !mismaMoneda(operativo.moneda, preaviso.moneda)) {
    marcar(
      "Moneda del crédito",
      texto(preaviso.moneda),
      texto(operativo.moneda),
      true,
      "el crédito operativo está en otra moneda que la anunciada, y el riesgo de cambio no era el que el beneficiario tomó",
    );
  }

  /* las fechas: adelantarlas lo perjudica, extenderlas no */
  const fechas: [string, string, string, string][] = [
    [
      "Vencimiento",
      texto(preaviso.vencimiento),
      texto(operativo.vencimiento),
      "el crédito operativo vence antes de lo anunciado: el beneficiario tiene menos tiempo para presentar que el que planificó",
    ],
    [
      "Último embarque",
      texto(preaviso.limiteEmbarque),
      texto(operativo.limiteEmbarque),
      "el crédito operativo exige embarcar antes de lo anunciado: el beneficiario pudo haber programado la producción contra la fecha del pre-aviso",
    ],
  ];
  for (const [campo, delPreaviso, delOperativo, porQuePeor] of fechas) {
    if (!delPreaviso || !delOperativo || delPreaviso === delOperativo) continue;
    const f1 = parseFecha(delPreaviso);
    const f2 = parseFecha(delOperativo);
    /*
     * Sin poder leer las dos fechas no se informa nada.
     *
     * Antes se informaba la diferencia diciendo «es inconsistente, aunque no lo perjudica» — y eso
     * es justamente lo que no se sabe cuando no se pudo leer una de las dos. Afirmar que no
     * perjudica sobre un dato ilegible es peor que callarse.
     */
    if (!f1 || !f2) continue;
    const antes = f2.getTime() < f1.getTime();
    marcar(
      campo,
      delPreaviso,
      delOperativo,
      antes,
      antes
        ? porQuePeor
        : "el crédito operativo da una fecha distinta de la anunciada: es inconsistente con el pre-aviso, aunque no lo perjudica",
    );
  }

  /* el plazo de presentación: acortarlo lo perjudica */
  const p1 = diasPresentacion(preaviso.plazoPresentacion);
  const p2 = diasPresentacion(operativo.plazoPresentacion);
  if (p1 != null && p2 != null && p1 !== p2) {
    const menos = p2 < p1;
    marcar(
      "Plazo de presentación",
      `${p1} días`,
      `${p2} días`,
      menos,
      menos
        ? "el crédito operativo da menos días para presentar que los anunciados"
        : "el crédito operativo da más días para presentar que los anunciados: es inconsistente, aunque no lo perjudica",
    );
  }

  /*
   * El beneficiario: si cambió, no es el crédito que el pre-aviso anunciaba.
   *
   * Se informa como lo más grave, no como un campo más: quien produjo contra el pre-aviso no es
   * quien va a poder cobrar.
   */
  /*
   * El beneficiario se compara con el criterio de la ISBP, no letra por letra.
   *
   * Se comparaba con `===` al lado de reglas que usan `comparaISBP`, que tolera abreviaturas (A1) y
   * errores de tipeo (A23). Un punto de más en la razón social disparaba la afirmación más grave
   * del módulo: «quien produjo contra el pre-aviso no es quien va a poder cobrar».
   */
  /*
   * Lo que la ISBP tolera en un documento no alcanza para decir que dos mensajes hablan de la misma
   * empresa.
   *
   * Comparar con `===` disparaba por un punto de más en la razón social. Pasar a `comparaISBP`
   * arregló eso y abrió lo contrario: «NEW CEREALSUR S.A» **contiene** a «CEREALSUR S.A.» y salía
   * EQUIVALENTE, así que otra persona jurídica pasaba por el mismo beneficiario y el módulo callaba
   * justo donde tiene que hablar más fuerte.
   *
   * El criterio que separa los dos casos: `IGUAL` es la misma escritura normalizada —el punto, los
   * espacios— y eso sí se calla. `EQUIVALENTE` es contención y `TIPEO` es una letra de diferencia:
   * en un nombre de empresa las dos cosas cambian de quién se habla, y se informan.
   */
  const ben1 = texto(preaviso.beneficiario);
  const ben2 = texto(operativo.beneficiario);
  if (ben1 && ben2 && comparaISBP(ben1, ben2) !== "IGUAL") {
    marcar(
      "Beneficiario",
      texto(preaviso.beneficiario),
      texto(operativo.beneficiario),
      true,
      "el crédito operativo está a favor de otro beneficiario que el anunciado: quien produjo contra el pre-aviso no es quien va a poder cobrar",
    );
  }

  return out;
}

/** El resumen: si el emisor cumplió el artículo 11 (b), y a cuántos perjudica lo que no cumplió. */
export function resumenPreaviso(inconsistencias: InconsistenciaPreaviso[], comparable = true) {
  const perjudican = inconsistencias.filter((x) => x.peorParaElBeneficiario).length;
  return {
    total: inconsistencias.length,
    perjudican,
    /*
     * `comparable` separa «no encontré nada» de «no había nada que comparar».
     *
     * Con dos créditos de números distintos el cotejo devuelve `[]` —correcto, no son el mismo
     * crédito— y el resumen lo leía como «consistente». Decir que un emisor cumplió el artículo
     * 11 (b) porque le pasamos dos créditos que no se corresponden es peor que no decir nada.
     */
    comparable,
    consistente: comparable && inconsistencias.length === 0,
  };
}
