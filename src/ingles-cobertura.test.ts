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

/** Los módulos cuyo texto llega a una pantalla o a un aviso. */
const MODULOS = [
  "reglas-ucp.ts",
  "transporte.ts",
  "contrato.ts",
  "consistencia.ts",
  "presentacion.ts",
  "certificados.ts",
  "especificaciones.ts",
  "verificaciones-manuales.ts",
];

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
