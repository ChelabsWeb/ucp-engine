import { describe, expect, it } from "vitest";
import { avisoDeRechazo, checkingList, plazoDeAviso } from "./checking-list";
import type { ResultadoExamen } from "./examen";
import { quedaEspanol } from "./ingles";
import type { LcInfo } from "./types";

/**
 * Los dos papeles que salen del escritorio.
 *
 * El aviso del artículo 16 no es un resumen: es el documento del que depende que el banco
 * conserve el derecho a alegar el incumplimiento (art. 16f). Por eso lo que se prueba acá es
 * sobre todo qué NO puede decir.
 */

const lc = {
  numero: "LCMRDN25000471",
  moneda: "USD",
  monto: 54150,
  bancoEmisor: "MERIDIAN BANK PLC",
} as LcInfo;

/**
 * Los exámenes de prueba traen los campos completos y no un objeto a medias: `checkingList`
 * recorre los avisos de lectura y lo que queda a mano, y un fixture recortado probaría una hoja
 * que en producción nunca se arma.
 */
const conDiscrepancias = {
  discrepancias: 1,
  faltan: 1,
  atencion: 0,
  diasParaPresentar: 7,
  feePorJuego: 80,
  avisosDeLectura: [
    'FACTURA: Cantidad "53,960" leída como 53.960: 51.262,00 dividido 0,95 da 53.960: la cantidad es 53.960',
  ],
  manuales: [
    {
      que: "Que los ejemplares presentados sean originales: firma, sello o papel membretado del emisor",
      fuente: "UCP 600 17",
      porQue: "un archivo escaneado no permite distinguir un original de una fotocopia",
    },
  ],
  reglas: [
    {
      id: "bl-originales",
      fuente: "46A+2",
      regla: "Full set of 3/3 original bills of lading",
      estado: "FALTA",
      evidencia: "only 2 originals presented",
    },
    {
      id: "flete",
      fuente: "46A+2",
      regla: "Bill of lading marked FREIGHT PREPAID",
      estado: "DISCREPANCIA",
      evidencia: "the bill of lading reads FREIGHT COLLECT",
    },
    { id: "ok", fuente: "32B", regla: "Amount within the credit", estado: "OK", evidencia: "" },
  ],
} as unknown as ResultadoExamen;

const limpio = {
  discrepancias: 0,
  faltan: 0,
  atencion: 0,
  diasParaPresentar: 7,
  feePorJuego: null,
  avisosDeLectura: [],
  manuales: [],
  reglas: [{ id: "ok", fuente: "32B", regla: "Amount within the credit", estado: "OK", evidencia: "" }],
} as unknown as ResultadoExamen;

/** Una fecha de calendario sin la trampa de la zona horaria. */
const dia = (a: number, m: number, d: number) => new Date(a, m - 1, d);

describe("el aviso del artículo 16", () => {
  const base = { fechaPresentacion: dia(2025, 4, 10), destino: "DEVUELVE" as const };

  it("sin discrepancias no existe: un aviso de rechazo sin motivos no se emite", () => {
    expect(avisoDeRechazo(lc, limpio, { ...base, hoy: dia(2025, 4, 11) })).toBeNull();
  });

  it("el plazo es el quinto día hábil siguiente al de la presentación (art. 16d)", () => {
    // jueves 10 de abril de 2025 → viernes 11 (1), lunes 14 (2), martes 15 (3), miércoles 16 (4),
    // jueves 17 (5). El fin de semana no cuenta.
    const a = avisoDeRechazo(lc, conDiscrepancias, { ...base, hoy: dia(2025, 4, 11) })!;
    expect(a.limite.getFullYear()).toBe(2025);
    expect(a.limite.getMonth()).toBe(3);
    expect(a.limite.getDate()).toBe(17);
  });

  it("el último día del plazo todavía está en plazo: el 16d dice «al cierre» del quinto día", () => {
    const a = avisoDeRechazo(lc, conDiscrepancias, { ...base, hoy: dia(2025, 4, 17) })!;
    expect(a.fueraDePlazo).toBe(false);
  });

  it("**un aviso fuera de plazo no puede afirmar que está en plazo**", () => {
    const a = avisoDeRechazo(lc, conDiscrepancias, { ...base, hoy: dia(2025, 4, 18) })!;
    expect(a.fueraDePlazo).toBe(true);
    expect(a.texto).not.toMatch(/within the time limit/i);
    // Y lo dice, con la fecha que era el límite y con la consecuencia del 16(f): el documento
    // tiene que servirle a quien lo firma para saber en qué situación está.
    expect(a.texto).toMatch(/after the time limit|out of time/i);
    expect(a.texto).toContain("16(f)");
  });

  it("un aviso en plazo sí lo afirma, y nombra el artículo", () => {
    const a = avisoDeRechazo(lc, conDiscrepancias, { ...base, hoy: dia(2025, 4, 14) })!;
    expect(a.fueraDePlazo).toBe(false);
    expect(a.texto).toMatch(/within the time limit/i);
    expect(a.texto).toContain("16(d)");
  });

  it("dice las tres cosas que el 16(c) exige, y en ese orden", () => {
    const a = avisoDeRechazo(lc, conDiscrepancias, { ...base, hoy: dia(2025, 4, 14), presentador: "MERIDIAN BANK PLC" })!;
    const t = a.texto;
    // i) que rechaza
    const iRefusa = t.search(/refus/i);
    // ii) cada discrepancia
    const iiDisc = t.indexOf("FREIGHT COLLECT");
    // iii) qué hace con los documentos
    const iiiDocs = t.search(/returning the documents/i);
    expect(iRefusa).toBeGreaterThan(-1);
    expect(iiDisc).toBeGreaterThan(iRefusa);
    expect(iiiDocs).toBeGreaterThan(iiDisc);
  });

  it("invoca cada discrepancia con su evidencia y el campo que la funda", () => {
    const a = avisoDeRechazo(lc, conDiscrepancias, { ...base, hoy: dia(2025, 4, 14) })!;
    expect(a.discrepancias).toBe(2);
    expect(a.texto).toContain("only 2 originals presented");
    expect(a.texto).toContain("46A+2");
    // Lo conforme no va: el aviso invoca los motivos del rechazo, no el examen entero.
    expect(a.texto).not.toContain("Amount within the credit");
  });

  it("advierte que es un aviso único: lo que no se invoque acá no se puede invocar después", () => {
    const a = avisoDeRechazo(lc, conDiscrepancias, { ...base, hoy: dia(2025, 4, 14) })!;
    expect(a.texto).toMatch(/single notice/i);
  });

  it("dice que el plazo no considera feriados bancarios, porque el motor no los conoce", () => {
    const a = avisoDeRechazo(lc, conDiscrepancias, { ...base, hoy: dia(2025, 4, 14) })!;
    expect(a.texto).toMatch(/bank holidays|banking holidays/i);
  });

  it("va en inglés: se transmite a un banco que puede estar en cualquier parte", () => {
    const a = avisoDeRechazo(lc, conDiscrepancias, { ...base, hoy: dia(2025, 4, 14) })!;
    expect(a.texto).toContain("NOTICE OF REFUSAL");
    expect(a.texto).not.toMatch(/RECHAZAMOS|discrepancias/);
  });

  it("las fechas también van en inglés y con el año entero", () => {
    const a = avisoDeRechazo(lc, conDiscrepancias, { ...base, hoy: dia(2025, 4, 14) })!;
    // Un aviso en inglés fechado «14-abr-25» obliga al que lo recibe a adivinar el mes.
    expect(a.texto).toContain("14-Apr-2025");
    expect(a.texto).toContain("10-Apr-2025");
    expect(a.texto).toContain("17-Apr-2025");
    expect(a.texto).not.toMatch(/-abr-|-ene-|-ago-|-dic-/);
  });

  it("ninguna línea se pasa de 96 columnas: se pega en un correo o se transmite tal cual", () => {
    for (const destino of ["RETIENE_ESPERANDO_DISPENSA", "DEVUELVE"] as const) {
      const a = avisoDeRechazo(lc, conDiscrepancias, { ...base, hoy: dia(2025, 4, 14), destino })!;
      const largas = a.texto.split("\n").filter((l) => l.length > 96);
      expect(largas).toEqual([]);
    }
  });

  it("no queda español en el aviso: se transmite a un banco que no lo lee", () => {
    const a = avisoDeRechazo(lc, conDiscrepancias, { ...base, hoy: dia(2025, 4, 14) })!;
    // Línea por línea, para que el fallo diga cuál. Lo entrecomillado es cita y no cuenta.
    const conEspanol = a.texto.split("\n").filter((l) => quedaEspanol(l) !== null);
    expect(conEspanol).toEqual([]);
  });

  it("cada destino del 16(c)(iii) tiene su texto y ninguno se queda sin decir", () => {
    const destinos = [
      "RETIENE_ESPERANDO_INSTRUCCIONES",
      "RETIENE_ESPERANDO_DISPENSA",
      "DEVUELVE",
      "SEGUN_INSTRUCCIONES_PREVIAS",
    ] as const;
    for (const destino of destinos) {
      const a = avisoDeRechazo(lc, conDiscrepancias, { ...base, hoy: dia(2025, 4, 14), destino })!;
      expect(a.texto.length).toBeGreaterThan(200);
      expect(a.texto).toContain("16(c)(iii)");
    }
  });
});

describe("la hoja de revisión", () => {
  const enc = { fechaPresentacion: dia(2025, 4, 10), examinador: "Ana Rodríguez", presentador: "MERIDIAN BANK PLC" };

  it("agrupa los renglones y trae todos los estados, no solo los hallazgos", () => {
    const h = checkingList(lc, conDiscrepancias, enc);
    expect(h).toContain("Amount within the credit");
    expect(h).toContain("FREIGHT COLLECT");
    expect(h).toContain("LCMRDN25000471");
  });

  it("nunca dice que la presentación está conforme", () => {
    const h = checkingList(lc, limpio, enc);
    expect(h).not.toMatch(/\bcomplying presentation\b|\bis compliant\b|\bconforme\b/i);
  });

  it("va en inglés y nombra a quien examinó: es el papel que se firma", () => {
    const h = checkingList(lc, conDiscrepancias, enc);
    expect(h).toContain("Ana Rodríguez");
    expect(h).toMatch(/DOCUMENT EXAMINATION|CHECKING/i);
  });

  it("tampoco en la hoja de revisión, ni en lo que queda a la persona", () => {
    const conEspanol = checkingList(lc, conDiscrepancias, enc)
      .split("\n")
      .filter((l) => quedaEspanol(l) !== null);
    expect(conEspanol).toEqual([]);
  });

  it("fecha en inglés, como el resto de la hoja", () => {
    const h = checkingList(lc, conDiscrepancias, enc);
    expect(h).toContain("10-Apr-2025");
    expect(h).not.toMatch(/-abr-/);
  });
});

describe("el reloj del artículo 16(d)", () => {
  const dia = (a: number, m: number, d: number) => new Date(a, m - 1, d);
  // jueves 10-abr-2025 → el quinto día hábil siguiente es el jueves 17
  const presentado = dia(2025, 4, 10);

  it("el día de la presentación quedan los cinco días", () => {
    const p = plazoDeAviso(presentado, presentado);
    expect(p.habilesRestantes).toBe(5);
    expect(p.vencido).toBe(false);
  });

  it("el fin de semana no descuenta", () => {
    // viernes 11: quedan lunes, martes, miércoles, jueves → 4
    expect(plazoDeAviso(presentado, dia(2025, 4, 11)).habilesRestantes).toBe(4);
    // sábado 12 y domingo 13: siguen quedando los mismos 4
    expect(plazoDeAviso(presentado, dia(2025, 4, 12)).habilesRestantes).toBe(4);
    expect(plazoDeAviso(presentado, dia(2025, 4, 13)).habilesRestantes).toBe(4);
    expect(plazoDeAviso(presentado, dia(2025, 4, 14)).habilesRestantes).toBe(3);
  });

  it("el último día devuelve cero, no uno: hoy se vence", () => {
    const p = plazoDeAviso(presentado, dia(2025, 4, 17));
    expect(p.habilesRestantes).toBe(0);
    expect(p.vencido).toBe(false);
  });

  it("pasado el límite cuenta en negativo cuántos hábiles se pasó", () => {
    expect(plazoDeAviso(presentado, dia(2025, 4, 18)).habilesRestantes).toBe(-1);
    expect(plazoDeAviso(presentado, dia(2025, 4, 18)).vencido).toBe(true);
    // 19 y 20 son sábado y domingo: el lunes 21 son dos hábiles pasados
    expect(plazoDeAviso(presentado, dia(2025, 4, 21)).habilesRestantes).toBe(-2);
  });

  it("el límite coincide con el del aviso: una sola cuenta, no dos", () => {
    const a = avisoDeRechazo(lc, conDiscrepancias, {
      fechaPresentacion: presentado,
      hoy: dia(2025, 4, 14),
      destino: "DEVUELVE",
    })!;
    expect(plazoDeAviso(presentado, dia(2025, 4, 14)).limite.getTime()).toBe(a.limite.getTime());
  });
});
