import type { ParteScreenear } from "./sanciones";

/**
 * El control que de verdad corresponde sobre un puerto.
 *
 * Los puertos se estaban cotejando por nombre contra las listas de personas y entidades, y eso
 * produce basura. Caso real del expediente CSU2025099: el puerto de descarga «COLOMBO,SRI LANKA»
 * daba coincidencia parcial con «TAMILS REHABILITATION ORGANISATION», porque esa entidad tiene
 * entre sus alias «TSUNAMI RELIEF FUND -- COLOMBO, SRI LANKA». Todas las palabras del puerto
 * estaban dentro del alias, así que el cotejo por contención —que para empresas es correcto,
 * «ORIENT FEED» dentro de «ORIENT FEED LIMITED»— acá inventaba una alerta.
 *
 * Un banco que ve eso deja de mirar el screening al segundo falso positivo, y entonces el día
 * que haya uno verdadero tampoco lo va a mirar. Un control que cría desconfianza es peor que no
 * tenerlo.
 *
 * Lo que hay que preguntarle a un puerto no es si su nombre figura en una lista de nombres, sino
 * **en qué jurisdicción está**. Eso es lo que hace este módulo.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * ESTA LISTA SE MANTIENE A MANO y por eso lleva fecha. No se baja de ningún lado en un formato
 * utilizable: los programas por país de OFAC están en su reglamentación, no en el SDN.xml. Es la
 * parte menos automática del screening y la que primero se queda vieja. Mientras diga una fecha
 * de hace mucho, un examinador tiene que saber que esto es un tamiz grueso y no el control.
 * ────────────────────────────────────────────────────────────────────────────────
 */

export const JURISDICCIONES_REVISADAS_EN = "2026-09-22";

export type Alcance = "INTEGRAL" | "RESTRINGIDA";

export interface Jurisdiccion {
  /** cómo se la nombra */
  nombre: string;
  /** las formas en que aparece escrita en un documento de embarque */
  terminos: string[];
  alcance: Alcance;
  /** el programa o régimen que la cubre, para poder ir a leerlo */
  programa: string;
}

/**
 * Las jurisdicciones bajo programa integral o con restricciones fuertes que alcanzan al comercio
 * de mercaderías. No es la lista de todos los programas de sanciones que existen: es la de las
 * que hacen que un puerto, por sí solo, merezca una mirada antes de seguir.
 */
export const JURISDICCIONES: Jurisdiccion[] = [
  {
    nombre: "Corea del Norte",
    terminos: ["NORTH KOREA", "DPRK", "KOREA, DEMOCRATIC PEOPLE'S REPUBLIC", "NAMPO", "CHONGJIN", "WONSAN", "HAEJU"],
    alcance: "INTEGRAL",
    programa: "OFAC DPRK / ONU 1718",
  },
  {
    nombre: "Irán",
    terminos: ["IRAN", "BANDAR ABBAS", "BANDAR-E ABBAS", "BUSHEHR", "KHORRAMSHAHR", "CHABAHAR", "ASSALUYEH"],
    alcance: "INTEGRAL",
    programa: "OFAC Iran",
  },
  {
    nombre: "Cuba",
    terminos: ["CUBA", "HAVANA", "LA HABANA", "MARIEL", "SANTIAGO DE CUBA", "CIENFUEGOS"],
    alcance: "INTEGRAL",
    programa: "OFAC Cuba (CACR)",
  },
  {
    nombre: "Siria",
    terminos: ["SYRIA", "LATAKIA", "TARTUS", "BANIYAS"],
    alcance: "INTEGRAL",
    programa: "OFAC Syria",
  },
  {
    nombre: "Crimea y los territorios ocupados de Ucrania",
    terminos: [
      "CRIMEA",
      "SEVASTOPOL",
      "SIMFEROPOL",
      "KERCH",
      "FEODOSIA",
      "DONETSK",
      "LUHANSK",
      "MARIUPOL",
      "BERDYANSK",
    ],
    alcance: "INTEGRAL",
    programa: "OFAC Ukraine-/Russia-related (EO 14065)",
  },
  {
    nombre: "Rusia",
    terminos: [
      "RUSSIA",
      "NOVOROSSIYSK",
      "ST PETERSBURG",
      "SAINT PETERSBURG",
      "VLADIVOSTOK",
      "TAMAN",
      "UST-LUGA",
      "PRIMORSK",
    ],
    alcance: "RESTRINGIDA",
    programa: "OFAC Russia / topes de precio y prohibiciones sectoriales",
  },
  {
    nombre: "Bielorrusia",
    terminos: ["BELARUS", "MINSK"],
    alcance: "RESTRINGIDA",
    programa: "OFAC Belarus",
  },
  {
    nombre: "Venezuela",
    terminos: ["VENEZUELA", "PUERTO CABELLO", "JOSE TERMINAL", "AMUAY", "CARDON"],
    alcance: "RESTRINGIDA",
    programa: "OFAC Venezuela",
  },
  {
    nombre: "Myanmar",
    terminos: ["MYANMAR", "BURMA", "YANGON", "RANGOON", "THILAWA"],
    alcance: "RESTRINGIDA",
    programa: "OFAC Burma",
  },
];

export interface AlertaJurisdiccion {
  parte: ParteScreenear;
  jurisdiccion: string;
  alcance: Alcance;
  programa: string;
  /** el término que hizo saltar la alerta, para que se vea por qué */
  termino: string;
}

/** Los roles cuyo valor es un lugar y no el nombre de alguien. */
const LUGARES = new Set(["PUERTO_CARGA", "PUERTO_DESCARGA"]);

export function esLugar(rol: string): boolean {
  return LUGARES.has(rol);
}

/**
 * Las partes que nombran un lugar, contra las jurisdicciones bajo programa.
 *
 * El cotejo es por palabra entera y no por contención: sin eso, «IRAN» encontraría a
 * «ETXEBARRIA» y «CUBA» a «CUBATÃO», que es un puerto de Brasil.
 */
export function screenearJurisdicciones(partes: ParteScreenear[]): AlertaJurisdiccion[] {
  const out: AlertaJurisdiccion[] = [];
  for (const p of partes) {
    if (!esLugar(p.rol)) continue;
    // se compara sobre el texto con los separadores vueltos espacios, para que «COLOMBO,SRI
    // LANKA» dé las palabras COLOMBO, SRI y LANKA y no una sola pegada
    const texto = ` ${p.valor
      .toUpperCase()
      .replace(/[^A-Z0-9']+/g, " ")
      .trim()} `;
    for (const j of JURISDICCIONES) {
      const termino = j.terminos.find((t) => texto.includes(` ${t.replace(/[^A-Z0-9']+/g, " ").trim()} `));
      if (termino) {
        out.push({ parte: p, jurisdiccion: j.nombre, alcance: j.alcance, programa: j.programa, termino });
        break; // una alerta por parte y jurisdicción alcanza
      }
    }
  }
  return out;
}

/** Una línea legible, con la evidencia y sin adjetivar. */
export function describirAlerta(a: AlertaJurisdiccion): string {
  const q = a.alcance === "INTEGRAL" ? "bajo programa integral" : "con restricciones sectoriales";
  return `${a.parte.rol === "PUERTO_CARGA" ? "Puerto de carga" : "Puerto de descarga"} "${a.parte.valor}" (${a.parte.origen}) — nombra «${a.termino}»: ${a.jurisdiccion}, ${q} · ${a.programa}`;
}
