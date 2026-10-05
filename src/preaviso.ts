import { parseFecha } from "./fechas";
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

const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

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
    // sin poder leer las dos fechas no se dice cuál es peor, pero la diferencia se informa igual
    const antes = f1 && f2 ? f2.getTime() < f1.getTime() : false;
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
  const ben1 = texto(preaviso.beneficiario).toUpperCase();
  const ben2 = texto(operativo.beneficiario).toUpperCase();
  if (ben1 && ben2 && ben1 !== ben2) {
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
export function resumenPreaviso(inconsistencias: InconsistenciaPreaviso[]) {
  const perjudican = inconsistencias.filter((x) => x.peorParaElBeneficiario).length;
  return { total: inconsistencias.length, perjudican, consistente: inconsistencias.length === 0 };
}
