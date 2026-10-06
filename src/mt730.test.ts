import { describe, expect, it } from "vitest";
import type { EstadoEnmienda } from "./enmienda-vigencia";
import { type DatosMT730, mt730 } from "./mt730";

/**
 * El acuse, que es por donde viaja la aceptación de una enmienda (MT730).
 *
 * Parece el mensaje menos interesante de la lista y no lo es. El artículo 10 (c) dice que los
 * términos originales siguen rigiendo para el beneficiario **hasta que comunique su aceptación al
 * banco que le avisó la enmienda**, y el MT730 es la vía por la que esa comunicación llega al
 * emisor. O sea: es el mensaje que **cambia cuál de los dos créditos manda**.
 *
 * `examinarConEnmienda` ya sabía contra cuál se examina según el estado; esto es la otra punta —
 * decirle al emisor qué contestó el beneficiario, para que los dos bancos estén examinando contra
 * el mismo crédito.
 *
 * Y lleva una regla del artículo que es fácil de transmitir mal: **una aceptación parcial es un
 * rechazo** (10 e). Si el mensaje dijera «aceptada en parte», el emisor podría leer que la enmienda
 * rige, y no rige.
 */

const BASE: DatosMT730 = {
  referenciaPropia: "ACK-2025-0417",
  referenciaCredito: "LCMRDN25000471",
  fechaDelMensajeAcusado: new Date(2025, 3, 15),
  fecha: new Date(2025, 3, 17),
  numeroEnmienda: "1",
  estado: "ACEPTADA",
};

const con = (estado: EstadoEnmienda) => mt730({ ...BASE, estado });

/**
 * El mensaje con las líneas unidas, para poder afirmar sobre frases.
 *
 * Los campos de SWIFT se cortan a 35 caracteres, así que «REMAIN IN FORCE» puede quedar partido en
 * dos líneas y una búsqueda sobre el texto crudo no lo encuentra. Es una propiedad del formato, no
 * un detalle del test: lo que se quiere afirmar es lo que el otro banco va a leer.
 */
const seguido = (texto: string) => texto.replace(/\n/g, " ").replace(/\s+/g, " ");

describe("el acuse de recibo", () => {
  it("sale con los campos del 730", () => {
    const m = mt730(BASE);
    for (const tag of [":20:", ":21:", ":30:"]) expect(m.texto, `falta ${tag}`).toContain(tag);
  });

  it("el 21 es el crédito y el 30 la fecha del mensaje que se acusa", () => {
    const m = mt730(BASE);
    expect(m.texto).toContain(":21:LCMRDN25000471");
    expect(m.texto).toContain(":30:250415");
  });
});

describe("lo que el artículo 10 (c) manda comunicar", () => {
  it("aceptada: lo dice, y dice desde cuándo rige el enmendado", () => {
    const m = con("ACEPTADA");
    expect(seguido(m.texto)).toMatch(/ACCEPT/i);
    expect(m.texto).toContain(":79:");
    // el número de la enmienda, porque un crédito puede llevar varias
    expect(seguido(m.texto)).toMatch(/AMENDMENT NO\.? ?1/i);
  });

  it("rechazada: también se comunica, que el emisor tiene que saber que no rige", () => {
    const m = con("RECHAZADA");
    expect(seguido(m.texto)).toMatch(/REJECT/i);
  });

  it("aceptada en parte se transmite como rechazo (10 e), no como aceptación parcial", () => {
    /*
     * Es la que importa. Si el mensaje dijera «aceptada en parte», el emisor podría leer que la
     * enmienda rige — y no rige: el artículo dice que una aceptación parcial **es** un rechazo.
     * Transmitirlo con las palabras del beneficiario dejaría a los dos bancos examinando contra
     * créditos distintos.
     */
    const m = con("ACEPTADA_EN_PARTE");
    expect(seguido(m.texto)).toMatch(/REJECT/i);
    expect(seguido(m.texto)).toMatch(/10 ?\(?E\)?/i);
    /*
     * Lo que se afirma es el significado, no una cadena.
     *
     * La primera versión exigía que el mensaje no contuviera «partial accept», y el mensaje dice
     * «PARTIAL ACCEPTANCE IS NOT ALLOWED»: la frase aparece dentro de su propia negación. Lo que
     * importa es que el emisor no pueda leer que el crédito quedó enmendado.
     */
    expect(seguido(m.texto)).not.toMatch(/CREDIT IS AMENDED/i);
    expect(seguido(m.texto)).toMatch(/REMAIN IN FORCE/i);
    expect(m.avisos.join(" ")).toMatch(/partial|rejection/i);
  });

  it("sin respuesta: se acusa el recibo y no se dice nada del beneficiario", () => {
    /*
     * El acuse vale por sí mismo —el emisor sabe que su enmienda llegó— pero inventar una
     * aceptación que nadie dio sería lo peor: el emisor pasaría a creer que el crédito está
     * enmendado y examinaría contra el crédito equivocado.
     */
    const m = con("SIN_RESPUESTA");
    expect(m.texto).toContain(":20:");
    expect(seguido(m.texto)).not.toMatch(/ACCEPT|REJECT/i);
    expect(m.avisos.join(" ")).toMatch(/not (yet )?(answered|replied|communicated)/i);
  });
});

describe("lo que no se transmite mal", () => {
  it("sin número de enmienda, el acuse sale igual y lo dice", () => {
    const m = mt730({ ...BASE, numeroEnmienda: null });
    expect(m.texto).toContain(":20:");
    expect(m.avisos.join(" ")).toMatch(/amendment number/i);
  });

  it("una eñe en una nota se reemplaza y se avisa", () => {
    const m = mt730({ ...BASE, informacion: ["CONFIRMADO POR PEÑAROL GRANOS"] });
    expect(m.texto).toContain("PENAROL");
    expect(m.avisos.join(" ")).toMatch(/character/i);
  });

  it("la referencia que no entra en 16 caracteres se recorta y se dice", () => {
    const m = mt730({ ...BASE, referenciaPropia: "ACUSE-DEMASIADO-LARGO-2025-0417" });
    expect(m.avisos.join(" ")).toMatch(/16/);
  });
});
