import type { DestinoDocumentos } from "./checking-list";

/**
 * El aviso de rechazo como mensaje SWIFT MT734.
 *
 * El artículo 16 (d) pide que el aviso se curse «por telecomunicación». El texto que redacta
 * `avisoDeRechazo` se pega en un correo y cumple, pero entre bancos el canal es SWIFT y el mensaje
 * del rechazo es el MT734, que no es texto libre: tiene campos con largos propios y un juego de
 * caracteres propio. Lo que no entra no se transmite, y una discrepancia que no se transmitió es
 * una discrepancia que el banco no invocó — con el efecto del 16 (f), que le hace perder el derecho
 * a alegarla. Por eso acá nada se corta en silencio: si algo no entra, se dice.
 *
 * La estructura es la del estándar (SRU 2025), verificada contra la implementación generada de
 * Prowide (`prowide-core`, Apache 2.0):
 *
 *     20   (M)  16x                   referencia propia
 *     21   (M)  16x                   referencia del banco presentador
 *     32A  (M)  6!n3!a15d             fecha, moneda e importe de la utilización
 *     73A  (O)  35z × 6               gastos reclamados
 *     33A/B(O)                        importe total reclamado
 *     57a  (O)                        banco donde se acredita
 *     72Z  (O)  35z × 6               información al destinatario
 *     77J  (M)  50z × 70              LAS DISCREPANCIAS
 *     77B  (M)  35x × 3               qué se hace con los documentos
 *
 * El contenido de los dos campos obligatorios que importan lo manda el artículo 16 (c): en el 77J,
 * **cada** discrepancia por la que se rechaza; en el 77B, cuál de las cuatro disposiciones del
 * 16 (c) (iii) se aplica.
 *
 * Lo que este módulo **no** hace: los códigos con barras que el estándar define para el 77B
 * (`/HOLD/` y similares) no se pudieron verificar contra una fuente pública —están en la
 * documentación de pago de SWIFT— así que el campo lleva el texto del artículo, recortado a los
 * largos del campo. Un banco que tenga el manual va a querer revisarlo antes de cursarlo.
 */

export interface DatosMT734 {
  /** campo 20 */
  referenciaPropia: string;
  /** campo 21; vacío se transmite como NONREF */
  referenciaPresentador: string;
  /** campo 32A */
  fechaUtilizacion: Date;
  moneda: string;
  monto: number;
  /** campo 77J: cada discrepancia por la que se rechaza (art. 16 c ii) */
  discrepancias: string[];
  /** campo 77B: cuál de las cuatro disposiciones del art. 16 (c) (iii) */
  destino: DestinoDocumentos;
  /** campo 73A */
  gastos?: string[];
  /** campo 72Z */
  informacion?: string[];
}

export interface MensajeMT734 {
  /** el mensaje, o "" si no había nada que rechazar */
  texto: string;
  /** lo que hubo que recortar, reemplazar o dejar afuera */
  avisos: string[];
}

const MAX_77J_LINEAS = 70;
const MAX_77J_LARGO = 50;
const MAX_77B_LINEAS = 3;
const MAX_77B_LARGO = 35;

/**
 * El 77B en tres líneas de treinta y cinco.
 *
 * El texto del artículo no entra —el del 16 (c) (iii) (b) tiene más de doscientos caracteres— así
 * que cada disposición se dice en la forma más corta que conserve cuál de las cuatro es. Perder
 * *cuál* es sería perder el aviso: el 16 (c) exige decirlo.
 */
const TEXTO_77B: Record<DestinoDocumentos, string[]> = {
  RETIENE_ESPERANDO_INSTRUCCIONES: ["WE ARE HOLDING THE DOCUMENTS", "PENDING YOUR FURTHER INSTRUCTIONS"],
  RETIENE_ESPERANDO_DISPENSA: [
    "WE ARE HOLDING THE DOCUMENTS UNTIL",
    "WE RECEIVE A WAIVER FROM THE",
    "APPLICANT OR YOUR INSTRUCTIONS",
  ],
  DEVUELVE: ["WE ARE RETURNING THE DOCUMENTS", "TO YOU"],
  SEGUN_INSTRUCCIONES_PREVIAS: ["WE ARE ACTING UNDER INSTRUCTIONS", "PREVIOUSLY RECEIVED FROM YOU"],
};

/**
 * El juego de caracteres X de SWIFT.
 *
 * Un carácter fuera de este conjunto hace que la red rechace el mensaje. El aviso va en inglés, así
 * que no debería aparecer ninguno; pero el nombre de una empresa o un puerto puede traer una eñe o
 * una tilde, y el texto de una discrepancia puede traer comillas angulares o una raya. Se
 * reemplazan por el equivalente más cercano y se avisa: un mensaje que rebota en la red es un aviso
 * que no llegó, y el plazo del 16 (d) sigue corriendo igual.
 */
const PERMITIDOS = /^[A-Za-z0-9/\-?:().,'+ ]*$/;

const EQUIVALENTES: [RegExp, string][] = [
  [/[áàäâã]/g, "a"],
  [/[éèëê]/g, "e"],
  [/[íìïî]/g, "i"],
  [/[óòöôõ]/g, "o"],
  [/[úùüû]/g, "u"],
  [/[ÁÀÄÂÃ]/g, "A"],
  [/[ÉÈËÊ]/g, "E"],
  [/[ÍÌÏÎ]/g, "I"],
  [/[ÓÒÖÔÕ]/g, "O"],
  [/[ÚÙÜÛ]/g, "U"],
  [/ñ/g, "n"],
  [/Ñ/g, "N"],
  [/ç/g, "c"],
  [/Ç/g, "C"],
  [/[«»""]/g, "'"],
  [/['']/g, "'"],
  [/[—–]/g, "-"],
  [/[…]/g, "..."],
  [/[%]/g, " PCT"],
  [/[&]/g, " AND "],
];

function aJuegoSwift(texto: string): { texto: string; hubeQueCambiar: boolean } {
  let salida = texto;
  for (const [re, con] of EQUIVALENTES) salida = salida.replace(re, con);
  // Lo que siga sin ser admitido no se puede adivinar: va como espacio, que es inocuo.
  salida = salida.replace(/./g, (ch) => (PERMITIDOS.test(ch) ? ch : " "));
  return { texto: salida.replace(/ {2,}/g, " ").trim(), hubeQueCambiar: salida !== texto };
}

/** Corta un texto en líneas de a lo sumo `ancho`, sin partir palabras cuando se puede. */
function envolver(texto: string, ancho: number): string[] {
  const out: string[] = [];
  for (const parrafo of texto.split("\n")) {
    let linea = "";
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      if (palabra.length > ancho) {
        // Una palabra más larga que el campo se parte: no hay otra forma de que entre.
        if (linea) {
          out.push(linea);
          linea = "";
        }
        for (let i = 0; i < palabra.length; i += ancho) out.push(palabra.slice(i, i + ancho));
        continue;
      }
      if (!linea) linea = palabra;
      else if (linea.length + 1 + palabra.length <= ancho) linea += ` ${palabra}`;
      else {
        out.push(linea);
        linea = palabra;
      }
    }
    if (linea) out.push(linea);
  }
  return out;
}

const yymmdd = (d: Date) =>
  `${String(d.getFullYear() % 100).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

/**
 * El importe como lo escribe SWIFT.
 *
 * Coma decimal —siempre, aun sin decimales: «51262,»— y sin separador de miles. Un punto en lugar
 * de la coma hace que el mensaje rebote.
 */
function importeSwift(n: number): string {
  const [entero, decimales = ""] = n.toFixed(2).split(".");
  return `${entero},${decimales.replace(/0+$/, "")}`;
}

export function mt734(d: DatosMT734): MensajeMT734 {
  const avisos: string[] = [];
  if (d.discrepancias.length === 0) return { texto: "", avisos: [] };

  let hubeQueCambiar = false;
  const limpiar = (s: string) => {
    const r = aJuegoSwift(s);
    hubeQueCambiar = hubeQueCambiar || r.hubeQueCambiar;
    return r.texto;
  };

  const L: string[] = [];
  const campo = (tag: string, lineas: string[]) => {
    if (lineas.length === 0) return;
    L.push(`:${tag}:${lineas[0]}`);
    for (const extra of lineas.slice(1)) L.push(extra);
  };

  const ref = limpiar(d.referenciaPropia).slice(0, 16);
  const refPresentador = limpiar(d.referenciaPresentador).slice(0, 16) || "NONREF";
  if (d.referenciaPropia.length > 16) avisos.push(`La referencia propia se recortó a 16 caracteres: «${ref}».`);

  campo("20", [ref]);
  campo("21", [refPresentador]);
  campo("32A", [`${yymmdd(d.fechaUtilizacion)}${d.moneda.toUpperCase().slice(0, 3)}${importeSwift(d.monto)}`]);
  if (d.gastos?.length) campo("73A", envolver(limpiar(d.gastos.join("\n")), 35).slice(0, 6));
  if (d.informacion?.length) campo("72Z", envolver(limpiar(d.informacion.join("\n")), 35).slice(0, 6));

  /*
   * Las discrepancias, numeradas.
   *
   * Van numeradas porque el 16 (c) (ii) exige «cada» discrepancia y el destinatario tiene que poder
   * contarlas: sobre un texto corrido de cincuenta columnas no se ve dónde termina una y empieza
   * la otra.
   */
  const cuerpo = d.discrepancias.map((x, i) => `${i + 1}. ${limpiar(x)}`).join("\n");
  const lineas77J = envolver(cuerpo, MAX_77J_LARGO);
  if (lineas77J.length > MAX_77J_LINEAS) {
    const afuera = lineas77J.length - MAX_77J_LINEAS;
    avisos.push(
      `Las discrepancias no entran en el campo 77J: sobran ${afuera} líneas de las ${lineas77J.length} necesarias ` +
        `(el campo admite ${MAX_77J_LINEAS}). Hay que acortarlas o cursar el aviso por otra vía — una discrepancia ` +
        `que no se transmite es una discrepancia que no se invocó (UCP 600 art. 16 f).`,
    );
  }
  campo("77J", lineas77J.slice(0, MAX_77J_LINEAS));
  campo("77B", TEXTO_77B[d.destino].map((x) => x.slice(0, MAX_77B_LARGO)).slice(0, MAX_77B_LINEAS));

  if (hubeQueCambiar) {
    avisos.push(
      "Hubo caracteres que la red SWIFT no admite y se reemplazaron por su equivalente más cercano: " +
        "revisar el texto antes de cursarlo.",
    );
  }

  return { texto: L.join("\n"), avisos };
}
