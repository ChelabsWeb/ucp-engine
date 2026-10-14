import type { CamposDoc } from "./consistencia";

/**
 * La segunda pasada sobre los mismos papeles: el control de lavado.
 *
 * Los Trade Finance Principles de Wolfsberg, la ICC y BAFT lo dicen con todas las letras:
 *
 * > The checking of information in documents to meet the requirements of the DC under UCP and
 * > International Standard Banking Practice **is not the same as** checking documents for AML or
 * > sanctions purposes.
 *
 * Un banco hace las dos pasadas sobre el mismo juego, y son preguntas distintas: **las UCP
 * preguntan «¿se contradicen?» y el control AML pregunta «¿difieren mucho?»**. Wolfsberg lista como
 * señal de alerta «discrepancias en los documentos, **no necesariamente motivo de rechazo bajo UCP
 * 600**» y «discrepancias dispensadas». Es decir: una discrepancia que el motor ablanda por ISBP
 * sigue siendo señal de lavado.
 *
 * ## Tres reglas que gobiernan este módulo
 *
 * **Esto no produce discrepancias y no toca el veredicto.** Sale aparte. Mezclarlo con el examen
 * borraría la línea sobre la que se apoya todo el producto: que el veredicto se puede defender
 * artículo en mano. Una señal de lavado no se defiende con un artículo de las UCP porque no es
 * una cuestión de las UCP.
 *
 * **Nada de acá es un veredicto, y por eso no hay niveles.** Toda señal dice lo mismo: alguien
 * tiene que mirar esto. Poner una «alta» y una «baja» invita a tratar la alta como una conclusión,
 * y el estándar es explícito en que el banco no puede concluir sobre lavado leyendo papeles.
 *
 * **Solo entra lo que se puede afirmar sin ningún dato externo.** Lo que necesita un precio de
 * mercado, una lista de doble uso o el rastro de un buque queda afuera a propósito: Wolfsberg dice
 * que determinar si un precio está fuera de mercado *«is not feasible»* para un banco, y que
 * interpretar doble uso *«requires a degree of technical knowledge that staff cannot be expected to
 * possess»*. Un disparador contra una referencia pública se puede construir después, pero como
 * disparador documentado, nunca como veredicto.
 */
export interface SenalAML {
  id: string;
  /** de dónde sale la señal: la tipología, la guía o el estándar que la reconoce */
  fuente: string;
  /** qué se vio */
  senal: string;
  /** con qué se vio: los valores del papel, para que una persona lo compruebe */
  evidencia: string;
}

const val = (c: { valor: string; confianza: number } | undefined): string | null =>
  c && c.valor.trim() && c.confianza >= 0.4 ? c.valor.trim() : null;

const num = (s: string | null): number | null => {
  if (!s) return null;
  const limpio = s
    .replace(/[^\d.,-]/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const n = Number.parseFloat(limpio);
  return Number.isFinite(n) ? n : null;
};

/* ───────────────────────── el dígito verificador de un contenedor ───────────────────────── */

/**
 * Las letras valen según la norma ISO 6346, saltando los múltiplos de once.
 *
 * No es una curiosidad: el salto es lo que hace que el dígito detecte una letra cambiada por otra.
 * Con A=10, B=11, C=12 dos letras distintas podrían dar la misma suma.
 */
const LETRA: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  let v = 10;
  for (const l of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (v % 11 === 0) v += 1;
    m[l] = v;
    v += 1;
  }
  return m;
})();

/**
 * ¿El número de contenedor cierra con su propio dígito verificador?
 *
 * Es aritmética y no opinión: cada uno de los diez primeros caracteres se multiplica por dos
 * elevado a su posición, se suman, y el resto de dividir por once —tomado módulo diez— tiene que
 * dar el último dígito. Un número que no cierra es un error de transcripción o un contenedor que
 * no existe, y cuál de las dos cosas es lo decide una persona.
 *
 * Devuelve `null` cuando el texto no tiene la forma de un número de contenedor: no saber no es lo
 * mismo que estar mal.
 */
export function contenedorCierra(numero: string): boolean | null {
  const s = numero.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]{3}[UJZ]\d{7}$/.test(s)) return null;
  let suma = 0;
  for (let i = 0; i < 10; i++) {
    const c = s[i] as string;
    const v = /\d/.test(c) ? Number(c) : (LETRA[c] ?? 0);
    suma += v * 2 ** i;
  }
  return (suma % 11) % 10 === Number(s[10]);
}

/* ───────────────────────────────── las señales ───────────────────────────────── */

export interface InsumoAML {
  /** los documentos presentados, por tipo */
  docs: Partial<Record<string, CamposDoc>>;
  /** lo que el crédito dice, para comparar contra lo que el banco mismo emitió */
  credito?: {
    beneficiario?: string | null;
    aplicante?: string | null;
    moneda?: string | null;
  };
  /** cuántas enmiendas lleva el crédito */
  enmiendas?: number;
}

/**
 * Cuántas enmiendas empiezan a ser muchas.
 *
 * FinCEN lista «cartas de crédito enmendadas sin justificación razonable» entre sus indicadores, y
 * no da un número porque no lo hay. Tres es donde lo pone la práctica que se puede citar, y la
 * señal dice cuántas son para que quien mire decida: lo que se afirma es el hecho, no el juicio.
 */
const MUCHAS_ENMIENDAS = 3;

/** Cuánto puede desviarse el precio implícito del que el propio crédito declara, antes de mirar. */
const DESVIO_PRECIO = 0.05;

export function senalesAML(input: InsumoAML): SenalAML[] {
  const out: SenalAML[] = [];
  const agregar = (s: SenalAML) => out.push(s);

  /* ── 1. El número de contenedor no cierra ───────────────────────────────────────────────── */
  for (const [tipo, campos] of Object.entries(input.docs)) {
    if (!campos) continue;
    for (const clave of ["numeroDoc", "bultos", "mercaderia"] as const) {
      const texto = val(campos[clave]);
      if (!texto) continue;
      for (const m of texto.matchAll(/\b[A-Z]{3}[UJZ]\s*-?\s*\d{3}\s*-?\s*\d{3}\s*-?\s*\d\b/gi)) {
        const crudo = m[0];
        if (contenedorCierra(crudo) === false) {
          agregar({
            id: `aml-contenedor-${crudo.replace(/[^A-Za-z0-9]/g, "")}`,
            fuente: "ISO 6346",
            senal: "Un número de contenedor no cierra con su dígito verificador: está mal transcripto o no existe",
            evidencia: `${tipo}: «${crudo.trim()}»`,
          });
        }
      }
    }
  }

  /* ── 2. El peso bruto no puede ser menor que la carga ───────────────────────────────────── */
  for (const [tipo, campos] of Object.entries(input.docs)) {
    if (!campos) continue;
    const bruto = num(val(campos.pesoBruto));
    const cantidad = num(val(campos.cantidad));
    const uBruto = (val(campos.pesoBruto) ?? "").toUpperCase();
    const uCantidad = (val(campos.unidad) ?? "").toUpperCase();
    /* Solo cuando las dos están en la misma magnitud: comparar kilos contra bultos no dice nada. */
    const mismaUnidad =
      (uBruto.includes("KG") && uCantidad.includes("KG")) || (uBruto.includes("MT") && uCantidad.includes("MT"));
    if (bruto !== null && cantidad !== null && mismaUnidad && bruto < cantidad) {
      agregar({
        id: `aml-bruto-menor-${tipo}`,
        fuente: "Aritmética del propio documento",
        senal: "El peso bruto declarado es menor que la carga, y el bruto incluye el envase",
        evidencia: `${tipo}: bruto ${bruto} contra ${cantidad} de mercadería`,
      });
    }
  }

  /* ── 3. La factura no cierra consigo misma ─────────────────────────────────────────────── */
  /*
   * Precio unitario por cantidad tiene que dar el total. Es aritmética del propio papel: no se
   * afirma nada sobre el precio de mercado —Wolfsberg dice que eso un banco *«is not feasible»* que
   * lo determine— sino que los tres números que la factura declara no son consistentes entre sí.
   *
   * Es el indicador de sobre y sub-facturación en su forma defendible: lo que se ve es que la
   * cuenta no cierra, y por qué no cierra lo decide una persona.
   */
  const factura = input.docs.FACTURA;
  if (factura) {
    const total = num(val(factura.montoTotal));
    const cantidad = num(val(factura.cantidad));
    const unitario = num(val(factura.precioUnitario));
    if (total !== null && cantidad !== null && unitario !== null && cantidad > 0 && total > 0) {
      const esperado = unitario * cantidad;
      const desvio = Math.abs(esperado - total) / total;
      if (desvio > DESVIO_PRECIO) {
        agregar({
          id: "aml-factura-no-cierra",
          fuente: "Wolfsberg TFP · sobre y sub-facturación",
          senal: "Los tres números de la factura no cierran entre sí",
          evidencia: `FACTURA: ${unitario} por ${cantidad} da ${esperado.toFixed(2)}, y la factura declara ${total}`,
        });
      }
    }
  }

  /* ── 4. Un tercero que el crédito no nombra ─────────────────────────────────────────────── */
  const bl = input.docs.BL;
  const beneficiario = (input.credito?.beneficiario ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const shipper = (val(bl?.exportador ?? undefined) ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (bl && beneficiario && shipper && !shipper.includes(beneficiario) && !beneficiario.includes(shipper)) {
    agregar({
      id: "aml-tercero-embarcador",
      fuente: "FinCEN FIN-2010-A001 · terceros no explicados",
      senal: "Quien embarca no es el beneficiario del crédito",
      evidencia:
        `El conocimiento embarca a nombre de «${val(bl.exportador)}» y el crédito nombra beneficiario a ` +
        `«${input.credito?.beneficiario}»`,
    });
  }

  /* ── 5. Un crédito enmendado muchas veces ───────────────────────────────────────────────── */
  if ((input.enmiendas ?? 0) >= MUCHAS_ENMIENDAS) {
    agregar({
      id: "aml-enmiendas",
      fuente: "FinCEN FIN-2010-A001 · enmiendas sin justificación",
      senal: "El crédito lleva varias enmiendas",
      evidencia: `${input.enmiendas} enmiendas`,
    });
  }

  return out;
}
