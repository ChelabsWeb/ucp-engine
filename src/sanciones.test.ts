import { describe, expect, it } from "vitest";
import { contextoDesdeSwift } from "./examen";
import { DOCUMENTOS_CSU2025099, SWIFT_CSU2025099 } from "./fixtures";
import type { DocAnalizado } from "./presentacion";
import {
  describirCoincidencia,
  type ListaSanciones,
  type ParteScreenear,
  partesAScreenear,
  screenear,
} from "./sanciones";
import { parseMT700 } from "./swift-lc";

const swift = parseMT700(SWIFT_CSU2025099)!;
const DOCS: DocAnalizado[] = [
  { tipo: "FACTURA", campos: DOCUMENTOS_CSU2025099.FACTURA!, nombreArchivo: "Commercial invoice A 4401" },
  { tipo: "BL", campos: DOCUMENTOS_CSU2025099.BL!, nombreArchivo: "BL MVD0990117" },
];
const PARTES = partesAScreenear({ lc: swift.lc, credito: contextoDesdeSwift(swift), docs: DOCS });

const lista = (entradas: ListaSanciones["entradas"]): ListaSanciones[] => [
  { fuente: "OFAC SDN", publicada: "2026-09-22", entradas },
];

describe("a quién hay que screenear", () => {
  it("saca las dos contrapartes, la cadena bancaria, el buque y los puertos", () => {
    const roles = PARTES.map((p) => p.rol);
    expect(roles).toEqual(
      expect.arrayContaining([
        "ORDENANTE",
        "BANCO_EMISOR",
        "BANCO_AVISADOR",
        "BANCO_LIBRADO",
        "PUERTO_CARGA",
        "PUERTO_DESCARGA",
        "BENEFICIARIO",
        "EMBARCADOR",
        "CONSIGNATARIO",
        "BUQUE",
      ]),
    );
  });

  it("cada parte dice de dónde salió, para poder rastrearla", () => {
    const emisor = PARTES.find((p) => p.rol === "BANCO_EMISOR");
    expect(emisor?.valor).toBe("MERIDIAN BANK PLC");
    expect(emisor?.origen).toContain("52A");
  });

  it("el buque sale del conocimiento de embarque", () => {
    expect(PARTES.find((p) => p.rol === "BUQUE")?.valor).toBe("STELLA AUSTRAL");
  });

  it("no repite una parte que aparece dos veces", () => {
    const claves = PARTES.map((p) => `${p.rol}:${p.valor}`);
    expect(new Set(claves).size).toBe(claves.length);
  });
});

describe("el cotejo contra las listas", () => {
  it("el expediente real no coincide con una lista que no lo contiene", () => {
    const l = lista([{ id: "X1", nombre: "ACME WEAPONS LLC", tipo: "ENTIDAD", programa: "NPWMD" }]);
    expect(screenear(PARTES, l)).toEqual([]);
  });

  it("encuentra al ordenante cuando está designado, y también al notify: son roles distintos", () => {
    const l = lista([{ id: "OFAC-1", nombre: "Orient Feed (Pvt) Limited", tipo: "ENTIDAD", programa: "SDGT" }]);
    const r = screenear(PARTES, l);
    // la misma empresa es el ordenante del crédito y el notify del conocimiento: hay que
    // reportar las dos, porque el examinador tiene que ver dónde aparece cada vez
    expect(r.map((x) => x.parte.rol).sort()).toEqual(["NOTIFY", "ORDENANTE"]);
    expect(r.every((x) => x.programa === "SDGT")).toBe(true);
  });

  it("la forma societaria abreviada no impide la coincidencia: «Pvt Ltd» es «Private Limited»", () => {
    const l = lista([{ id: "OFAC-1", nombre: "Orient Feed (Pvt) Limited", tipo: "ENTIDAD" }]);
    expect(screenear(PARTES, l)[0]!.grado).toBe("EXACTA");
  });

  it("encuentra un buque por su número IMO aunque el nombre no se parezca", () => {
    const partes = [{ rol: "BUQUE" as const, valor: "EX-NEPTUNE IMO 9433571", origen: "BL" }];
    const l = lista([{ id: "V1", nombre: "OTRO NOMBRE", tipo: "BUQUE", imo: "9433571", programa: "RUSSIA-EO14024" }]);
    const r = screenear(partes, l);
    expect(r[0]!.porQue).toBe("IMO");
    expect(r[0]!.grado).toBe("EXACTA");
  });

  it("encuentra por alias", () => {
    const l = lista([{ id: "A1", nombre: "OTRA COSA", alias: ["MERIDIAN BANK PLC"], tipo: "ENTIDAD" }]);
    const r = screenear(PARTES, l);
    expect(r[0]!.porQue).toBe("ALIAS");
    expect(r[0]!.parte.rol).toBe("BANCO_EMISOR");
  });

  it("una palabra genérica no alcanza para una coincidencia", () => {
    const l = lista([{ id: "G1", nombre: "BANK", tipo: "ENTIDAD" }]);
    expect(screenear(PARTES, l)).toEqual([]);
  });

  it("pone primero las coincidencias exactas", () => {
    const l = lista([
      { id: "P1", nombre: "MERIDIAN BANK PLC COLOMBO BRANCH", tipo: "ENTIDAD" },
      { id: "E1", nombre: "Molsur SA", tipo: "ENTIDAD" },
    ]);
    const r = screenear(PARTES, l);
    expect(r[0]!.grado).toBe("EXACTA");
  });

  it("la coincidencia se describe con toda su evidencia", () => {
    const l = lista([{ id: "OFAC-1", nombre: "Orient Feed (Pvt) Limited", tipo: "ENTIDAD", programa: "SDGT" }]);
    const texto = describirCoincidencia(screenear(PARTES, l)[0]!);
    expect(texto).toContain("ordenante");
    expect(texto).toContain("OFAC SDN");
    expect(texto).toContain("SDGT");
    expect(texto).toContain("campo 50");
  });

  it("sin listas cargadas no inventa nada", () => {
    expect(screenear(PARTES, [])).toEqual([]);
  });
});

describe("los sufijos societarios no identifican a nadie", () => {
  /**
   * El peor falso positivo que encontró el backtest con datos reales: contra las listas completas de
   * OFAC y del Reino Unido, once contrapartes del ERP del trader daban **veintidós** coincidencias, y
   * todas por la palabra «LLC». La causa: entradas como «LLC GROUP 99» o el alias «DM, LLC» quedaban
   * con una sola palabra significativa —«llc»— y esa palabra está en el nombre de miles de empresas.
   *
   * Un banco que vea a sus propios clientes marcados deja de mirar el screening, y entonces el día
   * que haya una coincidencia verdadera tampoco la va a mirar.
   */
  const lista = (nombre: string, alias?: string[]): ListaSanciones => ({
    fuente: "OFAC SDN",
    publicada: "09/23/2026",
    entradas: [{ id: "1", nombre, tipo: "ENTIDAD", programa: "TEST", alias }],
  });

  const parte = (valor: string): ParteScreenear => ({ rol: "ORDENANTE", valor, origen: "campo 50" });

  it.each([
    ["EVER GREEN FOOD STUFF TR. LLC", "LLC GROUP 99"],
    ["AGRIFOODS CO LLC", "LLC KB 78"],
    ["A-LINK SUPPLY CHAIN LTD", "LTD TRADING 44"],
    ["PASQUALE SRL", "SRL COMMERCIALE 12"],
  ])("«%s» no coincide con «%s»", (contraparte, entrada) => {
    expect(screenear([parte(contraparte)], [lista(entrada)])).toEqual([]);
  });

  it("tampoco por un alias que es solo el sufijo y dos letras", () => {
    // «DM, LLC» es un alias real de la SDN.
    expect(screenear([parte("AGRIFOODS CO LLC")], [lista("LIMITED LIABILITY COMPANY DM", ["DM, LLC"])])).toEqual([]);
  });

  it("**pero un nombre propio sí coincide, que es para lo que existe esto**", () => {
    // Si el arreglo silenciara todo, el screening dejaría de servir. Estos tienen que seguir saliendo.
    expect(
      screenear([parte("TAMILS REHABILITATION ORGANISATION")], [lista("TAMILS REHABILITATION ORGANISATION")]),
    ).toHaveLength(1);
    expect(screenear([parte("GAZPROM NEFT LLC")], [lista("GAZPROM")])).toHaveLength(1);
    expect(screenear([parte("ORIENT FEED (PVT) LTD")], [lista("ORIENT FEED LIMITED")])).toHaveLength(1);
  });

  it("y un nombre propio de una sola palabra larga también", () => {
    expect(screenear([parte("SBERBANK OF RUSSIA")], [lista("SBERBANK")])).toHaveLength(1);
  });
});
