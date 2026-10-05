import { describe, expect, it } from "vitest";
import { SWIFT_CSU2025099 } from "./fixtures";
import { type DatosMT720, mt720 } from "./mt720";
import { parseMT700 } from "./swift-lc";

/**
 * El crédito transferido, como mensaje SWIFT (MT720).
 *
 * La pantalla de transferencia ya revisaba el artículo 38 —qué términos se pueden reducir y cuáles
 * no— y lo que faltaba era el papel que sale del escritorio: el mensaje con el que el banco
 * transferente avisa el crédito al segundo beneficiario.
 *
 * **La decisión que gobierna este archivo: el mensaje no se emite si la transferencia no se puede
 * hacer.** No es una validación de formulario. Un MT720 lleva el nombre del banco transferente en
 * un crédito que el artículo 38 no permite transferir así, y lo que llega al segundo beneficiario es
 * un compromiso que su emisor no tenía por qué asumir. Igual que el MT734 no se arma sin
 * discrepancias que avisar, este no se arma sobre una transferencia inválida: devuelve vacío y dice
 * por qué.
 */

const ORIGINAL = parseMT700(SWIFT_CSU2025099)!.lc;

const BASE: DatosMT720 = {
  referenciaPropia: "TRF-2025-0417",
  original: ORIGINAL,
  // el 40B del original: es lo único que hace transferible a un crédito (38 b)
  formaDelCredito: "IRREVOCABLE TRANSFERABLE",
  // lo que el 38 (g) permite reducir: menos plata, menos tiempo
  transferido: { ...ORIGINAL, monto: 41040, vencimiento: "10-jun-25", limiteEmbarque: "15-abr-25" },
  primerBeneficiario: ["CEREALSUR S.A", "CERRITO 820 OF.006", "MONTEVIDEO, URUGUAY"],
  segundoBeneficiario: ["MOLSUR S.A.", "RUTA 1 KM 23", "MONTEVIDEO, URUGUAY"],
  // con quién queda disponible lo decide el transferente: no sale del original
  disponibleCon: "BANCO LITORAL (URUGUAY) S.A. BY NEGOTIATION",
  fecha: new Date(2025, 3, 17),
};

describe("el mensaje que se emite", () => {
  const m = mt720(BASE);

  it("sale con los campos obligatorios del 720", () => {
    for (const tag of [":20:", ":21:", ":31D:", ":50:", ":59:", ":32B:"]) {
      expect(m.texto, `falta el campo ${tag}`).toContain(tag);
    }
  });

  it("el 21 es el número del crédito original: es el crédito que se transfiere", () => {
    expect(m.texto).toContain(`:21:${ORIGINAL.numero}`);
  });

  it("el 50 es el primer beneficiario y el 59 el segundo, no el ordenante", () => {
    /*
     * En un MT700 el 50 es el ordenante; en un 720 es el **primer beneficiario**, que es quien pide
     * la transferencia. Confundirlos pondría al importador como quien transfiere.
     */
    const l = m.texto.split("\n");
    const i50 = l.findIndex((x) => x.startsWith(":50:"));
    const i59 = l.findIndex((x) => x.startsWith(":59:"));
    expect(l[i50]).toContain("CEREALSUR");
    expect(l[i59]).toContain("MOLSUR");
  });

  it("lleva el importe y el vencimiento del transferido, no los del original", () => {
    expect(m.texto).toContain("41040,");
    expect(m.texto).toContain(":31D:250610");
    expect(m.texto).not.toContain("54150,");
  });

  it("y los documentos exigidos viajan: el segundo beneficiario presenta contra esto", () => {
    expect(m.texto).toContain(":46A:");
  });

  it("no inventa campos que no se pudieron verificar contra fuente pública", () => {
    // El repo tiene una regla: nunca afirmar una abreviatura de SWIFT que no se pudo comprobar.
    expect(m.avisos.join(" ")).not.toMatch(/no verificad/i);
  });
});

describe("cuando la transferencia no se puede hacer, no se emite", () => {
  it("un crédito que no se declara transferible (38 b)", () => {
    const m = mt720({ ...BASE, formaDelCredito: "IRREVOCABLE" });
    expect(m.texto).toBe("");
    expect(m.avisos.join(" ")).toMatch(/38 ?\(?b\)?/);
  });

  it("un transferido por más plata que el original (38 g)", () => {
    const m = mt720({ ...BASE, transferido: { ...BASE.transferido, monto: 60000 } });
    expect(m.texto).toBe("");
    expect(m.avisos.join(" ")).toMatch(/38 ?\(?g\)?/);
  });

  it("un transferido que vence después del original (38 g)", () => {
    const m = mt720({ ...BASE, transferido: { ...BASE.transferido, vencimiento: "31-jul-25" } });
    expect(m.texto).toBe("");
    expect(m.avisos.join(" ")).toMatch(/38 ?\(?g\)?/);
  });

  it("y el aviso dice qué habría que corregir, no solo que está mal", () => {
    /*
     * En inglés, como el mensaje: lo que sale de acá se cursa a otro banco, y el aviso acompaña a la
     * decisión de cursarlo o no. Y dice el número de los dos lados —el transferido y el original—
     * porque «está mal» no se puede corregir y «41.040 no puede ser más que 54.150» sí.
     */
    const m = mt720({ ...BASE, transferido: { ...BASE.transferido, monto: 60000 } });
    const aviso = m.avisos.join(" ");
    expect(aviso).toMatch(/only be reduced/i);
    expect(aviso).toMatch(/60000/);
    expect(aviso).toMatch(/54150/);
  });
});

describe("el 41 y el 42, que es fácil confundir", () => {
  /*
   * El 41D es «disponible con… por…» y el 42D es el librado. La primera versión de este archivo
   * metía el librado en el 41D, así que el mensaje decía «disponible con MERIDIAN BANK PLC» cuando el
   * original dice «ANY BANK IN URUGUAY BY NEGOTIATION». Lo encontré mirando el mensaje armado.
   */
  it("el 41 lleva con quién queda disponible el transferido", () => {
    expect(mt720(BASE).texto).toContain(":41D:BANCO LITORAL");
  });

  it("y el librado va en el 42D, no en el 41", () => {
    const l = mt720(BASE).texto.split("\n");
    expect(l.some((x) => x.startsWith(":42D:"))).toBe(true);
    expect(l.find((x) => x.startsWith(":41D:"))).not.toMatch(/MERIDIAN/);
  });

  it("sin el 41 el mensaje sale igual, pero avisando: el segundo beneficiario no sabría dónde presentar", () => {
    const m = mt720({ ...BASE, disponibleCon: null });
    expect(m.texto).not.toContain(":41D:");
    expect(m.avisos.join(" ")).toMatch(/41/);
    expect(m.avisos.join(" ")).toMatch(/where to present/i);
  });
});

describe("el juego de caracteres de la red", () => {
  it("una eñe o una tilde en un nombre se reemplaza y se avisa", () => {
    const m = mt720({ ...BASE, segundoBeneficiario: ["PEÑAROL GRANOS S.A.", "MONTEVIDEO"] });
    expect(m.texto).toContain("PENAROL");
    expect(m.avisos.join(" ")).toMatch(/character|caracter/i);
  });

  it("la referencia que no entra en 16 caracteres se recorta y se dice", () => {
    const m = mt720({ ...BASE, referenciaPropia: "TRANSFERENCIA-DEMASIADO-LARGA-2025" });
    expect(m.avisos.join(" ")).toMatch(/16/);
  });
});
