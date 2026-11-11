import type { CamposDoc } from "./consistencia";

/**
 * De qué clase es el documento de transporte que se presentó.
 *
 * Las UCP 600 dedican siete artículos al transporte —del 19 al 25— y cada uno pide cosas distintas.
 * El motor examinaba todo con el artículo 20, el marítimo, porque era el único que conocía: a un
 * air waybill le pedía la anotación de a bordo, que un aéreo no tiene nunca, y no le pedía nada de
 * lo que el artículo 23 sí exige. Antes de aplicar una regla hay que saber cuál corresponde.
 *
 * La decisión se toma con lo que el papel dice de sí mismo, en este orden:
 *
 * 1. **La cláusula de fletamento**, si la hay y no es una negación. Un conocimiento sujeto a
 *    contrato de fletamento se examina con el artículo 22 aunque por lo demás sea marítimo, y el
 *    artículo 22 pide otra firma —capitán, armador o fletador— que el 20 no admite.
 * 2. **Cómo se titula**: «AIR WAYBILL», «SEA WAYBILL», «MULTIMODAL», «CMR». Es lo que mira un
 *    examinador primero y casi siempre alcanza.
 * 3. **La forma del número**: un air waybill lleva tres dígitos de aerolínea y ocho de serie.
 * 4. **El buque**: si hay nombre de buque y nada más dice otra cosa, es marítimo.
 *
 * Si nada de eso alcanza, se dice que no se pudo determinar. Suponer marítimo es exactamente lo que
 * el motor hacía antes, y es de donde venía el problema.
 */

export type ModoTransporte =
  | "MULTIMODAL"
  | "MARITIMO"
  | "SEA_WAYBILL"
  | "FLETAMENTO"
  | "AEREO"
  | "TERRESTRE"
  | "COURIER"
  | "SIN_DETERMINAR";

export interface ClaseDeTransporte {
  modo: ModoTransporte;
  /** en qué se basó, para poder discutirlo */
  porQue: string;
}

/** El artículo de las UCP 600 que gobierna cada clase de documento. */
export function articuloDelModo(modo: ModoTransporte): string {
  const art: Record<ModoTransporte, string> = {
    MULTIMODAL: "UCP 600 19",
    MARITIMO: "UCP 600 20",
    SEA_WAYBILL: "UCP 600 21",
    FLETAMENTO: "UCP 600 22",
    AEREO: "UCP 600 23",
    TERRESTRE: "UCP 600 24",
    COURIER: "UCP 600 25",
    SIN_DETERMINAR: "UCP 600 19 a 25",
  };
  return art[modo];
}

/**
 * El artículo con su inciso, para la fuente de un hallazgo.
 *
 * Existe para el caso de la clase sin determinar: ahí `articuloDelModo` devuelve un **rango** —«UCP
 * 600 19 a 25»— y pegarle el inciso daba «UCP 600 19 a 25a-iii», que no se lee. Un hallazgo que cita
 * su artículo mal escrito es un hallazgo que alguien tiene que ir a buscar a mano, y esa cadena
 * viaja en el aviso de rechazo del artículo 16 a otro banco.
 *
 * Con la clase sin determinar se devuelve el rango a secas: el inciso es el mismo en los siete
 * artículos, así que nombrarlo no agrega nada y decir «19 a 25» ya dice todo lo que se sabe.
 */
export function fuenteDelInciso(modo: ModoTransporte, inciso: string): string {
  const art = articuloDelModo(modo);
  return modo === "SIN_DETERMINAR" ? art : `${art}${inciso}`;
}

/** Cómo se llama cada clase, para decirlo en un hallazgo. */
export const NOMBRE_MODO: Record<ModoTransporte, string> = {
  MULTIMODAL: "documento de transporte multimodal",
  MARITIMO: "conocimiento de embarque marítimo",
  SEA_WAYBILL: "sea waybill no negociable",
  FLETAMENTO: "conocimiento sujeto a contrato de fletamento",
  AEREO: "documento de transporte aéreo",
  TERRESTRE: "documento de transporte por carretera, ferrocarril o vía navegable",
  COURIER: "recibo de courier o de correo",
  SIN_DETERMINAR: "documento de transporte de clase no determinada",
};

const texto = (c: CamposDoc, k: keyof CamposDoc): string => {
  const campo = c[k] as { valor?: string } | undefined;
  return (campo?.valor ?? "").trim();
};

/**
 * Una cláusula de fletamento que niega estarlo no es una cláusula de fletamento.
 *
 * Muchos conocimientos imprimen «not subject to any charter party» justamente para dejarlo claro.
 * Leerlo al revés manda el documento al artículo 22, que pide una firma distinta, y el examen
 * entero sale mal.
 */
function sujetoAFletamento(valor: string): boolean {
  if (!valor) return false;
  return !/\bno\b|\bnot\b|\bsin\b|\bnon\b/i.test(valor);
}

/**
 * La clase que **nombra** un texto: el título de un documento, o la línea del 46A que lo pide.
 *
 * Devuelve `null` cuando no nombra ninguna —«TRANSPORT DOCUMENT EVIDENCING DISPATCH»— o cuando ofrece
 * más de una —«BILL OF LADING OR AIR WAYBILL»—, que es un crédito que admite las dos.
 */
export function modoQueNombra(textoLibre: string): ModoTransporte | null {
  const t = textoLibre.toUpperCase();
  const clases: ModoTransporte[] = [];
  if (/MULTIMODAL|COMBINED TRANSPORT|INTERMODAL|THROUGH BILL/.test(t)) clases.push("MULTIMODAL");
  if (/AIR ?WAY ?BILL|\bAWB\b|AIR CONSIGNMENT|AIR TRANSPORT/.test(t)) clases.push("AEREO");
  if (/SEA ?WAY ?BILL|NON.?NEGOTIABLE SEA/.test(t)) clases.push("SEA_WAYBILL");
  if (
    /\bCMR\b|CONSIGNMENT NOTE|CARTA DE PORTE|\bRAIL|TRUCK|\bROAD ?WAY|INLAND WATERWAY/.test(
      t.replace(/AIR CONSIGNMENT NOTE/g, ""),
    )
  )
    clases.push("TERRESTRE");
  if (/COURIER|POST RECEIPT|CERTIFICATE OF POSTING|EXPRESS RECEIPT/.test(t)) clases.push("COURIER");
  if (/CHARTER[\s-]*PART/.test(t)) clases.push("FLETAMENTO");
  const sinLasOtras = t.replace(
    /MULTIMODAL[^,;]*BILLS? OF LADING|COMBINED TRANSPORT[^,;]*BILLS? OF LADING|CHARTER[\s-]*PARTY BILLS?(?:\(S\))? OF LADING/g,
    "",
  );
  if (/BILLS?(?:\(S\))? OF LADING|\bB\/LS?\b|CONOCIMIENTO/.test(sinLasOtras)) clases.push("MARITIMO");
  return clases.length === 1 ? clases[0]! : null;
}

export function modoDelDocumento(campos: CamposDoc): ClaseDeTransporte {
  const charter = texto(campos, "charterParty");
  if (sujetoAFletamento(charter)) {
    return { modo: "FLETAMENTO", porQue: `el documento dice «${charter.slice(0, 60)}»` };
  }

  const titulo = texto(campos, "tipoTransporte");
  const t = titulo.toUpperCase();
  if (t) {
    // El orden importa: «COMBINED TRANSPORT BILL OF LADING» es multimodal, no marítimo, así que lo
    // que nombra dos modos se decide antes de mirar si dice «bill of lading».
    if (/MULTIMODAL|COMBINED TRANSPORT|INTERMODAL|THROUGH BILL/.test(t))
      return { modo: "MULTIMODAL", porQue: `se titula «${titulo}»` };
    if (/AIR ?WAY ?BILL|\bAWB\b|AIR CONSIGNMENT|AIR TRANSPORT/.test(t))
      return { modo: "AEREO", porQue: `se titula «${titulo}»` };
    if (/SEA ?WAY ?BILL|NON.?NEGOTIABLE SEA/.test(t)) return { modo: "SEA_WAYBILL", porQue: `se titula «${titulo}»` };
    if (/\bCMR\b|CONSIGNMENT NOTE|CARTA DE PORTE|RAIL|TRUCK|ROAD|WAYBILL RAIL|INLAND WATERWAY/.test(t))
      return { modo: "TERRESTRE", porQue: `se titula «${titulo}»` };
    if (/COURIER|POST RECEIPT|CERTIFICATE OF POSTING|EXPRESS RECEIPT/.test(t))
      return { modo: "COURIER", porQue: `se titula «${titulo}»` };
    if (/BILL OF LADING|CONOCIMIENTO/.test(t)) return { modo: "MARITIMO", porQue: `se titula «${titulo}»` };
  }

  // Un air waybill se numera con tres dígitos de aerolínea y ocho de serie: «020-12345678».
  const numero = texto(campos, "numeroDoc");
  if (/^\d{3}[\s-]?\d{8}$/.test(numero.replace(/\s/g, " ").trim())) {
    return { modo: "AEREO", porQue: `el número «${numero}» tiene la forma de un air waybill` };
  }

  const buque = texto(campos, "buque");
  if (buque) return { modo: "MARITIMO", porQue: `nombra un buque, «${buque}»` };

  // Los lugares también hablan: un aéreo sale de un aeropuerto y un marítimo de un puerto.
  const lugares = `${texto(campos, "puertoEmbarque")} ${texto(campos, "puertoDestino")}`.trim();
  if (/AIRPORT|AEROPUERTO|\bAPT\b/i.test(lugares)) {
    return { modo: "AEREO", porQue: `los lugares son aeropuertos: «${lugares.slice(0, 60)}»` };
  }
  if (/\bPORT\b|PUERTO/i.test(lugares)) {
    return { modo: "MARITIMO", porQue: `los lugares son puertos: «${lugares.slice(0, 60)}»` };
  }

  return {
    modo: "SIN_DETERMINAR",
    porQue: "no se pudo determinar de qué clase es: no se leyó cómo se titula, ni un buque, ni los lugares",
  };
}

/* ──────── qué buque nombra la anotación de a bordo (inciso (a) (ii)) ──────── */

/**
 * Si la anotación de a bordo nombra al buque que salió del puerto de carga, o a otro.
 *
 * **El par de Opiniones que obliga a mirar esto es de los más finos que hay.** Las dos tienen la
 * misma forma en la superficie —un conocimiento con pre-acarreo, y una anotación que nombra un
 * buque— y veredictos opuestos:
 *
 * - **R 350 / R 457 / Doc. 470/1128 rev final: la discrepancia ES válida.** Con el buque oceánico
 *   «EVER DELUXE» y la casilla preimpresa «Laden on board» diciendo «JUL.16, 2013 UNI-PROMOTE 198B
 *   HOCHIMINH CITY, VIETNAM», el rechazo del emisor valía: *«It should be understood that the named
 *   vessel is the vessel that leaves the port of loading and not any vessel which may appear in the
 *   pre-carriage box.»*
 * - **TA 743rev: NO es discrepancia.** Con el buque oceánico «Vessel L» y la anotación «SHIPPED ON
 *   BOARD VESSEL N AT SIBU, MALAYSIA ON 18.11.2010 FOR TRANSHIPMENT VIA BINTULU ON VESSEL L», el
 *   rechazo no valía: *«the wording of the notation provides the applicable interpretation of the
 *   data appearing in the respective bill of lading fields.»*
 *
 * Lo que separa a las dos es **si la anotación da cuenta del buque oceánico**. En TA 743rev lo
 * nombra —explica el trasbordo y termina en Vessel L—; en R 350 la casilla nombra solo el buque de
 * pre-acarreo. Eso sí es mecánico, y es lo único de las dos que se puede automatizar.
 *
 * Tres decisiones, y las tres son para no rechazar lo conforme:
 *
 * - **Si la anotación nombra al buque oceánico, cumple.** Es la afirmación que el motor no hacía.
 * - **Si no lo nombra pero tampoco nombra nada más, no se dice nada.** «SHIPPED ON BOARD
 *   20-AUG-2026» es la anotación corriente y no tiene por qué repetir el buque: el documento ya lo
 *   trae en su casillero. Emitir algo acá sería ruido en casi todos los conocimientos.
 * - **Si nombra algo que no es el buque oceánico ni el puerto de carga, se dice y no se concluye.**
 *   Ahí está la frontera entre las dos Opiniones, y lo que sobra podría ser un puerto de trasbordo,
 *   una terminal o un muelle en vez de otro buque. Afirmar que es un buque de pre-acarreo sería
 *   afirmar más de lo que el dato sostiene.
 */
export interface BuqueDeLaAnotacion {
  /** la anotación nombra al buque que el documento declara como oceánico */
  nombraAlBuque: boolean;
  /** lo que la anotación nombra y no es el buque ni el puerto de carga ni su fecha */
  sobra: string[];
  /**
   * Lo que sobra viene **marcado como un buque**: «MV W», «M/V W», «SS W», «VESSEL W».
   *
   * Es el discriminador que la Opinión **TA 858rev** permitió usar. El motor avisaba y no concluía
   * porque lo que sobra en una anotación puede ser un puerto de trasbordo o una terminal, y no se puede
   * distinguir de un buque. Pero cuando el papel **lo marca** —«SHIPPED ON BOARD MV [VESSEL W]
   * 04.05.2016 FROM PORT H», que es la anotación de ese expediente— ya no hay ambigüedad: es un buque, y
   * no es el que el documento declara como oceánico.
   *
   *   «UCP 500, and now UCP 600, only requires evidence of the name of the vessel that is leaving the
   *   port of loading stated in the credit […] for the port of discharge.» — CONCLUSION: «Yes, the
   *   refusal is valid. The bill of lading requires a dated on board notation indicating vessel O and
   *   Port H.»
   *
   * La Opinión además contesta la objeción que el banco presentador había puesto: *«ICC Opinions R350
   * and R352 still apply under UCP 600»*.
   */
  sobraUnBuque: boolean;
}

/* Las palabras con las que se redacta una anotación de a bordo, que no nombran nada. */
const PALABRAS_DE_LA_ANOTACION = new Set([
  "SHIPPED",
  "LADEN",
  "LOADED",
  "CLEAN",
  "ON",
  "BOARD",
  "THE",
  "VESSEL",
  "SHIP",
  "AT",
  "IN",
  "OF",
  "AND",
  "FOR",
  "VIA",
  "TO",
  "FROM",
  "DATE",
  "DATED",
  "PORT",
  "CITY",
  "TRANSHIPMENT",
  "TRANSSHIPMENT",
  "EMBARCADO",
  "BORDO",
  "BUQUE",
  "PUERTO",
  "FECHA",
  "MV",
  "SS",
  "MS",
  /*
   * Y las palabras del **casillero** que la leyenda preimpresa nombra, que no son un buque.
   *
   * «SHIPPED AT THE PORT OF LOADING ON BOARD THE VESSEL» es la leyenda preimpresa de cualquier
   * conocimiento —es la que la Opinión **R 472** transcribe— y «LOADING» no estaba en esta lista, así
   * que el aviso del buque de pre-acarreo gritaba sobre ella: pedía verificar si «LOADING» era el
   * buque que salió del puerto de carga. Un aviso que grita sobre la redacción más corriente que hay
   * enseña a ignorar los avisos, que es lo que ya había pasado con «GOODS» en el laudo DOCDEX 259.
   */
  "LOADING",
  "DISCHARGE",
  "DESTINATION",
  "CARGA",
  "DESCARGA",
  "DESTINO",
  /*
   * Y las palabras que nombran **la carga** y no un buque ni un lugar.
   *
   * «GOODS ON BOARD - 7 LUG. 2005» es la anotación del conocimiento del laudo DOCDEX 259, y sin
   * «GOODS» en esta lista el motor la leía como una anotación que nombra algo que no es el buque: salía
   * un aviso pidiendo verificar si era un buque de pre-acarreo, sobre la redacción más corriente que
   * hay. Un aviso que grita sobre casos buenos enseña a ignorar los avisos.
   */
  "GOODS",
  "CARGO",
  "CARGA",
  "MERCADERIA",
  "CONTAINER",
  "CONTAINERS",
]);

/* Los meses, que son parte de la fecha y no nombran nada. */
const MESES_DE_LA_ANOTACION =
  /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC|ENE|ABR|AGO|DIC|ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)$/;

const palabras = (texto: string): string[] =>
  texto
    .toUpperCase()
    .split(/[^A-Z0-9/-]+/)
    .map((x) => x.replace(/^[-/]+|[-/]+$/g, ""))
    .filter(Boolean);

export function buqueDeLaAnotacion(
  anotacion: string,
  buque: string,
  puertoDeCarga: string | null | undefined,
): BuqueDeLaAnotacion {
  const texto = anotacion.toUpperCase();
  const nombre = buque.toUpperCase().trim();
  /*
   * Nombrarlo entero o nombrar todas sus palabras distintivas vale igual: una anotación puede
   * escribir «M/V EVER DELUXE» donde el casillero dice «EVER DELUXE 0689-106E».
   */
  const distintivasDelBuque = palabras(nombre).filter((w) => w.length > 3 && !/\d/.test(w));
  const nombraAlBuque =
    (nombre.length > 1 && texto.includes(nombre)) ||
    (distintivasDelBuque.length > 0 && distintivasDelBuque.every((w) => texto.includes(w)));

  const delPuerto = new Set(palabras(puertoDeCarga ?? ""));
  const sobra = palabras(texto).filter(
    (w) =>
      w.length > 3 &&
      !/\d/.test(w) &&
      !PALABRAS_DE_LA_ANOTACION.has(w) &&
      !MESES_DE_LA_ANOTACION.test(w) &&
      !delPuerto.has(w) &&
      !distintivasDelBuque.includes(w),
  );
  /*
   * Y si el papel marca lo que sobra como un buque, no hay nada que verificar: ver `sobraUnBuque`.
   *
   * El marcador tiene que estar **antes** de lo que sobra, que es como se escribe un nombre de buque:
   * «MV ALGO». Un «VESSEL» suelto en medio de la frase no alcanza — la propia lista de palabras de la
   * anotación lo trae, porque «on board the vessel» es redacción corriente.
   */
  const marcado = sobra.some((w) =>
    new RegExp(`\\b(?:M[\\s./]?V|M[\\s./]?S|S[\\s./]?S|VESSEL|VSL)[\\s./]+(?:THE[\\s]+)?${w}\\b`).test(texto),
  );
  return { nombraAlBuque, sobra: [...new Set(sobra)], sobraUnBuque: marcado && !nombraAlBuque };
}

/* ──────────────── quién puede firmar, que depende de la clase (inciso (a) (i)) ──────────────── */

/**
 * Las capacidades con las que se puede firmar un documento de transporte.
 *
 * No son intercambiables y ahí está todo el asunto: **el artículo 22 admite capitán, armador o
 * fletador y no admite al transportista**, mientras el 20 admite transportista o capitán y no admite
 * al armador ni al fletador. Un examinador acostumbrado al marítimo firma el error en la misma
 * dirección de siempre.
 */
export type CapacidadFirma = "TRANSPORTISTA" | "CAPITAN" | "ARMADOR" | "FLETADOR" | "COURIER";

export const NOMBRE_CAPACIDAD: Record<CapacidadFirma, string> = {
  TRANSPORTISTA: "el transportista",
  CAPITAN: "el capitán",
  ARMADOR: "el armador",
  FLETADOR: "el fletador",
  COURIER: "el servicio de courier",
};

/** Qué capacidades admite el inciso (a) (i) del artículo de cada clase. */
export function capacidadesAdmitidas(modo: ModoTransporte): CapacidadFirma[] {
  switch (modo) {
    /* 22 (a) (i): capitán, armador o fletador — y NO el transportista. */
    case "FLETAMENTO":
      return ["CAPITAN", "ARMADOR", "FLETADOR"];
    /* 25 (a) (i): firmado o sellado por el servicio de courier. */
    case "COURIER":
      return ["COURIER"];
    /* 19, 20, 21, 23 y 24 (a) (i): el transportista o el capitán. */
    default:
      return ["TRANSPORTISTA", "CAPITAN"];
  }
}

/**
 * Qué dice el bloque de firma sobre con qué capacidad se firmó.
 *
 * **Se ancla en la frase de la firma y no en cualquier mención.** Es la trampa del caso que dio
 * origen a esto: un conocimiento de fletamento firmado *«xxx as agent for and on behalf of the
 * carrier Dampskibsselskabet Norden A/S Captain: Capt Mabe T. Benagua»* nombra un capitán, y la
 * capacidad declarada igual es «agente del transportista» — que el artículo 22 no admite. Buscar
 * «captain» en todo el texto lo habría dado por bueno, y es exactamente el error que la Opinión
 * R834 corrige: el nombre de un capitán no salva la firma.
 *
 * Por eso la capacidad tiene que venir detrás de «as», de «for» o de «on behalf of», que es cómo se
 * declara una capacidad en un documento de transporte.
 */
export interface FirmaDeTransporte {
  /** La capacidad que el papel declara, o `null` si no se reconoce ninguna. */
  capacidad: CapacidadFirma | null;
  /** Firma un agente por cuenta de otro. No cambia el veredicto: el artículo admite al agente nombrado. */
  porAgente: boolean;
  /**
   * El bloque declara **más de una** capacidad, así que no se sabe en cuál firma.
   *
   * La Opinión **R 354** es el caso: un conocimiento preimpreso con «Signed **for the master/for the
   * carrier** as agents», firmado por un agente nombrado. *«The bill of lading presented would seem to
   * indicate that the agent signing the bill of lading **should have deleted either "for the master" or
   * "for the carrier". With the document displaying both parties, the capacity in which the agent is
   * signing is unclear**»*, y el panel concluye que el documento no cumple el artículo.
   *
   * Medido antes de arreglarlo: `leerFirma` devolvía **TRANSPORTISTA** —elegía la primera de la lista—
   * y como el artículo admite las dos, la regla salía en **OK**. O sea el motor aprobaba un bloque que
   * el panel declara ambiguo.
   */
  ambigua?: boolean;
}

export function leerFirma(texto: string): FirmaDeTransporte {
  const t = texto.toUpperCase();
  const porAgente = /\bAGENTS?\b|\bON BEHALF OF\b|\bAS AGENT\b/.test(t);
  /*
   * El orden de las alternativas no decide nada —cada una busca una palabra distinta— pero el
   * anclaje sí: `AS`, `FOR` y `ON BEHALF OF` delante, con lo que puede haber en el medio acotado a
   * las palabras de relleno que estas frases usan («as agent for the carrier», «for and on behalf
   * of the master»). Sin ese tope, un `.*` llegaría hasta cualquier mención suelta del otro lado
   * del texto y volvería a dar por buena la firma de R834.
   */
  const RELLENO = "(?:THE|A|AN|AND|OR|ITS|AGENTS?|AS|FOR|ON|BEHALF|OF|DULY|AUTHORI[SZ]ED|SIGNATORY)";
  /*
   * **Y un «successive carrier» es un transportista para esto (Opinión R 466).**
   *
   * Un CMR trae dos casillas, «Carrier» (16) y «Successive carriers» (17), y la firma va en la 23. El
   * motor leía «AS SUCCESSIVE CARRIER» **sin capacidad reconocida** —«SUCCESSIVE» no es palabra de
   * relleno— así que salía en ATENCION sobre una firma que el panel acepta:
   *
   * > A CMR that provides details of transport companies or organizations within boxes designated as
   * > "Carrier" and "Successive carriers" **would not be seen as being inconsistent with the
   * > requirements of sub-Article 28(a)(i)** … **The signature of the "carrier" or the "successive
   * > carrier" or a named agent signing on either of their behalf(s) would be acceptable.**
   *
   * Va en la alternativa de la capacidad y no en el relleno a propósito: «successive» es una palabra
   * con significado y meterla entre las de relleno haría que «as successive master» parseara.
   */
  const TRANSPORTISTA = "(?:SUCCESSIVE\\s+)?CARRIERS?";
  /*
   * Y **«SIGNED BY THE MASTER» también declara una capacidad**, que es la redacción de medio
   * fletamento.
   *
   * El ancla admitía `AS`, `FOR` y `ON BEHALF OF`, así que un bloque que dice «SIGNED BY THE MASTER OF
   * THE VESSEL X» salía **sin capacidad reconocida**: ATENCION sobre una firma que el artículo 22
   * admite sin discusión. Lo encontró el laudo **DOCDEX 247**, donde el panel razona con esa misma
   * redacción —*«is signed by the master of that named vessel with additional means of authentication
   * provided by the seal of the vessel and the name of the master»*— y declara el documento aceptable.
   *
   * **No afloja el anclaje que R 834 / TA 793rev obliga a tener**, y por eso entra como una cuarta
   * forma de anclar y no como una mención suelta: «SIGNED BY» es el verbo que *atribuye* la firma, no
   * una mención del otro lado del texto. El bloque de R 834 —«ROH as agent on behalf of HAP, the
   * Carrier» con el nombre de un capitán al lado— sigue saliendo como agente del transportista,
   * porque ahí no hay ningún «signed by the master».
   */
  const ancla = (palabras: string) =>
    new RegExp(
      `\\b(?:AS|FOR|ON BEHALF OF|SIGNED BY|FIRMADO POR)\\b(?:\\s+${RELLENO}\\b){0,6}\\s+(?:${palabras})\\b`,
    ).test(t);

  /*
   * **Y la capacidad también puede venir de la casilla preimpresa, que es la sexta forma de atribuir
   * una firma (Opinión R 472).**
   *
   * Las cinco anteriores van **delante** —«as», «for», «on behalf of», «signed by», «firmado por»— y
   * esta va **detrás**, en posesivo: el conocimiento trae la casilla rotulada «master's signature» y
   * dentro una firma sobre el sello del buque. El bloque salía **sin capacidad reconocida**, o sea
   * ATENCION sobre una firma que el panel acepta sin discusión:
   *
   * > The query states that the B/L had a pre-printed statement "master's signature" and this box had
   * > the ships stamp placed therein and a signature. **In the absence of any other details this
   * > signature would be accepted as that of the master. There is no discrepancy.**
   *
   * Y es la misma forma que el rótulo de la casilla 23 de un CMR, «Signature of carrier», que la
   * Opinión **R 466** usa para decidir quién puede firmarla.
   *
   * **El anclaje sigue siendo lo que lo hace seguro**, igual que con las otras cinco: la palabra de la
   * capacidad tiene que estar **pegada a «signature»**, no mencionada en cualquier parte. El bloque de
   * R 834 / TA 793rev —«ROH as agent on behalf of HAP, the Carrier», con el nombre de un capitán al
   * lado— no trae ninguna casilla de firma del capitán, así que sigue saliendo como agente del
   * transportista.
   *
   * **Lo que el motor no puede distinguir queda declarado:** una casilla preimpresa está en el papel
   * esté firmada o no, y acá lo que se lee es un campo de texto que transcribió una persona. Que cada
   * documento esté efectivamente firmado ya es una verificación manual (`firma-autenticacion`), que es
   * donde corresponde — el artículo 3 habla de una marca física.
   */
  const casilla = (palabras: string) =>
    new RegExp(
      `\\b(?:${palabras})(?:'|\u2019)?S?\\s+SIGNATURE\\b|\\bSIGNATURE\\s+OF\\s+(?:THE\\s+)?(?:${palabras})\\b`,
    ).test(t);

  const cap = (palabras: string) => ancla(palabras) || casilla(palabras);

  /*
   * **Dos capacidades a la vez no se eligen: se dicen (Opinión R 354).**
   *
   * El orden de las pruebas de abajo existe para decidir cuál capacidad declara el bloque, y con un
   * preimpreso que dice «for the master/for the carrier» elegir la primera es inventar una respuesta.
   * Acá se cuenta cuántas de las cinco declara, y con más de una la firma sale **ambigua**.
   *
   * **Sale ambigua y no discrepante, y el motivo es del dato y no prudencia genérica:** el propio panel
   * dice que lo correcto era **tachar una** de las dos, y una tachadura es exactamente lo que un campo
   * de texto transcrito por una persona no puede representar. El motor no puede saber si el papel que
   * tiene delante traía una tachada, así que pone las dos a la vista — que es la misma decisión que con
   * una capacidad que no se reconoce.
   */
  const declaradas = [
    cap(TRANSPORTISTA) && "TRANSPORTISTA",
    cap("MASTER|MASTERS|CAPTAIN|CAPT") && "CAPITAN",
    cap("OWNER|OWNERS|SHIPOWNER|SHIPOWNERS") && "ARMADOR",
    cap("CHARTERER|CHARTERERS") && "FLETADOR",
    cap("COURIER|COURIER SERVICE") && "COURIER",
  ].filter(Boolean);
  if (declaradas.length > 1) return { capacidad: null, porAgente, ambigua: true };

  if (cap(TRANSPORTISTA)) return { capacidad: "TRANSPORTISTA", porAgente };
  /*
   * «CAPT.» cuenta como capitán, que lo decidió el laudo DOCDEX 284.
   *
   * El fletamento del laudo —<https://library.iccwbo.org/content/tfb/DOCDEX/284.htm>, USD 5,9
   * millones— está firmado «FOR AND/OR ON BEHALF OF CAPT. P / MASTER OF VESSEL D / FOR COMPANY S / AS
   * AGENTS», y el panel declaró el rechazo inválido por unanimidad. El propio párrafo 118 de la ISBP
   * que el laudo transcribe admite las dos palabras: *«the signature of the master (captain) … must be
   * identified as "master" ("captain")»*, y «CAPT.» es como lo abrevia todo el mundo.
   *
   * Sin la abreviatura el ancla se rompía en «CAPT» —que no es palabra de relleno— y la firma salía
   * sin capacidad reconocida: ATENCION en vez de OK. No era un falso positivo, pero era el motor sin
   * concluir sobre una firma que el laudo da por buena sin discusión.
   */
  if (cap("MASTER|MASTERS|CAPTAIN|CAPT")) return { capacidad: "CAPITAN", porAgente };
  if (cap("OWNER|OWNERS|SHIPOWNER|SHIPOWNERS")) return { capacidad: "ARMADOR", porAgente };
  if (cap("CHARTERER|CHARTERERS")) return { capacidad: "FLETADOR", porAgente };
  if (cap("COURIER|COURIER SERVICE")) return { capacidad: "COURIER", porAgente };
  return { capacidad: null, porAgente };
}
