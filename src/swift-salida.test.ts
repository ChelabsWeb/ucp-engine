import { describe, expect, it } from "vitest";
import { referenciaDelMensaje } from "./swift-salida";

describe("la referencia del campo 20", () => {
  /*
   * El campo 20 es la referencia del remitente: por ahí el otro banco contesta **este** mensaje.
   * La pantalla ponía el número del crédito del emisor, así que los tres mensajes que se pueden
   * cursar sobre un expediente salían con la misma —y con la del otro banco, no con la nuestra.
   */
  it("cada mensaje del mismo giro lleva una referencia distinta", () => {
    const refs = [
      "RECHAZO",
      "CONSULTA",
      "AUTORIZACION",
      "ACUSE",
      "REEMBOLSO_AUTORIZA",
      "REEMBOLSO_RECLAMA",
      "REEMBOLSO_ENMIENDA",
    ].map((t) => referenciaDelMensaje(t as never, "CSU2025099-2"));
    expect(new Set(refs).size).toBe(7);
  });

  it("y dice de qué giro se trata", () => {
    expect(referenciaDelMensaje("RECHAZO", "CSU2025099-2")).toContain("2025099-2");
  });

  it("no pasa de los 16 caracteres que admite el campo", () => {
    const larga = referenciaDelMensaje("AUTORIZACION", "UN-NUMERO-DE-CREDITO-MUY-LARGO-7");
    expect(larga.length).toBeLessThanOrEqual(16);
  });

  it("**y al recortar conserva el final, que es lo que distingue un giro de otro**", () => {
    /*
     * Cortar la cola junta todos los giros del mismo crédito en una referencia sola, que es
     * exactamente el defecto que esto vino a arreglar.
     */
    const g1 = referenciaDelMensaje("RECHAZO", "CREDITO-LARGUISIMO-2024-1");
    const g2 = referenciaDelMensaje("RECHAZO", "CREDITO-LARGUISIMO-2024-2");
    expect(g1).not.toBe(g2);
  });

  it("sin referencia del giro dice al menos qué mensaje es", () => {
    expect(referenciaDelMensaje("CONSULTA", "")).toBe("DSC");
  });

  it("y lo que la red no acepta no viaja", () => {
    expect(referenciaDelMensaje("RECHAZO", "AMS#2025*061")).not.toMatch(/[#*]/);
  });
});
