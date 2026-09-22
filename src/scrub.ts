/**
 * Guardarraíl de seguridad (doc 27 §2): antes de mandar CUALQUIER texto a Claude
 * se redactan los datos verdaderamente sensibles que el modelo NO necesita ver:
 *  - SECRETOS (api keys, tokens, JWT) → nunca deben viajar al LLM, sin excepción.
 *  - IDENTIFICADORES FINANCIEROS de terceros (IBAN, nº de cuenta, SWIFT, tarjeta).
 *  - CONTACTO de terceros (email, teléfono).
 *
 * Lo que NO se toca son los DATOS DE NEGOCIO que la operación necesita: montos,
 * cantidades, incoterms, puertos, países, fechas y razones sociales. El scrubbing
 * es determinista (regex), sin dependencias ni red. Devuelve el texto redactado y
 * la lista de hallazgos, por si el servidor necesita rehidratar (la IA nunca ve el
 * valor real). Este módulo es PURO; se cablea en /api/precarga y /api/chat.
 */

export type TipoSensible = "SECRETO" | "CUENTA" | "SWIFT" | "TARJETA" | "EMAIL" | "TEL";

export interface Hallazgo {
  tipo: TipoSensible;
  original: string;
}

interface Regla {
  tipo: TipoSensible;
  re: RegExp;
  /** si se define, se redacta solo ese grupo de captura (se preserva la etiqueta contextual) */
  grupo?: number;
}

const marca = (tipo: TipoSensible) => `⟦${tipo}⟧`;

/* Orden importante: secretos primero, luego financieros, contacto al final
   (los patrones más golosos van últimos para no comerse a los específicos). */
const REGLAS: Regla[] = [
  // — Secretos (inequívocos) —
  { tipo: "SECRETO", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g }, // JWT (incl. service_role)
  { tipo: "SECRETO", re: /\bsk-[A-Za-z0-9_-]{16,}\b/g }, // claves estilo sk-...
  { tipo: "SECRETO", re: /\bsb_secret_[A-Za-z0-9_-]{10,}\b/g }, // service_role Supabase (formato nuevo)
  { tipo: "SECRETO", re: /\bAKIA[0-9A-Z]{16}\b/g }, // AWS access key id
  // — Financieros —
  { tipo: "CUENTA", re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g }, // IBAN (con o sin espacios)
  { tipo: "TARJETA", re: /\b(?:\d{4}[ -]){3}\d{4}\b/g }, // tarjeta 4-4-4-4
  { tipo: "TARJETA", re: /\b\d{16}\b/g }, // tarjeta en un solo bloque
  { tipo: "SWIFT", re: /\b(?:swift|bic)\b[\s:.#-]*([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/gi, grupo: 1 },
  { tipo: "CUENTA", re: /\b(?:cuenta|cta\.?|c\/c|account|acct\.?|a\/c)\b[\s:#nº°.-]*(\d[\d .-]{4,}\d)/gi, grupo: 1 },
  // — Contacto de terceros —
  { tipo: "EMAIL", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  {
    tipo: "TEL",
    re: /(?:tel|tel[eé]fono|cel|celular|phone|whatsapp|wsp|m[oó]vil|fax)[.:\s]*(\+?\d[\d ().-]{5,}\d)/gi,
    grupo: 1,
  },
  { tipo: "TEL", re: /\+\d[\d ().-]{6,}\d/g }, // internacional con +, inequívoco
];

/**
 * Redacta el texto para mandarlo al LLM. Determinista e idempotente sobre datos
 * ya redactados (las marcas ⟦TIPO⟧ no vuelven a matchear).
 */
export function scrubForLLM(input: string): { texto: string; hallazgos: Hallazgo[] } {
  if (!input) return { texto: input ?? "", hallazgos: [] };
  const hallazgos: Hallazgo[] = [];
  let texto = input;

  for (const { tipo, re, grupo } of REGLAS) {
    texto = texto.replace(re, (match, ...args) => {
      // cuando hay grupo, args[grupo-1] es la parte sensible; preservar el resto del match
      if (grupo) {
        const capturado = args[grupo - 1] as string | undefined;
        if (!capturado) return match;
        hallazgos.push({ tipo, original: capturado });
        return match.replace(capturado, marca(tipo));
      }
      hallazgos.push({ tipo, original: match });
      return marca(tipo);
    });
  }

  return { texto, hallazgos };
}
