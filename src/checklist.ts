import type { ChecklistRow, DocumentRow, MedioPago, Milestone, TipoMercaderia } from "./types";

export type { MedioPago, TipoMercaderia } from "./types";

/**
 * RF-1.3 — checklist documental autogenerado.
 * Se parametriza por Incoterm + medio de pago + TIPO DE MERCADERÍA (supuesto S-5,
 * ADR-003): la carne agrega sanitario MGAP·DGSG, halal según destino y reefer.
 * Lógica pura: recibe datos, devuelve filas — sin IA, sin red (la IA redacta
 * documentos; el checklist es determinístico).
 */

export type ChecklistParams = {
  incoterm: string;
  /** "" cuando todavía no se eligió: el checklist pide definirlo en vez de asumir */
  medioPago: MedioPago | "";
  mercaderia: TipoMercaderia;
  /** Código ISO-2 del país de destino (define halal en Golfo, S-5). */
  destinoPais?: string;
};

/** El destino llega como ISO-2 desde el alta y como NOMBRE desde lo importado del ERP
 *  ("UNITED ARAB EMIRATES"). Antes se comparaba solo contra ISO-2 y no matcheaba nunca:
 *  cinco contrapartes en países del Golfo y cero certificados halal. */
const HALAL_ISO = ["AE", "SA", "QA", "KW", "BH", "OM", "EG", "JO", "MY", "ID"];
const HALAL_NOMBRE = [
  "UNITED ARAB EMIRATES",
  "UNITED ARABIAN EMIRATES",
  "EMIRATOS",
  "SAUDI",
  "ARABIA SAUDITA",
  "QATAR",
  "KUWAIT",
  "BAHRAIN",
  "BAHREIN",
  "OMAN",
  "OMÁN",
  "EGYPT",
  "EGIPTO",
  "JORDAN",
  "JORDANIA",
  "MALAYSIA",
  "MALASIA",
  "INDONESIA",
];

export function exigeHalal(destino: string | null | undefined): boolean {
  const d = (destino ?? "").trim().toUpperCase();
  if (!d) return false;
  return d.length === 2 ? HALAL_ISO.includes(d) : HALAL_NOMBRE.some((n) => d.includes(n));
}

export function generarChecklist({ incoterm, medioPago, mercaderia, destinoPais }: ChecklistParams): ChecklistRow[] {
  const lc = medioPago === "LC";
  const rows: ChecklistRow[] = [
    // sin medio de pago cargado no se sabe si hay carta de crédito: se pide, no se asume
    ...(medioPago
      ? []
      : [{ label: "Definir el medio de pago (no vino del sistema anterior)", estado: "PENDIENTE" as const }]),
    { label: "Contrato de compra firmado", estado: "PENDIENTE" },
    { label: "Contrato de venta firmado", estado: "PENDIENTE" },
    { label: "Proforma invoice enviada al comprador", estado: "PENDIENTE" },
  ];

  if (lc) {
    rows.push({ label: "Carta de crédito recibida y validada", estado: "PENDIENTE" });
  }

  rows.push(
    { label: `Commercial invoice${lc ? " — según condiciones de la LC" : ""}`, estado: "PENDIENTE", exigidoPorLC: lc },
    { label: "Packing list", estado: "PENDIENTE", exigidoPorLC: lc },
    {
      label: 'Bill of lading — juego completo 3/3, "clean on board"',
      estado: "PENDIENTE",
      exigidoPorLC: lc,
      nota: "lo emite la naviera al embarcar",
    },
    { label: "Certificado de origen — Cámara Mercantil", estado: "PENDIENTE", exigidoPorLC: lc },
  );

  if (mercaderia === "CARNE") {
    rows.push({
      label: "Certificado sanitario oficial — MGAP·DGSG",
      estado: "PENDIENTE",
      exigidoPorLC: lc,
      nota: "checklist por mercadería (S-5)",
    });
    if (exigeHalal(destinoPais)) {
      rows.push({
        label: "Certificado halal — Centro Islámico del Uruguay",
        estado: "PENDIENTE",
        exigidoPorLC: lc,
        nota: `destino ${(destinoPais ?? "").toUpperCase()} — checklist por mercadería (S-5)`,
      });
    }
  }
  if (mercaderia === "GRANOS") {
    rows.push({ label: "Certificado fitosanitario — MGAP", estado: "PENDIENTE", exigidoPorLC: lc });
  }

  const inco = (incoterm ?? "").toUpperCase();
  const cif = ["CIF", "CIP"].includes(inco);
  rows.push(
    // sin incoterm no se puede afirmar quién contrata el seguro: queda PENDIENTE, no "no aplica"
    !inco || inco === "—"
      ? {
          label: "Certificado de seguro",
          estado: "PENDIENTE",
          exigidoPorLC: lc,
          nota: "incoterm sin definir — revisar quién contrata el seguro",
        }
      : cif
        ? {
            label: "Certificado de seguro",
            estado: "PENDIENTE",
            exigidoPorLC: lc,
            nota: `en ${incoterm} el seguro lo contrata el vendedor`,
          }
        : {
            label: "Certificado de seguro",
            estado: "NO_APLICA",
            nota: `N/A: en ${incoterm} el seguro lo contrata el comprador`,
          },
  );

  return rows;
}

/** Documentos iniciales del paquete (PRD §8) — todos pendientes de generar. */
/**
 * Orden en que se trabajan los documentos: contratos, factura, packing, instrucciones, LC.
 * Es la única definición de ese orden; la ficha ordena su tabla con esta lista (PostgREST
 * devuelve los embebidos sin orden y la tabla cambiaba en cada carga — QA del 10-sep).
 */
export const ORDEN_PAQUETE: string[] = [
  "Contrato de compra",
  "Contrato de venta",
  "Proforma invoice",
  "Commercial invoice (draft)",
  "Packing list preliminar",
  "Shipping instructions",
  "Instrucciones de embarque",
  "Instrucciones al proveedor",
  "Instrucciones al forwarder",
  "Carta de crédito",
];

export function documentosIniciales(medioPago: MedioPago): DocumentRow[] {
  const docs: DocumentRow[] = [
    { nombre: "Contrato de compra", origen: null, estado: "PENDIENTE", version: null, fecha: null, accion: "generar" },
    { nombre: "Contrato de venta", origen: null, estado: "PENDIENTE", version: null, fecha: null, accion: "generar" },
    { nombre: "Proforma invoice", origen: null, estado: "PENDIENTE", version: null, fecha: null, accion: "generar" },
    {
      nombre: "Commercial invoice (draft)",
      origen: null,
      estado: "PENDIENTE",
      version: null,
      fecha: null,
      accion: "generar",
    },
    {
      nombre: "Packing list preliminar",
      origen: null,
      estado: "PENDIENTE",
      version: null,
      fecha: null,
      accion: "generar",
    },
    // 9-sep: las "Instrucciones de embarque" (prosa libre, en español) las reemplazan las
    // "Shipping instructions" formales: consignatario como lo pide el 46A, HS, flete, ejemplares
    // del BL y VGM por contenedor. La plantilla vieja se conserva para las operaciones que ya la tienen.
    {
      nombre: "Shipping instructions",
      origen: null,
      estado: "PENDIENTE",
      version: null,
      fecha: null,
      accion: "generar",
    },
    {
      nombre: "Instrucciones al proveedor",
      origen: null,
      estado: "PENDIENTE",
      version: null,
      fecha: null,
      accion: "generar",
    },
    {
      nombre: "Instrucciones al forwarder",
      origen: null,
      estado: "PENDIENTE",
      version: null,
      fecha: null,
      accion: "generar",
    },
  ];
  if (medioPago === "LC") {
    docs.splice(3, 0, {
      nombre: "Carta de crédito",
      origen: null,
      estado: "PENDIENTE",
      version: null,
      fecha: null,
      accion: "consistencia",
      nota: "documento externo — subirla cuando llegue",
    });
  }
  return docs;
}

/** Hitos macro iniciales (UML 06): el estado avanza el operador, los hitos alertan. */
export function hitosIniciales(fechaEmbarque: string | null, medioPago: MedioPago): Milestone[] {
  const hitos: Milestone[] = [{ fecha: "—", label: "Firma de contratos de compra y venta", estado: "PENDIENTE" }];
  if (medioPago === "LC") {
    hitos.push({ fecha: "—", label: "Carta de crédito recibida y validada", estado: "PENDIENTE" });
  }
  hitos.push(
    { fecha: "—", label: "Booking solicitado al forwarder", estado: "PENDIENTE" },
    { fecha: fechaEmbarque ?? "—", label: "Embarque", estado: "PENDIENTE" },
    { fecha: "—", label: "Cobro", estado: "PENDIENTE" },
  );
  return hitos;
}
