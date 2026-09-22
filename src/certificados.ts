import { type CamposDoc, claveDoc, parseNumero } from "./consistencia";
import { parseFecha } from "./fechas";
import { comparaISBP, emisorAdmitido, esCertificadoDeOrigen, exigePrevioAlEmbarque } from "./isbp";
import type { DocAnalizado, EstadoRegla, ReglaPresentacion } from "./presentacion";
import type { LcInfo } from "./types";

/**
 * Los otros documentos del campo 46A.
 *
 * El crédito del caso real exige diez y solo tres —factura, packing y conocimiento de
 * embarque— tienen reglas propias. Los otros siete son certificados: origen, análisis,
 * fumigación, veterinario, nota de peso y dos certificados del beneficiario. Hasta ahora
 * el motor solo sabía si estaban o si faltaban.
 *
 * Lo que se puede verificar de un certificado leyendo su texto es poco pero importante:
 * quién lo emite, cuándo, y si dice lo que el crédito le pide decir. La autenticidad de
 * la firma y del sello queda del lado humano, como siempre.
 */

/** Un certificado presentado, apareado con el ítem del 46A que pretende cubrir. */
export interface DocCertificado {
  /** el texto del ítem del 46A, tal como lo escribe el crédito */
  exigencia: string;
  campos: CamposDoc;
  nombreArchivo?: string;
}

const val = (c: { valor: string; confianza: number } | undefined): string | null =>
  c && c.valor.trim() && c.confianza >= 0.4 ? c.valor.trim() : null;

const corto = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function regla(id: string, fuente: string, texto: string, estado: EstadoRegla, evidencia: string): ReglaPresentacion {
  return { id, fuente, regla: texto, estado, evidencia };
}

/** El peso que declara un documento, en kilos, si se puede leer. */
function pesoEnKg(campos: CamposDoc): number | null {
  const bruto = val(campos.pesoBruto);
  if (!bruto) return null;
  const n = parseNumero(bruto);
  if (n === null) return null;
  return /\b(t|mt|mts|ton|tons|tonne|tonnes|tonelada)/i.test(bruto) ? n * 1000 : n;
}

/* ─────────────────────────── las reglas ─────────────────────────── */

export function reglasCertificados(input: {
  lc: LcInfo;
  certificados: DocCertificado[];
  /** los documentos principales, para cotejar pesos y fechas contra ellos */
  docs: DocAnalizado[];
  beneficiario?: string | null;
  hoy: Date;
}): ReglaPresentacion[] {
  const out: ReglaPresentacion[] = [];
  const bl = input.docs.find((d) => d.tipo === "BL");
  const packing = input.docs.find((d) => d.tipo === "PACKING");
  const fechaEmbarque = val(bl?.campos.fechaEmbarque) ?? null;

  input.certificados.forEach((c, i) => {
    const nombre = c.nombreArchivo ?? corto(c.exigencia, 40);
    const sufijo = `${claveDoc(c.exigencia)}-${i}`;

    /* quién lo emite (ISBP 821 Q3 a Q5, y L3 para el de origen) */
    const admitido = emisorAdmitido(c.exigencia);
    const emisor = val(c.campos.emisorSeguro) ?? val(c.campos.exportador);
    if (admitido === "EL_QUE_NOMBRA_EL_CREDITO") {
      const nombrado = /issued by\s+([^,.;]+)/i.exec(c.exigencia)?.[1]?.trim();
      if (nombrado) {
        out.push(
          emisor
            ? regla(
                `cert-emisor-${sufijo}`,
                "ISBP 821 Q3",
                `${nombre}: lo emite ${corto(nombrado, 40)}`,
                comparaISBP(emisor, nombrado) === "DISTINTO" ? "DISCREPANCIA" : "OK",
                `el documento lo emite "${emisor}"`,
              )
            : regla(
                `cert-emisor-${sufijo}`,
                "ISBP 821 Q3",
                `${nombre}: lo emite ${corto(nombrado, 40)}`,
                "ATENCION",
                "no se leyó el emisor: verificar a mano",
              ),
        );
      }
    } else if (admitido === "CUALQUIERA_MENOS_BENEFICIARIO") {
      // el crédito lo pide "independent", "official" o similar: el beneficiario no puede emitirlo
      const esOrigen = esCertificadoDeOrigen(c.exigencia);
      out.push(
        emisor && input.beneficiario
          ? regla(
              `cert-emisor-${sufijo}`,
              esOrigen ? "ISBP 821 L3" : "ISBP 821 Q5",
              `${nombre}: no lo emite el beneficiario`,
              comparaISBP(emisor, input.beneficiario) === "DISTINTO" ? "OK" : "DISCREPANCIA",
              `el documento lo emite "${emisor}"`,
            )
          : regla(
              `cert-emisor-${sufijo}`,
              esOrigen ? "ISBP 821 L3" : "ISBP 821 Q5",
              `${nombre}: no lo emite el beneficiario`,
              "ATENCION",
              "no se leyó el emisor: verificar a mano",
            ),
      );
    }

    /* la fecha (ISBP 821 A12) */
    const f = val(c.campos.fechaDocumento) ?? val(c.campos.fechaSeguro);
    const fd = f ? parseFecha(f) : null;
    if (exigePrevioAlEmbarque(c.exigencia)) {
      const fe = fechaEmbarque ? parseFecha(fechaEmbarque) : null;
      out.push(
        fd && fe
          ? regla(
              `cert-previo-${sufijo}`,
              "ISBP 821 A12b",
              `${nombre}: acredita un hecho anterior al embarque`,
              fd <= fe ? "OK" : "DISCREPANCIA",
              `documento ${f} · embarque ${fechaEmbarque}`,
            )
          : regla(
              `cert-previo-${sufijo}`,
              "ISBP 821 A12b",
              `${nombre}: acredita un hecho anterior al embarque`,
              "ATENCION",
              "falta la fecha del certificado o la del embarque para compararlas",
            ),
      );
    } else if (fd && fechaEmbarque) {
      // A12a: que sea posterior al embarque NO es discrepancia; se deja dicho para que
      // nadie lo marque por las suyas
      const fe = parseFecha(fechaEmbarque);
      if (fe && fd > fe) {
        out.push(
          regla(
            `cert-fecha-${sufijo}`,
            "ISBP 821 A12a",
            `${nombre}: fechado después del embarque`,
            "OK",
            `documento ${f} · embarque ${fechaEmbarque} — admitido: el crédito no lo pide previo`,
          ),
        );
      }
    }

    /* la nota de peso, contra lo que dicen el packing y el conocimiento */
    if (claveDoc(c.exigencia) === "PESO") {
      const suyo = pesoEnKg(c.campos);
      const otro = pesoEnKg(packing?.campos ?? ({} as CamposDoc)) ?? pesoEnKg(bl?.campos ?? ({} as CamposDoc));
      const deQuien = pesoEnKg(packing?.campos ?? ({} as CamposDoc)) !== null ? "el packing" : "el conocimiento";
      out.push(
        suyo !== null && otro !== null
          ? regla(
              `cert-peso-${sufijo}`,
              "UCP 600 14d",
              `${nombre}: el peso coincide con ${deQuien}`,
              Math.abs(suyo - otro) / otro <= 0.005 ? "OK" : "DISCREPANCIA",
              `nota de peso ${suyo.toLocaleString("es-UY")} kg · ${deQuien} ${otro.toLocaleString("es-UY")} kg`,
            )
          : regla(
              `cert-peso-${sufijo}`,
              "UCP 600 14d",
              `${nombre}: el peso coincide con los demás documentos`,
              "ATENCION",
              "no se leyó un peso comparable: verificar a mano",
            ),
      );
    }

    /* el certificado de origen: que diga el origen que el crédito nombra */
    if (esCertificadoDeOrigen(c.exigencia)) {
      const pais = /certificate of\s+([a-z]+)\s+origin/i.exec(c.exigencia)?.[1];
      const dice = val(c.campos.mercaderia) ?? val(c.campos.numeroDoc) ?? "";
      const enDoc = val(c.campos.puertoEmbarque) ?? dice;
      if (pais) {
        out.push(
          regla(
            `cert-origen-${sufijo}`,
            "46A",
            `${nombre}: indica origen ${pais.toUpperCase()}`,
            enDoc && new RegExp(pais, "i").test(enDoc) ? "OK" : "ATENCION",
            enDoc ? `el documento dice "${corto(enDoc)}"` : "no se leyó el origen: verificar a mano",
          ),
        );
      }
    }

    /* el certificado del beneficiario: tiene que declarar lo que el crédito le pide */
    if (claveDoc(c.exigencia).startsWith("BENEFICIARIO")) {
      const declara = val(c.campos.mercaderia) ?? val(c.campos.referenciaProforma) ?? null;
      const plazo = /within\s+(\d{1,3})\s+days/i.exec(c.exigencia)?.[1];
      out.push(
        regla(
          `cert-benef-${sufijo}`,
          "46A",
          `${nombre}: declara lo que el crédito pide${plazo ? ` (plazo de ${plazo} días)` : ""}`,
          declara ? "ATENCION" : "ATENCION",
          declara
            ? `dice "${corto(declara, 80)}" — cotejar el texto con el que exige el crédito`
            : "leer el texto del certificado y cotejarlo con el que exige el crédito",
        ),
      );
    }
  });

  return out;
}

/**
 * Aparea los certificados presentados con los ítems del 46A que pretenden cubrir.
 *
 * Es una ayuda para la aplicación: si el operador ya dijo qué exigencia cubre cada
 * documento, no hace falta. Cuando no lo dijo, se apareja por el tipo de documento.
 */
export function aparearConExigencias(
  lc: LcInfo,
  presentados: { tipo: string; campos: CamposDoc; nombreArchivo?: string }[],
): DocCertificado[] {
  const exigidos = lc.documentosExigidos ?? [];
  const usados = new Set<number>();
  const out: DocCertificado[] = [];

  for (const p of presentados) {
    const clave = claveDoc(p.tipo);
    const i = exigidos.findIndex((e, idx) => !usados.has(idx) && claveDoc(e) === clave);
    if (i >= 0) {
      usados.add(i);
      out.push({ exigencia: exigidos[i]!, campos: p.campos, nombreArchivo: p.nombreArchivo });
    }
  }
  return out;
}
