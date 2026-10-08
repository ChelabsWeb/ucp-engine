import type { TipoDocExterno } from "./consistencia";
import { mencionaDocumento, PARAMETROS_DEL_CREDITO } from "./emision";
import { avisoAseguradora } from "./lc";
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
  CERTIFICADO: "certificado",
  SEGURO: "documento de seguro",
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
      /*
       * La exigencia sale del propio ítem del 46A, no de un artículo.
       *
       * Acá se citaba el 14 (f), que dice lo contrario: regula el caso en que el crédito NO dice
       * quién emite el documento, y su efecto es permisivo —el banco lo acepta como se presenta si
       * cumple la función—. Cuando el crédito sí nombra al emisor, lo que obliga es el crédito.
       * Una cita que no se puede ir a buscar al texto vale menos que ninguna.
       */
      fuente: "46A",
      que: "Que cada certificado lo emita el organismo que el crédito nombra",
      porQue: "el nombre del emisor se lee, pero que esté habilitado para emitirlo no surge del papel",
      documentos: conEmisor.map((d) => (d.length > 60 ? `${d.slice(0, 57)}…` : d)),
    });
  }

  /*
   * ── Las condiciones del 47A que el examen no verifica ──
   *
   * El motor lee cuatro cosas del 47A —la fecha de los documentos, el número del crédito, el fee de
   * discrepancia y la tolerancia— y el resto **desaparecía**. Un crédito que pide «SHIPMENT ADVICE
   * TO BE SENT TO THE INSURERS WITHIN 5 DAYS AND A CERTIFICATE TO THIS EFFECT MUST ACCOMPANY THE
   * DOCUMENTS» no generaba ni una regla ni una nota: ni verificada ni dicha. Y una condición del
   * crédito que nadie mira es exactamente lo que después se discute.
   *
   * No todo lo que está en el 47A es una condición a cumplir: una tolerancia, un permiso de embarque
   * parcial o una autorización de transbordo **configuran** el crédito y no hay documento que las
   * acredite (arts. 30, 31, 20c). Esas se reconocen con el mismo criterio que usa `emision.ts`, para
   * no decir dos cosas distintas sobre la misma cláusula en dos pantallas.
   */
  /*
   * El aviso a la aseguradora, que se puede decir con más precisión que «hay una condición».
   *
   * `avisoAseguradora` ya parseaba el plazo, la póliza y el correo de esa cláusula del 47A —está
   * escrita para el crédito real del expediente— y **nadie la llamaba**. Con el plazo a la vista la
   * nota sirve: dice en cuántos días hay que haber avisado y qué certificado tiene que acompañar los
   * documentos, en vez de pedirle al examinador que lo lea del párrafo.
   */
  const aviso = avisoAseguradora(input.lc.condicionesAdicionales);
  if (aviso) {
    lista.push({
      id: "47a-aviso-aseguradora",
      fuente: "47A",
      que: `Que se haya avisado el embarque a la aseguradora dentro de ${aviso.dias} días y que el certificado que lo acredita esté presentado`,
      porQue:
        "el aviso se manda fuera del juego de documentos, así que el motor no puede saber si salió ni cuándo" +
        (aviso.poliza ? `; la condición nombra la póliza ${aviso.poliza}` : ""),
      documentos: todos,
    });
  }

  const sinVerificar = (input.lc.condicionesAdicionales ?? []).filter((c) => {
    // la del aviso a la aseguradora ya salió arriba, con el plazo adentro
    if (aviso && c === aviso.texto) return false;
    if (PARAMETROS_DEL_CREDITO.test(c)) return false;
    if (!mencionaDocumento(c)) return false;
    return !LAS_QUE_EL_EXAMEN_MIRA.some((re) => re.test(c));
  });
  for (const [i, c] of sinVerificar.entries()) {
    const corto = c.length > 110 ? `${c.slice(0, 107)}…` : c;
    lista.push({
      id: `47a-sin-verificar-${i}`,
      fuente: "47A",
      que: `Que se cumpla la condición del crédito: «${corto}»`,
      porQue:
        "es una condición documentaria que el motor no sabe verificar, así que no está examinada: leerla contra los papeles presentados",
      documentos: todos,
    });
  }

  return lista;
}

/**
 * Las condiciones del 47A que el examen **sí** verifica, y con qué regla.
 *
 * Están escritas acá y no importadas de `presentacion.ts` a propósito: ese módulo se sincroniza con
 * romai y no conviene darle dependencias nuevas. Lo que ata las dos listas es un test sobre el
 * crédito real, que afirma condición por condición qué le pasa a cada una: si alguien cambia un
 * patrón allá y acá no, esa condición empieza a aparecer como «sin verificar» y el test lo dice.
 */
const LAS_QUE_EL_EXAMEN_MIRA = [
  // 47A+1 del crédito real: la fecha de los documentos (regla `fecha-*`)
  /ON OR AFTER THE (LETTER OF CREDIT|L\/?C) DATE|DATED (PRIOR|BEFORE).{0,30}(LETTER OF CREDIT|L\/?C)/i,
  // 47A+2: que citen el número del crédito (regla `lc-num-*`)
  /INDICATE.{0,40}(LETTER OF CREDIT|L\/?C)\s*(NUMBER|NO)|LC NUMBER/i,
  // 47A+3: el fee de discrepancia, que sale como importe y no como regla
  /DISCREPANC(Y|IES)\s+FEE|FEE\s+OF\s+(USD|EUR|GBP)/i,
  // una autorización, no una exigencia: no hay nada que verificar
  /THIRD\s+PARTY\s+DOCUMENTS?.{0,40}ACCEPTABLE/i,
];
