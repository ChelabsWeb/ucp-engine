import type { CamposDoc, TipoDocExterno } from "./consistencia";
import { aKg, cantidadDelCredito, parseNumero, unidadNormal } from "./consistencia";
import { parseFecha } from "./fechas";
import { esFacturaComercial } from "./isbp";
import { toleranciaDeCantidad } from "./lc";
import { mismaMoneda } from "./numeros";
import type { DocAnalizado, EstadoRegla, ReglaPresentacion } from "./presentacion";
import { articuloDelModo, modoDelDocumento, NOMBRE_MODO } from "./transporte";
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
  /** 59: el beneficiario, que es quien tiene que emitir la factura (art. 18a-i) */
  beneficiario?: string | null;
  /** 43P: "ALLOWED" / "NOT ALLOWED" */
  parciales?: string | null;
  /** 43T: transbordo */
  transbordo?: string | null;
  /** 40E: a qué reglas se declara sujeto el crédito (art. 1) */
  reglasAplicables?: string | null;
  /*
   * Los bancos que el crédito nombra, por BIC.
   *
   * De acá sale qué papel juega el banco que examina, y eso decide qué le exigen las UCP sobre el
   * mismo juego de papeles: honrar, poder honrar sin estar obligado, o no examinar para honrar.
   */
  /** 52A */
  bicEmisor?: string | null;
  /** 57A */
  bicAvisador?: string | null;
  /** 41A, cuando el crédito nombra al banco designado por su BIC */
  bicDisponibleCon?: string | null;
  /** el destinatario del mensaje, del encabezado */
  bicReceptor?: string | null;
  /** 41D/41A como texto: de acá sale la designación abierta que no se puede resolver */
  disponibleCon?: string | null;
  /** 49: si el crédito pide agregar la confirmación */
  confirmacion?: string | null;
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
/**
 * Si lo que el crédito escribe como lugar es una zona o un rango de puertos, no un puerto.
 *
 * El artículo 22 (a) (iii) lo admite expresamente para el conocimiento sujeto a fletamento —el
 * puerto de descarga puede mostrarse como un rango de puertos o una zona geográfica— y en los
 * graneles aparece en cualquier crédito: «EUROPEAN MAIN PORTS», «ARAG RANGE» (Amsterdam-Rotterdam-
 * Amberes-Gante), «US GULF PORTS», «ANY PORT IN SRI LANKA».
 */
function esZonaDeLugares(texto: string): boolean {
  const t = texto.toUpperCase();
  return (
    /\bRANGE\b|\bANY\s+PORT\b|\bMAIN\s+PORTS?\b|\bPORTS\b|\bAREA\b|\bCOAST\b|\bSEABOARD\b|CUALQUIER PUERTO|PUERTOS\b/.test(
      t,
    ) || /[A-Z]{3,}\s*\/\s*[A-Z]{3,}/.test(t)
  );
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
 */
function coincideLugar(a: string, b: string): boolean {
  const na = norm(a).trim();
  const nb = norm(b).trim();
  if (!na || !nb) return false;
  const pa = na.split(" ").filter((w) => w.length > 3);
  const pb = nb.split(" ").filter((w) => w.length > 3);
  if (pa.length === 0 || pb.length === 0) {
    // Al menos uno es un nombre corto: se compara entero, y vale que uno esté dentro del otro
    // («IBM» contra «IBM WORLD TRADE CORPORATION»), por palabra para no casar fragmentos.
    const palabras = (t: string) => t.split(" ").filter(Boolean);
    const cortas = pa.length === 0 ? palabras(na) : palabras(nb);
    const otras = pa.length === 0 ? palabras(nb) : palabras(na);
    return cortas.length > 0 && cortas.every((w) => otras.includes(w));
  }
  return pa.some((w) => pb.includes(w));
}

/** Descripciones de mercadería: o una contiene a la otra, o comparten dos palabras propias. */
/** Si dos descripciones se parecen lo bastante: una dentro de otra, o dos palabras propias en común. */
function seParecen(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const pa = na.split(" ").filter((w) => w.length > 3);
  const pb = new Set(nb.split(" ").filter((w) => w.length > 3));
  return pa.filter((w) => pb.has(w)).length >= 2;
}

/**
 * La descripción del documento contra la del crédito (art. 18 c para la factura).
 *
 * Cuando el crédito **enumera** mercaderías se compara contra cada ítem, no contra la lista entera.
 * La diferencia la mostró un cruce de 57 pares reales del ERP de un trader de carne: el motor dejaba
 * pasar ocho facturas que describían un corte que el crédito no pedía, porque compartían «BEEF» y
 * «WAGYU» con alguna otra línea de la lista. Dos palabras del rubro alcanzaban para dar por buena
 * una descripción ajena, y en carne el 45A enumera siempre — son decenas de cortes.
 *
 * Contra una lista, el parecido con el todo no dice nada: lo que importa es si la factura cae en
 * alguno de los renglones.
 */
function coincideDescripcion(enDocumento: string, enCredito: string): boolean {
  const items = enCredito
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter((x) => x.length > 3);
  if (items.length <= 1) return seParecen(enDocumento, enCredito);

  /*
   * Lo que se repite en todos los renglones no distingue ninguno.
   *
   * En una lista de cortes de carne, «BEEF» y «WAGYU» están en todas las líneas: compartirlas no
   * dice que la factura traiga ese corte, dice que las dos hablan de carne. Las palabras que
   * identifican son las que **varían** entre renglones, y no hace falta una lista por rubro para
   * saber cuáles son: se calculan del propio crédito.
   */
  const palabras = (t: string) =>
    new Set(
      norm(t)
        .split(" ")
        .filter((w) => w.length > 3),
    );
  const porItem = items.map(palabras);
  /*
   * Por mayoría y no por unanimidad: una lista de sesenta cortes no es homogénea —«WAGYU TAIL» no
   * lleva el código BMS que llevan los demás— y exigir que la palabra esté en todos los renglones
   * no descuenta nada. Dos tercios alcanzan para reconocer el encabezado del rubro.
   */
  const umbral = Math.ceil(porItem.length * (2 / 3));
  const cuenta = new Map<string, number>();
  for (const p of porItem) for (const w of p) cuenta.set(w, (cuenta.get(w) ?? 0) + 1);
  const comunes = [...cuenta].filter(([, n]) => n >= umbral).map(([w]) => w);
  const sinLoComun = (t: string) =>
    norm(t)
      .split(" ")
      .filter((w) => !comunes.includes(w))
      .join(" ");

  return items.some((it) => seParecen(sinLoComun(enDocumento), sinLoComun(it)));
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
  CERTIFICADO: "Certificado",
  SEGURO: "Documento de seguro",
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
            mismaMoneda(moneda, lc.moneda) ? "OK" : "DISCREPANCIA",
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

/* ─────────── qué documento es este (ISBP 821 C1) ─────────── */

/**
 * Una factura titulada «proforma» o «provisional» no satisface la exigencia de factura comercial.
 *
 * La regla estaba escrita en `isbp.ts`, exportada y probada, y nadie la llamaba: el examen no la
 * ejecutaba nunca. Apareció en un backtest contra los tipos de documentos del expediente del ERP, donde
 * «Proforma invoice» se clasificaba igual que una factura comercial.
 *
 * Importa más desde que lo no exigido se desestima (art. 14 g): si la proforma cuenta como la
 * factura del crédito, el crédito queda dado por cumplido con un documento que no lo cumple.
 */
function reglasQueDocumentoEs(docs: DocAnalizado[]): ReglaPresentacion[] {
  const fac = docs.find((d) => d.tipo === "FACTURA");
  if (!fac) return [];
  const titulo = val(fac, "tipoDocumento");
  if (!titulo) {
    return [sinLeer("isbp-c1", "ISBP 821 C1", "El documento es una factura comercial", "el título de la factura")];
  }
  const v = esFacturaComercial(titulo);
  return [
    regla(
      "isbp-c1",
      "ISBP 821 C1",
      "El documento es una factura comercial",
      v.vale ? "OK" : "DISCREPANCIA",
      v.vale ? `se titula "${titulo}"` : `se titula "${titulo}": ${v.motivo}`,
    ),
  ];
}

/* ─────────── si las UCP se aplican a este crédito (art. 1) ─────────── */

/**
 * El artículo que habilita a todos los demás.
 *
 * «Las UCP son reglas que se aplican a cualquier crédito documentario cuando el texto del crédito
 * indica expresamente que está sujeto a ellas. Son vinculantes para todas las partes salvo que el
 * crédito las modifique o excluya expresamente.»
 *
 * Las dos mitades importan. Un crédito que no se declara sujeto a las UCP —o que se declara sujeto
 * a una versión anterior— no se examina con estas reglas, y el motor lo hacía sin decir una
 * palabra. Y un crédito que excluye un sub-artículo cambia el examen: el propio motor menciona esa
 * posibilidad en la regla del transbordo sin contemplarla.
 *
 * Ninguna de las dos se dictamina como discrepancia: no son defectos de los documentos, son avisos
 * sobre con qué regla se está midiendo.
 */
function reglasAplicacion(lc: LcInfo, ctx: ContextoCredito): ReglaPresentacion[] {
  const out: ReglaPresentacion[] = [];
  const reglas = (ctx.reglasAplicables ?? "").trim();

  if (!/\bUCP\b/i.test(reglas)) {
    out.push(
      regla(
        "ucp-1",
        "UCP 600 1",
        "El crédito se declara sujeto a las UCP 600",
        "ATENCION",
        reglas
          ? `el campo 40E dice "${reglas}" y no menciona las UCP: verificar con qué reglas corresponde examinar`
          : "el crédito no dice expresamente estar sujeto a las UCP: este examen las aplica igual, verificar si corresponde",
      ),
    );
  } else {
    // «UCP 500», «UCP 400»: el motor examina con las 600 y la diferencia entre revisiones no es menor.
    const version = /\bUCP\s*(\d{3})\b/i.exec(reglas)?.[1];
    if (version && version !== "600") {
      out.push(
        regla(
          "ucp-1",
          "UCP 600 1",
          "El crédito se declara sujeto a las UCP 600",
          "ATENCION",
          `el campo 40E dice "${reglas}": este examen aplica las UCP 600 y el crédito nombra otra revisión`,
        ),
      );
    }
  }

  /*
   * Las exclusiones expresas.
   *
   * No se desactiva ninguna regla —adivinar qué quiso excluir el crédito es peor que no hacer
   * nada— pero quien examina tiene que saber que el crédito modificó las reglas con las que el
   * motor está midiendo.
   */
  const texto = [...(lc.condicionesAdicionales ?? []), ...(lc.documentosExigidos ?? [])].join(" · ");
  const exclusion =
    /(sub-?article|art[ií]culo)\s*([0-9]{1,2}\s*\(?[a-z]?\)?)[^.·]{0,40}(excluded|does not apply|no se aplica|excluido)/i.exec(
      texto,
    ) ?? /(excluded|excluido)[^.·]{0,30}(sub-?article|art[ií]culo)\s*([0-9]{1,2})/i.exec(texto);
  if (exclusion) {
    out.push(
      regla(
        "ucp-1-exclusion",
        "UCP 600 1",
        "El crédito excluye o modifica una regla de las UCP",
        "ATENCION",
        `dice "${exclusion[0].slice(0, 90)}" — el examen aplica esa regla igual: verificar a mano qué cambia`,
      ),
    );
  }

  return out;
}

/* ─────────── quién emite y quién embarca (arts. 18 a i y 14 k) ─────────── */

/**
 * La factura la emite el beneficiario; el que embarca puede ser cualquiera.
 *
 * Son dos preguntas distintas y el motor las trataba como una sola, en un aviso que terminaba
 * diciendo «si la LC no admite documentos de terceros, es discrepancia». Para el embarcador eso es
 * falso: el artículo 14 (k) dice que el shipper o consignador indicado en **cualquier** documento no
 * necesita ser el beneficiario del crédito, y no lo condiciona a nada. Lo que sí tiene que emitir el
 * beneficiario es la factura comercial (18 a i), salvo en un crédito transferido, donde la emite el
 * segundo beneficiario.
 *
 * En el expediente del caso se ven las dos cosas a la vez: factura de Cerealsur, que es el
 * beneficiario, y conocimiento a nombre de Molsur, que es el productor que embarca. Lo primero
 * cumple el 18 (a) (i) y lo segundo lo permite el 14 (k).
 */
function reglasQuienEmite(ctx: ContextoCredito, docs: DocAnalizado[]): ReglaPresentacion[] {
  const out: ReglaPresentacion[] = [];
  const fac = docs.find((d) => d.tipo === "FACTURA");

  if (fac) {
    const emisor = val(fac, "exportador");
    if (!emisor) {
      out.push(sinLeer("ucp-18a-i", "UCP 600 18a-i", "La factura la emite el beneficiario", "quién emite la factura"));
    } else if (!ctx.beneficiario) {
      out.push(
        regla(
          "ucp-18a-i",
          "UCP 600 18a-i",
          "La factura la emite el beneficiario",
          "ATENCION",
          `la factura dice "${emisor}" y no se leyó el beneficiario del crédito: verificar a mano`,
        ),
      );
    } else {
      out.push(
        regla(
          "ucp-18a-i",
          "UCP 600 18a-i",
          "La factura la emite el beneficiario",
          coincideLugar(emisor, ctx.beneficiario) ? "OK" : "DISCREPANCIA",
          `la factura dice "${emisor}" y el crédito nombra beneficiario a "${ctx.beneficiario}"`,
        ),
      );
    }
  }

  /*
   * El embarcador, que es donde estaba el falso positivo.
   *
   * Se informa igual —que el nombre difiera puede ser señal de otra cosa y el examinador quiere
   * verlo— pero como lo que es: algo que el artículo permite. Antes el mismo hecho salía sugiriendo
   * que podía ser discrepancia.
   */
  const transporte = docs.find((d) => d.tipo === "BL");
  const shipper = transporte ? val(transporte, "exportador") : null;
  if (shipper && ctx.beneficiario && !coincideLugar(shipper, ctx.beneficiario)) {
    out.push(
      regla(
        "ucp-14k",
        "UCP 600 14k",
        "El embarcador del documento de transporte no tiene que ser el beneficiario",
        "OK",
        `el documento de transporte dice "${shipper}" y el beneficiario es "${ctx.beneficiario}": el artículo 14 (k) admite que no coincidan`,
      ),
    );
  }

  return out;
}

/* ─────────── multimodal, terrestre y courier (arts. 19, 24 y 25) ─────────── */

/**
 * Los lugares que fija el crédito, con la aclaración que traen los artículos 19 y 24.
 *
 * El 19 (a) (iii) dice que el documento cumple aunque además indique otro lugar, y aunque califique
 * el buque o el puerto como «intended». Esa palabra en un documento marítimo obliga a una anotación
 * de a bordo (art. 20); en uno multimodal, no. Compartir esta función entre los dos artículos
 * mantiene el criterio igual donde el texto es igual.
 */
/**
 * El veredicto de comparar un lugar del documento contra lo que dice el crédito.
 *
 * Cuando el crédito indica una zona y el documento un puerto concreto, el motor **no puede** saber
 * si ese puerto está dentro: no tiene geografía, y adivinarla sería inventar. Lo manda a verificar.
 * Marcar discrepancia sobre un embarque correcto —Rotterdam contra «EUROPEAN MAIN PORTS»— es peor
 * que pedir que alguien lo mire: la discrepancia falsa cuesta el fee, la demora y la confianza.
 */
function veredictoLugar(enDoc: string, delCredito: string): { estado: EstadoRegla; nota: string } {
  if (coincideLugar(enDoc, delCredito)) return { estado: "OK", nota: "" };
  if (esZonaDeLugares(delCredito)) {
    return {
      estado: "ATENCION",
      nota: " — el crédito indica una zona o un rango de puertos, así que hay que verificar a mano que el lugar del documento esté dentro",
    };
  }
  return { estado: "DISCREPANCIA", nota: "" };
}

function reglasLugares(
  doc: DocAnalizado,
  ctx: ContextoCredito,
  fuente: string,
  prefijo: string,
  comoSeLlama: [string, string],
): ReglaPresentacion[] {
  const out: ReglaPresentacion[] = [];
  for (const [k, delCredito, cual, sufijo] of [
    ["puertoEmbarque", ctx.puertoEmbarque, comoSeLlama[0], "carga"],
    ["puertoDestino", ctx.puertoDestino, comoSeLlama[1], "destino"],
  ] as const) {
    if (!delCredito) continue;
    const enDoc = val(doc, k);
    const id = `${prefijo}-${sufijo}`;
    out.push(
      enDoc
        ? (() => {
            const v = veredictoLugar(enDoc, delCredito);
            return regla(
              id,
              fuente,
              `${cual} el que indica el crédito (${delCredito})`,
              v.estado,
              `el documento dice "${enDoc}"${v.nota}`,
            );
          })()
        : sinLeer(id, fuente, `${cual} el que indica el crédito`, cual.toLowerCase()),
    );
  }
  return out;
}

/**
 * El documento que cubre al menos dos modos de transporte (art. 19).
 *
 * Se diferencia del marítimo en dos cosas que importan: la mercadería puede constar **despachada,
 * tomada a cargo o embarcada** —no hace falta que diga «a bordo»— y el transbordo se admite aunque
 * el crédito lo prohíba, siempre que todo el trayecto vaya en el mismo documento, que es
 * justamente lo que un documento multimodal hace.
 */
function reglasMultimodal(ctx: ContextoCredito, doc: DocAnalizado): ReglaPresentacion[] {
  const out: ReglaPresentacion[] = [];

  const constancia = val(doc, "onBoard");
  out.push(
    constancia
      ? regla(
          "ucp-19a-ii",
          "UCP 600 19a-ii",
          "La mercadería consta despachada, tomada a cargo o embarcada en el lugar del crédito",
          /dispatch|taken in charge|shipped|on board|despach|tomad/i.test(constancia) ? "OK" : "ATENCION",
          `dice "${constancia}"`,
        )
      : sinLeer(
          "ucp-19a-ii",
          "UCP 600 19a-ii",
          "La mercadería consta despachada, tomada a cargo o embarcada",
          "esa constancia",
        ),
  );

  out.push(
    ...reglasLugares(doc, ctx, "UCP 600 19a-iii", "ucp-19a-iii", [
      "Lugar de despacho o toma a cargo",
      "Lugar de destino final",
    ]),
  );

  if (ctx.transbordo && /not\s+allowed|prohib/i.test(ctx.transbordo)) {
    out.push(
      regla(
        "ucp-19c-ii",
        "UCP 600 19c-ii",
        "El transbordo no hace discrepante a un documento multimodal",
        "OK",
        `el crédito dice "${ctx.transbordo}", pero el artículo 19 (c) (ii) lo admite mientras todo el trayecto vaya en el mismo documento`,
      ),
    );
  }

  return out;
}

/**
 * Carretera, ferrocarril o vía navegable (art. 24).
 *
 * Lo propio de este artículo son los originales: un documento de carretera tiene que ser el
 * original para el expedidor —o no llevar marca de para quién es— y uno ferroviario marcado
 * «duplicate» se acepta como original. Esa última es la que hace rechazar de más, porque la palabra
 * «duplicate» en cualquier otro documento significa lo contrario.
 */
function reglasTerrestre(ctx: ContextoCredito, doc: DocAnalizado): ReglaPresentacion[] {
  const out: ReglaPresentacion[] = [];

  const emision = val(doc, "fechaDocumento");
  const recepcion = val(doc, "onBoard");
  out.push(
    emision || recepcion
      ? regla(
          "ucp-24a-ii",
          "UCP 600 24a-ii",
          "La fecha de embarque es la del sello de recepción o, si no lo hay, la de emisión",
          "OK",
          recepcion
            ? `rige el sello de recepción, "${recepcion}"`
            : `no se leyó sello de recepción: rige la fecha de emisión, "${emision}"`,
        )
      : sinLeer("ucp-24a-ii", "UCP 600 24a-ii", "Fecha de recepción o de emisión", "la fecha"),
  );

  out.push(...reglasLugares(doc, ctx, "UCP 600 24a-iii", "ucp-24a-iii", ["Lugar de embarque", "Lugar de destino"]));

  const marca = val(doc, "juegoOriginales");
  const esFerroviario = /rail|ferrocarril|tren|waterway|navegable/i.test(val(doc, "tipoTransporte") ?? "");
  if (marca) {
    const duplicado = /duplicate|duplicado/i.test(marca);
    out.push(
      regla(
        "ucp-24b",
        esFerroviario ? "UCP 600 24b-ii" : "UCP 600 24b-i",
        esFerroviario
          ? "Un documento ferroviario marcado «duplicate» se acepta como original"
          : "El documento es el original para el expedidor o no lleva marca de destinatario",
        esFerroviario || !duplicado ? "OK" : "ATENCION",
        esFerroviario && duplicado
          ? `dice "${marca}", y el artículo 24 (b) (ii) lo acepta como original`
          : `dice "${marca}"`,
      ),
    );
  }

  return out;
}

/**
 * Recibo de courier, de correo o certificado de imposición (art. 25).
 *
 * Es el más corto de los siete y lo que pide es poco: quién es el courier, su sello o firma, y la
 * fecha de recogida o de recibo, que es la fecha de embarque. No hay originales ni juego que
 * comprobar.
 */
function reglasCourier(doc: DocAnalizado): ReglaPresentacion[] {
  const out: ReglaPresentacion[] = [];
  const nombre = val(doc, "tipoTransporte");

  /*
   * La firma y el sello no se leen de un escaneo con la confianza que haría falta para dictaminar,
   * así que esto va como verificación a mano, igual que en el resto del motor: el examinador mira
   * el papel. Decir «OK» sobre una firma que nadie miró sería lo único peor que no decir nada.
   */
  out.push(
    regla(
      "ucp-25a-i",
      "UCP 600 25a-i",
      "El recibo nombra al courier y está sellado o firmado por él",
      "ATENCION",
      nombre ? `el documento se titula "${nombre}": verificar el sello o la firma a mano` : "verificar a mano",
    ),
  );

  const fecha = val(doc, "fechaDocumento");
  out.push(
    fecha
      ? regla(
          "ucp-25b",
          "UCP 600 25b",
          "La fecha de recogida o de recibo es la fecha de embarque",
          "OK",
          `rige la fecha del recibo, "${fecha}"`,
        )
      : sinLeer("ucp-25b", "UCP 600 25b", "Fecha de recogida o de recibo", "la fecha del recibo"),
  );

  return out;
}

/* ──────────────────── transporte aéreo (art. 23) ──────────────────── */

/**
 * El documento de transporte aéreo.
 *
 * Tres de estas reglas existen porque son las que un examinador se equivoca, y las tres en la misma
 * dirección: rechazar un aéreo por no parecerse a un marítimo. El artículo las resuelve
 * expresamente, así que acá se aplican a favor del documento y se deja dicho por qué.
 */
function reglasAereo(ctx: ContextoCredito, awb: DocAnalizado): ReglaPresentacion[] {
  const out: ReglaPresentacion[] = [];

  // 23a-ii: la mercadería tiene que constar aceptada para transporte —no «a bordo», que es marítimo
  const aceptado = val(awb, "onBoard");
  out.push(
    aceptado
      ? regla(
          "ucp-23a-ii",
          "UCP 600 23a-ii",
          "El documento indica que la mercadería fue aceptada para transporte",
          /accept|received|taken in charge|recib/i.test(aceptado) ? "OK" : "ATENCION",
          `dice "${aceptado}"`,
        )
      : sinLeer("ucp-23a-ii", "UCP 600 23a-ii", "La mercadería consta aceptada para transporte", "esa indicación"),
  );

  /*
   * 23a-iii: la fecha de emisión es la de embarque, salvo notación expresa del embarque real.
   *
   * Y el artículo lo dice con todas las letras: cualquier otra información sobre el número y la
   * fecha del vuelo NO se tiene en cuenta para determinar la fecha de embarque. Es la trampa del
   * artículo: el air waybill trae un recuadro con vuelo y fecha que suele ser posterior, y tomarla
   * corre el embarque unos días —a veces contra el límite del 44C— por un dato que no cuenta.
   */
  const emision = val(awb, "fechaDocumento");
  const notacion = val(awb, "onBoard") ?? "";
  const esSoloVuelo = /flight|vuelo/i.test(notacion) && !/actual date of shipment|fecha real/i.test(notacion);
  out.push(
    emision
      ? regla(
          "ucp-23a-iii",
          "UCP 600 23a-iii",
          "La fecha de embarque es la de emisión, salvo notación del embarque real",
          "OK",
          esSoloVuelo
            ? `rige la fecha de emisión, "${emision}": el número de vuelo y su fecha no cuentan para determinar la fecha de embarque`
            : `rige la fecha de emisión, "${emision}"`,
        )
      : sinLeer("ucp-23a-iii", "UCP 600 23a-iii", "Fecha de emisión del documento aéreo", "la fecha de emisión"),
  );

  // 23a-iv: aeropuerto de salida y de destino, los que fija el crédito
  for (const [k, delCredito, cual] of [
    ["puertoEmbarque", ctx.puertoEmbarque, "de salida"],
    ["puertoDestino", ctx.puertoDestino, "de destino"],
  ] as const) {
    if (!delCredito) continue;
    const enDoc = val(awb, k);
    const id = `ucp-23a-iv-${k === "puertoEmbarque" ? "carga" : "destino"}`;
    out.push(
      enDoc
        ? (() => {
            const v = veredictoLugar(enDoc, delCredito);
            return regla(
              id,
              "UCP 600 23a-iv",
              `Aeropuerto ${cual} el que indica el crédito (${delCredito})`,
              v.estado,
              `el documento dice "${enDoc}"${v.nota}`,
            );
          })()
        : sinLeer(id, "UCP 600 23a-iv", `Aeropuerto ${cual} el que indica el crédito`, `el aeropuerto ${cual}`),
    );
  }

  /*
   * 23a-v: alcanza el original del expedidor, aunque el crédito pida el juego completo.
   *
   * El crédito del caso dice «FULL SET OF (3/3) ORIGINAL BILLS OF LADING». En un aéreo eso no se
   * puede cumplir: de los tres originales que emite el transportista, al expedidor le queda uno.
   * El artículo lo resuelve a favor del documento, así que exigir el juego sería rechazar lo único
   * que se entrega.
   */
  const juego = val(awb, "juegoOriginales");
  out.push(
    regla(
      "ucp-23a-v",
      "UCP 600 23a-v",
      "Basta el original para el expedidor, aunque el crédito pida el juego completo",
      "OK",
      juego
        ? `el documento dice "${juego}"; el artículo 23 (a) (v) admite el original del expedidor aunque el crédito exija el juego completo`
        : "el artículo 23 (a) (v) admite el original del expedidor aunque el crédito exija el juego completo",
    ),
  );

  /*
   * 23c-ii: el transbordo se acepta aunque el crédito lo prohíba.
   *
   * Otra que el artículo resuelve expresamente y que a un examinador acostumbrado al marítimo le
   * sale al revés: en el 20 el transbordo prohibido es discrepancia, en el aéreo no.
   */
  if (ctx.transbordo && /not\s+allowed|prohib/i.test(ctx.transbordo)) {
    out.push(
      regla(
        "ucp-23c-ii",
        "UCP 600 23c-ii",
        "El transbordo no hace discrepante a un documento aéreo",
        "OK",
        `el crédito dice "${ctx.transbordo}", pero el artículo 23 (c) (ii) lo admite aunque el crédito lo prohíba`,
      ),
    );
  }

  return out;
}

/* ──────────────────── documento de transporte (arts. 20, 26, 27) ──────────────────── */

function reglasTransporte(ctx: ContextoCredito, bl: DocAnalizado, exigidos: string[]): ReglaPresentacion[] {
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
        ? (() => {
            const v = veredictoLugar(enDoc, puertoLC);
            return regla(
              `ucp-20a-iii-${k}`,
              "UCP 600 20a-iii",
              `Puerto ${cual} el que indica el crédito (${puertoLC})`,
              v.estado,
              `el documento dice "${enDoc}"${v.nota}`,
            );
          })()
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

  /*
   * 20a-vi: el conocimiento no puede estar sujeto a un contrato de fletamento.
   *
   * Salvo que el crédito pida uno. En los graneles es corriente —un crédito de cereal o de harina a
   * granel exige «CHARTER PARTY BILL OF LADING» en el 46A— y para eso existe el artículo 22, que lo
   * examina con sus propias reglas. Marcarlo como discrepancia por estar sujeto a fletamento sería
   * rechazar el documento que el propio crédito pidió.
   */
  const charter = val(bl, "charterParty");
  if (charter) {
    const loPideElCredito = exigidos.some((d) => /charter\s*part/i.test(d));
    out.push(
      regla(
        "ucp-20a-vi",
        loPideElCredito ? "UCP 600 22" : "UCP 600 20a-vi",
        loPideElCredito
          ? "El crédito pide un conocimiento sujeto a fletamento y el presentado lo es"
          : "El conocimiento no indica estar sujeto a contrato de fletamento",
        /no|sin|not/i.test(charter) || loPideElCredito ? "OK" : "DISCREPANCIA",
        loPideElCredito ? `el 46A lo exige y el documento dice "${charter}"` : `dice "${charter}"`,
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

  /*
   * 27: el documento de transporte tiene que estar limpio.
   *
   * El artículo lo define por lo que NO tiene: ninguna cláusula que declare defectuosa la
   * mercadería o el embalaje. Así que un campo que dice «N/A», «NIL», «NONE» o un guion es un
   * documento limpio —son las formas de escribir «acá no hay nada»— y el motor las marcaba
   * discrepantes porque solo reconocía cuatro palabras. Marcaba discrepancia sobre un conocimiento
   * impecable.
   */
  const SIN_CLAUSULA =
    /^\s*(n\s*\/\s*a|nil|none|no|not\s+applicable|ninguna?|sin\s+(observaciones|clausulas?|novedad)|[-—–.]+)\s*$/i;
  const defecto = val(bl, "clausulaDefecto");
  out.push(
    defecto
      ? regla(
          "ucp-27",
          "UCP 600 27",
          "Documento de transporte limpio",
          SIN_CLAUSULA.test(defecto) || /no clause|limpio|clean/i.test(defecto) ? "OK" : "DISCREPANCIA",
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
  /** el documento de transporte, que es el que evidencia la fecha de embarque (arts. 19 a 25) */
  transporteSeg: DocAnalizado | undefined,
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

  /*
   * 28 e: la fecha del seguro no puede ser posterior a la del embarque, con su excepción.
   *
   * Dos cosas que estaban mal. La fecha de embarque se tomaba de la factura, y la que la evidencia
   * es el documento de transporte (arts. 19 a 25): con una factura que trae el ETD de la proforma y
   * un a bordo posterior, un seguro conforme salía discrepante. Y el fallback iba al último día de
   * embarque del crédito, que no es una fecha de embarque sino un límite: por ahí se colaba lo
   * contrario, un seguro tardío dado por bueno.
   *
   * Y falta la excepción, que es el caso corriente: «unless it appears from the insurance document
   * that the cover is effective from a date not later than the date of shipment». Los certificados
   * bajo póliza flotante se emiten después del a bordo con una cláusula de cobertura anterior, y el
   * artículo los acepta expresamente. El motor no puede leer esa fecha —el campo de cobertura es un
   * lugar, no una fecha— así que cuando el documento menciona una cobertura efectiva, manda a
   * verificar en vez de dictaminar.
   */
  const fSeg = val(seg, "fechaSeguro") ?? val(seg, "fechaDocumento");
  /** La fecha de embarque, de la anotación de a bordo primero y del campo después. */
  const embarque = (() => {
    const onBoard = transporteSeg ? val(transporteSeg, "onBoard") : null;
    const delOnBoard = onBoard ? fechaEnTexto(onBoard) : null;
    if (delOnBoard && onBoard) return { fecha: delOnBoard, texto: onBoard };
    const campoFecha = (transporteSeg ? val(transporteSeg, "fechaEmbarque") : null) ?? val(factura, "fechaEmbarque");
    const f = campoFecha ? parseFecha(campoFecha) : null;
    return f && campoFecha ? { fecha: f, texto: campoFecha } : null;
  })();
  const fEmb = embarque?.texto ?? null;
  const a = fSeg ? parseFecha(fSeg) : null;
  const b = embarque?.fecha ?? null;
  /*
   * La excepción del 28 (e): el documento puede estar fechado después del embarque si dice que la
   * cobertura rige desde una fecha no posterior a él.
   *
   * Se buscaba en `coberturaDesde`, que es un **lugar**, así que la excepción era inalcanzable: un
   * certificado bajo póliza flotante emitido después del embarque —el caso corriente— salía
   * discrepante por construcción. La cláusula tiene su propio campo desde ahora.
   */
  const mencionaCoberturaEfectiva =
    /effective|efectiva|attachment|attaching|desde el|from\s+\d|warehouse to warehouse/i.test(
      `${val(seg, "vigenciaSeguro") ?? ""} ${val(seg, "coberturaDesde") ?? ""} ${val(seg, "tipoSeguro") ?? ""}`,
    );
  out.push(
    a && b
      ? a <= b
        ? regla(
            "ucp-28e",
            "UCP 600 28e",
            "El seguro no está fechado después del embarque",
            "OK",
            `seguro ${fSeg} · embarque ${fEmb}`,
          )
        : mencionaCoberturaEfectiva
          ? regla(
              "ucp-28e",
              "UCP 600 28e",
              "El seguro no está fechado después del embarque",
              "ATENCION",
              `seguro ${fSeg} · embarque ${fEmb} — el documento menciona una cobertura efectiva: si corre desde una fecha no posterior al embarque, el artículo lo admite; verificarlo a mano`,
            )
          : regla(
              "ucp-28e",
              "UCP 600 28e",
              "El seguro no está fechado después del embarque",
              "DISCREPANCIA",
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
            mismaMoneda(monedaSeg, lc.moneda) ? "OK" : "DISCREPANCIA",
            `seguro en ${monedaSeg}`,
          )
        : sinLeer("ucp-28f-i", "UCP 600 28f-i", "Seguro en la moneda del crédito", "la moneda del seguro"),
    );
  }

  /*
   * 28 f ii: la cobertura mínima, con la base y el porcentaje que el artículo manda.
   *
   * El inciso nombra tres bases y **el monto del crédito no es ninguna**: el valor CIF/CIP, y si no
   * se puede determinar de los documentos, el importe girado o el valor bruto de la factura, el
   * mayor de los dos. Cayendo al monto del crédito, cualquier embarque parcial cuya factura no se
   * lea salía con discrepancia de seguro por un importe que nadie exige.
   *
   * Y el 110 % rige **solo si el crédito no indica nada**: «a requirement in the credit for
   * insurance coverage to be for a percentage … is deemed to be the minimum amount of coverage
   * required». Un seguro que cumple exactamente lo que pidió el banco emisor no puede rechazarse
   * por no llegar a un porcentaje que el crédito no pidió.
   */
  const montoSeg = parseNumero(val(seg, "montoAsegurado") ?? val(seg, "montoTotal") ?? "");
  const base = parseNumero(val(factura, "montoTotal") ?? "");
  const pctDelCredito = (() => {
    const texto = [...(lc.documentosExigidos ?? []), ...(lc.condicionesAdicionales ?? [])].join(" ");
    const m = /(\d{2,3})\s*(?:PCT|%|PER\s*CENT)/i.exec(texto);
    const n = m ? Number(m[1]) : null;
    return n !== null && n >= 100 && n <= 200 ? n : null;
  })();
  const pct = pctDelCredito ?? 110;
  if (montoSeg !== null && base !== null && base > 0) {
    const minimo = (base * pct) / 100;
    const fmt = (n: number) => n.toLocaleString("es-UY", { maximumFractionDigits: 2 });
    out.push(
      regla(
        "ucp-28f-ii",
        "UCP 600 28f-ii",
        pctDelCredito
          ? `Cobertura de al menos el ${pct} % que exige el crédito`
          : "Cobertura de al menos el 110 % del valor de la mercadería",
        montoSeg + 1e-9 >= minimo ? "OK" : "DISCREPANCIA",
        `asegurado ${fmt(montoSeg)} · mínimo exigible ${fmt(minimo)} (${pct} % de ${fmt(base)})`,
      ),
    );
  } else if (montoSeg === null) {
    out.push(sinLeer("ucp-28f-ii", "UCP 600 28f-ii", "Cobertura de al menos el 110 %", "el importe asegurado"));
  }

  // 28f-iii: la cobertura corre entre el lugar de embarque y el de destino
  const desde = val(seg, "coberturaDesde");
  const hasta = val(seg, "coberturaHasta");
  if (ctx.puertoEmbarque && ctx.puertoDestino) {
    /*
     * El campo espera un lugar y el documento puede traer otra cosa.
     *
     * «COVER EFFECTIVE FROM 01-APR-2025» es una cláusula de vigencia, no una plaza: compararla
     * contra el puerto del crédito da discrepancia por un texto que ni siquiera nombra un lugar.
     * Si lo que se leyó trae una fecha, no es un tramo y no se dictamina.
     */
    const pareceLugar = (t: string) => fechaEnTexto(t) === null;
    const veredicto = (t: string, delCredito: string) =>
      pareceLugar(t) ? veredictoLugar(t, delCredito).estado : "ATENCION";
    out.push(
      desde && hasta
        ? regla(
            "ucp-28f-iii",
            "UCP 600 28f-iii",
            "La cobertura va del lugar de embarque al de destino",
            veredicto(desde, ctx.puertoEmbarque) === "OK" && veredicto(hasta, ctx.puertoDestino) === "OK"
              ? "OK"
              : veredicto(desde, ctx.puertoEmbarque) === "DISCREPANCIA" ||
                  veredicto(hasta, ctx.puertoDestino) === "DISCREPANCIA"
                ? "DISCREPANCIA"
                : "ATENCION",
            `cubre de "${desde}" a "${hasta}" · el crédito pide de "${ctx.puertoEmbarque}" a "${ctx.puertoDestino}"`,
          )
        : sinLeer("ucp-28f-iii", "UCP 600 28f-iii", "La cobertura va del embarque al destino", "el tramo cubierto"),
    );
  }
  return out;
}

/* ──────────────────── reglas que valen para cualquier documento ──────────────────── */

/**
 * Si la unidad mide volumen.
 *
 * El 5 % del artículo 30 (b) no corre sobre «a stipulated number of packing units or individual
 * items», y el volumen no es ninguna de las dos: va con el peso. Ponerle tolerancia cero a los
 * litros hacía discrepante un embarque de 19.600 contra 20.000, que cumple.
 */
function esVolumen(unidad: string): boolean {
  return /^(litros?|lt?rs?|liters?|litres?|l|m3|cbm|metros?\s*c[uú]bicos?)$/i.test(unidad.trim());
}

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
    /*
     * La condición es que el crédito exprese LA CANTIDAD en bultos, no que mencione el embalaje.
     *
     * «57 MTS OF FISH MEAL PACKED IN BAGS OF 50 KG» expresa la cantidad en toneladas y el ±5 %
     * corre; antes bastaba con que apareciera la palabra «bags» en cualquier parte del 45A para
     * anunciar lo contrario. Lo que se busca es un número seguido de la unidad de bulto, que es
     * como se escribe una cantidad en bultos.
     */
    const enBultos = /\b\d[\d.,]*\s*(bags?|cartons?|boxe?s?|packages?|bultos?|cajas?|units?|pieces?|pcs)\b/i.test(
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
        enBultos
          ? "la cantidad se compara exacta"
          : `se aplica ±${Math.round(toleranciaDeCantidad(lc) * 100)} % a la cantidad`,
      ),
    );
  }

  /*
   * ── art. 30: la cantidad de la factura contra la que pide el crédito ──
   *
   * La regla de arriba solo **anunciaba** la tolerancia; faltaba aplicarla. El único cotejo de
   * cantidad que había era entre documentos (14 d), así que si la factura, el packing y el
   * conocimiento decían todos 48 toneladas contra un crédito de 57, no había nada que marcar: un
   * embarque 16 % corto pasaba en silencio.
   *
   * La tolerancia sale del crédito cuando la declara (39A) y del 30 (b) cuando no. Las magnitudes
   * que no se pueden convertir entre sí —cabezas contra kilos— no se comparan: pueden ser la misma
   * carga, y una discrepancia inventada ahí sería peor que el silencio.
   */
  const pedido = cantidadDelCredito(ctx.mercaderia);
  const factura = docs.find((d) => d.tipo === "FACTURA");
  const cantFac = factura ? val(factura, "cantidad") : null;
  const uniFac = factura ? val(factura, "unidad") : null;
  if (pedido && cantFac) {
    const n = parseNumero(cantFac);
    const enKgPedido = aKg(pedido.valor, pedido.unidad);

    /*
     * Sin unidad en la factura no se le atribuye la del crédito.
     *
     * La pantalla ofrece «Quantity» y «Unit» por separado, así que una factura cargada con «53.960»
     * y la unidad vacía es corriente — y ponerle «MTS» a un número que está en kilos da +94567 %.
     * Es la misma clase de error de mil veces que este repo ya pagó con «53,960».
     */
    if (!uniFac) {
      out.push(
        regla(
          "ucp-30b-cantidad",
          "UCP 600 30b",
          "Cantidad de la factura dentro de lo que pide el crédito",
          "ATENCION",
          `la factura dice ${cantFac} y no se leyó en qué unidad: sin eso no se puede comparar contra ${pedido.valor} ${pedido.unidad}`,
        ),
      );
      return out;
    }

    /*
     * La tolerancia: «about» manda sobre todo lo demás (30 a), y el 5 % del 30 (b) no corre sobre
     * bultos ni unidades — pero **sí** sobre el volumen, que el artículo nombra junto al peso.
     */
    const porAbout = /\b(about|approximately|circa|aproximadamente|aprox)\b/i.test(ctx.mercaderia ?? "");
    const enUnidades = enKgPedido === null && !esVolumen(pedido.unidad);
    const tol = porAbout ? 0.1 : toleranciaDeCantidad(lc, enUnidades);
    const enKgFac = n === null ? null : aKg(n, uniFac);
    /** los dos en kilos, o los dos en la misma unidad que no es de peso. */
    const par =
      enKgPedido !== null && enKgFac !== null
        ? { a: enKgFac, b: enKgPedido }
        : n !== null && unidadNormal(uniFac) === unidadNormal(pedido.unidad)
          ? { a: n, b: pedido.valor }
          : null;
    if (par) {
      const desvio = (par.a - par.b) / par.b;
      const dentro = Math.abs(desvio) <= tol + 1e-9;
      out.push(
        regla(
          "ucp-30b-cantidad",
          porAbout ? "UCP 600 30a" : lc.tolerancia != null ? "39A" : "UCP 600 30b",
          `Cantidad de la factura dentro de lo que pide el crédito (${pedido.valor} ${pedido.unidad} ±${Math.round(tol * 100)} %)`,
          dentro ? "OK" : "DISCREPANCIA",
          `factura ${cantFac} ${uniFac ?? ""} · el crédito pide ${pedido.valor} ${pedido.unidad}`.trim() +
            (dentro ? "" : ` — ${desvio > 0 ? "+" : ""}${Math.round(desvio * 100)} %`),
        ),
      );
    } else {
      out.push(
        regla(
          "ucp-30b-cantidad",
          "UCP 600 30b",
          "Cantidad de la factura dentro de lo que pide el crédito",
          "ATENCION",
          `la factura dice ${cantFac} ${uniFac ?? ""} y el crédito ${pedido.valor} ${pedido.unidad}: magnitudes que no se pueden comparar, verificar a mano`.trim(),
        ),
      );
    }
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

  /*
   * El documento de transporte se examina con el artículo que le corresponde.
   *
   * Las UCP dedican siete artículos al transporte —19 a 25— y cada uno pide cosas distintas. Antes
   * acá se aplicaba siempre el 20, el marítimo, que era el único implementado: a un air waybill se
   * le pedía la anotación de a bordo, que no tiene nunca. Ahora se determina primero de qué clase
   * es el documento y se deja dicho, porque de eso depende todo lo que sigue; si no se pudo
   * determinar, no se aplica ninguno a ciegas.
   */
  const bl = doc("BL");
  if (bl) {
    const exigidos = input.lc.documentosExigidos ?? [];
    const clase = modoDelDocumento(bl.campos);
    out.push(
      regla(
        "ucp-transporte-clase",
        articuloDelModo(clase.modo),
        "Clase del documento de transporte",
        clase.modo === "SIN_DETERMINAR" ? "ATENCION" : "OK",
        clase.modo === "SIN_DETERMINAR"
          ? `${clase.porQue}. Se examinó con el artículo 20, el del conocimiento marítimo: si el documento es aéreo, terrestre o multimodal, este examen no corresponde.`
          : `${NOMBRE_MODO[clase.modo]}: ${clase.porQue}`,
      ),
    );
    /*
     * 22 (b): el banco no examina los contratos de fletamento, aunque el crédito exija presentarlos.
     *
     * Se dice cuando el crédito los pide, porque ahorra el trabajo de revisar cien páginas que no
     * cambian el resultado y evita que alguien invoque una discrepancia sobre algo que, por el
     * artículo, no se examina. Presentarlo sigue siendo obligatorio: lo que no se revisa es su
     * contenido.
     */
    if (exigidos.some((d) => /charter\s*part/i.test(d) && /contract|contrato/i.test(d))) {
      out.push(
        regla(
          "ucp-22b",
          "UCP 600 22b",
          "El contrato de fletamento se presenta pero no se examina",
          "OK",
          "el crédito exige presentarlo; el artículo 22 (b) dice que el banco no examina contratos de fletamento",
        ),
      );
    }

    /*
     * Los artículos 21 y 22 comparten con el 20 la anotación de a bordo, los puertos y el buque: un
     * sea waybill y un conocimiento de fletamento se examinan con las mismas comprobaciones.
     *
     * Y cuando no se pudo determinar la clase, también se examina con el 20 — pero dicho. No
     * examinar sería peor: el documento marítimo es el caso mayoritario y el examinador ya lo
     * cargó como conocimiento de embarque, de modo que callarse dejaría sin revisar un documento
     * que casi siempre sí corresponde. Lo que se arriesga está acotado: las comprobaciones del 20
     * que un aéreo no pasa dan ATENCION —«verificar a mano»— y no discrepancia.
     */
    if (clase.modo === "MARITIMO" || clase.modo === "SEA_WAYBILL" || clase.modo === "FLETAMENTO") {
      out.push(...reglasTransporte(ctx, bl, exigidos));
    } else if (clase.modo === "AEREO") {
      out.push(...reglasAereo(ctx, bl));
    } else if (clase.modo === "MULTIMODAL") {
      out.push(...reglasMultimodal(ctx, bl));
    } else if (clase.modo === "TERRESTRE") {
      out.push(...reglasTerrestre(ctx, bl));
    } else if (clase.modo === "COURIER") {
      out.push(...reglasCourier(bl));
    } else if (clase.modo === "SIN_DETERMINAR") {
      out.push(...reglasTransporte(ctx, bl, exigidos));
    }
  }

  if (input.seguro) out.push(...reglasSeguro(input.lc, ctx, input.seguro, fac, doc("BL")));

  out.push(...reglasAplicacion(input.lc, ctx));
  out.push(...reglasQueDocumentoEs(input.docs));
  out.push(...reglasQuienEmite(ctx, input.docs));
  out.push(...reglasGenerales(input.lc, ctx, input.docs, input.hoy));
  return out;
}
