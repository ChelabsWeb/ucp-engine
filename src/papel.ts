import type { EstadoRegla, ReglaPresentacion } from "./presentacion";

/**
 * Qué papel juega el banco que examina, y qué le exigen las UCP por eso.
 *
 * ── Por qué hace falta ──────────────────────────────────────────────────────────────────────────
 * El motor examinaba igual para todos, y las UCP no. Sobre el **mismo** juego de papeles conforme:
 *
 * - el **emisor** tiene que honrar (arts. 7 a y 15 a) y está irrevocablemente obligado desde que
 *   emitió el crédito (7 b);
 * - un **designado** que no agregó su confirmación **no está obligado a nada**: «salvo que el banco
 *   designado sea el banco confirmador, una autorización para honrar o negociar no le impone
 *   ninguna obligación de honrar o negociar» (art. 12 a). Puede honrar, y si lo hace el emisor
 *   tiene que reembolsarle (7 c);
 * - un **confirmador** tiene que honrar o negociar (art. 8 a) y remitir los documentos (15 b);
 * - un **avisador** que no está designado **no examina para honrar**: avisa sin compromiso, y lo
 *   que afirmó al avisar es la autenticidad aparente del crédito y que el aviso refleja fielmente
 *   sus términos (art. 9 a y 9 b).
 *
 * Son conclusiones distintas, no matices. Un banco avisador que lea «conforme: hay que pagar» está
 * leyendo algo que no le corresponde.
 *
 * ── Por qué se deriva y no se pregunta ──────────────────────────────────────────────────────────
 * Porque el crédito lo dice: el 52A nombra al emisor, el 41A/41D con quién está disponible, el 57A
 * a través de quién se avisa, y el encabezado a quién se mandó el mensaje. Preguntárselo al
 * examinador en cada crédito sería un campo más para equivocarse, redundante con los papeles.
 *
 * Lo único que el banco declara una vez es **su propio BIC**. Sin él no se deriva nada: `null`, y
 * el examen no dice nada del papel en vez de suponer uno.
 *
 * ── Los dos límites, dichos ─────────────────────────────────────────────────────────────────────
 * **La designación abierta no se resuelve.** «ANY BANK IN URUGUAY BY NEGOTIATION» designa por país
 * y no por BIC; resolverlo pediría una tabla de nombres de país que se queda vieja, y equivocarse
 * cambia si el banco está obligado o no. Se dice y lo mira una persona.
 *
 * **Si el banco agregó su confirmación, el motor no lo sabe.** El campo 49 dice si el crédito la
 * **pide**; agregarla es una decisión del banco avisador que no está en ningún papel del
 * expediente. Cuando el crédito la pide, se dice que la obligación depende de eso.
 */

export type Papel = "EMISOR" | "CONFIRMADOR" | "DESIGNADO" | "AVISADOR" | "NO_NOMBRADO";

export interface PapelDelBanco {
  papel: Papel;
  /** el campo del crédito que lo dice, para poder ir a buscarlo */
  porQue: string;
  /** el texto del 41D cuando designa sin nombrar un BIC, y por lo tanto queda sin resolver */
  designacionAbierta: string | null;
  /** el crédito pide que se agregue la confirmación (campo 49) */
  confirmacionPedida: boolean;
}

/** Los ocho primeros caracteres: el BIC de once agrega el código de sucursal del mismo banco. */
const base = (bic: string | null | undefined): string | null => {
  const t = (bic ?? "").trim().toUpperCase();
  return t.length >= 8 ? t.slice(0, 8) : null;
};

const mismo = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const x = base(a);
  const y = base(b);
  return x !== null && x === y;
};

/** Si el 41D designa sin nombrar un BIC: «ANY BANK IN URUGUAY», «ANY BANK». */
const designaSinNombrar = (texto: string | null | undefined): boolean =>
  /\bany\s+bank\b|\bcualquier\s+banco\b/i.test(texto ?? "");

export function papelDelBanco(input: {
  /** el BIC del banco que examina, declarado una vez en sus ajustes */
  bicPropio?: string | null;
  bicEmisor?: string | null;
  bicAvisador?: string | null;
  bicDisponibleCon?: string | null;
  bicReceptor?: string | null;
  disponibleCon?: string | null;
  confirmacion?: string | null;
}): PapelDelBanco | null {
  const propio = base(input.bicPropio);
  if (!propio) return null;

  const confirmacionPedida = /\bconfirm/i.test(input.confirmacion ?? "");
  const designacionAbierta =
    designaSinNombrar(input.disponibleCon) && !mismo(propio, input.bicDisponibleCon)
      ? (input.disponibleCon ?? "").trim()
      : null;

  const armar = (papel: Papel, porQue: string): PapelDelBanco => ({
    papel,
    porQue,
    designacionAbierta,
    confirmacionPedida,
  });

  /*
   * El orden importa, y va del compromiso más fuerte al más débil.
   *
   * Un banco puede ser varias cosas a la vez —el avisador del crédito real también entra en «any
   * bank in Uruguay»— y lo que hay que decir es el papel que más le exige. Si fuera al revés, el
   * examen le diría «vos solo avisás» a un banco que además está designado.
   */
  if (mismo(propio, input.bicEmisor)) return armar("EMISOR", "52A: el crédito lo emite este banco");
  if (mismo(propio, input.bicDisponibleCon)) {
    return armar("DESIGNADO", "41A: el crédito está disponible con este banco");
  }
  if (mismo(propio, input.bicAvisador) || mismo(propio, input.bicReceptor)) {
    return armar("AVISADOR", "57A: el crédito se avisa a través de este banco");
  }
  return armar("NO_NOMBRADO", "el crédito no nombra a este banco en ninguno de sus campos de banco");
}

const regla = (id: string, fuente: string, que: string, estado: EstadoRegla, evidencia: string): ReglaPresentacion => ({
  id,
  fuente,
  regla: que,
  estado,
  evidencia,
});

/**
 * Lo que las UCP le exigen a este banco por el papel que juega.
 *
 * `conforme` es si la presentación no tiene discrepancias ni documentos faltantes. Con una
 * presentación que no cumple, la obligación de honrar **no se afirma** — lo que se dice es quién es
 * y qué artículo lo rige, porque el artículo 16 es el que sigue.
 */
export function reglasDelPapel(p: PapelDelBanco, input: { conforme: boolean }): ReglaPresentacion[] {
  const out: ReglaPresentacion[] = [];
  const noCumple =
    "la presentación tiene discrepancias o documentos faltantes, así que no hay obligación de honrar: lo que sigue es el aviso del artículo 16";

  if (p.papel === "EMISOR") {
    out.push(
      regla(
        "papel-obligacion",
        "UCP 600 7a y 15a",
        input.conforme
          ? "Este banco emitió el crédito, así que tiene que honrar una presentación conforme"
          : "Este banco emitió el crédito",
        input.conforme ? "OK" : "ATENCION",
        input.conforme
          ? `${p.porQue} — y quedó irrevocablemente obligado desde que lo emitió (7 b)`
          : `${p.porQue} — ${noCumple}`,
      ),
    );
  } else if (p.papel === "CONFIRMADOR") {
    out.push(
      regla(
        "papel-obligacion",
        "UCP 600 8a y 15b",
        input.conforme
          ? "Este banco confirmó el crédito, así que tiene que honrar o negociar y remitir los documentos"
          : "Este banco confirmó el crédito",
        input.conforme ? "OK" : "ATENCION",
        input.conforme ? p.porQue : `${p.porQue} — ${noCumple}`,
      ),
    );
  } else if (p.papel === "DESIGNADO") {
    out.push(
      regla(
        "papel-obligacion",
        "UCP 600 12a",
        "Este banco está designado y no confirmó: puede honrar, pero no está obligado",
        "ATENCION",
        `${p.porQue} — una autorización para honrar o negociar no le impone obligación de hacerlo; si honra, el emisor tiene que reembolsarle (7 c)` +
          (input.conforme ? "" : `. Además, ${noCumple}`),
      ),
    );
  } else if (p.papel === "AVISADOR") {
    out.push(
      regla(
        "papel-obligacion",
        "UCP 600 9a y 9b",
        "Este banco avisa el crédito y no asume compromiso de honrar",
        "ATENCION",
        `${p.porQue} — al avisarlo afirmó que el crédito le parece auténtico y que el aviso refleja fielmente sus términos; examinar para honrar le corresponde al emisor o a un banco designado`,
      ),
    );
  } else {
    out.push(
      regla(
        "papel-obligacion",
        "UCP 600 2 y 12a",
        "El crédito no nombra a este banco",
        "ATENCION",
        `${p.porQue} — se puede examinar igual, pero ningún artículo le impone un compromiso por este crédito`,
      ),
    );
  }

  /*
   * La designación abierta: el banco puede estar designado y el motor no lo puede resolver.
   *
   * Cambia la conclusión de arriba —de «solo aviso» a «puedo honrar y me reembolsan»— así que no
   * alcanza con no decir nada.
   */
  if (p.designacionAbierta && p.papel !== "EMISOR" && p.papel !== "DESIGNADO") {
    out.push(
      regla(
        "papel-designacion-abierta",
        "UCP 600 6a",
        "El crédito designa sin nombrar un banco: verificar si este banco está incluido",
        "ATENCION",
        `el crédito dice "${p.designacionAbierta}" y eso no se puede resolver desde el papel; si está incluido, este banco también está designado y entonces lo rige el artículo 12 (a)`,
      ),
    );
  }

  if (p.confirmacionPedida && (p.papel === "AVISADOR" || p.papel === "DESIGNADO")) {
    out.push(
      regla(
        "papel-confirmacion-pedida",
        "49 y UCP 600 8a",
        "El crédito pide agregar la confirmación: si este banco la agregó, tiene que honrar",
        "ATENCION",
        "el campo 49 pide confirmación, y agregarla es una decisión de este banco que no consta en el expediente: con la confirmación agregada rige el artículo 8 (a) y no el 12 (a)",
      ),
    );
  }

  return out;
}
