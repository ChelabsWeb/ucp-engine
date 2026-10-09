import { describe, expect, it } from "vitest";
import type { CamposDoc } from "./consistencia";
import { reglasDeMaqueta, valoresQueNoParecenSuCampo } from "./maqueta";

/**
 * El defecto que el banco vio y el motor no podía ver.
 *
 * En la presentación de AMS2026164 el examinador escribió: «Caliset x 4: information de Qty,
 * Port of loading, Port of discharge, ship. Date, BL nr. Y shipper quedó corrida - VER». Los
 * cuatro certificados de análisis estaban maquetados en dos columnas y los valores quedaron
 * desplazados un renglón: debajo de «Port of loading» había una fecha, debajo de «Ship. date»
 * un puerto.
 *
 * Mirando el crédito no se detecta —el crédito no dice qué forma tiene cada valor— y mirando la
 * hoja haría falta la posición. Pero desde el texto extraído sí se ve: un puerto que es una
 * fecha, una fecha sin una sola cifra, una cantidad sin números. Eso es lo que mira esto.
 *
 * Va en ATENCIÓN y no en DISCREPANCIA a propósito: puede ser la lectura y no el papel, y afirmar
 * una falta a partir de una lectura dudosa es el falso positivo que este motor no se permite.
 */
const campo = (valor: string) => ({ valor, confianza: 0.9 });
const base = (extra: Partial<CamposDoc> = {}) =>
  ({
    exportador: campo("YARUS S.A."),
    importador: campo("AL RASHID TRADING"),
    montoTotal: campo("174150.60"),
    moneda: campo("USD"),
    cantidad: campo("54 MT"),
    unidad: campo("MT"),
    mercaderia: campo("FROZEN BONELESS BEEF"),
    puertoEmbarque: campo("MONTEVIDEO"),
    puertoDestino: campo("SHANGHAI"),
    fechaEmbarque: campo("04-jul-26"),
    incoterm: campo("CFR"),
    numeroDoc: campo("185010"),
    ...extra,
  }) as CamposDoc;

describe("valoresQueNoParecenSuCampo", () => {
  it("el caso Caliset: el puerto trae la fecha y la fecha trae el puerto", () => {
    const corridos = valoresQueNoParecenSuCampo(
      base({ puertoEmbarque: campo("04/07/2026"), fechaEmbarque: campo("MONTEVIDEO") }),
    );
    expect(corridos.map((c) => c.campo).sort()).toEqual(["fechaEmbarque", "puertoEmbarque"]);
    expect(corridos.find((c) => c.campo === "puertoEmbarque")?.motivo).toMatch(/fecha/i);
    expect(corridos.find((c) => c.campo === "fechaEmbarque")?.motivo).toMatch(/cifra/i);
  });

  it("un documento sano no levanta nada", () => {
    expect(valoresQueNoParecenSuCampo(base())).toEqual([]);
  });

  it("una cantidad sin una sola cifra no es una cantidad", () => {
    const corridos = valoresQueNoParecenSuCampo(base({ cantidad: campo("MONTEVIDEO") }));
    expect(corridos.map((c) => c.campo)).toEqual(["cantidad"]);
  });

  it("un nombre que es un número: el shipper quedó con el BL", () => {
    const corridos = valoresQueNoParecenSuCampo(base({ exportador: campo("185010") }));
    expect(corridos.map((c) => c.campo)).toEqual(["exportador"]);
  });

  it("lo que NO se marca, que es donde un chequeo así se vuelve ruido", () => {
    /* Un puerto con número de muelle, una mercadería con su código, una fecha escrita como la
       escriben los documentos, un campo vacío —que es «no se leyó», no «está corrido»—. */
    expect(valoresQueNoParecenSuCampo(base({ puertoEmbarque: campo("SHANGHAI PORT 200080") }))).toEqual([]);
    expect(valoresQueNoParecenSuCampo(base({ mercaderia: campo("BEEF 0202.30.00") }))).toEqual([]);
    expect(valoresQueNoParecenSuCampo(base({ fechaEmbarque: campo("SHIPPED ON BOARD 08-APR-2025") }))).toEqual([]);
    expect(valoresQueNoParecenSuCampo(base({ puertoEmbarque: campo("") }))).toEqual([]);
    expect(valoresQueNoParecenSuCampo(base({ cantidad: campo("") }))).toEqual([]);
  });

  it("un valor leído con poca confianza no se denuncia como corrido", () => {
    /* Con confianza baja lo que falló puede ser la lectura, no el papel: ya hay un aviso para
       eso, y acusar dos veces al mismo renglón por la misma duda es ruido. */
    const flojo = base({ puertoEmbarque: { valor: "04/07/2026", confianza: 0.3 } });
    expect(valoresQueNoParecenSuCampo(flojo)).toEqual([]);
  });
});

describe("reglasDeMaqueta", () => {
  it("una regla por documento, en ATENCIÓN, nombrando los campos", () => {
    const reglas = reglasDeMaqueta([
      {
        tipo: "CERTIFICADO",
        nombreArchivo: "caliset 185010.pdf",
        campos: base({ puertoEmbarque: campo("04/07/2026") }),
      },
      { tipo: "FACTURA", campos: base() },
    ]);
    expect(reglas.length, "solo el documento con el problema").toBe(1);
    expect(reglas[0]?.estado).toBe("ATENCION");
    expect(reglas[0]?.regla).toMatch(/caliset 185010\.pdf|Certificado/i);
    expect(reglas[0]?.evidencia).toMatch(/Puerto de embarque/i);
    expect(reglas[0]?.evidencia, "y por qué importa: la maqueta se corrió").toMatch(/corrid/i);
  });

  it("sin documentos no inventa reglas", () => {
    expect(reglasDeMaqueta([])).toEqual([]);
  });
});
