import { describe, expect, it } from "vitest";
import { SWIFT_CSU2025099 } from "./fixtures";
import { papelDelBanco, reglasDelPapel } from "./papel";
import { parseMT700 } from "./swift-lc";

/**
 * Qué papel juega el banco que examina, y qué le exigen las UCP por eso.
 *
 * El motor examinaba igual para todos, y las UCP no: sobre el **mismo** juego de papeles conforme,
 * el banco emisor **tiene que honrar** (art. 7 a y 15 a), un banco designado que no agregó su
 * confirmación **no está obligado a nada** (art. 12 a) y un banco avisador que no está designado
 * **no examina para honrar** — lo suyo es la autenticidad aparente y que el aviso refleje los
 * términos (art. 9). Son conclusiones distintas, no matices.
 *
 * Y no hace falta preguntárselo al examinador en cada crédito: el crédito lo dice. El 52A nombra al
 * emisor, el 41A/41D con quién está disponible, el 57A a través de quién se avisa, y el encabezado
 * a quién se mandó. Lo único que el banco declara una vez es su propio BIC.
 */

const swift = parseMT700(SWIFT_CSU2025099)!;
const DEL_CREDITO = {
  bicEmisor: swift.extra.bicEmisor,
  bicAvisador: swift.extra.bicAvisador,
  bicDisponibleCon: swift.extra.bicDisponibleCon,
  bicReceptor: swift.extra.bicReceptor,
  disponibleCon: swift.extra.disponibleCon,
  confirmacion: swift.extra.confirmacion,
};

describe("el papel sale del crédito", () => {
  it("el banco del 52A es el emisor", () => {
    const r = papelDelBanco({ ...DEL_CREDITO, bicPropio: "MRDNLKLX" });
    expect(r?.papel).toBe("EMISOR");
    expect(r?.porQue).toMatch(/52A/);
  });

  it("el del 57A es el avisador, y el BIC de ocho casa con el de once", () => {
    // El crédito real escribe «BLITUYMM» en el 57A y «BLITUYMMXXX» en el encabezado: el mismo banco.
    const r = papelDelBanco({ ...DEL_CREDITO, bicPropio: "BLITUYMMXXX" });
    expect(r?.papel).toBe("AVISADOR");
  });

  it("un banco que el crédito no menciona no tiene papel en él", () => {
    const r = papelDelBanco({ ...DEL_CREDITO, bicPropio: "BSCHESMMXXX" });
    expect(r?.papel).toBe("NO_NOMBRADO");
  });

  it("sin el BIC propio no se adivina nada", () => {
    expect(papelDelBanco({ ...DEL_CREDITO, bicPropio: null })).toBeNull();
  });

  it("el nombrado por BIC en el 41A es el designado", () => {
    const r = papelDelBanco({
      ...DEL_CREDITO,
      bicDisponibleCon: "BROUUYMM",
      disponibleCon: "BROUUYMM BY NEGOTIATION",
      bicPropio: "BROUUYMMXXX",
    });
    expect(r?.papel).toBe("DESIGNADO");
    expect(r?.porQue).toMatch(/41/);
  });
});

describe("la designación abierta, que el crédito real usa", () => {
  /*
   * «ANY BANK IN URUGUAY BY NEGOTIATION» designa por país y no por BIC. El motor **no** resuelve si
   * este banco está incluido: haría falta una tabla de nombres de país que se queda vieja, y
   * equivocarse acá cambia si el banco está obligado o no. Se dice y lo mira una persona.
   */
  it("el avisador del crédito real queda avisador, con la duda dicha", () => {
    const r = papelDelBanco({ ...DEL_CREDITO, bicPropio: "BLITUYMM" });
    expect(r?.papel).toBe("AVISADOR");
    expect(r?.designacionAbierta).toBe("ANY BANK IN URUGUAY BY NEGOTIATION");
  });

  it("y eso sale como regla a verificar, porque cambia si el banco está obligado", () => {
    const r = papelDelBanco({ ...DEL_CREDITO, bicPropio: "BLITUYMM" })!;
    const reglas = reglasDelPapel(r, { conforme: true });
    const abierta = reglas.find((x) => x.id === "papel-designacion-abierta");
    expect(abierta?.estado).toBe("ATENCION");
    expect(abierta?.evidencia).toMatch(/ANY BANK IN URUGUAY/);
  });
});

describe("qué le exigen las UCP a cada uno, sobre el mismo juego conforme", () => {
  const con = (bicPropio: string, over: Partial<typeof DEL_CREDITO> = {}) =>
    reglasDelPapel(papelDelBanco({ ...DEL_CREDITO, ...over, bicPropio })!, { conforme: true });

  it("al emisor: tiene que honrar (art. 7 a y 15 a)", () => {
    const r = con("MRDNLKLX").find((x) => x.id === "papel-obligacion");
    expect(r?.fuente).toMatch(/7|15/);
    expect(r?.regla).toMatch(/honrar/i);
    expect(r?.estado).toBe("OK");
  });

  it("al designado que no confirmó: no está obligado (art. 12 a)", () => {
    const r = con("BROUUYMMXXX", {
      bicDisponibleCon: "BROUUYMM",
      disponibleCon: "BROUUYMM BY NEGOTIATION",
      confirmacion: "WITHOUT",
    }).find((x) => x.id === "papel-obligacion");
    expect(r?.fuente).toMatch(/12/);
    expect(r?.regla).toMatch(/no (está|esta) obligado|puede/i);
    // no es un problema: es la situación en la que está
    expect(r?.estado).toBe("ATENCION");
  });

  it("al avisador no designado: lo suyo no es honrar (art. 9)", () => {
    const r = con("BLITUYMM").find((x) => x.id === "papel-obligacion");
    expect(r?.fuente).toMatch(/9/);
    expect(r?.regla).toMatch(/aviso|autenticidad|no asume/i);
  });

  it("y si el crédito le pide confirmar, se dice: la obligación cambia (art. 8)", () => {
    const r = con("BLITUYMM", { confirmacion: "CONFIRM" }).find((x) => x.id === "papel-confirmacion-pedida");
    expect(r?.estado).toBe("ATENCION");
    expect(r?.fuente).toMatch(/49|8/);
    expect(r?.evidencia).toMatch(/confirm/i);
  });

  it("y si no se la pide, no se inventa la pregunta", () => {
    expect(con("BLITUYMM").find((x) => x.id === "papel-confirmacion-pedida")).toBeUndefined();
  });
});

describe("con una presentación que no cumple, la obligación no se afirma", () => {
  it("el emisor no tiene que honrar un juego discrepante", () => {
    const papel = papelDelBanco({ ...DEL_CREDITO, bicPropio: "MRDNLKLX" })!;
    const r = reglasDelPapel(papel, { conforme: false }).find((x) => x.id === "papel-obligacion");
    // sigue diciéndose quién es y qué artículo lo rige, pero no que deba honrar
    expect(r?.regla).not.toMatch(/tiene que honrar/i);
    expect(r?.evidencia).toMatch(/discrepanc|no cumple/i);
  });
});

describe("el artículo 35: los documentos que se pierden en el camino", () => {
  /*
   * «Si un banco designado determina que una presentación es conforme y remite los documentos al
   * banco emisor o al confirmador, haya honrado o negociado o no, el banco emisor o el confirmador
   * tiene que honrar o negociar, o reembolsar a ese banco designado, **aun cuando los documentos se
   * hayan perdido en el tránsito** entre el designado y el emisor o el confirmador.»
   *
   * Es de las pocas reglas de las UCP que protegen al banco que examina, y lo que la activa es
   * justamente **su propia determinación de conformidad**. O sea: el examen asentado es lo que lo
   * cubre si el juego se pierde en el courier. Eso un banco designado tiene que saberlo, y no lo
   * dice ningún otro artículo del examen.
   *
   * Por eso sale solo para un designado o un confirmador, y solo con una presentación conforme: a
   * un emisor no le protege nada —él es el que tiene que honrar— y con discrepancias no hay
   * determinación de conformidad que valga.
   */
  const conPapel = (bicPropio: string, conforme: boolean, over: Partial<typeof DEL_CREDITO> = {}) =>
    reglasDelPapel(papelDelBanco({ ...DEL_CREDITO, ...over, bicPropio })!, { conforme });

  const DESIGNADO = {
    bicDisponibleCon: "BROUUYMM",
    disponibleCon: "BROUUYMM BY NEGOTIATION",
  };

  it("al designado con un juego conforme, se le dice que su examen lo cubre", () => {
    const r = conPapel("BROUUYMMXXX", true, DESIGNADO).find((x) => x.id === "papel-35");
    expect(r?.fuente).toMatch(/35/);
    expect(r?.regla).toMatch(/pierd/i);
    expect(r?.evidencia).toMatch(/remit|reembols/i);
  });

  it("con discrepancias no se dice: no hay determinación de conformidad que lo active", () => {
    expect(conPapel("BROUUYMMXXX", false, DESIGNADO).find((x) => x.id === "papel-35")).toBeUndefined();
  });

  it("al emisor no se le dice: a él no lo protege, él es el que tiene que honrar", () => {
    expect(conPapel("MRDNLKLX", true).find((x) => x.id === "papel-35")).toBeUndefined();
  });

  it("ni al avisador que no está designado: no remite documentos contra el crédito", () => {
    expect(conPapel("BLITUYMM", true).find((x) => x.id === "papel-35")).toBeUndefined();
  });
});
