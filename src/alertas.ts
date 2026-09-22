import { diffDias, isoMontevideo, parseFecha } from "./fechas";
import { avisoAseguradora, diasParaPresentar, limitePresentacion } from "./lc";
import type { Contenedor, GlobalAlert, OperationDetail, Recordatorio } from "./types";

/**
 * Motor de alertas (etapa 1): deriva las alertas de los DATOS de la
 * operación — nada de listas fijas. "Avisa antes de que cueste plata"
 * vale también para las operaciones que carga el usuario (PRD §3).
 * Puro: recibe la ficha y la fecha de hoy, devuelve GlobalAlert[].
 */

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/* La fecha del vencimiento que la alerta describe, en ISO. El TÍTULO ya la
   dice en corto para el humano; esta es para ORDENAR y para que el listado
   pueda mostrar el motivo al lado del cuándo. Antes se calculaba, se usaba
   para decidir la severidad y se tiraba. */
const iso = (d: Date) => isoMontevideo(d);
const corta = (d: Date) => `${String(d.getDate()).padStart(2, "0")}-${MESES[d.getMonth()]}`;

const CERRADAS = new Set(["ENTREGADA", "COBRADA", "CANCELADA"]);

/** Días desde el embarque a partir de los cuales una operación IMPORTADA del ERP deja de ser
 *  trabajo pendiente y pasa a ser backlog heredado. Dos meses cubre el tránsito más largo que hace
 *  Cerealsur (Montevideo → Asia) más el cobro. Solo aplica a lo importado: una operación creada
 *  acá que se atrasó 70 días es exactamente la que más necesita el aviso. */
const DIAS_FUERA_DE_JUEGO = 60;

/** Recordatorios comerciales vencidos → alertas (ADR-004: "se caen cosas de la mesa"). */
export function alertasDeRecordatorios(recordatorios: Recordatorio[], hoy: Date): GlobalAlert[] {
  const alertas: GlobalAlert[] = [];
  for (const r of recordatorios) {
    if (r.hecho) continue;
    const fecha = parseFecha(r.fecha);
    if (!fecha || diffDias(fecha, hoy) < 0) continue;
    alertas.push({
      severidad: "MEDIA",
      tipo: "RIESGO",
      // el seguimiento tiene su cuándo: en el tickler cae en la banda que le toca
      fecha: iso(fecha),
      operacion: r.contraparte ?? "Comercial",
      titulo: `Seguimiento: ${r.nota}`,
      detalle: `Vencía el ${r.fecha}. Se resuelve desde la ficha de la contraparte o desde Alertas.`,
    });
  }
  return alertas;
}

const PESO: Record<GlobalAlert["severidad"], number> = { CRITICA: 0, ALTA: 1, MEDIA: 2, INFO: 3 };

/** Orden del panel: lo que puede costar plata primero (sort estable). */
export function ordenarAlertas(alertas: GlobalAlert[]): GlobalAlert[] {
  return [...alertas].sort((a, b) => PESO[a.severidad] - PESO[b.severidad]);
}

/** La peor severidad abierta — el conteo de alertas de un listado hereda su tono. */
export function peorSeveridad(alertas: GlobalAlert[]): GlobalAlert["severidad"] | null {
  return ordenarAlertas(alertas)[0]?.severidad ?? null;
}

export function generarAlertasDeOperacion(op: OperationDetail, hoy: Date): GlobalAlert[] {
  /* lo cerrado no molesta: la plata ya entró (o ya no va a entrar) */
  if (CERRADAS.has(op.estado)) return [];
  const alertas: GlobalAlert[] = [];

  /* embarque estimado vs límite de embarque de la LC — el clásico que cuesta
     plata. Si la matriz ya levantó esta discrepancia (con acción accionable),
     manda la discrepancia; la regla de fechas es el fallback sin matriz. */
  const embarque = op.fechaEmbarque ? parseFecha(op.fechaEmbarque) : null;
  const limite = op.lc ? parseFecha(op.lc.limiteEmbarque) : null;
  const limiteEnMatriz = op.discrepancias.some((d) => d.titulo.includes("límite de la LC"));
  if (embarque && limite && embarque > limite && !limiteEnMatriz) {
    alertas.push({
      severidad: "CRITICA",
      tipo: "VENCIMIENTO",
      operacion: op.codigo,
      fecha: iso(limite),
      titulo: `Embarque estimado (${corta(embarque)}) posterior al límite de la LC (${corta(limite)})`,
      detalle: "Adelantar el booking o pedir enmienda de la LC antes del cut-off.",
    });
  }

  /* vencimiento de la LC encima: sin presentación a tiempo no hay cobro */
  const vencimiento = op.lc ? parseFecha(op.lc.vencimiento) : null;
  if (op.lc && vencimiento) {
    const dias = diffDias(hoy, vencimiento);
    if (dias >= 0 && dias <= 14) {
      alertas.push({
        severidad: "ALTA",
        tipo: "VENCIMIENTO",
        operacion: op.codigo,
        fecha: iso(vencimiento),
        titulo: `La LC ${op.lc.numero} vence en ${dias} días (${corta(vencimiento)})`,
        detalle: "Coordinar la presentación de documentos al banco antes del vencimiento.",
      });
    }
  }

  /* plazo de presentación al banco (UCP 600 art. 14c): BL + N días, y NUNCA después
     del vencimiento. Con BL real (zarpe del seguimiento) la fecha es firme; con el
     embarque estimado solo se avisa si el vencimiento recorta el plazo — Etapa 2 */
  const pres = limitePresentacion(op.lc, op.blReal, op.fechaEmbarque);
  if (op.lc && pres) {
    const base = pres.esEstimada ? `embarque estimado del ${corta(pres.fechaBL)}` : `BL del ${corta(pres.fechaBL)}`;
    const dias = diasParaPresentar(pres, hoy);
    const ventana = diffDias(pres.fechaBL, pres.limite);
    const faltan = op.checklist
      .filter((c) => c.exigidoPorLC && c.estado !== "COMPLETO" && c.estado !== "NO_APLICA")
      .map((c) => c.label);
    const queFalta = faltan.length ? ` Exigidos por la LC y todavía no completos: ${faltan.join(" · ")}.` : "";
    if (!pres.esEstimada && dias < 0) {
      // con BL real, el límite ya pasó: manda esto por encima de cualquier recorte (revisor M1)
      alertas.push({
        severidad: "CRITICA",
        tipo: "VENCIMIENTO",
        operacion: op.codigo,
        fecha: iso(pres.limite),
        titulo: `Plazo de presentación al banco vencido el ${corta(pres.limite)} (${base}${pres.recortadoPorVencimiento ? ", recortado por el vencimiento de la LC" : ` + ${pres.dias} días`})`,
        detalle: `Los documentos llegan tarde al banco: negociar la aceptación con discrepancia o pedir enmienda.${queFalta}`,
      });
    } else if (pres.recortadoPorVencimiento) {
      alertas.push({
        severidad: ventana < 0 ? "CRITICA" : "ALTA",
        tipo: "VENCIMIENTO",
        operacion: op.codigo,
        fecha: iso(pres.limite),
        titulo:
          ventana < 0
            ? `La LC ${op.lc.numero} vence (${corta(pres.limite)}) antes del ${base}: no hay cómo presentar a tiempo`
            : `Presentar al banco antes del ${corta(pres.limite)}: el vencimiento de la LC recorta el plazo de ${pres.dias} a ${ventana} días`,
        detalle: `Pedir enmienda del vencimiento de la LC o adelantar el embarque — con el plazo recortado cualquier demora documental deja el cobro afuera.${pres.esEstimada ? "" : queFalta}`,
      });
    } else if (!pres.esEstimada && dias <= 10) {
      alertas.push({
        severidad: "ALTA",
        tipo: "VENCIMIENTO",
        operacion: op.codigo,
        fecha: iso(pres.limite),
        titulo: `Presentar documentos al banco antes del ${corta(pres.limite)} (${dias} días · ${base} + ${pres.dias})`,
        detalle: faltan.length
          ? `Exigidos por la LC y todavía no completos: ${faltan.join(" · ")}`
          : "El paquete exigido por la LC está completo: presentar.",
      });
    }
  }

  /* caso CSU2025099 (47A): la LC obliga a avisar a la aseguradora del comprador dentro de N días
     del embarque, con póliza, y un certificado de ese aviso viaja con los documentos — sin eso el
     banco lo cuenta como discrepancia. Con BL real la cuenta arranca; se avisa hasta que pase. */
  const aviso = avisoAseguradora(op.lc?.condicionesAdicionales);
  if (aviso && op.blReal) {
    const bl = parseFecha(op.blReal);
    if (bl) {
      const limite = new Date(bl.getFullYear(), bl.getMonth(), bl.getDate() + aviso.dias);
      const dias = diffDias(hoy, limite);
      const quien = aviso.email ? ` (${aviso.email})` : "";
      if (dias >= 0) {
        alertas.push({
          severidad: dias <= 2 ? "ALTA" : "MEDIA",
          tipo: "FALTANTE",
          operacion: op.codigo,
          fecha: iso(limite),
          titulo: `Avisar a la aseguradora del comprador antes del ${corta(limite)}${aviso.poliza ? ` · póliza ${aviso.poliza}` : ""}`,
          detalle: `La LC exige avisar los datos del embarque dentro de los ${aviso.dias} días del BL${quien} y presentar el certificado de ese aviso con los documentos.`,
        });
      } else if (dias >= -30) {
        alertas.push({
          severidad: "ALTA",
          tipo: "FALTANTE",
          operacion: op.codigo,
          fecha: iso(limite),
          titulo: `El plazo para avisar a la aseguradora venció el ${corta(limite)}: confirmar que se hizo`,
          detalle: `Si no se avisó${quien}, el certificado que exige la LC no va a estar y el banco lo marca como discrepancia.`,
        });
      }
    }
  }

  /* caso CSU2025099: el booking fija el cut-off documental (SI) — si llega y las instrucciones
     de embarque no salieron, el contenedor no sube. Y el buque puede cambiar entre el booking
     (Ever Linking) y el BL (Log-In Endurance): hay que avisar al cliente y revisar la ETA. */
  const emb = op.embarque;
  if (emb?.cutoffDocumental) {
    const co = parseFecha(emb.cutoffDocumental);
    const instr =
      op.documentos.find((d) => d.nombre === "Shipping instructions") ??
      op.documentos.find((d) => d.nombre === "Instrucciones de embarque");
    const salieron = Boolean(
      instr && (instr.estado === "ENVIADO" || instr.estado === "VALIDADO" || instr.estado === "APROBADO"),
    );
    if (co && !salieron && !op.blReal) {
      const dias = diffDias(hoy, co);
      if (dias < 0) {
        alertas.push({
          severidad: "CRITICA",
          tipo: "VENCIMIENTO",
          operacion: op.codigo,
          fecha: iso(co),
          titulo: `Cut-off documental vencido el ${corta(co)} y las instrucciones de embarque no salieron`,
          detalle:
            "Sin shipping instructions a tiempo la naviera no emite el BL con esa carga: confirmar con el forwarder si entró en el corte o hay que rebookear.",
        });
      } else if (dias <= 3) {
        alertas.push({
          severidad: "ALTA",
          tipo: "FALTANTE",
          operacion: op.codigo,
          fecha: iso(co),
          titulo: `Cut-off documental en ${dias} días (${corta(co)}): mandar las instrucciones de embarque`,
          detalle: "La naviera necesita las shipping instructions antes del cut-off documental (SI) del booking.",
        });
      }
    }
  }
  /* B3: cut-off VGM — sin peso bruto verificado (bruto + tara) por contenedor, la naviera no lo
     embarca. Se avisa 3 días antes si algún contenedor no tiene bruto o tara. */
  if (emb?.cutoffVgm && !op.blReal) {
    const cv = parseFecha(emb.cutoffVgm);
    const conts = op.contenedores ?? [];
    const sinVgm = conts.length ? conts.filter((c) => c.pesoBrutoKg == null || c.taraKg == null) : null;
    if (cv && (sinVgm === null || sinVgm.length > 0)) {
      const dias = diffDias(hoy, cv);
      // el título no lleva el conteo: cambia al cargar cada contenedor y `sincronizarAlertas`
      // lo tomaría como una alerta distinta (la clave neutraliza dígitos, no plurales)
      const que =
        sinVgm === null
          ? "no hay contenedores cargados"
          : `${sinVgm.length} contenedor${sinVgm.length > 1 ? "es" : ""} sin peso bruto o tara`;
      if (dias < 0 && dias >= -30) {
        alertas.push({
          severidad: "CRITICA",
          tipo: "VENCIMIENTO",
          operacion: op.codigo,
          fecha: iso(cv),
          titulo: `Cut-off VGM vencido el ${corta(cv)} sin el peso verificado`,
          detalle: `Sin VGM declarado (SOLAS) el contenedor no sube al buque: ${que}. Confirmar con el forwarder si se declaró por otra vía.`,
        });
      } else if (dias >= 0 && dias <= 3) {
        alertas.push({
          severidad: "ALTA",
          tipo: "FALTANTE",
          operacion: op.codigo,
          fecha: iso(cv),
          titulo: `Cut-off VGM en ${dias} días (${corta(cv)}): falta el peso verificado`,
          detalle: `${que}. Cargar bruto y tara por contenedor en Contenedores y lotes; el VGM se calcula solo y va en las shipping instructions.`,
        });
      }
    }
  }
  /* B5: la mercadería vence. Si el lote llega al destino con poca vida útil por delante, el
     cliente reclama (o la aduana lo rechaza): se compara el vencimiento del lote contra la ETA
     más el tránsito interior, con el mínimo habitual de 6 meses de vida remanente. */
  const MESES_VIDA_MINIMA = 6;
  const DIAS_TRANSITO_INTERIOR = 15;
  const eta = emb?.eta ? parseFecha(emb.eta) : null;
  if (eta) {
    const conts = (op.contenedores ?? []).filter((c) => c.vencimiento);
    const criticos = conts
      .map((c) => ({ c, vence: parseFecha(c.vencimiento!) }))
      .filter((x): x is { c: Contenedor; vence: Date } => x.vence != null)
      .map((x) => ({
        ...x,
        mesesAlLlegar:
          diffDias(new Date(eta.getFullYear(), eta.getMonth(), eta.getDate() + DIAS_TRANSITO_INTERIOR), x.vence) / 30.4,
      }))
      .filter((x) => x.mesesAlLlegar < MESES_VIDA_MINIMA)
      .sort((a, b) => a.mesesAlLlegar - b.mesesAlLlegar);
    if (criticos.length) {
      const peor = criticos[0];
      const meses = Math.max(0, Math.round(peor.mesesAlLlegar * 10) / 10);
      alertas.push({
        severidad: peor.mesesAlLlegar <= 0 ? "CRITICA" : peor.mesesAlLlegar < 3 ? "ALTA" : "MEDIA",
        tipo: "RIESGO",
        operacion: op.codigo,
        titulo:
          peor.mesesAlLlegar <= 0
            ? `El lote vence antes de llegar (${corta(peor.vence)})`
            : `El lote llega con poca vida útil: ${meses} meses`,
        detalle: `${criticos.length} contenedor${criticos.length > 1 ? "es" : ""} (${criticos.map((x) => `${x.c.numero} vence ${corta(x.vence)}`).join(", ")}) contra una ETA del ${corta(eta)} más ${DIAS_TRANSITO_INTERIOR} días de tránsito interior. Lo habitual es exigir ${MESES_VIDA_MINIMA} meses de vida útil: confirmar con el cliente antes de embarcar.`,
      });
    }
  }
  if (emb?.buque && emb.buqueBooking && emb.buque.trim().toLowerCase() !== emb.buqueBooking.trim().toLowerCase()) {
    alertas.push({
      severidad: "MEDIA",
      tipo: "RIESGO",
      operacion: op.codigo,
      titulo: `El buque cambió: booking ${emb.buqueBooking}, embarque ${emb.buque}`,
      detalle:
        "Avisar al cliente y revisar la ETA; si la LC nombra el buque o el BL ya se presentó, puede hacer falta enmienda.",
    });
  }

  /* checklist con pendientes y el embarque encima: los certificados
     (sanitario, halal…) tienen plazos de trámite reales */
  if (embarque) {
    const dias = diffDias(hoy, embarque);
    const pendientes = op.checklist.filter((r) => r.estado === "PENDIENTE");
    if (dias >= 0 && dias <= 30 && pendientes.length > 0) {
      const n = pendientes.length;
      alertas.push({
        severidad: "MEDIA",
        tipo: "FALTANTE",
        operacion: op.codigo,
        titulo:
          n === 1
            ? `Falta 1 documento del checklist — embarque en ${dias} días`
            : `Faltan ${n} documentos del checklist — embarque en ${dias} días`,
        detalle: pendientes.map((r) => r.label).join(" · "),
      });
    }
  }

  /* "ya cargaste tal contrato, fijate" (ADR-004): el negocio está en marcha
     y el contrato ni se generó — solo los contratos, no todo el paquete.

     "En marcha" es literal, y hay que decirlo: el ERP dejó 302 operaciones en estado activo con
     el embarque vencido, la más vieja de 2017. Sin este corte la regla emitía 604 alertas de
     contrato el primer día, todas sobre negocios que terminaron hace años, y una bandeja de 604
     avisos que nadie va a leer es peor que ninguna: tapa las diez que sí importan. El backlog
     viejo no desaparece, se cuenta en el panel ("Con embarque vencido") y se pregunta en
     `pendientes.md` §B10.

     El corte es SOLO para lo importado (auditoría del 14-sep): la primera versión lo aplicaba a
     toda operación, y con eso una creada en romai que se atrasara más de dos meses perdía el
     aviso justo cuando más lo necesita. */
  const embarcoHaceMucho = op.importada === true && embarque != null && diffDias(embarque, hoy) > DIAS_FUERA_DE_JUEGO;
  if (op.estado !== "BORRADOR" && !embarcoHaceMucho) {
    for (const doc of op.documentos) {
      if (doc.estado === "PENDIENTE" && doc.nombre.startsWith("Contrato de")) {
        alertas.push({
          severidad: "MEDIA",
          tipo: "FALTANTE",
          operacion: op.codigo,
          titulo: `Falta generar el ${doc.nombre}`,
          detalle: "La operación está en marcha y el contrato todavía no se generó — pestaña Documentos de la ficha.",
        });
      }
    }
  }

  /* discrepancias abiertas de la matriz: la consistencia ES una alerta;
     resolverla (correo de enmienda, corrección) la baja del panel */
  for (const d of op.discrepancias) {
    alertas.push({
      severidad: d.severidad,
      tipo: "INCONSISTENCIA",
      operacion: op.codigo,
      titulo: d.titulo,
      detalle: d.detalle,
    });
  }

  return alertas;
}

/**
 * El próximo hito de una operación: de las alertas que tienen fecha, la más
 * cercana. Es lo que el listado muestra al lado del «cuándo» para que la fila
 * diga POR QUÉ, y no obligue a abrir la ficha para enterarse.
 *
 * Las alertas sin fecha (un faltante, un riesgo comercial) no compiten acá: no
 * son un vencimiento, y meterlas con una fecha inventada sería mentir sobre
 * cuándo hay que hacer algo.
 */
export function proximoHito(
  alertas: GlobalAlert[],
): { fecha: string; motivo: string; severidad: GlobalAlert["severidad"] } | null {
  const conFecha = alertas.filter((a): a is GlobalAlert & { fecha: string } => Boolean(a.fecha));
  if (!conFecha.length) return null;
  /* la más cercana en el tiempo; a igual fecha, la más grave */
  const mejor = [...conFecha].sort(
    (a, b) => a.fecha.localeCompare(b.fecha) || PESO[a.severidad] - PESO[b.severidad],
  )[0];
  return { fecha: mejor.fecha, motivo: mejor.titulo, severidad: mejor.severidad };
}
