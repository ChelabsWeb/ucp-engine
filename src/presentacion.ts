import { type CamposDoc, claveDoc, compararEntreDocumentos, parseNumero, type TipoDocExterno } from "./consistencia";
import { diffDias, parseFecha } from "./fechas";
import { limitePresentacion, toleranciaDe } from "./lc";
import type { DocumentRow, LcInfo, OperationDetail } from "./types";

/**
 * Pre-check UCP 600 del paquete documental ANTES de presentarlo al banco (oportunidades A1/A2).
 *
 * El banco examina documentos, no mercadería (art. 5), y el 70 % de las presentaciones se
 * rechazan a la primera por discrepancias formales (intro UCP 600). Cada rechazo cuesta el fee
 * del 47A (USD 80 en el caso CSU2025099) y deja el cobro a voluntad del comprador. Este motor es
 * PURO: recibe la LC cargada (46A/47A/fechas/monto), los documentos externos ya analizados por
 * la IA, los documentos generados y el checklist, y devuelve regla por regla qué está bien, qué
 * falta y qué es discrepancia, con la evidencia.
 */

export type EstadoRegla = "OK" | "FALTA" | "DISCREPANCIA" | "ATENCION" | "SIN_DATO";

export interface ReglaPresentacion {
  id: string;
  /** de dónde sale la regla: "46A+2", "47A+1", "UCP 600 14c"… */
  fuente: string;
  regla: string;
  estado: EstadoRegla;
  evidencia: string;
}

export interface Ejemplares {
  originales: number | null;
  copias: number | null;
  texto: string;
}

/** "IN 03 FOLD" → 3 · "FULL SET OF (3/3) … PLUS 02 NON NEGOTIABLE COPIES" → 3 originales + 2 copias · "IN DUPLICATE" → 2. */
export function ejemplaresDe(texto: string): Ejemplares {
  const t = texto.toUpperCase();
  const set = /\((\d)\s*\/\s*(\d)\)|FULL SET OF\s*(\d)/.exec(t);
  const copias = /(\d{1,2})\s*(?:NON[- ]NEGOTIABLE\s+)?COP(?:Y|IES)/.exec(t);
  const fold = /IN\s*(\d{1,2})\s*FOLD/.exec(t);
  const palabra = /\b(DUPLICATE|TRIPLICATE|QUADRUPLICATE)\b/.exec(t);
  const originales = set
    ? Number(set[1] ?? set[3])
    : fold
      ? Number(fold[1])
      : palabra
        ? ({ DUPLICATE: 2, TRIPLICATE: 3, QUADRUPLICATE: 4 }[palabra[1]] ?? null)
        : null;
  const nCopias = copias ? Number(copias[1]) : null;
  const partes = [
    originales != null ? `${originales} original${originales > 1 ? "es" : ""}` : null,
    nCopias != null ? `${nCopias} copia${nCopias > 1 ? "s" : ""}` : null,
  ].filter(Boolean);
  return { originales, copias: nCopias, texto: partes.join(" + ") || "sin cantidad indicada" };
}

/** "A DISCREPANCY FEE OF USD 80/- OR ITS EQUIVALENT WILL BE DEDUCTED…" → 80 */
export function feeDiscrepancia(condiciones: string[] | null | undefined): number | null {
  for (const c of condiciones ?? []) {
    const m =
      /DISCREPANC\w*\s+(?:FEE|CHARGE)[^0-9]{0,40}?(?:USD|US\$|EUR|GBP)?\s*([\d.,]+)/i.exec(c) ??
      /(?:USD|US\$)\s*([\d.,]+)[^.]{0,60}DISCREPANC/i.exec(c);
    if (m) {
      const n = parseNumero(m[1]);
      if (n != null && n > 0) return n;
    }
  }
  return null;
}

/** El tipo de documento analizable que cubre una clave del 46A (INVOICE → FACTURA…). */
const TIPO_DE_CLAVE: Record<string, TipoDocExterno> = { INVOICE: "FACTURA", PACKING: "PACKING", BL: "BL" };
/** Documento GENERADO por romai que cubre una clave del 46A. */
const GENERADO_DE_CLAVE: Record<string, string[]> = {
  INVOICE: ["Commercial invoice (draft)"],
  PACKING: ["Packing list preliminar"],
  PESO: ["Weight note"],
};
const APROBADO = new Set(["APROBADO", "ENVIADO", "VALIDADO"]);

export interface DocAnalizado {
  tipo: TipoDocExterno;
  campos: CamposDoc;
  nombreArchivo?: string;
}

export interface ResultadoPresentacion {
  reglas: ReglaPresentacion[];
  faltan: number;
  discrepancias: number;
  atencion: number;
  listo: boolean;
  feePorJuego: number | null;
  /** días que quedan para presentar (negativo = vencido), si se puede calcular */
  diasParaPresentar: number | null;
}

export function precheckPresentacion(input: {
  lc: LcInfo;
  docs: DocAnalizado[];
  op: OperationDetail;
  empresaRazonSocial: string;
  /** dirección de la empresa en Ajustes (para cotejar con la de la LC, D3) */
  empresaDireccion?: string | null;
  hoy: Date;
}): ResultadoPresentacion {
  const { lc, op, hoy } = input;
  // un documento analizado por tipo: el primero (la ficha los pasa del más nuevo al más viejo)
  const vistos = new Set<TipoDocExterno>();
  const docs = input.docs.filter((d) => (vistos.has(d.tipo) ? false : (vistos.add(d.tipo), true)));
  const reglas: ReglaPresentacion[] = [];
  const val = (d: DocAnalizado | undefined, k: keyof CamposDoc): string | null => {
    const c = d?.campos[k];
    return c && c.valor.trim() && c.confianza >= 0.4 ? c.valor.trim() : null;
  };
  const doc = (t: TipoDocExterno) => docs.find((d) => d.tipo === t);
  const generado = (nombres: string[]): DocumentRow | undefined =>
    op.documentos.find((d) => nombres.includes(d.nombre));
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const emision = lc.fechaEmision ? parseFecha(lc.fechaEmision) : null;

  /* ---- 46A: cada documento exigido, ¿está y con cuántos ejemplares? ---- */
  const exigidos = lc.documentosExigidos ?? [];
  exigidos.forEach((texto, i) => {
    const k = claveDoc(texto);
    const ej = ejemplaresDe(texto);
    const id = `46A+${i + 1}`;
    const tipo = TIPO_DE_CLAVE[k];
    const analizado = tipo ? doc(tipo) : undefined;
    const gen = generado(
      GENERADO_DE_CLAVE[k] ?? (k.startsWith("BENEFICIARIO") ? ["Certificado del beneficiario"] : []),
    );
    const enChecklist = op.checklist.find((c) => claveDoc(c.label) === k);
    const resumen = texto.length > 90 ? `${texto.slice(0, 87)}…` : texto;
    if (analizado) {
      reglas.push({
        id,
        fuente: id,
        regla: resumen,
        estado: "OK",
        evidencia: `Analizado (${analizado.nombreArchivo ?? tipo}) · ${ej.texto}`,
      });
    } else if (gen && APROBADO.has(gen.estado)) {
      reglas.push({
        id,
        fuente: id,
        regla: resumen,
        estado: "OK",
        evidencia: `Generado y aprobado: ${gen.nombre} · ${ej.texto}`,
      });
    } else if (gen) {
      reglas.push({
        id,
        fuente: id,
        regla: resumen,
        estado: "FALTA",
        evidencia: `${gen.nombre} está ${gen.estado.toLowerCase()}: aprobar antes de presentar · ${ej.texto}`,
      });
    } else if (enChecklist && enChecklist.estado === "COMPLETO") {
      reglas.push({
        id,
        fuente: id,
        regla: resumen,
        estado: "ATENCION",
        evidencia: `Marcado completo en el checklist (${enChecklist.label}) pero no analizado: subirlo para verificarlo · ${ej.texto}`,
      });
    } else {
      reglas.push({
        id,
        fuente: id,
        regla: resumen,
        estado: "FALTA",
        evidencia: `No está en el paquete${enChecklist ? ` (checklist: ${enChecklist.estado.toLowerCase()})` : ""} · ${ej.texto}`,
      });
    }
  });
  if (!exigidos.length)
    reglas.push({
      id: "46A",
      fuente: "46A",
      regla: "Documentos exigidos por la LC",
      estado: "SIN_DATO",
      evidencia: "La LC cargada no tiene el 46A: pegá el SWIFT o cargalos.",
    });

  /* ---- 47A / UCP: reglas formales sobre lo analizado ---- */
  const cond = (lc.condicionesAdicionales ?? []).join(" ").toUpperCase();
  const exigeNumeroLC =
    /INDICATE.{0,40}(LETTER OF CREDIT|L\/?C)\s*(NUMBER|NO)|LC NUMBER/.test(cond) || exigidos.length > 0;
  const exigeFechaDesdeLC =
    /ON OR AFTER THE (LETTER OF CREDIT|L\/?C) DATE|DATED (PRIOR|BEFORE).{0,30}(LETTER OF CREDIT|L\/?C)/.test(cond);
  for (const d of docs) {
    const nombre = d.nombreArchivo ?? d.tipo;
    if (exigeNumeroLC) {
      const n = val(d, "numeroLC");
      const cita =
        (n && norm(n).includes(norm(lc.numero))) || (n && norm(lc.numero).includes(norm(n)) && n.length >= 6);
      reglas.push({
        id: `lc-num-${d.tipo}`,
        fuente: "47A",
        regla: `${nombre}: cita el número de la LC`,
        estado: !n ? "ATENCION" : cita ? "OK" : "DISCREPANCIA",
        evidencia: n ? `dice "${n}"` : "no se leyó un número de LC en el documento: verificar a mano",
      });
    }
    if (exigeFechaDesdeLC && emision) {
      const f = val(d, "fechaDocumento") ?? val(d, "fechaEmbarque");
      const fd = f ? parseFecha(f) : null;
      reglas.push({
        id: `fecha-${d.tipo}`,
        fuente: "47A",
        regla: `${nombre}: fechado el día de la LC o después`,
        estado: !fd ? "ATENCION" : fd >= emision ? "OK" : "DISCREPANCIA",
        evidencia: fd ? `documento ${f} · LC emitida ${lc.fechaEmision}` : "sin fecha legible",
      });
    }
  }

  /* BL: consignee a la orden del banco emisor, freight, notify */
  const bl = doc("BL");
  const reglaBL = exigidos.find((x) => claveDoc(x) === "BL") ?? "";
  if (bl) {
    const consig = val(bl, "consignatario");
    /*
     * A nombre de quién lo pide el crédito. Si no lo dice, NO se supone.
     *
     * Antes se caía al banco emisor, y con eso un crédito que consigna al ordenante —o uno aéreo,
     * donde el consignatario va siempre nominado— daba discrepancia sobre un documento que cumplía
     * exactamente lo pedido. El examen es contra el crédito (art. 14 a): donde el crédito calla no
     * hay discrepancia, hay a lo sumo algo que mirar.
     */
    const ordenDe =
      /TO THE ORDER OF\s+([A-Z0-9 .,'&()-]+?)(?:,\s*MARKED|\s+MARKED|\s+NOTIFY|$)/i.exec(reglaBL)?.[1]?.trim() ?? null;
    if (!ordenDe) {
      reglas.push({
        id: "bl-consignee",
        fuente: "46A",
        regla: "A nombre de quién va el documento de transporte",
        estado: "ATENCION",
        evidencia: consig
          ? `el crédito no dice a nombre de quién y el documento dice "${consig}": verificar a mano`
          : "el crédito no dice a nombre de quién y no se leyó el consignatario: verificar a mano",
      });
    }
    if (ordenDe) {
      const ok = consig
        ? norm(consig).includes(norm(ordenDe)) || norm(ordenDe).includes(norm(consig.replace(/to the order of/i, "")))
        : false;
      reglas.push({
        id: "bl-consignee",
        fuente: "46A",
        regla: `BL consignado "to the order of ${ordenDe}"`,
        estado: !consig ? "ATENCION" : ok ? "OK" : "DISCREPANCIA",
        evidencia: consig ? `dice "${consig}"` : "no se leyó el consignee",
      });
    }
    /*
     * La marca de flete, solo si el crédito la pide.
     *
     * Antes, cuando el 46A no la mencionaba, se deducía del incoterm de la operación —y sin
     * incoterm se asumía PREPAID—, así que un BL marcado FREIGHT COLLECT contra un crédito que no
     * habla del flete salía discrepante por una marca que nadie pidió. El incoterno de la operación
     * dice cómo se pactó la venta, no qué exige el crédito, y son cosas distintas.
     */
    const flete = /FREIGHT\s+(PREPAID|COLLECT)/i.exec(reglaBL)?.[1]?.toUpperCase() ?? null;
    const fl = val(bl, "flete");
    if (flete) {
      reglas.push({
        id: "bl-freight",
        fuente: "46A",
        regla: `BL marcado "FREIGHT ${flete}"`,
        estado: !fl ? "ATENCION" : fl.toUpperCase().includes(flete) ? "OK" : "DISCREPANCIA",
        evidencia: fl ? `dice "${fl}"` : "no se leyó la marca de flete",
      });
    } else if (fl) {
      reglas.push({
        id: "bl-freight",
        fuente: "46A",
        regla: "Marca de flete del documento de transporte",
        estado: "ATENCION",
        evidencia: `el crédito no pide una marca de flete y el documento dice "${fl}": verificar contra el incoterm de la venta`,
      });
    }
    if (/NOTIFY\s+APPLICANT/i.test(reglaBL)) {
      const nt = val(bl, "notify") ?? val(bl, "importador");
      const cliente = op.legs.find((l) => l.tipo === "VENTA")?.contraparte ?? "";
      const ok = nt && cliente ? norm(nt).includes(norm(cliente).split(" ")[0]) : false;
      reglas.push({
        id: "bl-notify",
        fuente: "46A",
        regla: "BL notify: el ordenante (applicant)",
        estado: !nt ? "ATENCION" : ok ? "OK" : "DISCREPANCIA",
        evidencia: nt ? `dice "${nt}" · ordenante ${cliente}` : "no se leyó el notify",
      });
    }
  }

  /* Factura: "as per proforma", FOB y flete separados, dentro del monto de la LC */
  const fac = doc("FACTURA");
  const reglaFac = exigidos.find((x) => claveDoc(x) === "INVOICE") ?? "";
  if (fac) {
    if (/PROFORMA/i.test(reglaFac)) {
      const ref = val(fac, "referenciaProforma");
      const numProforma = /PROFORMA INVOICE NO\.?\s*([A-Z0-9-]+)/i.exec(reglaFac)?.[1];
      const ok = ref && (!numProforma || ref.includes(numProforma));
      reglas.push({
        id: "fac-proforma",
        fuente: "46A",
        regla: `Factura: "goods shipped as per proforma invoice${numProforma ? ` no. ${numProforma}` : ""}"`,
        estado: !ref ? "DISCREPANCIA" : ok ? "OK" : "DISCREPANCIA",
        evidencia: ref ? `dice "${ref}"` : "la factura no cita la proforma",
      });
    }
    if (/FOB VALUE AND FREIGHT|FREIGHT AMOUNTS? SEPARATELY|SHOWING.{0,30}FREIGHT/i.test(reglaFac)) {
      const fl = val(fac, "flete");
      reglas.push({
        id: "fac-flete",
        fuente: "46A",
        regla: "Factura: valor FOB y flete por separado",
        estado: fl ? "OK" : "DISCREPANCIA",
        evidencia: fl ? `flete desglosado: "${fl}"` : "no se leyó un flete desglosado en la factura",
      });
    }
    const monto = val(fac, "montoTotal");
    const n = monto ? parseNumero(monto) : null;
    if (n != null && lc.monto != null && lc.monto > 0) {
      const tol = toleranciaDe(lc);
      const tope = lc.monto * (1 + tol);
      reglas.push({
        id: "fac-monto",
        fuente: "32B/39A",
        regla: `Factura dentro del monto de la LC (${lc.moneda ?? ""} ${lc.monto.toLocaleString("es-UY")}${tol ? ` ±${Math.round(tol * 100)} %` : ""})`,
        estado: n <= tope + 1e-9 ? "OK" : "DISCREPANCIA",
        evidencia: `factura ${monto}${n > tope ? ` supera el tope ${tope.toLocaleString("es-UY")}` : ""}`,
      });
    }
    const exp = val(fac, "exportador");
    if (exp) {
      const ok = norm(exp).includes(norm(input.empresaRazonSocial).split(" ")[0]);
      reglas.push({
        id: "fac-emisor",
        fuente: "UCP 600 18a",
        regla: "Factura emitida por el beneficiario",
        estado: ok ? "OK" : "DISCREPANCIA",
        evidencia: `emisor "${exp}" · beneficiario ${input.empresaRazonSocial}`,
      });
    }
  }

  /* D3: la LC fija cómo figura el beneficiario; los documentos propios tienen que repetirlo (en el
     caso real la proforma llevaba Colón 1498 y la LC Cerrito 820) */
  if (lc.beneficiarioDireccion && input.empresaDireccion) {
    const calle = (s: string) =>
      norm(s)
        .replace(/\b(of|oficina|office|cp|piso|fl|floor)\b.*$/, "")
        .trim()
        .split(" ")
        .slice(0, 2)
        .join(" ");
    const ok =
      norm(lc.beneficiarioDireccion).includes(calle(input.empresaDireccion)) ||
      norm(input.empresaDireccion).includes(calle(lc.beneficiarioDireccion));
    reglas.push({
      id: "beneficiario-direccion",
      fuente: "59",
      regla: "Documentos propios con la dirección del beneficiario que dice la LC",
      estado: ok ? "OK" : "ATENCION",
      evidencia: `LC: "${lc.beneficiarioDireccion}" · Ajustes: "${input.empresaDireccion}"${ok ? "" : " — usar la de la LC en factura y certificados"}`,
    });
  }

  /* entre documentos (art. 14d) */
  for (const c of compararEntreDocumentos(docs.map((d) => ({ tipo: d.tipo, campos: d.campos })))) {
    reglas.push({
      id: `cruce-${norm(c.campo).replace(/ /g, "-")}`,
      fuente: "UCP 600 14d",
      regla: c.titulo,
      estado: c.severidad === "ALTA" ? "DISCREPANCIA" : "ATENCION",
      evidencia: c.detalle,
    });
  }

  /* plazos: último embarque, presentación, vencimiento */
  const lim = limitePresentacion(lc, op.blReal, op.fechaEmbarque);
  let diasParaPresentar: number | null = null;
  if (lim && !lim.esEstimada) {
    diasParaPresentar = diffDias(hoy, lim.limite);
    reglas.push({
      id: "plazo",
      fuente: lim.plazoPorDefectoUCP ? "UCP 600 14c" : "48",
      regla: `Presentar dentro de ${lim.dias} días del BL y antes del vencimiento`,
      estado: diasParaPresentar < 0 ? "DISCREPANCIA" : diasParaPresentar <= 3 ? "ATENCION" : "OK",
      evidencia: `BL ${op.blReal} → límite ${lim.limite.toLocaleDateString("es-UY")} · ${diasParaPresentar >= 0 ? `quedan ${diasParaPresentar} días` : `venció hace ${-diasParaPresentar} días`}`,
    });
  } else {
    reglas.push({
      id: "plazo",
      fuente: "48",
      regla: "Plazo de presentación",
      estado: "SIN_DATO",
      evidencia: "sin fecha real de BL en el seguimiento: la cuenta no arranca",
    });
  }
  if (bl && lc.limiteEmbarque !== "—") {
    const ab = val(bl, "fechaEmbarque");
    const f = ab ? parseFecha(ab) : null;
    const l = parseFecha(lc.limiteEmbarque);
    if (f && l)
      reglas.push({
        id: "ultimo-embarque",
        fuente: "44C",
        regla: `A bordo a más tardar el ${lc.limiteEmbarque}`,
        estado: f > l ? "DISCREPANCIA" : "OK",
        evidencia: `BL a bordo ${ab}`,
      });
  }

  const faltan = reglas.filter((r) => r.estado === "FALTA").length;
  const discrepancias = reglas.filter((r) => r.estado === "DISCREPANCIA").length;
  const atencion = reglas.filter((r) => r.estado === "ATENCION").length;
  return {
    reglas,
    faltan,
    discrepancias,
    atencion,
    listo: faltan === 0 && discrepancias === 0 && exigidos.length > 0,
    feePorJuego: feeDiscrepancia(lc.condicionesAdicionales),
    diasParaPresentar,
  };
}
