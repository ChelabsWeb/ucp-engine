/**
 * Tipos del dominio — espejo del modelo UML (docs/uml/02-modelo-de-dominio.md).
 * Cuando exista Supabase, estos tipos se contrastan con los generados
 * por `supabase gen types` para que la base y la UI no diverjan.
 */

export type OperationStatus =
  | "BORRADOR"
  | "NEGOCIACION"
  | "CONTRATADA"
  | "DOCS_EN_PREPARACION"
  | "EMBARCADA"
  | "EN_TRANSITO"
  | "ENTREGADA"
  | "COBRADA"
  | "CANCELADA";

export type LegType = "COMPRA" | "VENTA";
/* SURVEYOR y CAMARA (D2): emiten análisis, fumigación, peso y certificado de origen */
export type CounterpartyRole = "PROVEEDOR" | "CLIENTE" | "FORWARDER" | "BANCO" | "ASEGURADORA" | "SURVEYOR" | "CAMARA";
export type DocumentSource = "GENERADO" | "EXTERNO";

export type DocumentStatus = "BORRADOR" | "REVISADO" | "APROBADO" | "ENVIADO" | "VALIDADO" | "OBSERVADO" | "PENDIENTE";

export type ChecklistStatus = "COMPLETO" | "EN_PREPARACION" | "PENDIENTE" | "NO_APLICA";
export type MedioPago = "LC" | "TRANSFERENCIA" | "COBRANZA";
export type TipoMercaderia = "CARNE" | "GRANOS" | "LANA" | "OTRO";
export type MilestoneStatus = "CUMPLIDO" | "PENDIENTE" | "EN_RIESGO";
export type Severity = "INFO" | "MEDIA" | "ALTA" | "CRITICA";

/** Datos del trader (Ajustes) — se inyectan como datos duros en cada documento (R-1). */
/** Una cuenta bancaria de la empresa: se imprime en el contrato de venta. */
export interface CuentaBancaria {
  banco: string;
  titular?: string | null;
  moneda?: string | null;
  numero?: string | null;
  swift?: string | null;
}

export interface Empresa {
  razonSocial: string;
  rut: string;
  direccion: string;
  ciudad: string;
  email: string;
  telefono: string;
}

/** La empresa con su cuenta principal: lo que necesitan los documentos que llevan datos bancarios.
 *  Se mantiene aparte de `Empresa` porque Ajustes edita solo campos de texto. */
export type EmpresaConBanco = Empresa & { cuenta?: CuentaBancaria | null };

/** Etapa 2 "los canales": una comunicación con una contraparte, multi-canal. */
export type CanalComunicacion = "EMAIL" | "WHATSAPP" | "WECHAT";
export type DireccionComunicacion = "ENTRANTE" | "SALIENTE";

export interface Comunicacion {
  id: string;
  counterpartyId: string | null;
  operationId: string | null;
  operacionCodigo?: string | null;
  canal: CanalComunicacion;
  direccion: DireccionComunicacion;
  asunto: string | null;
  cuerpo: string | null;
  conEmail: string | null;
  ocurridoEn: string;
  leido: boolean;
}

/** ERP viejo (módulo Bancos): cuenta bancaria del trader, para las instrucciones de pago. */
export interface BankAccount {
  id: string;
  banco: string;
  titular: string | null;
  moneda: string;
  numero: string | null;
  swift: string | null;
  iban: string | null;
  esPrincipal: boolean;
}

export interface Counterparty {
  id: string;
  /** Número de cliente del sistema viejo. Es por donde lo buscan: se acuerdan
   *  del número antes que de la razón social. Texto, no número: los códigos del
   *  ERP viejo pueden traer ceros a la izquierda. Los bancos y forwarders no
   *  tienen. */
  numero?: string;
  razonSocial: string;
  rol: CounterpartyRole;
  pais: string;
  /** ISO 3166-1 alpha-2. Lo exige el CFE (CodPaisRecep): se deriva del
   *  nombre con src/lib/paises.ts. null = no se pudo resolver y se carga a mano. */
  paisIso?: string | null;
  direccion?: string;
  ciudad?: string;
  /** B2: a dónde le escribimos. Vacío = los correos a esta contraparte piden el email a mano. */
  email?: string;
  operaciones: number;
}

export interface TradeLeg {
  tipo: LegType;
  contraparte: string;
  /** B2: email REAL de la contraparte (columna counterparties.email) o null si no
   *  está cargado. Los correos salen a esta dirección o no salen — nunca a una
   *  inventada a partir de la razón social. */
  contraparteEmail?: string | null;
  contraparteId?: string | null;
  lugar: string;
  condicionesPago: string;
  precioUnit: number;
  /** true si el ERP no trae precio: `precioUnit` queda en 0 y NO hay que mostrarlo como precio */
  sinPrecio?: boolean;
  /** incoterm de ESTA pata (caso CSU2025099: compra FOB, venta CFR); null = el de la operación */
  incoterm?: string | null;
  /** null = no se conoce (histórico del ERP sin unidad resuelta). Nunca 0 "por defecto":
   *  el 0 se mostraba como "USD 0" y daba NaN% de margen (re-auditoría H1). */
  montoTotal: number | null;
}

export interface OperationItem {
  descripcion: string;
  cantidad: string;
  embalaje: string;
  /** partida arancelaria (columna hs_code); la LC (45A) la fija y los documentos la repiten */
  hsCode?: string | null;
  /** especificación del producto: se imprime literal en el contrato */
  especificacion?: string | null;
  /** quién lo fabrica y de dónde es: el contrato del ERP los imprime */
  manufacturer?: string | null;
  origen?: string | null;
  /** presentación del producto tal como la imprime el contrato */
  packing?: string | null;
  /** cantidad y unidad CRUDAS: `cantidad` es un string de display ("57000 KG") y parsearlo
   *  para precargar un campo en toneladas daba un error de mil veces */
  cantidadNum?: number | null;
  unidad?: string | null;
  /** Precios POR LÍNEA (B6/C2): cuando las líneas de una operación divergen, la
   *  pata queda sin precio y el número real vive acá. null = no cargado. */
  precioCompra?: number | null;
  precioVenta?: number | null;
}

export interface LcInfo {
  numero: string;
  bancoEmisor: string;
  bancoAvisador: string;
  vencimiento: string;
  limiteEmbarque: string;
  plazoPresentacion: string;
  /** tolerancia de cantidad/monto de la LC como fracción (0.05 = ±5 %); null = no dice → rige el ±5 % habitual */
  tolerancia?: number | null;
  /** campo 46A tal cual (caso CSU2025099): de acá salen el weight note y los certificados del beneficiario */
  documentosExigidos?: string[] | null;
  /** campo 47A tal cual: condiciones operativas (aviso a la aseguradora, fee por discrepancia, fechas) */
  condicionesAdicionales?: string[] | null;
  /** 31C · 32B · 42C · 42D — para el pre-check de presentación y el giro */
  fechaEmision?: string | null;
  monto?: number | null;
  moneda?: string | null;
  giros?: string | null;
  librado?: string | null;
  /** 59, primera línea: la razón social de quien cobra */
  beneficiario?: string | null;
  /** 59: cómo figura el beneficiario (dirección) — los documentos propios deben repetirla (D3) */
  beneficiarioDireccion?: string | null;
  /** 45A: HS code de la mercadería según la LC (D4) */
  hsCode?: string | null;
}

export interface Milestone {
  fecha: string;
  label: string;
  estado: MilestoneStatus;
}

/** P5: adjunto libre de una operación (foto, certificado escaneado, cualquier papel). */
export interface Adjunto {
  id: string;
  nombre: string;
  mediaType: string | null;
  bytes: number | null;
  storagePath: string;
  nota: string | null;
  creadoEn: string;
}

/** RF-3.4: seguimiento del embarque (manual). Fechas en ISO (yyyy-mm-dd) o null. */
export interface Shipment {
  buque: string | null;
  viaje: string | null;
  naviera: string | null;
  booking: string | null;
  contenedor: string | null;
  puertoCarga: string | null;
  puertoDescarga: string | null;
  etd: string | null;
  atd: string | null;
  eta: string | null;
  ata: string | null;
  nota: string | null;
  /** caso CSU2025099: el booking trae cut-offs (documental/SI y físico/puerto) y un buque que puede
   *  cambiar hasta el BL — si `buque` (el del BL) difiere de `buqueBooking`, se alerta */
  cutoffDocumental?: string | null;
  cutoffFisico?: string | null;
  buqueBooking?: string | null;
  /** B1/B3: el booking también fija cut-off VGM, terminal de carga y puerto de transbordo */
  cutoffVgm?: string | null;
  terminal?: string | null;
  transbordo?: string | null;
}

/** C16 (caso CSU2025099): un contenedor con su precinto, bultos, pesos y lote del productor.
 *  El packing list, el weight note y el BL se emiten POR CONTENEDOR. */
export interface Contenedor {
  id?: string;
  numero: string;
  precinto: string | null;
  tipo: string | null;
  bultos: number | null;
  tipoBulto: string | null;
  pesoNetoKg: number | null;
  pesoBrutoKg: number | null;
  taraKg?: number | null;
  cbm?: number | null;
  lotes: string | null;
  produccionDesde: string | null;
  produccionHasta: string | null;
  vencimiento: string | null;
}

export type ShipmentEstado = "SIN_DATOS" | "AGENDADO" | "EN_TRANSITO" | "ARRIBADO" | "DEMORADO";

export interface DocumentRow {
  nombre: string;
  origen: DocumentSource | null;
  estado: DocumentStatus;
  version: string | null;
  fecha: string | null;
  accion: "ver" | "revisar" | "generar" | "consistencia";
  nota?: string;
}

export interface ChecklistRow {
  label: string;
  estado: ChecklistStatus;
  exigidoPorLC?: boolean;
  nota?: string;
  enAlerta?: boolean;
}

export type MatrixMark = "bad" | "tol";

export interface MatrixCell {
  valor: string | null;
  marca?: MatrixMark;
  /** Confianza 0..1 con que la IA extrajo el valor (solo celdas de documento externo). */
  confianza?: number;
}

export type MatrixVerdict = "OK" | "EQUIV" | "TOLERANCIA" | "DISCREPANCIA" | "CRITICO" | "INFO";

export interface MatrixRow {
  campo: string;
  operacion: MatrixCell;
  lc: MatrixCell;
  invoice: MatrixCell;
  packing: MatrixCell;
  /** Bill of lading (caso CSU2025099) — opcional para no romper las matrices guardadas */
  bl?: MatrixCell;
  estado: MatrixVerdict;
}

export interface Discrepancy {
  id: string;
  severidad: "CRITICA" | "ALTA";
  titulo: string;
  detalle: string;
  acciones: { label: string; resultado: string }[];
}

export interface OperationSummary {
  codigo: string;
  mercaderia: string;
  cliente: string;
  clientePais: string;
  /** La contraparte de la pata de COMPRA. El resumen traía solo la de venta, así
   *  que la ficha de un proveedor o un forwarder mostraba cero operaciones
   *  mientras su propio contador decía siete: las operaciones existían, el corte
   *  no las veía. */
  proveedor?: string | null;
  incoterm: string;
  estado: OperationStatus;
  alertas: number;
  /** Severidad de la peor alerta abierta: el conteo hereda su tono en la UI,
   *  así una operación con una crítica no se ve igual que una con un aviso. */
  peorSeveridad?: Severity | null;
  /** Familia de la mercadería (columna real `operations.tipo_mercaderia`). El
   *  listado la traía solo en la ficha, así que no se podía cortar la cartera
   *  por familia — y es el corte que el negocio usa: carne, granos y lana tienen
   *  documentos, unidades y riesgos distintos. */
  tipoMercaderia?: TipoMercaderia | null;
  fechaEmbarque: string | null;
  /** Lo próximo que vence en esta operación y POR QUÉ: la alerta con fecha más
   *  cercana. El listado lo muestra al lado del «cuándo» para que la fila no
   *  obligue a abrir la ficha para enterarse. */
  proximo?: { fecha: string; motivo: string; severidad: Severity } | null;
  montoVenta: number | null;
  /** Monto de la pata de COMPRA (trade_legs.monto_total): lo que se le debe/pagó al
   *  proveedor. La cuenta de un frigorífico se arma con esto, no con la venta. */
  montoCompra?: number | null;
  /** true si la ficha completa está disponible (en mock, solo la operación de ejemplo) */
  tieneDetalle: boolean;
}

export interface OperationDetail extends OperationSummary {
  descripcionLarga: string;
  ruta: string;
  moneda: string;
  /** Parámetros del checklist (S-5) — permiten editar la operación y regenerarlo. */
  /* (el tipo ahora lo hereda de OperationSummary: estaba declarado dos veces y
     con nullabilidad distinta, que es como se cuelan los desajustes) */
  medioPago?: MedioPago;
  legs: TradeLeg[];
  items: OperationItem[];
  lc: LcInfo | null;
  /** fecha real de zarpe (≈ BL) del seguimiento de embarque; con LC fija el plazo de presentación */
  blReal?: string | null;
  /** los puertos crudos: `ruta` es un string de display que cae al país cuando no hay puerto,
   *  y volver a parsearlo escribía "URUGUAY" en una columna de puerto */
  puertoOrigen?: string | null;
  puertoDestino?: string | null;
  /** Margen % calculado desde las LÍNEAS, igual que los reportes. Antes la ficha lo sacaba de los
   *  montos de las patas y la misma operación mostraba dos números distintos según la pantalla. */
  margenPct?: number | null;
  /** true si vino del ERP viejo (tiene su fila cruda). Las reglas que acotan el backlog heredado
   *  —302 operaciones "activas" con embarque de 2017— solo aplican a estas. */
  importada?: boolean;
  /* del ERP: lo que se imprime en el contrato y define cómo se lee la operación (9-sep) */
  tipoOperacion?: string | null;
  otrasCondiciones?: string | null;
  /** si viene, SUSTITUYE al período de carga en el contrato */
  condicionesEnvio?: string | null;
  /** notas internas: no salen en ningún documento */
  observaciones?: string | null;
  comisionPorTonelada?: number | null;
  comisionTipo?: string | null;
  embarqueParcial?: boolean;
  calidadCantidad?: boolean;
  consignatario?: string | null;
  contratoTercero?: string | null;
  referenciaCliente?: string | null;
  cantidadContenedores?: number | null;
  fechaAnticipo?: string | null;
  /** flete por tonelada (USD/t) cuando la venta incluye transporte y la compra no; el margen lo descuenta */
  fleteUnit?: number | null;
  /** contenedores/lotes del embarque (C16) */
  contenedores?: Contenedor[];
  /** lo del seguimiento que mira el motor de alertas: cut-off documental y buque booking vs BL */
  embarque?: {
    cutoffDocumental: string | null;
    buque: string | null;
    buqueBooking: string | null;
    cutoffVgm?: string | null;
    eta?: string | null;
  } | null;
  resumenEjecutivo: string;
  resumenGeneradoEn: string;
  hitos: Milestone[];
  documentos: DocumentRow[];
  checklist: ChecklistRow[];
  matriz: MatrixRow[];
  matrizCorridaEn: string;
  discrepancias: Discrepancy[];
}

/** Módulo comercial (ADR-004): registro de lo hablado con cada contraparte. */
export interface Interaccion {
  id: string;
  contraparte: string;
  nota: string;
  fecha: string;
}

/** Follow-up con fecha — vencido y sin hacer, cae al motor de alertas. */
/** Plan-calendario fase 4: una alerta de una operación que el operador pospuso
 *  (`hasta` yyyy-mm-dd) o silenció (`hasta` null). Se identifica por la clave
 *  estable del título (`claveAlerta`), no por el texto del día. */
export interface Snooze {
  id: string;
  operacion: string;
  clave: string;
  titulo: string;
  hasta: string | null;
}

export interface Recordatorio {
  id: string;
  nota: string;
  fecha: string;
  contraparte?: string;
  hecho?: boolean;
}

/** RF-2.5: tipo de alerta (se persiste en `alerts.tipo` y se muestra como chip). */
export type AlertType = "FALTANTE" | "INCONSISTENCIA" | "VENCIMIENTO" | "RIESGO";

export interface GlobalAlert {
  severidad: Severity;
  /** yyyy-mm-dd del vencimiento que la alerta describe, si tiene uno. El motor
   *  ya lo calcula para decidir la severidad; antes lo tiraba. Sin fecha, la
   *  alerta no es un vencimiento (un faltante, un riesgo comercial). */
  fecha?: string | null;
  operacion: string;
  titulo: string;
  detalle: string;
  tipo?: AlertType;
}
