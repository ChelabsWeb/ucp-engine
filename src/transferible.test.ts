import { describe, expect, it } from "vitest";
import { SWIFT_CSU2025099 } from "./fixtures";
import { parseMT700 } from "./swift-lc";
import { revisarTransferencia, sePuedeTransferir } from "./transferible";
import type { LcInfo } from "./types";

/**
 * El crédito transferido contra el original (UCP 600 art. 38).
 *
 * El artículo 38 (g) es una lista cerrada: el crédito transferido tiene que reflejar con exactitud
 * los términos del original —incluida la confirmación— salvo cinco cosas, que **solo pueden
 * reducirse o acortarse**. Cualquier otra diferencia, y cualquiera de esas cinco moviéndose para
 * arriba, deja al banco transferente emitiendo un crédito que no cumple el artículo.
 *
 * Quien necesita esto es el banco que transfiere, y el trader que pide la transferencia: el primer
 * beneficiario compra a un proveedor y le transfiere el crédito por menos, que es de donde sale su
 * margen.
 */

const ORIGINAL = parseMT700(SWIFT_CSU2025099)!.lc;

/** El transferido del caso: mismo crédito, importe y vencimiento recortados. */
const TRANSFERIDO: LcInfo = {
  ...ORIGINAL,
  monto: 41040, // lo que Cerealsur le paga a Molsur
  vencimiento: "15-jun-25",
  limiteEmbarque: "20-abr-25",
};

describe("qué se puede transferir y qué no", () => {
  it("un crédito que no se declara transferible no se transfiere", () => {
    // El artículo 38 (b) lo define así: transferible es el que **dice** serlo. El del expediente no
    // lo dice, y suponerlo sería habilitar una operación que el emisor no autorizó.
    expect(sePuedeTransferir("IRREVOCABLE\nWITHOUT OUR CONFIRMATION").puede).toBe(false);
    expect(sePuedeTransferir("IRREVOCABLE TRANSFERABLE").puede).toBe(true);
    expect(sePuedeTransferir("IRREVOCABLE\nTRANSFERIBLE").puede).toBe(true);
  });

  it("y se dice por qué, con el artículo", () => {
    expect(sePuedeTransferir("IRREVOCABLE").porQue).toMatch(/38 ?\(?b\)?/);
  });
});

describe("las cinco cosas que pueden reducirse (38 g)", () => {
  const revisar = (t: Partial<LcInfo>) => revisarTransferencia(ORIGINAL, { ...TRANSFERIDO, ...t });

  it("el transferido del caso, con importe y fechas recortados, pasa", () => {
    expect(revisar({}).filter((x) => x.gravedad === "IMPIDE")).toHaveLength(0);
  });

  it.each([
    ["el importe", { monto: 60000 }, /importe|monto/i],
    ["el vencimiento", { vencimiento: "30-jul-25" }, /vencimiento/i],
    ["el último embarque", { limiteEmbarque: "30-may-25" }, /embarque/i],
    // El parser escribe el plazo así, y `diasPresentacion` necesita la palabra para leerlo.
    ["el plazo de presentación", { plazoPresentacion: "30 días desde la fecha de embarque (campo 48)" }, /presentaci/i],
  ])("%s no puede agrandarse", (_nombre, cambio, esperado) => {
    const o = revisar(cambio).find((x) => esperado.test(x.que));
    expect(o?.gravedad).toBe("IMPIDE");
    expect(o?.fuente).toContain("38");
  });

  it("reducirlos sí, y no se informa como problema", () => {
    const r = revisar({ monto: 30000, vencimiento: "01-jun-25" });
    expect(r.filter((x) => x.gravedad === "IMPIDE")).toHaveLength(0);
  });
});

describe("lo que tiene que quedar igual", () => {
  const revisar = (t: Partial<LcInfo>) => revisarTransferencia(ORIGINAL, { ...TRANSFERIDO, ...t });

  it("el banco emisor no cambia: el transferido es el mismo crédito", () => {
    expect(revisar({ bancoEmisor: "OTRO BANCO" }).some((x) => x.gravedad === "IMPIDE")).toBe(true);
  });

  it("los documentos exigidos tampoco", () => {
    const o = revisar({ documentosExigidos: ["COMMERCIAL INVOICE"] }).find((x) => /documento/i.test(x.que));
    expect(o?.gravedad).toBe("IMPIDE");
  });

  it("y si alguno se agrega, también se dice", () => {
    const o = revisar({
      documentosExigidos: [...(ORIGINAL.documentosExigidos ?? []), "INSPECTION CERTIFICATE"],
    }).find((x) => /documento/i.test(x.que));
    expect(o?.gravedad).toBe("IMPIDE");
  });

  it("la tolerancia no está entre las cinco: cambiarla no se puede", () => {
    // Es la trampa de la lista cerrada. La tolerancia parece «una cifra más» pero el 38 (g) no la
    // nombra, así que tiene que reflejarse tal cual.
    const o = revisar({ tolerancia: 0.05 }).find((x) => /tolerancia/i.test(x.que));
    expect(o?.gravedad).toBe("IMPIDE");
  });
});

describe("el seguro y el ordenante, que son las dos excepciones al revés", () => {
  it("la cobertura del seguro puede AUMENTARSE, no reducirse", () => {
    const sube = revisarTransferencia(ORIGINAL, TRANSFERIDO, { seguroOriginal: 110, seguroTransferido: 120 });
    expect(sube.filter((x) => x.gravedad === "IMPIDE")).toHaveLength(0);
    const baja = revisarTransferencia(ORIGINAL, TRANSFERIDO, { seguroOriginal: 110, seguroTransferido: 100 });
    expect(baja.find((x) => /seguro/i.test(x.que))?.gravedad).toBe("IMPIDE");
  });

  it("el nombre del primer beneficiario puede sustituir al del ordenante", () => {
    const r = revisarTransferencia(ORIGINAL, TRANSFERIDO, { ordenanteSustituido: true });
    expect(r.filter((x) => x.gravedad === "IMPIDE")).toHaveLength(0);
  });

  it("pero si el crédito exige el nombre del ordenante en un documento que no es la factura, eso se mantiene", () => {
    /*
     * Es el último párrafo del 38 (g) y es fácil de pasar por alto: sustituir el nombre del
     * ordenante está permitido, salvo donde el crédito pide expresamente que aparezca en otro
     * documento. Si eso no se refleja, el segundo beneficiario emite un certificado con el nombre
     * equivocado y la presentación se cae.
     */
    const conExigencia: LcInfo = {
      ...ORIGINAL,
      condicionesAdicionales: ["CERTIFICATE OF ORIGIN MUST SHOW THE NAME OF THE APPLICANT"],
    };
    const r = revisarTransferencia(
      conExigencia,
      { ...TRANSFERIDO, condicionesAdicionales: [] },
      {
        ordenanteSustituido: true,
      },
    );
    expect(r.find((x) => /ordenante/i.test(x.que))?.gravedad).toBe("IMPIDE");
  });
});

describe("las transferencias que el artículo no permite", () => {
  it("38 d: a más de un segundo beneficiario hace falta que los parciales estén permitidos", () => {
    const r = revisarTransferencia(ORIGINAL, TRANSFERIDO, { segundosBeneficiarios: 2, parciales: "NOT ALLOWED" });
    expect(r.find((x) => /parcial/i.test(x.que))?.gravedad).toBe("IMPIDE");
  });

  it("y con parciales permitidos, se puede", () => {
    const r = revisarTransferencia(ORIGINAL, TRANSFERIDO, { segundosBeneficiarios: 2, parciales: "ALLOWED" });
    expect(r.filter((x) => x.gravedad === "IMPIDE")).toHaveLength(0);
  });

  it("38 d: un crédito ya transferido no se vuelve a transferir", () => {
    const r = revisarTransferencia(ORIGINAL, TRANSFERIDO, { yaEsTransferido: true });
    const o = r.find((x) => /transferid/i.test(x.que));
    expect(o?.gravedad).toBe("IMPIDE");
    expect(o?.porQue).toMatch(/primer beneficiario/i);
  });
});
