import { describe, expect, it } from "vitest";
import type { CamposDoc } from "./consistencia";
import type { Enmienda } from "./enmiendas";
import { contextoDesdeSwift, examinarConEnmienda } from "./examen";
import { DOCUMENTOS_CSU2025099, SWIFT_CSU2025099 } from "./fixtures";
import { parseMT700 } from "./swift-lc";

/**
 * La presentación que acepta la enmienda sin que nadie la conteste (UCP 600 10 c).
 *
 * El artículo tiene dos mitades y solo estaba la primera. La que faltaba: si el beneficiario no
 * notificó nada, una presentación que cumpla **con el crédito y con la enmienda todavía no
 * aceptada** se tiene por notificación de aceptación, y desde ese momento el crédito queda
 * enmendado.
 *
 * Importa para el giro **siguiente**, no para este. Esta presentación cumple con los dos créditos,
 * así que su veredicto es el mismo mire contra cuál; lo que cambia es contra qué se examina el
 * próximo giro. Decidirlo mal es examinar el giro que viene contra el crédito equivocado, y eso
 * invierte el resultado entero.
 *
 * Para saberlo hay que examinar contra los dos créditos y comparar. Eso lo hace el motor y no la
 * pantalla: la pantalla no decide nada.
 */

const swift = parseMT700(SWIFT_CSU2025099)!;
const CTX = contextoDesdeSwift(swift);
const campo = (valor: string) => ({ valor, confianza: 0.95 });

/** La enmienda real del expediente: corre el vencimiento y el último embarque. */
const ENMIENDA: Enmienda = {
  numeroLC: swift.lc.numero,
  numeroEnmienda: "1",
  fecha: "15-abr-25",
  vencimiento: "31-jul-25",
  limiteEmbarque: "31-may-25",
  narrativa: null,
};

/**
 * Los siete certificados del 46A, cargados y conformes.
 *
 * Hacen falta para que la presentación **cumpla**: con solo los tres documentos principales, las
 * otras siete líneas del crédito salen FALTA y una presentación incompleta no acepta ninguna
 * enmienda. Lo descubrí al revés — el test positivo falló con el paquete real, y tenía razón.
 */
const CERTIFICADOS = (swift.lc.documentosExigidos ?? [])
  .filter((e) => !/invoice|packing|bills? of lading/i.test(e))
  .map((exigencia) => ({
    exigencia,
    campos: {
      exportador: campo("CEREALSUR S.A"),
      emisorSeguro: campo(/veterinary/i.test(exigencia) ? "MINISTERIO DE GANADERIA" : "SGS URUGUAY"),
      fechaDocumento: campo("08-abr-25"),
      mercaderia: campo(/analysis/i.test(exigencia) ? "PROTEIN 61,1 PCT" : "FISH MEAL — COUNTRY OF ORIGIN: URUGUAY"),
      numeroDoc: campo("LCMRDN25000471"),
      puertoEmbarque: campo("MONTEVIDEO"),
      pesoBruto: campo("54.040 KGS"),
    } as unknown as CamposDoc,
  }));

const docs = (over: Partial<CamposDoc> = {}) =>
  (["FACTURA", "PACKING", "BL"] as const).map((tipo) => ({
    tipo,
    campos: { ...(DOCUMENTOS_CSU2025099[tipo] as CamposDoc), ...(tipo === "BL" ? over : {}) },
  }));

const correr = (
  estado: Parameters<typeof examinarConEnmienda>[0]["estado"],
  over: Partial<CamposDoc> = {},
  fechaEmbarque = "08-abr-25",
  /** el juego completo y conforme, que es el único que puede aceptar una enmienda */
  conforme = true,
) =>
  examinarConEnmienda({
    lc: swift.lc,
    enmienda: ENMIENDA,
    estado,
    credito: CTX,
    certificados: conforme ? CERTIFICADOS : [],
    docs: docs(conforme ? { tipoBulto: campo("BAGS"), ...over } : over),
    presentacion: {
      referencia: `${swift.lc.numero}-1`,
      fecha: new Date(2025, 3, 22),
      importe: 51262,
      fechaEmbarque,
    },
    empresaRazonSocial: swift.extra.beneficiario[0] ?? "",
    empresaDireccion: swift.lc.beneficiarioDireccion,
    hoy: new Date(2025, 3, 22),
  });

describe("sin respuesta del beneficiario", () => {
  it("se examina contra el crédito original (10 c, primera mitad)", () => {
    expect(correr("SIN_RESPUESTA").rige).toBe("ORIGINAL");
  });

  it("y una presentación que cumple con los dos la acepta", () => {
    // Embarcó el 8 de abril: dentro del último embarque original (30-abr) y del enmendado (31-may).
    const r = correr("SIN_RESPUESTA");
    expect(r.aceptacion.aceptada).toBe(true);
    expect(r.aceptacion.porQue).toMatch(/10 ?\(?c\)?/);
  });

  it("pero una presentación con discrepancias no acepta nada", () => {
    /*
     * Esto lo encontré al revés: escribí el test positivo con el paquete real del expediente y
     * falló. Tenía razón — ese paquete tiene la discrepancia del tipo de bulto y los siete
     * certificados sin cargar, así que **no cumple**, y una presentación que no cumple no puede
     * valer como aceptación de nada. El artículo pide que cumpla con los dos créditos.
     */
    const r = correr("SIN_RESPUESTA", {}, "08-abr-25", false);
    expect(r.examen.discrepancias + r.examen.faltan).toBeGreaterThan(0);
    expect(r.aceptacion.aceptada).toBe(false);
    expect(r.rigeDespues).toBe("ORIGINAL");
  });

  it("desde entonces rige el enmendado, que es contra qué se examina el giro siguiente", () => {
    expect(correr("SIN_RESPUESTA").rigeDespues).toBe("ENMENDADO");
  });

  it("el veredicto de esta presentación no cambia por eso", () => {
    /*
     * Es la parte que no hay que confundir: la aceptación rige «desde ese momento», y esta
     * presentación cumple con los dos créditos igual. Si el examen cambiara acá, el motor estaría
     * aplicando la enmienda a una presentación que se examinó antes de que fuera aceptada.
     */
    const r = correr("SIN_RESPUESTA");
    expect(r.examen.discrepancias).toBe(r.contraElEnmendado.discrepancias);
  });
});

describe("una presentación que solo cumple con uno de los dos", () => {
  it("embarcada según la enmienda y fuera del plazo original: no la acepta", () => {
    /*
     * El caso incómodo del artículo: el beneficiario embarcó el 15 de mayo, que entra en el último
     * embarque enmendado (31-may) y no en el original (30-abr). Contra el crédito que rige para él
     * esos documentos **no cumplen**, y la enmienda tampoco queda aceptada por haberlos presentado.
     */
    const r = correr(
      "SIN_RESPUESTA",
      { fechaEmbarque: campo("15-may-25"), onBoard: campo("SHIPPED ON BOARD 15-MAY-2025") },
      "15-may-25",
    );
    expect(r.aceptacion.aceptada).toBe(false);
    expect(r.aceptacion.porQue).toMatch(/original/i);
    expect(r.rigeDespues).toBe("ORIGINAL");
  });

  it("y el examen lo dice: contra el original hay más discrepancias que contra el enmendado", () => {
    const r = correr(
      "SIN_RESPUESTA",
      { fechaEmbarque: campo("15-may-25"), onBoard: campo("SHIPPED ON BOARD 15-MAY-2025") },
      "15-may-25",
    );
    expect(r.examen.discrepancias).toBeGreaterThan(r.contraElEnmendado.discrepancias);
  });
});

describe("cuando el beneficiario ya contestó", () => {
  it("aceptada: se examina contra el enmendado y no hay nada que deducir", () => {
    const r = correr("ACEPTADA");
    expect(r.rige).toBe("ENMENDADO");
    expect(r.rigeDespues).toBe("ENMENDADO");
  });

  it("rechazada: sigue el original, y una presentación conforme no la resucita", () => {
    const r = correr("RECHAZADA");
    expect(r.rige).toBe("ORIGINAL");
    expect(r.aceptacion.aceptada).toBe(false);
    expect(r.rigeDespues).toBe("ORIGINAL");
  });

  it("aceptada en parte vale como rechazo (10 e)", () => {
    expect(correr("ACEPTADA_EN_PARTE").rige).toBe("ORIGINAL");
  });
});

describe("las observaciones del artículo acompañan al examen", () => {
  it("sin respuesta, recuerda contra qué se examinó", () => {
    expect(correr("SIN_RESPUESTA").observaciones.some((o) => o.id === "ucp-10c")).toBe(true);
  });

  it("y la cláusula de aceptación por silencio se desestima (10 f)", () => {
    const r = examinarConEnmienda({
      lc: swift.lc,
      enmienda: { ...ENMIENDA, narrativa: "THIS AMENDMENT SHALL BE DEEMED ACCEPTED UNLESS REJECTED WITHIN 7 DAYS" },
      estado: "SIN_RESPUESTA",
      credito: CTX,
      docs: docs(),
      empresaRazonSocial: swift.extra.beneficiario[0] ?? "",
      hoy: new Date(2025, 3, 22),
    });
    expect(r.observaciones.some((o) => o.id === "ucp-10f")).toBe(true);
  });
});
