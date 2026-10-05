import { describe, expect, it } from "vitest";
import { quedaEspanol, textoEnIngles } from "./ingles";

/**
 * Que ningún texto del motor se quede sin traducir, aunque ningún escenario lo genere.
 *
 * El test de cobertura por escenarios —`ingles.test.ts`— examina el expediente real y comprueba que
 * los hallazgos salgan en inglés. Sirve, pero solo ve los textos que ese examen produce: cuatro
 * veces seguidas se agregaron reglas nuevas —los artículos 19, 23, 24, 25, la zona de puertos, el
 * contrato de fletamento— y el test calló, porque el expediente es un embarque marítimo y esas
 * reglas no se generaban nunca. Cada vez hubo que acordarse de agregar un escenario.
 *
 * Esto lo mira al revés: lee el código fuente de los módulos que le hablan al examinador, saca los
 * textos en castellano que contienen, y comprueba que el diccionario los traduzca. Un texto nuevo
 * sin traducción rompe el build el día que se escribe, sin depender de que alguien se acuerde de
 * inventar el escenario que lo hace aparecer.
 *
 * No reemplaza al otro: aquel prueba el texto **armado**, con sus valores adentro; este prueba las
 * piezas. Hacen falta los dos.
 */

/*
 * El fuente entra como texto, no leído del disco.
 *
 * `import.meta.glob` con `?raw` lo resuelve el mismo bundler que corre los tests, así que el motor
 * sigue sin importar nada de Node: es puro también en sus pruebas, y eso es lo que le permite
 * compilar para el navegador.
 */
/*
 * El tipo de `import.meta.glob` vive en `vite/client`, y traer los tipos de vite acá solo para esto
 * agregaría al paquete una dependencia que hoy no tiene. Se declara la firma que se usa y nada más.
 *
 * Y va escrito literal, no a través de una variable: el bundler lo sustituye durante la
 * transformación del archivo y no lo reconoce de otra forma.
 */
declare global {
  interface ImportMeta {
    glob(patron: string, opciones: { query: string; import: string; eager: boolean }): Record<string, string>;
  }
}

const FUENTES = import.meta.glob("./*.ts", { query: "?raw", import: "default", eager: true });

/**
 * Los módulos cuyo texto llega a una pantalla o a un aviso.
 *
 * `mt734.ts` y `mt750.ts` quedan afuera y conviene saber por qué: sus avisos nacen en inglés, como
 * los de `lectura-fallida.ts`, y los traduce el diccionario de la aplicación. Quien los cubre es
 * `textos.test.ts` en `apps/web`, que ata ese diccionario a los textos que el motor produce.
 */
/**
 * Los módulos que NO le hablan al examinador, y por eso no se revisan.
 *
 * ── Por qué la lista es de exclusiones y no de inclusiones ──────────────────────────────────────
 * Antes era al revés: una lista a mano de los quince módulos que sí se revisaban. Y una lista a mano
 * se queda vieja sin avisar — `papel.ts` y `preaviso.ts` se escribieron el mismo día que esto y
 * **ninguno de los dos estaba siendo revisado**, así que sus textos podían salir en castellano en la
 * pantalla inglesa sin que nada lo dijera. Es el defecto que este repo ya pagó varias veces: trabajo
 * conectado a medias, que desde afuera se ve igual que trabajo terminado.
 *
 * Así que ahora se revisan **todos** los módulos del motor y acá se nombran las excepciones, una por
 * una y con su motivo. Agregar un módulo nuevo lo pone bajo control sin que nadie se acuerde; sacarlo
 * de control obliga a escribir por qué.
 */
const NO_LE_HABLAN_AL_EXAMINADOR: Record<string, string> = {
  "ingles.ts": "es el diccionario: sus cadenas en castellano son las claves",
  "fixtures.ts": "es el expediente de muestra, no texto de la aplicación",
  "mock.ts": "datos de prueba",
  "index.ts": "solo re-exporta",
  "types.ts": "solo tipos",
  "fechas.ts": "formatea fechas; el texto que produce no es un hallazgo",
  "numeros.ts": "desambigua cantidades; sus avisos pasan por `prepararCampos`",
  "lc.ts": "cálculos sobre el crédito, sin texto para el examinador",
  "isbp.ts": "compara y ablanda; el texto de los hallazgos es del módulo que los crea",
  "blindaje.ts": "los motivos de inyección acompañan al documento y se traducen en la pantalla",
  "sanciones.ts": "las coincidencias llevan el nombre de la lista, que no se traduce",
  "jurisdicciones.ts": "nombres de jurisdicciones y programas, que no se traducen",
  "revision-sanciones.ts": "motivos de revisión, que la pantalla arma",
  "enmiendas.ts": "parsea el 707; el texto del artículo 10 está en enmienda-vigencia.ts",
  "swift-lc.ts": "parsea el mensaje",
  "mt734.ts": "el aviso de rechazo va en inglés siempre, por el artículo 16 (c)",
  "mt750.ts": "los mensajes SWIFT van en inglés siempre",
  "lectura-fallida.ts": "sus textos nacen en inglés: la clave es el inglés",
  "redaccion.ts": "propone texto para el crédito, que va en inglés",
  "checklist.ts": "etiquetas del checklist de romai",
  "alertas.ts": "alertas de la operación de romai, no del examen",
  "identidad.ts": "normaliza nombres",
};

/** Todos los módulos del motor menos los que no le hablan al examinador. */
const MODULOS = Object.keys(FUENTES)
  .map((k) => k.replace("./", ""))
  .filter((m) => !m.endsWith(".test.ts"))
  .filter((m) => NO_LE_HABLAN_AL_EXAMINADOR[m] === undefined)
  .sort();

/**
 * Los literales de cadena de un archivo, sin los que están dentro de un comentario.
 *
 * Es un recorrido de caracteres y no una expresión regular porque hay que distinguir una comilla
 * dentro de un comentario —«el crédito dice "X"»— de una que abre una cadena de verdad.
 */
/**
 * Los tramos del archivo que no le hablan a nadie: los prompts y los esquemas.
 *
 * `consistencia.ts` lleva los prompts heredados de romai y las descripciones del esquema de
 * extracción. Están en castellano a propósito —se los lee un modelo, no una persona— y traducirlos
 * no tendría sentido. Se los salta por el nombre de la constante, que es un criterio que no se
 * rompe cuando alguien edita el texto de adentro.
 */
function sinPromptsNiEsquemas(fuente: string): string {
  return fuente.replace(
    /export\s+const\s+(PROMPT|SCHEMA|REGLA_DATO)[A-Z_]*[\s\S]*?\n(?=export|const|function|\/\*\*|$)/g,
    "",
  );
}

function literales(fuente: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = fuente.length;
  while (i < n) {
    const ch = fuente[i]!;
    const par = fuente.slice(i, i + 2);
    if (par === "//") {
      while (i < n && fuente[i] !== "\n") i++;
      continue;
    }
    if (par === "/*") {
      i = fuente.indexOf("*/", i);
      if (i === -1) break;
      i += 2;
      continue;
    }
    /*
     * Las expresiones regulares no son texto.
     *
     * `emision.ts` está lleno de ellas y traen comillas y barras adentro: leerlas como cadenas
     * parte el recorrido y devuelve fragmentos de patrón disfrazados de frase. Se reconocen por lo
     * que viene antes —una barra después de `(`, `=`, `,`, `:` o `[` abre un patrón, no divide— y
     * se saltan enteras, cuidando las clases de caracteres, donde una barra no cierra nada.
     */
    if (ch === "/" && /[(=,:[!&|?{;]\s*$/.test(fuente.slice(Math.max(0, i - 40), i))) {
      let j = i + 1;
      let enClase = false;
      while (j < n) {
        if (fuente[j] === "\\") {
          j += 2;
          continue;
        }
        if (fuente[j] === "[") enClase = true;
        else if (fuente[j] === "]") enClase = false;
        else if (fuente[j] === "/" && !enClase) break;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const cierre = ch;
      let j = i + 1;
      let texto = "";
      while (j < n) {
        if (fuente[j] === "\\") {
          texto += fuente[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (fuente[j] === cierre) break;
        texto += fuente[j];
        j++;
      }
      out.push(texto);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

/** Nombres propios de los ejemplos, que la heurística confunde con castellano. */
const NOMBRES_DE_EJEMPLO = ["Al Rashid Trading LLC"];

/**
 * Un literal que le habla a una persona.
 *
 * Los identificadores, las claves y los patrones también son cadenas, así que se descartan: lo que
 * queda es lo que tiene forma de frase y contiene alguna palabra que solo existe en castellano.
 */
function esTextoDeUsuario(s: string): boolean {
  if (s.length < 12 || !s.includes(" ")) return false;
  if (/^[a-z0-9-]+$/.test(s)) return false; // ids
  /*
   * Las plantillas quedan afuera, y conviene saber por qué.
   *
   * El diccionario traduce frases enteras y ancladas, sobre el texto ya armado: «Aeropuerto de
   * salida el que indica el crédito (COLOMBO)». La plantilla de la que sale —con `${cual}` en el
   * medio— no es ninguna de sus variantes, así que probarla daría un fallo por algo que sí está
   * traducido. Esas siguen cubiertas por los escenarios de `ingles.test.ts`, que prueban el texto
   * armado.
   *
   * Lo que queda acá son los textos fijos, que son los nombres de las reglas: justamente donde
   * estuvieron los cuatro olvidos.
   */
  if (s.includes("${")) return false;
  /*
   * Dos clases de cadena que parecen texto y no lo son.
   *
   * Las `description` del esquema de extracción se las lee el modelo, igual que los prompts. Y los
   * nombres propios de los ejemplos —una contraparte inventada— disparan la heurística por el
   * artículo: «Al Rashid Trading LLC» no es castellano, es un nombre.
   */
  if (/^(El valor tal cual|Confianza de 0 a 1)/.test(s)) return false;
  if (NOMBRES_DE_EJEMPLO.includes(s)) return false;
  return quedaEspanol(s) !== null;
}

describe("el diccionario cubre todo lo que el motor escribe", () => {
  it("encuentra el fuente de todos los módulos que dice mirar", () => {
    // Sin esto, un módulo mal escrito en la lista haría pasar el test sin mirar nada.
    for (const m of MODULOS) expect(FUENTES[`./${m}`], `no se pudo leer ${m}`).toBeTruthy();
  });

  it.each(MODULOS)("%s", (modulo) => {
    const fuente = sinPromptsNiEsquemas(FUENTES[`./${modulo}`] ?? "");
    const sinTraducir = literales(fuente)
      .filter(esTextoDeUsuario)
      .map((s) => ({ texto: s, palabra: quedaEspanol(textoEnIngles(s)) }))
      .filter((x) => x.palabra !== null);

    // El mensaje nombra la palabra y la frase, para que arreglarlo no sea una búsqueda.
    expect(sinTraducir.map((x) => `«${x.palabra}» en «${x.texto}»`)).toEqual([]);
  });
});
