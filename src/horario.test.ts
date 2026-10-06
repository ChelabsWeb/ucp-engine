import { describe, expect, it } from "vitest";
import { SWIFT_CSU2025099 } from "./fixtures";
import { presentacionEfectiva, reglasDeGiro } from "./presentaciones";
import { parseMT700 } from "./swift-lc";

/**
 * Cuándo cuenta como presentado un juego de documentos (UCP 600 art. 33).
 *
 * «A bank has no obligation to accept a presentation outside of its banking hours.» Dicho al revés:
 * lo que se entrega fuera del horario cuenta como presentado **el día hábil siguiente**.
 *
 * No es un detalle de trámite: unos documentos dejados a las 18:00 del día del vencimiento llegaron
 * tarde, y el sello de recepción que dice «30-abr 18:00» está registrando una presentación que
 * legalmente es del 2 de mayo. Al revés también importa — un examinador que cuenta ese día como
 * bueno le está dando al beneficiario un plazo que no tiene.
 *
 * El horario de cada banco no se puede adivinar, así que cuando no se carga el motor no corre nada
 * y lo dice. Inventar un horario de atención sería peor: decidiría sobre plata con un dato supuesto.
 */

const el = (iso: string) => new Date(iso);
const HORARIO = { abre: "09:00", cierra: "17:00" };

describe("dentro del horario", () => {
  it("una entrega a media mañana cuenta ese mismo día", () => {
    const r = presentacionEfectiva(el("2025-04-30T10:30:00"), HORARIO, [], "10:30");
    expect(r.corrida).toBe(false);
    expect(r.motivo).toBe("EN_HORARIO");
    expect(r.efectiva.getDate()).toBe(30);
  });

  it("justo a la hora de cierre todavía entra", () => {
    // El banco atiende hasta las 17:00: a las 17:00 está abierto.
    expect(presentacionEfectiva(el("2025-04-30T17:00:00"), HORARIO, [], "17:00").corrida).toBe(false);
  });
});

describe("fuera del horario", () => {
  it("una entrega después del cierre cuenta el día siguiente", () => {
    const r = presentacionEfectiva(el("2025-04-30T18:00:00"), HORARIO, [], "18:00");
    expect(r.corrida).toBe(true);
    expect(r.motivo).toBe("FUERA_DE_HORARIO");
    expect(r.efectiva.getDate()).toBe(1);
    expect(r.efectiva.getMonth()).toBe(4); // mayo
  });

  it("y una antes de abrir, también: el banco no estaba atendiendo", () => {
    const r = presentacionEfectiva(el("2025-04-30T07:00:00"), HORARIO, [], "07:00");
    expect(r.corrida).toBe(true);
    expect(r.motivo).toBe("FUERA_DE_HORARIO");
  });

  it("si el día siguiente es sábado, se corre al lunes", () => {
    // Viernes 2 de mayo de 2025 a las 18:30 → lunes 5.
    const r = presentacionEfectiva(el("2025-05-02T18:30:00"), HORARIO, [], "18:30");
    expect(r.efectiva.getDate()).toBe(5);
  });

  it("y los feriados cargados también se saltean", () => {
    const r = presentacionEfectiva(el("2025-04-30T18:00:00"), HORARIO, [el("2025-05-01T00:00:00")], "18:00");
    expect(r.efectiva.getDate()).toBe(2);
  });
});

describe("el día en que el banco no abre", () => {
  it("entregada un sábado, cuenta el lunes, aunque la hora esté dentro del horario", () => {
    // Sábado 3 de mayo de 2025.
    const r = presentacionEfectiva(el("2025-05-03T10:00:00"), HORARIO, [], "10:00");
    expect(r.corrida).toBe(true);
    expect(r.motivo).toBe("DIA_CERRADO");
    expect(r.efectiva.getDate()).toBe(5);
  });

  it("y un feriado cargado, igual", () => {
    const r = presentacionEfectiva(el("2025-05-01T10:00:00"), HORARIO, [el("2025-05-01T00:00:00")], "10:00");
    expect(r.motivo).toBe("DIA_CERRADO");
    expect(r.efectiva.getDate()).toBe(2);
  });
});

describe("sin horario cargado", () => {
  it("no se corre nada: el motor no inventa un horario de atención", () => {
    const r = presentacionEfectiva(el("2025-04-30T23:00:00"), null, [], "23:00");
    expect(r.corrida).toBe(false);
    expect(r.motivo).toBe("SIN_HORARIO");
    expect(r.efectiva.getDate()).toBe(30);
  });

  it("pero el día cerrado se sigue viendo, que eso no necesita horario", () => {
    // Un sábado es un sábado en cualquier plaza.
    const r = presentacionEfectiva(el("2025-05-03T10:00:00"), null, [], "10:00");
    expect(r.motivo).toBe("DIA_CERRADO");
    expect(r.efectiva.getDate()).toBe(5);
  });
});

describe("el horario decide si la presentación llegó a tiempo", () => {
  /*
   * Lo que importa del artículo 33 no es la nota: es que **mueva la fecha** con la que se compara
   * el vencimiento. Si quedara como un aviso al costado, el examen seguiría diciendo que una
   * presentación entregada a las 18:00 del día del vencimiento llegó en plazo.
   *
   * El crédito real vence el 30 de junio de 2025, que es lunes.
   */
  const LC = parseMT700(SWIFT_CSU2025099)!.lc;
  const HORARIO = { abre: "09:00", cierra: "17:00" };

  const alVencimiento = (hora: string, horario?: { abre: string; cierra: string }) =>
    reglasDeGiro({
      lc: LC,
      actual: {
        referencia: `${LC.numero}-1`,
        fecha: new Date("2025-06-30T12:00:00"),
        importe: 51262,
        fechaEmbarque: "08-abr-25",
        // la hora va como dato del sello, no metida en el instante
        horaDeRecepcion: hora,
      },
      horario,
    });

  it("entregada a las 10:00 del día del vencimiento, está en plazo", () => {
    const r = alVencimiento("10:00", HORARIO).find((x) => x.id === "giro-vencimiento");
    expect(r?.estado).toBe("OK");
  });

  it("entregada a las 18:00 del mismo día, NO: cuenta como del día siguiente", () => {
    const r = alVencimiento("18:00", HORARIO).find((x) => x.id === "giro-vencimiento");
    expect(r?.estado).not.toBe("OK");
    expect(r?.evidencia).toMatch(/fuera del horario|1-jul|01-jul/i);
  });

  it("y sale la regla del artículo 33 diciendo por qué", () => {
    const r = alVencimiento("18:00", HORARIO).find((x) => x.id === "ucp-33");
    expect(r?.fuente).toMatch(/33/);
    expect(r?.evidencia).toMatch(/17:00|18:00/);
  });

  it("sin horario cargado no se corre nada, pero se avisa cuando el día es el límite", () => {
    /*
     * Es el único día en que importa: una presentación con margen no necesita que nadie mire el
     * reloj. Avisar siempre sería ruido, y el ruido hace que el día que importe tampoco se mire.
     */
    const r = alVencimiento("18:00").find((x) => x.id === "ucp-33");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toMatch(/horario/i);
  });

  it("y con margen, el artículo 33 no dice nada", () => {
    const r = reglasDeGiro({
      lc: LC,
      actual: {
        referencia: `${LC.numero}-1`,
        fecha: new Date("2025-06-10T12:00:00"),
        importe: 51262,
        fechaEmbarque: "08-abr-25",
        horaDeRecepcion: "18:00",
      },
    }).find((x) => x.id === "ucp-33");
    expect(r).toBeUndefined();
  });
});

describe("la hora de recepción es lo que dice el sello, no un instante", () => {
  /*
   * El defecto que encontró la auditoría, y es el mismo que ya habíamos cerrado por otra vía: la
   * hora salía de `Date.getHours()`, que devuelve la hora **del huso del proceso**. El navegador
   * corre en el huso del banco y el servidor en UTC, así que el mismo instante daba EN_HORARIO en
   * la pantalla y FUERA_DE_HORARIO en el registro — y como el servidor reemplaza lo que se vio, el
   * registro decía «tarde» sobre una presentación en plazo.
   *
   * La causa de fondo: **la hora de recepción no es un instante, es lo que dice el sello**. Un
   * juego recibido a las 11:00 y examinado a las 18:30 llegó a las 11:00, aunque el examinador
   * haga clic después. Ahora entra como dato —«HH:MM», lo que el sello dice— y el instante no se
   * mira nunca.
   */
  const LC = parseMT700(SWIFT_CSU2025099)!.lc;
  const HORARIO = { abre: "09:00", cierra: "17:00" };

  it("el mismo día da lo mismo en cualquier huso", () => {
    // la fecha se construye en husos distintos: lo único que decide es la hora declarada
    const enMontevideo = new Date("2025-06-30T15:00:00-03:00");
    const enUtc = new Date("2025-06-30T15:00:00Z");
    for (const d of [enMontevideo, enUtc]) {
      expect(presentacionEfectiva(d, HORARIO, [], "15:00").motivo).toBe("EN_HORARIO");
      expect(presentacionEfectiva(d, HORARIO, [], "18:00").motivo).toBe("FUERA_DE_HORARIO");
    }
  });

  it("y sin la hora declarada no se mira el reloj del proceso", () => {
    /*
     * Antes, sin horario cargado, igual se leía `getHours()` para nada. Ahora sin hora declarada el
     * motivo es SIN_HORA y no se corre nada: el examen lo dice en vez de decidir con la hora de un
     * servidor que está en otro continente.
     */
    const r = presentacionEfectiva(new Date("2025-06-30T23:00:00Z"), HORARIO, []);
    expect(r.motivo).toBe("SIN_HORA");
    expect(r.corrida).toBe(false);
  });

  it("la regla del vencimiento usa la hora del sello", () => {
    const giro = (horaDeRecepcion?: string) =>
      reglasDeGiro({
        lc: LC,
        actual: {
          referencia: `${LC.numero}-1`,
          fecha: new Date("2025-06-30T12:00:00Z"),
          importe: 51262,
          fechaEmbarque: "08-abr-25",
          horaDeRecepcion,
        },
        horario: HORARIO,
      }).find((x) => x.id === "giro-vencimiento");

    expect(giro("11:00")?.estado, "recibido a las 11:00 del día del vencimiento").toBe("OK");
    expect(giro("18:00")?.estado, "recibido a las 18:00, fuera del horario").not.toBe("OK");
  });

  it("sin hora de recepción, el día del vencimiento se avisa en vez de decidirse", () => {
    const r = reglasDeGiro({
      lc: LC,
      actual: {
        referencia: `${LC.numero}-1`,
        fecha: new Date("2025-06-30T12:00:00Z"),
        importe: 51262,
        fechaEmbarque: "08-abr-25",
      },
      horario: HORARIO,
    }).find((x) => x.id === "ucp-33");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.evidencia).toMatch(/hora|sello/i);
  });
});
