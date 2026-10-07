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
export type TipoDocExterno = "FACTURA" | "LC" | "PACKING" | "BL" | "CERTIFICADO";

export const TIPO_DOC_LABEL: Record<TipoDocExterno, string> = {
  FACTURA: "Factura comercial",
  LC: "Carta de crédito",
  PACKING: "Packing list",
  BL: "Bill of lading",
  CERTIFICADO: "Certificado del 46A",
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
  precioUnitario?: CampoDoc; // "USD 800,00" — con él y el total se desambigua una cantidad
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
    precioUnitario: campoSchema,
    tipoSeguro: campoSchema,
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
  "bultos = número TOTAL de bultos del documento (si hay varios contenedores, la suma; si es una hoja parcial —'sheet 1 of 2'— bajá la confianza a < 0.6); " +
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
 * El BL del caso real dice "cartons" y el packing list "bags" del mismo embarque: UCP 600 art. 14d
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
        const texto = (u && u.confianza >= 0.4 && u.valor) || c.valor;
        const kg = aKg(n, texto);
        // En kilos cuando se puede; si no, en su propia unidad, y solo se comparan entre sí las que
        // están en la misma. Sin esto, todo lo que no fuera peso quedaba sin comparar.
        const unidad = kg == null ? unidadNormal(texto) : "kg";
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
const ABRE_DESCRIPCION =
  /\b(for|covering|certifying|confirming|stating|showing|indicating|including|evidencing|issued by|made out|marked|plus|dated|accompanied|declaring|mentioning|quoting)\b/;

export function cabezaDeExigencia(s: string): string {
  const m = ABRE_DESCRIPCION.exec(s);
  if (!m || m.index < 4) return s;
  return s.slice(0, m.index).trim();
}

/** Clave canónica de un documento (ES o EN) para cotejar la LC con el checklist. */
export function claveDoc(nombre: string): string {
  const completo = normTexto(nombre);
  const cabeza = cabezaDeExigencia(completo);
  const k = cabeza === completo ? null : clavePorTexto(cabeza);
  if (!k || k.startsWith("TXT:")) return clavePorTexto(completo);
  /*
   * El certificado del beneficiario se distingue por lo que certifica, no por su nombre.
   *
   * El crédito real pide dos —uno por los gastos bancarios y otro por los documentos enviados por
   * correo— y los dos se llaman «BENEFICIARY'S CERTIFICATE». Si la clave saliera de la cabeza, los
   * dos serían el mismo documento y presentar uno daría por cumplidos los dos.
   */
  return k.startsWith("BENEFICIARIO") ? clavePorTexto(completo) : k;
}

function clavePorTexto(s: string): string {
  if (/invoice|factura/.test(s)) return "INVOICE";
  if (/packing/.test(s)) return "PACKING";
  if (/bills? of lading|\bb l\b|\bbl\b|conocimiento de embarque/.test(s)) return "BL";
  // con límite de palabra: la «ORIGEN» salía de dentro de «ORIGINAL DOCUMENTS»
  if (/\borigin\b|\borigen\b/.test(s)) return "ORIGEN";
  if (/health|sanitary|sanitario|veterinar/.test(s)) return "SANITARIO";
  if (/halal/.test(s)) return "HALAL";
  if (/insurance|seguro/.test(s)) return "SEGURO";
  if (/weight|peso/.test(s)) return "PESO";
  if (/inspection|inspeccion|survey/.test(s)) return "INSPECCION";
  // caso CSU2025099 (46A real): fumigación, análisis, certificados del beneficiario, giro
  if (/fumiga/.test(s)) return "FUMIGACION"; // "fumigation" y "fumigación"
  if (/analysis|analisis|calidad|quality/.test(s)) return "ANALISIS";
  // normTexto ya sacó el apóstrofo: "beneficiary s certificate"
  if (/beneficiary.{0,3}certificate|certificado del beneficiario/.test(s)) return `BENEFICIARIO:${s.slice(0, 40)}`;
  if (/\bdraft|bill of exchange|letra de cambio|giro/.test(s)) return "GIRO";
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
  "emisorSeguro",
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
};

/** Los campos del documento de seguro, que no es un `TipoDocExterno` pero se lee igual. */
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
 * primer número con una unidad **de cantidad**, y por eso la unidad se exige: en esa misma línea
 * hay un 54 que es la proteína y un «2301.20.00» que es la posición arancelaria, y tomar cualquiera
 * de los dos por la cantidad del embarque sería peor que no mirar.
 */
export function cantidadDelCredito(mercaderia: string | null | undefined): { valor: number; unidad: string } | null {
  const t = (mercaderia ?? "").trim();
  if (!t) return null;
  const re =
    /(\d+(?:[.,]\d+)*)\s*(kgs?|kilos?|kilogramos?|mts?|tms?|tns?|tons?|tonnes?|toneladas?|lbs?|pounds?|bags?|bultos?|cartons?|cajas?|drums?|tambores?|pallets?|pal[eé]s?|units?|unidades?|pcs?|piezas?|cabezas?|heads?|litros?|lt?rs?|liters?|litres?|m3|cbm)\b/gi;
  const encontradas = [...t.matchAll(re)]
    .map((m) => ({ valor: parseNumero(m[1] ?? ""), unidad: (m[2] ?? "").trim(), en: m.index ?? 0, crudo: m[0] }))
    .filter((x): x is { valor: number; unidad: string; en: number; crudo: string } => x.valor !== null);
  if (encontradas.length === 0) return null;
  if (encontradas.length === 1) return { valor: encontradas[0]!.valor, unidad: encontradas[0]!.unidad };

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
    return { valor: anunciadas[0]!.valor, unidad: anunciadas[0]!.unidad };
  }

  const noDelBulto = encontradas.filter((x) => !DEL_BULTO.test(t.slice(Math.max(0, x.en - 12), x.en)));
  if (noDelBulto.length === 1) {
    return { valor: noDelBulto[0]!.valor, unidad: noDelBulto[0]!.unidad };
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
