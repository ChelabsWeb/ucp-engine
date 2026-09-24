import { parseFecha } from "./fechas";
import { diasPresentacion } from "./lc";
import type { LcInfo } from "./types";

/**
 * El crédito transferido contra el original (UCP 600 art. 38).
 *
 * Un crédito transferible es el que **dice** serlo (38 b). El primer beneficiario —un trader, casi
 * siempre— lo hace disponible para su proveedor, el segundo beneficiario, y de la diferencia entre
 * los dos importes sale su margen. El banco que emite ese segundo crédito es el transferente, y lo
 * que emite no es un crédito nuevo: es el mismo, con permiso de mover cinco cosas y nada más.
 *
 * El 38 (g) es una lista cerrada. El transferido tiene que reflejar con exactitud los términos del
 * original, **incluida la confirmación**, salvo el importe, cualquier precio unitario, el
 * vencimiento, el plazo de presentación y la última fecha de embarque, que **solo pueden reducirse
 * o acortarse**. Dos excepciones más van al revés: el porcentaje de cobertura del seguro puede
 * **aumentarse** —porque sobre un importe menor hace falta más porcentaje para llegar a la misma
 * cobertura— y el nombre del primer beneficiario puede sustituir al del ordenante.
 *
 * Lo que este módulo evita es un crédito transferido que el emisor después no honra. Si el
 * transferido pide algo que el original no pedía, o vence después, el segundo beneficiario puede
 * presentar documentos impecables contra él y el crédito original no cubrirlos.
 */

export type GravedadTransferencia = "IMPIDE" | "AVISO";

export interface ObservacionTransferencia {
  id: string;
  /** qué pasa */
  que: string;
  /** el artículo que lo funda */
  fuente: string;
  gravedad: GravedadTransferencia;
  /** por qué importa, en términos de lo que puede salir mal */
  porQue: string;
}

export interface ContextoTransferencia {
  /** porcentaje de cobertura del seguro en cada crédito, si el crédito lo fija */
  seguroOriginal?: number | null;
  seguroTransferido?: number | null;
  /** el nombre del primer beneficiario reemplaza al del ordenante (38 g, penúltimo párrafo) */
  ordenanteSustituido?: boolean;
  /** a cuántos segundos beneficiarios se transfiere */
  segundosBeneficiarios?: number;
  /** campo 43P del original */
  parciales?: string | null;
  /** el crédito que se quiere transferir ya es, a su vez, un transferido */
  yaEsTransferido?: boolean;
}

/** Si el crédito se declara transferible, que es la única forma de serlo (38 b). */
export function sePuedeTransferir(formaDelCredito: string | null | undefined): { puede: boolean; porQue: string } {
  const dice = /transferable|transferible/i.test(formaDelCredito ?? "");
  return {
    puede: dice,
    porQue: dice
      ? "el crédito se declara transferible (UCP 600 art. 38 b)"
      : "el crédito no se declara transferible: solo lo es el que lo dice expresamente (UCP 600 art. 38 b)",
  };
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase().replace(/\s+/g, " ");

/** Compara dos listas sin importar el orden ni los espacios. */
function mismasLineas(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  const x = (a ?? []).map(norm).sort();
  const y = (b ?? []).map(norm).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

export function revisarTransferencia(
  original: LcInfo,
  transferido: LcInfo,
  ctx: ContextoTransferencia = {},
): ObservacionTransferencia[] {
  const out: ObservacionTransferencia[] = [];
  const impide = (id: string, que: string, fuente: string, porQue: string) =>
    out.push({ id, que, fuente, gravedad: "IMPIDE" as const, porQue });

  /* ── las cinco que solo pueden ir para abajo (38 g) ── */

  if (original.monto != null && transferido.monto != null && transferido.monto > original.monto) {
    impide(
      "38g-importe",
      "El importe del crédito transferido es mayor que el del original",
      "UCP 600 38g",
      "el importe puede reducirse, nunca aumentarse: por la diferencia el emisor no responde y el banco transferente queda descubierto",
    );
  }

  const fecha = (s: string | null | undefined) => parseFecha(s ?? "");
  const vOriginal = fecha(original.vencimiento);
  const vTransferido = fecha(transferido.vencimiento);
  if (vOriginal && vTransferido && vTransferido.getTime() > vOriginal.getTime()) {
    impide(
      "38g-vencimiento",
      "El vencimiento del crédito transferido es posterior al del original",
      "UCP 600 38g",
      "el vencimiento puede acortarse, no estirarse: el segundo beneficiario podría presentar cuando el crédito original ya venció",
    );
  }

  const eOriginal = fecha(original.limiteEmbarque);
  const eTransferido = fecha(transferido.limiteEmbarque);
  if (eOriginal && eTransferido && eTransferido.getTime() > eOriginal.getTime()) {
    impide(
      "38g-embarque",
      "El último embarque del crédito transferido es posterior al del original",
      "UCP 600 38g",
      "puede acortarse, no estirarse: un embarque a tiempo contra el transferido llegaría tarde contra el original",
    );
  }

  const pOriginal = diasPresentacion(original.plazoPresentacion);
  const pTransferido = diasPresentacion(transferido.plazoPresentacion);
  if (pOriginal != null && pTransferido != null && pTransferido > pOriginal) {
    impide(
      "38g-presentacion",
      "El plazo de presentación del crédito transferido es mayor que el del original",
      "UCP 600 38g",
      "puede acortarse, no estirarse: los documentos llegarían al emisor fuera del plazo que él fijó",
    );
  }

  /* ── el seguro, que es la excepción al revés ── */

  const sO = ctx.seguroOriginal;
  const sT = ctx.seguroTransferido;
  if (sO != null && sT != null && sT < sO) {
    impide(
      "38g-seguro",
      "La cobertura de seguro del crédito transferido es menor que la del original",
      "UCP 600 38g",
      "el porcentaje puede aumentarse, no reducirse: sobre un importe menor hace falta más porcentaje para llegar a la cobertura que el crédito exige",
    );
  }

  /* ── todo lo demás se refleja con exactitud ── */

  const igual = (
    id: string,
    que: string,
    a: string | null | undefined,
    b: string | null | undefined,
    porQue: string,
  ) => {
    if (!a && !b) return;
    if (norm(a) !== norm(b)) impide(id, que, "UCP 600 38g", porQue);
  };

  igual(
    "38g-emisor",
    "El banco emisor difiere entre el crédito original y el transferido",
    original.bancoEmisor,
    transferido.bancoEmisor,
    "el transferido es el mismo crédito puesto a disposición de otro beneficiario, no uno nuevo",
  );
  igual(
    "38g-moneda",
    "La moneda difiere entre el crédito original y el transferido",
    original.moneda,
    transferido.moneda,
    "la moneda no está entre lo que el artículo deja cambiar",
  );

  if (!mismasLineas(original.documentosExigidos, transferido.documentosExigidos)) {
    impide(
      "38g-documentos",
      "Los documentos exigidos difieren entre el crédito original y el transferido",
      "UCP 600 38g",
      "el segundo beneficiario presentaría un juego que el crédito original no cubre, o le faltaría uno que el emisor va a pedir",
    );
  }

  if (original.tolerancia !== transferido.tolerancia) {
    impide(
      "38g-tolerancia",
      "La tolerancia difiere entre el crédito original y el transferido",
      "UCP 600 38g",
      "la lista del artículo es cerrada y la tolerancia no está en ella: tiene que reflejarse tal cual",
    );
  }

  /*
   * El nombre del ordenante en documentos que no sean la factura.
   *
   * Sustituirlo por el del primer beneficiario está permitido —es de lo que vive la transferencia,
   * porque el proveedor no tiene por qué saber quién es el comprador final— salvo donde el crédito
   * pide expresamente que el nombre del ordenante aparezca en otro documento. Si esa exigencia no
   * se refleja, el segundo beneficiario emite el certificado con el nombre equivocado y la
   * presentación se cae por algo que el banco transferente podía haber previsto.
   */
  if (ctx.ordenanteSustituido) {
    const exigeNombre = (original.condicionesAdicionales ?? []).filter(
      (c) => /APPLICANT|ORDENANTE/i.test(c) && !/INVOICE|FACTURA/i.test(c),
    );
    const reflejadas = (transferido.condicionesAdicionales ?? []).map(norm);
    const faltan = exigeNombre.filter((c) => !reflejadas.includes(norm(c)));
    if (faltan.length > 0) {
      impide(
        "38g-ordenante",
        "El crédito exige el nombre del ordenante en un documento que no es la factura, y el transferido no lo refleja",
        "UCP 600 38g",
        "sustituir el nombre del ordenante está permitido, pero esa exigencia no: el segundo beneficiario emitiría el documento con el nombre equivocado",
      );
    }
  }

  /* ── a cuántos y desde dónde (38 d) ── */

  const segundos = ctx.segundosBeneficiarios ?? 1;
  if (segundos > 1 && ctx.parciales && /not\s+allowed|prohib/i.test(ctx.parciales)) {
    impide(
      "38d-parciales",
      "Se transfiere a más de un segundo beneficiario y el crédito no permite embarques parciales",
      "UCP 600 38d",
      "cada segundo beneficiario embarcaría su parte, que es un embarque parcial: el artículo lo admite solo si el crédito los permite",
    );
  }

  if (ctx.yaEsTransferido) {
    impide(
      "38d-retransferencia",
      "El crédito que se quiere transferir ya es un crédito transferido",
      "UCP 600 38d",
      "un transferido no puede transferirse otra vez a pedido del segundo beneficiario; el primer beneficiario no cuenta como beneficiario posterior",
    );
  }

  return out;
}

/** El resumen: si la transferencia se puede emitir tal como está. */
export function resumenTransferencia(o: ObservacionTransferencia[]) {
  const impiden = o.filter((x) => x.gravedad === "IMPIDE").length;
  return { total: o.length, impiden, emitible: impiden === 0 };
}
