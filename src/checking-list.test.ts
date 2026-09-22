import { describe, expect, it } from "vitest";
import { avisoDeRechazo, checkingList } from "./checking-list";
import type { ResultadoExamen } from "./examen";
import { contextoDesdeSwift, examinarPresentacion } from "./examen";
import { DOCUMENTOS_CSU2025099, SWIFT_CSU2025099 } from "./fixtures";
import type { DocAnalizado } from "./presentacion";
import { parseMT700 } from "./swift-lc";
import type { OperationDetail } from "./types";

const swift = parseMT700(SWIFT_CSU2025099)!;
const LC = swift.lc;
const PRESENTACION = new Date(2025, 3, 22);

const OP = {
  codigo: LC.numero,
  incoterm: "CFR",
  estado: "DOCS_EN_PREPARACION",
  fechaEmbarque: LC.limiteEmbarque,
  montoVenta: LC.monto ?? 0,
  moneda: LC.moneda ?? "USD",
  medioPago: "LC",
  blReal: "08-abr-25",
  legs: [],
  items: [],
  lc: LC,
  contenedores: [],
  documentos: [],
  checklist: [],
  hitos: [],
  matriz: [],
  discrepancias: [],
} as unknown as OperationDetail;

const DOCS: DocAnalizado[] = [
  { tipo: "FACTURA", campos: DOCUMENTOS_CSU2025099.FACTURA!, nombreArchivo: "Invoice A 4401" },
  { tipo: "PACKING", campos: DOCUMENTOS_CSU2025099.PACKING!, nombreArchivo: "Packing list" },
  { tipo: "BL", campos: DOCUMENTOS_CSU2025099.BL!, nombreArchivo: "BL MVD0990117" },
];

const examen = (): ResultadoExamen =>
  examinarPresentacion({
    lc: LC,
    credito: contextoDesdeSwift(swift),
    docs: DOCS,
    op: OP,
    empresaRazonSocial: swift.extra.beneficiario[0] ?? "",
    empresaDireccion: LC.beneficiarioDireccion,
    hoy: PRESENTACION,
  });

describe("la hoja de revisión", () => {
  const hoja = checkingList(LC, examen(), {
    presentador: "CEREALSUR S.A.",
    examinador: "S. Arrieta",
    fechaPresentacion: PRESENTACION,
  });

  it("identifica el crédito y el banco emisor", () => {
    expect(hoja).toContain("LCMRDN25000471");
    expect(hoja).toContain("MERIDIAN BANK PLC");
  });

  it("calcula el plazo de examen del banco: cinco días hábiles", () => {
    // presentada un martes 22 de abril, el quinto día hábil es el martes 29
    expect(hoja).toContain("29-abr-25");
    expect(hoja).toContain("art. 14b");
  });

  it("agrupa los renglones por su origen", () => {
    expect(hoja).toContain("DOCUMENTOS EXIGIDOS (CAMPO 46A)");
    expect(hoja).toContain("CONSISTENCIA ENTRE DOCUMENTOS");
  });

  it("cada renglón lleva su artículo y su evidencia", () => {
    expect(hoja).toContain("UCP 600 14d");
    expect(hoja).toContain("[DISCREPANCIA]");
  });

  it("dice lo que no comprueba y deja el espacio para la firma", () => {
    expect(hoja).toContain("LO QUE ESTA REVISIÓN NO COMPRUEBA");
    expect(hoja).toContain("Examinado por");
    expect(hoja).toContain("S. Arrieta");
  });

  it("deja claro que la decisión es de quien firma", () => {
    expect(hoja).toContain("corresponde al examinador que firma");
  });
});

describe("el aviso de rechazo del artículo 16", () => {
  const aviso = avisoDeRechazo(LC, examen(), {
    fechaPresentacion: PRESENTACION,
    hoy: new Date(2025, 3, 24),
    destino: "RETIENE_ESPERANDO_INSTRUCCIONES",
    presentador: "CEREALSUR S.A.",
    banco: "BANCO LITORAL (URUGUAY) S.A.",
  })!;

  it("dice las tres cosas que el artículo 16(c) exige", () => {
    expect(aviso.texto).toContain("RECHAZAMOS");
    expect(aviso.texto).toContain("Tipo de bulto"); // la discrepancia, una por una
    expect(aviso.texto).toContain("a la espera de sus instrucciones"); // qué hace con los documentos
  });

  it("numera cada discrepancia con su evidencia y su artículo", () => {
    expect(aviso.texto).toMatch(/ 1\. /);
    expect(aviso.texto).toContain("(UCP 600 14d)");
  });

  it("calcula el último día para transmitirlo", () => {
    expect(aviso.limite.getDate()).toBe(29);
    expect(aviso.fueraDePlazo).toBe(false);
  });

  it("avisa si ya se pasó el plazo, que es cuando el banco pierde el derecho a alegar", () => {
    const tarde = avisoDeRechazo(LC, examen(), {
      fechaPresentacion: PRESENTACION,
      hoy: new Date(2025, 4, 5),
      destino: "DEVUELVE",
    })!;
    expect(tarde.fueraDePlazo).toBe(true);
  });

  it("cambia el texto según qué se hace con los documentos", () => {
    const conDispensa = avisoDeRechazo(LC, examen(), {
      fechaPresentacion: PRESENTACION,
      hoy: PRESENTACION,
      destino: "RETIENE_ESPERANDO_DISPENSA",
    })!;
    expect(conDispensa.texto).toContain("dispensa del ordenante");
  });

  it("sin discrepancias no hay aviso que mandar", () => {
    const limpio: ResultadoExamen = {
      ...examen(),
      reglas: [{ id: "x", fuente: "46A", regla: "todo bien", estado: "OK", evidencia: "" }],
      discrepancias: 0,
      faltan: 0,
    };
    expect(
      avisoDeRechazo(LC, limpio, { fechaPresentacion: PRESENTACION, hoy: PRESENTACION, destino: "DEVUELVE" }),
    ).toBeNull();
  });
});
