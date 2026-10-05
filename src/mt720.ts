import { parseFecha } from "./fechas";
import { diasPresentacion } from "./lc";
import { aJuegoSwift, envolver, importeSwift, yymmdd } from "./swift-salida";
import { sePuedeTransferir } from "./transferible";
import type { LcInfo } from "./types";

/**
 * El crédito transferido, como mensaje SWIFT (MT720).
 *
 * La pantalla de transferencia ya revisaba el artículo 38 —qué términos se pueden reducir y cuáles
 * no—, y lo que faltaba era el papel que sale del escritorio: el mensaje con el que el banco
 * transferente avisa el crédito al segundo beneficiario.
 *
 * ── La decisión que gobierna este archivo ───────────────────────────────────────────────────────
 * **El mensaje no se emite si la transferencia no se puede hacer.** No es una validación de
 * formulario: un MT720 lleva el nombre del banco transferente en un crédito que el artículo 38 no
 * permite transferir así, y lo que llega al segundo beneficiario es un compromiso que nadie tenía
 * por qué asumir. Igual que el MT734 no se arma sin discrepancias que avisar, este no se arma sobre
 * una transferencia inválida: devuelve vacío y dice qué habría que corregir.
 *
 * ── Qué cambia respecto de un MT700, y es fácil de confundir ────────────────────────────────────
 * En un MT700 el campo **50 es el ordenante**. En un 720 el 50 es el **primer beneficiario** —quien
 * pide la transferencia— y el 59 es el segundo beneficiario. Confundirlos pondría al importador como
 * quien transfiere.
 *
 * Y el campo 21 es el número del **crédito original**: es el crédito que se está transfiriendo, y es
 * con ese número que el segundo beneficiario y su banco van a poder rastrearlo.
 *
 * ── Lo que no se escribe ────────────────────────────────────────────────────────────────────────
 * Los campos cuyo contenido no se pudo verificar contra fuente pública no se inventan. El 720 admite
 * más campos que los que se arman acá —39B y 39C para importes adicionales, 44D para un período de
 * embarque, 71B para los gastos del transferente— y esos quedan afuera hasta poder comprobar su
 * formato: un mensaje con un campo mal armado rebota en la red, y uno con un campo plausible pero
 * equivocado es peor, porque llega.
 */

export interface DatosMT720 {
  /** campo 20: la referencia del banco transferente */
  referenciaPropia: string;
  /** el crédito tal como lo emitió su banco */
  original: LcInfo;
  /** el crédito como se transfiere: solo con lo que el 38 (g) deja reducir */
  transferido: LcInfo;
  /** campo 40B del original: lo único que hace transferible a un crédito (38 b) */
  formaDelCredito: string | null;
  /** campo 50 en un 720: quien pide la transferencia */
  primerBeneficiario: string[];
  /** campo 59: a quién se transfiere */
  segundoBeneficiario: string[];
  /**
   * Campo 41: con quién queda disponible el crédito transferido, y por qué vía.
   *
   * No se deriva del original: lo decide el banco transferente, habitualmente a favor de sí mismo,
   * y eso no está en ningún campo del crédito que se transfiere.
   */
  disponibleCon?: string | null;
  /** la fecha del mensaje */
  fecha: Date;
  /** campo 72Z */
  informacion?: string[];
}

export interface MensajeMT720 {
  /** el mensaje, o "" si la transferencia no se puede hacer */
  texto: string;
  /** lo que hubo que cambiar, recortar, o por qué no se emitió */
  avisos: string[];
}

const MAX_LINEA = 35;

export function mt720(d: DatosMT720): MensajeMT720 {
  const avisos: string[] = [];

  /*
   * Antes de armar nada: ¿se puede transferir?
   *
   * Solo es transferible el crédito que lo dice expresamente (38 b). Sin eso no hay mensaje que
   * emitir, y emitirlo igual sería avisarle a un segundo beneficiario un crédito que su emisor no
   * autorizó a transferir.
   */
  const puede = sePuedeTransferir(d.formaDelCredito);
  if (!puede.puede) {
    return { texto: "", avisos: [`No transfer message was built: ${puede.porQue} (UCP 600 38b).`] };
  }

  /*
   * Y lo segundo: ¿esta transferencia respeta el 38 (g)?
   *
   * El artículo deja **reducir o acortar** el importe, el vencimiento, el plazo de presentación y el
   * último embarque, y nada más. Aumentarlos no es transferir: es emitir otro crédito con el nombre
   * del original. Se revisa acá además de en la pantalla porque el mensaje es lo que sale del banco,
   * y lo que sale es lo que compromete.
   */
  const impedimentos: string[] = [];
  if (d.original.monto != null && d.transferido.monto != null && d.transferido.monto > d.original.monto) {
    impedimentos.push(
      `the transferred amount (${d.transferido.monto}) is higher than the original (${d.original.monto}): under article 38 (g) it may only be reduced, never increased`,
    );
  }
  const fechaMayor = (campo: "vencimiento" | "limiteEmbarque", nombre: string) => {
    const a = parseFecha(d.original[campo]);
    const b = parseFecha(d.transferido[campo]);
    if (a && b && b.getTime() > a.getTime()) {
      impedimentos.push(
        `the transferred ${nombre} (${d.transferido[campo]}) is later than the original (${d.original[campo]}): under article 38 (g) it may only be brought forward`,
      );
    }
  };
  fechaMayor("vencimiento", "expiry date");
  fechaMayor("limiteEmbarque", "latest shipment date");
  const p1 = diasPresentacion(d.original.plazoPresentacion);
  const p2 = diasPresentacion(d.transferido.plazoPresentacion);
  if (p1 != null && p2 != null && p2 > p1) {
    impedimentos.push(
      `the transferred presentation period (${p2} days) is longer than the original (${p1}): under article 38 (g) it may only be shortened`,
    );
  }
  if (impedimentos.length > 0) {
    return {
      texto: "",
      avisos: [
        `No transfer message was built, because this is not a transfer under UCP 600 38 (g): ${impedimentos.join("; ")}.`,
      ],
    };
  }

  let hubeQueCambiar = false;
  const limpiar = (s: string) => {
    const r = aJuegoSwift(s);
    hubeQueCambiar = hubeQueCambiar || r.hubeQueCambiar;
    return r.texto;
  };

  const L: string[] = [];
  const campo = (tag: string, lineas: string[]) => {
    const utiles = lineas.filter((x) => x.trim().length > 0);
    if (utiles.length === 0) return;
    L.push(`:${tag}:${utiles[0]}`);
    for (const extra of utiles.slice(1)) L.push(extra);
  };
  const deTexto = (tag: string, valor: string | null | undefined, maxLineas = 6) => {
    if (!valor?.trim()) return;
    campo(tag, envolver(limpiar(valor), MAX_LINEA).slice(0, maxLineas));
  };
  const deLista = (tag: string, items: string[] | null | undefined, maxLineas = 50) => {
    if (!items?.length) return;
    // cada ítem conserva su numeración, que es la que citan los hallazgos («46A+2»)
    const lineas = items.flatMap((x, i) => envolver(limpiar(`+${i + 1}) ${x}`), MAX_LINEA));
    campo(tag, lineas.slice(0, maxLineas));
  };
  const fechaSwift = (v: string) => {
    const f = parseFecha(v);
    return f ? yymmdd(f) : "";
  };

  const ref = limpiar(d.referenciaPropia).slice(0, 16);
  if (d.referenciaPropia.length > 16) {
    avisos.push(`The transferring bank reference was trimmed to 16 characters: "${ref}".`);
  }

  campo("27", ["1/1"]);
  campo("40B", envolver(limpiar(d.formaDelCredito ?? ""), MAX_LINEA).slice(0, 2));
  campo("20", [ref]);
  // el 21 es el crédito que se transfiere: con ese número lo rastrean el segundo beneficiario y su banco
  campo("21", [limpiar(d.original.numero).slice(0, 16)]);
  campo("31C", [yymmdd(d.fecha)]);
  campo("31D", [fechaSwift(d.transferido.vencimiento)]);
  deTexto("52D", d.original.bancoEmisor, 4);
  // en un 720 el 50 es el primer beneficiario, no el ordenante
  campo("50", d.primerBeneficiario.flatMap((x) => envolver(limpiar(x), MAX_LINEA)).slice(0, 4));
  campo("59", d.segundoBeneficiario.flatMap((x) => envolver(limpiar(x), MAX_LINEA)).slice(0, 4));
  if (d.transferido.monto != null && d.transferido.moneda) {
    campo("32B", [`${d.transferido.moneda.toUpperCase().slice(0, 3)}${importeSwift(d.transferido.monto)}`]);
  }
  /*
   * El 41 y el 42 no son lo mismo, y confundirlos cambia el mensaje.
   *
   * El **41D** es «disponible con… por…» y el **42D** es el librado. Acá estaba el librado metido en
   * el 41D: con el crédito real, el mensaje decía «disponible con MERIDIAN BANK PLC» cuando el
   * original dice «ANY BANK IN URUGUAY BY NEGOTIATION». Lo encontré mirando el mensaje armado, no
   * leyendo el código.
   *
   * Y el 41 del transferido **no se deriva**: con quién queda disponible el crédito transferido lo
   * decide el banco transferente —habitualmente él mismo— y eso no está en ningún campo del
   * original. Entra como dato; si no viene, el campo no se escribe y se avisa, porque un 720 sin 41
   * deja al segundo beneficiario sin saber dónde presentar.
   */
  if (d.disponibleCon?.trim()) {
    deTexto("41D", d.disponibleCon, 4);
  } else {
    avisos.push(
      "Field 41 (available with... by...) was left out because it was not given: the transferring bank decides with whom the transferred credit is available, and without it the second beneficiary does not know where to present.",
    );
  }
  deTexto("42C", d.transferido.giros, 2);
  deTexto("42D", d.transferido.librado, 4);
  campo("44C", [fechaSwift(d.transferido.limiteEmbarque)]);
  deLista("46A", d.transferido.documentosExigidos);
  deLista("47A", d.transferido.condicionesAdicionales);
  const dias = diasPresentacion(d.transferido.plazoPresentacion);
  if (dias != null) campo("48", [String(dias)]);
  if (d.informacion?.length) campo("72Z", envolver(limpiar(d.informacion.join("\n")), MAX_LINEA).slice(0, 6));

  if (hubeQueCambiar) {
    avisos.push(
      "Some characters are not in the SWIFT X character set and were replaced with the closest equivalent: check the names and places before sending.",
    );
  }

  return { texto: L.join("\n"), avisos };
}
