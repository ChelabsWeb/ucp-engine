import type { CamposDoc } from "./consistencia";
import { CAMPOS_POR_TIPO } from "./consistencia";
import type { EstadoRegla } from "./presentacion";

/**
 * El canal de reglas: convertir un texto de reglamento en una regla revisable.
 *
 * Las reglas de este motor se escribieron leyendo la publicación, una por una, y así no se llega:
 * la ISBP 821 tiene cientos de párrafos, las Opiniones de la Banking Commission van por la TA968 y
 * están además la ISP98 y las URDG. Escribirlas a mano es el cuello de botella, y escribirlas de
 * memoria está prohibido en este repositorio por buenos motivos.
 *
 * La salida de este canal **no es código**. Es una propuesta que una persona revisa y recién
 * después se implementa. Lo que hace este módulo es decidir si una propuesta **se puede revisar**,
 * que es distinto de si es correcta: lo segundo lo decide quien la lea.
 *
 * ## Las cinco cosas que una propuesta tiene que traer
 *
 * 1. **La cita textual**, que tiene que aparecer **palabra por palabra en el texto fuente**. Es la
 *    defensa contra la invención: un modelo que se inventa un párrafo de la ISBP no pasa de acá.
 * 2. **De dónde sale**: el reglamento y el párrafo.
 * 3. **Qué campos lee**, y tienen que ser campos que el motor extrae de verdad.
 * 4. **Un ejemplo que la dispara y uno que NO.** Una propuesta sin contraejemplo no se puede
 *    revisar: quien la lea no tiene cómo ver dónde está el borde. Es la misma regla que este
 *    repositorio aplica a sus controles — sin un mutante que lo ponga rojo, no es un control.
 * 5. **Un veredicto que el producto pueda defender.** Una regla cuya conclusión es una
 *    probabilidad no entra: el motor dice qué encontró y cita el artículo, y «es probable que»
 *    no se cita.
 */

export interface EjemploDeRegla {
  /** qué dicen los papeles, en los campos que la regla lee */
  dado: Partial<Record<keyof CamposDoc, string>>;
  /** qué tiene que concluir la regla con eso */
  estado: EstadoRegla;
  /** por qué, en una línea, para que quien revise pueda discutirlo */
  porQue: string;
}

export interface PropuestaDeRegla {
  /** el identificador que tendría en el motor */
  id: string;
  /** de qué reglamento sale: "UCP 600", "ISBP 821", "ICC TA957rev"… */
  reglamento: string;
  /** qué párrafo o artículo */
  parrafo: string;
  /** la cita, palabra por palabra como está en el texto fuente */
  cita: string;
  /** qué afirma la regla, en una oración */
  afirma: string;
  /** qué campos del documento necesita leer */
  campos: (keyof CamposDoc)[];
  /** al menos uno que la dispara y uno que no */
  ejemplos: EjemploDeRegla[];
}

export interface Reparo {
  que: string;
  porQue: string;
}

/** Todos los campos que el motor sabe extraer, derivados del esquema y no de una lista a mano. */
const CAMPOS_CONOCIDOS = new Set<string>(Object.values(CAMPOS_POR_TIPO).flat() as string[]);

/**
 * Normaliza para comparar una cita contra su fuente.
 *
 * Un texto copiado de un PDF trae comillas curvas, guiones largos, saltos de línea en mitad de una
 * oración y espacios dobles. Exigir una coincidencia byte por byte haría que toda cita legítima
 * fallara, y aflojar hasta ignorar las palabras haría inútil el control. El punto medio: se
 * comparan las palabras y se ignora cómo están separadas y acentuadas las comillas.
 */
function paraComparar(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[‘’“”«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Las palabras que delatan una conclusión que el producto no puede defender.
 *
 * No es censura de vocabulario: es que una regla que concluye «probablemente» o «parece» no se
 * puede sostener con un artículo en la mano, y este motor no afirma nada que no pueda defender así.
 * Una propuesta con esto adentro está mal planteada, no mal escrita.
 */
const PROBABILISTICO =
  /\b(probable|probablemente|likely|posiblemente|parecer[ií]a|sospechos[oa]|estimar|aproximadamente|suele|generalmente)\b/i;

/**
 * ¿Esta propuesta se puede revisar?
 *
 * Devuelve los reparos. Vacío quiere decir que está en condiciones de que una persona la lea y
 * decida — **no** que sea correcta. Eso no lo puede decidir una función.
 */
export function revisarPropuesta(p: PropuestaDeRegla, textoFuente: string): Reparo[] {
  const reparos: Reparo[] = [];

  if (!p.id?.trim())
    reparos.push({ que: "sin identificador", porQue: "una regla sin id no se puede nombrar en un hallazgo" });
  if (!p.reglamento?.trim() || !p.parrafo?.trim()) {
    reparos.push({
      que: "sin fuente",
      porQue: "cada hallazgo de este motor dice de dónde sale, y una regla sin párrafo no puede decirlo",
    });
  }

  /* La defensa contra la invención, y la razón de ser de todo esto. */
  if (!p.cita?.trim()) {
    reparos.push({ que: "sin cita", porQue: "sin el texto no hay con qué comprobar que la regla dice lo que dice" });
  } else if (!paraComparar(textoFuente).includes(paraComparar(p.cita))) {
    reparos.push({
      que: `la cita no está en el texto fuente: «${p.cita.slice(0, 70)}…»`,
      porQue:
        "o la propuesta inventó el párrafo, o lo parafraseó. Las dos cosas rompen lo único que hace defendible un hallazgo: poder ir a buscarlo al reglamento",
    });
  }

  if (!p.afirma?.trim()) {
    reparos.push({ que: "no dice qué afirma", porQue: "sin eso no se puede discutir si la regla está bien planteada" });
  } else if (PROBABILISTICO.test(p.afirma)) {
    reparos.push({
      que: `lo que afirma es probabilístico: «${p.afirma.slice(0, 70)}»`,
      porQue:
        "una conclusión que es una probabilidad no se sostiene citando un artículo. Si el texto da para eso y no para más, la regla tiene que salir a verificar, no concluir",
    });
  }

  const desconocidos = (p.campos ?? []).filter((c) => !CAMPOS_CONOCIDOS.has(c as string));
  if ((p.campos ?? []).length === 0) {
    reparos.push({ que: "no dice qué campos lee", porQue: "sin eso no se sabe si el motor tiene con qué aplicarla" });
  } else if (desconocidos.length > 0) {
    reparos.push({
      que: `pide campos que el motor no extrae: ${desconocidos.join(", ")}`,
      porQue:
        "agregar un campo al esquema no es gratis: tiene un tope medido contra la API y pasarlo rompe la lectura de escaneos entera. La propuesta tiene que decir que hace falta, no darlo por hecho",
    });
  }

  /* Lo que hace revisable a una propuesta: dónde está el borde. */
  const ejemplos = p.ejemplos ?? [];
  const dispara = ejemplos.filter((e) => e.estado !== "OK");
  const noDispara = ejemplos.filter((e) => e.estado === "OK");
  if (dispara.length === 0) {
    reparos.push({
      que: "ningún ejemplo la dispara",
      porQue: "una regla que nadie vio concluir algo no se puede revisar",
    });
  }
  if (noDispara.length === 0) {
    reparos.push({
      que: "ningún contraejemplo",
      porQue:
        "sin un caso que la regla NO marque, quien revisa no tiene cómo ver dónde está el borde — y una regla sin borde marca de más, que en este producto es el error caro",
    });
  }

  for (const e of ejemplos) {
    const fuera = Object.keys(e.dado ?? {}).filter((c) => !(p.campos ?? []).includes(c as keyof CamposDoc));
    if (fuera.length > 0) {
      reparos.push({
        que: `un ejemplo usa campos que la regla no declaró leer: ${fuera.join(", ")}`,
        porQue: "si el ejemplo necesita un dato que la regla no pidió, una de las dos cosas está mal",
      });
    }
  }

  return reparos;
}
