import { describe, expect, it } from "vitest";
import { compararScreenings, revisionNecesaria } from "./revision-sanciones";
import type { Coincidencia } from "./sanciones";

const coincidencia = (valor: string, entradaId: string, fuente = "OFAC SDN"): Coincidencia => ({
  parte: { rol: "ORDENANTE", valor, origen: "campo 50 del crédito" },
  fuente,
  entradaId,
  entradaNombre: "ALGUIEN SANCIONADO",
  porQue: "NOMBRE",
  grado: "EXACTA",
});

describe("qué cambió entre dos corridas", () => {
  it("una coincidencia que no estaba es lo que hay que mirar", () => {
    const c = compararScreenings([], [coincidencia("ORIENT FEED (PVT) LTD", "36")]);
    expect(c.nuevas).toHaveLength(1);
    expect(c.desaparecidas).toEqual([]);
  });

  it("la que ya estaba no vuelve a aparecer como nueva", () => {
    const vieja = coincidencia("ORIENT FEED (PVT) LTD", "36");
    const c = compararScreenings([vieja], [coincidencia("ORIENT FEED (PVT) LTD", "36")]);
    expect(c.nuevas).toEqual([]);
    expect(c.siguen).toHaveLength(1);
  });

  it("la que desapareció se informa, no se descarta sola", () => {
    // Que una entrada ya no esté en la lista de hoy no borra lo que se decidió con la de ayer.
    const c = compararScreenings([coincidencia("X", "36")], []);
    expect(c.desaparecidas).toHaveLength(1);
    expect(c.nuevas).toEqual([]);
  });

  it("la misma parte contra otra entrada es una coincidencia distinta", () => {
    const c = compararScreenings([coincidencia("X", "36")], [coincidencia("X", "99")]);
    expect(c.nuevas).toHaveLength(1);
    expect(c.desaparecidas).toHaveLength(1);
  });

  it("la misma entrada en otra lista también", () => {
    const c = compararScreenings([coincidencia("X", "36", "OFAC SDN")], [coincidencia("X", "36", "UK Sanctions List")]);
    expect(c.nuevas).toHaveLength(1);
    expect(c.desaparecidas).toHaveLength(1);
  });

  it("el nombre de la parte se compara sin importar mayúsculas ni espacios de más", () => {
    // Si no, el mismo hallazgo volvería a salir como nuevo cada vez que el documento se relee.
    const c = compararScreenings(
      [coincidencia("orient feed (pvt) ltd  ", "36")],
      [coincidencia("ORIENT FEED (PVT) LTD", "36")],
    );
    expect(c.nuevas).toEqual([]);
    expect(c.siguen).toHaveLength(1);
  });
});

describe("cuándo hace falta volver a screenear", () => {
  const ofac = (publicada: string) => ({ fuente: "OFAC SDN", publicada });
  const uk = (publicada: string) => ({ fuente: "UK Sanctions List", publicada });

  it("si nunca se screeneó, hace falta", () => {
    const r = revisionNecesaria(null, [ofac("09/18/2026")]);
    expect(r.hayQueRevisar).toBe(true);
    expect(r.motivos[0]!.motivo).toBe("NUNCA_SE_SCREENEO");
  });

  it("si las listas son las mismas, no hace falta", () => {
    const r = revisionNecesaria([ofac("09/18/2026"), uk("21-Sep-2026")], [ofac("09/18/2026"), uk("21-Sep-2026")]);
    expect(r.hayQueRevisar).toBe(false);
    expect(r.motivos).toEqual([]);
  });

  it("si una lista se actualizó, hace falta, y dice cuál y de qué a qué", () => {
    const r = revisionNecesaria([ofac("09/18/2026"), uk("21-Sep-2026")], [ofac("09/25/2026"), uk("21-Sep-2026")]);
    expect(r.hayQueRevisar).toBe(true);
    expect(r.motivos).toHaveLength(1);
    expect(r.motivos[0]!.motivo).toBe("LISTA_NUEVA");
    expect(r.motivos[0]!.detalle).toContain("09/18/2026");
    expect(r.motivos[0]!.detalle).toContain("09/25/2026");
  });

  it("**una lista que antes no se pudo consultar y ahora sí es motivo suficiente**", () => {
    // Aquella corrida no dijo nada sobre el Reino Unido. No hay «cambio» que comparar: hay una
    // lista que nunca se miró, y tratarla como «igual que antes» sería tomar el silencio por un
    // resultado limpio.
    const r = revisionNecesaria([ofac("09/18/2026")], [ofac("09/18/2026"), uk("21-Sep-2026")]);
    expect(r.hayQueRevisar).toBe(true);
    expect(r.motivos[0]!.motivo).toBe("NO_SE_CONSULTO");
    expect(r.motivos[0]!.fuente).toBe("UK Sanctions List");
  });

  it("una lista que hoy no se puede consultar no inventa un motivo", () => {
    // Si hoy OFAC no contesta, no hay nada nuevo que mirar contra OFAC. La presentación queda como
    // estaba y el que no se pudo consultar se dice en la corrida, no acá.
    const r = revisionNecesaria([ofac("09/18/2026"), uk("21-Sep-2026")], [uk("21-Sep-2026")]);
    expect(r.hayQueRevisar).toBe(false);
  });

  it("las fechas se comparan como texto: distinta es distinta", () => {
    // OFAC escribe «09/18/2026» y el Reino Unido «21-Sep-2026». Entenderlas no hace falta para
    // saber que cambiaron, y un parser de fechas acá sería una fuente de errores sin ninguna
    // ganancia.
    const r = revisionNecesaria([uk("21-Sep-2026")], [uk("22-Sep-2026")]);
    expect(r.hayQueRevisar).toBe(true);
  });
});
