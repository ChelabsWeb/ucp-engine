import { describe, expect, it } from "vitest";
import { revisarBackToBack } from "./back-to-back";
import { SWIFT_CSU2025099 } from "./fixtures";
import { parseMT700 } from "./swift-lc";
import type { LcInfo } from "./types";

/**
 * Los dos créditos de un back-to-back.
 *
 * Cuando el crédito que recibe el trader no es transferible, la salida es otra: le pide a su banco
 * que emita un crédito nuevo a favor del proveedor, respaldado en el primero. No hay un artículo
 * que regule esto —son dos créditos independientes y las UCP tratan a cada uno por separado— y esa
 * independencia es justamente el problema: el banco que emite el segundo responde por él aunque el
 * primero no le pague.
 *
 * Así que lo que se revisa no son reglas de un artículo, sino descalces con una consecuencia
 * concreta: quién queda descubierto y por qué. Cuando no hay consecuencia verificable, no hay
 * regla.
 */

const RECIBIDO = parseMT700(SWIFT_CSU2025099)!.lc;

/** El que el banco emitiría a favor del proveedor: menos plata, y con margen en las fechas. */
const A_EMITIR: LcInfo = {
  ...RECIBIDO,
  numero: "BB-2025-0417",
  monto: 41040,
  vencimiento: "10-jun-25",
  limiteEmbarque: "15-abr-25",
};

const revisar = (cambios: Partial<LcInfo>, ctx = {}) => revisarBackToBack(RECIBIDO, { ...A_EMITIR, ...cambios }, ctx);

describe("el par que funciona", () => {
  it("con importe menor y fechas adelantadas, no hay nada descubierto", () => {
    expect(revisar({}).filter((x) => x.riesgo === "DESCUBIERTO")).toHaveLength(0);
  });
});

describe("las fechas, que es donde el banco se queda con el crédito en la mano", () => {
  it("si el que se emite vence después del recibido, el banco paga y ya no puede cobrar", () => {
    const d = revisar({ vencimiento: "15-jul-25" }).find((x) => x.id === "btb-vencimiento");
    expect(d?.riesgo).toBe("DESCUBIERTO");
    expect(d?.porQue).toMatch(/cobrar|descubierto|vencid/i);
  });

  it("y si vencen el mismo día, tampoco sirve: hay que sustituir la factura y presentar", () => {
    /*
     * Es el descalce que no se ve. Los dos vencimientos iguales parecen prudentes, pero entre que
     * el proveedor presenta y el trader sustituye su factura para presentar contra el primero pasan
     * días, y ese día ya no existe.
     */
    const d = revisar({ vencimiento: RECIBIDO.vencimiento }).find((x) => x.id === "btb-vencimiento");
    expect(d?.riesgo).toBe("DESCUBIERTO");
  });

  it("el último embarque del que se emite no puede ser posterior", () => {
    const d = revisar({ limiteEmbarque: "30-may-25" }).find((x) => x.id === "btb-embarque");
    expect(d?.riesgo).toBe("DESCUBIERTO");
  });
});

describe("la plata", () => {
  it("emitir por más de lo que se va a cobrar deja al banco poniendo la diferencia", () => {
    const d = revisar({ monto: 60000 }).find((x) => x.id === "btb-importe");
    expect(d?.riesgo).toBe("DESCUBIERTO");
  });

  it("emitir por menos es el negocio del trader, y no se informa como problema", () => {
    expect(revisar({ monto: 30000 }).filter((x) => x.riesgo === "DESCUBIERTO")).toHaveLength(0);
  });

  it("otra moneda pone el riesgo de cambio sobre el banco", () => {
    const d = revisar({ moneda: "EUR" }).find((x) => x.id === "btb-moneda");
    expect(d?.riesgo).toBe("DESCUBIERTO");
  });
});

describe("los documentos, que son lo que hay que presentar después", () => {
  it("lo que el recibido exige y el emitido no pide, lo tiene que conseguir el trader", () => {
    const d = revisar({ documentosExigidos: ["COMMERCIAL INVOICE"] }).find((x) => x.id === "btb-documentos");
    expect(d?.riesgo).toBe("DESCUBIERTO");
    expect(d?.porQue).toMatch(/conseguir|falta/i);
  });

  it("que el emitido pida de más no descubre a nadie: se avisa y nada más", () => {
    // Pedirle al proveedor un papel que después no hay que presentar es ineficiencia, no riesgo.
    const d = revisar({
      documentosExigidos: [...(RECIBIDO.documentosExigidos ?? []), "INSPECTION CERTIFICATE"],
    }).find((x) => x.id === "btb-documentos-de-mas");
    expect(d?.riesgo).toBe("AVISO");
  });
});

describe("lo que se embarca", () => {
  it("si el recibido no permite parciales y el emitido sí, entran embarques que no se pueden presentar", () => {
    const d = revisarBackToBack(RECIBIDO, A_EMITIR, {
      parcialesRecibido: "NOT ALLOWED",
      parcialesAEmitir: "ALLOWED",
    }).find((x) => x.id === "btb-parciales");
    expect(d?.riesgo).toBe("DESCUBIERTO");
  });

  it("al revés no: que el emitido sea más estricto que el recibido no descubre nada", () => {
    const d = revisarBackToBack(RECIBIDO, A_EMITIR, {
      parcialesRecibido: "ALLOWED",
      parcialesAEmitir: "NOT ALLOWED",
    }).find((x) => x.id === "btb-parciales");
    expect(d?.riesgo).not.toBe("DESCUBIERTO");
  });
});

describe("cada descalce dice de quién es el problema", () => {
  it("nombra al banco emisor del segundo crédito, que es el que responde", () => {
    const d = revisar({ monto: 60000 })[0]!;
    expect(d.porQue.length).toBeGreaterThan(20);
    expect(d.fuente).toBeTruthy();
  });

  it("la fuente no inventa un artículo: esto es práctica, no UCP", () => {
    // Las UCP tratan cada crédito por separado y no dicen nada del par. Atribuirle a un artículo
    // una regla que no tiene sería lo peor que este motor puede hacer.
    for (const d of revisar({ monto: 60000, moneda: "EUR", vencimiento: "15-jul-25" })) {
      expect(d.fuente).not.toMatch(/UCP 600 3[0-9]|UCP 600 38/);
    }
  });
});
