import { describe, expect, it } from "vitest";
import { aparearConExigencias, type DocCertificado } from "./certificados";
import type { CamposDoc } from "./consistencia";
import { contextoDesdeSwift, examinarPresentacion } from "./examen";
import { DOCUMENTOS_CSU2025099, SWIFT_CSU2025099 } from "./fixtures";
import type { DocAnalizado } from "./presentacion";
import { parseMT700 } from "./swift-lc";

/**
 * Los certificados, por el camino que usa el producto.
 *
 * `certificados.ts` y `especificaciones.ts` estaban probados en unidad y **el producto no los
 * ejecutaba nunca**: nadie fuera de los tests le pasaba `certificados` a `examinarPresentacion`.
 * La pantalla ofrecía tres tipos de documento —factura, packing, conocimiento— y los otros siete
 * del 46A no tenían dónde cargarse.
 *
 * Eso no se veía como una falla, se veía como siete FALTA. Y yo los venía leyendo mal: no faltaban
 * documentos, faltaba la casilla donde cargarlos. Con el crédito real —que pide diez documentos—
 * `listo` no podía ser `true` nunca, por construcción.
 *
 * Así que este test no prueba una regla nueva: prueba que las reglas que ya existían **se
 * ejecutan**. Es el test que debería haber existido antes que las 600 líneas que verifica.
 */

const swift = parseMT700(SWIFT_CSU2025099)!;
const CTX = contextoDesdeSwift(swift);
const campo = (valor: string, confianza = 0.95) => ({ valor, confianza });

const PRINCIPALES: DocAnalizado[] = (["FACTURA", "PACKING", "BL"] as const).map((tipo) => ({
  tipo,
  campos: DOCUMENTOS_CSU2025099[tipo] as CamposDoc,
}));

const correr = (certificados?: DocCertificado[]) =>
  examinarPresentacion({
    lc: swift.lc,
    credito: CTX,
    docs: PRINCIPALES,
    certificados,
    presentacion: {
      referencia: `${swift.lc.numero}-1`,
      fecha: new Date(2025, 3, 22),
      importe: 51262,
      fechaEmbarque: "08-abr-25",
    },
    empresaRazonSocial: swift.extra.beneficiario[0] ?? "",
    empresaDireccion: swift.lc.beneficiarioDireccion,
    hoy: new Date(2025, 3, 22),
  });

/** Un certificado como lo carga el examinador: su exigencia del 46A y los campos leídos del papel. */
const cert = (exigencia: string, campos: Partial<CamposDoc> = {}): DocCertificado => ({
  exigencia,
  campos: {
    exportador: campo("CEREALSUR S.A"),
    fechaDocumento: campo("08-abr-25"),
    mercaderia: campo("FISH MEAL 54PCT MIN (FOR ANIMAL FEED USE)"),
    numeroDoc: campo("LCMRDN25000471"),
    ...campos,
  } as CamposDoc,
});

describe("sin los certificados, el examen no puede terminar", () => {
  it("el crédito real pide diez documentos y el camino de la pantalla solo cargaba tres", () => {
    // Los diez del 46A: factura, conocimiento, origen, packing, nota de peso, veterinario,
    // fumigación, análisis y dos certificados del beneficiario.
    expect(swift.lc.documentosExigidos?.length).toBe(10);
  });

  it("con los tres principales perfectos, `listo` sigue siendo false", () => {
    // Y no por un defecto de los papeles: por los siete que no tenían dónde cargarse.
    const r = correr();
    expect(r.faltan).toBeGreaterThan(0);
    expect(r.listo).toBe(false);
  });

  it("ninguna regla de certificado se ejecuta: las 600 líneas no corren", () => {
    expect(correr().reglas.filter((x) => x.id.startsWith("cert-"))).toHaveLength(0);
  });
});

describe("pasándolos, las reglas que ya existían se ejecutan", () => {
  const SIETE = [
    cert("+3)CERTIFICATE OF URUGUAY ORIGIN IN 02 FOLD", { puertoEmbarque: campo("MONTEVIDEO") }),
    cert("+5)WEIGHT  NOTE IN 03 FOLD."),
    cert("+6)INTERNATIONAL VETERINARY HEALTH CERTIFICATE ISSUED BY GOVT.VETERINERY AUTHORITY IN URUGUAY.", {
      emisorSeguro: campo("MINISTERIO DE GANADERIA, AGRICULTURA Y PESCA"),
    }),
    cert("+7)FUMIGATION CERTIFICATE."),
    cert("+8)CERTIFICATE OF ANALYSIS", { mercaderia: campo("FISH MEAL, PROTEIN 61,1 PCT") }),
    cert("+9)BENEFICIARY'S CERTIFICATE CONFIRMING ALL ADVISING BANK BANK CHARGES OUTSIDE SRI LANKA HAVE BEEN SETTLED."),
    cert(
      "+10)BENEFICIARY'S CERTIFICATE CONFIRMING THAT A FULL SET OF COPY DOCUMENTS HAVE BEEN EMAILED TO IMPORTS(AT)ORIENTFEED.EXAMPLE WITHIN 21 DAYS FROM THE DATE OF SHIPMENT.",
    ),
  ];

  it("aparecen reglas de certificado donde antes no había ninguna", () => {
    const r = correr(SIETE);
    expect(r.reglas.filter((x) => x.id.startsWith("cert-")).length).toBeGreaterThan(0);
  });

  it("y bajan los FALTA: los siete documentos dejan de estar ausentes", () => {
    expect(correr(SIETE).faltan).toBeLessThan(correr().faltan);
  });

  it("el certificado de análisis se coteja contra la calidad del 45A", () => {
    // El crédito pide «54 PCT MIN» en el campo 45A y el análisis declara 61,1 %: cumple.
    const spec = correr(SIETE).reglas.find((x) => x.id.startsWith("cert-spec-"));
    expect(spec?.estado).toBe("OK");
    expect(spec?.evidencia).toMatch(/54/);
  });

  it("y la línea del 46A del certificado pasa de FALTA a OK", () => {
    // Es el cambio concreto: la exigencia +8 del crédito real.
    const antes = correr().reglas.find((x) => x.id === "46A+8");
    const despues = correr(SIETE).reglas.find((x) => x.id === "46A+8");
    expect(antes?.estado).toBe("FALTA");
    expect(despues?.estado).toBe("OK");
    expect(despues?.evidencia).toMatch(/Presentado/);
  });
});

describe("y un certificado defectuoso sale como discrepancia contada", () => {
  it("un análisis por debajo del mínimo del crédito", () => {
    /*
     * El mismo papel con 47,2 % contra el «54 PCT MIN» del 45A. Esta es la discrepancia que el
     * producto no podía encontrar: no porque la regla no existiera, sino porque el documento no
     * tenía dónde entrar.
     */
    const flojo = [
      ...[
        cert("+3)CERTIFICATE OF URUGUAY ORIGIN IN 02 FOLD", { puertoEmbarque: campo("MONTEVIDEO") }),
        cert("+8)CERTIFICATE OF ANALYSIS", { mercaderia: campo("FISH MEAL, PROTEIN 47,2 PCT") }),
      ],
    ];
    const r = correr(flojo);
    const mala = r.reglas.find((x) => x.id.startsWith("cert-spec-"));
    expect(mala?.estado).toBe("DISCREPANCIA");
    // el número de los dos lados, que es lo que un examinador tiene que poder leer sin abrir nada
    expect(mala?.evidencia).toMatch(/54/);
    expect(mala?.evidencia).toMatch(/47,2/);
    expect(r.discrepancias).toBeGreaterThan(0);
  });
});

describe("el apareo con el 46A, que es lo que la pantalla necesita", () => {
  it("aparea cada papel cargado con la línea del crédito que lo pide", () => {
    const r = aparearConExigencias(swift.lc, [
      { tipo: "CERTIFICATE OF ANALYSIS", campos: cert("x").campos },
      { tipo: "FUMIGATION CERTIFICATE", campos: cert("x").campos },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]?.exigencia).toMatch(/ANALYSIS/i);
    expect(r[1]?.exigencia).toMatch(/FUMIGATION/i);
  });

  it("un papel que el crédito no pide no se aparea con nada (art. 14 g)", () => {
    expect(aparearConExigencias(swift.lc, [{ tipo: "INSURANCE POLICY", campos: cert("x").campos }])).toEqual([]);
  });
});
