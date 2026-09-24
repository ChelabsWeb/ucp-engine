import { describe, expect, it } from "vitest";
import { motivoDeFallaDeLectura } from "./lectura-fallida";

/**
 * Lo que se le dice al examinador cuando la lectura no sale.
 *
 * El caso que motivó esto: la cuenta de la API se quedó sin crédito y la aplicación respondió «el
 * documento no se pudo leer». Delante de un banco eso dice que el producto no sabe leer una
 * factura, cuando lo que pasa es que hay que recargar una cuenta. Son cosas distintas y se
 * arreglan en lugares distintos.
 */

describe("por qué no se pudo leer", () => {
  it("sin crédito: es la cuenta, no el papel", () => {
    const m = motivoDeFallaDeLectura(400, "Your credit balance is too low to access the Anthropic API.");
    expect(m.deConfiguracion).toBe(true);
    expect(m.texto).toMatch(/credit/i);
    expect(m.texto).not.toMatch(/could not be read/i);
  });

  it("clave rechazada: también es configuración", () => {
    expect(motivoDeFallaDeLectura(401, "invalid x-api-key").deConfiguracion).toBe(true);
    expect(motivoDeFallaDeLectura(403, "forbidden").deConfiguracion).toBe(true);
  });

  it("demasiadas a la vez: se reintenta y se dice que se reintente", () => {
    const m = motivoDeFallaDeLectura(429, "rate limit exceeded");
    expect(m.reintentable).toBe(true);
    expect(m.deConfiguracion).toBe(false);
  });

  it("el servicio caído se reintenta; no es culpa del documento", () => {
    for (const s of [500, 502, 503, 529]) {
      const m = motivoDeFallaDeLectura(s, "overloaded");
      expect(m.reintentable, `status ${s}`).toBe(true);
      expect(m.texto, `status ${s}`).not.toMatch(/by hand/i);
    }
  });

  it("un pedido inválido que no es de crédito sí es del documento", () => {
    const m = motivoDeFallaDeLectura(400, "image exceeds 8000 pixels");
    expect(m.deConfiguracion).toBe(false);
    expect(m.reintentable).toBe(false);
    expect(m.texto).toMatch(/by hand/i);
  });

  it("sin status —un corte de red— se reintenta", () => {
    expect(motivoDeFallaDeLectura(undefined, "fetch failed").reintentable).toBe(true);
  });

  it("nunca repite hacia afuera el mensaje del proveedor", () => {
    // El texto del proveedor nombra la consola de otra empresa y su plan de facturación: al
    // examinador de un banco no le dice nada y filtra con qué está hecho el producto.
    const m = motivoDeFallaDeLectura(400, "Please go to Plans & Billing to upgrade or purchase credits.");
    expect(m.texto).not.toMatch(/Anthropic|Plans & Billing/);
  });
});
