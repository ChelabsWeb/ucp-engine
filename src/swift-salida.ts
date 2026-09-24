/**
 * Lo que necesita cualquier mensaje SWIFT que salga de acá.
 *
 * Vive aparte porque el MT734 —el aviso de rechazo— no es el único: el MT750 avisa las
 * discrepancias pidiendo autorización en vez de rechazar, y el MT752 la concede. Los tres comparten
 * las reglas de la red, que son las que hacen rebotar un mensaje: el juego de caracteres, el largo
 * de cada campo y cómo se escribe un importe.
 */

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

export function aJuegoSwift(texto: string): { texto: string; hubeQueCambiar: boolean } {
  let salida = texto;
  for (const [re, con] of EQUIVALENTES) salida = salida.replace(re, con);
  // Lo que siga sin ser admitido no se puede adivinar: va como espacio, que es inocuo.
  salida = salida.replace(/./g, (ch) => (PERMITIDOS.test(ch) ? ch : " "));
  return { texto: salida.replace(/ {2,}/g, " ").trim(), hubeQueCambiar: salida !== texto };
}

/** Corta un texto en líneas de a lo sumo `ancho`, sin partir palabras cuando se puede. */
export function envolver(texto: string, ancho: number): string[] {
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

export const yymmdd = (d: Date) =>
  `${String(d.getFullYear() % 100).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

/**
 * El importe como lo escribe SWIFT.
 *
 * Coma decimal —siempre, aun sin decimales: «51262,»— y sin separador de miles. Un punto en lugar
 * de la coma hace que el mensaje rebote.
 */
export function importeSwift(n: number): string {
  const [entero, decimales = ""] = n.toFixed(2).split(".");
  return `${entero},${decimales.replace(/0+$/, "")}`;
}
