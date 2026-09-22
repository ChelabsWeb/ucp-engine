import { describe, expect, it } from "vitest";
import {
  type CamposDoc,
  contextoDesdeSwift,
  DOCUMENTOS_CSU2025099,
  parseMT700,
  SWIFT_CSU2025099,
  type TipoDocExterno,
} from "./index";
import { describirAlerta, JURISDICCIONES, screenearJurisdicciones } from "./jurisdicciones";
import { type ListaSanciones, type ParteScreenear, partesAScreenear, screenear } from "./sanciones";

const puerto = (valor: string, rol: "PUERTO_CARGA" | "PUERTO_DESCARGA" = "PUERTO_DESCARGA"): ParteScreenear => ({
  rol,
  valor,
  origen: "campo 44F del crédito",
});

describe("un puerto no se coteja contra nombres de personas y entidades", () => {
  /**
   * El falso positivo real del expediente CSU2025099. La entidad existe y está sancionada, pero
   * el alias que hizo el match es «TSUNAMI RELIEF FUND -- COLOMBO, SRI LANKA»: el puerto de
   * descarga del caso. Si esto vuelve, el screening pierde credibilidad justo donde importa.
   */
  const TRO: ListaSanciones = {
    fuente: "OFAC SDN",
    publicada: "09/18/2026",
    entradas: [
      {
        id: "10486",
        nombre: "TAMILS REHABILITATION ORGANISATION",
        tipo: "ENTIDAD",
        programa: "SDGT",
        alias: ["TRO", "TSUNAMI RELIEF FUND -- COLOMBO, SRI LANKA"],
      },
    ],
  };

  it("«COLOMBO,SRI LANKA» no coincide con una entidad cuyo alias nombra ese lugar", () => {
    expect(screenear([puerto("COLOMBO,SRI LANKA")], [TRO])).toEqual([]);
  });

  it("pero el mismo texto como nombre de una parte SÍ se coteja: el freno es por rol, no por texto", () => {
    const comoEmpresa: ParteScreenear = {
      rol: "CONSIGNATARIO",
      valor: "TSUNAMI RELIEF FUND -- COLOMBO, SRI LANKA",
      origen: "BL",
    };
    expect(screenear([comoEmpresa], [TRO])).toHaveLength(1);
  });

  it("el expediente real no produce ninguna coincidencia contra esta entrada", () => {
    const credito = parseMT700(SWIFT_CSU2025099)!;
    const partes = partesAScreenear({
      lc: credito.lc,
      credito: contextoDesdeSwift(credito),
      docs: (Object.entries(DOCUMENTOS_CSU2025099) as [TipoDocExterno, CamposDoc][]).map(([tipo, campos]) => ({
        tipo,
        campos,
      })),
    });
    expect(partes.some((p) => p.rol === "PUERTO_DESCARGA")).toBe(true);
    expect(screenear(partes, [TRO])).toEqual([]);
  });
});

describe("el control que sí le corresponde a un puerto: en qué jurisdicción está", () => {
  it("no alerta sobre un puerto que no está bajo programa", () => {
    expect(screenearJurisdicciones([puerto("COLOMBO,SRI LANKA")])).toEqual([]);
    expect(screenearJurisdicciones([puerto("MONTEVIDEO PORT IN URUGUAY", "PUERTO_CARGA")])).toEqual([]);
  });

  it("alerta sobre un puerto bajo programa integral, y dice qué palabra lo disparó", () => {
    const a = screenearJurisdicciones([puerto("BANDAR ABBAS, IRAN")]);
    expect(a).toHaveLength(1);
    expect(a[0]!.jurisdiccion).toBe("Irán");
    expect(a[0]!.alcance).toBe("INTEGRAL");
    expect(a[0]!.termino).toBeTruthy();
    expect(describirAlerta(a[0]!)).toContain("programa integral");
  });

  it("distingue lo integral de lo restringido: no son la misma conversación", () => {
    expect(screenearJurisdicciones([puerto("NOVOROSSIYSK, RUSSIA")])[0]!.alcance).toBe("RESTRINGIDA");
    expect(screenearJurisdicciones([puerto("NAMPO, NORTH KOREA")])[0]!.alcance).toBe("INTEGRAL");
  });

  it("compara por palabra entera: «CUBATÃO» es un puerto de Brasil y no es Cuba", () => {
    expect(screenearJurisdicciones([puerto("CUBATAO, BRAZIL")])).toEqual([]);
    expect(screenearJurisdicciones([puerto("SANTOS, BRAZIL")])).toEqual([]);
    // Y un apellido que contiene «IRAN» tampoco: por eso el cotejo no es por contención.
    expect(screenearJurisdicciones([puerto("PUERTO ETXEBARRIA, SPAIN")])).toEqual([]);
  });

  it("solo mira los roles que nombran un lugar", () => {
    const beneficiario: ParteScreenear = { rol: "BENEFICIARIO", valor: "IRAN TRADING LTD", origen: "FACTURA" };
    // Un nombre de empresa que dice «IRAN» es asunto de las listas de nombres, no de esta lista:
    // acá saldría como alerta de jurisdicción y eso sería una confusión de controles.
    expect(screenearJurisdicciones([beneficiario])).toEqual([]);
  });

  it("cada jurisdicción declara su programa, para poder ir a leerlo", () => {
    expect(JURISDICCIONES.every((j) => j.programa.length > 0 && j.terminos.length > 0)).toBe(true);
    // Los términos van en mayúsculas, que es como llegan de un documento de embarque.
    expect(JURISDICCIONES.every((j) => j.terminos.every((t) => t === t.toUpperCase()))).toBe(true);
  });
});
