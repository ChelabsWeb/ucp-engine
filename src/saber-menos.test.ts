import { describe, expect, it } from "vitest";
import type { CamposDoc } from "./consistencia";
import { contextoDesdeSwift, examinarPresentacion } from "./examen";
import { DOCUMENTOS_CSU2025099, SWIFT_CSU2025099 } from "./fixtures";
import type { ContextoCredito } from "./reglas-ucp";
import { parseMT700 } from "./swift-lc";

/**
 * Saber menos no puede hacer que el motor concluya más.
 *
 * El invariante: si un campo del crédito no se pudo leer, el examen puede perder hallazgos —no hay
 * con qué compararlo— pero **no puede ganar una discrepancia**. Una presentación conforme no se
 * vuelve discrepante porque al motor le falte un dato propio.
 *
 * Existe porque esa regla se rompía en la práctica. El conocimiento del expediente de referencia dice
 * «NOTIFY ORIENT FEED (PVT) LTD», que es exactamente el ordenante que el crédito pide notificar; con
 * el campo 50 sin leer, `bl-notify` comparaba contra una cadena vacía y daba DISCREPANCIA, con la
 * evidencia terminando en «· ordenante » y nada después. El propio hallazgo delataba que el dato
 * faltaba de este lado, y aun así rechazaba el documento.
 *
 * Se prueba campo por campo y no todos juntos: vaciando el contexto entero, una regla que solo
 * dispara con dos datos presentes nunca llegaría a correr y el agujero quedaría tapado.
 */

const swift = parseMT700(SWIFT_CSU2025099)!;
const COMPLETO = contextoDesdeSwift(swift);

const DOCS = (["FACTURA", "PACKING", "BL"] as const).map((tipo) => ({
  tipo,
  campos: DOCUMENTOS_CSU2025099[tipo] as CamposDoc,
}));

const examinar = (credito: ContextoCredito, empresaRazonSocial = swift.extra.beneficiario[0] ?? "") =>
  examinarPresentacion({
    lc: swift.lc,
    credito,
    docs: DOCS,
    presentacion: {
      referencia: `${swift.lc.numero}-1`,
      fecha: new Date(2025, 3, 22),
      importe: 51262,
      fechaEmbarque: "08-abr-25",
    },
    empresaRazonSocial,
    empresaDireccion: swift.lc.beneficiarioDireccion,
    hoy: new Date(2025, 3, 22),
  });

/** Los ids de las discrepancias, que es lo que no puede crecer. */
const discrepanciasDe = (r: ReturnType<typeof examinar>) =>
  r.reglas.filter((x) => x.estado === "DISCREPANCIA").map((x) => x.id);

const CON_TODO = discrepanciasDe(examinar(COMPLETO));

/** Cada dato del crédito que el intérprete puede no llegar a leer. */
const CAMPOS: (keyof ContextoCredito)[] = [
  "aplicante",
  "beneficiario",
  "puertoEmbarque",
  "puertoDestino",
  "mercaderia",
  "parciales",
  "transbordo",
];

describe("vaciar un dato del crédito no inventa discrepancias", () => {
  it.each(CAMPOS)("sin %s", (campo) => {
    const nuevas = discrepanciasDe(examinar({ ...COMPLETO, [campo]: null })).filter((id) => !CON_TODO.includes(id));
    expect(nuevas, `apareció una discrepancia al perder «${String(campo)}»`).toEqual([]);
  });

  it("sin la razón social del beneficiario tampoco", () => {
    // Viene de los ajustes del banco, no del crédito, y alimenta el cotejo del artículo 14 (j).
    const nuevas = discrepanciasDe(examinar(COMPLETO, "")).filter((id) => !CON_TODO.includes(id));
    expect(nuevas).toEqual([]);
  });

  it("y el paquete real sigue dando las discrepancias que tiene que dar", () => {
    // Si esto quedara en cero, el test de arriba pasaría por no haber nada que comparar.
    expect(CON_TODO.length).toBeGreaterThan(0);
  });
});
