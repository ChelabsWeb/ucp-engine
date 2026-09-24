import { claveDoc } from "./consistencia";
import { parseFecha } from "./fechas";
import { diasPresentacion } from "./lc";
import type { LcInfo } from "./types";

/**
 * El crédito que llegó contra el contrato que se firmó.
 *
 * Esto **no es parte del examen** y hay que entender por qué antes de leer una sola línea. El
 * artículo 4 (a) de las UCP 600 dice que el crédito es una operación separada del contrato de
 * venta, y que los bancos no están alcanzados por ese contrato ni siquiera cuando el crédito lo
 * menciona. Así que una diferencia entre los dos **nunca** es una discrepancia: al banco no se le
 * puede reclamar nada por ella.
 *
 * Y justamente por eso hay que verla temprano. El crédito manda, de modo que todo lo que exija de
 * más pasa a ser problema del beneficiario, que ya firmó un contrato donde eso no estaba. El caso
 * real: la proforma 2025099 pactó seis documentos y treinta días para presentar; el crédito del
 * Meridian Bank pide diez y da veintiuno. Los cuatro papeles de más —nota de peso, certificado de
 * fumigación y dos certificados del propio beneficiario— hay que conseguirlos igual, y los nueve
 * días menos son nueve días menos. Visto el día que llega el crédito, se pide enmienda y no cuesta
 * nada. Visto después de embarcar, no hay nada que hacer.
 *
 * El criterio para ordenar la salida es uno solo: **en qué dirección se movió el crédito**. Lo que
 * aprieta se informa; lo que afloja también, pero sin alarma; lo que coincide no se informa, porque
 * una lista donde casi todo dice «igual» deja de leerse.
 */

export type Desvio =
  /** el crédito pide un documento que el contrato no pactó */
  | "EXIGE_MAS"
  /** el crédito es más duro que lo pactado: menos plazo, menos monto, menos tolerancia */
  | "MAS_ESTRICTO"
  /** el crédito afloja respecto de lo pactado; no hay nada que pedir */
  | "MAS_PERMISIVO"
  /** difieren y ninguno es «más» que el otro: otra moneda, otro puerto */
  | "DIFIERE";

export interface DiferenciaContrato {
  campo: string;
  contrato: string;
  credito: string;
  desvio: Desvio;
  /** qué significa para quien tiene que embarcar */
  consecuencia: string;
}

/**
 * Lo que se pactó, leído del contrato de venta o de la proforma firmada.
 *
 * Todo es opcional: un contrato que no diga nada de la tolerancia no genera un desvío, genera
 * silencio. Comparar contra un dato que no existe es inventar.
 */
export interface ContratoDeVenta {
  documentosExigidos?: string[];
  plazoPresentacionDias?: number | null;
  ultimoEmbarque?: string | null;
  monto?: number | null;
  moneda?: string | null;
  /** fracción: 0.1 = ±10 % */
  tolerancia?: number | null;
  incoterm?: string | null;
  puertoEmbarque?: string | null;
  puertoDestino?: string | null;
  parcialesPermitidos?: boolean | null;
}

/**
 * Lo que el crédito dice y `LcInfo` no modela.
 *
 * `LcInfo` se comparte con romai y agregarle campos rompe la paridad entre los dos repos, así que
 * lo que falta entra por acá. Sale del `extra` y de los `campos` del parser: `parciales` del 43P,
 * los puertos del 44E y 44F.
 */
export interface ExtraCredito {
  parciales?: string | null;
  puertoEmbarque?: string | null;
  puertoDestino?: string | null;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const fmtImporte = (n: number) => n.toLocaleString("es-UY", { maximumFractionDigits: 2 });

/**
 * Qué documentos pide el crédito que el contrato no pactó.
 *
 * Se comparan por clave canónica y no por nombre, porque los dos papeles nombran lo mismo distinto:
 * la proforma dice «Sanitary Certificate» y el crédito «INTERNATIONAL VETERINARY HEALTH
 * CERTIFICATE». Contar eso como un documento agregado sería una alarma falsa, y las alarmas falsas
 * son las que hacen que la pantalla se deje de mirar.
 *
 * Al revés no se informa: que el contrato pactara un papel que el crédito no pide no le cuesta
 * nada al beneficiario, que simplemente no lo presenta.
 */
function documentosDeMas(lc: LcInfo, contrato: ContratoDeVenta): DiferenciaContrato[] {
  const pactados = contrato.documentosExigidos;
  if (!pactados || pactados.length === 0) return [];
  const enElContrato = new Set(pactados.map(claveDoc));
  const out: DiferenciaContrato[] = [];
  for (const pedido of lc.documentosExigidos ?? []) {
    const clave = claveDoc(pedido);
    if (enElContrato.has(clave)) continue;
    enElContrato.add(clave); // un crédito que pide dos veces lo mismo se informa una sola vez
    out.push({
      campo: "Documento no pactado",
      contrato: "no está en el contrato",
      credito: pedido,
      desvio: "EXIGE_MAS",
      consecuencia: "Hay que conseguirlo igual: sin ese documento la presentación queda incompleta.",
    });
  }
  return out;
}

export function compararConContrato(
  lc: LcInfo,
  contrato: ContratoDeVenta,
  extra: ExtraCredito = {},
): DiferenciaContrato[] {
  const out: DiferenciaContrato[] = [...documentosDeMas(lc, contrato)];

  // Plazo para presentar: menos días es menos margen para juntar los papeles.
  const diasLc = diasPresentacion(lc.plazoPresentacion);
  const diasContrato = contrato.plazoPresentacionDias;
  if (diasLc != null && diasContrato != null && diasLc !== diasContrato) {
    const menos = diasContrato - diasLc;
    out.push({
      campo: "Plazo de presentación",
      contrato: `${diasContrato} días`,
      credito: `${diasLc} días`,
      desvio: menos > 0 ? "MAS_ESTRICTO" : "MAS_PERMISIVO",
      consecuencia:
        menos > 0
          ? `${menos} días menos para juntar los documentos y presentarlos.`
          : `${-menos} días más que lo pactado.`,
    });
  }

  // Último embarque: una fecha anterior a la pactada adelanta toda la logística.
  const fLc = parseFecha(lc.limiteEmbarque ?? "");
  const fContrato = parseFecha(contrato.ultimoEmbarque ?? "");
  if (fLc && fContrato && fLc.getTime() !== fContrato.getTime()) {
    const antes = fLc.getTime() < fContrato.getTime();
    out.push({
      campo: "Último embarque",
      contrato: contrato.ultimoEmbarque ?? "",
      credito: lc.limiteEmbarque,
      desvio: antes ? "MAS_ESTRICTO" : "MAS_PERMISIVO",
      consecuencia: antes
        ? "El crédito cierra el embarque antes de lo pactado: hay que adelantar la carga."
        : "El crédito da más tiempo para embarcar que el contrato.",
    });
  }

  // Monto: si el crédito abre por menos, esa diferencia queda sin cobrar por esta vía.
  if (lc.monto != null && contrato.monto != null && lc.monto !== contrato.monto) {
    const falta = contrato.monto - lc.monto;
    out.push({
      campo: "Monto",
      contrato: `${contrato.moneda ?? ""} ${fmtImporte(contrato.monto)}`.trim(),
      credito: `${lc.moneda ?? ""} ${fmtImporte(lc.monto)}`.trim(),
      desvio: falta > 0 ? "MAS_ESTRICTO" : "MAS_PERMISIVO",
      consecuencia:
        falta > 0
          ? `El crédito abre por ${fmtImporte(falta)} menos de lo pactado: eso no se cobra contra este crédito.`
          : `El crédito abre por ${fmtImporte(-falta)} más de lo pactado.`,
    });
  }

  // Moneda: ninguna es «más» que la otra, pero cobrar en otra moneda es otro negocio.
  if (lc.moneda && contrato.moneda && norm(lc.moneda) !== norm(contrato.moneda)) {
    out.push({
      campo: "Moneda",
      contrato: contrato.moneda,
      credito: lc.moneda,
      desvio: "DIFIERE",
      consecuencia: "Se cobra en una moneda distinta de la pactada: el riesgo de cambio cambia de manos.",
    });
  }

  // Tolerancia: menos margen es más riesgo de que el embarque real no entre.
  const tolLc = lc.tolerancia;
  const tolContrato = contrato.tolerancia;
  if (tolLc != null && tolContrato != null && tolLc !== tolContrato) {
    const pct = (t: number) => `±${Math.round(t * 1000) / 10} %`;
    out.push({
      campo: "Tolerancia",
      contrato: pct(tolContrato),
      credito: pct(tolLc),
      desvio: tolLc < tolContrato ? "MAS_ESTRICTO" : "MAS_PERMISIVO",
      consecuencia:
        tolLc < tolContrato
          ? "Menos margen que el pactado: un embarque que el contrato admitía puede quedar fuera del crédito."
          : "Más margen que el pactado.",
    });
  }

  // Embarques parciales: el contrato los permitía y el crédito puede no hacerlo.
  const parcialesLc = extra.parciales ? !/not\s+allowed|prohibit/i.test(extra.parciales) : null;
  if (parcialesLc != null && contrato.parcialesPermitidos != null && parcialesLc !== contrato.parcialesPermitidos) {
    out.push({
      campo: "Embarques parciales",
      contrato: contrato.parcialesPermitidos ? "permitidos" : "no permitidos",
      credito: extra.parciales ?? "",
      desvio: contrato.parcialesPermitidos ? "MAS_ESTRICTO" : "MAS_PERMISIVO",
      consecuencia: contrato.parcialesPermitidos
        ? "Todo tiene que salir en un solo embarque, contra lo pactado."
        : "El crédito admite partir el embarque aunque el contrato no lo previera.",
    });
  }

  // Puertos e incoterm: no son «más» ni «menos», pero embarcar a otro puerto es otro flete.
  const par = (campo: string, delContrato: string | null | undefined, delCredito: string | null | undefined) => {
    if (!delContrato || !delCredito) return;
    // El contrato escribe «Colombo Port, Sri Lanka» y el crédito «COLOMBO,SRI LANKA»: no es una
    // diferencia, es la misma plaza escrita por dos personas distintas.
    const a = norm(delContrato)
      .replace(/\bport\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const b = norm(delCredito)
      .replace(/\bport\b|\bin\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (a === b || a.includes(b) || b.includes(a)) return;
    out.push({
      campo,
      contrato: delContrato,
      credito: delCredito,
      desvio: "DIFIERE",
      consecuencia: "No coincide con lo pactado: confirmarlo antes de reservar la bodega.",
    });
  };
  par("Puerto de embarque", contrato.puertoEmbarque, extra.puertoEmbarque);
  par("Puerto de destino", contrato.puertoDestino, extra.puertoDestino);

  return out;
}

export function resumenDesvios(d: DiferenciaContrato[]) {
  const documentosDeMas = d.filter((x) => x.desvio === "EXIGE_MAS").length;
  const aprietan = d.filter((x) => x.desvio === "EXIGE_MAS" || x.desvio === "MAS_ESTRICTO").length;
  return {
    total: d.length,
    documentosDeMas,
    aprietan,
    difieren: d.filter((x) => x.desvio === "DIFIERE").length,
    /** Hay algo que conviene pedir por enmienda antes de embarcar. */
    hayQuePedirEnmienda: aprietan > 0 || d.some((x) => x.desvio === "DIFIERE"),
  };
}

/**
 * El desvío en una línea, con el artículo que explica por qué esto no se le reclama al banco.
 *
 * La cita no es decorativa: lo primero que piensa quien ve esto es «entonces el banco se equivocó».
 * No se equivocó. El crédito es autónomo (art. 4 a) y la única vía es que el ordenante pida la
 * enmienda al emisor.
 */
export function describirDesvio(d: DiferenciaContrato): string {
  const flecha = d.desvio === "MAS_PERMISIVO" ? "a favor" : "en contra";
  return (
    `${d.campo}: el contrato dice «${d.contrato}» y el crédito «${d.credito}» (${flecha}). ` +
    `${d.consecuencia} El crédito es autónomo del contrato (UCP 600 art. 4 a): al banco no se le ` +
    `puede reclamar por esto, hay que pedirle al ordenante que gestione una enmienda.`
  );
}
