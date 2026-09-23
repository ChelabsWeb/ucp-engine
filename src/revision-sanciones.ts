import type { Coincidencia } from "./sanciones";

/**
 * Volver a screenear lo que sigue abierto.
 *
 * Es el quinto momento de `MOMENTOS_DE_SCREENING` y el único que no se dispara solo: «de nuevo
 * sobre las operaciones abiertas cada vez que se actualizan las listas». Las listas cambian todos
 * los días y una presentación examinada hace un mes puede tener una parte que entró ayer. Nadie se
 * entera salvo que se vuelva a mirar.
 *
 * Lo que este módulo decide es **cuándo hace falta** y **qué cambió**. Bajar las listas y guardar
 * la corrida nueva es trabajo de la aplicación.
 */

/** Cómo se identifica una coincidencia para saber si es la misma de antes. */
function identidad(c: Coincidencia): string {
  return [c.parte.rol, c.parte.valor.trim().toUpperCase(), c.fuente, c.entradaId].join("|");
}

export interface CambioDeScreening {
  /** las que no estaban en la corrida anterior: esto es lo que hay que mirar */
  nuevas: Coincidencia[];
  /** las que estaban y ya no: una entrada removida de la lista, o un dato que cambió */
  desaparecidas: Coincidencia[];
  /** las que siguen igual */
  siguen: Coincidencia[];
}

/**
 * Qué cambió entre dos corridas.
 *
 * Las **nuevas** son el resultado que importa: una parte que no figuraba y ahora sí. Las
 * desaparecidas se informan pero no se descartan solas —que una entrada ya no esté en la lista de
 * hoy no borra lo que se decidió con la lista de ayer— y por eso el registro anterior no se toca.
 */
export function compararScreenings(antes: Coincidencia[], ahora: Coincidencia[]): CambioDeScreening {
  const idsAntes = new Set(antes.map(identidad));
  const idsAhora = new Set(ahora.map(identidad));
  return {
    nuevas: ahora.filter((c) => !idsAntes.has(identidad(c))),
    desaparecidas: antes.filter((c) => !idsAhora.has(identidad(c))),
    siguen: ahora.filter((c) => idsAntes.has(identidad(c))),
  };
}

export interface ListaConsultada {
  fuente: string;
  publicada: string;
}

export type MotivoRevision = "LISTA_NUEVA" | "NO_SE_CONSULTO" | "NUNCA_SE_SCREENEO";

export interface Revision {
  hayQueRevisar: boolean;
  motivos: { fuente: string; motivo: MotivoRevision; detalle: string }[];
}

/**
 * ¿Hace falta volver a screenear esta presentación?
 *
 * Tres razones, y las tres importan por separado:
 *
 * - **La lista se actualizó** desde la última corrida. Es el caso normal.
 * - **Una lista no se pudo consultar** entonces y ahora sí. Aquella corrida no dijo nada sobre esa
 *   lista, así que no hay nada que comparar: hay que mirarla por primera vez.
 * - **Nunca se screeneó.** Sin corrida previa no hay «cambio», hay una omisión.
 *
 * Las fechas de publicación se comparan como texto porque cada lista la escribe a su manera —OFAC
 * pone «09/18/2026» y el Reino Unido «21-Sep-2026»— y no hay que entenderlas para saber que son
 * distintas. Distinta es distinta, y eso alcanza para volver a mirar.
 */
export function revisionNecesaria(antes: ListaConsultada[] | null, ahora: ListaConsultada[]): Revision {
  if (antes === null) {
    return {
      hayQueRevisar: true,
      motivos: ahora.map((l) => ({
        fuente: l.fuente,
        motivo: "NUNCA_SE_SCREENEO" as const,
        detalle: `nunca se screeneó contra ${l.fuente}`,
      })),
    };
  }

  const previas = new Map(antes.map((l) => [l.fuente, l.publicada]));
  const motivos: Revision["motivos"] = [];

  for (const l of ahora) {
    const antesPublicada = previas.get(l.fuente);
    if (antesPublicada === undefined) {
      motivos.push({
        fuente: l.fuente,
        motivo: "NO_SE_CONSULTO",
        detalle: `${l.fuente} no se pudo consultar en la corrida anterior`,
      });
    } else if (antesPublicada !== l.publicada) {
      motivos.push({
        fuente: l.fuente,
        motivo: "LISTA_NUEVA",
        detalle: `${l.fuente} pasó de ${antesPublicada} a ${l.publicada}`,
      });
    }
  }

  return { hayQueRevisar: motivos.length > 0, motivos };
}
