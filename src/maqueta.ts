import type { CamposDoc } from "./consistencia";
import { TIPO_DOC_LABEL } from "./consistencia";
import { parseFecha } from "./fechas";
import type { DocAnalizado, ReglaPresentacion } from "./presentacion";

/**
 * Valores que no tienen la forma de su campo: la maqueta del documento se corrió.
 *
 * Sale de una observación real. En la presentación de AMS2026164 el examinador escribió
 * «Caliset x 4: information de Qty, Port of loading, Port of discharge, ship. Date, BL nr. Y
 * shipper quedó corrida - VER»: los cuatro certificados de análisis estaban maquetados en dos
 * columnas y los valores quedaron desplazados un renglón contra sus etiquetas. Debajo de «Port
 * of loading» había una fecha; debajo de «Ship. date», un puerto.
 *
 * Contra el crédito no se ve —el crédito no dice qué FORMA tiene cada valor— y contra la hoja
 * haría falta la posición de cada caja. Pero desde el texto ya extraído sí se ve: un puerto que
 * es una fecha, una fecha sin una sola cifra, una cantidad sin números, un nombre que es un
 * número. Es la única de las observaciones del banco que el motor no podía ver.
 *
 * Dos decisiones que lo hacen útil en vez de ruidoso:
 *
 * - solo lo **inequívoco**: un puerto con número de muelle, una mercadería con su código y una
 *   fecha escrita «SHIPPED ON BOARD 08-APR-2025» pasan. Lo que se marca es un valor que es
 *   exactamente otra cosa;
 * - **ATENCIÓN y no DISCREPANCIA**: puede ser la lectura y no el papel, y afirmar una falta a
 *   partir de una lectura dudosa es el falso positivo que este motor no se permite. Por lo mismo,
 *   un campo leído con poca confianza no se denuncia: ya hay un aviso para esa duda.
 */

export interface ValorCorrido {
  campo: keyof CamposDoc;
  /** cómo se llama el campo en la matriz, para que el renglón se pueda buscar en el papel */
  etiqueta: string;
  valor: string;
  motivo: string;
}

/** Por debajo de esto, lo que falló puede ser la lectura y no el papel. */
const CONFIANZA_MINIMA = 0.6;

/** Una fecha y nada más: «04/07/2026», «2026-07-04», «04-JUL-2026». */
const SOLO_FECHA = /^\s*(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{1,2}[-\s][A-Za-z]{3,10}[-\s]\d{2,4})\s*\.?\s*$/;
/** Un número y nada más: «185010», «54.040,00», «1.360». */
const SOLO_NUMERO = /^\s*[\d.,\s]+\s*$/;
const TIENE_CIFRAS = /\d/;

/** Qué forma se espera de cada campo. Solo los que tienen una forma clara entran. */
const FORMA: Partial<Record<keyof CamposDoc, "fecha" | "texto" | "numero">> = {
  fechaEmbarque: "fecha",
  fechaDocumento: "fecha",
  fechaSeguro: "fecha",
  puertoEmbarque: "texto",
  puertoDestino: "texto",
  exportador: "texto",
  importador: "texto",
  emisor: "texto",
  buque: "texto",
  mercaderia: "texto",
  coberturaDesde: "texto",
  coberturaHasta: "texto",
  cantidad: "numero",
  bultos: "numero",
  pesoBruto: "numero",
  montoTotal: "numero",
  montoAsegurado: "numero",
};

const ETIQUETA: Partial<Record<keyof CamposDoc, string>> = {
  fechaEmbarque: "Fecha de embarque",
  fechaDocumento: "Fecha del documento",
  fechaSeguro: "Fecha del seguro",
  puertoEmbarque: "Puerto de embarque",
  puertoDestino: "Puerto de destino",
  exportador: "Exportador",
  importador: "Importador",
  emisor: "Emisor",
  buque: "Buque",
  mercaderia: "Mercadería",
  coberturaDesde: "Cobertura desde",
  coberturaHasta: "Cobertura hasta",
  cantidad: "Cantidad",
  bultos: "Bultos",
  pesoBruto: "Peso bruto",
  montoTotal: "Monto total",
  montoAsegurado: "Monto asegurado",
};

export function valoresQueNoParecenSuCampo(campos: CamposDoc): ValorCorrido[] {
  const out: ValorCorrido[] = [];
  for (const [clave, forma] of Object.entries(FORMA) as [keyof CamposDoc, "fecha" | "texto" | "numero"][]) {
    const c = campos[clave];
    const valor = c?.valor?.trim();
    /* Vacío es «no se leyó», que no es lo mismo que «está corrido»: no se dice nada. */
    if (!valor || !c || c.confianza < CONFIANZA_MINIMA) continue;

    let motivo: string | null = null;
    if (forma === "fecha" && !TIENE_CIFRAS.test(valor)) {
      motivo = "no tiene una sola cifra: no es una fecha";
    } else if (forma === "texto" && (SOLO_FECHA.test(valor) || parseFechaSola(valor))) {
      motivo = "es una fecha";
    } else if (forma === "texto" && SOLO_NUMERO.test(valor)) {
      motivo = "es un número";
    } else if (forma === "numero" && !TIENE_CIFRAS.test(valor)) {
      motivo = "no tiene una sola cifra: no es una cantidad";
    }
    if (motivo) out.push({ campo: clave, etiqueta: ETIQUETA[clave] ?? String(clave), valor, motivo });
  }
  return out;
}

/** `parseFecha` busca la fecha ADENTRO del texto; acá importa que el valor SEA una fecha. */
function parseFechaSola(valor: string): boolean {
  return SOLO_FECHA.test(valor) && parseFecha(valor) !== null;
}

/**
 * Una regla por documento con valores corridos, nombrando los campos para que el operador
 * sepa qué renglón mirar en la hoja.
 */
export function reglasDeMaqueta(docs: DocAnalizado[]): ReglaPresentacion[] {
  const out: ReglaPresentacion[] = [];
  for (const d of docs) {
    const corridos = valoresQueNoParecenSuCampo(d.campos);
    if (!corridos.length) continue;
    const quien = d.nombreArchivo || TIPO_DOC_LABEL[d.tipo];
    out.push({
      id: `maqueta-${(d.nombreArchivo || d.tipo).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      fuente: "Práctica bancaria",
      regla: `${quien}: hay valores que no tienen la forma de su campo`,
      estado: "ATENCION",
      evidencia: `${corridos
        .map((c) => `${c.etiqueta} dice «${c.valor}» y ${c.motivo}`)
        .join(
          "; ",
        )}. En un documento maquetado en columnas esto es la señal de que los valores quedaron corridos contra la etiqueta de al lado — hay que mirar la hoja. Es lo que el banco observó de los certificados en AMS2026164.`,
    });
  }
  return out;
}
