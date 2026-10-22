import type { CamposDoc, TipoDocExterno } from "./consistencia";
import {
  aKg,
  cantidadDelCredito,
  cantidadesDelCredito,
  claveDoc,
  coincideLugar,
  parseNumero,
  unidadNormal,
} from "./consistencia";
import { parseFecha } from "./fechas";
import {
  cotejarIncotermISBP,
  creditoExigeIngles,
  esFacturaComercial,
  NOTA_NOMBRE_ILEGIBLE,
  NOTA_NOMBRE_ILEGIBLE_CON_INGLES,
  NOTA_TIPEO_DE_NOMBRE,
  normISBP,
  terminoDeEntrega,
  veredictoDeNombre,
  versionIncoterm,
} from "./isbp";
import { toleranciaDeCantidad } from "./lc";
import { mismaMoneda } from "./numeros";
import type { DocAnalizado, EstadoRegla, ReglaPresentacion } from "./presentacion";
import { esStandby, noAplicaAStandby } from "./standby";
import {
  articuloDelModo,
  buqueDeLaAnotacion,
  capacidadesAdmitidas,
  fuenteDelInciso,
  leerFirma,
  type ModoTransporte,
  modoDelDocumento,
  NOMBRE_CAPACIDAD,
  NOMBRE_MODO,
} from "./transporte";
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
  /**
   * 45A ENTERO, sin recortar.
   *
   * `mercaderia` viene cortada en el primer incoterm porque sirve para comparar descripciones
   * contra los documentos, y ahí el «CFR XINGANG INCOTERMS 2020» sobra. Pero un crédito puede
   * poner el incoterm en el punto 3 y la CANTIDAD en el 4 —«3.UNIT PRICE: USD780/MT CFR
   * XINGANG,CHINA 4.QUANTITY: 500MTS (+/-5%)»—, y con el recorte la cantidad se perdía: la regla
   * del art. 30 no corría y un embarque corto o excedido pasaba en silencio. Las reglas que
   * necesitan datos del 45A que no son la descripción leen de acá.
   */
  mercaderiaCompleta?: string | null;
  /**
   * 53A: el banco reembolsador, cuando el crédito manda el reembolso por un tercero.
   *
   * Entra acá y no en `LcInfo` porque es lo que el crédito **dice**, no lo que el examen concluye.
   * Y hace falta para screenearlo: Wolfsberg enumera entre las partes a revisar a todos los bancos
   * de la cadena, y este es uno que el producto ya parseaba —lo usa el armador del MT740— y no
   * screeneaba.
   */
  bancoReembolsador?: string | null;
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
  /** 40A: la forma del crédito. De acá sale que es un standby, que no se examina igual. */
  formaCredito?: string | null;
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
 *
 * **`ANY` con palabras en el medio, y el aeropuerto, faltaban.** `\bANY\s+PORT\b` exige que las dos
 * palabras estén pegadas, así que «ANY NORTH EUROPEAN PORT» y «ANY EUROPE AIRPORT» no se
 * reconocían como zona y el documento salía DISCREPANCIA: el motor afirmaba que Amberes no está en
 * el norte de Europa y que Amsterdam no es un aeropuerto europeo, cuando lo que pasa es que no
 * tiene geografía. Las dos redacciones son las de sendas Opiniones de la ICC, y en las dos la
 * discrepancia **no era válida**:
 *
 * - TA 796rev, con «Any North European Port» y un embarque en Amberes, donde el banco emisor
 *   defendió su rechazo citando un sitio web que clasifica a Bélgica como Europa occidental:
 *   *«it is not for them to define or determine geographical areas or ranges […] the LC
 *   requirement clearly is vague and clearly is ambiguous – and such do in fact fall back on the
 *   applicant. For that reason the document is not discrepant»*.
 * - TA 937, con «Any Europe Airport» / «Any Panama Airport» y un air waybill que nombraba las
 *   ciudades: *«as long as a credit did not require a specific port/airport to be named, then the
 *   port/airport fields […] reflecting a city in a stated geographical area are sufficient for
 *   examination purposes»*.
 *
 * El veredicto queda en ATENCION y no en OK a propósito. La ICC concluye que el documento no es
 * discrepante; el motor no puede concluir eso, porque para distinguir «Amsterdam está en Europa»
 * de «Amsterdam está en Panamá» hace falta una geografía que este motor no tiene y que no conviene
 * que tenga —es la misma razón por la que «ANY BANK IN URUGUAY» sale a verificar en vez de
 * resolverse—. Lo que sí puede hacer es no afirmar una discrepancia que no sostiene.
 *
 * `ANY` es lo que marca la zona, no el aeropuerto: «MONTEVIDEO AIRPORT» es un aeropuerto concreto y
 * tiene que seguir comparándose como tal.
 */
function esZonaDeLugares(texto: string): boolean {
  const t = texto.toUpperCase();
  return (
    /\bRANGE\b|\bMAIN\s+(?:AIR)?PORTS?\b|\b(?:AIR)?PORTS\b|\bAREA\b|\bCOAST\b|\bSEABOARD\b|CUALQUIER PUERTO|PUERTOS\b/.test(
      t,
    ) ||
    /\bANY\s+(?:[A-Z]+\s+){0,3}(?:SEA)?(?:AIR)?PORTS?\b/.test(t) ||
    /[A-Z]{3,}\s*\/\s*[A-Z]{3,}/.test(t)
  );
}

/**
 * Los calificativos que cambian **de qué mercadería** se habla (Opinión TA 756).
 *
 * No son adjetivos cualesquiera: son las palabras con que el comercio clasifica una mercadería en otra
 * categoría. Un crédito que no las dice no pidió eso.
 */
const CAMBIAN_LA_CATEGORIA: [RegExp, string][] = [
  [/\bsecond\s*hand\b/i, "second hand"],
  [/\bused\b/i, "used"],
  [/\bre(?:conditioned|furbished|manufactured|built)\b/i, "reconditioned"],
  [/\bdamaged\b/i, "damaged"],
  [/\bdefective\b/i, "defective"],
  [/\boff[\s-]?grade\b/i, "off-grade"],
  [/\brejects?\b/i, "reject"],
  [/\bsub[\s-]?standard\b/i, "substandard"],
  [/\busad[oa]s?\b/i, "usado"],
  [/\bsegunda\s+mano\b/i, "segunda mano"],
  [/\breacondicionad[oa]s?\b/i, "reacondicionado"],
];

/**
 * El calificativo que el documento declara y el crédito **no menciona en absoluto**, si hay alguno.
 *
 * Mira el 45A entero y también las condiciones adicionales: un crédito que admite mercadería usada lo
 * dice en alguno de los dos.
 *
 * **Y basta con que el crédito nombre cualquiera de los calificativos para que no se marque nada**, no
 * el mismo. Lo encontró el test: un crédito que pide «USED HYDRAULIC DRILLING RIG» y una factura que
 * dice «SECOND HAND HYDRAULIC DRILLING RIG» hablan de la misma categoría, y marcarlo sería el falso
 * positivo que este freno existe para evitar. Es también lo que dice el análisis de la Opinión: lo que
 * la hace discrepante es que la categoría «is not apparent in the goods description in the credit». Si
 * el crédito habla de la condición de la mercadería, el pareo de las dos palabras lo lee una persona.
 */
function categoriaQueElCreditoNoPidio(
  enDocumento: string,
  ctx: ContextoCredito,
  lc: LcInfo | null | undefined,
): string | null {
  const delCredito = [ctx.mercaderiaCompleta ?? ctx.mercaderia ?? "", ...(lc?.condicionesAdicionales ?? [])].join(" ");
  if (CAMBIAN_LA_CATEGORIA.some(([re]) => re.test(delCredito))) return null;
  return CAMBIAN_LA_CATEGORIA.find(([re]) => re.test(enDocumento))?.[1] ?? null;
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

/** Las palabras que identifican una mercadería: ni números, ni unidades, ni palabras de especificación. */
const RELLENO_DESCRIPCION = new Set([
  "about",
  "approx",
  "approximately",
  "circa",
  "each",
  "from",
  "maximum",
  "minimum",
  "with",
  "without",
]);

function propias(t: string): string[] {
  return norm(t)
    .split(" ")
    .filter((w) => w.length > 3 && !/^\d/.test(w) && !RELLENO_DESCRIPCION.has(w));
}

/**
 * Una palabra del nombre del producto **cambiada por otra**: eso es conflicto y no una adición.
 *
 * Sale de *Bulgrains & Co Ltd v Shinhan Bank* [2013] EWHC 2498 (QB). El 45A pedía «Wheat bran pellets
 * in bulk» con nueve especificaciones y la factura decía «Bulgarian wheat grain pellets»: el tribunal
 * lo dio por discrepante sin discusión —*«the commercial invoice is in markedly different terms»*, «no
 * dispute about this discrepancy»— y el motor lo pasaba en OK porque compartían dos palabras, «wheat»
 * y «pellets». *Bran* se había vuelto *grain*: es otro producto.
 *
 * **Lo que esto distingue es agregar de sustituir**, que es la línea que la práctica traza:
 *
 * - la factura **agrega** datos que el crédito no trae —el origen, el embalaje, un número de
 *   contrato— y eso no contradice nada: «BULGARIAN WHEAT BRAN PELLETS IN BULK» sigue cumpliendo;
 * - la factura **omite** parte de la descripción del crédito y tampoco: «WHEAT BRAN PELLETS» contra un
 *   45A con nueve especificaciones es la factura corriente, y exigir el espejo sería rechazar de más;
 * - pero si falta una palabra del nombre del producto **y** aparece otra que el crédito no tiene en
 *   ninguna parte, lo que hubo es un reemplazo. Eso no se puede dar por bueno.
 *
 * El nombre del producto es lo que está antes de la primera coma o del primer guion: ahí es donde un
 * 45A escribe qué es la mercadería, y lo que sigue son las especificaciones.
 *
 * **Y nunca rechaza:** `ucp-18c` solo tiene OK y ATENCION, porque si la descripción «se corresponde»
 * es un juicio que la ISBP deja al examinador. Lo que esto cambia es de qué lado cae la duda.
 */
function reemplazaUnaPalabraDelProducto(enDocumento: string, enCredito: string): boolean {
  const nombre = enCredito.split(/[,;]|\s-\s/)[0] ?? "";
  const delNombre = propias(nombre);
  if (delNombre.length === 0) return false;
  const enDoc = new Set(propias(enDocumento));
  const falta = delNombre.some((w) => !enDoc.has(w));
  if (!falta) return false;
  const todoElCredito = new Set(propias(enCredito));
  return [...enDoc].some((w) => !todoElCredito.has(w));
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
  const unaSolaDescripcion = (): boolean =>
    seParecen(enDocumento, enCredito) && !reemplazaUnaPalabraDelProducto(enDocumento, enCredito);
  if (items.length <= 1) return unaSolaDescripcion();

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
  /*
   * Y si **ninguna** palabra se repite en dos tercios de los renglones, esto no es una enumeración:
   * es una descripción sola con sus especificaciones separadas por comas.
   *
   * La diferencia la mostró *Bulgrains v Shinhan Bank*: el 45A decía «Wheat bran pellets in bulk –
   * moisture max 13.5%, protein min 12.0%, hash max 7.0%, …» y el motor lo partía en siete
   * mercaderías distintas. Con renglones que no comparten nada, `comunes` queda vacío, `sinLoComun`
   * no descuenta nada y el criterio degenera en «parecerse a cualquiera de los fragmentos» — que es
   * más flojo que compararse contra la descripción entera, justo al revés de para lo que se escribió.
   *
   * El síntoma es el que ya calcula la función, así que no hace falta adivinar si una coma separa
   * cortes de carne o porcentajes de proteína: una lista de mercaderías del mismo rubro comparte el
   * encabezado del rubro, y una lista de especificaciones no comparte nada.
   */
  if (comunes.length === 0) return unaSolaDescripcion();
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

  /*
   * ISBP 821 C8: la versión del término de entrega, que estaba escrita y no se ejecutaba.
   *
   * `cotejarIncotermISBP` vivía en `isbp.ts` exportada desde `index.ts`, con sus cuatro tests en
   * verde, y **ninguna regla la llamaba**: el párrafo C8 no se examinaba nunca. Es el defecto que
   * este repositorio persigue —lo escrito y no ejecutado— y se encontró buscando contra qué regla
   * apareaba la Opinión TA 936rev, igual que la firma del documento de transporte.
   *
   * Dos decisiones para no convertir un hueco en ruido:
   *
   * - **Corre solo si el crédito nombra la versión.** Cuando el 45A dice «CFR XINGANG,CHINA» a secas
   *   —como el crédito del expediente real— no hay nada que cotejar: la factura puede agregar la
   *   versión y eso está admitido. Emitir un OK en todos esos créditos sería una regla más en el
   *   tablero que no dictamina nada, y es el mismo criterio por el que las reglas del artículo 13
   *   corren solo si hay 53A.
   * - **Se mira el 45A entero** (`mercaderiaCompleta`) y no `mercaderia`, que viene recortada justo
   *   en el primer incoterm: con el recorte, el crédito nunca nombraría una versión y la regla sería
   *   inalcanzable por construcción. Es la misma trampa que la excepción del artículo 28 (e)
   *   buscándose dentro de `coberturaDesde`.
   *
   * Y lo que **no** hace, que es lo que la Opinión TA 936rev vino a fijar: no compara el término en
   * sí. «C&F» contra «CFR» no es discrepancia, y acá no se mira el término sino el año de la versión.
   */
  const inco45a = ctx.mercaderiaCompleta ?? ctx.mercaderia ?? "";
  const versionDelCredito = versionIncoterm(inco45a);
  if (versionDelCredito) {
    const enFactura = [val(fac, "incoterm"), val(fac, "mercaderia")].filter(Boolean).join(" ");
    const versionDeLaFactura = versionIncoterm(enFactura);
    /* Y si la factura trae **el término**, que es lo que la TA 873rev decide y no es lo mismo. */
    const terminoDeLaFactura = terminoDeEntrega(enFactura);
    const { evidencia } = cotejarIncotermISBP(inco45a, enFactura);
    out.push(
      !enFactura
        ? sinLeer(
            "isbp-c8",
            "ISBP 821 C8",
            "La factura indica la misma versión del término de entrega que el crédito",
            "el término de entrega de la factura",
          )
        : regla(
            "isbp-c8",
            "ISBP 821 C8",
            "La factura indica la misma versión del término de entrega que el crédito",
            /*
             * Dos versiones distintas es una contradicción entre papeles y no necesita ningún párrafo
             * de la ISBP para sostenerse: la decide el artículo 14 (d). **La omisión también es
             * discrepancia, y eso dejó de ser una duda.**
             *
             * Salía a verificar porque el veredicto dependía de cómo estuviera redactado C8 exactamente
             * y la publicación no está comprada. La Opinión **TA 873rev** lo transcribe adentro, que es
             * la única forma de citarlo sin comprar nada:
             *
             *   «ISBP 745 paragraph C8 states that when a trade term is stated as part of the goods
             *   description in the credit, an invoice is to indicate that trade term, and when the
             *   source of the trade term is stated, the same source is to be indicated.»
             *
             * Y resuelve el caso con eso: el 45A decía «DAP [Place B] Incoterms 2010», la factura no
             * traía el término, y *«Accordingly, this constitutes a discrepancy»* — «Yes, both
             * discrepancies were valid».
             *
             * Es el segundo veredicto que este motor pudo cerrar porque una Opinión transcribió el
             * párrafo que le faltaba, y vale anotar el patrón: lo que no se puede comprar a veces se
             * puede citar de donde la ICC lo copió.
             *
             * **Y sigue sin rechazar, por el mismo límite que declaró la Opinión TA 862:** un término
             * que no aparece puede ser un papel que no lo dice —la discrepancia que la TA 873rev declara
             * válida— o un campo que nadie cargó. El propio expediente real lo demuestra: su factura
             * **sí** trae «CFR COLOMBO, SRI LANKA» en el papel, y el paquete de prueba que reproduce ese
             * examen no carga el campo. Las dos situaciones llegan acá idénticas.
             *
             * Lo que cambió es la **frase**: ahora dice que la omisión del término es discrepancia y de
             * dónde sale, así que el examinador no tiene que saberse el párrafo. Es el tercer caso que
             * apunta al mismo hueco del esquema —hace falta un estado «ausente en el papel»— y los tres
             * están anotados.
             *
             * Y la Opinión decide la omisión **del término**, no la de la fuente: en el expediente real
             * el término está y la fuente no, y el banco lo tomó sin levantar nada. Los hechos de la
             * TA 873rev son otros —*«The presented invoice did not include this trade term»*— así que las
             * dos omisiones se nombran distinto aunque las dos avisen.
             */
            versionDeLaFactura ? (versionDeLaFactura === versionDelCredito ? "OK" : "DISCREPANCIA") : "ATENCION",
            !terminoDeLaFactura
              ? `el crédito pone el término de entrega en la descripción de la mercadería ("Incoterms ${versionDelCredito}") y la factura dice "${enFactura.slice(0, 60)}" sin ningún término: si el papel de verdad no lo indica es discrepancia, porque la factura tiene que repetirlo (párrafo C8 de la ISBP, transcripto en la Opinión TA 873rev). Verificar en el papel`
              : versionDeLaFactura
                ? evidencia
                : `el crédito dice Incoterms ${versionDelCredito} y la factura dice "${enFactura.slice(0, 60)}" sin indicar la versión: verificar si el crédito la exige repetida`,
          ),
    );
  }

  /*
   * El término de entrega del crédito contra el de la factura (Opinión TA 765rev).
   *
   * `isbp-c8` mira la **versión** —«Incoterms 2020»— que es el párrafo C8 de la ISBP. Esto mira **el
   * término**, que es el artículo 18 (c): la ICC lo dice así en la TA 765rev, donde el 45A decía «FOB
   * Singapore» y la factura «FCA Singapore Changi Airport» y el crédito no nombraba ninguna versión, de
   * modo que la otra regla ni corría.
   *
   *   «the trade term "FOB Singapore" was part of the description appearing in the credit» — CONCLUSION:
   *   The second discrepancy is valid.
   *
   * **Solo compara cuando los dos lo nombran.** Si la factura no trae término, lo que falta es un dato y
   * eso lo mira `isbp-c8` o una persona; y la regla no opina sobre si el término es el **apropiado** para
   * el medio de transporte —el beneficiario de esa Opinión argumentaba que FOB no sirve para un embarque
   * aéreo— porque eso es investigar más allá de la cara del documento, que es lo que el artículo 14 (a)
   * prohíbe.
   */
  const delCreditoIncoterm = terminoDeEntrega(ctx.mercaderiaCompleta ?? ctx.mercaderia);
  const deLaFactura = terminoDeEntrega([val(fac, "incoterm"), val(fac, "mercaderia")].filter(Boolean).join(" "));
  if (delCreditoIncoterm && deLaFactura) {
    out.push(
      regla(
        "ucp-18c-incoterm",
        "UCP 600 18c",
        "El término de entrega de la factura es el del crédito",
        delCreditoIncoterm === deLaFactura ? "OK" : "DISCREPANCIA",
        delCreditoIncoterm === deLaFactura
          ? `los dos dicen ${delCreditoIncoterm}`
          : `el crédito dice ${delCreditoIncoterm} y la factura ${deLaFactura}: el término de entrega es parte de la descripción de la mercadería, así que uno distinto es discrepancia del 18 (c) — Opinión TA 765rev`,
      ),
    );
  }

  // 18c: la descripción de la mercadería debe CORRESPONDER con la del crédito (exigencia fuerte)
  const merc = val(fac, "mercaderia");
  if (ctx.mercaderia && merc) {
    /*
     * Y el límite que la Opinión TA 756 le pone a «agregar no es contradecir».
     *
     * El caso *Bulgrains v Shinhan Bank* dejó escrito que la factura puede traer datos que el crédito
     * no menciona —el origen, el embalaje, un número de contrato— y que exigir el espejo sería rechazar
     * de más. Sigue siendo cierto. La **TA 756** le pone el borde: el 45A pedía «HYDRAULIC DRILLING RIG
     * ABI 12/14300» y la factura decía «SECOND HAND HYDRAULIC DRILLING RIG ABI 12/14300».
     *
     *   «The words "second hand" indicate a different category or classification of the goods, which is
     *   not apparent in the goods description in the credit. The addition of the words "second hand" is
     *   grounds for refusal on the basis that the goods description in the invoice does not correspond
     *   with that in the credit.» — CONCLUSION: The discrepancy is valid.
     *
     * La lista es corta y cerrada porque lo que la sostiene no es una interpretación: son los
     * calificativos con que el comercio **clasifica** una mercadería. El origen no entra y no va a
     * entrar — «BULGARIAN WHEAT BRAN PELLETS» no cambia de qué mercadería se habla.
     *
     * **Y rechaza solo si la palabra no está en ninguna parte del crédito**, ni en el 45A ni en las
     * condiciones adicionales. Un crédito que pide maquinaria usada y una factura que la llama usada se
     * corresponden; lo que la Opinión castiga es que el papel declare una categoría que el crédito no
     * nombró. Sin ese freno el motor rechazaría justamente el caso bueno.
     */
    const cambiaLaCategoria = categoriaQueElCreditoNoPidio(merc, ctx, lc);
    out.push(
      regla(
        "ucp-18c",
        "UCP 600 18c",
        "La descripción de la mercadería en la factura se corresponde con la del crédito",
        cambiaLaCategoria ? "DISCREPANCIA" : coincideDescripcion(merc, ctx.mercaderia) ? "OK" : "ATENCION",
        cambiaLaCategoria
          ? `la factura llama a la mercadería "${cambiaLaCategoria}" y el crédito no lo dice en ninguna parte: eso indica otra categoría de mercadería y la Opinión TA 756 lo da por discrepancia · factura: "${merc.slice(0, 60)}" · crédito 45A: "${ctx.mercaderia.slice(0, 60)}"`
          : `factura: "${merc.slice(0, 70)}" · crédito 45A: "${ctx.mercaderia.slice(0, 70)}"`,
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
function reglasQuienEmite(lc: LcInfo, ctx: ContextoCredito, docs: DocAnalizado[]): ReglaPresentacion[] {
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
      /*
       * Y se compara como un **nombre**, no como un lugar.
       *
       * Esta regla usaba `coincideLugar`, que da por coincidentes dos textos que comparten **una** sola
       * palabra distintiva. Para un puerto está bien —«MONTEVIDEO, URUGUAY» contra «MONTEVIDEO»— y para
       * la razón social de una empresa es demasiado: «SMITH TRADING SA» y «SMITH LOGISTICS LTD» salían
       * iguales. Lo encontró *Bulgrains v Shinhan Bank*, donde el crédito decía «Bulgrains Co Ltd», la
       * factura «Bulgrains & Co Ltd» y el High Court declaró la discrepancia material: compartían
       * «bulgrains» y el motor la daba por buena.
       */
      /*
       * Y un nombre que el motor **no puede leer** no es un nombre distinto (Opinión TA 886rev).
       *
       * `normISBP` se queda con letras y números, así que un sello en chino, árabe o cirílico se
       * normaliza a la cadena vacía y `comparaISBP` devuelve DISTINTO: el motor rechazaba por no poder
       * leer, que no es lo mismo que por no coincidir. Y el párrafo A21 (e) de la ISBP —transcripto en
       * esa Opinión— dice que **el nombre de una entidad y los sellos pueden ir en otro idioma** que el
       * del crédito, así que esa factura cumple.
       *
       * Salvo que el crédito lo haya cambiado, que es lo que decidió el caso:
       *
       *   «it had been made clear within the terms and conditions of the credit that any non-English
       *   text within a document must also be written in English language […] **The wording in the
       *   credit modified the practice as described in ISBP 745 paragraph A21 (e).**»
       *
       *   «In the absence of a letterhead or any other indication, in English, of the name of the issuer
       *   of the invoice, the discrepancy raised by the issuing bank is valid.»
       *
       * Así que las dos cosas se separan: con la cláusula del idioma en el crédito, el nombre ilegible
       * es **discrepancia**; sin ella, es un **aviso** —el motor no puede verificarlo y lo mira una
       * persona, que es lo que hizo el banco designado de esa Opinión—.
       */
      const sinLetrasLatinas = normISBP(emisor).trim() === "";
      const pideIngles = creditoExigeIngles(lc);
      const v = veredictoDeNombre(emisor, ctx.beneficiario, pideIngles);
      out.push(
        regla(
          "ucp-18a-i",
          "UCP 600 18a-i",
          "La factura la emite el beneficiario",
          v,
          sinLetrasLatinas
            ? pideIngles
              ? `la factura dice "${emisor}" y no trae ninguna indicación en caracteres latinos de quién la emite: ${NOTA_NOMBRE_ILEGIBLE_CON_INGLES}`
              : `la factura dice "${emisor}" y el motor no puede cotejarlo contra "${ctx.beneficiario}": ${NOTA_NOMBRE_ILEGIBLE}`
            : v === "ATENCION"
              ? `la factura dice "${emisor}" y el crédito nombra beneficiario a "${ctx.beneficiario}": ${NOTA_TIPEO_DE_NOMBRE}`
              : `la factura dice "${emisor}" y el crédito nombra beneficiario a "${ctx.beneficiario}"`,
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

/**
 * Y sobre un documento **multimodal** el lugar de carga no se puede rechazar.
 *
 * La Opinión R 638 / TA 629 decide exactamente este rechazo —*«B/L doesn\'t show port of loading as
 * required under L/C field 44E»*, con el 44E diciendo Umea y el documento Hamburgo— y lo declara
 * inválido:
 *
 *   «The fact that Umea is not shown as the port of loading but as place of receipt reflects the
 *   nature of the multimodal transport that occurred. Hamburg, being shown as the port of loading,
 *   correctly reflects the transport from that port to Jebel Ali.»
 *
 * El motivo es la naturaleza del papel y no una tolerancia: *«Where a multimodal transport document is
 * required or allowed, a shipment from a port to a port is not envisaged»*. El lugar que el crédito
 * nombra aparece en el casillero de **lugar de recepción**, y ése es un casillero que el esquema no
 * tiene: el motor lee `puertoEmbarque` y en un multimodal eso es el puerto del tramo oceánico.
 *
 * Así que sale **ATENCION y no DISCREPANCIA**, con la Opinión a la vista y diciendo qué hay que mirar
 * en el papel. No OK: el documento podría de verdad estar cargando en un puerto que el crédito no
 * nombró, y afirmar que cumple sin ver el lugar de recepción sería inventar la mitad que falta.
 *
 * **El alcance es el que la Opinión decide y nada más:** solo el artículo 19, solo el lado de la
 * carga. Sobre un marítimo del artículo 20 un puerto de carga distinto sigue siendo discrepancia —el
 * crédito nombró el puerto y el papel es de puerto a puerto— y el lado del destino queda como estaba
 * hasta que un caso real pruebe el espejo.
 */
const NOTA_R638 =
  " — es un documento multimodal, así que ese casillero es el puerto del tramo oceánico y el lugar que nombra el crédito puede estar en el casillero de lugar de recepción, que el motor no lee: la Opinión R 638 / TA 629 declara inválido el rechazo por esto. Verificar en el papel el lugar de recepción";

function reglasLugares(
  doc: DocAnalizado,
  ctx: ContextoCredito,
  fuente: string,
  prefijo: string,
  comoSeLlama: [string, string],
  esMultimodal = false,
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
            const ablanda = esMultimodal && sufijo === "carga" && v.estado === "DISCREPANCIA";
            return regla(
              id,
              fuente,
              `${cual} el que indica el crédito ("${delCredito}")`,
              ablanda ? "ATENCION" : v.estado,
              `el documento dice "${enDoc}"${ablanda ? NOTA_R638 : v.nota}`,
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
  /*
   * Y «received for shipment» **cuenta**, que es lo que la Opinión R 638 / TA 629 resuelve.
   *
   * El inciso pide que la mercadería conste «dispatched, taken in charge or shipped on board», y un
   * documento multimodal que dice «received for shipment» consta tomada a cargo: la conclusión de la
   * Opinión es explícita —*«Due to the fact that a multimodal transport has occurred, the transport
   * document marked "received for shipment" and dated as of that date is acceptable»*— y el análisis
   * explica por qué, *«Where a multimodal transport document is required or allowed, a shipment from a
   * port to a port is not envisaged»*.
   *
   * El motor lo mandaba a verificar: la lista de palabras tenía «shipped» y no «shipment», así que la
   * leyenda más corriente de un multimodal salía ATENCION. No era un falso positivo —ATENCION no
   * rechaza— pero era el motor sin concluir sobre lo único que el artículo 19 tiene de propio.
   *
   * **El alcance está en que esta regla es solo del artículo 19.** Sobre un marítimo del artículo 20
   * «received for shipment» no alcanza y eso lo decide `ucp-20a-ii`, que pide la anotación de a bordo
   * con fecha y no se tocó. Y si el crédito pidió el documento «on board», la exigencia la mira
   * `ucp-14a-on-board` con los dos frenos de R 638 y R 641.
   */
  const CONSTA_19A_II = /dispatch|taken in charge|shipped|shipment|on board|despach|tomad|recib/i;
  out.push(
    constancia
      ? regla(
          "ucp-19a-ii",
          "UCP 600 19a-ii",
          "La mercadería consta despachada, tomada a cargo o embarcada en el lugar del crédito",
          CONSTA_19A_II.test(constancia) ? "OK" : "ATENCION",
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
    ...reglasLugares(
      doc,
      ctx,
      "UCP 600 19a-iii",
      "ucp-19a-iii",
      ["Lugar de despacho o toma a cargo", "Lugar de destino final"],
      true,
    ),
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
 * Lo que el crédito pidió «on board» y el artículo 19 no exige.
 *
 * El artículo 19 admite que la mercadería conste **despachada, tomada a cargo o embarcada**: a un
 * documento multimodal no se le pide la anotación de a bordo. Pero un crédito puede pedirla, y
 * entonces la pide: *«the credit expressly requires presentation of a "full set clean on board bill
 * of lading." Consequently, the document must be examined under UCP 600 article 20 […] the
 * discrepancy raised by the issuing bank is valid.»*
 *
 * El caso de la fuente es exactamente ese: un «Multimodal Transport Bill of Lading» con la leyenda
 * «Received for Shipment» y sin anotación de a bordo, contra un 46A que pedía «Full set clean on
 * board bill of lading». El motor clasificaba el papel como multimodal por su título, lo examinaba
 * con el artículo 19 —que no pide «on board»— y la exigencia del crédito **no la miraba nadie**.
 *
 * El fundamento no es el artículo 19 ni el 20: es el **14 (a)**, que es lo que hace que esto se
 * pueda afirmar sin el texto de la ISBP. Los documentos se examinan contra los términos del crédito,
 * y acá el crédito escribió «on board».
 *
 * **El alcance es angosto a propósito, y es la mitad de la decisión.** Corre solo sobre un documento
 * **multimodal**:
 *
 * - sobre un marítimo, un sea waybill o un fletamento la anotación ya la exige el propio artículo
 *   (`ucp-20a-ii`), así que esto sería una segunda línea diciendo lo mismo;
 * - sobre un **aéreo, terrestre o courier no corre nunca**, aunque el crédito escriba «on board».
 *   Un air waybill no dice «on board» jamás, y rechazarlo por no parecerse a un marítimo es el error
 *   que las tres reglas del artículo 23 existen para evitar. Si un crédito pide «on board air
 *   waybill» el problema está en el crédito, y eso lo mira `emision.ts`.
 *
 * Y la otra mitad del par dice qué **no** hay que hacer con esto: un conocimiento titulado
 * «port-to-port» con un lugar de recepción interior y pre-acarreo por camino **no** es un documento
 * multimodal —*«a bill of lading showing either an inland point or other port would be acceptable
 * provided that a valid on board notation was included»* (R 280)— así que la clase sigue saliendo de
 * lo que el papel dice de sí mismo y no de que tenga pre-acarreo.
 */
function reglaOnBoardQuePideElCredito(
  doc: DocAnalizado,
  exigidos: string[],
  condicionesAdicionales: string[] = [],
): ReglaPresentacion[] {
  /*
   * La línea del transporte se busca con `claveDoc` y no con un patrón propio.
   *
   * El patrón de acá decía `/bill of lading|transport document|conocimiento/` y no reconocía
   * «MARINE BILL(S) OF LADING» —el plural entre paréntesis de la Opinión R 638 / TA 629— ni «3/3
   * ORIGINAL B/LS» ni un documento multimodal titulado de cualquiera de las otras seis maneras. O sea
   * que la regla se salteaba en silencio, que es el mismo defecto que la batería de `apareo-46a`
   * existe para frenar, cometido con un patrón paralelo al que esa batería cubre.
   */
  const lineaDeTransporte = exigidos.find((d) => claveDoc(d) === "BL");
  if (!lineaDeTransporte || !/\bon\s*board\b|\bshipped\s+on\s+board\b|a\s+bordo/i.test(lineaDeTransporte)) {
    return [];
  }

  /*
   * Y el freno que trajo R 638 / TA 629: **si el crédito permite el multimodal, el «on board» no se
   * le exige.**
   *
   * En esa Opinión el 46A pide «full set of at least 3/3 original clean on board marine bill(s) of
   * lading» y una condición adicional dice «Multimodal transport document is acceptable». El banco
   * rechazó y la ICC declaró el rechazo inválido: las palabras «on board» pertenecen a la alternativa
   * del marítimo, y quien escribió el crédito así carga con la ambigüedad —*«it can only be the
   * issuing bank (and ultimately, the applicant) that bears the risk of such ambiguity»*—. La
   * conclusión es explícita: *«Due to the fact that a multimodal transport has occurred, the transport
   * document marked "received for shipment" and dated as of that date is acceptable.»*
   *
   * El discriminador es de quién cuelgan las palabras, y lo decide la línea misma:
   *
   * - si la línea que dice «on board» **nombra el documento multimodal** —«clean on board multimodal
   *   transport document», que es el crédito de R 641 / TA 650rev— el crédito sí la pidió para este
   *   papel y la regla corre;
   * - si la línea nombra un **marítimo** y el permiso del multimodal está en otra parte, manda R 638 y
   *   la regla no se emite.
   *
   * Sin este freno el motor producía sobre los hechos de R 638 una discrepancia que la ICC declara
   * inválida, con texto oficial en contra.
   */
  const laLineaNombraElMultimodal = /multimodal|combined transport|intermodal|through bill/i.test(lineaDeTransporte);
  const permitido = condicionesAdicionales.some(
    (c) => /multimodal|combined transport|intermodal/i.test(c) && /acceptable|allowed|permitted|acepta|permit/i.test(c),
  );
  if (permitido && !laLineaNombraElMultimodal) return [];
  const constancia = val(doc, "onBoard");
  if (!constancia) {
    return [
      sinLeer(
        "ucp-14a-on-board",
        "UCP 600 14a",
        "El crédito pide el documento «on board» y el documento lo evidencia",
        "la anotación de a bordo",
      ),
    ];
  }
  const estaABordo = /\bon\s*board\b|\bshipped\b|a\s+bordo|embarcad/i.test(constancia);
  /*
   * Y si está a bordo, **con qué fecha**, que es la mitad que faltaba.
   *
   * La Opinión R 641 / TA 650rev contesta exactamente este supuesto —un multimodal contra un crédito
   * que pidió «clean on board multimodal transport document», con la anotación agregada aparte y sin
   * fecha dentro de ella— y le da la razón al banco que rechazó:
   *
   *   «A dated on board notation is clearly required when the credit so requests. It is also required
   *   when the document evidences the first leg of the carriage as a sea shipment from the place
   *   stated in the credit.»
   *
   * Hasta acá esta regla miraba la palabra y no la fecha, así que un conocimiento sin fecha de
   * embarque en ninguna parte salía OK.
   *
   * **Sale ATENCION y no DISCREPANCIA, y el motivo es el párrafo 2 de la misma conclusión:**
   *
   *   «Where a transport document is pre-printed shipped on board, the date of issuance would be
   *   deemed to be the date of shipment.»
   *
   * O sea que el mismo texto significa dos cosas distintas según venga **preimpreso** —y entonces
   * rige la fecha de emisión y el documento cumple— o **agregado** —y entonces no hay fecha de
   * embarque y la discrepancia vale—. El campo trae un solo texto copiado del papel, y «SHIPPED ON
   * BOARD» se escribe igual en los dos. Rechazar un conocimiento preimpreso sería el falso positivo
   * que mata la adopción; dejar pasar uno agregado sin fecha es lo que hacía antes. Lo defendible es
   * ponerlo delante de una persona nombrando la Opinión, que es lo que hace.
   *
   * R 642 / TA 666rev lo amplía a cuatro variantes de leyenda preimpresa y no mueve la conclusión:
   * «the same conclusion will apply notwithstanding the type or title of document presented».
   */
  const conFecha = fechaEnTexto(constancia) !== null;
  return [
    regla(
      "ucp-14a-on-board",
      "UCP 600 14a",
      "El crédito pide el documento «on board» y el documento lo evidencia con fecha",
      estaABordo ? (conFecha ? "OK" : "ATENCION") : "DISCREPANCIA",
      estaABordo
        ? conFecha
          ? `el 46A pide "on board" y el documento dice "${constancia}"`
          : `el 46A pide "on board" y el documento dice "${constancia}" — no se le leyó una fecha: la Opinión R 641 / TA 650rev pide la anotación fechada cuando el crédito la pide, salvo que la leyenda venga preimpresa, y entonces rige la fecha de emisión. Verificar en el papel si está preimpresa o agregada`
        : `el 46A pide "on board" y el documento dice "${constancia}": el artículo 19 admite que conste tomada a cargo, pero este crédito pidió a bordo`,
    ),
  ];
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
      : esSoloVuelo
        ? /*
           * Sin fecha de emisión y con una notación de vuelo: el aviso nombra la Opinión TA 862.
           *
           * El motor no puede concluir, y el motivo es el límite más de fondo que tiene: un campo vacío
           * significa las dos cosas a la vez —que el papel no trae la fecha, que es la discrepancia que
           * la ICC declara válida, o que nadie la cargó todavía, que no es nada—. Resolver eso necesita
           * un tercer estado en el esquema («ausente en el papel») y es una decisión de producto.
           *
           * Lo que sí puede hacer es no dejar al examinador buscando la Opinión: la frase le dice qué
           * mirar y cuál es la respuesta si el papel de verdad no la trae.
           *
           *   «The date of issuance of an air transport document will be considered as the date of
           *   shipment, unless the air transport document contains a specific notation of the actual
           *   date of shipment. However, neither UCP 600 nor ISBP 745 indicates that the reverse is
           *   permitted. An air transport document must always include a date of issuance.»
           */
          regla(
            "ucp-23a-iii",
            "UCP 600 23a-iii",
            "Fecha de emisión del documento aéreo",
            "ATENCION",
            `no se leyó la fecha de emisión y el documento trae una notación de vuelo, "${notacion}": si el papel no trae fecha de emisión es discrepancia, porque la del vuelo no la reemplaza (Opinión TA 862). Verificar en el papel`,
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
              `Aeropuerto ${cual} el que indica el crédito ("${delCredito}")`,
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

/**
 * Con qué capacidad se firmó el documento de transporte — el inciso (a) (i) de los siete artículos.
 *
 * Es de lo primero que mira un examinador y el motor no lo miraba: no existía ninguna regla del
 * inciso (a) (i) en ningún artículo del 19 al 25. Se miraban puertos, anotación de a bordo,
 * originales, transbordo y cláusulas, y no quién firma.
 *
 * **Lo que decide es la capacidad declarada contra la clase del documento**, porque las capacidades
 * admitidas no son las mismas: el artículo 22 admite capitán, armador o fletador y **no** al
 * transportista, al revés que el 20. Un conocimiento de fletamento firmado «as agent for the
 * carrier» es discrepante (Opinión R834 / TA 793rev) y el mismo bloque de firma en un conocimiento
 * marítimo está perfecto.
 *
 * Tres decisiones, y las tres son para no rechazar lo conforme:
 *
 * 1. **Una capacidad que no se reconoce nunca da discrepancia.** Sale a verificar citando el texto.
 *    Los bloques de firma se redactan de mil formas y el repositorio ya pagó el precio de concluir
 *    sobre prosa; acá, además, la dirección del error sería la cara — rechazar un documento bien
 *    firmado por no haber entendido cómo lo escribieron.
 * 2. **No se comparan nombres.** La Opinión R754 / TA 750rev resuelve justamente eso: un
 *    conocimiento firmado por una **sucursal** del transportista, con un nombre distinto del de la
 *    casa matriz, cumple — *«Neither is the fact that the name of the branch differs from the name
 *    of the carrier»*. Una regla que exigiera que el firmante se llame como el transportista
 *    rechazaría a media línea marítima.
 * 3. **Con la clase sin determinar no se dictamina.** Las capacidades dependen del artículo, y el
 *    artículo de la clase que no se pudo determinar es una suposición.
 *
 * Lo que esta regla **no** mira, y conviene que esté dicho: la otra mitad del inciso, que el
 * documento **nombre** al transportista. El nombre suele venir en el mismo bloque o en el membrete,
 * y afirmar que falta leyendo este campo sería afirmar sobre lo que no se extrajo.
 */
function reglaFirmaTransporte(bl: DocAnalizado, modo: ModoTransporte): ReglaPresentacion[] {
  const fuente = fuenteDelInciso(modo, "a-i");
  const texto = val(bl, "firmaTransporte");
  if (!texto) {
    return [
      sinLeer(
        "ucp-firma-transporte",
        fuente,
        "Con qué capacidad se firmó el documento de transporte",
        "el bloque de firma",
      ),
    ];
  }

  const { capacidad, porAgente } = leerFirma(texto);
  const admitidas = capacidadesAdmitidas(modo);
  const comoLasLlama = admitidas.map((c) => NOMBRE_CAPACIDAD[c]).join(", ");

  if (!capacidad) {
    return [
      regla(
        "ucp-firma-transporte",
        fuente,
        "Con qué capacidad se firmó el documento de transporte",
        "ATENCION",
        `dice "${texto}" y no se reconoció una capacidad: verificar a mano que firme ${comoLasLlama}, o un agente nombrado por cuenta de alguno de ellos`,
      ),
    ];
  }

  if (modo === "SIN_DETERMINAR") {
    return [
      regla(
        "ucp-firma-transporte",
        fuente,
        "Con qué capacidad se firmó el documento de transporte",
        "ATENCION",
        `dice "${texto}", o sea ${NOMBRE_CAPACIDAD[capacidad]}${porAgente ? " por medio de un agente" : ""} — pero no se pudo determinar la clase del documento, y qué capacidad se admite depende del artículo que corresponda`,
      ),
    ];
  }

  const admitida = admitidas.includes(capacidad);
  return [
    regla(
      "ucp-firma-transporte",
      fuente,
      "Con qué capacidad se firmó el documento de transporte",
      admitida ? "OK" : "DISCREPANCIA",
      admitida
        ? `firma ${NOMBRE_CAPACIDAD[capacidad]}${porAgente ? " por medio de un agente nombrado, que el artículo admite" : ""}: "${texto}"`
        : `firma ${NOMBRE_CAPACIDAD[capacidad]} y este documento solo lo puede firmar ${comoLasLlama}: "${texto}"`,
    ),
  ];
}

/* ──────────────────── documento de transporte (arts. 20, 26, 27) ──────────────────── */

function reglasTransporte(
  ctx: ContextoCredito,
  bl: DocAnalizado,
  exigidos: string[],
  modo: ModoTransporte = "MARITIMO",
): ReglaPresentacion[] {
  const out: ReglaPresentacion[] = [];

  /*
   * El inciso (a) (iii) de los artículos 20, 21 y 22: embarque del puerto de carga al de descarga
   * que fija el crédito.
   *
   * Las tres clases comparten la comprobación y **no comparten el artículo.** Un sea waybill se
   * examina con el 21 y un conocimiento de fletamento con el 22, y la fuente del hallazgo iba fija
   * en «UCP 600 20a-iii» para los tres: sobre un conocimiento de fletamento el motor citaba un
   * artículo que no es el que rige.
   *
   * No es cosmético. La fuente es lo que el banco lee y lo que viaja en el aviso de rechazo del
   * artículo 16 a otro banco, y un aviso que invoca el artículo equivocado es un aviso que el
   * presentador puede discutir. Es el mismo borde que ya estaba anotado para los nombres del
   * artículo 14 —«Conocimiento de embarque» sobre un aéreo— resuelto en esta familia.
   *
   * **El id de la regla no cambia** (`ucp-20a-iii-*`). Es la clave interna con la que los casos del
   * banco de pruebas y los tests nombran la regla, y renombrarla por clase obligaría a cambiarlos
   * todos sin mejorar nada de lo que alguien lee.
   */
  const fuentePuertos = fuenteDelInciso(modo, "a-iii");
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
              fuentePuertos,
              `Puerto ${cual} el que indica el crédito ("${puertoLC}")`,
              v.estado,
              `el documento dice "${enDoc}"${v.nota}`,
            );
          })()
        : sinLeer(`ucp-20a-iii-${k}`, fuentePuertos, `Puerto ${cual} el que indica el crédito`, `el puerto ${cual}`),
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
   * Y qué buque nombra esa anotación, que es otra cosa que la fecha.
   *
   * El motor verificaba que la anotación existiera y tuviera fecha, y nada más. Lo que el par de
   * Opiniones R 350 y TA 743rev decide es **cuál** buque nombra: *«the named vessel is the vessel
   * that leaves the port of loading and not any vessel which may appear in the pre-carriage box»*.
   * Con un conocimiento con pre-acarreo, una anotación que nombra el buque de pre-acarreo es
   * discrepancia válida (R 350) y una que da cuenta del oceánico no lo es (TA 743rev).
   *
   * De eso se automatiza una parte y se dice la otra:
   *
   * - **la anotación nombra al buque oceánico → OK.** Es la afirmación que faltaba.
   * - **nombra algo que no es el buque ni el puerto de carga → ATENCION**, con las dos Opiniones y
   *   el texto a la vista. No DISCREPANCIA: lo que sobra podría ser un puerto de trasbordo o una
   *   terminal, y lo que separa a las dos Opiniones es la redacción de la anotación. Rechazar sobre
   *   una palabra que no se entendió es el error que mata la adopción.
   * - **no nombra nada más → no se emite nada.** «SHIPPED ON BOARD 20-AUG-2026» es la anotación
   *   corriente y no tiene por qué repetir el buque: el documento ya lo trae en su casillero.
   *   Emitir algo acá sería ruido en casi todos los conocimientos, y un aviso sobre casos buenos
   *   enseña a ignorar los avisos.
   */
  if (onBoard && buque && !intended) {
    const { nombraAlBuque, sobra, sobraUnBuque } = buqueDeLaAnotacion(onBoard, buque, val(bl, "puertoEmbarque"));
    if (nombraAlBuque || sobra.length > 0) {
      /*
       * Y la tercera banda, que trajo la Opinión **TA 858rev**: cuando el papel **marca** lo que sobra
       * como un buque, el aviso se vuelve veredicto.
       *
       * El par R 350 / TA 743rev había dejado esto en ATENCION con un motivo bueno: lo que sobra en una
       * anotación puede ser un puerto de trasbordo o una terminal. La TA 858rev tiene los hechos exactos
       * —misma plaza en lugar de recepción y puerto de carga, dos buques distintos en pre-acarreo y
       * oceánico, y la anotación nombrando el de pre-acarreo— y contesta las dos preguntas:
       *
       *   «1. ICC Opinions R350 and R352 still apply under UCP 600. 2. Yes, the refusal is valid. The
       *   bill of lading requires a dated on board notation indicating vessel O and Port H.»
       *
       * Así que con el marcador delante —«MV W», «M/V W», «SS W»— ya no hay nada que verificar: es un
       * buque y no es el que el documento declara como oceánico. Sin marcador, el aviso queda como
       * estaba.
       */
      out.push(
        regla(
          "ucp-20a-ii-buque",
          "UCP 600 20a-ii",
          "La anotación de a bordo nombra el buque que salió del puerto de carga",
          nombraAlBuque ? "OK" : sobraUnBuque ? "DISCREPANCIA" : "ATENCION",
          nombraAlBuque
            ? `la anotación dice "${onBoard}" y nombra al buque "${buque}"`
            : sobraUnBuque
              ? `la anotación dice "${onBoard}" y nombra como buque a ${sobra.join(", ")}, que no es el que el documento declara como oceánico ("${buque}"): el artículo pide la anotación sobre el buque que sale del puerto de carga, y la Opinión TA 858rev lo da por discrepancia —y confirma que R 350 y R 352 siguen aplicando bajo las UCP 600`
              : `la anotación dice "${onBoard}" y nombra ${sobra.join(", ")} en vez del buque "${buque}": verificar si es el buque que salió del puerto de carga o uno de pre-acarreo — la Opinión R 350 dice que nombrar el de pre-acarreo es discrepancia y la TA 743rev que no lo es cuando la anotación da cuenta del oceánico`,
        ),
      );
    }
  }

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
  /*
   * Y la otra mitad: **«expresamente»** es la palabra del artículo, y el motor la ignoraba.
   *
   * El 27 define el documento limpio como el que no lleva cláusula o anotación que **declare
   * expresamente** defectuosa la mercadería o su embalaje. La regla trataba cualquier cláusula que
   * no fuera un «no hay nada» como una declaración de defecto, así que daba DISCREPANCIA sobre
   * texto que no declara nada.
   *
   * La Opinión TA 941rev es exactamente eso: un conocimiento que decía *«Cargo Conditions As Per
   * Survey Report issued by [surveyor]»*, con el survey report no exigido por el crédito. El banco
   * emisor rechazó diciendo que sin ese informe no podía determinar si el conocimiento estaba
   * limpio, y la ICC contestó: *«There was no wording on the bill of lading which suggested any
   * defective condition of the goods or their packaging»*, y que un documento no exigido se
   * desestima (14 g) — *«this would have remained the case even if the survey report had been
   * presented»*.
   *
   * Es el mismo error que la cláusula «the Carrier may carry the goods on deck» del primer
   * expediente real, que el artículo 26 (a) admite y la regla marcaba: **una condición general del
   * transportista leída como una declaración sobre este embarque.**
   *
   * Lo que no se reconoce sale en ATENCION y no en OK: el silencio no se cuenta como conforme, y
   * acá lo que el motor puede afirmar es que no encontró una declaración de defecto, no que no la
   * haya. La lista es a mano, con el riesgo que eso tiene, y cubre lo que un transportista escribe
   * de verdad — el positivo verdadero del que salió está en los tests: «Ship's remark: All cargo
   * atmospheric rusty», que sí es discrepancia.
   */
  const DECLARA_DEFECTO =
    /\b(rust\w*|oxidad\w*|wet|damp|humed\w*|moj\w*|stain\w*|manchad\w*|torn|tear|roto|rotos|rotas|broken|damag\w*|dañad\w*|avería|averiad\w*|leak\w*|derram\w*|short(?:age)?|faltante|insufficient\s+pack\w*|inadequate\s+pack\w*|embalaje\s+(?:insuficiente|inadecuado|deficiente)|soil\w*|sucio|dent\w*|abollad\w*|mould\w*|mold\w*|enmohecid\w*|contaminat\w*|contaminad\w*|defective|defectuos\w*|hole[ds]?|agujeread\w*|unprotected|second.?hand\s+pack\w*|re.?used\s+(?:bags|packing)|slack\s+barrels?)\b/i;

  const SIN_CLAUSULA =
    /^\s*(n\s*\/\s*a|nil|none|no|not\s+applicable|ninguna?|sin\s+(observaciones|clausulas?|novedad)|[-—–.]+)\s*$/i;
  const defecto = val(bl, "clausulaDefecto");
  out.push(
    defecto
      ? (() => {
          const limpio = SIN_CLAUSULA.test(defecto) || /no clause|limpio|clean/i.test(defecto);
          if (limpio)
            return regla(
              "ucp-27",
              "UCP 600 27",
              "Documento de transporte limpio",
              "OK",
              `cláusula leída: "${defecto}"`,
            );
          const declara = DECLARA_DEFECTO.test(defecto);
          return regla(
            "ucp-27",
            "UCP 600 27",
            "Documento de transporte limpio",
            declara ? "DISCREPANCIA" : "ATENCION",
            declara
              ? `cláusula leída: "${defecto}"`
              : `cláusula leída: "${defecto}" — no declara expresamente una mercadería o un embalaje defectuosos, así que no se dictamina: hay que leerla`,
          );
        })()
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

  /*
   * 28a, segunda mitad: con **dos o más aseguradores** la firma tiene que decir por cuenta de quién.
   *
   * La regla de arriba mira una sola cosa —que el nombre del emisor parezca el de una aseguradora— y
   * con una póliza que nombra dos y firma una seguía saliendo OK. La Opinión **TA 759** dice lo
   * contrario, y de paso explica por qué el caso llegó a la ICC: el párrafo 174 de la ISBP resuelve el
   * coaseguro **en varios documentos** y no dice nada del coaseguro en uno solo.
   *
   *   «When an insurance document indicates that the risks are covered by two or more insurers, the
   *   insurance document must be signed by all the insurers or one insurer on behalf of other
   *   co-insurers.»
   *
   * Y la segunda pregunta de la consulta tiene una respuesta que un examinador no adivina:
   *
   *   «an insurance document signed indicating "leading insurer" only will not be sufficient to comply
   *   with UCP 600 sub-article 28 (a). The leading insurer must also identify that it is signing on
   *   behalf of the other co-insurer(s).»
   *
   * **Solo se emite cuando el papel nombra dos.** Con un asegurador no hay nada que decir, y eso es la
   * enorme mayoría de las pólizas: la regla no aparece para no hacer ruido donde no hay pregunta.
   */
  if (emisor) {
    const cuantos = (emisor.match(/\b(?:insurance|assurance|underwrit\w*|seguros?|aseguradora)\b/gi) ?? []).length;
    const porCuentaDeOtro = /\b(?:for and )?on behalf of\b|\bpor cuenta (?:y orden )?de\b/i.test(emisor);
    if (cuantos >= 2) {
      out.push(
        regla(
          "ucp-28a-coaseguro",
          "UCP 600 28a",
          "Con dos aseguradores, la firma dice por cuenta de quién",
          porCuentaDeOtro ? "OK" : "DISCREPANCIA",
          porCuentaDeOtro
            ? `dice "${emisor}": firma por cuenta del otro asegurador, que es lo que el artículo pide`
            : `dice "${emisor}": el papel nombra más de un asegurador y la firma no indica por cuenta de quién. Tienen que firmar todos, o uno por cuenta de los demás — y decir solo «leading insurer» no alcanza (Opinión TA 759)`,
        ),
      );
    }
  }

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
  /*
   * El 45A entero, pero solo si es el MISMO campo que `mercaderia`.
   *
   * Son dos vistas del 45A —una recortada en el incoterm, otra no— y quien arma el contexto puede
   * setear una y olvidar la otra: ahí el crudo viejo le ganaría a la descripción nueva y la regla
   * mediría contra la cantidad de otro crédito. Como el recorte es un prefijo del campo entero, la
   * coherencia se verifica en vez de asumirse.
   */
  const recorte = (ctx.mercaderia ?? "").trim();
  const entero = (ctx.mercaderiaCompleta ?? "").trim();
  const texto45A = entero && (!recorte || entero.includes(recorte)) ? entero : ctx.mercaderia;
  const pedido = cantidadDelCredito(texto45A);
  const factura = docs.find((d) => d.tipo === "FACTURA");
  const cantFac = factura ? val(factura, "cantidad") : null;
  const uniFac = factura ? val(factura, "unidad") : null;
  /*
   * Cuando el crédito trae la cantidad en una forma que no se puede resolver —dos ítems sin un
   * total, «500 MT OF SOYBEAN MEAL AND 300 MT OF SUNFLOWER MEAL»— `cantidadDelCredito` devuelve
   * null a propósito, y su comentario dice «el examen lo dice en vez de decidir». No lo decía:
   * esto era un `if` sin `else` y la regla desaparecía del examen.
   *
   * Una regla ausente no se lee como «no pude»: se lee como «no aplica». El operador ve el examen
   * completo sin una línea de cantidad y concluye que no había nada que mirar, que es exactamente
   * la falla silenciosa que el repo no admite. Si hay factura con cantidad y el crédito no se pudo
   * resolver, se dice.
   */
  /* Y solo cuando el crédito SÍ nombra cantidades: ver `cantidadesDelCredito`. */
  if (!pedido && cantFac) {
    const enumeradas = cantidadesDelCredito(texto45A);
    if (enumeradas.length > 0) {
      /*
       * Y cuando el crédito **enumera** cantidades, se dice contra qué hay que verificar.
       *
       * «No se pudo deducir una cantidad única» es cierto y no alcanza: deja al examinador frente a
       * un 45A con tres ítems sin decirle qué hacer con ellos, y lo primero que se le ocurre a
       * cualquiera es **sumarlos y comparar el total**. Eso es exactamente el error que la Opinión
       * R 688 / TA 619 corrige: con «Item 1: 1000MT Item 2: 500MT Item 3: 600MT» y una tolerancia del
       * 10 %, una factura de 1150 + 350 + 580 da 2080 contra 2100 contratadas —dentro de la
       * tolerancia sobre el total— y **la discrepancia igual es válida**, porque *«the tolerance is
       * to be applied against the individual quantities»*.
       *
       * El motor no puede hacer ese cotejo: ni el crédito ni la factura traen sus renglones en
       * campos, y hay uno solo de cantidad por documento. Pero sí puede **enumerar lo que leyó y
       * nombrar la regla**, que es la diferencia entre «no sé» y «no sé, y esto es lo que hay que
       * mirar».
       */
      const lista = enumeradas.map((q) => q.crudo).join(" · ");
      out.push(
        regla(
          "ucp-30b-cantidad",
          "UCP 600 30a",
          "Cantidad de la factura dentro de lo que pide el crédito",
          "ATENCION",
          `la factura dice ${cantFac} ${uniFac ?? ""} y el crédito enumera ${enumeradas.length} cantidades (${lista}): la tolerancia se aplica a cada una y no a la suma (Opinión R 688 / TA 619), así que hay que verificar ítem por ítem`.replace(
            /\s+/g,
            " ",
          ),
        ),
      );
      return out;
    }
  }
  /*
   * Y el espejo del caso de arriba, que faltaba: **el crédito nombra una cantidad y la factura no.**
   *
   * El comentario de arriba dice la razón entera —«una regla ausente no se lee como "no pude": se
   * lee como "no aplica"»— y estaba resuelta en una sola dirección. Con el crédito pidiendo «1200
   * KGS» y una factura que declara los renglones sin total, el examen no producía **ninguna** línea
   * de cantidad: ni la comparación, ni el aviso. Desde el tablero eso es indistinguible de un
   * crédito que no fija cantidad, y acá el silencio no se cuenta como conforme.
   *
   * Lo encontró la Opinión TA 962rev, que es justamente la que dice que la ausencia de un total
   * agregado **no es discrepancia**. Por eso esto sale en ATENCION y nunca en DISCREPANCIA: lo que
   * el motor puede afirmar es que no tiene con qué comparar, no que el documento esté mal.
   */
  if (pedido && !cantFac) {
    out.push(
      regla(
        "ucp-30b-cantidad",
        "UCP 600 30b",
        "Cantidad de la factura dentro de lo que pide el crédito",
        "ATENCION",
        `el crédito pide ${pedido.valor} ${pedido.unidad} y la factura no declara una cantidad total: verificar a mano. La ausencia de un total no es discrepancia por sí misma (Opinión TA 962rev), pero sin él no hay con qué comparar`,
      ),
    );
    return out;
  }
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
    /*
     * El «about» tiene que ser el de la CANTIDAD, no cualquiera del 45A.
     *
     * El 30 (a) lo dice con todas las letras: «about» or «approximately» «used in connection with
     * the amount of the credit, the quantity or the unit price». Buscarlo en todo el campo le daba
     * el ±10 % a un crédito cuyo «about» era de la fecha —«SHIPMENT ABOUT MID APRIL 2025», que es
     * el 30 (a) hablando de otra cosa— y dejaba pasar una factura 8 % excedida citando ese
     * artículo como respaldo. El falso positivo lo discute el exportador; este pase libre lo paga
     * el banco y no lo ve nadie.
     *
     * Se mira el mismo renglón y los 24 caracteres previos al número, que es donde el 45A lo
     * escribe: «ABOUT 57 MTS», «QUANTITY: ABOUT 57 MTS». Un «about» posterior o de otra línea no
     * cuenta.
     */
    const antesDeLaCantidad = (texto45A ?? "").slice(0, pedido.en);
    const renglonDeLaCantidad = antesDeLaCantidad.slice(antesDeLaCantidad.lastIndexOf("\n") + 1);
    const porAbout = /\b(about|approximately|circa|aproximadamente|aprox)\b[^\n]{0,24}$/i.test(renglonDeLaCantidad);
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
      /*
       * Con embarques parciales permitidos (43P), quedarse corto NO es discrepancia: es un giro.
       *
       * El crédito de este caso pide 500 MT y la primera factura es de 223,27 —el 45 %—, con 43P
       * ALLOWED. Medir cada giro contra el total y marcarlo discrepante sería inventar un rechazo
       * sobre un paquete correcto, que es peor que el silencio que esta regla vino a tapar.
       *
       * Lo que el 43P no autoriza es PASARSE: la tolerancia del 30 (b) es sobre la cantidad del
       * crédito, no un permiso para girar de más. Por eso el exceso sigue siendo discrepancia.
       *
       * Y el corto queda en ATENCION, no en OK: el banco no lo rechaza —es un giro parcial— pero
       * el motor no puede distinguir «embarqué el 45 % a propósito» de «cargué mal la cantidad»,
       * y darlo por conforme sería volver al silencio que esta regla vino a tapar. Lo dice y lo
       * mira una persona.
       *
       * Lo que todavía no se mira es la SUMA de los giros anteriores contra el total; eso necesita
       * `anteriores`, y mientras no esté, un parcial corto se informa como parcial y nada más.
       */
      const parcialesOk = Boolean(
        ctx.parciales &&
          /allowed|permit/i.test(ctx.parciales) &&
          !/not\s+allowed|no\s+permit|prohib/i.test(ctx.parciales),
      );
      const corto = desvio < 0;
      const dentro = Math.abs(desvio) <= tol + 1e-9;
      /* el giro corto bajo 43P no es ninguna de las dos cosas: ver el comentario de arriba */
      const porParcial = parcialesOk && corto && !dentro;
      out.push(
        regla(
          "ucp-30b-cantidad",
          porAbout ? "UCP 600 30a" : lc.tolerancia != null ? "39A" : "UCP 600 30b",
          `Cantidad de la factura dentro de lo que pide el crédito (${pedido.valor} ${pedido.unidad} ±${Math.round(tol * 100)} %)`,
          dentro ? "OK" : porParcial ? "ATENCION" : "DISCREPANCIA",
          `factura ${cantFac} ${uniFac ?? ""} · el crédito pide ${pedido.valor} ${pedido.unidad}`.trim() +
            (porParcial
              ? ` — es el ${Math.round((par.a / par.b) * 100)} % del crédito, y el 43P admite embarques parciales: no se mide contra el total. Queda por verificar que la SUMA de los giros no lo exceda.`
              : dentro
                ? ""
                : ` — ${desvio > 0 ? "+" : ""}${Math.round(desvio * 100)} %`),
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
    out.push(...reglaFirmaTransporte(bl, clase.modo));

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
      out.push(...reglasTransporte(ctx, bl, exigidos, clase.modo));
    } else if (clase.modo === "AEREO") {
      out.push(...reglasAereo(ctx, bl));
    } else if (clase.modo === "MULTIMODAL") {
      out.push(...reglasMultimodal(ctx, bl));
      out.push(...reglaOnBoardQuePideElCredito(bl, exigidos, input.lc.condicionesAdicionales ?? []));
    } else if (clase.modo === "TERRESTRE") {
      out.push(...reglasTerrestre(ctx, bl));
    } else if (clase.modo === "COURIER") {
      out.push(...reglasCourier(bl));
    } else if (clase.modo === "SIN_DETERMINAR") {
      out.push(...reglasTransporte(ctx, bl, exigidos, clase.modo));
    }
  }

  if (input.seguro) out.push(...reglasSeguro(input.lc, ctx, input.seguro, fac, doc("BL")));

  out.push(...reglasAplicacion(input.lc, ctx));
  out.push(...reglasQueDocumentoEs(input.docs));
  out.push(...reglasQuienEmite(input.lc, ctx, input.docs));
  out.push(...reglasGenerales(input.lc, ctx, input.docs, input.hoy));

  /*
   * Un standby no mueve mercadería, así que las reglas de la carga no tienen a qué aplicarse.
   *
   * Se filtra acá, al final y en un solo lugar, en vez de poner una condición adentro de cada
   * familia: así se puede leer de un vistazo qué queda desactivado y por qué, y un artículo nuevo
   * no se olvida de preguntar.
   *
   * Reproducido antes de escribirlo: con un standby de garantía de cumplimiento el examen afirmaba
   * «[OK] UCP 600 30b · Sin tolerancia en el crédito, la cantidad admite ±5 %». Decir «cumple»
   * sobre una cantidad que no existe es peor que no decir nada.
   */
  if (esStandby({ formaCredito: ctx.formaCredito, reglasAplicables: ctx.reglasAplicables })) {
    return out.filter((r) => !noAplicaAStandby(r.fuente));
  }
  return out;
}
