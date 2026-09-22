import type { TipoDocExterno } from "./consistencia";
import type { DocAnalizado } from "./presentacion";
import type { LcInfo } from "./types";

/**
 * Lo que este motor NO puede verificar, dicho en voz alta.
 *
 * Hay discrepancias que no se resuelven leyendo campos: si una firma es auténtica, si una
 * corrección está autenticada por quien emitió el documento, si el ejemplar que tenés en la
 * mano es un original o una fotocopia. Un escaneo no alcanza para ninguna de las tres.
 *
 * El producto las lista explícitamente en cada examen en vez de callarlas. Dos razones: el
 * examinador tiene que saber qué le queda por mirar, y el día que algo se escape la
 * herramienta tiene que poder mostrar que nunca dijo haberlo revisado.
 */

export interface VerificacionManual {
  id: string;
  /** el artículo o la práctica que la exige */
  fuente: string;
  /** qué hay que mirar */
  que: string;
  /** por qué no puede hacerlo el motor */
  porQue: string;
  /** sobre qué documentos aplica en esta presentación */
  documentos: string[];
}

const NOMBRE: Record<TipoDocExterno, string> = {
  FACTURA: "factura comercial",
  PACKING: "packing list",
  BL: "conocimiento de embarque",
  LC: "carta de crédito",
};

/**
 * Las verificaciones que quedan del lado humano, acotadas a los documentos que se presentaron.
 * La lista es siempre la misma: no depende de lo que el motor haya encontrado, porque son
 * cosas que no mira nunca.
 */
export function verificacionesManuales(input: {
  lc: LcInfo;
  docs: DocAnalizado[];
  /** true si además se presentó un documento de seguro */
  haySeguro?: boolean;
}): VerificacionManual[] {
  const nombres = input.docs.map((d) => d.nombreArchivo ?? NOMBRE[d.tipo]);
  const todos = input.haySeguro ? [...nombres, "documento de seguro"] : nombres;
  if (todos.length === 0) return [];

  const transporte = input.docs.filter((d) => d.tipo === "BL").map((d) => d.nombreArchivo ?? NOMBRE[d.tipo]);
  const exigidos = input.lc.documentosExigidos ?? [];

  const lista: VerificacionManual[] = [
    {
      id: "firma-autenticidad",
      fuente: "UCP 600 3 y 17b",
      que: "Que cada documento esté firmado, sellado o autenticado por quien corresponde",
      porQue: "el motor lee el texto de la firma y el rol que declara, pero no puede juzgar si la firma es auténtica",
      documentos: todos,
    },
    {
      id: "original-vs-copia",
      fuente: "UCP 600 17b y 17c",
      que: "Que los ejemplares presentados sean originales: firma, sello o papel membretado del emisor",
      porQue: "un archivo escaneado no permite distinguir un original de una fotocopia",
      documentos: todos,
    },
    {
      id: "correcciones",
      fuente: "ISBP, principios generales",
      que: "Que toda corrección o enmienda esté autenticada por quien emitió el documento",
      porQue: "la marca de autenticación es física y suele ser manuscrita",
      documentos: todos,
    },
    {
      id: "legibilidad",
      fuente: "Práctica bancaria",
      que: "Que sellos, estampillas y anotaciones manuscritas se lean con claridad",
      porQue: "lo ilegible para una persona también lo es para el modelo, y no se puede dar por bueno",
      documentos: todos,
    },
  ];

  if (transporte.length > 0) {
    lista.push({
      id: "juego-fisico",
      fuente: "UCP 600 20a-iv",
      que: "Contar los originales del documento de transporte que efectivamente se presentan",
      porQue: "el documento declara cuántos se emitieron, pero cuántos llegaron se cuenta a mano",
      documentos: transporte,
    });
  }

  const conEmisor = exigidos.filter((d) =>
    /issued by|emitido por|chamber|c[aá]mara|authority|autoridad|veterinar|survey/i.test(d),
  );
  if (conEmisor.length > 0) {
    lista.push({
      id: "emisor-autorizado",
      fuente: "UCP 600 14f",
      que: "Que cada certificado lo emita el organismo que el crédito nombra",
      porQue: "el nombre del emisor se lee, pero que esté habilitado para emitirlo no surge del papel",
      documentos: conEmisor.map((d) => (d.length > 60 ? `${d.slice(0, 57)}…` : d)),
    });
  }

  return lista;
}
