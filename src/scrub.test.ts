import { describe, expect, it } from "vitest";
import { scrubForLLM } from "./scrub";

describe("scrubForLLM — redacta lo sensible antes de mandar al LLM", () => {
  it("redacta secretos (JWT, sk-, AKIA)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcd1234efgh";
    const r1 = scrubForLLM(`token=${jwt}`);
    expect(r1.texto).not.toContain(jwt);
    expect(r1.texto).toContain("⟦SECRETO⟧");

    const r2 = scrubForLLM("la clave es sk-ant-api03-AbCdEf012345_XYZ-token");
    expect(r2.texto).toContain("⟦SECRETO⟧");
    expect(r2.texto).not.toContain("sk-ant-api03");

    const r3 = scrubForLLM("AWS AKIAIOSFODNN7EXAMPLE en el config");
    expect(r3.texto).toContain("⟦SECRETO⟧");
    expect(r3.texto).not.toContain("AKIAIOSFODNN7EXAMPLE");

    const r4 = scrubForLLM("service key sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz");
    expect(r4.texto).toContain("⟦SECRETO⟧");
    expect(r4.texto).not.toContain("sb_secret_N7UND0UgjKTVK");
  });

  it("redacta identificadores financieros (IBAN, tarjeta, SWIFT, cuenta)", () => {
    const iban = scrubForLLM("Pago a IBAN NL91ABNA0417164300 del banco");
    expect(iban.texto).toContain("⟦CUENTA⟧");
    expect(iban.texto).not.toContain("NL91ABNA0417164300");

    const tarjeta = scrubForLLM("tarjeta 4111 1111 1111 1111 vencimiento 12/28");
    expect(tarjeta.texto).toContain("⟦TARJETA⟧");
    expect(tarjeta.texto).not.toContain("4111 1111 1111 1111");

    const swift = scrubForLLM("SWIFT: BLITUYMM (Banco Litoral)");
    expect(swift.texto).toContain("⟦SWIFT⟧");
    expect(swift.texto).not.toContain("BLITUYMM");
    expect(swift.texto).toContain("SWIFT"); // se preserva la etiqueta

    const cuenta = scrubForLLM("cuenta Nº 126108570 de Cerealsur");
    expect(cuenta.texto).toContain("⟦CUENTA⟧");
    expect(cuenta.texto).not.toContain("126108570");
  });

  it("redacta contacto de terceros (email, teléfono)", () => {
    const email = scrubForLLM("contacto compras@lasflores.example");
    expect(email.texto).toContain("⟦EMAIL⟧");
    expect(email.texto).not.toContain("compras@lasflores.example");

    const telCtx = scrubForLLM("Tel: 099 123 456 para coordinar");
    expect(telCtx.texto).toContain("⟦TEL⟧");
    expect(telCtx.texto).not.toContain("099 123 456");

    const telIntl = scrubForLLM("llamar al +598 2000 0011");
    expect(telIntl.texto).toContain("⟦TEL⟧");
    expect(telIntl.texto).not.toContain("+598 2000 0011");
  });

  it("NO toca los datos de negocio: montos, cantidades, incoterm, puertos, país, fecha, razón social", () => {
    const texto =
      "Vendo 27 TON de MBM a USD 4.950 CFR Shanghai (CN) a Eversun Foods, " +
      "embarque 30-sep-26, incoterm CFR, compra a Casa Blanca a USD 4.300 FOB Montevideo. Total USD 133.650.";
    const { texto: out, hallazgos } = scrubForLLM(texto);
    expect(out).toBe(texto); // intacto
    expect(hallazgos).toHaveLength(0);
  });

  it("reporta los hallazgos con su tipo y es idempotente sobre texto ya redactado", () => {
    const once = scrubForLLM("mail juan@ejemplo.example y tel +59899000000");
    expect(once.hallazgos.map((h) => h.tipo).sort()).toEqual(["EMAIL", "TEL"]);
    const twice = scrubForLLM(once.texto);
    expect(twice.texto).toBe(once.texto); // las marcas ⟦⟧ no re-matchean
    expect(twice.hallazgos).toHaveLength(0);
  });
});
