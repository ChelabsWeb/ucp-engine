/**
 * Por qué no se pudo leer un documento, dicho para quien está examinando.
 *
 * Cuando la lectura falla, la aplicación decía siempre lo mismo: «el documento no se pudo leer,
 * cargá los campos a mano». Es verdad en un solo caso. Si la cuenta del servicio se quedó sin
 * crédito o la clave está mal, el papel está perfecto y el arreglo no está en el escritorio del
 * examinador sino en la administración del banco; si el servicio se cayó o hubo demasiadas
 * lecturas juntas, lo que corresponde es volver a intentar en un minuto, no transcribir treinta
 * campos a mano.
 *
 * Las tres cosas se arreglan en lugares distintos, así que se nombran distinto. Y nada de lo que
 * diga el proveedor se repite hacia afuera: sus mensajes nombran su consola y su plan de
 * facturación, que a un examinador no le dicen nada.
 */

export interface FallaDeLectura {
  /** Lo que se muestra. */
  texto: string;
  /** El problema está en cómo quedó instalado el servicio, no en el documento. */
  deConfiguracion: boolean;
  /** Vale la pena volver a intentar con el mismo papel. */
  reintentable: boolean;
}

/** El mensaje del proveedor solo se usa para reconocer el caso; nunca se muestra. */
function esFaltaDeCredito(mensaje: string): boolean {
  return /credit balance|insufficient (credit|quota)|billing/i.test(mensaje);
}

export function motivoDeFallaDeLectura(status: number | undefined, mensaje = ""): FallaDeLectura {
  if (esFaltaDeCredito(mensaje) || status === 402) {
    return {
      texto:
        "The reading service has run out of credit. The document is fine — this is a setting to fix, " +
        "not something to correct on the paper. Enter the fields by hand and tell whoever administers the service.",
      deConfiguracion: true,
      reintentable: false,
    };
  }
  if (status === 401 || status === 403) {
    return {
      texto:
        "The reading service rejected its credentials. The document is fine — this is a setting to fix. " +
        "Enter the fields by hand and tell whoever administers the service.",
      deConfiguracion: true,
      reintentable: false,
    };
  }
  if (status === 429) {
    return {
      texto: "Too many documents are being read at once. Wait a moment and read this one again.",
      deConfiguracion: false,
      reintentable: true,
    };
  }
  if (status === undefined || status >= 500) {
    return {
      texto: "The reading service did not answer. Read the document again in a moment.",
      deConfiguracion: false,
      reintentable: true,
    };
  }
  return {
    texto: "The document could not be read. Enter the fields by hand.",
    deConfiguracion: false,
    reintentable: false,
  };
}
