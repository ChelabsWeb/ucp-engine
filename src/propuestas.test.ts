import { describe, expect, it } from "vitest";
import type { EjemploDeRegla, PropuestaDeRegla } from "./propuestas";
import { revisarPropuesta } from "./propuestas";

/* El texto del artículo 14 (i), que es corto y lo tenemos verificado. */
const FUENTE =
  "Article 14 (i). A document may be dated prior to the issuance date of the credit, but must not " +
  "be dated later than its date of presentation.";

const buena: PropuestaDeRegla = {
  id: "ucp-14i-propuesta",
  reglamento: "UCP 600",
  parrafo: "14 (i)",
  cita: "A document may be dated prior to the issuance date of the credit",
  afirma: "Un documento fechado antes de la emisión del crédito no es discrepancia por serlo",
  campos: ["fechaDocumento"],
  ejemplos: [
    {
      dado: { fechaDocumento: "12-feb-2026" },
      estado: "OK",
      porQue: "anterior a la emisión del crédito, que es lo que el artículo admite expresamente",
    },
    {
      dado: { fechaDocumento: "30-dic-2026" },
      estado: "DISCREPANCIA",
      porQue: "posterior a la fecha de presentación, que es lo único que el artículo prohíbe",
    },
  ],
};

const reparos = (cambios: Partial<PropuestaDeRegla>, fuente = FUENTE) =>
  revisarPropuesta({ ...buena, ...cambios }, fuente).map((r) => r.que);

describe("una propuesta en condiciones de revisarse", () => {
  it("no tiene reparos", () => {
    expect(revisarPropuesta(buena, FUENTE)).toEqual([]);
  });

  it("tolera que la cita venga en otra caja que el original", () => {
    /* Un párrafo copiado de un campo SWIFT viene entero en mayúsculas, y el mismo texto en la
       publicación está en minúsculas. Exigir la misma caja rechazaría citas legítimas. */
    expect(reparos({ cita: "A DOCUMENT MAY BE DATED PRIOR TO THE ISSUANCE DATE OF THE CREDIT" })).toEqual([]);
  });

  it("tolera que la cita venga con comillas curvas, guiones largos y saltos de línea", () => {
    /* Un texto copiado de un PDF trae todo eso. Exigir coincidencia byte por byte haría que toda
       cita legítima fallara. */
    const sucia = "A document may be dated prior\n   to the issuance date of the credit";
    expect(reparos({ cita: sucia })).toEqual([]);
  });
});

describe("lo que una propuesta no puede pasar", () => {
  /*
   * El control que da sentido a todo el canal.
   *
   * Un modelo que lee un reglamento puede inventarse un párrafo que suena perfectamente a ISBP. Si
   * eso entra, el motor queda citando algo que no existe — y lo único que hace defendible un
   * hallazgo es que el examinador pueda ir a buscarlo a la publicación.
   */
  it("una cita que no está en el texto fuente", () => {
    const inventada = "A document must be signed by the issuer in all cases";
    expect(reparos({ cita: inventada })[0]).toMatch(/no está en el texto fuente/);
  });

  it("una cita parafraseada, que es la invención con buena intención", () => {
    const parafraseada = "Un documento puede llevar fecha anterior a la emisión del crédito";
    expect(reparos({ cita: parafraseada })[0]).toMatch(/no está en el texto fuente/);
  });

  it("una conclusión probabilística", () => {
    expect(reparos({ afirma: "Un documento así probablemente sea aceptable" })).toContainEqual(
      expect.stringMatching(/probabil[íi]stico/),
    );
  });

  it("un campo que el motor no extrae", () => {
    expect(reparos({ campos: ["firmaDelCapitan" as never] })).toContainEqual(
      expect.stringMatching(/pide campos que el motor no extrae/),
    );
  });

  it("sin ningún ejemplo que la dispare", () => {
    expect(reparos({ ejemplos: [buena.ejemplos[0] as EjemploDeRegla] })).toContainEqual(
      expect.stringMatching(/ningún ejemplo la dispara/),
    );
  });

  it("sin contraejemplo, que es lo que deja ver dónde está el borde", () => {
    expect(reparos({ ejemplos: [buena.ejemplos[1] as EjemploDeRegla] })).toContainEqual(
      expect.stringMatching(/ningún contraejemplo/),
    );
  });

  it("un ejemplo que usa un campo que la regla no declaró leer", () => {
    const ej: EjemploDeRegla = {
      dado: { fechaEmbarque: "01-ene-2026" },
      estado: "OK",
      porQue: "el ejemplo mira un campo que la regla no pidió",
    };
    expect(reparos({ ejemplos: [ej, buena.ejemplos[1] as EjemploDeRegla] })).toContainEqual(
      expect.stringMatching(/campos que la regla no declaró leer/),
    );
  });

  it.each([
    ["sin identificador", { id: "" }],
    ["sin fuente", { parrafo: "" }],
    ["sin cita", { cita: "" }],
    ["no dice qué afirma", { afirma: "" }],
    ["no dice qué campos lee", { campos: [] }],
  ])("%s", (esperado, cambio) => {
    expect(reparos(cambio as never)).toContainEqual(esperado);
  });
});
