import { describe, expect, it } from "vitest";
import { contenedorCierra, senalesAML } from "./aml";
import type { CamposDoc } from "./consistencia";

const v = (valor: string) => ({ valor, confianza: 1 });
const vacio = { valor: "", confianza: 0 };

/** Un documento con solo los campos que la señal mira; el resto, vacío como llega de verdad. */
const papel = (dice: Record<string, { valor: string; confianza: number }>): CamposDoc =>
  new Proxy(dice, { get: (t, k) => t[k as string] ?? vacio }) as unknown as CamposDoc;

describe("el dígito verificador de un contenedor (ISO 6346)", () => {
  it("acepta un número real", () => {
    /* CSQU3054383 es el ejemplo que usa la propia norma. */
    expect(contenedorCierra("CSQU3054383")).toBe(true);
  });

  it("lo acepta con espacios y guiones, que es como lo escriben los papeles", () => {
    expect(contenedorCierra("CSQU 305438-3")).toBe(true);
  });

  it("rechaza el mismo número con un dígito cambiado", () => {
    expect(contenedorCierra("CSQU3054384")).toBe(false);
  });

  it("rechaza una letra cambiada por otra", () => {
    /* Es para esto que la norma saltea los múltiplos de once al valuar las letras: sin ese
       salto, dos letras distintas podrían dar la misma suma y el dígito no detectaría nada. */
    expect(contenedorCierra("CSQU3054383")).toBe(true);
    expect(contenedorCierra("CSRU3054383")).toBe(false);
  });

  /*
   * El caso que el módulo 10 resuelve, y que faltaba.
   *
   * Cuando el resto de dividir por once da 10, el dígito que corresponde es 0. Sin el `% 10` final
   * la cuenta compararía 10 contra 0 y **rechazaría un contenedor legítimo**: un falso positivo
   * sobre un papel correcto, que es el error que este producto menos puede permitirse.
   *
   * Los primeros tests pasaron con el `% 10` sacado a propósito, así que no lo estaban probando.
   */
  it("acepta un contenedor cuyo dígito verificador es cero", () => {
    expect(contenedorCierra("MSCU0000060")).toBe(true);
    expect(contenedorCierra("TGHU0000040")).toBe(true);
  });

  it("no opina sobre algo que no tiene forma de contenedor", () => {
    expect(contenedorCierra("AMS2026164")).toBeNull();
    expect(contenedorCierra("")).toBeNull();
  });
});

describe("las señales de lavado", () => {
  it("no dice nada sobre un juego corriente", () => {
    const s = senalesAML({
      docs: {
        FACTURA: papel({
          montoTotal: v("390000"),
          cantidad: v("500"),
          unidad: v("MTS"),
          exportador: v("AGROMEALS S.A"),
        }),
        BL: papel({ exportador: v("AGROMEALS S.A"), numeroDoc: v("CSQU3054383") }),
      },
      credito: { beneficiario: "AGROMEALS S.A" },
      enmiendas: 0,
    });
    expect(s).toEqual([]);
  });

  it("marca un contenedor que no cierra", () => {
    const s = senalesAML({ docs: { BL: papel({ numeroDoc: v("CSQU3054384") }) } });
    expect(s.map((x) => x.fuente)).toEqual(["ISO 6346"]);
    expect(s[0]?.evidencia).toContain("CSQU3054384");
  });

  it("marca un peso bruto menor que la carga, que es imposible", () => {
    const s = senalesAML({
      docs: { PACKING: papel({ pesoBruto: v("49.000 KGS"), cantidad: v("53960"), unidad: v("KGS") }) },
    });
    expect(s.map((x) => x.id)).toEqual(["aml-bruto-menor-PACKING"]);
  });

  it("no compara pesos de magnitudes distintas", () => {
    /* Kilos contra bultos no dice nada, y marcar ahí sería inventar. */
    const s = senalesAML({
      docs: { PACKING: papel({ pesoBruto: v("900 KGS"), cantidad: v("1200"), unidad: v("BAGS") }) },
    });
    expect(s).toEqual([]);
  });

  it("marca una factura cuyos tres números no cierran", () => {
    /* 780 por 500 da 390.000, no 250.000. Lo que se afirma es que la cuenta del propio papel no
       cierra, no que el precio esté fuera de mercado: eso un banco no puede determinarlo. */
    const s = senalesAML({
      docs: { FACTURA: papel({ montoTotal: v("250000"), cantidad: v("500"), precioUnitario: v("780") }) },
    });
    expect(s.map((x) => x.id)).toEqual(["aml-factura-no-cierra"]);
    expect(s[0]?.evidencia).toContain("390000.00");
  });

  it("tolera el redondeo de una factura normal", () => {
    const s = senalesAML({
      docs: { FACTURA: papel({ montoTotal: v("389870"), cantidad: v("500"), precioUnitario: v("780") }) },
    });
    expect(s).toEqual([]);
  });

  it("no opina si la factura no declara precio unitario", () => {
    const s = senalesAML({ docs: { FACTURA: papel({ montoTotal: v("250000"), cantidad: v("500") }) } });
    expect(s).toEqual([]);
  });

  it("marca un embarcador que no es el beneficiario", () => {
    const s = senalesAML({
      docs: { BL: papel({ exportador: v("TRADING INTERMEDIARIA LTD") }) },
      credito: { beneficiario: "AGROMEALS S.A" },
    });
    expect(s.map((x) => x.id)).toEqual(["aml-tercero-embarcador"]);
  });

  it("no se queja por una razón social escrita distinto", () => {
    const s = senalesAML({
      docs: { BL: papel({ exportador: v("AGROMEALS S.A.") }) },
      credito: { beneficiario: "AGROMEALS S.A" },
    });
    expect(s).toEqual([]);
  });

  it("marca un crédito enmendado varias veces, diciendo cuántas", () => {
    const s = senalesAML({ docs: {}, enmiendas: 4 });
    expect(s.map((x) => x.id)).toEqual(["aml-enmiendas"]);
    expect(s[0]?.evidencia).toContain("4 enmiendas");
  });

  it("no se queja de una enmienda sola", () => {
    expect(senalesAML({ docs: {}, enmiendas: 1 })).toEqual([]);
  });

  /*
   * El invariante que gobierna el módulo entero.
   *
   * Una señal de lavado no es un hallazgo del examen y no puede colarse en el veredicto. Acá se
   * afirma sobre la forma: nada de lo que sale de este módulo lleva un estado de regla ni cita un
   * artículo de las UCP, porque no es una cuestión de las UCP. Si alguien le agrega un `estado`
   * para pintarlo como los hallazgos, este test lo frena.
   */
  it("ninguna señal se parece a un hallazgo del examen", () => {
    const s = senalesAML({
      docs: {
        FACTURA: papel({ montoTotal: v("250000"), cantidad: v("500"), precioUnitario: v("780") }),
        BL: papel({ numeroDoc: v("CSQU3054384"), exportador: v("OTRA S.A.") }),
      },
      credito: { beneficiario: "AGROMEALS S.A" },
      enmiendas: 5,
    });
    expect(s.length).toBeGreaterThan(3);
    for (const x of s) {
      expect(Object.keys(x).sort()).toEqual(["evidencia", "fuente", "id", "senal"]);
      expect(x.fuente).not.toMatch(/UCP 600/);
    }
  });
});
