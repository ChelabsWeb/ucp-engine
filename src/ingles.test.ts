import { describe, expect, it } from "vitest";
import type { CamposDoc, TipoDocExterno } from "./consistencia";
import { examinarPresentacion } from "./examen";
import { contextoDesdeSwift, DOCUMENTOS_CSU2025099, parseMT700, SWIFT_CSU2025099 } from "./index";
import { manualEnIngles, quedaEspanol, reglaEnIngles, textoEnIngles } from "./ingles";

/**
 * La prueba que importa es de **cobertura**: sobre el expediente real, ningún hallazgo puede
 * quedar con español afuera de las comillas. Si alguien agrega una regla nueva al motor y no la
 * traduce, este test falla antes de que el texto llegue a un aviso de rechazo.
 */

/**
 * El expediente real examinado en una fecha dada.
 *
 * La fecha es un parámetro y no una constante porque **las reglas de plazo solo existen cuando una
 * fecha pasó**. Con un solo escenario al día, «Presentar dentro de 21 días del BL» y «presentada
 * N días después del vencimiento» no se generan, y el test de cobertura los dejaba pasar: se
 * descubrieron mirando un aviso de rechazo de verdad, ya en inglés salvo esas cuatro líneas.
 */
const examenEn = (
  hoy: Date,
  anteriores: { referencia: string; fecha: Date; importe: number | null; fechaEmbarque: string | null }[] = [],
) => {
  const credito = parseMT700(SWIFT_CSU2025099)!;
  return examinarPresentacion({
    lc: credito.lc,
    credito: contextoDesdeSwift(credito),
    docs: (Object.entries(DOCUMENTOS_CSU2025099) as [TipoDocExterno, CamposDoc][]).map(([tipo, campos]) => ({
      tipo,
      exigencia: null,
      campos,
    })),
    presentacion: { referencia: `${anteriores.length + 1}`, fecha: hoy, importe: 51262, fechaEmbarque: "08-APR-2025" },
    anteriores,
    empresaRazonSocial: credito.extra.beneficiario[0] ?? "",
    hoy,
  });
};

/**
 * Los escenarios que hay que cubrir. Cada uno hace aparecer reglas que los otros no.
 */
const UN_GIRO_ANTERIOR = [
  { referencia: "1", fecha: new Date(2025, 3, 15), importe: 20000, fechaEmbarque: "08-APR-2025" },
];

const ESCENARIOS: [string, Date, typeof UN_GIRO_ANTERIOR][] = [
  ["dentro de todos los plazos", new Date(2025, 3, 20), []],
  ["pasado el plazo de presentación del 48", new Date(2025, 4, 15), []],
  ["pasado el vencimiento del crédito", new Date(2026, 8, 23), []],
  // El segundo giro trae las reglas del artículo 31 (parciales) y la cuenta del saldo con lo ya
  // girado. Faltaban en la cobertura y se descubrieron mirando una hoja de revisión de verdad.
  ["un segundo giro contra el mismo crédito", new Date(2025, 3, 20), UN_GIRO_ANTERIOR],
];

/**
 * El mismo expediente, pero con un documento de transporte aéreo.
 *
 * Hace falta porque las reglas del artículo 23 solo existen cuando el documento es aéreo, y con el
 * conocimiento marítimo del caso no se generaban: quedaban en español sin que nadie se enterara. Es
 * la misma lección que las reglas de plazo — un escenario único deja artículos enteros sin cubrir.
 */
const examenAereo = () => {
  const credito = parseMT700(SWIFT_CSU2025099)!;
  const c = (valor: string) => ({ valor, confianza: 0.9 });
  const awb: CamposDoc = {
    ...DOCUMENTOS_CSU2025099.BL!,
    tipoTransporte: c("AIR WAYBILL"),
    numeroDoc: c("020-12345678"),
    onBoard: c("FLIGHT UX042 DATED 10 APR 2025"),
    buque: c(""),
    charterParty: c(""),
    puertoEmbarque: c("MONTEVIDEO AIRPORT, URUGUAY"),
    puertoDestino: c("COLOMBO AIRPORT, SRI LANKA"),
  };
  return examinarPresentacion({
    lc: credito.lc,
    credito: { ...contextoDesdeSwift(credito), transbordo: "NOT ALLOWED" },
    docs: [
      { tipo: "FACTURA", campos: DOCUMENTOS_CSU2025099.FACTURA! },
      { tipo: "BL", campos: awb },
    ],
    empresaRazonSocial: credito.extra.beneficiario[0] ?? "",
    hoy: new Date(2025, 3, 20),
  });
};

const examenReal = () => ({ r: examenEn(new Date(2025, 3, 20)) });

function sinTraducirEn(r: { reglas: { regla: string; evidencia?: string | null }[] }) {
  return r.reglas
    .map((x) => reglaEnIngles(x as never))
    .flatMap((x) => [
      { donde: `regla «${x.regla}»`, palabra: quedaEspanol(x.regla) },
      { donde: `evidencia «${x.evidencia}»`, palabra: quedaEspanol(x.evidencia ?? "") },
    ])
    .filter((x) => x.palabra !== null);
}

describe("cobertura sobre el expediente real", () => {
  it("ningún hallazgo queda con español: con documento de transporte aéreo", () => {
    const sinTraducir = sinTraducirEn(examenAereo());
    expect(sinTraducir.map((x) => `${x.palabra} en ${x.donde}`)).toEqual([]);
  });

  it.each(ESCENARIOS)("ningún hallazgo queda con español: %s", (_nombre, hoy, anteriores) => {
    const r = examenEn(hoy, anteriores);
    const sinTraducir = r.reglas
      .map(reglaEnIngles)
      .flatMap((x) => [
        { donde: `regla «${x.regla}»`, palabra: quedaEspanol(x.regla) },
        { donde: `evidencia «${x.evidencia}»`, palabra: quedaEspanol(x.evidencia ?? "") },
      ])
      .filter((x) => x.palabra !== null);

    // El mensaje del fallo dice exactamente qué falta, para que arreglarlo no sea una búsqueda.
    expect(sinTraducir.map((x) => `${x.palabra} en ${x.donde}`)).toEqual([]);
  });

  it("los escenarios no son el mismo examen: cada uno trae reglas que los otros no", () => {
    // Si los tres dieran los mismos hallazgos, cubrir tres no valdría más que cubrir uno.
    const idsDe = (hoy: Date, ant: typeof UN_GIRO_ANTERIOR) =>
      new Set(examenEn(hoy, ant).reglas.map((x) => `${x.id}|${x.estado}`));
    const [a, b, c, d] = ESCENARIOS.map(([, hoy, ant]) => idsDe(hoy, ant));
    expect([...b!].some((x) => !a!.has(x))).toBe(true);
    expect([...c!].some((x) => !b!.has(x))).toBe(true);
    expect([...d!].some((x) => !a!.has(x))).toBe(true);
  });

  it("lo que queda a la persona tampoco", () => {
    const { r } = examenReal();
    const sinTraducir = r.manuales
      .map(manualEnIngles)
      .flatMap((m) => [quedaEspanol(m.que), quedaEspanol(m.porQue)])
      .filter((x) => x !== null);
    expect(sinTraducir).toEqual([]);
  });

  it("y el detector de español no es un colador: reconoce lo que no está traducido", () => {
    // Si `quedaEspanol` devolviera siempre null, los dos tests de arriba pasarían sin hacer nada.
    expect(quedaEspanol("No está en el paquete · 2 originales")).not.toBeNull();
    expect(quedaEspanol("la descripción de la mercadería")).not.toBeNull();
    expect(quedaEspanol("Not in the set · 2 originals")).toBeNull();
    expect(quedaEspanol("Clean transport document")).toBeNull();
  });
});

describe("las citas no se traducen", () => {
  it("lo entrecomillado queda letra por letra", () => {
    // Un aviso de rechazo que reescribiera lo que dice el papel sería inservible: el banco
    // presentador tiene que poder buscar esa frase exacta en su propio juego.
    expect(textoEnIngles('dice "FREIGHT COLLECT"')).toBe('says "FREIGHT COLLECT"');
    expect(textoEnIngles('dice "la mercadería no está a bordo"')).toBe('says "la mercadería no está a bordo"');
  });

  it("varias citas en el mismo texto vuelven cada una a su lugar", () => {
    const t = textoEnIngles('Tipo de bulto: factura comercial dice "BAGS", packing list dice "Bags"');
    expect(t).toBe('Package type: commercial invoice says "BAGS", packing list says "Bags"');
  });

  it("no quedan marcadores de sustitución en el texto", () => {
    const { r } = examenReal();
    const marcador = String.fromCharCode(0);
    for (const x of r.reglas.map(reglaEnIngles)) {
      expect(x.regla).not.toContain(marcador);
      expect(x.evidencia).not.toContain(marcador);
    }
  });
});

describe("el orden de los reemplazos no depende de cómo estén escritos", () => {
  it("una frase entera gana contra las palabras que la componen", () => {
    // Este texto contiene «beneficiario» y «dice», que por separado también se traducen. Si
    // ganaran las palabras, quedaría «Documentos propios con la dirección del beneficiary que
    // says la LC», que es peor que no tocarlo.
    expect(textoEnIngles("Documentos propios con la dirección del beneficiario que dice la LC")).toBe(
      "The beneficiary's own documents show the address stated in the credit",
    );
  });

  it("y las palabras siguen funcionando donde no hay frase que las cubra", () => {
    expect(textoEnIngles('emisor "CEREALSUR S.A" · beneficiario CEREALSUR S.A')).toBe(
      'issuer "CEREALSUR S.A" · beneficiary CEREALSUR S.A',
    );
  });
});

describe("lo que no se toca", () => {
  it("la fuente y el estado son claves, no texto para leer", () => {
    const { r } = examenReal();
    for (const [i, x] of r.reglas.entries()) {
      const t = reglaEnIngles(x);
      expect(t.fuente).toBe(x.fuente);
      expect(t.estado).toBe(x.estado);
      expect(t.id).toBe(r.reglas[i]!.id);
    }
  });

  it("los ítems del 46A ya vienen del crédito en inglés y salen igual", () => {
    expect(textoEnIngles("CERTIFICATE OF URUGUAY ORIGIN IN 02 FOLD")).toBe("CERTIFICATE OF URUGUAY ORIGIN IN 02 FOLD");
    expect(textoEnIngles("PACKING LIST IN 03 FOLD")).toBe("PACKING LIST IN 03 FOLD");
  });

  it("un texto vacío no se rompe", () => {
    expect(textoEnIngles("")).toBe("");
  });
});
