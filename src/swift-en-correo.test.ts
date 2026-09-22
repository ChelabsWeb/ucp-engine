import { describe, expect, it } from "vitest";
import { SWIFT_CSU2025099 } from "./fixtures";
import { esMensajeSwift, parseMT700 } from "./swift-lc";

/**
 * Cómo llega un crédito en la vida real.
 *
 * El del expediente CSU2025099 llegó dentro de un correo reenviado dos veces: firma del
 * remitente, logo, cabeceras de reenvío, saludo en español y recién después el mensaje
 * SWIFT. Nadie recorta el mensaje antes de pegarlo. El parser tiene que encontrarlo igual.
 */

const CORREO_ALREDEDOR = `De: gabriel molivera@cerealsur.example
Asunto: Fw[2]: CEREALSUR S.A. - LCMRDN25000471 - Ntra. Ref.: 900114477
Fecha: 7 de setiembre de 2026 a las 11:09 a.m.
Para: Pablo Sosa psosa@cerealsur.example

Martín Olivera
CEREALSUR S.A.
Cerrito 820 - Of 006.
Montevideo - Uruguay
Tel: +598 20000011
Web: cerealsur.example

------ Forwarded Message ------
From "gabriel" <molivera@cerealsur.example>
To "Andrés Sosa" <asosa@cerealsur.example>
Date 8/21/2026 1:40:27 PM
Subject Fw: CEREALSUR S.A. - LCMRDN25000471

Te voy a pasar unas LC (cartas de crédito) que me dijo Nico. Esta de abajo es:

Carta de crédito Harina de pescado para SRI LANKA

------ Forwarded Message ------
From "Arrieta, Sofía" <sarrieta@bancolitoral.example>
To "Ernesto Baldi" <ebaldi@cerealsur.example>
Date 3/25/2025 4:24:13 PM
Subject CEREALSUR S.A. - LCMRDN25000471 - Ntra. Ref.: 900114477

Estimados buenas tardes,

Adjuntamos crédito recibido a vuestro favor. Nuestra referencia 900114477.

Favor revisar los términos y condiciones del mismo.

`;

const PIE_DEL_CORREO = `

Saludos cordiales,
Sofía Arrieta
Comercio Exterior — Banco Litoral (Uruguay) S.A.
Tel: +598 2000 0022 int. 1234
Este mensaje es confidencial. Si lo recibió por error, avise al remitente.
`;

describe("el crédito dentro del correo que lo trae", () => {
  const comoLlega = CORREO_ALREDEDOR + SWIFT_CSU2025099 + PIE_DEL_CORREO;

  it("lo reconoce como mensaje SWIFT pese a todo lo que lo rodea", () => {
    expect(esMensajeSwift(comoLlega)).toBe(true);
  });

  it("lee exactamente los mismos datos que con el mensaje limpio", () => {
    const solo = parseMT700(SWIFT_CSU2025099)!;
    const conCorreo = parseMT700(comoLlega)!;
    expect(conCorreo.lc).toEqual(solo.lc);
    expect(conCorreo.extra).toEqual(solo.extra);
  });

  it("no se traga el texto del correo como si fuera parte de un campo", () => {
    const p = parseMT700(comoLlega)!;
    const todo = JSON.stringify(p.lc);
    expect(todo).not.toContain("Saludos cordiales");
    expect(todo).not.toContain("confidencial");
    expect(todo).not.toContain("Forwarded");
    expect(todo).not.toContain("cerealsur.example");
  });

  it("un correo sin ningún mensaje SWIFT adentro no se confunde con uno", () => {
    expect(esMensajeSwift(CORREO_ALREDEDOR + PIE_DEL_CORREO)).toBe(false);
  });

  it("aguanta que el correo venga con las líneas indentadas, como al reenviar", () => {
    const citado = comoLlega
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n");
    const p = parseMT700(citado);
    expect(p?.lc.numero).toBe("LCMRDN25000471");
    expect(p?.lc.monto).toBe(54150);
  });
});
