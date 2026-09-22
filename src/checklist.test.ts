import { describe, expect, it } from "vitest";
import { documentosIniciales } from "./checklist";

describe("documentosIniciales — las shipping instructions reemplazan a las instrucciones viejas", () => {
  it("una operación nueva trae la formal, no la de prosa libre", () => {
    const docs = documentosIniciales("LC").map((d) => d.nombre);
    expect(docs).toContain("Shipping instructions");
    expect(docs).not.toContain("Instrucciones de embarque");
  });
  it("con LC la carta de crédito se suma como documento externo a subir", () => {
    expect(documentosIniciales("LC").find((d) => d.nombre === "Carta de crédito")).toMatchObject({
      accion: "consistencia",
    });
    expect(documentosIniciales("TRANSFERENCIA").some((d) => d.nombre === "Carta de crédito")).toBe(false);
  });
});
