import { fmtFecha } from "./fechas";
import type {
  Comunicacion,
  Counterparty,
  GlobalAlert,
  Interaccion,
  OperationDetail,
  OperationSummary,
  Recordatorio,
} from "./types";

/**
 * Datos de ejemplo mientras no hay base de datos.
 * Una sola operación tiene ficha completa (OP-2026-012); el resto es resumen.
 * Este archivo desaparece cuando se conecte Supabase — ver lib/data.ts.
 */

export const operationSummaries: OperationSummary[] = [
  {
    codigo: "OP-2026-013",
    mercaderia: "Cuota Hilton — cortes enfriados · 18 MT",
    cliente: "Hamburg Beef Imports GmbH",
    clientePais: "DE",
    proveedor: "Frigorífico La Serrana",
    tipoMercaderia: "CARNE",
    incoterm: "CFR",
    estado: "BORRADOR",
    alertas: 1,
    peorSeveridad: "INFO",
    fechaEmbarque: null,
    montoVenta: null,
    montoCompra: null,
    tieneDetalle: false,
  },
  {
    codigo: "OP-2026-012",
    mercaderia: "Cortes bovinos congelados · 54 MT",
    cliente: "Al Rashid Trading LLC",
    clientePais: "AE",
    proveedor: "Frigorífico La Serrana",
    tipoMercaderia: "CARNE",
    incoterm: "FOB",
    estado: "DOCS_EN_PREPARACION",
    alertas: 3,
    peorSeveridad: "CRITICA",
    /* estimado real (booking 18-ago) — excede el límite de la LC (15-ago): de acá sale la CRITICA */
    fechaEmbarque: "18-ago-26",
    montoVenta: 259200,
    montoCompra: 226800,
    tieneDetalle: true,
  },
  {
    codigo: "OP-2026-011",
    mercaderia: "Carne bovina congelada · 108 MT",
    cliente: "Shanghai Meat Trading Co.",
    clientePais: "CN",
    proveedor: "Frigorífico La Serrana",
    /* a propósito SIN familia: el backlog del ERP viene así y esas operaciones no las
       alcanzaba ningún filtro. Ahora salen por «Sin familia», que es como se las va a
       buscar para completarlas. */
    incoterm: "CFR",
    estado: "EMBARCADA",
    alertas: 1,
    peorSeveridad: "MEDIA",
    fechaEmbarque: "28-jun-26",
    montoVenta: 486000,
    montoCompra: 432000,
    tieneDetalle: false,
  },
  {
    codigo: "OP-2026-010",
    mercaderia: "Lana peinada tops · 44 MT",
    cliente: "Textilana SpA",
    clientePais: "IT",
    tipoMercaderia: "LANA",
    incoterm: "FOB",
    estado: "EN_TRANSITO",
    alertas: 0,
    peorSeveridad: null,
    fechaEmbarque: "12-jun-26",
    montoVenta: 371800,
    montoCompra: 338000,
    tieneDetalle: false,
  },
  {
    codigo: "OP-2026-009",
    mercaderia: "Soja · 3.000 MT",
    cliente: "Qingdao Grain Imports",
    clientePais: "CN",
    proveedor: "Molino Oriental S.A.",
    tipoMercaderia: "GRANOS",
    incoterm: "FOB",
    estado: "COBRADA",
    alertas: 0,
    peorSeveridad: null,
    fechaEmbarque: "18-may-26",
    montoVenta: 1242000,
    montoCompra: 1104000,
    tieneDetalle: false,
  },
];

export const operationDetails: Record<string, OperationDetail> = {
  "OP-2026-012": {
    ...operationSummaries.find((o) => o.codigo === "OP-2026-012")!,
    descripcionLarga: "Cortes bovinos congelados s/hueso · 54 MT",
    ruta: "FOB Montevideo → Jebel Ali",
    moneda: "USD",
    tipoMercaderia: "CARNE",
    medioPago: "LC",
    legs: [
      {
        tipo: "COMPRA",
        contraparte: "Frigorífico La Serrana",
        contraparteEmail: "comercial@laserrana.example",
        lugar: "Cerro Largo, UY",
        condicionesPago: "Transferencia contra entrega en planta",
        precioUnit: 4200,
        montoTotal: 226800,
      },
      {
        tipo: "VENTA",
        contraparte: "Al Rashid Trading LLC",
        contraparteEmail: "imports@alrashid.example",
        lugar: "Dubai, AE",
        condicionesPago: "Carta de crédito irrevocable a la vista",
        precioUnit: 4800,
        montoTotal: 259200,
      },
    ],
    items: [
      {
        descripcion: "Cortes bovinos congelados s/hueso, delanteros, faena halal",
        cantidad: "54 MT (±5%)",
        embalaje: "Cajas de 27 kg · 2 contenedores reefer de 40' a −18 °C",
      },
    ],
    lc: {
      numero: "ECB-889174",
      bancoEmisor: "Emirates Commercial Bank",
      bancoAvisador: "BROU",
      vencimiento: "05-sep-26",
      limiteEmbarque: "15-ago-26",
      plazoPresentacion: "21 días desde fecha de BL",
    },
    resumenEjecutivo:
      "Compra de 54 MT de cortes bovinos congelados s/hueso (faena halal) a Frigorífico La Serrana (USD 226.800) y venta FOB Montevideo a Al Rashid Trading, Dubai (USD 259.200, margen bruto 14,3%). Cobro por carta de crédito a la vista ya recibida y validada con 2 observaciones. Embarque en 2 reefers de 40' a −18 °C vía Jebel Ali; límite de embarque de la LC: 15-ago. Punto crítico: el booking estimado (18-ago) excede ese límite — adelantar booking o pedir enmienda. Faltan el certificado sanitario (MGAP) y el halal, ambos exigidos por la LC.",
    resumenGeneradoEn: "16-jul-2026 09:40 · v5",
    hitos: [
      { fecha: "12-jun-26", label: "Firma de contratos de compra y venta", estado: "CUMPLIDO" },
      { fecha: "18-jun-26", label: "Faena y despostada — Frigorífico La Serrana", estado: "CUMPLIDO" },
      { fecha: "20-jun-26", label: "Carta de crédito recibida y validada", estado: "CUMPLIDO" },
      { fecha: "25-jun-26", label: "Booking solicitado al forwarder", estado: "CUMPLIDO" },
      { fecha: "10-ago-26", label: "Cut-off documental en terminal", estado: "PENDIENTE" },
      {
        fecha: "15-ago-26",
        label: "Último embarque permitido por LC — booking estimado 18-ago",
        estado: "EN_RIESGO",
      },
      {
        fecha: "+21 días",
        label: "Presentación de documentos al banco (desde fecha de BL)",
        estado: "PENDIENTE",
      },
      { fecha: "~fin ago", label: "Cobro estimado", estado: "PENDIENTE" },
    ],
    documentos: [
      {
        nombre: "Contrato de compra",
        origen: "GENERADO",
        estado: "APROBADO",
        version: "v2",
        fecha: "12-jun-26",
        accion: "ver",
      },
      {
        nombre: "Contrato de venta",
        origen: "GENERADO",
        estado: "APROBADO",
        version: "v3",
        fecha: "12-jun-26",
        accion: "ver",
      },
      {
        nombre: "Proforma invoice",
        origen: "GENERADO",
        estado: "ENVIADO",
        version: "v1",
        fecha: "14-jun-26",
        accion: "ver",
      },
      {
        nombre: "Carta de crédito ECB-889174",
        origen: "EXTERNO",
        estado: "OBSERVADO",
        version: null,
        fecha: "20-jun-26",
        accion: "consistencia",
        nota: "2 observaciones",
      },
      {
        nombre: "Commercial invoice (draft)",
        origen: "GENERADO",
        estado: "BORRADOR",
        version: "v1",
        fecha: "01-jul-26",
        accion: "revisar",
      },
      {
        nombre: "Packing list preliminar",
        origen: null,
        estado: "PENDIENTE",
        version: null,
        fecha: null,
        accion: "generar",
      },
      {
        nombre: "Instrucciones de embarque",
        origen: null,
        estado: "PENDIENTE",
        version: null,
        fecha: null,
        accion: "generar",
      },
      {
        nombre: "Instrucciones al forwarder",
        origen: "GENERADO",
        estado: "BORRADOR",
        version: "v1",
        fecha: "02-jul-26",
        accion: "revisar",
      },
      {
        nombre: "Instrucciones al proveedor",
        origen: "GENERADO",
        estado: "ENVIADO",
        version: "v1",
        fecha: "16-jun-26",
        accion: "ver",
      },
    ],
    checklist: [
      { label: "Contrato de compra firmado", estado: "COMPLETO" },
      { label: "Contrato de venta firmado", estado: "COMPLETO" },
      { label: "Proforma invoice enviada al comprador", estado: "COMPLETO" },
      { label: "Carta de crédito recibida y validada", estado: "COMPLETO" },
      { label: "Commercial invoice — 3 originales + 3 copias", estado: "EN_PREPARACION", exigidoPorLC: true },
      { label: "Packing list", estado: "PENDIENTE", exigidoPorLC: true },
      {
        label: 'Bill of lading — juego completo 3/3, "clean on board"',
        estado: "PENDIENTE",
        exigidoPorLC: true,
        nota: "lo emite la naviera al embarcar",
      },
      { label: "Certificado de origen — Cámara Mercantil", estado: "PENDIENTE", exigidoPorLC: true, enAlerta: true },
      { label: "Certificado sanitario oficial — MGAP·DGSG", estado: "PENDIENTE", exigidoPorLC: true, enAlerta: true },
      {
        label: "Certificado halal — Centro Islámico del Uruguay",
        estado: "PENDIENTE",
        exigidoPorLC: true,
        nota: "destino EAU — checklist por mercadería (S-5)",
      },
      {
        label: "Certificado de seguro",
        estado: "NO_APLICA",
        nota: "N/A: en FOB el seguro lo contrata el comprador; la LC no lo exige",
      },
    ],
    matriz: [
      {
        campo: "Beneficiario / exportador",
        operacion: { valor: "Oriental Trade S.A." },
        lc: { valor: "Oriental Trade Sociedad Anónima", marca: "bad" },
        invoice: { valor: "Oriental Trade S.A." },
        packing: { valor: null },
        estado: "DISCREPANCIA",
      },
      {
        campo: "Monto",
        operacion: { valor: "USD 259.200,00" },
        lc: { valor: "USD 259.200,00 ±5%" },
        invoice: { valor: "USD 259.200,00" },
        packing: { valor: null },
        estado: "OK",
      },
      {
        campo: "Cantidad",
        operacion: { valor: "54 MT ±5%" },
        lc: { valor: "54 MT ±5%" },
        invoice: { valor: "54 MT" },
        packing: { valor: "55,1 MT", marca: "tol" },
        estado: "TOLERANCIA",
      },
      {
        campo: "Puerto de embarque",
        operacion: { valor: "Montevideo" },
        lc: { valor: "Montevideo, Uruguay" },
        invoice: { valor: "Montevideo" },
        packing: { valor: null },
        estado: "OK",
      },
      {
        campo: "Puerto de destino",
        operacion: { valor: "Jebel Ali" },
        lc: { valor: "Jebel Ali Port, UAE" },
        invoice: { valor: "Jebel Ali" },
        packing: { valor: null },
        estado: "OK",
      },
      {
        campo: "Fecha límite de embarque",
        operacion: { valor: "18-ago-26 (estimada)", marca: "bad" },
        lc: { valor: "15-ago-26" },
        invoice: { valor: null },
        packing: { valor: null },
        estado: "CRITICO",
      },
      {
        campo: "Descripción de mercadería",
        operacion: { valor: "Cortes bovinos congelados s/hueso, delanteros" },
        lc: { valor: "Frozen boneless beef, forequarters" },
        invoice: { valor: "Frozen boneless beef, forequarters" },
        packing: { valor: "Frozen boneless beef, forequarters" },
        estado: "EQUIV",
      },
      {
        campo: "Plazo de presentación",
        operacion: { valor: null },
        lc: { valor: "21 días desde fecha de BL" },
        invoice: { valor: null },
        packing: { valor: null },
        estado: "INFO",
      },
    ],
    matrizCorridaEn: "03-jul-2026 14:32",
    discrepancias: [
      {
        id: "disc-embarque",
        severidad: "CRITICA",
        titulo: "Embarque estimado posterior al límite de la LC",
        detalle:
          "El booking del forwarder estima embarque el 18-ago-26, pero la LC exige embarcar a más tardar el 15-ago-26. Si se embarca tarde, el banco rechaza los documentos y el cobro queda a voluntad del comprador.",
        acciones: [
          {
            label: "Pedir adelanto de booking",
            resultado: "En el MVP: redacta el mail al forwarder pidiendo adelantar el booking",
          },
          {
            label: "Pedir enmienda de LC",
            resultado: "En el MVP: redacta la solicitud de enmienda de LC al comprador",
          },
        ],
      },
      {
        id: "disc-beneficiario",
        severidad: "ALTA",
        titulo: "Razón social del beneficiario difiere entre LC y factura",
        detalle:
          'La LC (campo 59) dice "Oriental Trade Sociedad Anónima"; el draft de commercial invoice dice "Oriental Trade S.A.". Es una de las causas más comunes de rechazo bancario en presentaciones de LC.',
        acciones: [
          {
            label: "Corregir invoice con el texto de la LC",
            resultado: "Invoice corregida: se usará la razón social exacta de la LC",
          },
          {
            label: "Marcar falso positivo",
            resultado: "Discrepancia marcada como falso positivo (queda registrado quién y cuándo)",
          },
        ],
      },
    ],
  },
};

/* Solo operaciones SIN ficha completa: las que tienen ficha derivan sus
   alertas del motor (lib/alertas.ts) — datos, no listas fijas. */
export const globalAlerts: GlobalAlert[] = [
  {
    severidad: "MEDIA",
    operacion: "OP-2026-011",
    titulo: "Presentar documentos al banco antes del 19-jul",
    fecha: "2026-07-19",
    detalle: "BL emitido el 28-jun; el plazo de presentación de la LC es de 21 días.",
  },
  {
    severidad: "INFO",
    operacion: "OP-2026-013",
    titulo: "Operación en borrador hace 9 días",
    detalle: "Falta cargar la pata de venta para poder generar la proforma.",
  },
];

export const counterparties: Counterparty[] = [
  {
    id: "cp-1",
    numero: "2031",
    razonSocial: "Molino Oriental S.A.",
    rol: "PROVEEDOR",
    pais: "Uruguay",
    operaciones: 4,
  },
  {
    id: "cp-2",
    numero: "2044",
    razonSocial: "Frigorífico La Serrana",
    rol: "PROVEEDOR",
    pais: "Uruguay",
    operaciones: 7,
  },
  {
    id: "cp-3",
    numero: "1042",
    razonSocial: "Al Rashid Trading LLC",
    rol: "CLIENTE",
    pais: "Emiratos Árabes",
    operaciones: 2,
  },
  {
    id: "cp-4",
    numero: "1058",
    razonSocial: "Shanghai Meat Trading Co.",
    rol: "CLIENTE",
    pais: "China",
    operaciones: 5,
  },
  { id: "cp-5", numero: "1071", razonSocial: "Textilana SpA", rol: "CLIENTE", pais: "Italia", operaciones: 3 },
  /* el forwarder y el banco van SIN número a propósito: el número de cliente es
     del sistema viejo y no todo el mundo tiene uno — la fila tiene que leerse
     igual de bien cuando falta */
  { id: "cp-6", razonSocial: "Transatlantic Freight", rol: "FORWARDER", pais: "Uruguay", operaciones: 11 },
  { id: "cp-7", razonSocial: "BROU", rol: "BANCO", pais: "Uruguay", operaciones: 9 },
  {
    id: "cp-8",
    numero: "1090",
    razonSocial: "Hamburg Beef Imports GmbH",
    rol: "CLIENTE",
    pais: "Alemania",
    operaciones: 1,
  },
];

/* ---------- módulo comercial (ADR-004): el demo muestra la feature VIVA ----------
   Sin esto, "Último contacto" salía "—" en las ocho filas y la ficha abría muerta:
   una columna 100% vacía le enseña al usuario que la feature no funciona.
   Fechas relativas a HOY para que el demo no envejezca. */
const dias = (n: number) => fmtFecha(new Date(Date.now() + n * 86_400_000));
/* las comunicaciones guardan timestamp ISO, no la fecha en palabras */
const hace = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export const interaccionesSeed: Interaccion[] = [
  {
    id: "int-seed-1",
    contraparte: "Al Rashid Trading LLC",
    fecha: dias(-2),
    nota: "Confirman interés en 20 t más de cortes enfriados para octubre; piden precio CFR Jebel Ali.",
  },
  {
    id: "int-seed-2",
    contraparte: "Shanghai Meat Trading Co.",
    fecha: dias(-6),
    nota: "Piden adelantar el próximo embarque una semana; el certificado sanitario original viaja con los documentos.",
  },
  {
    id: "int-seed-3",
    contraparte: "Frigorífico La Serrana",
    fecha: dias(-12),
    nota: "Faena parada hasta la semana del 7-sep; recién ahí habría 100 t disponibles.",
  },
];

/* El hilo de correo del demo. Sin esto la pantalla de comunicaciones se ve
   vacía y no se puede juzgar: getComunicaciones solo devolvía filas con
   Supabase, así que el módulo era invisible en demo y en los shots.
   Son mails de verdad en su forma —asunto corto, cuerpo con los datos pegados,
   dirección de la contraparte— porque de ese cuerpo sale la precarga de la
   operación, y un texto de relleno no la ejercita. */
export const comunicacionesSeed: Comunicacion[] = [
  {
    id: "com-seed-1",
    counterpartyId: "cp-3",
    operationId: null,
    operacionCodigo: "OP-2026-012",
    canal: "EMAIL",
    direccion: "ENTRANTE",
    asunto: "RE: OP-2026-012 — booking confirmado, sale 18/08",
    cuerpo:
      "Dear Sirs,\n\nBooking confirmed with MSC, vessel MSC LEILA, ETD Montevideo 18-Aug, ETA Jebel Ali 12-Sep.\n\nPlease note the L/C expiry is 15-Aug — kindly arrange the amendment before shipment.\n\nBest regards,\nK. Al Rashid",
    conEmail: "purchasing@alrashid.example",
    ocurridoEn: hace(1),
    leido: false,
  },
  {
    id: "com-seed-2",
    counterpartyId: "cp-3",
    operationId: null,
    operacionCodigo: "OP-2026-012",
    canal: "EMAIL",
    direccion: "SALIENTE",
    asunto: "OP-2026-012 — documentos de embarque",
    cuerpo:
      "Estimados,\n\nAdjuntamos la factura comercial y el packing list de los 54 MT de cortes bovinos congelados. El certificado sanitario original viaja con los documentos.\n\nSaludos.",
    conEmail: "purchasing@alrashid.example",
    ocurridoEn: hace(3),
    leido: true,
  },
  {
    id: "com-seed-3",
    counterpartyId: "cp-3",
    operationId: null,
    operacionCodigo: null,
    canal: "EMAIL",
    direccion: "ENTRANTE",
    asunto: "New enquiry — 27 MT chilled hindquarter cuts CFR Jebel Ali",
    cuerpo:
      "Hello,\n\nWe would like to buy 27 MT of chilled hindquarter cuts, CFR Jebel Ali, shipment end of September, payment by L/C at sight.\n\nPlease quote your best price per ton.\n\nRegards,\nK. Al Rashid",
    conEmail: "purchasing@alrashid.example",
    ocurridoEn: hace(5),
    leido: true,
  },
  {
    id: "com-seed-4",
    counterpartyId: "cp-4",
    operationId: null,
    operacionCodigo: "OP-2026-011",
    canal: "EMAIL",
    direccion: "ENTRANTE",
    asunto: "OP-2026-011 — adelantar embarque una semana",
    cuerpo:
      "Hi,\n\nCould you please advance the next shipment by one week? Our cold storage in Qingdao is available from 20-Jun.\n\nThanks,\nShanghai Meat Trading",
    conEmail: "ops@eastmeat.example",
    ocurridoEn: hace(6),
    leido: true,
  },
  {
    id: "com-seed-5",
    counterpartyId: "cp-4",
    operationId: null,
    operacionCodigo: null,
    canal: "WHATSAPP",
    direccion: "SALIENTE",
    asunto: null,
    cuerpo: "Confirmado, adelantamos a la semana del 20. Te paso el booking apenas lo tenga.",
    conEmail: null,
    ocurridoEn: hace(6),
    leido: true,
  },
];

export const recordatoriosSeed: Recordatorio[] = [
  /* vencido a propósito: enciende el chip ámbar de la lista y sube como alerta */
  {
    id: "rec-seed-1",
    contraparte: "Shanghai Meat Trading Co.",
    fecha: dias(-2),
    nota: "Confirmar con Shanghai la fecha nueva de embarque",
  },
  {
    id: "rec-seed-2",
    contraparte: "Al Rashid Trading LLC",
    fecha: dias(4),
    nota: "Pasar precio CFR por las 20 t adicionales",
  },
];
