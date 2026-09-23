import type { Observacion } from "./emision";

/**
 * El texto que iría en lugar del que está.
 *
 * `emision.ts` dice qué tiene de malo un crédito. Esto dice qué poner: para cada observación, una
 * redacción concreta para el 46A o el 47A, con el artículo que la sostiene.
 *
 * Tres reglas que gobiernan todo lo que sigue:
 *
 * 1. **Nunca se cambia la intención comercial.** Si el crédito pide un certificado de inspección, la
 *    propuesta sigue pidiendo un certificado de inspección; lo que cambia es quién lo emite o cómo se
 *    acredita. Un motor que «mejorara» lo que las partes acordaron estaría redactando otro contrato.
 * 2. **Lo que el motor no puede saber va como hueco.** Quién emite un certificado de origen depende
 *    del país y del acuerdo entre las partes: eso se escribe `[…]` y lo llena una persona. Inventar
 *    un emisor plausible sería peor que dejar el hueco, porque parecería una decisión tomada.
 * 3. **Es un borrador, no el texto correcto.** Igual que el examen no dice «conforme», esto no dice
 *    «así va»: dice «así quedaría operable, revisalo». Quien emite el crédito firma.
 *
 * Los textos propuestos **y sus explicaciones** van en inglés: esto se pega en una solicitud de
 * apertura o en un correo al banco emisor, y una explicación en español ahí no la lee nadie. Los
 * comentarios de este archivo siguen en español, como el resto del código.
 *
 * Y cada propuesta **cita el texto que reemplaza**. Sin eso, un crédito con cinco condiciones no
 * documentarias producía cinco propuestas idénticas y quien las leía no sabía a cuál correspondía
 * cada una.
 */

export interface Propuesta {
  /** la observación que la motiva */
  observacionId: string;
  /** el texto del crédito que esta propuesta reemplaza, para no confundir una propuesta con otra */
  original: string | null;
  /** en qué campo entra: «46A», «47A», «48»… */
  campo: string;
  /** qué hacer con el texto que está */
  accion: "REEMPLAZAR" | "QUITAR" | "MOVER_A_46A" | "AGREGAR";
  /** el texto propuesto, con huecos `[…]` donde hace falta una decisión humana */
  texto: string;
  /** por qué esta redacción y no otra */
  porQue: string;
  /** qué hay que decidir antes de usarla, si hay algo */
  decidir: string[];
}

/** Los huecos que una persona tiene que llenar, sacados del propio texto propuesto. */
function huecos(texto: string): string[] {
  return [...texto.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]!);
}

const p = (
  observacionId: string,
  campo: string,
  accion: Propuesta["accion"],
  texto: string,
  porQue: string,
  original: string | null = null,
): Propuesta => ({ observacionId, original, campo, accion, texto, porQue, decidir: huecos(texto) });

/**
 * La propuesta para una observación, o `null` si no hay una redacción que la arregle.
 *
 * Devolver null es una respuesta legítima y frecuente: que el vencimiento del crédito caiga antes
 * del último embarque no se corrige con mejor redacción, se corrige cambiando una fecha, y cuál de
 * las dos es una decisión comercial. Proponer texto ahí sería fingir que el problema es de forma.
 */
export function proponerRedaccion(o: Observacion, original: string | null = null): Propuesta | null {
  const id = o.id;

  /* ── campo 46A: los documentos ── */

  if (id.startsWith("emision-sin-documentos")) {
    return p(
      id,
      "46A",
      "AGREGAR",
      [
        "1) SIGNED COMMERCIAL INVOICE IN [number] ORIGINAL(S) AND [number] COPY(IES).",
        "2) FULL SET OF [number]/[number] ORIGINAL CLEAN ON BOARD BILLS OF LADING ISSUED TO THE",
        "   ORDER OF [issuing bank], MARKED [FREIGHT PREPAID or FREIGHT COLLECT], NOTIFY [party].",
        "3) PACKING LIST IN [number] ORIGINAL(S).",
      ].join("\n"),
      "Article 2 defines a presentation as the delivery of documents, and article 14(a) has the bank examine those documents: with none required there is nothing to present and nothing to examine. These three are the minimum for a shipment of goods; any other the parties agreed on is added, numbered the same way.",
      original,
    );
  }

  if (id.startsWith("emision-emisor-vago")) {
    return p(
      id,
      o.donde,
      "REEMPLAZAR",
      "… ISSUED BY [name the issuer: e.g. the chamber of commerce of the country of origin, a named inspection company, the competent government authority of …]",
      "Article 3 strips «first class», «well known», «independent» and the like of any effect: with those words the document may be issued by anyone other than the beneficiary — the opposite of what was meant. Naming the issuer is the only thing that restricts it.",
      original,
    );
  }

  if (id.startsWith("emision-doc-ordenante")) {
    return p(
      id,
      o.donde,
      "REEMPLAZAR",
      "… ISSUED AND SIGNED BY [an independent third party: name the inspection company, surveyor or authority], NOT BY THE APPLICANT.",
      "ISBP 821, preliminary consideration vii warns against it, and article 2 is the reason: a credit is a definite undertaking of the issuing bank. A document the applicant issues or signs leaves the beneficiary's payment at the buyer's will — if he does not sign it, there is no complying presentation. A third party attests the same thing, and the undertaking stays with the bank.",
      original,
    );
  }

  if (id.startsWith("emision-sin-sentido-46a") || id.startsWith("emision-sin-sentido-47a")) {
    return p(
      id,
      o.donde,
      "REEMPLAZAR",
      "ALL DOCUMENTS MUST BE ISSUED BY [the beneficiary / a named party], EXCEPT [the transport document and the insurance document, which may be issued by the carrier and the insurer].",
      "ISBP 821 A19 and E4: phrases like «third party documents not acceptable» or «freight forwarder's B/L not acceptable» say nothing about how a document must be issued, so banks disregard them and the credit ends up without the restriction that was intended. Naming who issues what does work.",
      original,
    );
  }

  /* ── campo 47A: las condiciones adicionales ── */

  if (id.startsWith("emision-no-documentaria")) {
    return p(
      id,
      "46A",
      "MOVER_A_46A",
      "… ) A CERTIFICATE ISSUED BY [the party that can attest it] STATING THAT [restate the condition as a fact that party can certify].",
      "Article 14(h) is explicit: a condition no document evidences is deemed not stated. It is not that the bank overlooks it — it does not exist. To have effect it must say which paper evidences it, and that paper belongs in field 46A.",
      original,
    );
  }

  if (id.startsWith("emision-administrativa")) {
    return p(
      id,
      o.donde,
      "QUITAR",
      "(remove from the credit; agree it separately with the correspondent bank)",
      "ISBP 821, preliminary consideration ix: an administrative instruction between banks — how to claim reimbursement, where to send the documents — is not something the beneficiary can comply with or fail, so failing it grounds no refusal. Inside the credit it only adds text someone will try to check.",
      original,
    );
  }

  if (id.startsWith("emision-cond-ordenante")) {
    return p(
      id,
      "46A",
      "MOVER_A_46A",
      "… ) A CERTIFICATE ISSUED BY [an independent third party] STATING THAT [restate what the applicant was to do or approve].",
      "Same ground as a document signed by the applicant — ISBP 821, preliminary consideration vii, and article 2. If payment depends on an act of the applicant, the credit stops being a commitment of the bank. Moving the same requirement to a third party's document keeps what was meant to be controlled without putting payment in the buyer's hands.",
      original,
    );
  }

  /* ── plazos y fechas ── */

  if (id.startsWith("emision-sin-plazo")) {
    return p(
      id,
      "48",
      "AGREGAR",
      "DOCUMENTS TO BE PRESENTED WITHIN [21] DAYS AFTER THE DATE OF SHIPMENT BUT WITHIN THE VALIDITY OF THE CREDIT.",
      "With field 48 empty the article 14(c) period applies: 21 calendar days after shipment. Writing it changes nothing in substance and spares the beneficiary having to know UCP 600 to know how long he has.",
      original,
    );
  }

  if (id.startsWith("emision-barra-")) {
    const campo = id.replace("emision-barra-", "");
    return p(
      id,
      campo,
      "REEMPLAZAR",
      "[pick one port] — or, if more than one is genuinely acceptable: ANY OF [port], [port] AT BENEFICIARY'S OPTION",
      "A slash between two places admits either one and also both at once (ISBP A2), which is almost never what was meant. If more than one really is acceptable, it is better said in words.",
      original,
    );
  }

  /*
   * El resto no se arregla con redacción.
   *
   * Un vencimiento anterior al último embarque, un crédito disponible en un banco que no existe, un
   * giro sobre el ordenante: son decisiones comerciales o errores de datos. Proponer texto ahí sería
   * fingir que el problema es de forma, y el que lee la propuesta se quedaría tranquilo sin haber
   * arreglado nada.
   */
  return null;
}

/**
 * Las propuestas de una revisión, sin las observaciones que no se arreglan redactando.
 *
 * Con los documentos y las condiciones del crédito a mano, cada propuesta cita el texto que
 * reemplaza. Sin ellos funciona igual, pero las propuestas quedan sin ese ancla y dos que salen de
 * la misma regla se ven idénticas.
 */
export function redaccionesPara(
  observaciones: Observacion[],
  credito?: { documentosExigidos?: string[] | null; condicionesAdicionales?: string[] | null },
): Propuesta[] {
  const docs = credito?.documentosExigidos ?? [];
  const cond = credito?.condicionesAdicionales ?? [];

  /** El texto que el `donde` de una observación señala: «46A+3» es el tercer documento. */
  const textoDe = (donde: string): string | null => {
    const m = /^(46A|47A)\+(\d+)$/.exec(donde);
    if (!m) return null;
    const lista = m[1] === "46A" ? docs : cond;
    return lista[Number(m[2]) - 1] ?? null;
  };

  const out: Propuesta[] = [];
  for (const o of observaciones) {
    const r = proponerRedaccion(o, textoDe(o.donde));
    if (r) out.push(r);
  }
  return out;
}

const ETIQUETA_ACCION: Record<Propuesta["accion"], string> = {
  REEMPLAZAR: "Replace with",
  QUITAR: "Remove",
  MOVER_A_46A: "Move to field 46A as",
  AGREGAR: "Add",
};

/** Una propuesta como texto plano, para pegar en un correo o en la solicitud de apertura. */
export function describirPropuesta(pr: Propuesta): string {
  const L: string[] = [];
  // El original va primero y recortado: es lo que permite saber de qué condición se habla cuando
  // cinco propuestas salen de la misma regla.
  if (pr.original) {
    const corto = pr.original.replace(/\s+/g, " ").trim();
    L.push(`Now reads: ${corto.length > 160 ? `${corto.slice(0, 157)}…` : corto}`, "");
  }
  L.push(`${pr.campo} — ${ETIQUETA_ACCION[pr.accion]}:`, "", pr.texto, "", `Why: ${pr.porQue}`);
  if (pr.decidir.length > 0) {
    L.push("", "Before using this, decide:");
    for (const d of pr.decidir) L.push(`  · ${d}`);
  }
  return L.join("\n");
}
