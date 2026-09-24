import { claveDoc } from "./consistencia";
import { parseFecha } from "./fechas";
import { diasPresentacion } from "./lc";
import type { LcInfo } from "./types";

/**
 * Los dos créditos de un back-to-back.
 *
 * Cuando el crédito que recibe el trader no es transferible —o el comprador no quiso que lo fuera—
 * la salida es otra: le pide a su banco que emita un crédito nuevo a favor del proveedor,
 * respaldado en el primero. Se parece a una transferencia y no lo es. En la transferencia hay un
 * solo crédito y el emisor original responde; acá hay dos, y el banco que emite el segundo responde
 * por él **aunque el primero no le pague**.
 *
 * Por eso no hay un artículo que citar. Las UCP tratan cada crédito por separado, y esa
 * independencia —la misma del artículo 4 que hace al crédito ajeno al contrato— es lo que deja al
 * banco expuesto. Lo que se revisa entonces no son reglas de un artículo sino **descalces con una
 * consecuencia verificable**: en qué caso el banco paga el segundo crédito y no puede cobrar el
 * primero. Donde no hay una consecuencia que se pueda calcular, no hay regla: una opinión con
 * aspecto de dictamen es peor que el silencio.
 *
 * La fuente se nombra como lo que es, práctica bancaria, y nunca como un artículo. Atribuirle a las
 * UCP una regla que no tienen sería lo peor que este motor puede hacer: su valor entero está en que
 * cada hallazgo se pueda ir a buscar al texto.
 */

export type RiesgoBackToBack =
  /** el banco queda pagando algo que después no puede cobrar */
  | "DESCUBIERTO"
  /** no descubre a nadie, pero conviene saberlo */
  | "AVISO";

export interface DescalceBackToBack {
  id: string;
  que: string;
  fuente: string;
  riesgo: RiesgoBackToBack;
  /** quién queda descubierto y cómo */
  porQue: string;
}

export interface ContextoBackToBack {
  /** campo 43P de cada crédito */
  parcialesRecibido?: string | null;
  parcialesAEmitir?: string | null;
}

const FUENTE = "Práctica bancaria";

const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
const permiteParciales = (v: string | null | undefined) => (v ? !/not\s+allowed|prohib/i.test(v) : null);

export function revisarBackToBack(
  recibido: LcInfo,
  aEmitir: LcInfo,
  ctx: ContextoBackToBack = {},
): DescalceBackToBack[] {
  const out: DescalceBackToBack[] = [];
  const descubierto = (id: string, que: string, porQue: string) =>
    out.push({ id, que, fuente: FUENTE, riesgo: "DESCUBIERTO" as const, porQue });

  /*
   * El vencimiento del que se emite tiene que caer ANTES, no el mismo día.
   *
   * Es el descalce que no se ve. Dos vencimientos iguales parecen prudentes, pero entre que el
   * proveedor presenta contra el segundo crédito y el trader sustituye su factura para presentar
   * contra el primero pasan días, y ese margen no existe si los dos caen juntos. Cuánto margen hace
   * falta depende de cada operación y el motor no lo inventa: lo que sí puede decir es que con cero
   * no alcanza.
   */
  const vRecibido = parseFecha(recibido.vencimiento ?? "");
  const vEmitir = parseFecha(aEmitir.vencimiento ?? "");
  if (vRecibido && vEmitir && vEmitir.getTime() >= vRecibido.getTime()) {
    const mismoDia = vEmitir.getTime() === vRecibido.getTime();
    descubierto(
      "btb-vencimiento",
      mismoDia ? "Los dos créditos vencen el mismo día" : "El crédito que se emite vence después del crédito recibido",
      mismoDia
        ? "no queda margen para sustituir la factura y presentar contra el crédito recibido: el banco paga el segundo y llega tarde al primero"
        : "el banco paga el segundo crédito cuando el primero ya venció, y se queda sin de dónde cobrar",
    );
  }

  const eRecibido = parseFecha(recibido.limiteEmbarque ?? "");
  const eEmitir = parseFecha(aEmitir.limiteEmbarque ?? "");
  if (eRecibido && eEmitir && eEmitir.getTime() > eRecibido.getTime()) {
    descubierto(
      "btb-embarque",
      "El último embarque del crédito que se emite es posterior al del recibido",
      "el proveedor puede embarcar a tiempo contra el segundo crédito y tarde contra el primero: los documentos cumplen para pagar y no para cobrar",
    );
  }

  const pRecibido = diasPresentacion(recibido.plazoPresentacion);
  const pEmitir = diasPresentacion(aEmitir.plazoPresentacion);
  if (pRecibido != null && pEmitir != null && pEmitir > pRecibido) {
    descubierto(
      "btb-presentacion",
      "El plazo de presentación del crédito que se emite es mayor que el del recibido",
      "los documentos del proveedor pueden llegar dentro de plazo para el segundo crédito y fuera de plazo para el primero",
    );
  }

  if (recibido.monto != null && aEmitir.monto != null && aEmitir.monto > recibido.monto) {
    const diferencia = aEmitir.monto - recibido.monto;
    descubierto(
      "btb-importe",
      "El crédito que se emite es por más que el recibido",
      `el banco pagaría ${diferencia.toLocaleString("es-UY")} más de lo que puede cobrar contra el primero, y esa diferencia es suya`,
    );
  }

  if (recibido.moneda && aEmitir.moneda && norm(recibido.moneda) !== norm(aEmitir.moneda)) {
    descubierto(
      "btb-moneda",
      "Los dos créditos están en monedas distintas",
      "el banco paga en una moneda y cobra en otra: el riesgo de cambio entre una fecha y la otra queda de su lado",
    );
  }

  /*
   * Los documentos que hay que presentar después.
   *
   * Lo que el crédito recibido exige y el que se emite no pide, no va a venir del proveedor: lo
   * tiene que conseguir el trader por su cuenta, y si no lo consigue el banco tiene un juego que no
   * sirve para cobrar. Al revés —pedirle al proveedor un papel que después no hay que presentar— no
   * descubre a nadie: es trabajo de más, y se dice sin alarma.
   */
  const enEmitir = new Set((aEmitir.documentosExigidos ?? []).map(claveDoc));
  const enRecibido = new Set((recibido.documentosExigidos ?? []).map(claveDoc));
  const faltan = (recibido.documentosExigidos ?? []).filter((d) => !enEmitir.has(claveDoc(d)));
  if (faltan.length > 0) {
    descubierto(
      "btb-documentos",
      `El crédito recibido exige ${faltan.length} documento${faltan.length > 1 ? "s" : ""} que el que se emite no pide`,
      `hay que conseguirlos aparte del proveedor —${faltan[0]!.slice(0, 60)}— o el juego no sirve para cobrar contra el primero`,
    );
  }
  const deMas = (aEmitir.documentosExigidos ?? []).filter((d) => !enRecibido.has(claveDoc(d)));
  if (deMas.length > 0) {
    out.push({
      id: "btb-documentos-de-mas",
      que: `El crédito que se emite pide ${deMas.length} documento${deMas.length > 1 ? "s" : ""} de más`,
      fuente: FUENTE,
      riesgo: "AVISO",
      porQue:
        "no descubre a nadie: es trabajo y costo que el proveedor va a cobrar, para un papel que después no hay que presentar",
    });
  }

  const parcialesR = permiteParciales(ctx.parcialesRecibido);
  const parcialesE = permiteParciales(ctx.parcialesAEmitir);
  if (parcialesR === false && parcialesE === true) {
    descubierto(
      "btb-parciales",
      "El crédito recibido no permite embarques parciales y el que se emite sí",
      "el proveedor puede embarcar por partes y cobrar cada una, y esos embarques no se pueden presentar contra el primero",
    );
  }

  return out;
}

/** El resumen: si el par se puede emitir sin que el banco quede expuesto. */
export function resumenBackToBack(d: DescalceBackToBack[]) {
  const descubiertos = d.filter((x) => x.riesgo === "DESCUBIERTO").length;
  return { total: d.length, descubiertos, cubierto: descubiertos === 0 };
}
