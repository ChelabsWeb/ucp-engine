import { diffDias, fmtFecha, parseFecha } from "./fechas";
import { toleranciaDeImporte } from "./lc";
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
  // El tope del crédito es de IMPORTE: sin 39A ni «about» no hay margen hacia arriba (art. 30).
  const tolerancia = toleranciaDeImporte(lc);
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

const mismoDia = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Si el vencimiento cae en un día en que el banco está cerrado, se corre al siguiente día hábil
 * (artículo 29a).
 *
 * Se contemplan los fines de semana siempre, y los feriados cuando el banco los carga: el
 * calendario de cada plaza no se puede adivinar, y un motor que lo inventara diría que una
 * presentación llegó tarde el día que la plaza estuvo cerrada.
 *
 * El último día de embarque **no** se corre nunca (artículo 29c), y esa distinción es la que más
 * se confunde.
 */
export function vencimientoEfectivo(lc: LcInfo, feriados: Date[] = []): VencimientoEfectivo | null {
  const v = parseFecha(lc.vencimiento);
  if (!v) return null;
  const efectivo = new Date(v.getFullYear(), v.getMonth(), v.getDate());
  const cerrado = (d: Date) => esFinDeSemana(d) || feriados.some((f) => mismoDia(f, d));
  let corrido = false;
  while (cerrado(efectivo)) {
    efectivo.setDate(efectivo.getDate() + 1);
    corrido = true;
  }
  return { segunElCredito: v, efectivo, corrido };
}

/* ──────────────────── art. 33: cuándo cuenta como presentado ──────────────────── */

/** El horario de atención del banco al que se presenta, en «HH:MM». */
export interface HorarioDeAtencion {
  abre: string;
  cierra: string;
}

export interface PresentacionEfectiva {
  /** el momento en que se entregó el juego */
  entregada: Date;
  /** el día hábil que cuenta como fecha de presentación */
  efectiva: Date;
  corrida: boolean;
  motivo: "EN_HORARIO" | "FUERA_DE_HORARIO" | "DIA_CERRADO" | "SIN_HORARIO";
}

const minutos = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59 ? h * 60 + min : null;
};

/**
 * Qué día cuenta como fecha de presentación (UCP 600 art. 33).
 *
 * «A bank has no obligation to accept a presentation outside of its banking hours.» Dicho al revés:
 * lo que se entrega fuera del horario cuenta como presentado **el día hábil siguiente**.
 *
 * No es trámite: unos documentos dejados a las 18:00 del día del vencimiento llegaron tarde, y el
 * sello que dice «30-abr 18:00» está registrando una presentación que legalmente es del 2 de mayo.
 * Al revés también —contar ese día como bueno le da al beneficiario un plazo que no tiene— y los dos
 * errores cuestan plata.
 *
 * El horario de cada banco no se puede adivinar, así que sin él no se corre nada y se dice
 * (`SIN_HORARIO`). Lo que sí se ve sin ningún dato es el **día cerrado**: un sábado es un sábado en
 * cualquier plaza, y los feriados se contemplan cuando el banco los carga, igual que en el 29 (a).
 */
export function presentacionEfectiva(
  entregada: Date,
  horario?: HorarioDeAtencion | null,
  feriados: Date[] = [],
): PresentacionEfectiva {
  const soloDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const cerrado = (d: Date) => esFinDeSemana(d) || feriados.some((f) => mismoDia(f, d));
  const siguienteHabil = (d: Date) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    while (cerrado(x)) x.setDate(x.getDate() + 1);
    return x;
  };

  const dia = soloDia(entregada);
  if (cerrado(dia)) {
    return { entregada, efectiva: siguienteHabil(dia), corrida: true, motivo: "DIA_CERRADO" };
  }

  const abre = horario ? minutos(horario.abre) : null;
  const cierra = horario ? minutos(horario.cierra) : null;
  if (abre === null || cierra === null) {
    return { entregada, efectiva: dia, corrida: false, motivo: "SIN_HORARIO" };
  }

  const cuando = entregada.getHours() * 60 + entregada.getMinutes();
  if (cuando < abre || cuando > cierra) {
    return { entregada, efectiva: siguienteHabil(dia), corrida: true, motivo: "FUERA_DE_HORARIO" };
  }
  return { entregada, efectiva: dia, corrida: false, motivo: "EN_HORARIO" };
}

/** La hora de un momento, como la escribiría un sello de recepción. */
const fmtHora = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** El primer día hábil después de una fecha, sin contar fines de semana. */
function primerDiaHabilDespues(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  while (esFinDeSemana(x)) x.setDate(x.getDate() + 1);
  return x;
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
/** Una cuota del crédito: el período en que hay que embarcarla. */
export interface Cuota {
  /** cómo la nombra el crédito: «1», «primera», «March shipment» */
  referencia: string;
  desde: string;
  hasta: string;
}

/** Palabras con las que un crédito estipula embarques por cuotas. */
const PARECEN_CUOTAS =
  /\binstal?lments?\b|\bshipment\s+schedule\b|\bpor\s+cuotas\b|\bembarques?\s+parciales?\s+mensuales\b|\bmonthly\s+shipments?\b/i;

export function reglasDeGiro(input: {
  lc: LcInfo;
  /** la presentación que se está examinando */
  actual: Presentacion;
  /** las que ya se giraron contra este crédito */
  anteriores?: Presentacion[];
  /** 43P del crédito: "ALLOWED" / "NOT ALLOWED" */
  parciales?: string | null;
  /**
   * Los días en que el banco al que se presenta estuvo cerrado, si el banco los sabe.
   *
   * Sin ellos el motor solo conoce los fines de semana, y una presentación hecha el primer día
   * hábil posterior al vencimiento se manda a verificar en vez de rechazarse (art. 29 a).
   */
  feriados?: Date[];
  /**
   * El horario de atención del banco al que se presenta, si el banco lo cargó.
   *
   * Decide si el juego entregado el último día llegó a tiempo (art. 33): lo que se recibe fuera del
   * horario cuenta como presentado el día hábil siguiente. Sin él no se corre nada — pero cuando la
   * entrega cae justo el día del vencimiento, se avisa, porque ahí la hora decide.
   */
  horario?: HorarioDeAtencion | null;
  /**
   * El calendario de cuotas del crédito, si el banco lo cargó.
   *
   * No se parsea del 47A: los créditos lo escriben de veinte maneras y equivocarse acá tiene la
   * consecuencia más dura de las UCP. Cuando no están cargadas y el crédito parece estipularlas, se
   * avisa para que alguien las mire.
   */
  cuotas?: Cuota[];
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
  /*
   * La fecha que cuenta no es la de entrega sino la efectiva (art. 33).
   *
   * Con esto una presentación dejada a las 18:00 del día del vencimiento se compara contra el día
   * hábil siguiente, que es lo que legalmente es. Si el artículo 33 quedara como una nota al
   * costado, el examen seguiría diciendo que llegó en plazo.
   */
  const efectiva = presentacionEfectiva(input.actual.fecha, input.horario, input.feriados ?? []);
  const v = vencimientoEfectivo(input.lc, input.feriados ?? []);
  if (v) {
    const dias = diffDias(efectiva.efectiva, v.efectivo);
    /*
     * El artículo 33 se dice solo cuando la hora decide, y eso es **un** día.
     *
     * Si la entrega es anterior al vencimiento, la hora no cambia nada: correrla un día hábil la
     * deja igual de en plazo. Si es posterior, ya llegó tarde y la hora tampoco cambia nada. El
     * único día en que la hora da vuelta el veredicto es el del vencimiento efectivo.
     *
     * La primera versión avisaba «ese día o después», y entonces una presentación tres meses tarde
     * salía pidiendo que alguien verificara el horario de atención. Eso es ruido, y el ruido hace
     * que el día que importe tampoco se mire.
     */
    const entregadaEse = new Date(
      input.actual.fecha.getFullYear(),
      input.actual.fecha.getMonth(),
      input.actual.fecha.getDate(),
    );
    if (mismoDia(entregadaEse, v.efectivo)) {
      if (efectiva.corrida && efectiva.motivo === "FUERA_DE_HORARIO" && input.horario) {
        out.push(
          regla(
            "ucp-33",
            "UCP 600 33",
            "Lo recibido fuera del horario cuenta como presentado el día hábil siguiente",
            "ATENCION",
            `entregada a las ${fmtHora(input.actual.fecha)} y el banco atiende hasta las ${input.horario.cierra}: cuenta como presentada el ${fmtFecha(efectiva.efectiva)}`,
          ),
        );
      } else if (efectiva.motivo === "SIN_HORARIO") {
        out.push(
          regla(
            "ucp-33",
            "UCP 600 33",
            "Lo recibido fuera del horario cuenta como presentado el día hábil siguiente",
            "ATENCION",
            `entregada a las ${fmtHora(input.actual.fecha)} del último día: verificar que haya llegado dentro del horario de atención, porque fuera de él cuenta como del día siguiente`,
          ),
        );
      }
    }
    /*
     * El feriado que el motor no puede conocer.
     *
     * El 29 (a) corre el vencimiento al primer día hábil siguiente cuando el banco al que se
     * presenta está cerrado por razones distintas de las del artículo 36 —un feriado, entre
     * otras—. Acá se contemplan los fines de semana y, si el banco los carga, sus feriados; lo que
     * no existe es un calendario universal de plazas.
     *
     * Así que cuando la presentación cae justo en el primer día hábil posterior al vencimiento, el
     * motor no tiene con qué afirmar que llegó tarde: si ese día el banco estaba cerrado, llegó en
     * plazo. Se manda a verificar en vez de rechazar. Dos días hábiles después ya no hay feriado
     * que lo salve, y ahí sí es discrepancia.
     */
    /*
     * La escapatoria del feriado no corre cuando sabemos que el banco estaba abierto.
     *
     * El 29 (a) extiende el vencimiento si el banco estuvo cerrado, y por eso una presentación
     * hecha el primer día hábil siguiente se manda a verificar en vez de rechazarse. Pero si la
     * fecha se corrió **por el horario** —el banco atendió ese día y el juego llegó a las 18:00—
     * entonces no hubo cierre que extienda nada: llegó tarde, y decirlo «a verificar» sería dar por
     * posible un feriado que el propio dato descarta.
     *
     * El test lo encontró: con el crédito real, que vence un lunes, el corrimiento del artículo 33
     * caía justo en el primer día hábil siguiente y se colaba por esta puerta.
     */
    const corridaPorHorario = efectiva.motivo === "FUERA_DE_HORARIO";
    const podriaSerFeriado =
      dias < 0 && !corridaPorHorario && mismoDia(efectiva.efectiva, primerDiaHabilDespues(v.efectivo));
    out.push(
      regla(
        "giro-vencimiento",
        v.corrido || podriaSerFeriado ? "UCP 600 6e y 29a" : "UCP 600 6e",
        v.corrido
          ? `Presentada antes del vencimiento, corrido al primer día hábil (${fmtFecha(v.efectivo)})`
          : `Presentada antes del vencimiento (${fmtFecha(v.efectivo)})`,
        dias >= 0 ? "OK" : podriaSerFeriado ? "ATENCION" : "DISCREPANCIA",
        dias >= 0
          ? `presentada el ${fmtFecha(efectiva.efectiva)}, quedan ${dias} días`
          : podriaSerFeriado
            ? `presentada el ${fmtFecha(input.actual.fecha)}, el primer día hábil después del vencimiento: si el banco estuvo cerrado el ${fmtFecha(v.efectivo)}, el artículo 29 (a) lo extiende hasta este día — verificar el calendario de la plaza`
            : efectiva.corrida
              ? `entregada el ${fmtFecha(input.actual.fecha)} fuera del horario, así que cuenta como presentada el ${fmtFecha(efectiva.efectiva)}: ${-dias} día${-dias === 1 ? "" : "s"} después del vencimiento`
              : `presentada el ${fmtFecha(efectiva.efectiva)}, ${-dias} días después del vencimiento`,
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

  /*
   * 32: las cuotas que no se embarcaron en su período matan el crédito para lo que sigue.
   *
   * «If a drawing or shipment by instalments within given periods is stipulated in the credit and
   * any instalment is not drawn or shipped within the period allowed for that instalment, the
   * credit ceases to be available for that and any subsequent instalment.» Es la consecuencia más
   * dura de las UCP y no se subsana presentando de nuevo: lo que queda del crédito se terminó.
   *
   * Por eso el calendario no se adivina del 47A. Si está cargado se aplica; si no está y el crédito
   * parece estipular cuotas, se avisa para que alguien lo mire.
   */
  const cuotas = input.cuotas ?? [];
  if (cuotas.length > 0) {
    const fActual = parseFecha(input.actual.fechaEmbarque ?? "") ?? input.actual.fecha;
    const embarcadas = anteriores.map((p) => parseFecha(p.fechaEmbarque ?? "")).filter((d): d is Date => d !== null);
    const vencidas = cuotas.filter((c) => {
      const hasta = parseFecha(c.hasta);
      return hasta !== null && hasta.getTime() < fActual.getTime();
    });
    const incumplidas = vencidas.filter((c) => {
      const desde = parseFecha(c.desde);
      const hasta = parseFecha(c.hasta);
      if (!desde || !hasta) return false;
      return !embarcadas.some((d) => d.getTime() >= desde.getTime() && d.getTime() <= hasta.getTime());
    });
    out.push(
      regla(
        "ucp-32",
        "UCP 600 32",
        "Las cuotas anteriores se embarcaron dentro de su período",
        incumplidas.length === 0 ? "OK" : "DISCREPANCIA",
        incumplidas.length === 0
          ? `${vencidas.length} cuota(s) vencida(s), todas embarcadas en su período`
          : `la cuota ${incumplidas.map((c) => c.referencia).join(", ")} no se embarcó dentro de su período: el crédito deja de estar disponible para esa y para toda cuota posterior`,
      ),
    );
  } else if (
    PARECEN_CUOTAS.test([...(input.lc.condicionesAdicionales ?? []), ...(input.lc.documentosExigidos ?? [])].join(" "))
  ) {
    out.push(
      regla(
        "ucp-32-sin-cargar",
        "UCP 600 32",
        "El crédito parece estipular embarques por cuotas",
        "ATENCION",
        "el calendario de cuotas no está cargado: verificarlo a mano, porque una cuota no embarcada en su período deja el crédito sin disponibilidad para esa y para las siguientes",
      ),
    );
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
