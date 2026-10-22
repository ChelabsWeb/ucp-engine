/**
 * Etapa 2 (PRD §5) — validación y consistencia. El diferencial del producto:
 * el operador trae un documento externo (factura del proveedor, LC, packing),
 * la IA extrae los campos comparables (RF-2.2, con confianza por campo) y este
 * motor los compara CAMPO A CAMPO contra la operación (RF-2.3) para levantar
 * discrepancias tipificadas (RF-2.5).
 *
 * El motor es PURO y determinista: la IA solo extrae texto; la comparación y el
 * veredicto los decide acá (así se testea sin la IA y el resultado es auditable).
 */

import { parseFecha } from "./fechas";
import { diasPresentacion, parseTolerancia, TOLERANCIA_DEFAULT, toleranciaDe, toleranciaDeImporte } from "./lc";
import type {
  ChecklistRow,
  Discrepancy,
  Empresa,
  LcInfo,
  MatrixCell,
  MatrixMark,
  MatrixRow,
  MatrixVerdict,
  OperationDetail,
  Severity,
} from "./types";

/**
 * Los documentos que el producto sabe leer y comparar.
 *
 * Los cuatro primeros tienen columna propia en la matriz y su juego de campos. `CERTIFICADO` es
 * distinto y por eso va último: lo que lo define no es un tipo sino **qué línea del 46A satisface**,
 * y esa línea es texto del crédito. Son los otros siete papeles del crédito real —origen, análisis,
 * fumigación, veterinario, nota de peso y los del propio beneficiario—, los que llegan de terceros y
 * se reenvían sin mirar. Se examinan con `reglasCertificados`, apareados con su exigencia.
 */
export type TipoDocExterno = "FACTURA" | "LC" | "PACKING" | "BL" | "CERTIFICADO" | "SEGURO";

export const TIPO_DOC_LABEL: Record<TipoDocExterno, string> = {
  FACTURA: "Factura comercial",
  LC: "Carta de crédito",
  PACKING: "Packing list",
  BL: "Bill of lading",
  CERTIFICADO: "Certificado del 46A",
  SEGURO: "Documento de seguro",
};

/**
 * A qué columna de la matriz aporta cada tipo de documento.
 *
 * Un certificado no aporta a ninguna: la matriz compara los cuatro documentos que el crédito pide
 * con campos equivalentes —quién exporta, cuánto, a qué puerto— y un certificado de fumigación no
 * tiene nada de eso que comparar. Se examina aparte, con `reglasCertificados`, contra la línea del
 * 46A que satisface.
 */
const COLUMNA_DE_TIPO: Record<TipoDocExterno, "lc" | "invoice" | "packing" | "bl" | null> = {
  FACTURA: "invoice",
  LC: "lc",
  PACKING: "packing",
  BL: "bl",
  CERTIFICADO: null,
  /*
   * El seguro tampoco: se examina con el artículo 28, que no se parece a nada de la matriz.
   *
   * Lo que se le mira es quién lo emite —una compañía de seguros o su agente, nunca un bróker—,
   * que no esté fechado después del embarque, que vaya en la moneda del crédito, que cubra al menos
   * el 110 % del valor CIF y que el tramo cubierto vaya del puerto de carga al de descarga. Nada de
   * eso es «el mismo campo en dos papeles», que es lo único que la matriz sabe hacer.
   */
  SEGURO: null,
};

/** Un campo extraído por la IA: el valor tal cual aparece + su confianza 0..1. */
export interface CampoDoc {
  valor: string;
  confianza: number;
}

/** RF-2.6: cómo se resolvió una discrepancia (trazabilidad: acción + cuándo). */
export interface ResolucionDiscrepancia {
  discrepanciaId: string;
  accion: "CORREGIDO" | "FALSO_POSITIVO";
  resueltoEn: string;
}

/** Un documento externo ya analizado y guardado en la operación (RF-2.1/2.6). */
export interface DocExternoGuardado {
  id: string;
  tipo: TipoDocExterno;
  /**
   * La línea del 46A que este papel satisface, para los certificados.
   *
   * Es lo que los ata a lo que el banco va a pedir: sin ella el motor no sabe quién tiene que
   * emitirlo —el crédito lo nombra— ni si la fecha tiene que ser previa al embarque. Los cuatro
   * documentos con columna propia no la necesitan: su exigencia se deduce del tipo.
   */
  exigencia?: string | null;
  nombreArchivo: string;
  storagePath: string | null;
  /**
   * Qué documento reemplazó a éste, cuando el banco lo observó y el emisor reemitió.
   *
   * El reemplazado no entra al examen —se filtra antes— pero queda como traza de qué se presentó
   * y qué observaron. En el expediente real fueron cuatro de los once certificados, cada uno
   * declarándolo en su cara: «This certificate replaces the previous Nr.: 185010».
   */
  reemplazadoPor?: string | null;
  campos: CamposDoc;
  discrepancias: number;
  creadoEn: string;
  /** C3: señales de inyección detectadas al analizarlo. No bloquean, pero acompañan al documento
   *  para siempre: quien revisa la matriz una semana después tiene que verlas. */
  advertencias: { motivo: string }[];
}

/** Los campos comparables de un documento externo (RF-2.2). */
export interface CamposDoc {
  exportador: CampoDoc;
  importador: CampoDoc;
  montoTotal: CampoDoc;
  moneda: CampoDoc;
  cantidad: CampoDoc;
  unidad: CampoDoc;
  mercaderia: CampoDoc;
  puertoEmbarque: CampoDoc;
  puertoDestino: CampoDoc;
  fechaEmbarque: CampoDoc;
  incoterm: CampoDoc;
  numeroDoc: CampoDoc;
  /* caso CSU2025099: lo que el BL y el packing dicen POR BULTO y lo que la LC exige del consignee.
     Opcionales en TS (documentos guardados antes no los tienen); el schema del modelo los pide. */
  bultos?: CampoDoc; // "1360"
  tipoBulto?: CampoDoc; // "bags" / "cartons" / "pallets"
  pesoBruto?: CampoDoc; // "54.040 KGS"
  consignatario?: CampoDoc; // "TO THE ORDER OF MERIDIAN BANK PLC"
  /* pre-check UCP 600 (oportunidades A1): lo que el banco mira en cada documento */
  numeroLC?: CampoDoc; // "LCMRDN25000471" citado en el documento (47A: "all documents should indicate the LC number")
  fechaDocumento?: CampoDoc; // fecha de emisión del documento (47A: "on or after the LC date")
  referenciaProforma?: CampoDoc; // factura: "goods are shipped as per proforma invoice no. 2025099 dtd 04.03.2025"
  flete?: CampoDoc; // BL: "FREIGHT PREPAID" / "FREIGHT COLLECT"; factura: el flete desglosado ("FREIGHT 8.094,00")
  notify?: CampoDoc; // BL: notify party
  hsCode?: CampoDoc; // "2301.20.00" (D4)
  /* documento de transporte (UCP 600 arts. 20, 26, 27) */
  onBoard?: CampoDoc; // "SHIPPED ON BOARD 08-APR-2025"
  buque?: CampoDoc; // "STELLA AUSTRAL" — o "INTENDED VESSEL …"
  charterParty?: CampoDoc; // indicación de estar sujeto a contrato de fletamento
  onDeck?: CampoDoc; // "SHIPPED ON DECK" / "may be carried on deck"
  /** cómo se titula el documento de transporte: de ahí sale con qué artículo se lo examina (19 a 25) */
  tipoTransporte?: CampoDoc;
  /** cómo se titula el documento: una factura «proforma» no satisface la exigencia (ISBP 821 C1) */
  tipoDocumento?: CampoDoc;
  clausulaDefecto?: CampoDoc; // cláusula que declara la mercadería o el embalaje defectuoso
  juegoOriginales?: CampoDoc; // "three (3) original Bills of Lading" / "COPY NON NEGOTIABLE" / "ZERO (0)"
  /**
   * El bloque de firma del documento de transporte, copiado tal cual.
   *
   * Es lo que decide el inciso (a) (i) de los siete artículos del transporte, y la capacidad
   * admitida **depende de la clase del documento**: el artículo 20 admite transportista, capitán o
   * un agente nombrado de cualquiera de los dos; el 22, en cambio, admite capitán, armador o
   * fletador y **no** al transportista.
   *
   * Va como un texto y no como campos separados a propósito. Lo que un conocimiento imprime al pie
   * es una sola cosa —«AS AGENT FOR THE CARRIER: XYZ SHIPPING for and on behalf of ABC LTD»— y
   * partirla en «quién firma» y «para quién» obligaría al modelo a interpretar en vez de copiar,
   * que es la regla que manda sobre todas en este repositorio. La regla lee la capacidad de este
   * texto; el nombre del transportista suele venir en el mismo bloque o en el membrete.
   */
  firmaTransporte?: CampoDoc;
  precioUnitario?: CampoDoc; // "USD 800,00" — con él y el total se desambigua una cantidad
  /**
   * Quién EMITE y firma el documento, cuando no es quien lo exporta.
   *
   * El crédito nombra al emisor en la mayoría de los certificados que pide —«ISSUED BY CHAMBER OF
   * COMMERCE IN URUGUAY», «ISSUED BY MINISTRY OF LIVESTOCK», «ISSUED BY AN ACCREDITED SURVEYOR»—
   * y eso se verifica. Sin este campo la regla caía al `exportador`, que es el frigorífico que
   * embarca, y afirmaba que el certificado de la Cámara Mercantil lo emitía YARUS S.A.
   */
  emisor?: CampoDoc;
  /* documento de seguro (UCP 600 art. 28) */
  tipoSeguro?: CampoDoc; // "INSURANCE POLICY" / "CERTIFICATE" / "COVER NOTE"
  emisorSeguro?: CampoDoc; // la compañía que lo emite y firma
  fechaSeguro?: CampoDoc; // fecha de emisión del seguro
  montoAsegurado?: CampoDoc; // "USD 56.388,20"
  monedaAsegurada?: CampoDoc;
  coberturaDesde?: CampoDoc; // lugar donde empieza la cobertura
  coberturaHasta?: CampoDoc; // lugar donde termina
  /*
   * La cláusula de vigencia: «cover effective from 01-APR-2025», «warehouse to warehouse».
   *
   * Va aparte de `coberturaDesde`, que es un **lugar**. Sin este campo la excepción del artículo
   * 28 (e) era inalcanzable: se la buscaba dentro del lugar, que nunca la contiene, así que un
   * certificado bajo póliza flotante emitido después del embarque —el caso corriente— salía
   * discrepante por construcción y no por lo que decía el papel.
   */
  vigenciaSeguro?: CampoDoc;
}

/* ------------------------- helpers de normalización ------------------------- */

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Nombres de empresa: baja sufijos societarios y puntuación para comparar razón social. */
function normNombre(s: string): string {
  return sinAcentos(s.toLowerCase())
    .replace(
      /\b(s\.?a\.?|sociedad anonima|s\.?r\.?l\.?|srl|llc|l\.?l\.?c\.?|ltd\.?|limited|inc\.?|co\.?|corp\.?|gmbh|spa|s\.?p\.?a\.?)\b/g,
      "",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Texto genérico (puertos, mercadería): baja acentos, puntuación y espacios. */
function normTexto(s: string): string {
  return sinAcentos(s.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Número tolerante a locales: "259.200,00", "259,200.00", "USD 4.950", "54 MT (±5%)". */
export function parseNumero(s: string): number | null {
  // aislar la PRIMERA corrida numérica: "54 MT (±5%)" → "54" (no arrastra el 5 de ±5%)
  const limpio = s.match(/\d[\d.,]*/)?.[0] ?? "";
  if (!limpio) return null;
  // signo: "-500", "USD -1.200" o contable "(1.200,00)" → negativo (una nota de
  // crédito no puede comparar como positiva — re-auditoría datos-13)
  const negativo = /(^|[\s$])-\s*\d/.test(s) || /^\s*\(.*\d.*\)\s*$/.test(s);
  const tienePunto = limpio.includes(".");
  const tieneComa = limpio.includes(",");
  let normal = limpio;
  /*
   * Un cero a la izquierda del separador no es un grupo de miles.
   *
   * «0,852» es cero coma ochocientos cincuenta y dos: nadie escribe «0» como grupo de miles. Sin
   * esto se leía ochocientos cincuenta y dos — mil veces la carga de un camión. Salió de pasar las
   * 8.957 cantidades reales del ERP de un trader por el parser: 599 se leían mil veces más grandes
   * y 464 de ellas empezaban con cero, que es el caso donde no hay nada que adivinar.
   *
   * Lo que sigue siendo ambiguo —«7,861», que puede ser siete mil ochocientos sesenta y uno o siete
   * coma ocho— lo resuelve el desambiguador con la aritmética del propio documento. Esto solo
   * arregla donde la ambigüedad no existe.
   */
  if (/^0+[.,]\d+$/.test(limpio)) {
    const n0 = Number(limpio.replace(",", "."));
    return Number.isFinite(n0) ? (negativo ? -n0 : n0) : null;
  }
  if (tienePunto && tieneComa) {
    // el último separador es el decimal; el otro es de miles
    normal =
      limpio.lastIndexOf(",") > limpio.lastIndexOf(".")
        ? limpio.replace(/\./g, "").replace(",", ".")
        : limpio.replace(/,/g, "");
  } else if (tieneComa) {
    // coma sola: decimal si hay 1-2 dígitos después, si no es de miles
    normal = /,\d{1,2}$/.test(limpio) ? limpio.replace(",", ".") : limpio.replace(/,/g, "");
  } else if (tienePunto) {
    // punto solo: de miles si son grupos de 3 (4.950 → 4950), decimal si no
    normal = /^\d{1,3}(\.\d{3})+$/.test(limpio) ? limpio.replace(/\./g, "") : limpio;
  }
  const n = Number(normal);
  return Number.isFinite(n) ? (negativo ? -n : n) : null;
}

const codigoIncoterm = (s: string) =>
  /\b(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP|DAT)\b/i.exec(s)?.[1].toUpperCase() ?? s;

const fmtMonto = (n: number) =>
  new Intl.NumberFormat("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** Convierte una cantidad a kilos según su unidad. Gotcha real de Cerealsur: la
 *  factura suele venir en KG y la operación en MT — comparar los números crudos
 *  (253.000 vs 253) daría un falso positivo enorme.
 *  B6: sin unidad reconocida devuelve `null` (antes devolvía `n` como si fuera
 *  KG: las ops del ERP con unidad `U3`/`U5` se comparaban contra KG del
 *  documento y daban OK o discrepancia al azar). El caller lo muestra como
 *  INFO "unidad no reconocida", nunca como veredicto. */
export function aKg(n: number, unidadTexto: string): number | null {
  // sin \b: en las facturas la unidad viene pegada al número ("25000KG", "54MT")
  // y \b no corta entre dígito y letra (re-auditoría datos-12)
  const u = sinAcentos(unidadTexto.toLowerCase());
  if (/(^|[^a-z])kgs?($|[^a-z])|kilo/.test(u)) return n;
  // "MTS" es como lo escriben la LC (45A) y la factura reales del caso CSU2025099
  if (/(^|[^a-z])(mt|mts|tm|tn|ton|tons|tonne|tonnes|tonelada|toneladas|mton|t)($|[^a-z])/.test(u)) return n * 1000;
  if (/(^|[^a-z])(lb|lbs|pound|pounds)($|[^a-z])/.test(u)) return n * 0.453592;
  return null;
}

/**
 * La unidad, reducida a una sola forma.
 *
 * El catálogo del ERP de un trader escribe la misma unidad de dos maneras —CABEZAS y CAB,
 * CONTENEDORES y CNRS, LITRES y LTS— y los documentos las mezclan. Esto las agrupa para poder
 * comparar cantidades que no se miden en kilos: antes solo se comparaba lo convertible a peso, así
 * que «120 CABEZAS» contra «118 CABEZAS» no se marcaba. Ganado en pie es algo que este trader vende.
 *
 * Devuelve `null` para lo que no reconoce: sin saber que son la misma unidad no se comparan dos
 * números, porque 120 cabezas y 53.960 kilos pueden ser la misma carga.
 */
export function unidadNormal(texto: string): string | null {
  const u = sinAcentos(texto.toLowerCase());
  if (/(^|[^a-z])(cab|cabeza|cabezas|head|heads)($|[^a-z])/.test(u)) return "cabeza";
  if (/(^|[^a-z])(cnr|cnrs|cntr|contenedor|contenedores|container|containers)($|[^a-z])/.test(u)) return "contenedor";
  if (/(^|[^a-z])(lt|lts|l|litro|litros|litre|litres|liter|liters)($|[^a-z])/.test(u)) return "litro";
  if (/(^|[^a-z])(un|unit|units|unidad|unidades|pza|pzas|piece|pieces)($|[^a-z])/.test(u)) return "unidad";
  if (/(^|[^a-z])(bag|bags|bolsa|bolsas|sack|sacks)($|[^a-z])/.test(u)) return "bolsa";
  if (/(^|[^a-z])(carton|cartons|caja|cajas|box|boxes)($|[^a-z])/.test(u)) return "caja";
  if (/(^|[^a-z])(pallet|pallets|palet|palets)($|[^a-z])/.test(u)) return "pallet";
  return null;
}

/* ---------------------------- comparadores puros ---------------------------- */

/* ±5 % es la tolerancia habitual en comex; si la operación tiene LC con tolerancia
   propia (39B / "about" = ±10 %), rige esa (toleranciaDe en lc.ts) — Etapa 2 */
function veredictoNumero(op: number, doc: number, tol: number = TOLERANCIA_DEFAULT): MatrixVerdict {
  if (op === 0) return doc === 0 ? "OK" : "DISCREPANCIA";
  const dif = Math.abs(doc - op) / Math.abs(op);
  // la tolerancia es INCLUSIVA: epsilon para que el borde exacto (54 → 56,7) no se caiga
  // por el redondeo de punto flotante (56,7−54 da 2,7000…3, no 2,7 clavado)
  const EPS = 1e-9;
  if (dif <= 0.005 + EPS) return "OK";
  if (dif <= tol + EPS) return "TOLERANCIA";
  return "DISCREPANCIA";
}

function veredictoNombre(op: string, doc: string): MatrixVerdict {
  const a = normNombre(op);
  const b = normNombre(doc);
  if (!a || !b) return "INFO";
  if (a === b) return "OK";
  if (a.includes(b) || b.includes(a)) return "EQUIV";
  return "DISCREPANCIA";
}

function veredictoTexto(op: string, doc: string, estricto = false): MatrixVerdict {
  const a = normTexto(op);
  const b = normTexto(doc);
  if (!a || !b) return "INFO";
  if (a === b) return "OK";
  if (estricto) return "DISCREPANCIA";
  if (a.includes(b) || b.includes(a)) return "EQUIV";
  return "DISCREPANCIA";
}

/** Comparación textual SUAVE: nunca marca discrepancia. Para campos donde la
 *  diferencia literal no implica error — la mercadería suele venir en inglés en
 *  la factura y en español en la operación; compararlas palabra a palabra daría
 *  un falso positivo. Coincidencia → OK/EQUIV; si no, queda informativa. */
function veredictoTextoSuave(op: string, doc: string): MatrixVerdict {
  const a = normTexto(op);
  const b = normTexto(doc);
  if (!a || !b) return "INFO";
  if (a === b) return "OK";
  if (a.includes(b) || b.includes(a)) return "EQUIV";
  return "INFO";
}

const marcaDe = (v: MatrixVerdict): MatrixMark | undefined =>
  v === "DISCREPANCIA" || v === "CRITICO" ? "bad" : v === "TOLERANCIA" ? "tol" : undefined;

/* ------------------------------ el motor ------------------------------ */

interface Comparacion {
  campo: string;
  opValor: string | null;
  docValor: string | null;
  estado: MatrixVerdict;
  confianza: number;
}

/** Valor de la operación para cada campo comparable. */
function valoresOperacion(op: OperationDetail, empresa: Empresa) {
  const venta = op.legs.find((l) => l.tipo === "VENTA");
  const [origen, destino] = op.ruta.split("→").map((p) => p.replace(/^[A-Z]{2,4}\s+/, "").trim());
  return {
    exportador: empresa.razonSocial,
    importador: venta?.contraparte ?? "",
    monto: venta?.montoTotal ?? null,
    moneda: op.moneda,
    cantidad: op.items[0]?.cantidad ?? "",
    mercaderia: op.items[0]?.descripcion ?? op.descripcionLarga,
    puertoEmbarque: origen ?? "",
    puertoDestino: destino ?? "",
    incoterm: op.ruta.match(/^([A-Z]{2,4})\b/)?.[1] ?? "",
    fechaLimite: op.lc?.limiteEmbarque ?? op.fechaEmbarque ?? "",
  };
}

const usable = (c: CampoDoc | undefined) => (c && c.valor.trim() && c.confianza >= 0.4 ? c : null);
/** El modelo devolvió algo pero con confianza < 0,4: no se compara, pero SE MUESTRA
 *  (antes la fila desaparecía y el operador creía que coincidía — datos-14). */
const dudoso = (c: CampoDoc | undefined) => (c && c.valor.trim() && c.confianza < 0.4 ? c : null);

/** Confianza a [0,1]. Un modelo que manda 95 (porcentaje) NO es certeza 1.0 (re-auditoría M-4). */
export function normConfianza(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  if (v > 1 && v <= 100) return v / 100;
  return Math.max(0, Math.min(1, v));
}

/**
 * Compara un documento externo contra la operación y devuelve la matriz de
 * consistencia (solo la columna del tipo de doc + la operación) y las
 * discrepancias tipificadas. `hoy` se inyecta para testear.
 */
export function compararDocumento(
  campos: CamposDoc,
  op: OperationDetail,
  empresa: Empresa,
  tipo: TipoDocExterno,
): { matriz: MatrixRow[]; discrepancias: Discrepancy[] } {
  const v = valoresOperacion(op, empresa);
  const tol = toleranciaDe(op.lc); // Etapa 2: la tolerancia real de la LC, si está cargada
  const comps: Comparacion[] = [];

  const num = (label: string, opNum: number | null, opTxt: string, campo: CampoDoc | undefined) => {
    const d = dudoso(campo);
    if (d) {
      comps.push({
        campo: label,
        opValor: opTxt,
        docValor: `${d.valor} · leído con baja confianza, sin comparar`,
        estado: "INFO",
        confianza: d.confianza,
      });
      return;
    }
    const c = usable(campo);
    if (!c) return;
    const docNum = parseNumero(c.valor);
    // la operación sin el dato (monto NULL del histórico, precio 0 de una op del
    // chat): se informa, NO es discrepancia (re-auditoría C-1: daba ALTA falsa en
    // toda factura de una op importada)
    if (opNum === null || opNum <= 0) {
      comps.push({
        campo: label,
        opValor: "sin cargar en la operación",
        docValor: c.valor,
        estado: "INFO",
        confianza: c.confianza,
      });
      return;
    }
    comps.push({
      campo: label,
      opValor: opTxt,
      docValor: c.valor,
      estado: docNum === null ? "INFO" : veredictoNumero(opNum, docNum, tol),
      confianza: c.confianza,
    });
  };
  const txt = (
    label: string,
    opTxt: string,
    campo: CampoDoc | undefined,
    fn: (a: string, b: string) => MatrixVerdict,
  ) => {
    const d = dudoso(campo);
    if (d) {
      comps.push({
        campo: label,
        opValor: opTxt || null,
        docValor: `${d.valor} · leído con baja confianza, sin comparar`,
        estado: "INFO",
        confianza: d.confianza,
      });
      return;
    }
    const c = usable(campo);
    if (!c) return;
    comps.push({
      campo: label,
      opValor: opTxt || null,
      docValor: c.valor,
      estado: fn(opTxt, c.valor),
      confianza: c.confianza,
    });
  };

  if (tipo === "BL" || tipo === "PACKING") {
    // caso CSU2025099: en el BL y el packing list el shipper/emisor es el PRODUCTOR (Molsur), no el
    // trader — la LC lo admite como "documento de terceros" (47A: todos salvo giro y factura).
    // Coincide con el trader → OK; con el proveedor → EQUIV con la explicación; otro → discrepancia.
    const proveedor = op.legs.find((l) => l.tipo === "COMPRA")?.contraparte ?? "";
    txt(tipo === "BL" ? "Shipper" : "Emisor / shipper", v.exportador, campos.exportador, (a, b) => {
      const conTrader = veredictoNombre(a, b);
      if (conTrader === "OK" || conTrader === "EQUIV") return conTrader;
      const conProveedor = proveedor ? veredictoNombre(proveedor, b) : "INFO";
      return conProveedor === "OK" || conProveedor === "EQUIV" ? "EQUIV" : "DISCREPANCIA";
    });
    const ult = comps[comps.length - 1];
    if (
      ult &&
      (ult.campo === "Shipper" || ult.campo === "Emisor / shipper") &&
      ult.estado === "EQUIV" &&
      veredictoNombre(v.exportador, ult.docValor ?? "") === "DISCREPANCIA"
    ) {
      ult.docValor = `${ult.docValor} · lo emite el productor (documento de terceros)`;
    }
    // consignee (solo BL): con LC va "a la orden del banco emisor"; sin LC, el comprador
    const consig = tipo === "BL" ? usable(campos.consignatario) : null;
    if (consig) {
      const banco = op.lc?.bancoEmisor && op.lc.bancoEmisor !== "—" ? normNombre(op.lc.bancoEmisor) : "";
      const c = normNombre(consig.valor.replace(/to the order of|a la orden de/i, ""));
      const estado: MatrixVerdict = banco
        ? c.includes(banco) || banco.includes(c)
          ? "OK"
          : "DISCREPANCIA"
        : veredictoNombre(v.importador, consig.valor.replace(/to the order of|a la orden de/i, ""));
      comps.push({
        campo: "Consignatario",
        opValor: banco ? `a la orden de ${op.lc!.bancoEmisor}` : v.importador,
        docValor: consig.valor,
        estado,
        confianza: consig.confianza,
      });
    }
    txt(
      tipo === "BL" ? "Notify / comprador" : "Comprador / importador",
      v.importador,
      campos.importador,
      veredictoNombre,
    );
  } else {
    txt("Beneficiario / exportador", v.exportador, campos.exportador, veredictoNombre);
    txt("Comprador / importador", v.importador, campos.importador, veredictoNombre);
  }
  num("Monto", v.monto, v.monto ? `${v.moneda} ${fmtMonto(v.monto)}` : "sin cargar", campos.montoTotal);

  // cantidad: comparar en KG (la op puede estar en MT y el documento en KG)
  const cantDoc = usable(campos.cantidad);
  if (cantDoc) {
    const opNum = parseNumero(v.cantidad);
    const docNum = parseNumero(cantDoc.valor);
    const docUnidad = usable(campos.unidad)?.valor || cantDoc.valor; // unidad aparte o embebida
    const opKg = opNum !== null ? aKg(opNum, v.cantidad) : null;
    const docKg = docNum !== null ? aKg(docNum, docUnidad) : null;
    const sinUnidad = (opNum !== null && opKg === null) || (docNum !== null && docKg === null);
    comps.push({
      campo: "Cantidad",
      opValor: v.cantidad,
      docValor:
        (usable(campos.unidad) ? `${cantDoc.valor} ${campos.unidad.valor}`.trim() : cantDoc.valor) +
        // unidad no reconocida (p. ej. `U3` del ERP): no se compara — se dice, en la celda
        (sinUnidad ? " · unidad no reconocida, sin comparar" : ""),
      estado: opKg !== null && docKg !== null ? veredictoNumero(opKg, docKg, tol) : "INFO",
      confianza: cantDoc.confianza,
    });
  }

  txt("Mercadería", v.mercaderia, campos.mercaderia, veredictoTextoSuave);
  txt("Puerto de embarque", v.puertoEmbarque, campos.puertoEmbarque, (a, b) => veredictoTexto(a, b));
  txt("Puerto de destino", v.puertoDestino, campos.puertoDestino, (a, b) => veredictoTexto(a, b));
  // la factura real dice "CFR COLOMBO, SRI LANKA" y la operación "CFR": se compara el CÓDIGO
  txt("Incoterm", v.incoterm, campos.incoterm, (a, b) => veredictoTexto(codigoIncoterm(a), codigoIncoterm(b), true));
  // D4: HS code — dígitos solamente ("2301.20.00" ≡ "23012000"; 6 dígitos comunes alcanzan si uno es más corto)
  txt("HS code", op.items[0]?.hsCode ?? op.lc?.hsCode ?? "", campos.hsCode, (a, b) => {
    const da = a.replace(/\D/g, ""),
      db = b.replace(/\D/g, "");
    if (!da || !db) return "INFO";
    const n = Math.min(da.length, db.length, 8);
    return da.slice(0, n) === db.slice(0, n) ? (da === db ? "OK" : "EQUIV") : "DISCREPANCIA";
  });

  // fecha: si el doc es la LC, su fecha es el LÍMITE de embarque; si la operación
  // embarca después, es crítico (rechazo bancario). Si no, comparación simple.
  const fechaDoc = usable(campos.fechaEmbarque);
  if (fechaDoc) {
    const opF = parseFecha(v.fechaLimite);
    const docF = parseFecha(fechaDoc.valor);
    let estado: MatrixVerdict = "INFO";
    if (opF && docF) {
      if (tipo === "LC") estado = op.fechaEmbarque && parseFecha(op.fechaEmbarque)! > docF ? "CRITICO" : "OK";
      // BL / factura / packing: la fecha del documento (a bordo o emisión) contra el último
      // embarque de la LC — después = rechazo bancario (caso CSU2025099: 08-abr ≤ 30-abr). Sin
      // LC, contra el embarque ESTIMADO: distinto no es discrepancia (una estimación se mueve), se informa.
      else {
        const lim = op.lc ? parseFecha(op.lc.limiteEmbarque) : null;
        if (lim) estado = docF > lim ? "CRITICO" : "OK";
        else estado = opF.getTime() === docF.getTime() ? "OK" : "INFO";
      }
    }
    const conLimite = Boolean(op.lc && parseFecha(op.lc.limiteEmbarque));
    comps.push({
      campo:
        tipo === "LC"
          ? "Fecha límite de embarque"
          : tipo === "BL"
            ? "Fecha a bordo (vs. último embarque LC)"
            : conLimite
              ? "Fecha de embarque (vs. último embarque LC)"
              : "Fecha de embarque",
      opValor:
        tipo === "LC"
          ? (op.fechaEmbarque ?? v.fechaLimite)
          : conLimite
            ? (op.lc?.limiteEmbarque ?? "sin LC")
            : (op.fechaEmbarque ?? v.fechaLimite),
      docValor: fechaDoc.valor,
      estado,
      confianza: fechaDoc.confianza,
    });
  }

  // bultos / peso bruto: contra los contenedores cargados (C16) si los hay; si no, informativo
  const bultosDoc = usable(campos.bultos),
    tipoBultoDoc = usable(campos.tipoBulto),
    pesoBrutoDoc = usable(campos.pesoBruto);
  const conts = op.contenedores ?? [];
  const opBultos =
    conts.length && conts.every((c) => c.bultos != null) ? conts.reduce((s, c) => s + (c.bultos ?? 0), 0) : null;
  const opBruto =
    conts.length && conts.every((c) => c.pesoBrutoKg != null)
      ? conts.reduce((s, c) => s + (c.pesoBrutoKg ?? 0), 0)
      : null;
  if (bultosDoc || tipoBultoDoc) {
    const docTxt = [bultosDoc?.valor, tipoBultoDoc?.valor].filter(Boolean).join(" ");
    const n = bultosDoc ? parseNumero(bultosDoc.valor) : null;
    comps.push({
      campo: "Bultos",
      opValor: opBultos != null ? `${opBultos} ${conts[0]?.tipoBulto ?? ""}`.trim() : "sin contenedores cargados",
      docValor: docTxt,
      estado: opBultos != null && n != null ? (n === opBultos ? "OK" : "DISCREPANCIA") : "INFO",
      confianza: Math.max(bultosDoc?.confianza ?? 0, tipoBultoDoc?.confianza ?? 0),
    });
  }
  if (pesoBrutoDoc) {
    const n = parseNumero(pesoBrutoDoc.valor);
    const kg = n != null ? aKg(n, pesoBrutoDoc.valor) : null;
    comps.push({
      campo: "Peso bruto",
      opValor: opBruto != null ? `${fmtMonto(opBruto)} kg` : "sin contenedores cargados",
      docValor: pesoBrutoDoc.valor,
      estado: opBruto != null && kg != null ? veredictoNumero(opBruto, kg, tol) : "INFO",
      confianza: pesoBrutoDoc.confianza,
    });
  }

  const col = COLUMNA_DE_TIPO[tipo];
  const vacia: MatrixCell = { valor: null };
  const matriz: MatrixRow[] = comps.map((c) => {
    const docCell: MatrixCell = { valor: c.docValor, marca: marcaDe(c.estado), confianza: c.confianza };
    const opMarca = c.estado === "CRITICO" ? "bad" : undefined;
    return {
      campo: c.campo,
      operacion: { valor: c.opValor, marca: opMarca },
      lc: col === "lc" ? docCell : vacia,
      invoice: col === "invoice" ? docCell : vacia,
      packing: col === "packing" ? docCell : vacia,
      bl: col === "bl" ? docCell : vacia,
      estado: c.estado,
    };
  });

  const discrepancias = comps
    .filter((c) => c.estado === "DISCREPANCIA" || c.estado === "CRITICO")
    .map<Discrepancy>((c) => {
      const severidad: Severity = c.estado === "CRITICO" ? "CRITICA" : "ALTA";
      const baja =
        c.confianza < 0.6 ? ` (extraído con confianza ${Math.round(c.confianza * 100)}%: verificá el documento)` : "";
      return {
        id: `disc-${normTexto(c.campo).replace(/ /g, "-")}`,
        severidad: severidad === "CRITICA" ? "CRITICA" : "ALTA",
        titulo:
          c.estado === "CRITICO"
            ? tipo === "BL"
              ? `${c.campo}: el BL está a bordo después del último embarque de la LC`
              : `${c.campo}: la operación embarca fuera del plazo del documento`
            : `${c.campo}: no coincide con ${TIPO_DOC_LABEL[tipo].toLowerCase()}`,
        detalle:
          `La operación dice "${c.opValor ?? "—"}"; ${TIPO_DOC_LABEL[tipo].toLowerCase()} dice "${c.docValor ?? "—"}".${baja}` +
          (c.estado === "CRITICO"
            ? " Si se embarca tarde, el banco puede rechazar los documentos y el cobro queda a voluntad del comprador."
            : " Corregí el dato que esté mal antes de que el documento salga del sistema."),
        acciones: [
          { label: "Corregir en la operación", resultado: "Se abre la edición de la operación para ajustar el dato" },
          {
            label: "Marcar falso positivo",
            resultado: "Discrepancia marcada como falso positivo (queda registrado quién y cuándo)",
          },
        ],
      };
    });

  return { matriz, discrepancias };
}

/* ----------------------- extracción con IA (RF-2.2) ----------------------- */

const campoSchema = {
  type: "object",
  properties: {
    valor: { type: "string", description: 'El valor tal cual aparece en el documento, o "" si no aparece.' },
    confianza: {
      type: "number",
      description: "Confianza de 0 a 1 en que el valor es correcto y corresponde al campo.",
    },
  },
  required: ["valor", "confianza"],
  additionalProperties: false,
} as const;

export const SCHEMA_DOC = {
  type: "object",
  properties: {
    exportador: campoSchema,
    importador: campoSchema,
    montoTotal: campoSchema,
    moneda: campoSchema,
    cantidad: campoSchema,
    unidad: campoSchema,
    mercaderia: campoSchema,
    puertoEmbarque: campoSchema,
    puertoDestino: campoSchema,
    fechaEmbarque: campoSchema,
    incoterm: campoSchema,
    numeroDoc: campoSchema,
    bultos: campoSchema,
    tipoBulto: campoSchema,
    pesoBruto: campoSchema,
    consignatario: campoSchema,
    numeroLC: campoSchema,
    fechaDocumento: campoSchema,
    referenciaProforma: campoSchema,
    flete: campoSchema,
    notify: campoSchema,
    hsCode: campoSchema,
    onBoard: campoSchema,
    buque: campoSchema,
    charterParty: campoSchema,
    onDeck: campoSchema,
    tipoTransporte: campoSchema,
    tipoDocumento: campoSchema,
    clausulaDefecto: campoSchema,
    juegoOriginales: campoSchema,
    firmaTransporte: campoSchema,
    precioUnitario: campoSchema,
    tipoSeguro: campoSchema,
    emisor: campoSchema,
    emisorSeguro: campoSchema,
    fechaSeguro: campoSchema,
    montoAsegurado: campoSchema,
    monedaAsegurada: campoSchema,
    coberturaDesde: campoSchema,
    coberturaHasta: campoSchema,
    vigenciaSeguro: campoSchema,
  },
  required: [
    "exportador",
    "importador",
    "montoTotal",
    "moneda",
    "cantidad",
    "unidad",
    "mercaderia",
    "puertoEmbarque",
    "puertoDestino",
    "fechaEmbarque",
    "incoterm",
    "numeroDoc",
    "bultos",
    "tipoBulto",
    "pesoBruto",
    "consignatario",
    "numeroLC",
    "fechaDocumento",
    "referenciaProforma",
    "flete",
    "notify",
    "hsCode",
  ],
  additionalProperties: false,
} as const;

export const PROMPT_DOC =
  "Sos el analista documental de CEREALSUR S.A., trader de comercio exterior de carne. " +
  "Te paso el TEXTO de un documento de comercio exterior (factura comercial, carta de crédito, packing list o bill of lading). " +
  "Extraé SOLO los campos pedidos, con el valor TAL CUAL aparece en el documento (no lo reformatees ni lo traduzcas). " +
  "Para exportador e importador extraé SOLO la razón social (sin dirección ni ciudad); en un bill of lading el exportador es el SHIPPER " +
  "y el importador el NOTIFY PARTY; el campo consignatario es el CONSIGNEE tal cual (p. ej. 'TO THE ORDER OF MERIDIAN BANK PLC'). " +
  /*
   * `cantidad` y `unidad` tienen que salir del MISMO renglón. VA PRIMERO A PROPÓSITO.
   *
   * Un documento de comercio dice la misma carga dos veces: «53.96 MTS OF FISH MEAL» en la
   * descripción y «TOTAL NET WEIGHT: 53.960 KGS» en el detalle. Sobre la factura de referencia el
   * modelo tomó el número de un renglón y la unidad del otro —53.960 con «MTS»— y el motor lo pasó
   * a kilos: 53.960.000, mil veces la carga. No es un error visible: el número existe, la unidad
   * existe, y la cifra entra en la comparación contra el crédito como si fuera real.
   *
   * Esta instrucción ya se escribió una vez y se perdió, y al perderse el error volvió exacto. Va
   * arriba de todo porque es la única del prompt cuyo incumplimiento se mide en órdenes de
   * magnitud: las demás dejan un campo vacío, ésta deja un número mil veces más grande.
   */
  "ANTES QUE NADA: cantidad y unidad SIEMPRE del MISMO renglón. Si el número lo sacás de " +
  "'TOTAL NET WEIGHT: 53.960 KGS', la unidad es KGS, aunque el documento diga la misma carga en toneladas en " +
  "otra línea. Un papel suele repetir la carga en toneladas y en kilos: mezclar el número de una con la unidad " +
  "de la otra multiplica o divide por mil. Para `cantidad` preferí el renglón del peso NETO total. " +
  "Si no podés atar el número y la unidad al mismo renglón, bajá la confianza a < 0.6. " +
  /*
   * El bloque de totales se lee entero, no hasta el primer renglón.
   *
   * La factura los pone juntos —TOTAL NET WEIGHT, TOTAL GROSS WEIGHT, TOTAL BAGS— y el modelo
   * devolvía el neto y dejaba los otros dos vacíos, con el dato a dos centímetros. Vacío no es
   * neutro: el cruce de peso bruto entre la factura y el packing sale «no se leyó», que es una fila
   * amarilla sobre papeles que coinciden.
   */
  "Ojo con el bloque de totales: el peso NETO, el peso BRUTO y el total de bultos suelen ir en renglones " +
  "seguidos del mismo bloque ('TOTAL NET WEIGHT' / 'TOTAL GROSS WEIGHT' / 'TOTAL BAGS'). Son tres campos " +
  "distintos —cantidad, pesoBruto y bultos—: leé el bloque entero y llenálos a los tres, no solo el primero. " +
  "El peso neto nunca va en pesoBruto. " +
  "bultos = número TOTAL de bultos del documento (en una factura suele venir como 'TOTAL BAGS: 1.360' o " +
  "'TOTAL CARTONS: 680'; si hay varios contenedores, la suma; si es una hoja parcial —'sheet 1 of 2'— bajá la confianza a < 0.6); " +
  "tipoBulto = qué son (bags, cartons, pallets…); pesoBruto = peso bruto TOTAL con su unidad; " +
  "fechaEmbarque = en un BL la fecha SHIPPED ON BOARD; fechaDocumento = la fecha de emisión del documento (DATE / PLACE AND DATE OF ISSUE). " +
  "hsCode = la partida arancelaria (HS CODE) tal cual. numeroLC = el número de carta de crédito si el documento lo cita (L/C No., LC:). referenciaProforma = en una factura, la frase que cita la proforma " +
  "('goods shipped as per proforma invoice no. …'). flete = en un BL, 'FREIGHT PREPAID' o 'FREIGHT COLLECT'; en una factura, la línea de flete desglosada. notify = en un BL, el NOTIFY PARTY. " +
  /*
   * Los cuatro campos que deciden CON QUÉ ARTÍCULO se examina el documento.
   *
   * El esquema los pedía y el prompt no los explicaba, así que el modelo los llenaba por su cuenta
   * o los dejaba vacíos — y un campo vacío hace que la regla salga «no se leyó», que es una fila
   * amarilla sobre un papel que puede estar perfecto. Importan porque cambian el artículo: un sea
   * waybill no se examina con el 20 sino con el 21, y un conocimiento de fletamento está excluido
   * salvo que el crédito lo permita (art. 22).
   */
  "tipoDocumento = cómo se titula el papel, tal cual ('COMMERCIAL INVOICE', 'PROFORMA INVOICE', " +
  "'BILL OF LADING', 'SEA WAYBILL', 'CHARTER PARTY BILL OF LADING'): de eso sale con qué artículo " +
  "se lo examina, así que copialo del encabezado sin interpretar. " +
  "tipoTransporte = el medio, si el documento lo dice ('MARITIMO', 'AEREO', 'CARRETERO', 'MULTIMODAL'). " +
  "buque = el nombre del barco y su viaje, como figura ('MSC AMALFI V.247W'). " +
  "charterParty = la mención de fletamento si existe ('CHARTER PARTY', 'FREIGHT PAYABLE AS PER CHARTER PARTY'), vacío si no aparece. " +
  "precioUnitario = en una factura, el precio por unidad con su unidad ('USD 950,00 PER MT'): es lo que " +
  "permite recalcular la cantidad cuando el total y la cantidad no cierran. " +
  /*
   * Los ocho campos del documento de seguro (art. 28).
   *
   * El esquema los pedía y el prompt no explicaba ninguno, que es el mismo defecto que hacía leer
   * «53.960 MTS» donde el papel decía kilos. Dos son los que más se equivocan: `tipoSeguro` no es
   * el título del papel sino la cobertura contratada, y `coberturaDesde`/`coberturaHasta` son
   * LUGARES, no fechas. El motor se defiende —si ahí llega una fecha no dictamina— pero entonces
   * la regla sale «a verificar» sobre una póliza que está perfecta, y eso es una fila amarilla que
   * alguien tiene que ir a mirar para nada.
   */
  /*
   * Los cuatro campos del conocimiento que deciden si el banco lo observa.
   *
   * El esquema los pedía sin explicarlos, y de ellos salen tres artículos enteros: el 20 (a) (ii)
   * mira la anotación de a bordo, el 26 (a) rechaza la mercadería estibada sobre cubierta y el 27
   * exige que el documento esté limpio. Un campo vacío manda la regla a «no se leyó», y «no se
   * leyó» sobre la anotación de a bordo es justo la fila que nadie quiere ver dudosa.
   */
  "En un conocimiento de embarque: onBoard = la anotación de a bordo tal cual ('SHIPPED ON BOARD 08 APR 2025'), " +
  "con su fecha si la trae; si el documento solo dice que la mercadería fue RECIBIDA para embarque y no hay " +
  "anotación de a bordo, dejalo VACÍO, no copies la fecha de emisión. " +
  "onDeck = la mención de estiba sobre cubierta ('SHIPPED ON DECK', 'ON DECK'), vacío si no aparece; no confundir " +
  "con 'ON DECK AT SHIPPER'S RISK' impreso en las condiciones generales, que no dice dónde viajó esta carga. " +
  "clausulaDefecto = cualquier anotación sobre el estado defectuoso de la mercadería o del embalaje ('BAGS TORN', " +
  "'STAINED'), vacío si el documento está limpio. " +
  "juegoOriginales = cuántos originales se emitieron, tal cual ('3/3', 'THREE (3)', 'ZERO (0)'). " +
  "emisor = quién EMITE y firma el documento, cuando no es el exportador: la cámara de comercio de un " +
  "certificado de origen, el ministerio de un sanitario, la empresa inspectora de un análisis. Copiá el " +
  "nombre tal cual figura al pie o en el membrete; si no se lee, dejalo vacío — no pongas el exportador. " +
  "En un documento de seguro: tipoSeguro = la cobertura contratada tal cual ('INSTITUTE CARGO CLAUSES (A)', " +
  "'ALL RISKS'), no el título del papel —ése va en tipoDocumento—. emisorSeguro = quién lo emite, que para el " +
  "artículo 28 tiene que ser una compañía de seguros o su agente: copiá el nombre tal cual, aunque sea un bróker. " +
  "fechaSeguro = la fecha del documento. montoAsegurado y monedaAsegurada = la suma asegurada con su moneda " +
  "('USD 59.565,00' → monto 59.565,00 y moneda USD). " +
  "coberturaDesde y coberturaHasta = los LUGARES entre los que corre la cobertura ('from warehouse Montevideo to " +
  "Colombo' → desde MONTEVIDEO, hasta COLOMBO): son plazas, NO fechas. Si lo único que encontrás es una fecha de " +
  "vigencia ('COVER EFFECTIVE FROM 01-APR-2025'), eso va en vigenciaSeguro y los dos campos de cobertura quedan " +
  "vacíos. vigenciaSeguro = desde cuándo rige, si el documento lo declara. " +
  'Si un campo no aparece, devolvé valor "" y confianza 0. La confianza refleja qué tan seguro estás de que el ' +
  "valor corresponde a ese campo (1 = textual e inequívoco; <0.6 = dedujiste o es ambiguo). " +
  "NUNCA inventes datos: si no está, no lo pongas. Fechas: dejalas como están en el documento.";

/** Un campo vacío, para armar el objeto demo o defaults. */
const vacio: CampoDoc = { valor: "", confianza: 0 };

/**
 * Demo determinista (sin ANTHROPIC_API_KEY): simula la extracción de una factura
 * comercial con dos problemas plantados contra la operación de ejemplo — razón
 * social abreviada (EQUIV) y cantidad al límite de tolerancia.
 */
export const DOC_DEMO: CamposDoc = {
  // razón social con la forma societaria completa: el motor reconoce que es la
  // misma entidad (no la marca como error — evita el falso positivo clásico)
  exportador: { valor: "Oriental Trade Sociedad Anónima", confianza: 0.97 },
  importador: { valor: "Al Rashid Trading LLC", confianza: 0.97 },
  // problema plantado: monto con dígitos trastocados (259 → 295), +13% → DISCREPANCIA
  montoTotal: { valor: "295,200.00", confianza: 0.99 },
  moneda: { valor: "USD", confianza: 0.99 },
  // cantidad al borde de la tolerancia (+5%) → TOLERANCIA, no discrepancia
  cantidad: { valor: "56.7", confianza: 0.95 },
  unidad: { valor: "MT", confianza: 0.95 },
  // descripción de la mercadería leída con baja confianza → la matriz lo avisa
  mercaderia: { valor: "Frozen boneless beef cuts", confianza: 0.55 },
  puertoEmbarque: { valor: "Montevideo", confianza: 0.96 },
  puertoDestino: { valor: "Jebel Ali", confianza: 0.96 },
  fechaEmbarque: vacio,
  incoterm: { valor: "FOB", confianza: 0.9 },
  numeroDoc: { valor: "INV-2026-0412", confianza: 0.99 },
};

/** Completa un objeto parcial del modelo a un CamposDoc válido (defensivo). */
/**
 * La lectura del modelo, puesta en forma.
 *
 * **Los campos salen del esquema, no de una lista escrita acá.** Estaban escritos a mano —veintidós—
 * y el esquema fue creciendo a treinta y seis: `onBoard`, `onDeck`, `clausulaDefecto`,
 * `juegoOriginales` y los del seguro se leían del papel, se pedían en el esquema, y esta función los
 * tiraba. Las reglas de los artículos 26 y 27 nunca recibieron un dato extraído: solo funcionaban
 * con los fixtures escritos a mano, y por eso nadie lo notó hasta probar la lectura de punta a punta.
 *
 * Derivarlos del esquema es lo que impide que vuelva a pasar: agregar un campo allá lo trae acá.
 */
export function normalizarCamposDoc(raw: unknown): CamposDoc {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const campo = (k: string): CampoDoc => {
    const c = o[k] as Record<string, unknown> | undefined;
    return { valor: typeof c?.valor === "string" ? c.valor : "", confianza: normConfianza(c?.confianza) };
  };
  const salida: Record<string, CampoDoc> = {};
  for (const k of Object.keys(SCHEMA_DOC.properties)) salida[k] = campo(k);
  return salida as unknown as CamposDoc;
}

/* --------- Etapa 2 (caso CSU2025099): consistencia ENTRE documentos externos --------- */

export interface CruceDocumentos {
  campo: string;
  /** qué dice cada documento */
  valores: { tipo: TipoDocExterno; valor: string }[];
  severidad: "ALTA" | "MEDIA";
  titulo: string;
  detalle: string;
}

/**
 * El BL del caso de referencia dice "cartons" y el packing list "bags" del mismo embarque: UCP 600 art. 14d
 * exige que los documentos no se contradigan entre sí, y el banco cobra USD 80 por cada juego con
 * discrepancias. Esto cruza los documentos ya analizados de la operación entre ellos.
 */
export function compararEntreDocumentos(docsTodos: { tipo: TipoDocExterno; campos: CamposDoc }[]): CruceDocumentos[] {
  const out: CruceDocumentos[] = [];
  // un documento por tipo: el PRIMERO de la lista (la ficha los pasa del más nuevo al más viejo);
  // cruzar la factura vieja contra la corregida no es una contradicción entre documentos
  const vistos = new Set<TipoDocExterno>();
  const docs = docsTodos.filter((d) => (vistos.has(d.tipo) ? false : (vistos.add(d.tipo), true)));
  if (docs.length < 2) return out;
  // la foto de la hoja 1 de 2 de un BL trae los bultos y el peso DE ESA HOJA (el modelo lo lee con
  // confianza baja): para cruzar totales entre documentos se exige confianza >= 0,6
  const val = (d: { campos: CamposDoc }, k: keyof CamposDoc, min = 0.4) => {
    const c = d.campos[k];
    return c && c.valor.trim() && c.confianza >= min ? c.valor : null;
  };
  const cruce = (
    campo: string,
    k: keyof CamposDoc,
    iguales: (a: string, b: string) => boolean,
    severidad: "ALTA" | "MEDIA",
    detalle: string,
    min = 0.4,
  ) => {
    const con = docs
      .map((d) => ({ tipo: d.tipo, valor: val(d, k, min) }))
      .filter((x): x is { tipo: TipoDocExterno; valor: string } => Boolean(x.valor));
    if (con.length < 2) return;
    const distintos = con.some((x) => !iguales(con[0].valor, x.valor));
    if (!distintos) return;
    out.push({
      campo,
      valores: con,
      severidad,
      titulo: `${campo}: ${con.map((x) => `${TIPO_DOC_LABEL[x.tipo].toLowerCase()} dice "${x.valor}"`).join(", ")}`,
      detalle,
    });
  };
  cruce(
    "Tipo de bulto",
    "tipoBulto",
    (a, b) => normTexto(a).replace(/s$/, "") === normTexto(b).replace(/s$/, ""),
    "ALTA",
    "Los documentos de un mismo embarque no pueden contradecirse (UCP 600 art. 14d): el banco lo marca como discrepancia. Unificar la descripción de los bultos antes de presentar.",
  );
  cruce(
    "Cantidad de bultos",
    "bultos",
    (a, b) => parseNumero(a) === parseNumero(b),
    "ALTA",
    "El total de bultos tiene que ser el mismo en BL, packing list y factura.",
    0.6,
  );
  cruce(
    "Peso bruto",
    "pesoBruto",
    (a, b) => {
      const x = parseNumero(a),
        y = parseNumero(b);
      return x != null && y != null && Math.abs(x - y) / Math.max(x, 1) < 0.005;
    },
    "ALTA",
    "El peso bruto del BL tiene que coincidir con el del packing list / weight note.",
    0.6,
  );
  // cantidad EN KILOS: la LC dice "57 MTS" y el packing "53.960 KGS" (revisión 8-sep: comparar crudo daba contradicción falsa)
  {
    const con = docs
      .map((d) => {
        const c = d.campos.cantidad,
          u = d.campos.unidad;
        if (!c || !c.valor.trim() || c.confianza < 0.4) return null;
        const n = parseNumero(c.valor);
        if (n == null) return null;
        const leyoUnidad = Boolean(u && u.confianza >= 0.4 && u.valor.trim());
        const texto = (leyoUnidad && u?.valor) || c.valor;
        const kg = aKg(n, texto);
        /*
         * En kilos cuando se puede; si no, en su propia unidad, y solo se comparan entre sí las que
         * están en la misma. Sin esto, todo lo que no fuera peso quedaba sin comparar.
         *
         * **Y la unidad que la tabla no conoce se compara por su texto.** Antes se descartaba, así
         * que dos documentos con la misma unidad desconocida no se comparaban **y nadie lo decía**:
         * «1000 ADMT» contra «900 ADMT» salía sin cruce, mientras «1000 MTS» contra «900 MTS» sí lo
         * daba. ADMT —air dry metric tonne— es la unidad corriente de la pulpa de celulosa, así que
         * no es un caso raro: era un crédito entero sin cotejo de cantidad entre documentos, en
         * silencio, y acá el silencio no se cuenta como conforme.
         *
         * Lo encontró un caso del banco de pruebas que pasaba por el motivo equivocado: el mutante
         * que debía ponerlo rojo —cambiar 994.781 por 894— no lo movía, porque la unidad del papel
         * era ADMT y el cruce nunca corría.
         *
         * El texto se usa **solo cuando el documento declaró una unidad**. Dos cantidades sin unidad
         * siguen sin compararse: ahí el respaldo sería el número mismo y dos números distintos darían
         * «unidades» distintas, que es una comparación que no quiere decir nada.
         */
        const unidad = kg == null ? (unidadNormal(texto) ?? (leyoUnidad ? `texto:${normTexto(texto)}` : null)) : "kg";
        if (unidad == null) return null;
        return {
          tipo: d.tipo,
          valor: c.valor + (u?.valor && !c.valor.includes(u.valor) ? ` ${u.valor}` : ""),
          kg: kg ?? n,
          unidad,
        };
      })
      .filter((x): x is { tipo: TipoDocExterno; valor: string; kg: number; unidad: string } => x != null)
      // Magnitudes distintas no se comparan: 120 cabezas y 53.960 kilos pueden ser la misma carga.
      .filter((x, _i, todos) => x.unidad === todos[0]!.unidad);
    if (con.length >= 2 && con.some((x) => Math.abs(x.kg - con[0].kg) / Math.max(con[0].kg, 1) > 0.005)) {
      out.push({
        campo: "Cantidad",
        valores: con.map(({ tipo, valor }) => ({ tipo, valor })),
        severidad: "MEDIA",
        titulo: `Cantidad: ${con.map((x) => `${TIPO_DOC_LABEL[x.tipo].toLowerCase()} dice "${x.valor}"`).join(", ")}`,
        detalle:
          con[0]!.unidad === "kg"
            ? "Cantidades distintas entre documentos (comparadas en kilos): la LC puede fijar la contratada y el BL/packing lo embarcado — dentro de la tolerancia es normal; fuera, discrepancia."
            : `Cantidades distintas entre documentos (en ${con[0]!.unidad}s): la LC puede fijar la contratada y el BL/packing lo embarcado — dentro de la tolerancia es normal; fuera, discrepancia.`,
      });
    }
  }
  /*
   * La ruta: el puerto de carga y el de destino entre documentos (DOCDEX 290).
   *
   * El laudo **DOCDEX 290** decide exactamente esto —<https://library.iccwbo.org/content/tfb/DOCDEX/290.htm>—
   * y por unanimidad. El crédito pedía embarcar de Busan a Qingdao; la factura, el packing list y el
   * certificado de calidad traían los dos casilleros **invertidos**, y el conocimiento los traía bien.
   * El banco presentador argumentó que era un error de tipeo y el panel lo rechazó:
   *
   *   «The route of shipment need not be shown in the commercial invoice, but if it is shown, it should
   *   not be conflicting with data in the L/C.»
   *
   *   «There is no doubt in this case that the port of loading and final destination in question are
   *   totally different ports and are places which do exist, and it could not be argued that the
   *   difference in the words was caused by a misspelling or typing error.»
   *
   * El motor no cruzaba los puertos entre papeles: comparaba los del conocimiento contra el crédito y
   * nada más. Un papel que no es de transporte y que trae la ruta mal pasaba en silencio, que es el
   * caso del laudo.
   *
   * **Y se emite en dos bandas, porque las dos cosas no son lo mismo:**
   *
   * - **la ruta invertida es ALTA**, o sea discrepancia. Que el puerto de carga de un papel sea el de
   *   destino del otro y al revés no admite lectura inocente: es lo que el laudo llama *«a reversal of
   *   the order of the route of shipment»*, y el panel fue explícito en que averiguar qué quiso poner
   *   el que tipeó *«would require them to guess or speculate about the maker's intention»*.
   * - **dos puertos simplemente distintos son MEDIA**, o sea a verificar. El casillero de destino de
   *   una factura puede traer el **lugar de entrega final** tierra adentro mientras el conocimiento
   *   trae el puerto de descarga —Lima contra Callao, que es la Opinión TA 735rev— y rechazar eso sería
   *   un falso positivo. El esquema tiene un solo campo para los dos conceptos, así que acá la duda la
   *   mira una persona.
   */
  {
    /* El mismo comparador que usa el resto del motor para un lugar: ver `coincideLugar`. */
    const mismoLugar = coincideLugar;
    const rutas = docs
      .filter((d) => d.tipo !== "LC")
      .map((d) => ({ tipo: d.tipo, carga: val(d, "puertoEmbarque"), destino: val(d, "puertoDestino") }));
    const invertidos = rutas.filter((x) => x.carga && x.destino) as {
      tipo: TipoDocExterno;
      carga: string;
      destino: string;
    }[];
    const parInvertido = invertidos
      .flatMap((a, i) => invertidos.slice(i + 1).map((b) => [a, b] as const))
      .find(([a, b]) => mismoLugar(a.carga, b.destino) && mismoLugar(a.destino, b.carga) && !mismoLugar(a.carga, b.carga));
    if (parInvertido) {
      const [a, b] = parInvertido;
      out.push({
        campo: "Ruta de embarque",
        valores: [a, b].map((x) => ({ tipo: x.tipo, valor: `carga "${x.carga}" / destino "${x.destino}"` })),
        severidad: "ALTA",
        titulo: `Ruta de embarque invertida: ${TIPO_DOC_LABEL[a.tipo].toLowerCase()} dice carga "${a.carga}" y destino "${a.destino}", ${TIPO_DOC_LABEL[b.tipo].toLowerCase()} dice lo contrario`,
        detalle:
          "Los dos casilleros de la ruta están cambiados de lugar entre un documento y otro (UCP 600 art. 14 d). El laudo DOCDEX 290 lo resolvió por unanimidad: una ruta invertida no es un error de tipeo —«it could not be argued that the difference in the words was caused by a misspelling or typing error»— y el banco tiene derecho a rechazar. Corregir el documento antes de presentar.",
      });
    } else {
      cruce(
        "Puerto de carga",
        "puertoEmbarque",
        mismoLugar,
        "MEDIA",
        "El puerto de carga difiere entre documentos (UCP 600 art. 14 d). No siempre es discrepancia: el casillero de una factura puede traer el lugar de toma a cargo tierra adentro y el del conocimiento el puerto del tramo oceánico. Verificar contra el crédito.",
      );
      cruce(
        "Puerto de destino",
        "puertoDestino",
        mismoLugar,
        "MEDIA",
        "El puerto de destino difiere entre documentos (UCP 600 art. 14 d). No siempre es discrepancia: el casillero de una factura puede traer el lugar de entrega final y el del conocimiento el puerto de descarga. Verificar contra el crédito.",
      );
    }
  }
  cruce(
    "HS code",
    "hsCode",
    (a, b) => {
      const x = a.replace(/\D/g, ""),
        y = b.replace(/\D/g, "");
      const n = Math.min(x.length, y.length, 8);
      return n < 4 || x.slice(0, n) === y.slice(0, n);
    },
    "ALTA",
    "La partida arancelaria tiene que ser la misma en LC, factura, packing, BL y certificado de origen.",
  );
  /*
   * shipper: la LC nombra al BENEFICIARIO (el trader) y el BL/packing al que embarca (el productor).
   *
   * Que no coincidan es normal y el artículo 14 (k) lo admite expresamente —el shipper indicado en
   * cualquier documento no necesita ser el beneficiario— así que esto se informa para que el
   * examinador lo vea, no porque pueda ser discrepancia. El veredicto con su artículo lo da
   * `reglasQuienEmite` en `reglas-ucp.ts`; acá solo se muestran los nombres que difieren. La LC no
   * entra en el cruce.
   */
  const sinLC = docs.filter((d) => d.tipo !== "LC");
  if (sinLC.length >= 2) {
    const con = sinLC
      .map((d) => ({ tipo: d.tipo, valor: val(d, "exportador") }))
      .filter((x): x is { tipo: TipoDocExterno; valor: string } => Boolean(x.valor));
    const iguales = (a: string, b: string) =>
      normNombre(a) === normNombre(b) || normNombre(a).includes(normNombre(b)) || normNombre(b).includes(normNombre(a));
    if (con.length >= 2 && con.some((x) => !iguales(con[0].valor, x.valor))) {
      out.push({
        campo: "Exportador / shipper",
        valores: con,
        severidad: "MEDIA",
        titulo: `Exportador / shipper: ${con.map((x) => `${TIPO_DOC_LABEL[x.tipo].toLowerCase()} dice "${x.valor}"`).join(", ")}`,
        detalle:
          "La factura la emite el beneficiario y el BL/packing el productor que embarca. Que el embarcador no sea el beneficiario no es discrepancia: el artículo 14 (k) lo admite. Lo que sí tiene que emitir el beneficiario es la factura (18 a i).",
      });
    }
  }
  return out;
}

/* ------------------- RF-2.4: interpretación de la carta de crédito ------------------- */

/** Lo que la LC EXIGE (acotado a lo que mueve la aguja): qué documentos pide y
 *  los plazos/tolerancias que, si no se cumplen, hacen rebotar el cobro. */
export interface RequisitosLC {
  documentosExigidos: string[]; // campo 46A — nombres tal cual
  limiteEmbarque: CampoDoc; // 44C
  vencimiento: CampoDoc; // 31D
  plazoPresentacion: CampoDoc; // 48
  toleranciaCantidad: CampoDoc; // 39B / ±%
  parcialesPermitidos: CampoDoc; // 43P
}

export const SCHEMA_LC = {
  type: "object",
  properties: {
    exportador: campoSchema,
    importador: campoSchema,
    montoTotal: campoSchema,
    moneda: campoSchema,
    cantidad: campoSchema,
    unidad: campoSchema,
    mercaderia: campoSchema,
    puertoEmbarque: campoSchema,
    puertoDestino: campoSchema,
    fechaEmbarque: campoSchema,
    incoterm: campoSchema,
    numeroDoc: campoSchema,
    documentosExigidos: {
      type: "array",
      items: { type: "string" },
      description: "Documentos que la LC exige presentar (campo 46A), cada uno con su nombre tal cual aparece.",
    },
    limiteEmbarque: campoSchema, // fecha límite de embarque (44C)
    vencimiento: campoSchema, // vencimiento de la LC (31D)
    plazoPresentacion: campoSchema, // plazo para presentar documentos (48)
    toleranciaCantidad: campoSchema, // tolerancia de cantidad/monto (39B / +/- %)
    parcialesPermitidos: campoSchema, // embarques parciales permitidos o no (43P)
  },
  required: [
    "exportador",
    "importador",
    "montoTotal",
    "moneda",
    "cantidad",
    "unidad",
    "mercaderia",
    "puertoEmbarque",
    "puertoDestino",
    "fechaEmbarque",
    "incoterm",
    "numeroDoc",
    "documentosExigidos",
    "limiteEmbarque",
    "vencimiento",
    "plazoPresentacion",
    "toleranciaCantidad",
    "parcialesPermitidos",
  ],
  additionalProperties: false,
} as const;

export const PROMPT_LC =
  "Sos el analista documental de CEREALSUR S.A., trader de comercio exterior de carne. " +
  "Te paso el TEXTO o la imagen de una CARTA DE CRÉDITO (letter of credit). Extraé los campos pedidos " +
  "con el valor TAL CUAL aparece (no reformatees ni traduzcas). Para exportador/importador (beneficiario/" +
  "ordenante) solo la razón social. En documentosExigidos poné la LISTA de documentos que la LC pide presentar " +
  '(típicamente el campo 46A). Si un campo no aparece, valor "" y confianza 0. NUNCA inventes. ' +
  "Fechas tal cual estén en el documento.";

/** Demo determinista de una LC (sin clave): pide un certificado de origen que el
 *  checklist de ejemplo no tiene, y limita el embarque antes de lo previsto. */
export const LC_DEMO: RequisitosLC = {
  documentosExigidos: [
    "Signed commercial invoice",
    "Packing list",
    "Full set clean on board bill of lading",
    "Certificate of origin",
    "Health certificate issued by MGAP",
    "Halal certificate",
    // la LC pide una inspección que el checklist de la operación no tiene → falta
    "Inspection certificate issued by SGS",
  ],
  limiteEmbarque: { valor: "15-ago-26", confianza: 0.95 },
  vencimiento: { valor: "05-sep-26", confianza: 0.95 },
  plazoPresentacion: { valor: "21 days after shipment date", confianza: 0.9 },
  toleranciaCantidad: { valor: "±5%", confianza: 0.9 },
  parcialesPermitidos: { valor: "Not allowed", confianza: 0.9 },
};

/** Separa la respuesta de la LC en campos (para la matriz) + requisitos (para el checklist). */
export function normalizarLC(raw: unknown): { campos: CamposDoc; requisitos: RequisitosLC } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const campo = (k: string): CampoDoc => {
    const c = o[k] as Record<string, unknown> | undefined;
    return {
      valor: typeof c?.valor === "string" ? c.valor : "",
      confianza: normConfianza(c?.confianza),
    };
  };
  const docs = Array.isArray(o.documentosExigidos)
    ? (o.documentosExigidos as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  return {
    campos: normalizarCamposDoc(raw),
    requisitos: {
      documentosExigidos: docs,
      limiteEmbarque: campo("limiteEmbarque"),
      vencimiento: campo("vencimiento"),
      plazoPresentacion: campo("plazoPresentacion"),
      toleranciaCantidad: campo("toleranciaCantidad"),
      parcialesPermitidos: campo("parcialesPermitidos"),
    },
  };
}

/**
 * Lo que una línea del 46A pide, antes de describir cómo tiene que ser.
 *
 * Una línea del 46A nombra el documento y después lo describe: «INSURANCE POLICY OR CERTIFICATE
 * **FOR** 110 PCT OF INVOICE VALUE», «CERTIFICATE OF ORIGIN **ISSUED BY** CHAMBER OF COMMERCE
 * **CERTIFYING** THE INVOICE VALUE». Clasificar por las palabras que la línea menciona, en vez de
 * por el documento que pide, daba el peor falso negativo del motor: esa primera línea —la fórmula
 * estándar de cualquier crédito CIF— salía como FACTURA, la factura presentada la dejaba cumplida,
 * y **nadie exigía el seguro**. El banco pagaba un CIF sin póliza y esa línea se veía en verde.
 *
 * Así que se corta en la primera palabra que abre una descripción y se clasifica la cabeza. Si la
 * cabeza no dice nada reconocible, se mira la línea entera: perder una clasificación sería peor que
 * clasificar por una cláusula.
 */
/*
 * Las palabras con las que el 46A deja de nombrar el documento y empieza a describirlo.
 *
 * `drawn` es la que faltaba, y pega en una redacción de las más corrientes que hay: «BENEFICIARY
 * DRAFT **DRAWN ON** ISSUING BANK AT 90 DAYS FROM INVOICE DATE» es cómo se pide la letra en cualquier
 * crédito a plazo. Sin cortar ahí, la clasificación cae sobre la línea entera, la primera prueba de
 * `clavePorTexto` es `/invoice/`, y «INVOICE DATE» se la lleva: **la letra salía clasificada como la
 * factura comercial**.
 *
 * El daño es el de siempre y por los dos lados: el crédito quedaba pidiendo dos facturas —así que la
 * factura presentada daba por cumplidas las dos líneas— y la exigencia de la letra **nunca aparecía
 * como faltante**, aunque el motor no examine letras. Con el corte, la cabeza es «BENEFICIARY DRAFT»,
 * la clave es `GIRO`, y la línea sale FALTA, que es la verdad: el crédito pide un papel que este
 * examen no mira.
 */
const ABRE_DESCRIPCION =
  /\b(for|covering|certifying|confirming|stating|showing|indicating|including|evidencing|issued by|made out|marked|plus|dated|drawn|accompanied|declaring|mentioning|quoting)\b/;

/*
 * Las dos mitades se buscan sobre el texto **en minúsculas**, y el original se corta en ese índice.
 *
 * `ABRE_DESCRIPCION` no lleva la bandera `i` —`claveDoc` la usa sobre texto ya normalizado— y eso hacía
 * que las mismas funciones devolvieran cosas distintas según quién las llamara: con la línea del 46A en
 * mayúsculas, como viene del crédito, no matcheaba nada. Lo encontró la regla del certificado del
 * beneficiario en el caso de *Fortis Bank v Indian Overseas Bank*: decía que el papel repetía el texto
 * del crédito porque estaba comparando contra la cadena vacía.
 */
const abre = (s: string): number => {
  const m = ABRE_DESCRIPCION.exec(s.toLowerCase());
  return !m || m.index < 4 ? -1 : m.index;
};

export function cabezaDeExigencia(s: string): string {
  const i = abre(s);
  return i === -1 ? s : s.slice(0, i).trim();
}

/**
 * La otra mitad: **lo que el crédito le pide al papel que diga**.
 *
 * `cabezaDeExigencia` devuelve el nombre del documento; esto devuelve el resto — el texto que empieza
 * en «certifying», «stating», «showing». En un certificado del beneficiario ese resto es el **pro
 * forma**: la redacción que el papel tiene que reproducir. La Court of Appeal lo dijo así en *Fortis
 * Bank v Indian Overseas Bank*: *«the wording of the L/C sets out a pro forma certificate which is to
 * be issued by Stemcor»*, y de ahí sale que cambiar «OUR» por «ISSUING BANK'S» fuera discrepancia.
 *
 * Devuelve cadena vacía cuando la línea no abre descripción: ahí el crédito no pidió ningún texto.
 */
export function textoDeLaExigencia(s: string): string {
  const i = abre(s);
  return i === -1 ? "" : s.slice(i).trim();
}

/**
 * El plural entre paréntesis del 46A: «BILL(S) OF LADING», «DOCUMENT(S)», «INVOICE(S)».
 *
 * Es redacción corriente de un mensaje SWIFT —el emisor no sabe cuántos originales va a haber— y
 * **rompía el apareo entero**. `normTexto` cambia todo lo que no es letra ni número por un espacio,
 * así que «BILL(S) OF LADING» llegaba a los patrones como `bill s of lading` y ninguno lo reconocía:
 * la línea del 46A quedaba sin aparear, el conocimiento presentado salía desestimado por el artículo
 * 14 (g) como documento no exigido y **el capítulo del transporte entero no corría**.
 *
 * Lo encontró la Opinión R 638 / TA 629, cuyo crédito dice textualmente «Full set of at least 3/3
 * original clean on board marine bill(s) of lading»: el examen del caso salía con 18 reglas contra
 * las 31 de su vecino. Es la tercera vez que entra el mismo defecto por la misma puerta —antes fue
 * «B/LS» y antes la numeración «3.»— y las tres veces el síntoma fue el número de reglas corridas,
 * porque desde afuera un capítulo que no corre se ve igual que un documento que no se pidió.
 *
 * Se arregla acá y no en `normTexto` a propósito: ahí lo usan todas las comparaciones de texto del
 * motor, y lo que falla es el **apareo del nombre**. Y cubre `(s)` y `(es)` —el plural inglés— y no
 * `(ies)`, que necesitaría tocar la raíz: «copy(ies)» daría «copyies» y no «copies».
 */
function sinPluralEntreParentesis(s: string): string {
  return s.replace(/\((e?s)\)/gi, "$1");
}

/**
 * Si dos nombres o lugares se refieren a lo mismo.
 *
 * Se descartan las palabras de tres letras o menos —«S.A.», «de», «and»— porque hacen coincidir a
 * cualquiera. Pero cuando a un lado NO le queda ninguna palabra después de ese filtro, el nombre
 * entero es corto, y ahí descartarlo todo devolvía false: un ordenante llamado IBM, DHL o ABB,
 * escrito idéntico en el crédito y en la factura, salía como discrepancia. Lo mismo un puerto como
 * GOA o RIO.
 *
 * Era el falso positivo más barato de disparar del motor —no hacía falta ningún error en los
 * documentos, solo que alguien se llamara con tres letras— y tocaba siete reglas. Cuando no quedan
 * palabras largas se comparan los textos completos, que es lo único sensato con un nombre corto.
 *
 * **Y el filtro por largo no alcanzaba.** «PORT», «AIRPORT» y «TERMINAL» tienen más de tres letras,
 * así que **cualquier** par de lugares escritos con su genérico coincidía: «MONTEVIDEO AIRPORT»
 * contra «BUENOS AIRES AIRPORT» daba OK, y eso es un falso negativo del lado que paga de más —el
 * documento de transporte iba a otro puerto y la regla salía conforme—. Es el mismo defecto que las
 * once contrapartes del ERP que coincidían con las listas de sanciones por la palabra «LLC»: una
 * coincidencia apoyada en una palabra que está en todos los nombres del rubro no dice nada.
 *
 * El mismo puerto escrito de las dos formas sigue coincidiendo, porque lo que queda es el nombre
 * propio: «MONTEVIDEO PORT IN URUGUAY» contra «MONTEVIDEO, URUGUAY» comparten MONTEVIDEO.
 *
 * **Vive acá y no en `reglas-ucp.ts` para que haya un solo comparador de lugares.** Al agregar el
 * cruce de la ruta entre documentos —el laudo DOCDEX 290— se escribió un segundo comparador por
 * substring, y sobre el expediente real gritó enseguida: el conocimiento dice «MONTEVIDEO, URUGUAY» y
 * el packing «Montevideo Port, Uruguay», que es el mismo puerto escrito de dos maneras. Es la misma
 * lección que dejó *Bulgrains v Shinhan* con los nombres de parte: un concepto, un comparador.
 */
export const GENERICAS_DE_LUGAR = new Set([
  "PORT",
  "PORTS",
  "AIRPORT",
  "AIRPORTS",
  "SEAPORT",
  "SEAPORTS",
  "TERMINAL",
  "TERMINALS",
  /* «SHANGHAI CONTAINER TERMINAL» contra «BUSAN CONTAINER TERMINAL»: sacado el genérico de atrás,
     quedaba coincidiendo por el de adelante. */
  "CONTAINER",
  "CONTAINERS",
  "HARBOUR",
  "HARBOR",
  "CITY",
  /*
   * «WAREHOUSE» y los otros genéricos de la cobertura puerta a puerta, que faltaban.
   *
   * Lo encontró el test del 28 (f) (iii) al apretar la comparación con la Opinión TA 877: una póliza
   * que cubre «WAREHOUSE MONTEVIDEO» contra un crédito que dice «MONTEVIDEO PORT IN URUGUAY» cubre **de
   * más**, no otra cosa, y con «warehouse» contando como palabra distintiva pasaba a ser una diferencia
   * mutua. Son calificativos del lugar, igual que PORT o TERMINAL.
   */
  "WAREHOUSE",
  "WAREHOUSES",
  "DEPOT",
  "DOOR",
  "ALMACEN",
  "DEPOSITO",
  "PUERTO",
  "PUERTOS",
  "AEROPUERTO",
  "CIUDAD",
]);

export function coincideLugar(a: string, b: string): boolean {
  const na = normTexto(a).trim();
  const nb = normTexto(b).trim();
  if (!na || !nb) return false;
  const distintiva = (w: string) => w.length > 3 && !GENERICAS_DE_LUGAR.has(w.toUpperCase());
  const pa = na.split(" ").filter(distintiva);
  const pb = nb.split(" ").filter(distintiva);
  if (pa.length === 0 || pb.length === 0) {
    // Al menos uno es un nombre corto: se compara entero, y vale que uno esté dentro del otro
    // («IBM» contra «IBM WORLD TRADE CORPORATION»), por palabra para no casar fragmentos.
    const palabras = (t: string) => t.split(" ").filter(Boolean);
    const cortas = pa.length === 0 ? palabras(na) : palabras(nb);
    const otras = pa.length === 0 ? palabras(nb) : palabras(na);
    return cortas.length > 0 && cortas.every((w) => otras.includes(w));
  }
  /*
   * Y una palabra compartida **no alcanza cuando cada lado nombra otra cosa**.
   *
   * Es la Opinión **TA 877**: el crédito pedía descarga en «JIANGYIN FUJIAN, CHINA» y el conocimiento
   * decía «Jiangyin - Jiangsu» en el casillero del puerto de descarga. Comparten «Jiangyin» —y son dos
   * ciudades distintas, en dos provincias distintas— así que con «alguna palabra en común» el motor daba
   * OK sobre la discrepancia que la ICC declara válida.
   *
   *   «For the statement "Port of discharge: Jiangyin Fujian, China" to be considered as a notation
   *   giving the actual port of discharge, "Jiangyin Fujian" should appear in the field "Place of final
   *   destination" or words of similar effect.» — CONCLUSION: The discrepancy is valid.
   *
   * La condición es **mutua y por eso es segura**: cada lado tiene que traer una palabra distintiva que
   * el otro no tiene. Con eso «MONTEVIDEO, URUGUAY» contra «MONTEVIDEO» sigue coincidiendo —el segundo
   * no agrega nada— y lo mismo «BUSAN, KOREA» contra «BUSAN, REPUBLIC OF KOREA» o «SHANGHAI» contra
   * «SHANGHAI PUDONG». Lo que deja de coincidir es un nombre con **dos calificativos incompatibles**,
   * que es lo que distingue dos lugares homónimos.
   *
   * Lo que esto no resuelve es el mismo lugar escrito en dos idiomas —«HAMBURG, GERMANY» contra
   * «HAMBURG, DEUTSCHLAND»— que quedaría como diferencia mutua. En un crédito los puertos van en
   * inglés de los dos lados, así que es un riesgo chico y conocido; si aparece, el lugar de arreglarlo
   * es acá y con un caso que lo pruebe.
   */
  const compartenAlgo = pa.some((w) => pb.includes(w));
  if (!compartenAlgo) return false;
  const sobraEnA = pa.some((w) => !pb.includes(w));
  const sobraEnB = pb.some((w) => !pa.includes(w));
  return !(sobraEnA && sobraEnB);
}

/** Clave canónica de un documento (ES o EN) para cotejar la LC con el checklist. */
export function claveDoc(nombre: string): string {
  /*
   * La numeración del 46A no es parte del nombre del documento.
   *
   * Un crédito numera sus exigencias —«3.», «+3)», «3)»— y el intérprete de SWIFT las saca al armar
   * la lista. Pero la misma línea llega de dos lados: del crédito ya parseado y de la `exigencia`
   * que acompaña a un certificado presentado, que la pantalla llena con el texto de esa línea. Si
   * una de las dos trae el número, las dos claves difieren.
   *
   * Para los tipos que se reconocen por una palabra —factura, seguro, origen— no cambia nada: el
   * número no estorba. Pero la clave de un certificado del beneficiario **lleva su texto adentro**,
   * porque es lo único que distingue dos certificados que se llaman igual, y ahí un «3 » de más hace
   * que la línea del 46A salga **FALTA** con el papel presentado arriba de la mesa.
   *
   * Lo encontró un caso del banco de pruebas que escribió la exigencia con su número, que es como la
   * lee una persona del mensaje SWIFT.
   */
  const completo = normTexto(sinPluralEntreParentesis(nombre.replace(/^\s*\+?\d{1,2}\s*[.)]\s*/, "")));
  const cabeza = cabezaDeExigencia(completo);
  const k = cabeza === completo ? null : clavePorTexto(cabeza);
  if (!k || k.startsWith("TXT:")) return clavePorTexto(completo);
  /*
   * El certificado del beneficiario se distingue por lo que certifica, no por su nombre.
   *
   * El crédito real pide dos —uno por los gastos bancarios y otro por los documentos enviados por
   * correo— y los dos se llaman «BENEFICIARY'S CERTIFICATE». Si la clave saliera de la cabeza, los
   * dos serían el mismo documento y presentar uno daría por cumplidos los dos.
   *
   * **Pero esa segunda pasada tiene que quedarse dentro de la familia.** Mira la línea entera para
   * separar un certificado del otro, y la línea entera de un certificado del beneficiario **nombra
   * los documentos que certifica haber mandado**: «BENEFICIARY'S CERTIFICATE ALONG WITH RELEVANT
   * COURIER RECEIPT CERTIFYING THAT ONE SET OF PHOTOCOPIED SHIPPING DOCUMENTS PLUS 1/3 ORIGINAL
   * BILL OF LADING HAS BEEN SENT TO THE APPLICANT» es redacción corriente, y salía clasificada como
   * **documento de transporte** por el «bill of lading» que menciona su propio texto.
   *
   * El daño es el de siempre, por los dos lados a la vez: el crédito quedaba pidiendo dos documentos
   * de transporte —así que un conocimiento daba por cumplidas las dos líneas— y el certificado
   * presentado salía desestimado por el artículo 14 (g) como no exigido. Lo encontró la ficha del
   * recibo de courier del barrido de Opiniones, mirando con qué clave apareaba su línea del 46A.
   *
   * Así que si la línea entera no vuelve a dar un certificado del beneficiario, se arma la clave con
   * el texto completo en la familia que corresponde. Lo que la segunda pasada puede decidir es
   * **cuál** certificado del beneficiario es, no que no lo sea.
   */
  if (!k.startsWith("BENEFICIARIO")) return k;
  const porLaLinea = clavePorTexto(completo);
  return porLaLinea.startsWith("BENEFICIARIO") ? porLaLinea : `BENEFICIARIO:${completo.slice(0, 40)}`;
}

function clavePorTexto(s: string): string {
  if (/invoice|factura/.test(s)) return "INVOICE";
  if (/packing/.test(s)) return "PACKING";
  /*
   * La abreviatura también va en plural, y faltaba.
   *
   * `\bbl\b` reconocía «B/L» y no «B/LS», que es como un montón de créditos escriben la exigencia:
   * «3/3 ORIGINAL B/LS». Con eso la línea del 46A no se apareaba, el conocimiento presentado salía
   * desestimado por el artículo 14 (g) y **el capítulo del transporte entero no corría** — el mismo
   * defecto que los nombres de documento que no son «bill of lading», en la rama de al lado.
   *
   * Lo encontró el caso TA 869rev del banco de pruebas, mirando el **número de reglas corridas**: 17
   * contra las 28 de los casos vecinos. Es el único síntoma que tiene, porque desde afuera un
   * capítulo que no corre se ve igual que un documento que no se pidió.
   */
  if (/bills? of lading|\bb ls?\b|\bbls?\b|conocimiento de embarque/.test(s)) return "BL";
  /*
   * Los otros documentos de transporte, que también son `BL`.
   *
   * `BL` es el tipo genérico de transporte del motor y no solo el marítimo: `CAMPOS_POR_TIPO.BL`
   * lleva `tipoTransporte`, `charterParty` y `onDeck`, y de ahí `modoDelDocumento` decide con qué
   * artículo —del 19 al 25— se lo examina. Lo que faltaba era que la línea del 46A llegara hasta
   * ahí: sin estos nombres, un crédito que pide un air waybill daba la línea por **FALTA** aunque
   * el papel estuviera presentado, el documento presentado salía desestimado por el artículo 14
   * (g) como no exigido, y **ninguna** regla de los artículos 19, 21, 23, 24 y 25 corría. Con ella
   * se caía también el 44C, que es lo que cuesta plata: un aéreo emitido después del último
   * embarque no se marcaba.
   *
   * Van con el nombre entero y no con `waybill` suelto porque la clasificación cae sobre la línea
   * completa cuando la cabeza no alcanza, y ahí cualquier palabra ancha le roba la línea a otro
   * documento. El courier va más abajo, después del certificado del beneficiario, por esa misma
   * razón y está explicado allá.
   */
  if (/\bair ?way ?bills?\b|\bawbs?\b|\bair consignment notes?\b/.test(s)) return "BL";
  if (/\bmultimodal\b|\bcombined transport\b|\bintermodal\b|\bthrough bill\b/.test(s)) return "BL";
  if (/\bsea ?way ?bills?\b|\bnon.?negotiable sea\b/.test(s)) return "BL";
  if (/\bcmr\b|\brail ?way ?bills?\b|\bconsignment notes?\b|\bcartas? de porte\b|\binland waterway\b/.test(s))
    return "BL";
  // con límite de palabra: la «ORIGEN» salía de dentro de «ORIGINAL DOCUMENTS»
  if (/\borigin\b|\borigen\b/.test(s)) return "ORIGEN";
  if (/health|sanitary|sanitario|veterinar/.test(s)) return "SANITARIO";
  if (/halal/.test(s)) return "HALAL";
  if (/insurance|seguro/.test(s)) return "SEGURO";
  if (/weight|peso/.test(s)) return "PESO";
  /*
   * El certificado de recepción del transitario (FCR), que **no** es un documento de transporte.
   *
   * La línea sale textual del crédito del laudo DOCDEX 282 —EUR 7.200.000—: «FORWARDERS CERTIFICATE OF
   * RECEIPT FCR IN 1 ORIGINAL AND 1 COPY DATED NOT LATER THAN 30th AUGUST 2008 ISSUED BY COMPANY N».
   * Caía en `TXT:<la línea entera>`, que es el síntoma que la batería de `apareo-46a` vigila: con eso
   * la exigencia del 46A no aparea y el papel presentado sale desestimado por el artículo 14 (g).
   *
   * **Y tiene clave propia, no `BL`, y eso es lo importante.** Un FCR acredita que el transitario
   * recibió la mercadería: no es ninguno de los documentos de los artículos 19 a 25, así que se examina
   * con el 14 (f) y **no** se le piden anotación de a bordo, puertos ni capacidad de firma. Clasificarlo
   * como transporte sería peor que no reconocerlo: el motor le correría el capítulo del artículo 20 a un
   * papel que no lo es. El conocimiento **del** transitario —«FORWARDERS BILL OF LADING»— sí es
   * transporte, y lo agarra la prueba de `bills of lading` que está más arriba.
   */
  if (/forwarder.{0,3}certificate of receipt|\bfcr\b/.test(s)) return "FCR";
  /*
   * El mill's test certificate, que es donde vive la calidad medida de un metal.
   *
   * La línea sale textual del crédito del laudo DOCDEX 285: «SET OF MILL'S TEST CERTIFICATES […]
   * ADDITIONALLY 14 ELEMENTS AND VALUES OF TENSILE AND IMPACT TEST AT MINUS 20 DEGREE C TO BE STATED
   * IN THE MTC». Caía en `TXT:<la línea entera>`.
   *
   * **Clave propia y no `ANALISIS`**, aunque sea un certificado de calidad: un crédito de acero puede
   * pedir los dos —un certificado de calidad y el MTC del laminador— y con la misma clave uno de los
   * dos saldría FALTA con el papel arriba de la mesa. Lo que sí comparte con `ANALISIS` es el cotejo de
   * especificaciones contra el 45A, que es donde se miran la tracción y los catorce elementos.
   */
  if (/mill.{0,3}test|\bmtc\b/.test(s)) return "MTC";
  /*
   * La aceptación en sitio y la capacitación, que salieron del laudo DOCDEX 318.
   *
   * Van **antes** de la inspección a propósito: una línea como «SITE ACCEPTANCE TEST REPORT ISSUED BY
   * SURVEYOR» se la robaría `survey`, y lo propio de este papel es que acredita algo que ocurre **en
   * destino** —de eso depende la regla `cert-en-destino`— mientras una inspección es justamente lo que
   * se hace antes de embarcar. Sin estas dos claves las dos líneas caían en `TXT:<la línea entera>`, y
   * con eso el id de la regla llevaba el texto del 46A adentro: inestable y feo en la pantalla.
   */
  if (/site acceptance|acceptance test/.test(s)) return "ACEPTACION";
  if (/training|capacitacion/.test(s)) return "CAPACITACION";
  if (/inspection|inspeccion|survey/.test(s)) return "INSPECCION";
  // caso CSU2025099 (46A real): fumigación, análisis, certificados del beneficiario, giro
  if (/fumiga/.test(s)) return "FUMIGACION"; // "fumigation" y "fumigación"
  if (/analysis|analisis|calidad|quality/.test(s)) return "ANALISIS";
  // normTexto ya sacó el apóstrofo: "beneficiary s certificate"
  /*
   * Y admite una palabra en el medio: «BENEFICIARY'S **CONSOLIDATED** CERTIFICATE».
   *
   * El hueco era de tres caracteres —lo que ocupa el apóstrofo convertido en espacio— y la línea sale
   * textual del crédito de *Fortis Bank v Indian Overseas Bank*: con «consolidated» entre medio caía en
   * `TXT:<la línea entera>` y `cert-benef` **no corría**, que es la regla que coteja el texto certificado
   * contra el que el crédito exige. En ese pleito eso era justamente la única discrepancia válida.
   *
   * Las pruebas de más arriba son las que lo hacen seguro: el origen, el sanitario, la aceptación en
   * sitio y la capacitación ya se quedaron con su línea antes de llegar acá, así que un
   * «BENEFICIARY'S SIGNED CERTIFICATE OF SITE ACCEPTANCE TEST» sigue siendo `ACEPTACION` y un
   * «CERTIFICATE OF ORIGIN ISSUED BY THE BENEFICIARY» sigue siendo `ORIGEN`.
   */
  if (/beneficiary.{0,25}certificate|certificado del beneficiario/.test(s)) return `BENEFICIARIO:${s.slice(0, 40)}`;
  /*
   * El courier y el correo van acá, y el lugar no es un detalle.
   *
   * Cuando la cabeza de la línea es un certificado del beneficiario, `claveDoc` vuelve a
   * clasificar sobre **la línea entera** —porque los dos certificados del crédito real comparten
   * cabeza—. El crédito real pide un «BENEFICIARY'S CERTIFICATE STATING THAT DOCUMENTS WERE SENT
   * BY COURIER», así que un `/courier/` puesto más arriba le roba la línea al certificado: el
   * crédito quedaría pidiendo dos documentos de transporte y ningún certificado del beneficiario.
   * Es la misma trampa que ya se pagó con «INSURANCE … FOR 110 PCT OF INVOICE VALUE», que salía
   * FACTURA y dejaba al seguro sin exigir.
   */
  if (/\bcourier receipts?\b|\bpost receipts?\b|\bcertificates? of posting\b|\bexpress receipts?\b/.test(s))
    return "BL";
  if (/\bdraft|bill of exchange|letra de cambio|giro/.test(s)) return "GIRO";
  /* El aviso de embarque al ordenante: el crédito lo pide como documento y hay que presentarlo.
     Sin esto caía en `TXT:` con el texto entero de la exigencia, que nunca coincide con el título
     del papel, y el documento quedaba afuera del examen. Va DESPUÉS del conocimiento de embarque
     para que «shipment» no le robe el BL. */
  /*
   * El aviso de embarque, que se escribe «shipment advice» mucho más seguido que «shipment notice».
   *
   * Faltaba el sinónimo más común, y costaba por los dos lados que esta familia de defectos ya tiene:
   *
   * - «SHIPMENT ADVICE SENT TO THE INSURERS WITHIN 5 DAYS AFTER SHIPMENT DATE» caía en `TXT:<línea>`,
   *   o sea **sin aparear**: la línea del 46A quedaba en FALTA para siempre y el papel presentado
   *   salía desestimado por el artículo 14 (g) como documento no exigido.
   * - «SHIPMENT ADVICE QUOTING THE BILL OF LADING NUMBER AND THE INVOICE VALUE» era peor: la cabeza
   *   se corta en «quoting», «shipment advice» no se reconocía, así que la clasificación caía sobre la
   *   línea entera y **la factura se la robaba** por el «INVOICE VALUE» del final.
   *
   * Es la quinta vez que un documento se pierde por un nombre que el motor no conoce —después del
   * seguro, el air waybill, «B/LS» en plural y la letra— y la primera por un sinónimo que faltaba y no
   * por una línea robada. Lo encontró una batería de redacciones reales del 46A pasadas por `claveDoc`,
   * que es el método que esta familia de defectos pide.
   */
  if (/shipment notice|shipment advice|notice of shipment|advice of shipment|aviso de embarque/.test(s))
    return "AVISO_EMBARQUE";
  return `TXT:${s}`;
}

/* ------------- Etapa 2: la LC interpretada contra lo cargado en la operación ------------- */

export interface DiferenciaLC {
  campo: string;
  operacion: string;
  lc: string;
  /** DIFERENTE = corregir la operación (o pedir enmienda); SIN_DATO = la operación no lo tiene cargado */
  estado: "OK" | "DIFERENTE" | "SIN_DATO";
  /** valor para "tomar el de la LC" */
  tomar?: Partial<LcInfo>;
}

/**
 * Caso CSU2025099: la proforma decía 30 días de presentación y la LC 21; la tolerancia era
 * 10 % y la operación tenía el ±5 % por defecto. Manda la LC. Esto compara lo que la LC
 * dice contra lo cargado en la operación y devuelve qué corregir.
 */
export function cotejarLCconOperacion(req: RequisitosLC, campos: CamposDoc, op: OperationDetail): DiferenciaLC[] {
  const out: DiferenciaLC[] = [];
  const lc = op.lc;
  const fila = (
    campo: string,
    operacion: string | null | undefined,
    valorLC: string | null | undefined,
    iguales: boolean,
    tomar?: Partial<LcInfo>,
  ) => {
    if (!valorLC) return;
    if (!operacion || operacion === "—") {
      out.push({ campo, operacion: "sin cargar", lc: valorLC, estado: "SIN_DATO", tomar });
      return;
    }
    out.push({
      campo,
      operacion,
      lc: valorLC,
      estado: iguales ? "OK" : "DIFERENTE",
      tomar: iguales ? undefined : tomar,
    });
  };
  const n = usable(campos.numeroDoc)?.valor;
  fila("Número de la LC", lc?.numero, n, normTexto(lc?.numero ?? "") === normTexto(n ?? ""), {
    numero: n ?? undefined,
  });
  const venc = usable(req.vencimiento)?.valor;
  fila("Vencimiento", lc?.vencimiento, venc, sameFecha(lc?.vencimiento, venc), { vencimiento: venc ?? undefined });
  const lim = usable(req.limiteEmbarque)?.valor;
  fila("Último embarque", lc?.limiteEmbarque, lim, sameFecha(lc?.limiteEmbarque, lim), {
    limiteEmbarque: lim ?? undefined,
  });
  const plazoLC = usable(req.plazoPresentacion)?.valor;
  const dLC = diasPresentacion(plazoLC),
    dOp = diasPresentacion(lc?.plazoPresentacion);
  fila("Plazo de presentación", lc?.plazoPresentacion, plazoLC, dLC != null && dLC === dOp, {
    plazoPresentacion: plazoLC ?? undefined,
  });
  const tolLC = parseTolerancia(usable(req.toleranciaCantidad)?.valor);
  if (tolLC != null) {
    const tolOp = lc?.tolerancia ?? null;
    const txt = (t: number) => `±${Math.round(t * 1000) / 10} %`;
    if (!lc)
      out.push({
        campo: "Tolerancia",
        operacion: "sin cargar",
        lc: txt(tolLC),
        estado: "SIN_DATO",
        tomar: { tolerancia: tolLC },
      });
    else if (tolOp == null)
      out.push({
        campo: "Tolerancia",
        operacion: `±5 % (por defecto)`,
        lc: txt(tolLC),
        estado: tolLC === 0.05 ? "OK" : "DIFERENTE",
        tomar: { tolerancia: tolLC },
      });
    else
      out.push({
        campo: "Tolerancia",
        operacion: txt(tolOp),
        lc: txt(tolLC),
        estado: Math.abs(tolOp - tolLC) < 1e-9 ? "OK" : "DIFERENTE",
        tomar: { tolerancia: tolLC },
      });
  }
  // monto: la LC tiene que cubrir la venta (con su tolerancia); si la venta es mayor, no cobra todo
  const montoLC = parseNumero(usable(campos.montoTotal)?.valor ?? "");
  const venta = op.legs.find((l) => l.tipo === "VENTA")?.montoTotal ?? null;
  if (montoLC != null && montoLC > 0) {
    if (venta == null) out.push({ campo: "Monto", operacion: "sin cargar", lc: fmtMonto(montoLC), estado: "SIN_DATO" });
    else {
      // El Monto es importe: el 5 % del 30 (b) es de cantidad y no aplica acá.
      const tol = tolLC ?? toleranciaDeImporte(lc);
      const cubre = venta <= montoLC * (1 + tol) + 1e-9;
      out.push({
        campo: "Monto",
        operacion: fmtMonto(venta),
        lc: fmtMonto(montoLC),
        estado: cubre ? "OK" : "DIFERENTE",
      });
    }
  }
  const incoLC = usable(campos.incoterm)?.valor;
  if (incoLC) {
    const incoOp = op.legs.find((l) => l.tipo === "VENTA")?.incoterm ?? op.incoterm;
    /*
     * Se comparan los códigos, no los textos.
     *
     * El 45A escribe el incoterm con el lugar pegado —«CFR COLOMBO,SRI LANKA INCOTERMS 2020»— y el
     * extractor lo trae tal cual, que es lo que corresponde. Comparar eso como texto contra el
     * «CFR» de la operación daba DIFERENTE siempre. La matriz de este mismo archivo ya usa
     * `codigoIncoterm` para lo mismo: dos funciones del módulo contestaban distinto sobre el mismo
     * dato.
     */
    out.push({
      campo: "Incoterm",
      operacion: incoOp || "sin cargar",
      lc: incoLC,
      estado: !incoOp ? "SIN_DATO" : codigoIncoterm(incoOp) === codigoIncoterm(incoLC) ? "OK" : "DIFERENTE",
    });
  }
  return out;
}

function sameFecha(a: string | null | undefined, b: string | null | undefined): boolean {
  const fa = a ? parseFecha(a) : null,
    fb = b ? parseFecha(b) : null;
  return Boolean(fa && fb && fa.getTime() === fb.getTime());
}

/**
 * Coteja los documentos que la LC exige contra el checklist de la operación:
 * cuáles ya están (para marcarlos exigidos por LC) y cuáles FALTAN (la LC pide
 * algo que el checklist no tiene — el hallazgo que evita un rechazo bancario).
 */
export function cotejarLC(
  documentosExigidos: string[],
  checklist: ChecklistRow[],
): { cubiertos: { doc: string; label: string }[]; faltantes: string[] } {
  const claves = checklist.map((c) => ({ clave: claveDoc(c.label), label: c.label }));
  const cubiertos: { doc: string; label: string }[] = [];
  const faltantes: string[] = [];
  for (const doc of documentosExigidos) {
    const k = claveDoc(doc);
    const match = claves.find(
      (c) =>
        c.clave === k ||
        (k.startsWith("TXT:") && (c.clave.includes(k.slice(4)) || k.slice(4).includes(c.clave.replace("TXT:", "")))),
    );
    if (match) cubiertos.push({ doc, label: match.label });
    else faltantes.push(doc);
  }
  return { cubiertos, faltantes };
}

/**
 * Qué campos puede traer cada tipo de documento.
 *
 * El esquema completo tiene treinta y seis campos y la API los rechaza: «the compiled grammar is too
 * large». Creció de a poco —transporte, seguro, certificados— y nunca se pudo probar la extracción
 * contra la API de verdad por falta de clave, así que el límite se cruzó sin que nadie lo viera.
 *
 * Pero achicar por achicar sería perder campos. Lo que corresponde es pedirle a cada documento lo
 * que **ese documento** puede tener: a un conocimiento de embarque no se le pregunta el monto
 * asegurado, y preguntárselo no solo agranda la gramática — invita al modelo a inventar.
 */
export const CAMPOS_SEGURO: (keyof CamposDoc)[] = [
  "tipoSeguro",
  "vigenciaSeguro",
  "emisorSeguro",
  "fechaSeguro",
  "montoAsegurado",
  "monedaAsegurada",
  "coberturaDesde",
  "coberturaHasta",
  "numeroDoc",
  "mercaderia",
  "puertoEmbarque",
  "puertoDestino",
];

/**
 * Los campos de un certificado del 46A: los que este archivo lee de verdad.
 *
 * Estaba escrito a mano en la pantalla, que es la forma que tuvo el peor defecto del repo —una
 * lista de diecinueve campos contra un esquema de treinta y uno, y siete artículos del transporte
 * que nunca corrían por falta de dónde escribir el dato—. Acá la lista vive al lado de las reglas
 * que la consumen, con un test que la contrasta contra el archivo.
 *
 * `exportador` y `fechaSeguro` no están: no son campos propios, son los respaldos con que se leen
 * el emisor y la fecha cuando la extracción los nombró así. Darles casilla propia pondría dos
 * casillas para el mismo dato.
 */
export const CAMPOS_CERTIFICADO: (keyof CamposDoc)[] = [
  /* Quién emite el certificado, que es lo que deciden la ISBP Q3 a Q5 y el 46A cuando el crédito
     nombra al emisor. La regla pasó a leer `emisor` con `emisorSeguro` de respaldo y la lista se
     quedó con el respaldo solo: sin esta entrada no hay casilla donde escribirlo ni campo que la
     extracción pida, así que la regla salía en ATENCION para siempre. Lo agarró el guard de cotejo. */
  "emisor",
  "emisorSeguro",
  /* El número del crédito que el papel cita: si cita otro, contradice al crédito (art. 14 d). Es
     donde un banco real encontró dos de las tres observaciones de una presentación. */
  "numeroLC",
  "mercaderia",
  "fechaDocumento",
  "numeroDoc",
  "puertoEmbarque",
  "pesoBruto",
  "referenciaProforma",
];

export const CAMPOS_POR_TIPO: Record<TipoDocExterno, (keyof CamposDoc)[]> = {
  FACTURA: [
    // El primero: si se titula «proforma» no satisface la exigencia de factura comercial.
    "tipoDocumento",
    "exportador",
    "importador",
    "montoTotal",
    "moneda",
    "cantidad",
    "unidad",
    "precioUnitario",
    "mercaderia",
    "puertoEmbarque",
    "puertoDestino",
    "fechaEmbarque",
    "incoterm",
    "numeroDoc",
    "fechaDocumento",
    "numeroLC",
    "referenciaProforma",
    "flete",
    "hsCode",
  ],
  PACKING: [
    "exportador",
    "importador",
    "cantidad",
    "unidad",
    "bultos",
    "tipoBulto",
    "pesoBruto",
    "mercaderia",
    "numeroDoc",
    "fechaDocumento",
    "numeroLC",
    "hsCode",
  ],
  BL: [
    // El primero a propósito: de cómo se titula el documento sale con qué artículo se lo examina.
    "tipoTransporte",
    "exportador",
    /*
     * El importador NO se le pide a un conocimiento de embarque.
     *
     * En un BL el importador es el notify party —lo dice el propio prompt— así que pedir los dos es
     * leer el mismo dato dos veces, y el código ya prefiere `notify` con `importador` de respaldo.
     * El lugar importa: la gramática de la extracción tiene un tope de campos verificado en
     * veintitrés, y el que entró en su lugar decide con qué artículo se examina el documento.
     */
    "consignatario",
    "notify",
    "cantidad",
    "unidad",
    "bultos",
    "tipoBulto",
    "pesoBruto",
    "mercaderia",
    "puertoEmbarque",
    "puertoDestino",
    "fechaEmbarque",
    "numeroDoc",
    "fechaDocumento",
    "numeroLC",
    "flete",
    "onBoard",
    "buque",
    "charterParty",
    "onDeck",
    "clausulaDefecto",
    "juegoOriginales",
  ],
  LC: [
    "exportador",
    "importador",
    "montoTotal",
    "moneda",
    "cantidad",
    "unidad",
    "mercaderia",
    "puertoEmbarque",
    "puertoDestino",
    "fechaEmbarque",
    "incoterm",
    "numeroDoc",
    "hsCode",
  ],
  /*
   * De un certificado se leen pocos campos y a propósito.
   *
   * Son los que las reglas miran de verdad —quién lo emite, cuándo, qué certifica, su número, el
   * lugar y el peso— y nada más: pedirle a un certificado de fumigación el flete o el incoterm es
   * invitar al modelo a inventarlos. Es la misma lista que la pantalla ofrece para cargarlo a mano.
   */
  CERTIFICADO: CAMPOS_CERTIFICADO,
  SEGURO: CAMPOS_SEGURO,
};

/** Los campos del documento de seguro, que no es un `TipoDocExterno` pero se lee igual. */

/**
 * El esquema para un tipo de documento.
 *
 * **Todos los campos van en `required`, y eso no es un descuido.** Lo que la API rechaza no es la
 * cantidad de campos sino la de **opcionales**: «Schemas contains too many optional parameters (46),
 * which would make grammar compilation inefficient». Con seis obligatorios de veintitrés, los otros
 * diecisiete se multiplican por dos —presente o ausente— y la gramática explota.
 *
 * Exigirlos todos no le pide al modelo que invente: el prompt le dice que un campo que no aparece va
 * con `valor: ""` y `confianza: 0`, así que devolverlos todos ya era lo esperado.
 *
 * Medido contra la API: veintitrés campos con todos obligatorios compila en once segundos; treinta y
 * seis, aun todos obligatorios, ya no entra. Por eso además hace falta el esquema por tipo.
 */
export function schemaPara(campos: (keyof CamposDoc)[]) {
  return {
    type: "object",
    properties: Object.fromEntries(campos.map((c) => [c, campoSchema])),
    required: [...campos],
    additionalProperties: false,
  } as const;
}

/**
 * La cantidad que el crédito pide, leída del campo 45A.
 *
 * El 45A es prosa: «57 MTS OF FISH MEAL 54PCT MIN (FOR ANIMAL FEED USE)». Lo que se busca es el
 * Devuelve también `en`, la posición del número en el texto: el 30 (a) solo da su ±10 % cuando
 * «about» está «used in connection with … the quantity», así que quien aplique la tolerancia
 * necesita saber dónde está la cantidad para mirar si el «about» le corresponde a ella.
 *
 * primer número con una unidad **de cantidad**, y por eso la unidad se exige: en esa misma línea
 * hay un 54 que es la proteína y un «2301.20.00» que es la posición arancelaria, y tomar cualquiera
 * de los dos por la cantidad del embarque sería peor que no mirar.
 */
/**
 * Todas las cantidades con unidad que el 45A nombra, en orden y con su posición.
 *
 * Existe aparte porque **«no hay ninguna» y «hay varias y no se puede elegir» son dos cosas
 * distintas** y `cantidadDelCredito` devuelve `null` en las dos. Un crédito que describe la
 * mercadería sin cantidad («FISH MEAL 54PCT MIN») no da nada contra qué comparar: ahí callarse es
 * correcto. Uno con dos ítems y sin total («500 MT OF SOYBEAN MEAL AND 300 MT OF SUNFLOWER MEAL»)
 * sí tiene cantidades, y que el examen se saltee la línea en silencio se lee como «no aplica».
 */
export function cantidadesDelCredito(
  mercaderia: string | null | undefined,
): { valor: number; unidad: string; en: number; crudo: string }[] {
  const t = (mercaderia ?? "").trim();
  if (!t) return [];
  const re =
    /(\d+(?:[.,]\d+)*)\s*(kgs?|kilos?|kilogramos?|mts?|tms?|tns?|tons?|tonnes?|toneladas?|lbs?|pounds?|bags?|bultos?|cartons?|cajas?|drums?|tambores?|pallets?|pal[eé]s?|units?|unidades?|pcs?|piezas?|cabezas?|heads?|litros?|lt?rs?|liters?|litres?|m3|cbm)\b/gi;
  return [...t.matchAll(re)]
    .map((m) => ({ valor: parseNumero(m[1] ?? ""), unidad: (m[2] ?? "").trim(), en: m.index ?? 0, crudo: m[0] }))
    .filter((x): x is { valor: number; unidad: string; en: number; crudo: string } => x.valor !== null);
}

export function cantidadDelCredito(
  mercaderia: string | null | undefined,
): { valor: number; unidad: string; en: number } | null {
  const t = (mercaderia ?? "").trim();
  if (!t) return null;
  const encontradas = cantidadesDelCredito(mercaderia);
  if (encontradas.length === 0) return null;
  if (encontradas.length === 1)
    return { valor: encontradas[0]!.valor, unidad: encontradas[0]!.unidad, en: encontradas[0]!.en };

  /*
   * Con más de una cantidad, la que vale es la que el crédito anuncia como el total.
   *
   * Los créditos describen el envase antes del total todo el tiempo —«PACKED IN 50 KG BAGS, TOTAL 57
   * MTS»— y quedarse con la primera hacía comparar la factura contra el peso de una bolsa: una
   * discrepancia de seis cifras sobre una factura correcta, la misma clase de error de mil veces que
   * este repo ya pagó con «53,960».
   *
   * Y lo que viene después de «of» o «each» es el contenido de un bulto, no el embarque.
   */
  const ANUNCIA_TOTAL =
    /\b(total|quantity|cantidad|net\s+weight|peso\s+neto|gross\s+weight|peso\s+bruto)\b[^\d]{0,24}$/i;
  const DEL_BULTO = /\b(of|de|each|cada|c\/u)\s*$/i;
  const anunciadas = encontradas.filter((x) => ANUNCIA_TOTAL.test(t.slice(Math.max(0, x.en - 40), x.en)));
  if (anunciadas.length === 1) {
    return { valor: anunciadas[0]!.valor, unidad: anunciadas[0]!.unidad, en: anunciadas[0]!.en };
  }

  const noDelBulto = encontradas.filter((x) => !DEL_BULTO.test(t.slice(Math.max(0, x.en - 12), x.en)));
  if (noDelBulto.length === 1) {
    return { valor: noDelBulto[0]!.valor, unidad: noDelBulto[0]!.unidad, en: noDelBulto[0]!.en };
  }

  /*
   * Si siguen quedando varias, no se elige.
   *
   * Dos ítems distintos —«500 MT OF SOYBEAN MEAL AND 300 MT OF SUNFLOWER MEAL»— no tienen un total
   * que el motor pueda deducir, y elegir uno daría una discrepancia inventada sobre la suma. El
   * examen lo dice en vez de decidir.
   */
  return null;
}
