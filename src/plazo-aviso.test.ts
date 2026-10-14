import { describe, expect, it } from "vitest";
import { contextoDesdeSwift, examinarPresentacion } from "./examen";
import { DOCUMENTOS_CSU2025099, SWIFT_CSU2025099 } from "./fixtures";
import { reglasDeGiro } from "./presentaciones";
import { parseMT700 } from "./swift-lc";
import type { LcInfo } from "./types";

/**
 * El reloj del artículo 16 (d), dentro del examen.
 *
 * Reproducido antes de escribir la regla: un examen corrido veinte días después de recibidos los
 * documentos devolvía 47 reglas y **ninguna mencionaba el artículo 16**. El banco ve un veredicto
 * con discrepancias y el producto no le dice que ya perdió el derecho a invocarlas.
 *
 * Es lo más caro del dominio. En *Fortis Bank v Indian Overseas Bank* el emisor pagó USD 8,06
 * millones porque dijo que devolvía los documentos y los devolvió tres meses después: las
 * discrepancias eran buenas y el 16 (f) las volvió irrelevantes.
 *
 * El motor ya conocía el plazo —lo usa al redactar el aviso de rechazo— pero eso es un paso
 * después, y solo si alguien va a redactarlo. El examen es donde el examinador mira.
 */

/* Un crédito vivo y corriente: lo que interesa es el reloj, no el crédito. */
const lc = {
  numero: "X",
  monto: 100000,
  moneda: "USD",
  tolerancia: 0.05,
  vencimiento: "30-dic-26",
  limiteEmbarque: "30-oct-26",
  plazoPresentacion: "21 días desde la fecha de embarque (campo 48)",
  documentosExigidos: [],
  condicionesAdicionales: [],
} as unknown as LcInfo;
const giro = (fecha: string) => ({ referencia: "X-1", fecha: new Date(`${fecha}T12:00:00`), importe: null });
const correr = (recibida: string, hoy: string) =>
  reglasDeGiro({ lc, actual: giro(recibida), hoy: new Date(`${hoy}T12:00:00`) } as never);

const plazo = (recibida: string, hoy: string) => correr(recibida, hoy).find((r) => r.id === "aviso-16d");

describe("el reloj del aviso de rechazo", () => {
  it("con días por delante, dice cuántos quedan", () => {
    /* lunes 6 de abril recibido, miércoles 8: quedan el 8, 9 y 10 */
    const r = plazo("2026-04-06", "2026-04-08");
    expect(r?.estado).toBe("OK");
    expect(r?.evidencia).toMatch(/3 d[ií]as h[áa]biles/);
  });

  it("el último día avisa, porque ese día la hora decide", () => {
    /* Recibida el lunes 6: los cinco hábiles son 7, 8, 9, 10 y 13. El último es el lunes 13. */
    const r = plazo("2026-04-06", "2026-04-13");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.regla).toMatch(/hoy/i);
  });

  it("pasado el plazo dice que el banco quedó precluido", () => {
    const r = plazo("2026-04-06", "2026-04-20");
    expect(r?.estado).toBe("DISCREPANCIA");
    expect(r?.fuente).toContain("16");
    expect(r?.regla).toMatch(/precluid/i);
  });

  it("cuenta días hábiles y no corridos: el fin de semana no gasta plazo", () => {
    /* viernes 3 recibido; el lunes 6 todavía quedan cuatro de los cinco */
    const r = plazo("2026-04-03", "2026-04-06");
    expect(r?.evidencia).toMatch(/4 d[ií]as h[áa]biles/);
  });

  it("sin saber qué día es hoy, no inventa un plazo", () => {
    /* `hoy` es opcional y hay llamadores que no lo pasan. Sin él el reloj no se puede calcular, y
       calcularlo contra el reloj del proceso sería lo que este repositorio ya pagó una vez con el
       artículo 33: la hora del servidor no es la hora del banco. */
    const r = reglasDeGiro({ lc, actual: giro("2026-04-06") } as never);
    expect(r.find((x) => x.id === "aviso-16d")).toBeUndefined();
  });
});

/*
 * Que el examen entero le pase el día, y no solo que la regla sepa calcularlo.
 *
 * Verificado con mutante, y la primera versión no mordía: sacando `hoy: input.hoy` de la llamada a
 * `reglasDeGiro` los 1223 tests seguían en verde, porque todos los demás le pasaban el dato a la
 * regla a mano. Una regla que el producto no alcanza es el defecto que más veces apareció en este
 * repositorio, y acá lo cometí arreglándolo.
 */
describe("el examen completo dice lo del artículo 16", () => {
  const corrido = (recibida: string, hoy: string) => {
    const c = parseMT700(SWIFT_CSU2025099);
    if (!c) throw new Error("no se pudo leer el crédito de muestra");
    const docs = Object.entries(DOCUMENTOS_CSU2025099).map(([tipo, campos]) => ({ tipo, campos }));
    return examinarPresentacion({
      lc: c.lc,
      credito: contextoDesdeSwift(c),
      docs,
      certificados: [],
      anteriores: [],
      feriados: [],
      horario: null,
      cuotas: [],
      bicPropio: null,
      seguro: undefined,
      presentacion: { referencia: "X-1", fecha: new Date(`${recibida}T12:00:00`), importe: null },
      hoy: new Date(`${hoy}T12:00:00`),
      empresaRazonSocial: "",
      empresaDireccion: null,
    } as never);
  };

  it("corrido a tiempo, el reloj aparece y está en verde", () => {
    const r = corrido("2025-04-08", "2025-04-09").reglas.find((x) => x.id === "aviso-16d");
    expect(r?.estado).toBe("OK");
  });

  it("corrido tarde, dice que el banco quedó precluido", () => {
    const r = corrido("2025-04-08", "2025-04-28").reglas.find((x) => x.id === "aviso-16d");
    expect(r?.estado).toBe("DISCREPANCIA");
    expect(r?.fuente).toBe("UCP 600 16d y 16f");
    expect(r?.evidencia).toMatch(/16 \(f\)/);
  });
});
