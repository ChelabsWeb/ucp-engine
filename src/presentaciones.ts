import { diffDias, fmtFecha, parseFecha } from "./fechas";
import { toleranciaDe } from "./lc";
import type { EstadoRegla, ReglaPresentacion } from "./presentacion";
import type { LcInfo, OperationDetail } from "./types";

/**
 * El crédito como lo ve un banco: no una operación comercial, sino un compromiso contra
 * el que se presentan documentos, a veces más de una vez.
 *
 * El motor nació dentro de un sistema para un exportador, donde cada crédito colgaba de
 * una operación de compraventa con sus dos patas, sus contenedores y su margen. Un banco
 * no tiene nada de eso: tiene el crédito, y tiene giros contra el crédito.
 *
 * Este módulo pone el modelo del lado correcto y agrega las reglas que solo aparecen
 * cuando hay más de una presentación: el saldo disponible, los embarques parciales
 * (artículo 31), los giros por cuotas (artículo 32) y la extensión del vencimiento cuando
 * cae en día no hábil (artículo 29).
 */

/** Una presentación de documentos contra un crédito. */
export interface Presentacion {
  /** cómo la identifica el banco */
  referencia: string;
  /** cuándo se presentaron los documentos */
  fecha: Date;
  /** el importe que se gira con esta presentación */
  importe: number | null;
  /** la fecha a bordo del documento de transporte, si ya la hay */
  fechaEmbarque?: string | null;
}

/* ───────────────────────────── el saldo ───────────────────────────── */

export interface SaldoCredito {
  /** el importe del crédito */
  importe: number | null;
  /** el tope con la tolerancia que el propio crédito fija */
  tope: number | null;
  /** lo que ya se giró en presentaciones anteriores */
  girado: number;
  /** lo que queda, contra el tope */
  disponible: number | null;
  tolerancia: number;
}

export function saldoDelCredito(lc: LcInfo, anteriores: Presentacion[]): SaldoCredito {
  const tolerancia = toleranciaDe(lc);
  const importe = lc.monto ?? null;
  const tope = importe === null ? null : importe * (1 + tolerancia);
  const girado = anteriores.reduce((s, p) => s + (p.importe ?? 0), 0);
  return {
    importe,
    tope,
    girado,
    disponible: tope === null ? null : Math.max(0, tope - girado),
    tolerancia,
  };
}

/* ─────────────────── artículo 29: el vencimiento en día no hábil ─────────────────── */

const esFinDeSemana = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

export interface VencimientoEfectivo {
  /** el que dice el crédito */
  segunElCredito: Date;
  /** el que rige, corrido al siguiente día hábil si hacía falta */
  efectivo: Date;
  corrido: boolean;
}

/**
 * Si el vencimiento cae en un día en que el banco está cerrado, se corre al siguiente día
 * hábil (artículo 29a). Acá solo se contemplan los fines de semana: los feriados dependen
 * de la plaza del banco y no se pueden adivinar.
 *
 * El último día de embarque **no** se corre nunca (artículo 29c), y esa distinción es la
 * que más se confunde.
 */
export function vencimientoEfectivo(lc: LcInfo): VencimientoEfectivo | null {
  const v = parseFecha(lc.vencimiento);
  if (!v) return null;
  const efectivo = new Date(v.getFullYear(), v.getMonth(), v.getDate());
  let corrido = false;
  while (esFinDeSemana(efectivo)) {
    efectivo.setDate(efectivo.getDate() + 1);
    corrido = true;
  }
  return { segunElCredito: v, efectivo, corrido };
}

/* ───────────────────────────── las reglas ───────────────────────────── */

function regla(id: string, fuente: string, texto: string, estado: EstadoRegla, evidencia: string): ReglaPresentacion {
  return { id, fuente, regla: texto, estado, evidencia };
}

const money = (n: number, moneda?: string | null) =>
  `${moneda ?? ""} ${n.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();

/**
 * Lo que hay que mirar cuando la presentación no es la única.
 *
 * Son las reglas que no se ven examinando un juego de documentos aislado: cuánto queda del
 * crédito, si estaba permitido girar de nuevo, y si la presentación llega dentro del plazo.
 */
export function reglasDeGiro(input: {
  lc: LcInfo;
  /** la presentación que se está examinando */
  actual: Presentacion;
  /** las que ya se giraron contra este crédito */
  anteriores?: Presentacion[];
  /** 43P del crédito: "ALLOWED" / "NOT ALLOWED" */
  parciales?: string | null;
}): ReglaPresentacion[] {
  const anteriores = input.anteriores ?? [];
  const out: ReglaPresentacion[] = [];
  const saldo = saldoDelCredito(input.lc, anteriores);
  const moneda = input.lc.moneda;

  /* 31a: los embarques y giros parciales están permitidos salvo que el crédito diga otra cosa */
  const prohibidos = input.parciales ? /not allowed|prohibid|no permit/i.test(input.parciales) : false;
  if (anteriores.length > 0) {
    out.push(
      regla(
        "giro-parciales",
        prohibidos ? "43P / UCP 600 31a" : "UCP 600 31a",
        prohibidos
          ? "El crédito prohíbe los giros parciales y ya hay una presentación anterior"
          : `Giro número ${anteriores.length + 1} contra el mismo crédito`,
        prohibidos ? "DISCREPANCIA" : "OK",
        prohibidos
          ? `ya se giró ${money(saldo.girado, moneda)} en ${anteriores.length} presentación${anteriores.length > 1 ? "es" : ""}`
          : `los parciales están permitidos${input.parciales ? ` (43P: ${input.parciales})` : " por defecto"}`,
      ),
    );
  }

  /* 32B y 30: el total girado no puede pasarse del tope del crédito */
  if (saldo.tope !== null && input.actual.importe !== null) {
    const total = saldo.girado + input.actual.importe;
    const excede = total > saldo.tope + 1e-9;
    out.push(
      regla(
        "giro-saldo",
        saldo.tolerancia > 0 ? "32B / 39A" : "32B",
        `El total girado no supera el crédito${saldo.tolerancia > 0 ? ` (±${Math.round(saldo.tolerancia * 100)} %)` : ""}`,
        excede ? "DISCREPANCIA" : "OK",
        `${money(saldo.girado, moneda)} girados + ${money(input.actual.importe, moneda)} de esta presentación = ` +
          `${money(total, moneda)} · tope ${money(saldo.tope, moneda)}`,
      ),
    );
  }

  /* 6e y 29a: la presentación tiene que llegar en o antes del vencimiento */
  const v = vencimientoEfectivo(input.lc);
  if (v) {
    const dias = diffDias(input.actual.fecha, v.efectivo);
    out.push(
      regla(
        "giro-vencimiento",
        v.corrido ? "UCP 600 6e y 29a" : "UCP 600 6e",
        v.corrido
          ? `Presentada antes del vencimiento, corrido al primer día hábil (${fmtFecha(v.efectivo)})`
          : `Presentada antes del vencimiento (${fmtFecha(v.efectivo)})`,
        dias >= 0 ? "OK" : "DISCREPANCIA",
        dias >= 0
          ? `presentada el ${fmtFecha(input.actual.fecha)}, quedan ${dias} días`
          : `presentada el ${fmtFecha(input.actual.fecha)}, ${-dias} días después del vencimiento`,
      ),
    );
    if (v.corrido) {
      out.push(
        regla(
          "giro-embarque-no-corre",
          "UCP 600 29c",
          "El último día de embarque no se corre aunque el vencimiento sí",
          "OK",
          `el crédito vence el ${fmtFecha(v.segunElCredito)} (día no hábil) y rige el ${fmtFecha(v.efectivo)}; el último embarque sigue siendo el ${input.lc.limiteEmbarque}`,
        ),
      );
    }
  }

  return out;
}

/* ──────────────────── el puente con el motor heredado ──────────────────── */

/**
 * Arma la estructura que el examen base espera, a partir del crédito y la presentación.
 *
 * Es un adaptador, no un modelo: existe para que la aplicación no tenga que inventar una
 * operación de compraventa que en un banco no existe. El día que el examen base deje de
 * pedirla, esto desaparece y nada más cambia.
 */
export function operacionDesdeCredito(input: {
  lc: LcInfo;
  presentacion: Presentacion;
  ordenante?: string | null;
  incoterm?: string | null;
  mercaderia?: string | null;
}): OperationDetail {
  const { lc, presentacion } = input;
  return {
    codigo: lc.numero,
    mercaderia: input.mercaderia ?? "",
    cliente: input.ordenante ?? "",
    clientePais: "",
    incoterm: input.incoterm ?? "",
    estado: "DOCS_EN_PREPARACION",
    alertas: 0,
    fechaEmbarque: lc.limiteEmbarque,
    montoVenta: presentacion.importe ?? lc.monto ?? 0,
    tieneDetalle: true,
    descripcionLarga: input.mercaderia ?? "",
    ruta: "",
    moneda: lc.moneda ?? "USD",
    medioPago: "LC",
    blReal: presentacion.fechaEmbarque ?? null,
    legs: [
      {
        tipo: "VENTA",
        contraparte: input.ordenante ?? "",
        lugar: "",
        condicionesPago: "LC",
        precioUnit: null,
        montoTotal: presentacion.importe ?? lc.monto ?? 0,
        incoterm: input.incoterm ?? "",
      },
    ],
    items: [],
    lc,
    contenedores: [],
    documentos: [],
    checklist: [],
    resumenEjecutivo: "",
    resumenGeneradoEn: "",
    hitos: [],
    matriz: [],
    matrizCorridaEn: "",
    discrepancias: [],
  } as unknown as OperationDetail;
}
