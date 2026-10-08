import { type CamposDoc, claveDoc, compararEntreDocumentos, parseNumero, type TipoDocExterno } from "./consistencia";
import { diffDias, parseFecha } from "./fechas";
import { limitePresentacion, toleranciaDeImporte } from "./lc";
import type { DocumentRow, LcInfo, OperationDetail } from "./types";

/**
 * Dónde puede estar escrito que los documentos citen el número del crédito.
 *
 * Vive a nivel de módulo y se exporta porque la misma pregunta se hace en dos lugares —los cuatro
 * documentos de la matriz y los demás papeles del 46A— y dos copias del mismo regex se separan: una
 * se corrige y la otra no, y el motor empieza a contestar distinto según por dónde entró el papel.
 */
export const PIDE_CITAR_NUMERO_LC =
  /INDICAT\w*.{0,40}(LETTER OF CREDIT|L\/?C)\s*(NUMBER|NO)|LC NUMBER|NUMBER OF LETTER OF CREDIT/;

/** El campo donde el crédito lo pide, para que la fuente del hallazgo mande al lugar correcto. */
export function dondeSePideElNumeroLC(lc: LcInfo): "47A" | "46A" | null {
  const cond = (lc.condicionesAdicionales ?? []).join(" ").toUpperCase();
  if (PIDE_CITAR_NUMERO_LC.test(cond)) return "47A";
  const exigidos = (lc.documentosExigidos ?? []).join(" ").toUpperCase();
  return PIDE_CITAR_NUMERO_LC.test(exigidos) ? "46A" : null;
}

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

/**
 * Qué tipo con extracción propia cubre una exigencia del 46A, si alguno.
 *
 * La pantalla lo necesita para saber **qué líneas del crédito no tienen casilla**: las que
 * devuelven `undefined` son los certificados y el seguro, que se cargan aparte y se pasan en
 * `otros`. Vive acá y no en la pantalla a propósito: una lista escrita a mano del otro lado se
 * desincroniza del día que este mapa crezca, que es exactamente cómo `normalizarCamposDoc` llegó a
 * tirar los campos del seguro sin que nadie se enterara.
 */
export function tipoDeExigencia(texto: string): TipoDocExterno | undefined {
  return TIPO_DE_CLAVE[claveDoc(texto)];
}
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
  /**
   * Además, no quedó nada sin mirar. `listo && !verificado` = «listo en lo que vi».
   *
   * No son lo mismo y confundirlos cuesta plata: el 46A del caso de referencia exige diez documentos y el
   * producto sabe analizar tres. Anunciar «conforme» sobre siete certificados tildados a mano manda
   * a alguien al banco confiado, y el rechazo —con su cargo por juego— aparece allá. `listo` dice
   * «nada de lo que miré está mal»; `verificado` dice «además, lo miré todo». Quien muestre esto
   * tiene que decir las dos cosas.
   */
  verificado: boolean;
  /** cuántas reglas quedaron en ATENCION, que es lo que falta mirar a mano */
  sinVerificar: number;
  feePorJuego: number | null;
  /** días que quedan para presentar (negativo = vencido), si se puede calcular */
  diasParaPresentar: number | null;
}

export function precheckPresentacion(input: {
  lc: LcInfo;
  docs: DocAnalizado[];
  /**
   * Los demás documentos del 46A que vinieron presentados: origen, análisis, peso, fumigación,
   * certificados del beneficiario, el seguro.
   *
   * Hace falta porque la regla del 46A de acá abajo solo reconoce los cuatro tipos que tienen
   * extracción propia (`TIPO_DE_CLAVE`), y en romai los otros se satisfacen por la rama de los
   * documentos **generados**. En cotejo no se genera nada: los papeles los presenta el
   * beneficiario, así que sin esto un certificado de análisis presentado dejaba su línea del
   * crédito en FALTA y `listo` no podía ser `true` en ningún crédito real.
   */
  otros?: { exigencia: string; nombreArchivo?: string }[];
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
  /** Si una exigencia del 46A llegó presentada como certificado o seguro. */
  const usados = new Set<number>();
  const presentado = (texto: string): { nombreArchivo?: string } | undefined => {
    const lista = input.otros ?? [];
    const k = claveDoc(texto);
    // por el texto exacto primero —el examinador eligió contra qué línea carga cada papel— y
    // recién después por la clave, para el que se apareó solo
    const i = lista.findIndex((o, idx) => !usados.has(idx) && o.exigencia.trim() === texto.trim());
    const j = i >= 0 ? i : lista.findIndex((o, idx) => !usados.has(idx) && claveDoc(o.exigencia) === k);
    if (j < 0) return undefined;
    usados.add(j);
    return lista[j];
  };
  const corto = (t: string) => (t.length > 40 ? `${t.slice(0, 37)}…` : t);
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
    // una sola llamada: el helper marca la entrada como usada, así que dos papeles no pueden
    // satisfacer la misma línea ni una línea consumir dos papeles
    const pres = analizado ? undefined : presentado(texto);
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
    } else if (pres) {
      /*
       * Un documento del 46A que no es de los cuatro tipos con extracción propia, pero que está
       * en el paquete. Lo que se afirma es que **está**, no que sus ejemplares estén contados:
       * igual que en la rama de arriba, el conteo del juego lo mira una persona.
       */
      reglas.push({
        id,
        fuente: id,
        regla: resumen,
        estado: "OK",
        evidencia: `Presentado (${pres.nombreArchivo ?? corto(texto)}) · ${ej.texto}`,
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
  /*
   * Que el documento cite el número del crédito: quién lo pide cambia el veredicto y la fuente.
   *
   * La regla se activaba con `|| exigidos.length > 0` —cualquier crédito con documentos exigidos— y
   * sin embargo la fuente decía «47A». Con eso el motor le atribuía al crédito una condición que el
   * crédito no escribió, y la falta del número salía como DISCREPANCIA apoyada en ella. Es
   * exactamente lo que este repo no se permite: cada hallazgo tiene que poder ir a buscarse al
   * texto que lo sostiene.
   *
   * Cuando el crédito lo pide, es el 47A y su falta es discrepancia. Cuando no, es práctica
   * bancaria —ayuda a vincular los papeles de un expediente— y su falta no es discrepancia: la
   * propia ISBP 2023 dejó de considerarla una.
   */
  /* También el 46A: este crédito lo pide dentro del documento exigido —«COMMERCIAL INVOICE …
     INDICATING CONTRACT NUMBER AMS2026164, NUMBER OF LETTER OF CREDIT»— y mirar solo el 47A lo
     daba por no pedido. Donde el crédito lo escriba, lo escribió. */
  /* Y se guarda DÓNDE lo pide: la fuente de un hallazgo tiene que poder ir a buscarse al campo
     que lo sostiene, y «47A» sobre algo escrito en el 46A es mandar al banco al lugar
     equivocado. */
  const pedidoEn = dondeSePideElNumeroLC(lc);
  const loPideElCredito = pedidoEn !== null;
  const exigeNumeroLC = loPideElCredito || exigidos.length > 0;
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
        /*
         * Omitirlo y citar OTRO no son la misma falta, y por eso no comparten fuente.
         *
         * Que falte es discrepancia solo si el crédito pidió citarlo (47A o 46A); si no lo pidió,
         * la ISBP 2023 dejó de considerarlo una. Pero un documento que dice pertenecer a un
         * crédito distinto no omitió nada: entra en conflicto con el crédito, y eso es el
         * artículo 14 (d) sin importar quién pidió qué. Un dígito cambiado al tipear ya costó un
         * paquete devuelto.
         */
        fuente: n && !cita ? "UCP 600 14d" : (pedidoEn ?? "Práctica bancaria"),
        regla: `${nombre}: cita el número de la LC`,
        estado: !n ? "ATENCION" : cita ? "OK" : "DISCREPANCIA",
        evidencia: !n
          ? "no se leyó un número de LC en el documento: verificar a mano"
          : cita
            ? `dice "${n}"`
            : `dice "${n}" y el crédito es "${lc.numero}": el documento pertenece a otro expediente o está mal tipeado`,
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
      /*
       * Sin saber quién es el ordenante no se puede decir que el notify esté mal.
       *
       * Faltaba la mitad del control: si el campo 50 del crédito no se pudo leer, `cliente` queda
       * vacío y el resultado era DISCREPANCIA — con la evidencia terminando en «· ordenante » y
       * nada después. El conocimiento del expediente de referencia dice «NOTIFY ORIENT FEED (PVT) LTD», que
       * es exactamente el ordenante, y salía discrepante por un dato que falta de este lado.
       */
      const ok = nt && cliente ? norm(nt).includes(norm(cliente).split(" ")[0]) : false;
      reglas.push({
        id: "bl-notify",
        fuente: "46A",
        regla: "BL notify: el ordenante (applicant)",
        estado: !nt || !cliente ? "ATENCION" : ok ? "OK" : "DISCREPANCIA",
        evidencia: !nt
          ? "no se leyó el notify"
          : !cliente
            ? `dice "${nt}" y no se leyó el ordenante del crédito: verificar a mano`
            : `dice "${nt}" · ordenante ${cliente}`,
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
      // Tolerancia de IMPORTE: el 5 % del artículo 30 (b) es de cantidad, no de monto.
      const tol = toleranciaDeImporte(lc);
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
     caso de referencia la proforma llevaba Colón 1498 y la LC Cerrito 820) */
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
    /*
     * El artículo 14 (j) dice lo contrario de lo que este aviso sugería.
     *
     * «Cuando las direcciones del beneficiario y del ordenante aparecen en cualquier documento
     * exigido, NO necesitan ser las mismas que las del crédito… pero deben estar dentro del mismo
     * país.» El aviso terminaba en «usar la de la LC en factura y certificados», que suena a
     * exigencia y no lo es: usarla evita preguntas y sigue siendo un buen consejo, pero presentarla
     * distinta no es discrepancia y la herramienta no puede dar a entender que sí.
     *
     * Lo único que el artículo sí exige —el mismo país— no se puede comprobar acá: el extractor
     * pide la razón social sin dirección, así que del documento no viene el país. Se nombra para
     * que quien revisa lo mire.
     */
    reglas.push({
      id: "beneficiario-direccion",
      fuente: "UCP 600 14j",
      regla: "Dirección del beneficiario en los documentos propios",
      estado: ok ? "OK" : "ATENCION",
      evidencia: ok
        ? `LC: "${lc.beneficiarioDireccion}" · Ajustes: "${input.empresaDireccion}"`
        : `LC: "${lc.beneficiarioDireccion}" · Ajustes: "${input.empresaDireccion}" — no necesitan ser las mismas (art. 14 j); lo único exigido es que estén en el mismo país, y usar la de la LC evita preguntas`,
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
    verificado: faltan === 0 && discrepancias === 0 && atencion === 0 && exigidos.length > 0,
    sinVerificar: atencion,
    feePorJuego: feeDiscrepancia(lc.condicionesAdicionales),
    diasParaPresentar,
  };
}
