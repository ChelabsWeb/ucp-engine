import { type CamposDoc, cabezaDeExigencia, claveDoc, parseNumero } from "./consistencia";
import { cotejarEspecificaciones, pareceVariosDocumentos } from "./especificaciones";
import { fmtFecha, parseFecha } from "./fechas";
import { comparaISBP, emisorAdmitido, esCertificadoDeOrigen, exigePrevioAlEmbarque } from "./isbp";
import { type DocAnalizado, dondeSePideElNumeroLC, type EstadoRegla, type ReglaPresentacion } from "./presentacion";
import type { LcInfo } from "./types";

/**
 * Los otros documentos del campo 46A.
 *
 * El crédito del caso de referencia exige diez y solo tres —factura, packing y conocimiento de
 * embarque— tienen reglas propias. Los otros siete son certificados: origen, análisis,
 * fumigación, veterinario, nota de peso y dos certificados del beneficiario. Hasta ahora
 * el motor solo sabía si estaban o si faltaban.
 *
 * Lo que se puede verificar de un certificado leyendo su texto es poco pero importante:
 * quién lo emite, cuándo, y si dice lo que el crédito le pide decir. La autenticidad de
 * la firma y del sello queda del lado humano, como siempre.
 */

/** Un certificado presentado, apareado con el ítem del 46A que pretende cubrir. */
/*
 * `CAMPOS_CERTIFICADO` vive en `consistencia.ts`, con los demás juegos de campos.
 *
 * Tiene que estar allá porque `CAMPOS_POR_TIPO` lo usa, y `certificados.ts` importa de
 * `consistencia.ts`: al revés sería un ciclo. Se re-exporta desde acá porque es donde se lo busca.
 */
export { CAMPOS_CERTIFICADO } from "./consistencia";

export interface DocCertificado {
  /** el texto del ítem del 46A, tal como lo escribe el crédito */
  exigencia: string;
  campos: CamposDoc;
  nombreArchivo?: string;
}

const val = (c: { valor: string; confianza: number } | undefined): string | null =>
  c && c.valor.trim() && c.confianza >= 0.4 ? c.valor.trim() : null;

/**
 * Recorta sin partir una palabra.
 *
 * Cortar por el carácter exacto dejaba «BENEFICIARY'S CERTIFICATE CONFIRMING AL…»: además de
 * leerse mal, esa «AL» suelta hacía que el control de traducción la tomara por la preposición
 * castellana en medio de una cita del crédito que está en inglés.
 */
const corto = (s: string, n = 60) => {
  if (s.length <= n) return s;
  const cortado = s.slice(0, n - 1);
  const espacio = cortado.lastIndexOf(" ");
  return `${(espacio > n / 2 ? cortado.slice(0, espacio) : cortado).trimEnd()}…`;
};

/**
 * A quién nombra el crédito como emisor, cuando lo nombra.
 *
 * El punto **no** termina el nombre si está pegado a la palabra siguiente: en SWIFT las
 * abreviaturas van así —«GOVT.VETERINERY AUTHORITY IN URUGUAY», «CO.LTD»— y cortar en el primer
 * punto dejaba «GOVT» como emisor exigido. Con eso, el certificado veterinario del expediente de referencia
 * daba discrepancia contra el organismo que de verdad lo firma, y solo pasaba si el papel repetía
 * la abreviatura del crédito letra por letra, con su error de tipeo incluido.
 */
export function emisorQueNombra(exigencia: string): string | undefined {
  const m = /issued by\s+((?:[^,;.]|\.(?=\S))+)/i.exec(exigencia);
  const crudo = m?.[1]?.trim();
  if (!crudo) return undefined;
  /*
   * Y el nombre termina donde empieza lo que el documento tiene que decir.
   *
   * «ISSUED BY CARRIER OR ITS AGENT **STATING** THE VESSEL AGE» daba como emisor exigido la frase
   * entera, que después no coincidía con nada y mandaba a discrepancia un certificado correcto.
   */
  const cabeza = cabezaDeExigencia(crudo.toLowerCase());
  if (!cabeza || cabeza === crudo.toLowerCase()) return crudo;
  return crudo.slice(0, cabeza.length).trim() || crudo;
}

/**
 * Los nombres que satisfacen al emisor exigido: el crédito puede dar una alternativa.
 *
 * «ISSUED BY SGS OR INTERTEK» son dos emisores admitidos, no uno llamado «SGS OR INTERTEK».
 */
function emisoresAdmitidos(nombrado: string): string[] {
  return nombrado
    .split(/\s+\bor\b\s+|\s*\/\s*/i)
    .map((x) => x.replace(/^\s*(an?|the)\s+/i, "").trim())
    .filter(Boolean);
}

/**
 * Si el crédito describe al emisor por su función en vez de nombrarlo.
 *
 * «GOVT.VETERINERY AUTHORITY IN URUGUAY» describe un organismo; «CALISET» nombra un laboratorio.
 * La diferencia decide qué se puede afirmar: el nombre propio de la autoridad veterinaria de un
 * país no es predecible —en Uruguay es el Ministerio de Ganadería, Agricultura y Pesca— así que un
 * emisor que no coincide va a verificar. Un nombre propio que no coincide es otra entidad, y eso
 * sí es una discrepancia.
 *
 * La lista es corta y se queda corta a propósito: cada palabra describe una función pública o
 * gremial, no una marca. Ante la duda, no estar en la lista deja el veredicto tajante, que es el
 * comportamiento que había.
 */
function describeUnaFuncion(nombrado: string): boolean {
  return /\b(govt|government|governmental|authority|authorities|ministry|ministerio|official|state|public|chamber|department|bureau|institute|agency|board|inspectorate|customs|consulate|embassy|veterinary|veterinery|sanitary|health|carrier|shipper|master|manufacturer|producer|supplier|surveyor|laboratory|lab|agent|agents|forwarder|forwarders|insurer|underwriters?|inspector|inspection|company|beneficiary|exporter|packer|mill|factory|third party)\b/i.test(
    nombrado,
  );
}

function regla(id: string, fuente: string, texto: string, estado: EstadoRegla, evidencia: string): ReglaPresentacion {
  return { id, fuente, regla: texto, estado, evidencia };
}

/**
 * Cuándo ocurrió lo que el certificado acredita, si el papel lo dice.
 *
 * Los certificados de inspección lo escriben en el cuerpo: «INSPECTION CARRIED OUT AT MONTEVIDEO ON
 * 07-APR-2025 PRIOR TO LOADING». Es la fecha que importa para el párrafo A12b, y la única que el
 * motor puede usar para decidir cuando la emisión es posterior al embarque.
 */
/*
 * Los formularios lo escriben como sustantivo, no como verbo.
 *
 * La primera versión solo reconocía verbos —«carried out», «inspected»— y «DATE OF INSPECTION:
 * 07-APR-2025» es la forma más común de todas: un formulario con su etiqueta. No entraba, así que
 * el certificado salía discrepante **y la evidencia decía «no dice cuándo ocurrió lo que
 * acredita»** sobre un papel que lo dice en su primera línea.
 */
const HECHO =
  "inspection|survey|sampling|fumigation|analysis|examination|inspecci[óo]n|muestreo|fumigaci[óo]n|an[áa]lisis";
const NOMBRA_EL_HECHO = new RegExp(
  // el verbo: «INSPECTION CARRIED OUT AT MONTEVIDEO ON 07-APR»
  String.raw`\b(carried out|performed|conducted|effected|inspected|surveyed|examined|fumigated|analy[sz]ed|drawn|taken|realizad[oa]|efectuad[oa]|inspeccionad[oa])\b[^.;\n]{0,60}?\b(on|at|el|the)?\b` +
    // o el sustantivo con su etiqueta: «DATE OF INSPECTION:», «INSPECTION DATE», «FECHA DE MUESTREO»
    String.raw`|\b(?:date of|fecha de[l]?)\s+(?:${HECHO})\b\s*:?\s*` +
    String.raw`|\b(?:${HECHO})\s+(?:date|fecha)\b\s*:?\s*` +
    // o el sustantivo con su preposición: «INSPECTION ON 11-APR», «FUMIGACIÓN EL 7 DE ABRIL»
    String.raw`|\b(?:${HECHO})\b[^.;\n]{0,20}?\b(?:on|at|el)\b\s*`,
  "gi",
);

function fechaDelHecho(campos: CamposDoc): Date | null {
  const texto = val(campos.mercaderia) ?? "";
  if (!texto) return null;
  /*
   * La fecha del **hecho**, que es la que el papel nombra, no la primera que aparece.
   *
   * Un certificado imprime su propio número y fecha antes del cuerpo: «CERTIFICATE NO. 4471 DATED
   * 10-APR-2025. INSPECTION CARRIED OUT ON 07-APR-2025». Quedarse con la primera daba discrepancia
   * **y afirmaba en la evidencia que el hecho era del 10**, que es una afirmación falsa sobre el
   * papel. Y al revés, una fecha anterior suelta —la del crédito en el encabezado— lo daba por
   * bueno.
   *
   * Si el texto no nombra el hecho, no se elige ninguna: el veredicto vuelve a apoyarse en la
   * emisión, que es lo que el documento evidencia.
   */
  /*
   * La fecha tiene que estar en la misma oración que el hecho, y se miran todas las menciones.
   *
   * La ventana eran cuarenta caracteres secos y cruzaba el punto, así que «SAMPLES TAKEN. L/C DATED
   * 20-MAR. INSPECTION ON 11-APR» tomaba la fecha del crédito por la del hecho y daba por bueno un
   * certificado cuya inspección fue posterior al embarque. El punto es lo que separa una cosa de la
   * otra en un certificado, igual que la coma en un 45A.
   *
   * Y se recorren todas: la primera mención puede no traer fecha —«SAMPLES TAKEN.»— y quedarse en
   * ella es perder la que sí la trae.
   */
  for (const m of texto.matchAll(NOMBRA_EL_HECHO)) {
    const desde = texto.slice(m.index + m[0].length);
    const f = parseFecha((desde.split(/[.;\n]/)[0] ?? "").slice(0, 40));
    if (f) return f;
  }
  return null;
}

/** El peso que declara un documento, en kilos, si se puede leer. */
/**
 * El peso bruto en kilos, leyendo la unidad **pegada al número**.
 *
 * Antes la unidad se buscaba en todo el texto y con `\b(t|…)` sin cierre, así que «TOTAL GROSS
 * WEIGHT 54.040 KGS» multiplicaba por mil: la «T» de «TOTAL» alcanzaba. Cincuenta y cuatro
 * toneladas se volvían cincuenta y cuatro mil, y la nota de peso correcta salía discrepante contra
 * el packing. Lo mismo con «THE WEIGHT IS…» o con cualquier aclaración entre paréntesis.
 *
 * Así que se busca el primer par número-unidad y se usa esa unidad. Si el número viene sin unidad,
 * se toma como kilos, que es como lo escriben los documentos de granel.
 */
const PESO_CON_UNIDAD = /(\d[\d.,]*)\s*(kgs?|kilogramos?|kilos?|mts?|tons?|tonnes?|toneladas?|t)\b/i;

function pesoEnKg(campos: CamposDoc): number | null {
  const bruto = val(campos.pesoBruto);
  if (!bruto) return null;
  const m = PESO_CON_UNIDAD.exec(bruto);
  const n = parseNumero(m?.[1] ?? bruto);
  if (n === null) return null;
  const unidad = (m?.[2] ?? "").toLowerCase();
  return /^(mts?|tons?|tonnes?|toneladas?|t)$/.test(unidad) ? n * 1000 : n;
}

/* ─────────────────────────── las reglas ─────────────────────────── */

export function reglasCertificados(input: {
  lc: LcInfo;
  certificados: DocCertificado[];
  /** los documentos principales, para cotejar pesos y fechas contra ellos */
  docs: DocAnalizado[];
  beneficiario?: string | null;
  /** la descripción del campo 45A: de ahí sale la calidad que el crédito exige */
  mercaderiaDelCredito?: string | null;
  hoy: Date;
}): ReglaPresentacion[] {
  const out: ReglaPresentacion[] = [];
  const bl = input.docs.find((d) => d.tipo === "BL");
  const packing = input.docs.find((d) => d.tipo === "PACKING");
  const fechaEmbarque = val(bl?.campos.fechaEmbarque) ?? null;

  const pedidoEn = input.lc ? dondeSePideElNumeroLC(input.lc) : null;
  const mismoNumero = (x: string, y: string) =>
    x.replace(/[^A-Z0-9]/gi, "").toUpperCase() === y.replace(/[^A-Z0-9]/gi, "").toUpperCase();

  input.certificados.forEach((c, i) => {
    const nombre = c.nombreArchivo ?? corto(c.exigencia, 40);
    const sufijo = `${claveDoc(c.exigencia)}-${i}`;

    /*
     * El número del crédito también se mira acá, y acá es donde el banco lo encontró.
     *
     * La regla ya existía para los cuatro documentos con columna en la matriz. Pero un shipment
     * notice, una carta de presentación y los certificados de un tercero entran por `certificados`,
     * y salían sin que nadie les mirara el número: de las tres observaciones que un banco levantó
     * sobre una presentación real, **dos eran ésta**, y las dos sobre papeles que pasan por acá.
     *
     * La distinción entre omitirlo y citar otro es la misma que en `presentacion.ts`, y por eso el
     * «dónde lo pide el crédito» sale de la misma función: dos copias se separan.
     */
    const numeroCitado = val(c.campos.numeroLC);
    const numeroDelCredito = input.lc?.numero ?? "";
    if (numeroCitado && numeroDelCredito && !mismoNumero(numeroCitado, numeroDelCredito)) {
      out.push({
        id: `cert-lc-num-${sufijo}`,
        fuente: "UCP 600 14d",
        regla: `${nombre}: el número de LC que cita es el del crédito`,
        estado: "DISCREPANCIA",
        evidencia: `dice "${numeroCitado}" y el crédito es "${numeroDelCredito}"`,
      });
    } else if (pedidoEn) {
      out.push({
        id: `cert-lc-num-${sufijo}`,
        fuente: pedidoEn,
        regla: `${nombre}: cita el número de la LC`,
        /*
         * Que no se haya LEÍDO no es que el documento no lo TENGA.
         *
         * El número puede estar impreso chico, en una esquina o en una hoja que no se subió, y
         * dictaminar discrepancia sobre una falla de lectura es el falso positivo que este motor no
         * se permite: cuesta el fee, la demora y la confianza sobre un papel que estaba bien. Va a
         * que lo mire una persona, igual que la regla hermana de los documentos de la matriz.
         */
        estado: numeroCitado ? "OK" : "ATENCION",
        evidencia: numeroCitado
          ? `dice "${numeroCitado}"`
          : `el crédito lo pide en el campo ${pedidoEn} y no se leyó en el documento: verificar a mano`,
      });
    }

    /* quién lo emite (ISBP 821 Q3 a Q5, y L3 para el de origen) */
    const admitido = emisorAdmitido(c.exigencia);
    /*
     * De dónde sale quién emite, y de dónde NO.
     *
     * No del `exportador`: ese es quien embarca la mercadería, y en un certificado de tercero no
     * tiene nada que ver con quién lo firma. Cayendo ahí, el motor decía que el certificado de
     * origen de la Cámara Mercantil lo emitía el frigorífico, y lo decía en un examen que va al
     * banco. Sin el dato, la regla lo dice y manda a verificar: no saber es un estado válido,
     * afirmar mal no.
     */
    const emisor = val(c.campos.emisor) ?? val(c.campos.emisorSeguro);
    if (admitido === "EL_QUE_NOMBRA_EL_CREDITO") {
      const nombrado = emisorQueNombra(c.exigencia);
      if (nombrado) {
        /*
         * Qué se puede afirmar cuando el emisor no coincide con el nombre que el crédito escribió.
         *
         * Poco, y por una razón del mundo real: un organismo oficial casi nunca se llama como el
         * crédito lo describe. El crédito del expediente pide el sanitario «ISSUED BY
         * GOVT.VETERINERY AUTHORITY IN URUGUAY» y quien lo firma es el Ministerio de Ganadería,
         * Agricultura y Pesca, que no comparte una sola palabra con ese texto. Comparar literales y
         * declarar discrepancia rechazaba el certificado correcto: solo pasaba si el papel repetía
         * la abreviatura del crédito letra por letra, con su error de tipeo incluido.
         *
         * Así que lo que no coincide va a verificar, con los dos nombres a la vista. Lo que el
         * motor **sí** puede decidir es un caso, y ahí no hay nada que averiguar: que lo haya
         * emitido el propio beneficiario cuando el crédito nombra a un tercero.
         */
        const opciones = emisoresAdmitidos(nombrado);
        const distinto = !opciones.some((o) => comparaISBP(emisor ?? "", o) !== "DISTINTO");
        const porFuncion = describeUnaFuncion(nombrado);
        /*
         * Y si el crédito nombra al **beneficiario** como emisor, que lo emita él es lo pedido.
         *
         * «CERTIFICATE ISSUED BY BENEFICIARY CONFIRMING…» es redacción corriente del 46A, y la
         * rama de abajo —«lo emite el beneficiario y el crédito nombra a un tercero»— disparaba
         * sobre el documento correcto. No nombra a un tercero: lo nombra a él.
         */
        const esElBeneficiario =
          Boolean(emisor) && Boolean(input.beneficiario) && comparaISBP(emisor!, input.beneficiario!) !== "DISTINTO";
        const nombraAlBeneficiario = opciones.some(
          (o) =>
            /\bbeneficiar/i.test(o) || (input.beneficiario ? comparaISBP(o, input.beneficiario) !== "DISTINTO" : false),
        );
        const loEmiteElBeneficiario =
          distinto &&
          !nombraAlBeneficiario &&
          Boolean(emisor) &&
          Boolean(input.beneficiario) &&
          comparaISBP(emisor!, input.beneficiario!) !== "DISTINTO";
        out.push(
          emisor
            ? regla(
                `cert-emisor-${sufijo}`,
                "ISBP 821 Q3",
                `${nombre}: lo emite ${corto(nombrado, 40)}`,
                loEmiteElBeneficiario
                  ? "DISCREPANCIA"
                  : !distinto || (nombraAlBeneficiario && esElBeneficiario)
                    ? "OK"
                    : porFuncion
                      ? "ATENCION"
                      : "DISCREPANCIA",
                loEmiteElBeneficiario
                  ? `lo emite el beneficiario "${emisor}" y el crédito nombra a un tercero`
                  : !distinto
                    ? `el documento lo emite "${emisor}"`
                    : porFuncion
                      ? `el documento lo emite "${emisor}": verificar que sea el organismo que el crédito nombra`
                      : `el documento lo emite "${emisor}"`,
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
      /*
       * Lo que tiene que ser anterior es el **hecho**, no la emisión.
       *
       * El párrafo pide que el certificado acredite algo ocurrido antes del embarque, y un
       * certificado de inspección emitido el 10 por una inspección hecha el 7 lo cumple. Comparar
       * la fecha de emisión lo marcaba discrepante, que además es atribuirle a la cita algo que no
       * dice — y en este motor cada hallazgo tiene que poder ir a buscarse al texto.
       *
       * Si el documento declara cuándo ocurrió, se usa esa fecha: ahí el papel evidencia el
       * cumplimiento y no hay nada que discutir.
       *
       * Si **no** lo declara y se emitió después del embarque, el veredicto sigue siendo
       * discrepancia, y no por la fecha de emisión en sí: porque el documento no evidencia que el
       * hecho fuera previo, y un banco examina lo que el documento dice. La evidencia ahora explica
       * eso, para que el examinador pueda levantarla si tiene el dato en la mano. Afinar más esto
       * necesita el texto de la ISBP 821, que no está comprada: inventar la práctica bancaria que
       * falta sería peor que dejar el veredicto donde estaba.
       */
      const delHecho = fechaDelHecho(c.campos);
      // si declara cuándo ocurrió, manda esa fecha; si no, queda la de emisión
      const relevante = fd && fe && fd > fe ? (delHecho ?? fd) : fd;
      out.push(
        relevante && fe
          ? regla(
              `cert-previo-${sufijo}`,
              "ISBP 821 A12b",
              `${nombre}: acredita un hecho anterior al embarque`,
              relevante <= fe ? "OK" : "DISCREPANCIA",
              relevante !== fd
                ? `el hecho que acredita es del ${fmtFecha(relevante)} · embarque ${fechaEmbarque} (documento ${f})`
                : relevante <= fe
                  ? `documento ${f} · embarque ${fechaEmbarque}`
                  : `documento ${f} · embarque ${fechaEmbarque} — y no dice cuándo ocurrió lo que acredita`,
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

    /* la calidad que el crédito exige, contra la que el análisis certifica */
    if (claveDoc(c.exigencia) === "ANALISIS" && input.mercaderiaDelCredito) {
      /*
       * Lo que el certificado declara sale de sus campos, nunca de cómo se llama el documento.
       *
       * `nombreArchivo` estaba acá dentro, y la pantalla lo llena con la línea del 46A: con eso, un
       * crédito que pide «ANALYSIS CERTIFICATE SHOWING PROTEIN 54 PCT» y un examinador que todavía
       * no cargó la calidad daban CUMPLE sobre el número que escribió el banco emisor. El motor
       * leía la exigencia y la devolvía como resultado.
       */
      const texto = [val(c.campos.mercaderia), val(c.campos.numeroDoc)].filter(Boolean).join(" ");
      for (const [j, sp] of cotejarEspecificaciones(input.mercaderiaDelCredito, texto).entries()) {
        out.push(
          regla(
            `cert-spec-${sufijo}-${j}`,
            "45A",
            `${nombre}: ${sp.exigida.parametro || "la especificación"} que el crédito exige`,
            sp.veredicto === "CUMPLE" ? "OK" : sp.veredicto === "NO_CUMPLE" ? "DISCREPANCIA" : "ATENCION",
            sp.detalle,
          ),
        );
      }
    }

    /* un archivo que trae más de un documento adentro mezcla los campos de todos */
    const variosEn = pareceVariosDocumentos(val(c.campos.mercaderia) ?? "");
    if (variosEn.length > 1) {
      out.push(
        regla(
          `cert-varios-${sufijo}`,
          "ISBP 821 A24",
          `${nombre}: el archivo parece traer más de un documento`,
          "ATENCION",
          `se reconocieron: ${variosEn.join(" · ")} — conviene separarlos para que los campos no se mezclen`,
        ),
      );
    }

    /* el certificado de origen: que diga el origen que el crédito nombra */
    if (esCertificadoDeOrigen(c.exigencia)) {
      const pais = /certificate of\s+([a-z]+)\s+origin/i.exec(c.exigencia)?.[1];
      /*
       * El origen puede estar escrito en cualquiera de los campos del certificado.
       *
       * Antes el lugar tenía prioridad y tapaba al resto: un certificado que dice «COUNTRY OF
       * ORIGIN: URUGUAY» en su texto y «MONTEVIDEO» en el lugar salía a verificar **mostrando
       * «MONTEVIDEO»** como evidencia, o sea el campo equivocado. Se busca en los tres y la
       * evidencia cita el que lo trae, que es lo que la persona necesita leer.
       */
      const donde = [val(c.campos.mercaderia), val(c.campos.puertoEmbarque), val(c.campos.numeroDoc)].filter(
        Boolean,
      ) as string[];
      if (pais) {
        const loTrae = donde.find((x) => new RegExp(pais, "i").test(x));
        out.push(
          regla(
            `cert-origen-${sufijo}`,
            "46A",
            `${nombre}: indica origen ${pais.toUpperCase()}`,
            loTrae ? "OK" : "ATENCION",
            loTrae
              ? `el documento dice "${corto(loTrae)}"`
              : donde.length > 0
                ? `no se leyó el origen; el documento dice "${corto(donde.join(" · "))}": verificar a mano`
                : "no se leyó el origen: verificar a mano",
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
