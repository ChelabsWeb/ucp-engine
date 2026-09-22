import type { CamposDoc, TipoDocExterno } from "./consistencia";
import { parseNumero } from "./consistencia";
import { parseFecha } from "./fechas";
import { toleranciaDe } from "./lc";
import type { DocAnalizado, EstadoRegla, ReglaPresentacion } from "./presentacion";
import type { LcInfo } from "./types";

/**
 * Las reglas de las UCP 600 que el examen base (`presentacion.ts`) no cubre.
 *
 * Están acá y no allá a propósito: `presentacion.ts` viene de romai y conviene poder
 * sincronizarlo sin conflictos. Este módulo es aditivo — se compone con aquel en
 * `examen.ts` y nunca lo modifica.
 *
 * Cada regla cita el artículo que la funda, tal como está redactado en la publicación
 * 600 de la ICC. Cuando un dato no se pudo leer del documento, la regla sale en
 * ATENCION y dice qué verificar a mano: el silencio nunca se interpreta como conforme.
 */

/** Lo que el propio crédito dice de sí mismo, más allá de `LcInfo`. */
export interface ContextoCredito {
  /** 44E y 44F: los puertos que fija el crédito */
  puertoEmbarque?: string | null;
  puertoDestino?: string | null;
  /** 45A: la descripción de la mercadería en el crédito */
  mercaderia?: string | null;
  /** 50: el ordenante, a cuyo nombre se emite la factura (art. 18a-ii) */
  aplicante?: string | null;
  /** 43P: "ALLOWED" / "NOT ALLOWED" */
  parciales?: string | null;
  /** 43T: transbordo */
  transbordo?: string | null;
}

const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** El valor de un campo, solo si se leyó con confianza suficiente para compararlo. */
function val(d: { campos: CamposDoc } | undefined, k: keyof CamposDoc): string | null {
  const c = d?.campos[k];
  return c && c.valor.trim() && c.confianza >= 0.4 ? c.valor.trim() : null;
}

/** La fecha que haya dentro de una frase: "SHIPPED ON BOARD 08-APR-2025" → 08-APR-2025. */
function fechaEnTexto(t: string): Date | null {
  const directa = parseFecha(t);
  if (directa) return directa;
  const m = /(\d{1,2}[-/. ][A-Za-z]{3,9}[-/. ]\d{2,4})|(\d{4}-\d{2}-\d{2})|(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/.exec(t);
  return m ? parseFecha(m[0]) : null;
}

/** ¿Comparten alguna palabra significativa? Los puertos se escriben de mil formas. */
function coincideLugar(a: string, b: string): boolean {
  const pa = norm(a)
    .split(" ")
    .filter((w) => w.length > 3);
  const pb = norm(b)
    .split(" ")
    .filter((w) => w.length > 3);
  if (pa.length === 0 || pb.length === 0) return false;
  return pa.some((w) => pb.includes(w));
}

/** Descripciones de mercadería: o una contiene a la otra, o comparten dos palabras propias. */
function coincideDescripcion(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const pa = na.split(" ").filter((w) => w.length > 3);
  const pb = new Set(nb.split(" ").filter((w) => w.length > 3));
  return pa.filter((w) => pb.has(w)).length >= 2;
}

function regla(id: string, fuente: string, texto: string, estado: EstadoRegla, evidencia: string): ReglaPresentacion {
  return { id, fuente, regla: texto, estado, evidencia };
}

/** Un dato que no se leyó no es un problema del documento: es una verificación pendiente. */
function sinLeer(id: string, fuente: string, texto: string, que: string): ReglaPresentacion {
  return regla(id, fuente, texto, "ATENCION", `no se leyó ${que} en el documento: verificar a mano`);
}

const NOMBRE: Record<TipoDocExterno, string> = {
  FACTURA: "Factura comercial",
  PACKING: "Packing list",
  BL: "Conocimiento de embarque",
  LC: "Carta de crédito",
};

/** El documento de seguro no entra en la matriz de la operación: viaja aparte. */
export interface DocSeguro {
  campos: CamposDoc;
  nombreArchivo?: string;
}

/* ───────────────────────────── factura (art. 18) ───────────────────────────── */

function reglasFactura(lc: LcInfo, ctx: ContextoCredito, fac: DocAnalizado): ReglaPresentacion[] {
  const out: ReglaPresentacion[] = [];

  // 18a-ii: la factura se emite a nombre del ordenante
  const importador = val(fac, "importador");
  if (ctx.aplicante) {
    out.push(
      importador
        ? regla(
            "ucp-18a-ii",
            "UCP 600 18a-ii",
            "Factura emitida a nombre del ordenante",
            coincideLugar(importador, ctx.aplicante) ? "OK" : "DISCREPANCIA",
            `factura dice "${importador}" · el crédito nombra a "${ctx.aplicante}"`,
          )
        : sinLeer("ucp-18a-ii", "UCP 600 18a-ii", "Factura emitida a nombre del ordenante", "el comprador"),
    );
  }

  // 18a-iii: la factura se emite en la misma moneda que el crédito
  const moneda = val(fac, "moneda");
  if (lc.moneda) {
    out.push(
      moneda
        ? regla(
            "ucp-18a-iii",
            "UCP 600 18a-iii",
            `Factura en la moneda del crédito (${lc.moneda})`,
            moneda.toUpperCase().includes(lc.moneda.toUpperCase()) ? "OK" : "DISCREPANCIA",
            `factura en ${moneda}`,
          )
        : sinLeer("ucp-18a-iii", "UCP 600 18a-iii", "Factura en la moneda del crédito", "la moneda"),
    );
  }

  // 18c: la descripción de la mercadería debe CORRESPONDER con la del crédito (exigencia fuerte)
  const merc = val(fac, "mercaderia");
  if (ctx.mercaderia && merc) {
    out.push(
      regla(
        "ucp-18c",
        "UCP 600 18c",
        "La descripción de la mercadería en la factura se corresponde con la del crédito",
        coincideDescripcion(merc, ctx.mercaderia) ? "OK" : "ATENCION",
        `factura: "${merc.slice(0, 70)}" · crédito 45A: "${ctx.mercaderia.slice(0, 70)}"`,
      ),
    );
  }
  return out;
}

/* ──────────────────── documento de transporte (arts. 20, 26, 27) ──────────────────── */

function reglasTransporte(ctx: ContextoCredito, bl: DocAnalizado): ReglaPresentacion[] {
  const out: ReglaPresentacion[] = [];

  // 20a-iii: embarque del puerto de carga al de descarga que fija el crédito
  for (const [k, puertoLC, cual] of [
    ["puertoEmbarque", ctx.puertoEmbarque, "de carga"],
    ["puertoDestino", ctx.puertoDestino, "de descarga"],
  ] as const) {
    if (!puertoLC) continue;
    const enDoc = val(bl, k);
    out.push(
      enDoc
        ? regla(
            `ucp-20a-iii-${k}`,
            "UCP 600 20a-iii",
            `Puerto ${cual} el que indica el crédito (${puertoLC})`,
            coincideLugar(enDoc, puertoLC) ? "OK" : "DISCREPANCIA",
            `el documento dice "${enDoc}"`,
          )
        : sinLeer(
            `ucp-20a-iii-${k}`,
            "UCP 600 20a-iii",
            `Puerto ${cual} el que indica el crédito`,
            `el puerto ${cual}`,
          ),
    );
  }

  // 20a-ii: anotación de a bordo con fecha; "intended vessel" la exige sí o sí
  const onBoard = val(bl, "onBoard");
  const buque = val(bl, "buque");
  const intended = /intended|previsto/i.test(`${buque ?? ""} ${onBoard ?? ""}`);
  out.push(
    onBoard
      ? regla(
          "ucp-20a-ii",
          "UCP 600 20a-ii",
          "Anotación de a bordo con fecha de embarque",
          fechaEnTexto(onBoard) ? "OK" : "ATENCION",
          fechaEnTexto(onBoard) ? `dice "${onBoard}"` : `dice "${onBoard}" — no se le leyó una fecha`,
        )
      : intended
        ? regla(
            "ucp-20a-ii",
            "UCP 600 20a-ii",
            "Con «intended vessel» hace falta anotación de a bordo con fecha y buque real",
            "DISCREPANCIA",
            `el documento califica el buque como previsto y no se leyó la anotación de a bordo`,
          )
        : sinLeer("ucp-20a-ii", "UCP 600 20a-ii", "Anotación de a bordo con fecha", "la anotación de a bordo"),
  );

  // 20a-vi: el conocimiento no puede estar sujeto a un contrato de fletamento
  const charter = val(bl, "charterParty");
  if (charter) {
    out.push(
      regla(
        "ucp-20a-vi",
        "UCP 600 20a-vi",
        "El conocimiento no indica estar sujeto a contrato de fletamento",
        /no|sin|not/i.test(charter) ? "OK" : "DISCREPANCIA",
        `dice "${charter}"`,
      ),
    );
  }

  // 26a: la mercadería no puede ir declarada sobre cubierta
  const onDeck = val(bl, "onDeck");
  if (onDeck) {
    // el artículo distingue dos cosas: declarar que la mercadería VA sobre cubierta (discrepancia)
    // y la cláusula de opción que los transportistas imprimen en todos sus conocimientos (aceptable)
    const declara = /\b(shipped|loaded|stowed|carried)\s+on\s+deck\b|sobre cubierta\b(?!.*\bpodr)/i.test(onDeck);
    const opcion = /\b(may|can|option|entitled|reserves?)\b/i.test(onDeck);
    const esOpcion =
      opcion && !/\b(is|are|was|were|has been|have been)\s+(shipped|loaded|stowed|carried)\s+on\s+deck\b/i.test(onDeck);
    out.push(
      regla(
        "ucp-26a",
        "UCP 600 26a",
        "La mercadería no viaja declarada sobre cubierta",
        esOpcion ? "OK" : declara ? "DISCREPANCIA" : "OK",
        esOpcion
          ? `cláusula de opción del transportista, admitida por el artículo: "${onDeck.slice(0, 90)}"`
          : declara
            ? `el documento declara la carga sobre cubierta: "${onDeck.slice(0, 90)}"`
            : `cláusula leída: "${onDeck.slice(0, 90)}"`,
      ),
    );
  }

  // 20a-iv: hay que presentar el juego completo de originales. Un conocimiento marcado
  // "COPY NON NEGOTIABLE", o con cero originales emitidos, no es el documento que el crédito pide.
  const juego = val(bl, "juegoOriginales");
  if (juego) {
    const esCopia = /\bcopy\b|no negociable|non.?negotiable|\bzero\b|\b0\b/i.test(juego);
    out.push(
      regla(
        "ucp-20a-iv",
        "UCP 600 20a-iv",
        "Se presenta el juego completo de originales, no una copia",
        esCopia ? "DISCREPANCIA" : "OK",
        esCopia ? `el documento dice "${juego}"` : `originales emitidos: "${juego}"`,
      ),
    );
  } else {
    out.push(
      sinLeer(
        "ucp-20a-iv",
        "UCP 600 20a-iv",
        "Se presenta el juego completo de originales",
        "cuántos originales se emitieron",
      ),
    );
  }

  // 27: el documento de transporte tiene que estar limpio
  const defecto = val(bl, "clausulaDefecto");
  out.push(
    defecto
      ? regla(
          "ucp-27",
          "UCP 600 27",
          "Documento de transporte limpio",
          /ninguna|no clause|none|limpio|clean/i.test(defecto) ? "OK" : "DISCREPANCIA",
          `cláusula leída: "${defecto}"`,
        )
      : sinLeer("ucp-27", "UCP 600 27", "Documento de transporte limpio", "si hay cláusula de mercadería defectuosa"),
  );

  // 31: si el crédito prohíbe embarques parciales, un solo juego de transporte
  if (ctx.parciales && /not allowed|prohibid|no permit/i.test(ctx.parciales)) {
    out.push(
      regla(
        "ucp-31",
        "43P / UCP 600 31",
        "Embarques parciales prohibidos por el crédito",
        "ATENCION",
        "verificar que se presenta un solo juego de documentos de transporte",
      ),
    );
  }
  return out;
}

/* ────────────────────────── seguro (art. 28) ────────────────────────── */

function reglasSeguro(
  lc: LcInfo,
  ctx: ContextoCredito,
  seg: DocSeguro,
  factura: DocAnalizado | undefined,
): ReglaPresentacion[] {
  const out: ReglaPresentacion[] = [];

  // 28a: lo emite y firma una compañía de seguros, un asegurador o sus agentes
  const emisor = val(seg, "emisorSeguro") ?? val(seg, "exportador");
  out.push(
    emisor
      ? regla(
          "ucp-28a",
          "UCP 600 28a",
          "El seguro lo emite una compañía de seguros o un asegurador",
          /insur|assur|underwrit|segur|aseguradora/i.test(emisor) ? "OK" : "ATENCION",
          `emisor "${emisor}"`,
        )
      : sinLeer("ucp-28a", "UCP 600 28a", "El seguro lo emite una compañía de seguros", "el emisor"),
  );

  // 28c: las notas de cobertura no se aceptan
  const tipo = val(seg, "tipoSeguro");
  if (tipo) {
    out.push(
      regla(
        "ucp-28c",
        "UCP 600 28c",
        "No es una nota de cobertura (cover note)",
        /cover note|nota de cobertura/i.test(tipo) ? "DISCREPANCIA" : "OK",
        `el documento se presenta como "${tipo}"`,
      ),
    );
  }

  // 28e: la fecha del seguro no puede ser posterior a la del embarque
  const fSeg = val(seg, "fechaSeguro") ?? val(seg, "fechaDocumento");
  const fEmb = val(factura, "fechaEmbarque") ?? lc.limiteEmbarque;
  const a = fSeg ? parseFecha(fSeg) : null;
  const b = fEmb ? parseFecha(fEmb) : null;
  out.push(
    a && b
      ? regla(
          "ucp-28e",
          "UCP 600 28e",
          "El seguro no está fechado después del embarque",
          a <= b ? "OK" : "DISCREPANCIA",
          `seguro ${fSeg} · embarque ${fEmb}`,
        )
      : sinLeer("ucp-28e", "UCP 600 28e", "El seguro no está fechado después del embarque", "la fecha del seguro"),
  );

  // 28f-i: el importe asegurado va en la misma moneda que el crédito
  const monedaSeg = val(seg, "monedaAsegurada") ?? val(seg, "moneda");
  if (lc.moneda) {
    out.push(
      monedaSeg
        ? regla(
            "ucp-28f-i",
            "UCP 600 28f-i",
            `Seguro en la moneda del crédito (${lc.moneda})`,
            monedaSeg.toUpperCase().includes(lc.moneda.toUpperCase()) ? "OK" : "DISCREPANCIA",
            `seguro en ${monedaSeg}`,
          )
        : sinLeer("ucp-28f-i", "UCP 600 28f-i", "Seguro en la moneda del crédito", "la moneda del seguro"),
    );
  }

  // 28f-ii: sin indicación en el crédito, la cobertura mínima es el 110 % del valor CIF/CIP
  const montoSeg = parseNumero(val(seg, "montoAsegurado") ?? val(seg, "montoTotal") ?? "");
  const base = parseNumero(val(factura, "montoTotal") ?? "") ?? lc.monto ?? null;
  if (montoSeg !== null && base !== null && base > 0) {
    const minimo = base * 1.1;
    const fmt = (n: number) => n.toLocaleString("es-UY", { maximumFractionDigits: 2 });
    out.push(
      regla(
        "ucp-28f-ii",
        "UCP 600 28f-ii",
        "Cobertura de al menos el 110 % del valor de la mercadería",
        montoSeg + 1e-9 >= minimo ? "OK" : "DISCREPANCIA",
        `asegurado ${fmt(montoSeg)} · mínimo exigible ${fmt(minimo)} (110 % de ${fmt(base)})`,
      ),
    );
  } else if (montoSeg === null) {
    out.push(sinLeer("ucp-28f-ii", "UCP 600 28f-ii", "Cobertura de al menos el 110 %", "el importe asegurado"));
  }

  // 28f-iii: la cobertura corre entre el lugar de embarque y el de destino
  const desde = val(seg, "coberturaDesde");
  const hasta = val(seg, "coberturaHasta");
  if (ctx.puertoEmbarque && ctx.puertoDestino) {
    out.push(
      desde && hasta
        ? regla(
            "ucp-28f-iii",
            "UCP 600 28f-iii",
            "La cobertura va del lugar de embarque al de destino",
            coincideLugar(desde, ctx.puertoEmbarque) && coincideLugar(hasta, ctx.puertoDestino) ? "OK" : "DISCREPANCIA",
            `cubre de "${desde}" a "${hasta}" · el crédito pide de "${ctx.puertoEmbarque}" a "${ctx.puertoDestino}"`,
          )
        : sinLeer("ucp-28f-iii", "UCP 600 28f-iii", "La cobertura va del embarque al destino", "el tramo cubierto"),
    );
  }
  return out;
}

/* ──────────────────── reglas que valen para cualquier documento ──────────────────── */

function reglasGenerales(lc: LcInfo, ctx: ContextoCredito, docs: DocAnalizado[], hoy: Date): ReglaPresentacion[] {
  const out: ReglaPresentacion[] = [];

  for (const d of docs) {
    const nombre = d.nombreArchivo ?? NOMBRE[d.tipo];

    // 14i: ningún documento puede estar fechado después de su presentación
    const f = val(d, "fechaDocumento") ?? val(d, "fechaEmbarque");
    const fd = f ? parseFecha(f) : null;
    if (fd) {
      out.push(
        regla(
          `ucp-14i-${d.tipo}`,
          "UCP 600 14i",
          `${nombre}: no está fechado después de la presentación`,
          fd <= hoy ? "OK" : "DISCREPANCIA",
          `documento ${f} · presentación ${hoy.toLocaleDateString("es-UY")}`,
        ),
      );
    }

    // 14e: en los documentos que no son la factura, la descripción puede ser general,
    // pero nunca contradecir la del crédito
    if (d.tipo !== "FACTURA" && ctx.mercaderia) {
      const merc = val(d, "mercaderia");
      if (merc) {
        out.push(
          regla(
            `ucp-14e-${d.tipo}`,
            "UCP 600 14e",
            `${nombre}: la descripción de la mercadería no contradice al crédito`,
            coincideDescripcion(merc, ctx.mercaderia) ? "OK" : "ATENCION",
            `dice "${merc.slice(0, 70)}"`,
          ),
        );
      }
    }
  }

  // 30b: sin tolerancia expresa en el crédito rige el ±5 % sobre la cantidad,
  // salvo que la cantidad esté expresada en bultos o unidades
  if (lc.tolerancia == null) {
    const enBultos = /\b(bags?|cartons?|boxe?s?|packages?|bultos?|cajas?|units?|pieces?|pcs)\b/i.test(
      ctx.mercaderia ?? "",
    );
    out.push(
      regla(
        "ucp-30b",
        "UCP 600 30b",
        enBultos
          ? "El crédito expresa la cantidad en bultos: no corre la tolerancia del 5 %"
          : "Sin tolerancia en el crédito, la cantidad admite ±5 %",
        "OK",
        enBultos ? "la cantidad se compara exacta" : `se aplica ±${Math.round(toleranciaDe(lc) * 100)} % a la cantidad`,
      ),
    );
  }
  return out;
}

/* ─────────────────────────────── entrada pública ─────────────────────────────── */

/**
 * Corre las reglas de las UCP 600 que el examen base no cubre.
 * Devuelve la lista en el mismo formato, para concatenarla con aquella.
 */
export function reglasUCP(input: {
  lc: LcInfo;
  credito?: ContextoCredito;
  docs: DocAnalizado[];
  /** el documento de seguro, si el crédito lo exige y se presentó */
  seguro?: DocSeguro;
  hoy: Date;
}): ReglaPresentacion[] {
  const ctx = input.credito ?? {};
  const doc = (t: TipoDocExterno) => input.docs.find((d) => d.tipo === t);
  const out: ReglaPresentacion[] = [];

  const fac = doc("FACTURA");
  if (fac) out.push(...reglasFactura(input.lc, ctx, fac));

  const bl = doc("BL");
  if (bl) out.push(...reglasTransporte(ctx, bl));

  if (input.seguro) out.push(...reglasSeguro(input.lc, ctx, input.seguro, fac));

  out.push(...reglasGenerales(input.lc, ctx, input.docs, input.hoy));
  return out;
}
