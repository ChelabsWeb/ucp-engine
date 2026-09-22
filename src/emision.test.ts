import { describe, expect, it } from "vitest";
import { describirObservacion, resumenRevision, revisarCredito } from "./emision";
import { SWIFT_CSU2025099 } from "./fixtures";
import { type LcSwift, parseMT700 } from "./swift-lc";

const REAL = parseMT700(SWIFT_CSU2025099)!;

/** Cambia un pedazo del crédito real y lo vuelve a interpretar. */
function conCambio(de: string | RegExp, a: string): LcSwift {
  return parseMT700(SWIFT_CSU2025099.replace(de, a))!;
}
const ids = (p: LcSwift) => revisarCredito(p).map((o) => o.id);

describe("el crédito real del caso", () => {
  const o = revisarCredito(REAL);
  const r = resumenRevision(o);

  it("es operable: nada le impide cumplirse", () => {
    expect(r.operable).toBe(true);
    expect(r.impiden).toBe(0);
  });

  it("no inventa problemas donde el crédito está bien armado", () => {
    expect(o.some((x) => x.id === "emision-embarque-tras-vencimiento")).toBe(false);
    expect(o.some((x) => x.id === "emision-sin-plazo")).toBe(false);
    expect(o.some((x) => x.id === "emision-sin-documentos")).toBe(false);
  });

  it("cada observación dice dónde, por qué y qué hacer", () => {
    for (const x of o) {
      expect(x.donde).toBeTruthy();
      expect(x.fuente).toBeTruthy();
      expect(x.sugerencia.length).toBeGreaterThan(10);
    }
  });
});

describe("lo que impide cumplir un crédito", () => {
  it("un embarque posterior al vencimiento: nadie llega a presentar", () => {
    // el crédito vence el 30-jun-25; se corre el último embarque al 31-jul
    const p = conCambio(
      "44C: Latest Date of Shipment\n          250430",
      "44C: Latest Date of Shipment\n          250731",
    );
    const o = revisarCredito(p);
    expect(o.find((x) => x.id === "emision-embarque-tras-vencimiento")?.gravedad).toBe("IMPIDE");
    expect(resumenRevision(o).operable).toBe(false);
  });

  it("sin decir con qué banco está disponible", () => {
    const p = conCambio(
      /41D: Available With\.\.\.By\.\.\. - Name&Addr\n {10}ANY BANK IN URUGUAY\n {10}BY NEGOTIATION\n/,
      "",
    );
    expect(ids(p)).toContain("emision-disponible");
  });

  it("sin decir si es a la vista o a plazo", () => {
    const p = conCambio(/42C: Drafts at\.\.\.\n {10}SIGHT\n/, "");
    expect(ids(p)).toContain("emision-forma");
  });
});

describe("las condiciones que se descartan solas", () => {
  it("una condición que ningún documento acredita", () => {
    const p = conCambio(
      "+1)ALL DOCUMENTS SHOULD BEAR A DATE ON OR AFTER THE LETTER OF",
      "+1)THE GOODS MUST BE OF THE FINEST QUALITY AVAILABLE\n          +9)ALL DOCUMENTS SHOULD BEAR A DATE ON OR AFTER THE LETTER OF",
    );
    const o = revisarCredito(p);
    const x = o.find((y) => y.id.startsWith("emision-no-documentaria"));
    expect(x?.gravedad).toBe("SE_DESCARTA");
    expect(x?.fuente).toContain("14h");
  });

  it("«third party documents not acceptable», que no significa nada", () => {
    const p = conCambio(
      "+8)CERTIFICATE OF ANALYSIS",
      "+8)CERTIFICATE OF ANALYSIS\n          +11)THIRD PARTY DOCUMENTS ARE NOT ACCEPTABLE",
    );
    expect(ids(p).some((i) => i.startsWith("emision-sin-sentido"))).toBe(true);
  });

  it("una condición administrativa del propio banco", () => {
    const p = conCambio(
      "+1)ALL DOCUMENTS SHOULD BEAR A DATE ON OR AFTER THE LETTER OF",
      "+1)DOCUMENTS ARE NOT TO BE STAPLED\n          +9)ALL DOCUMENTS SHOULD BEAR A DATE ON OR AFTER THE LETTER OF",
    );
    const o = revisarCredito(p);
    expect(o.find((x) => x.id.startsWith("emision-administrativa"))?.fuente).toContain("preliminar ix");
  });
});

describe("lo que deja el cobro en manos del comprador", () => {
  it("un documento que firma el propio ordenante", () => {
    const p = conCambio("+8)CERTIFICATE OF ANALYSIS", "+8)INSPECTION CERTIFICATE SIGNED BY THE APPLICANT");
    const o = revisarCredito(p);
    const x = o.find((y) => y.id.startsWith("emision-doc-ordenante"));
    expect(x?.gravedad).toBe("CONFLICTO");
    expect(x?.sugerencia).toContain("voluntad del comprador");
  });

  it("un emisor descrito con una fórmula vaga", () => {
    const p = conCambio("+8)CERTIFICATE OF ANALYSIS", "+8)CERTIFICATE OF ANALYSIS ISSUED BY A FIRST CLASS LABORATORY");
    const o = revisarCredito(p);
    expect(o.find((x) => x.id.startsWith("emision-emisor-vago"))?.fuente).toBe("UCP 600 3");
  });
});

describe("avisos sobre cómo se va a leer el crédito", () => {
  it("una barra en el puerto admite cualquiera de las dos opciones", () => {
    const p = conCambio(
      "44F: Port of Discharge/Airport of Dest\n          COLOMBO,SRI LANKA",
      "44F: Port of Discharge/Airport of Dest\n          COLOMBO/HAMBANTOTA",
    );
    const o = revisarCredito(p);
    expect(o.find((x) => x.id === "emision-barra-44F")?.fuente).toContain("A2");
  });

  it("prohibir el transbordo con carga en contenedor no alcanza", () => {
    const p = conCambio("43T: Transhipment\n          ALLOWED", "43T: Transhipment\n          NOT ALLOWED");
    const o = revisarCredito(p);
    const x = o.find((y) => y.id === "emision-transbordo");
    expect(x?.fuente).toContain("20c-ii");
    expect(x?.sugerencia).toContain("excluir expresamente");
  });

  it("sin plazo de presentación rigen los 21 días", () => {
    const p = conCambio(/48: Period for Presentation[\s\S]*?\n(?=\s+49:)/, "");
    const o = revisarCredito(p);
    expect(o.find((x) => x.id === "emision-sin-plazo")?.fuente).toContain("14c");
  });
});

describe("el resumen y la descripción", () => {
  it("cuenta por gravedad y dice si el crédito es operable", () => {
    const r = resumenRevision(revisarCredito(REAL));
    expect(r.total).toBe(r.impiden + r.conflictos + r.seDescartan + r.avisos);
  });

  it("una observación se describe en una línea con todo adentro", () => {
    const linea = describirObservacion({
      id: "x",
      gravedad: "IMPIDE",
      fuente: "UCP 600 6e",
      que: "El último día de embarque es posterior al vencimiento",
      donde: "campos 44C y 31D",
      sugerencia: "adelantar el embarque o correr el vencimiento",
    });
    expect(linea).toContain("IMPIDE CUMPLIRLO");
    expect(linea).toContain("44C");
    expect(linea).toContain("UCP 600 6e");
  });
});
