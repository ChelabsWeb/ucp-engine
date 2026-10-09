import type { DiferenciaContrato } from "./contrato";
import type { ReglaPresentacion } from "./presentacion";
import type { VerificacionManual } from "./verificaciones-manuales";

/**
 * Los hallazgos del motor, en inglés.
 *
 * El motor produce sus textos en español porque viene de romai, que sirve a un trader uruguayo.
 * Cotejo sirve a bancos fuera de Uruguay, y el aviso de rechazo del artículo 16 se transmite al
 * banco presentador —que puede estar en Colombo— y tiene que decirle cosas concretas. Un aviso
 * que invoca «No está en el paquete · 2 originales» no le dice nada a quien lo recibe, y el 16(c)
 * exige que cada discrepancia esté expresada: si el destinatario no la entiende, no está expresada.
 *
 * La alternativa era traducir el motor, pero `presentacion.ts` se mantiene en paridad con romai a
 * propósito (ver CLAUDE.md) y ahí el español es lo correcto. Así que la traducción es una capa: el
 * mismo motor, dos presentaciones.
 *
 * **Lo que va entre comillas no se traduce nunca.** Es cita literal de lo que dice el documento o
 * el crédito, y un aviso de rechazo que reescribiera lo que el papel dice sería inservible: el
 * banco presentador tiene que poder buscar esa frase exacta en su propio juego.
 */

/**
 * Los reemplazos.
 *
 * Se aplican **de lo más específico a lo más general**, y ese orden no depende de cómo estén
 * escritos acá: lo calcula `PorEspecificidad`. Al principio el orden era el de escritura y bastó
 * agregar una sección abajo para que una palabra suelta —«beneficiario» por «beneficiary»— actuara
 * antes que la frase que la contenía y la dejara mitad traducida. Ordenar por especificidad quita
 * esa trampa de una vez, en vez de pedirle a quien agregue un patrón que adivine dónde ponerlo.
 */
const REEMPLAZOS: [RegExp, string][] = [
  // ── las frases enteras, antes que cualquier palabra suelta ──
  // ── valores que el parser escribe en castellano y se muestran tal cual ──
  [/^(\d+) días desde la fecha de embarque \(campo 48\)$/g, "$1 days from the date of shipment (field 48)"],
  [/^(\d+) originales$/g, "$1 originals"],
  [/^(\d+) originales \+ (\d+) copias$/g, "$1 originals + $2 copies"],
  [/^sin cantidad indicada$/g, "no number stated"],
  // ── qué documento es este (ISBP 821 C1) ──
  [/^El documento es una factura comercial$/g, "The document is a commercial invoice"],
  [/^el título de la factura$/g, "the heading of the invoice"],
  [
    /^no se leyó el título de la factura en el documento: verificar a mano$/g,
    "the heading of the invoice was not read on the document: check by hand",
  ],
  [/^se titula "([^"]*)"$/g, 'it is headed "$1"'],
  [
    /^una factura proforma no satisface la exigencia de factura comercial \(ISBP 821 C1\)$/g,
    "a proforma invoice does not satisfy a requirement for a commercial invoice (ISBP 821 C1)",
  ],
  [
    /^una factura provisional no satisface la exigencia de factura comercial \(ISBP 821 C1\)$/g,
    "a provisional invoice does not satisfy a requirement for a commercial invoice (ISBP 821 C1)",
  ],
  // ── la aplicación de las UCP (art. 1) ──
  [/^El crédito se declara sujeto a las UCP 600$/g, "The credit states that it is subject to UCP 600"],
  [/^El crédito excluye o modifica una regla de las UCP$/g, "The credit excludes or modifies a rule of the UCP"],
  [
    /^el crédito no dice expresamente estar sujeto a las UCP: este examen las aplica igual, verificar si corresponde$/g,
    "the credit does not expressly state that it is subject to the UCP: this examination applies them all the same, check whether that is right",
  ],
  [/^el campo 40E dice /g, "field 40E states "],
  [
    / y no menciona las UCP: verificar con qué reglas corresponde examinar$/g,
    " and does not mention the UCP: check under which rules this should be examined",
  ],
  [
    /: este examen aplica las UCP 600 y el crédito nombra otra revisión$/g,
    ": this examination applies UCP 600 and the credit names another revision",
  ],
  [
    / — el examen aplica esa regla igual: verificar a mano qué cambia$/g,
    " — the examination applies that rule all the same: check by hand what changes",
  ],
  // ── los embarques por cuotas (UCP 600 art. 32) ──
  [
    /^Las cuotas anteriores se embarcaron dentro de su período$/g,
    "The earlier instalments were shipped within their period",
  ],
  [/^El crédito parece estipular embarques por cuotas$/g, "The credit appears to stipulate shipment by instalments"],
  [
    /^el calendario de cuotas no está cargado: verificarlo a mano, porque una cuota no embarcada en su período deja el crédito sin disponibilidad para esa y para las siguientes$/g,
    "the schedule of instalments is not on file: check it by hand, because an instalment not shipped within its period leaves the credit unavailable for that one and for those that follow",
  ],
  [
    /^(\\d+) cuota\\(s\\) vencida\\(s\\), todas embarcadas en su período$/g,
    "$1 instalment(s) past their period, all shipped within it",
  ],
  [
    /^la cuota (.+) no se embarcó dentro de su período: el crédito deja de estar disponible para esa y para toda cuota posterior$/g,
    "instalment $1 was not shipped within its period: the credit ceases to be available for that one and for any subsequent instalment",
  ],
  // ── el documento de seguro armado (UCP 600 art. 28): plantillas, no literales ──
  [/^el documento se presenta como /g, "the document presents itself as "],
  [/^Cobertura de al menos el (\d+) % que exige el crédito$/g, "Cover of at least the $1 % the credit requires"],
  [/^Seguro en la moneda del crédito/g, "Insurance in the currency of the credit"],
  [/^asegurado /g, "insured "],
  [/ · mínimo exigible /g, " · minimum required "],
  [/^cubre de /g, "it covers from "],
  [/ · el crédito pide de /g, " · the credit calls for cover from "],
  [/^seguro (.+) · embarque /g, "insurance $1 · shipment "],
  [
    / — el documento menciona una cobertura efectiva: si corre desde una fecha no posterior al embarque, el artículo lo admite; verificarlo a mano$/g,
    " — the document mentions an effective cover: if it runs from a date not later than shipment, the article admits it; check it by hand",
  ],
  // ── la revisión de emisión y los avisos de lectura del examen base ──
  [
    /^«about» sobre el importe significa ±10 %, no una aproximación a criterio$/g,
    "'about' on the amount means ±10 %, not an approximation left to judgement",
  ],
  [
    /^«freight forwarder's B\/L not acceptable» no dice nada sobre cómo debe emitirse el documento y se descarta$/g,
    "'freight forwarder's B/L not acceptable' says nothing about how the document is to be issued and is disregarded",
  ],
  [
    /^«third party documents not acceptable» no tiene significado y se descarta$/g,
    "'third party documents not acceptable' has no meaning and is disregarded",
  ],
  [
    /^Condición administrativa del banco: su incumplimiento no es motivo de rechazo$/g,
    "An administrative condition of the bank: failing it is not a ground for refusal",
  ],
  [
    /^Condición que ningún documento acredita: los bancos la tienen por no puesta$/g,
    "A condition no document evidences: banks deem it as not stated",
  ],
  [/^Dirección del beneficiario en los documentos propios$/g, "The beneficiary's address on its own documents"],
  [/^El crédito no dice con qué banco está disponible$/g, "The credit does not state with which bank it is available"],
  [
    /^El crédito no dice si es a la vista, a plazo, por aceptación o por negociación$/g,
    "The credit does not state whether it is available by sight payment, deferred payment, acceptance or negotiation",
  ],
  [
    /^El crédito no enumera los documentos que hay que presentar$/g,
    "The credit does not list the documents to be presented",
  ],
  [/^El crédito no fija fecha de vencimiento$/g, "The credit sets no expiry date"],
  [
    /^El crédito no fija plazo de presentación: rigen 21 días desde el embarque$/g,
    "The credit sets no period for presentation: 21 days after shipment apply",
  ],
  [
    /^El crédito parece estar disponible por giro sobre el ordenante$/g,
    "The credit appears to be available by a draft drawn on the applicant",
  ],
  [
    /^El mensaje dice que el crédito operativo todavía no es este$/g,
    "The message states that this is not yet the operative credit",
  ],
  [
    /^El último día de embarque es posterior al vencimiento del crédito$/g,
    "The latest shipment date falls after the expiry of the credit",
  ],
  [/^Esto es un pre-aviso, no el crédito operativo$/g, "This is a pre-advice, not the operative credit"],
  [
    /^Se exige un documento que emite o firma el propio ordenante$/g,
    "A document issued or signed by the applicant itself is required",
  ],
  [
    /^Se prohíbe el transbordo pero la carga va en contenedor: el documento que lo indique se acepta igual$/g,
    "Transhipment is prohibited but the goods travel in a container: a document showing it is acceptable all the same",
  ],
  [
    /^Se prohíbe el transbordo: el artículo 20\(c\) admite igual algunos casos$/g,
    "Transhipment is prohibited: article 20 (c) admits some cases all the same",
  ],
  [/^Una condición depende de un acto del ordenante$/g, "A condition depends on an act of the applicant"],
  [/^acordarla fuera del crédito$/g, "agree it outside the credit"],
  [/^decir con qué documento se comprueba, o sacarla$/g, "state which document evidences it, or remove it"],
  [
    /^deja el cobro a su voluntad: conviene reemplazarla por un documento de un tercero$/g,
    "it leaves payment at their discretion: better to replace it with a third party document",
  ],
  [
    /^deja el cobro del beneficiario a voluntad del comprador: conviene no pedirlo$/g,
    "it leaves the beneficiary's payment at the buyer's discretion: better not to require it",
  ],
  [
    /^el emisor queda obligado a emitir el crédito operativo sin demora y en términos no inconsistentes con este aviso, pero hasta que llegue no hay contra qué examinar$/g,
    "the issuing bank is bound to issue the operative credit without delay and in terms not inconsistent with this advice, but until it arrives there is nothing to examine against",
  ],
  [/^escribir una sola, o decir expresamente que valen todas$/g, "write only one, or state expressly that all apply"],
  [
    /^fijarlo si se quiere otro, y verificar que entre antes del vencimiento$/g,
    "set one if another is wanted, and check that it falls before expiry",
  ],
  [
    /^indicar el banco, o «any bank» si es libremente negociable$/g,
    "name the bank, or 'any bank' if it is freely negotiable",
  ],
  [
    /^indicarlo: sin eso el beneficiario no sabe cómo cobra$/g,
    "state it: without that the beneficiary does not know how it gets paid",
  ],
  [/^la factura no cita la proforma$/g, "the invoice does not quote the proforma"],
  [
    /^la ventana real es más corta que el plazo escrito: conviene correr el vencimiento$/g,
    "the real window is shorter than the period written: better to move the expiry date",
  ],
  [/^no se leyó el consignee$/g, "the consignee was not read"],
  [/^no se leyó el notify$/g, "the notify party was not read"],
  [/^no se leyó la marca de flete$/g, "the freight marking was not read"],
  [/^no se leyó un flete desglosado en la factura$/g, "no itemised freight was read on the invoice"],
  [
    /^no se puede emitir así: el giro va sobre un banco$/g,
    "it cannot be issued this way: the draft is drawn on a bank",
  ],
  [/^nombrar al emisor si se quiere uno determinado$/g, "name the issuer if a particular one is wanted"],
  [
    /^para que la prohibición tenga efecto hay que excluir expresamente el sub-artículo 20\(c\)$/g,
    "for the prohibition to take effect, sub-article 20 (c) has to be expressly excluded",
  ],
  [
    /^quien embarque sobre la fecha no llega a presentar: adelantar el embarque o correr el vencimiento$/g,
    "whoever ships close to the date will not make the presentation: bring shipment forward or move the expiry date",
  ],
  [/^sacarlo o redactarlo como una exigencia concreta$/g, "remove it or word it as a concrete requirement"],
  [
    /^si se quiere otra tolerancia, indicarla en el campo 39A$/g,
    "if another tolerance is wanted, state it in field 39A",
  ],
  [/^sin documentos exigidos no hay presentación posible$/g, "with no documents required there can be no presentation"],
  [/^toda carta de crédito tiene que indicar una$/g, "every documentary credit has to state one"],
  [
    /^un teletransmitido es el crédito operativo salvo que anuncie que los detalles siguen o que el operativo será la confirmación por correo: esperar el instrumento que sí lo sea$/g,
    "a teletransmission is the operative credit unless it announces that details are to follow or that the mail confirmation will be the operative one: wait for the instrument that is",
  ],
  // ── el vencimiento en un día en que el banco está cerrado (UCP 600 art. 29) ──
  [
    /^El último día de embarque no se corre aunque el vencimiento sí$/g,
    "The latest shipment date is not extended even where the expiry date is",
  ],
  [
    /, el primer día hábil después del vencimiento: si el banco estuvo cerrado el /g,
    ", the first banking day after expiry: if the bank was closed on ",
  ],
  [
    /, el artículo 29 \(a\) lo extiende hasta este día — verificar el calendario de la plaza$/g,
    ", article 29 (a) extends it to this day — check the calendar of that place",
  ],
  // ── el documento no exigido (UCP 600 art. 14 g) ──
  [
    /^el crédito no lo pide, así que no se examina ni se compara contra los demás; puede devolverse al presentador$/g,
    "the credit does not call for it, so it is neither examined nor compared against the others; it may be returned to the presenter",
  ],
  [
    /: presentado pero no exigido por el crédito, se desestima$/g,
    ": presented but not required by the credit, it is disregarded",
  ],
  // ── valores que no tienen la forma de su campo: la maqueta del documento se corrió ──
  [/: hay valores que no tienen la forma de su campo$/g, ": some values do not have the shape of their field"],
  [
    /En un documento maquetado en columnas esto es la señal de que los valores quedaron corridos contra la etiqueta de al lado — hay que mirar la hoja\. Es lo que el banco observó de los certificados en AMS2026164\./g,
    "In a document laid out in columns this is the sign that the values ended up shifted against the label next to them — the sheet itself has to be looked at. It is what the bank observed on the certificates in AMS2026164.",
  ],
  [/ dice «/g, " states «"],
  [/» y no tiene una sola cifra: no es una fecha/g, "» and has not a single digit: it is not a date"],
  [/» y no tiene una sola cifra: no es una cantidad/g, "» and has not a single digit: it is not a quantity"],
  [/» y es una fecha/g, "» and is a date"],
  [/» y es un número/g, "» and is a number"],
  /* Y los motivos sueltos: el examen los usa pegados al valor —«… dice «X» y es una fecha»— pero
     la cobertura de inglés los mira uno por uno, como están escritos en el módulo. */
  [/^no tiene una sola cifra: no es una fecha$/g, "has not a single digit: it is not a date"],
  [/^no tiene una sola cifra: no es una cantidad$/g, "has not a single digit: it is not a quantity"],
  [/^es una fecha$/g, "is a date"],
  [/^es un número$/g, "is a number"],
  [/^Fecha del documento$/g, "Date of the document"],
  [/^Fecha del seguro$/g, "Date of the insurance document"],
  [/^Cobertura desde$/g, "Cover from"],
  [/^Cobertura hasta$/g, "Cover to"],
  // ── lo que el crédito no exige y por lo tanto no se dictamina (UCP 600 art. 14 a) ──
  [/^A nombre de quién va el documento de transporte$/g, "Whom the transport document is made out to"],
  [/^Marca de flete del documento de transporte$/g, "Freight marking on the transport document"],
  [
    /^el crédito no dice a nombre de quién y el documento dice /g,
    "the credit does not say whom it is to be made out to and the document states ",
  ],
  [
    /^el crédito no dice a nombre de quién y no se leyó el consignatario: verificar a mano$/g,
    "the credit does not say whom it is to be made out to and the consignee was not read: check by hand",
  ],
  [
    /^el crédito no pide una marca de flete y el documento dice /g,
    "the credit does not call for a freight marking and the document states ",
  ],
  [/: verificar contra el incoterm de la venta$/g, ": check it against the term of delivery of the sale"],
  // ── quién emite y quién embarca (UCP 600 arts. 18 a i y 14 k) ──
  [/^La factura la emite el beneficiario$/g, "The commercial invoice is issued by the beneficiary"],
  [/^quién emite la factura$/g, "who issues the invoice"],
  [
    /^El embarcador del documento de transporte no tiene que ser el beneficiario$/g,
    "The shipper on the transport document need not be the beneficiary",
  ],
  [/^la factura dice /g, "the invoice states "],
  [
    / y no se leyó el beneficiario del crédito: verificar a mano$/g,
    " and the beneficiary of the credit was not read: check by hand",
  ],
  [/ y el crédito nombra beneficiario a /g, " and the credit names as beneficiary "],
  [/^el documento de transporte dice /g, "the transport document states "],
  [/ y el beneficiario es /g, " and the beneficiary is "],
  [/: el artículo 14 \(k\) admite que no coincidan$/g, ": article 14 (k) admits that they do not match"],
  // ── la vigencia de una enmienda (UCP 600 art. 10) ──
  [
    /^La enmienda trae una cláusula de aceptación por silencio, y esa cláusula se desestima$/g,
    "The amendment contains a clause deeming it accepted by silence, and that clause is disregarded",
  ],
  [
    /^el artículo la deja sin efecto: la enmienda no entra en vigor por el paso del tiempo, solo si el beneficiario la acepta\. Quien la escribió puede estar contando un plazo que no existe$/g,
    "the article leaves it without effect: the amendment does not come into force by the passing of time, only if the beneficiary accepts it. Whoever wrote it may be counting on a period that does not exist",
  ],
  [
    /^Una aceptación parcial de la enmienda vale como rechazo$/g,
    "Partial acceptance of the amendment counts as rejection",
  ],
  [
    /^no existe un crédito a medio enmendar: o se acepta entera o rigen los términos anteriores$/g,
    "there is no half-amended credit: either it is accepted in full or the previous terms govern",
  ],
  [
    /^Los documentos se examinan contra el crédito original, no contra el enmendado$/g,
    "The documents are examined against the original credit, not against the amended one",
  ],
  [
    /^los términos originales siguen rigiendo para el beneficiario hasta que comunique que acepta la enmienda; el emisor sí quedó obligado desde que la emitió \(10 b\)$/g,
    "the original terms remain in force for the beneficiary until it communicates its acceptance of the amendment; the issuing bank, by contrast, has been bound since it issued it (10 b)",
  ],
  [/^el beneficiario ya había comunicado que la aceptaba$/g, "the beneficiary had already communicated its acceptance"],
  [
    /^la enmienda fue rechazada; una presentación conforme no la vuelve a poner en juego$/g,
    "the amendment was rejected; a complying presentation does not bring it back into play",
  ],
  [
    /^sin notificación previa, una presentación que cumple con el crédito y con la enmienda vale como aceptación \(UCP 600 10 c\): desde ese momento el crédito queda enmendado$/g,
    "with no prior notification, a presentation that complies with the credit and with the amendment counts as acceptance (UCP 600 10 c): from that moment the credit stands amended",
  ],
  [
    /^los documentos no cumplen con el crédito original, que es el que rige para el beneficiario mientras no acepte la enmienda$/g,
    "the documents do not comply with the original credit, which is the one in force for the beneficiary until it accepts the amendment",
  ],
  [
    /^los documentos cumplen con el crédito original pero no con la enmienda, así que no la aceptan$/g,
    "the documents comply with the original credit but not with the amendment, so they do not accept it",
  ],
  // ── el back-to-back (`back-to-back.ts`): práctica bancaria, no un artículo ──
  [/^Los dos créditos vencen el mismo día$/g, "Both credits expire on the same day"],
  [
    /^El crédito que se emite vence después del crédito recibido$/g,
    "The credit to be issued expires after the credit received",
  ],
  [
    /^no queda margen para sustituir la factura y presentar contra el crédito recibido: el banco paga el segundo y llega tarde al primero$/g,
    "there is no margin left to substitute the invoice and present under the credit received: the bank pays the second and arrives late on the first",
  ],
  [
    /^el banco paga el segundo crédito cuando el primero ya venció, y se queda sin de dónde cobrar$/g,
    "the bank pays the second credit once the first has expired, and is left with nothing to collect against",
  ],
  [
    /^El último embarque del crédito que se emite es posterior al del recibido$/g,
    "The latest shipment date of the credit to be issued is later than that of the credit received",
  ],
  [
    /^el proveedor puede embarcar a tiempo contra el segundo crédito y tarde contra el primero: los documentos cumplen para pagar y no para cobrar$/g,
    "the supplier may ship in time under the second credit and late under the first: the documents comply for paying and not for collecting",
  ],
  [
    /^El plazo de presentación del crédito que se emite es mayor que el del recibido$/g,
    "The period for presentation of the credit to be issued is longer than that of the credit received",
  ],
  [
    /^los documentos del proveedor pueden llegar dentro de plazo para el segundo crédito y fuera de plazo para el primero$/g,
    "the supplier's documents may arrive within the period for the second credit and outside it for the first",
  ],
  [
    /^El crédito que se emite es por más que el recibido$/g,
    "The credit to be issued is for more than the one received",
  ],
  [/^Los dos créditos están en monedas distintas$/g, "The two credits are in different currencies"],
  [
    /^el banco paga en una moneda y cobra en otra: el riesgo de cambio entre una fecha y la otra queda de su lado$/g,
    "the bank pays in one currency and collects in another: the exchange risk between the two dates is on its side",
  ],
  [
    /^no descubre a nadie: es trabajo y costo que el proveedor va a cobrar, para un papel que después no hay que presentar$/g,
    "it leaves nobody exposed: it is work and cost the supplier will charge for, on a document that does not have to be presented afterwards",
  ],
  [
    /^El crédito recibido no permite embarques parciales y el que se emite sí$/g,
    "The credit received does not allow partial shipments and the one to be issued does",
  ],
  [
    /^el proveedor puede embarcar por partes y cobrar cada una, y esos embarques no se pueden presentar contra el primero$/g,
    "the supplier may ship in parts and collect on each, and those shipments cannot be presented under the first credit",
  ],
  [/^Práctica bancaria$/g, "Banking practice"],
  // ── art. 13: el reembolso entre bancos ──
  [
    /^El crédito nombra un banco reembolsador y no dice si el reembolso se sujeta a las URR$/g,
    "The credit names a reimbursing bank and does not state whether reimbursement is subject to the URR",
  ],
  [
    /^indicar en el 78 o en las condiciones si rigen las URR 725; sin eso rige el 13 \(b\): la autorización no puede llevar vencimiento, no se puede exigir certificado de cumplimiento al reembolsador, y el emisor reembolsa igual si el reembolsador no paga a primer requerimiento$/g,
    "state in field 78 or in the conditions whether URR 725 applies; without that, 13 (b) governs: the authorisation may not carry an expiry date, no certificate of compliance may be required of the reimbursing bank, and the issuing bank reimburses anyway if the reimbursing bank does not pay on first demand",
  ],
  [
    /^El crédito exige un certificado de cumplimiento para cobrarle al banco reembolsador$/g,
    "The credit requires a certificate of compliance in order to claim on the reimbursing bank",
  ],
  [
    /^sacarlo: el artículo dice que al banco que reclama no se le puede exigir ese certificado, así que el banco designado que acepte la designación quedaría esperando un reembolso que depende de un papel que nadie tiene que darle$/g,
    "take it out: the article says the claiming bank may not be required to supply that certificate, so a nominated bank that accepts the nomination would be waiting on a reimbursement that depends on a document nobody has to give it",
  ],
  /*
   * ── qué papel juega el banco que examina (arts. 7, 8, 9, 12, 35) ──
   *
   * Estos son los hallazgos que más importa que estén en inglés: le dicen a un banco si tiene que
   * pagar, si puede pagar sin estar obligado, o si lo suyo es solo avisar.
   */
  [/^52A: el crédito lo emite este banco$/g, "52A: this bank issued the credit"],
  [/^41A: el crédito está disponible con este banco$/g, "41A: the credit is available with this bank"],
  [/^57A: el crédito se avisa a través de este banco$/g, "57A: the credit is advised through this bank"],
  [
    /^el crédito no nombra a este banco en ninguno de sus campos de banco$/g,
    "the credit does not name this bank in any of its bank fields",
  ],
  [
    /^Este banco emitió el crédito, así que tiene que honrar una presentación conforme$/g,
    "This bank issued the credit, so it must honour a complying presentation",
  ],
  [/^Este banco emitió el crédito$/g, "This bank issued the credit"],
  [
    /^Este banco confirmó el crédito, así que tiene que honrar o negociar y remitir los documentos$/g,
    "This bank confirmed the credit, so it must honour or negotiate and forward the documents",
  ],
  [/^Este banco confirmó el crédito$/g, "This bank confirmed the credit"],
  [
    /^Este banco está designado y no confirmó: puede honrar, pero no está obligado$/g,
    "This bank is nominated and did not confirm: it may honour, but it is not obliged to",
  ],
  [
    /^Este banco avisa el crédito y no asume compromiso de honrar$/g,
    "This bank advises the credit and undertakes no obligation to honour",
  ],
  [/^El crédito no nombra a este banco$/g, "The credit does not name this bank"],
  [
    /^El crédito designa sin nombrar un banco: verificar si este banco está incluido$/g,
    "The credit nominates without naming a bank: check whether this bank is included",
  ],
  [
    /^El crédito pide agregar la confirmación: si este banco la agregó, tiene que honrar$/g,
    "The credit asks for confirmation to be added: if this bank added it, it must honour",
  ],
  [
    /^Si los documentos se pierden en el camino, este examen es lo que cubre al banco$/g,
    "If the documents are lost in transit, this examination is what covers the bank",
  ],
  [
    /^— y quedó irrevocablemente obligado desde que lo emitió \(7 b\)$/g,
    " — and it became irrevocably bound as of the time it issued it (7 b)",
  ],
  [
    /^la presentación tiene discrepancias o documentos faltantes, así que no hay obligación de honrar: lo que sigue es el aviso del artículo 16$/g,
    "the presentation has discrepancies or missing documents, so there is no obligation to honour: what follows is the article 16 notice",
  ],
  [
    /^determinada la conformidad y remitidos los documentos, el emisor o el confirmador tiene que honrar o reembolsar aunque el juego se pierda en el tránsito: conviene que quede asentado qué se examinó y cuándo$/g,
    "once compliance is determined and the documents forwarded, the issuing or confirming bank must honour or reimburse even if the set is lost in transit: it is worth having on record what was examined and when",
  ],
  [
    /^el campo 49 pide confirmación, y agregarla es una decisión de este banco que no consta en el expediente: con la confirmación agregada rige el artículo 8 \(a\) y no el 12 \(a\)$/g,
    "field 49 asks for confirmation, and adding it is a decision of this bank that the file does not record: with the confirmation added, article 8 (a) governs and not 12 (a)",
  ],
  // ── el pre-aviso contra el crédito operativo (art. 11 b) ──
  [/^Monto del crédito$/g, "Credit amount"],
  [/^Moneda del crédito$/g, "Credit currency"],
  [
    /^el crédito operativo es por menos de lo anunciado: el beneficiario pudo haber producido contra el monto del pre-aviso$/g,
    "the operative credit is for less than was pre-advised: the beneficiary may have produced against the pre-advised amount",
  ],
  [
    /^el crédito operativo es por más de lo anunciado: es inconsistente con el pre-aviso, aunque no lo perjudica$/g,
    "the operative credit is for more than was pre-advised: inconsistent with the pre-advice, though not to the beneficiary's detriment",
  ],
  [
    /^el crédito operativo está en otra moneda que la anunciada, y el riesgo de cambio no era el que el beneficiario tomó$/g,
    "the operative credit is in a different currency from the one pre-advised, and the exchange risk is not the one the beneficiary took on",
  ],
  [
    /^el crédito operativo vence antes de lo anunciado: el beneficiario tiene menos tiempo para presentar que el que planificó$/g,
    "the operative credit expires earlier than pre-advised: the beneficiary has less time to present than it planned for",
  ],
  [
    /^el crédito operativo exige embarcar antes de lo anunciado: el beneficiario pudo haber programado la producción contra la fecha del pre-aviso$/g,
    "the operative credit requires shipment earlier than pre-advised: the beneficiary may have scheduled production against the pre-advised date",
  ],
  [
    /^el crédito operativo da una fecha distinta de la anunciada: es inconsistente con el pre-aviso, aunque no lo perjudica$/g,
    "the operative credit gives a different date from the one pre-advised: inconsistent with the pre-advice, though not to the beneficiary's detriment",
  ],
  [
    /^el crédito operativo da menos días para presentar que los anunciados$/g,
    "the operative credit gives fewer days to present than were pre-advised",
  ],
  [
    /^el crédito operativo da más días para presentar que los anunciados: es inconsistente, aunque no lo perjudica$/g,
    "the operative credit gives more days to present than were pre-advised: inconsistent, though not to the beneficiary's detriment",
  ],
  [
    /^el crédito operativo está a favor de otro beneficiario que el anunciado: quien produjo contra el pre-aviso no es quien va a poder cobrar$/g,
    "the operative credit is in favour of a different beneficiary from the one pre-advised: whoever produced against the pre-advice is not who will be able to be paid",
  ],
  // ── art. 33: lo recibido fuera del horario cuenta como del día hábil siguiente ──
  [
    /^Lo recibido fuera del horario cuenta como presentado el día hábil siguiente$/g,
    "Anything received outside banking hours counts as presented on the next banking day",
  ],
  [
    /^entregada a las (.+) y el banco atiende hasta las (.+): cuenta como presentada el (.+)$/g,
    "delivered at $1 and the bank is open until $2: it counts as presented on $3",
  ],
  [
    /^no se cargó el horario de atención del banco: verificar que el juego haya llegado dentro de él, porque fuera del horario cuenta como presentado el día siguiente$/g,
    "the bank's banking hours have not been loaded: check that the set arrived within them, because outside banking hours it counts as presented the next day",
  ],
  [
    /^el banco atiende hasta las (.+) y no se cargó la hora del sello de recepción: ese dato decide si este juego llegó en plazo$/g,
    "the bank is open until $1 and the time on the receipt stamp was not entered: that is what decides whether this set arrived in time",
  ],
  [
    /^recibida a las (.+) y el banco atiende hasta las (.+): cuenta como presentada el (.+)$/g,
    "received at $1 and the bank is open until $2: it counts as presented on $3",
  ],
  [
    /^recibida el (.+) a las (.+), fuera del horario, así que cuenta como presentada el (.+): (\d+) días? después del vencimiento$/g,
    "received on $1 at $2, outside banking hours, so it counts as presented on $3: $4 day(s) after expiry",
  ],
  [
    /^entregada el (.+) fuera del horario, así que cuenta como presentada el (.+): (\d+) días? después del vencimiento$/g,
    "delivered on $1 outside banking hours, so it counts as presented on $2: $3 day(s) after expiry",
  ],
  // ── las condiciones del 47A que el examen no verifica ──
  [/^Que se cumpla la condición del crédito: «(.+)»$/g, "That the credit's condition is met: «$1»"],
  [
    /^es una condición documentaria que el motor no sabe verificar, así que no está examinada: leerla contra los papeles presentados$/g,
    "it is a documentary condition the engine cannot check, so it has not been examined: read it against the documents presented",
  ],
  // el aviso a la aseguradora del 47A
  [
    /^Que se haya avisado el embarque a la aseguradora dentro de (\d+) días y que el certificado que lo acredita esté presentado$/g,
    "That shipment was advised to the insurers within $1 days and that the certificate evidencing it is presented",
  ],
  [
    /^el aviso se manda fuera del juego de documentos, así que el motor no puede saber si salió ni cuándo; la condición nombra la póliza (.+)$/g,
    "the advice is sent outside the set of documents, so the engine cannot know whether it went out or when; the condition names policy $1",
  ],
  [
    /^el aviso se manda fuera del juego de documentos, así que el motor no puede saber si salió ni cuándo$/g,
    "the advice is sent outside the set of documents, so the engine cannot know whether it went out or when",
  ],
  [
    /^El crédito recibido exige (\\d+) documentos? que el que se emite no pide$/g,
    "The credit received requires $1 document(s) that the one to be issued does not ask for",
  ],
  [/^hay que conseguirlos aparte del proveedor —/g, "they have to be obtained apart from the supplier — "],
  [
    /— o el juego no sirve para cobrar contra el primero$/g,
    " — or the set is no good for collecting under the first credit",
  ],
  [
    /^El crédito que se emite pide (\\d+) documentos? de más$/g,
    "The credit to be issued asks for $1 document(s) more than needed",
  ],
  [/^el banco pagaría /g, "the bank would pay "],
  [
    / más de lo que puede cobrar contra el primero, y esa diferencia es suya$/g,
    " more than it can collect under the first credit, and that difference is its own",
  ],
  // ── el crédito transferido (UCP 600 art. 38) ──
  [
    /^el crédito se declara transferible \(UCP 600 art\. 38 b\)$/g,
    "the credit states that it is transferable (UCP 600 art. 38 b)",
  ],
  [
    /^el crédito no se declara transferible: solo lo es el que lo dice expresamente \(UCP 600 art\. 38 b\)$/g,
    "the credit does not state that it is transferable: only a credit that says so expressly is (UCP 600 art. 38 b)",
  ],
  [
    /^El importe del crédito transferido es mayor que el del original$/g,
    "The amount of the transferred credit is greater than that of the original",
  ],
  [
    /^el importe puede reducirse, nunca aumentarse: por la diferencia el emisor no responde y el banco transferente queda descubierto$/g,
    "the amount may be reduced, never increased: the issuing bank does not answer for the difference and the transferring bank is left exposed",
  ],
  [
    /^El vencimiento del crédito transferido es posterior al del original$/g,
    "The expiry date of the transferred credit is later than that of the original",
  ],
  [
    /^el vencimiento puede acortarse, no estirarse: el segundo beneficiario podría presentar cuando el crédito original ya venció$/g,
    "the expiry date may be curtailed, not extended: the second beneficiary could present after the original credit has expired",
  ],
  [
    /^El último embarque del crédito transferido es posterior al del original$/g,
    "The latest shipment date of the transferred credit is later than that of the original",
  ],
  [
    /^puede acortarse, no estirarse: un embarque a tiempo contra el transferido llegaría tarde contra el original$/g,
    "it may be curtailed, not extended: a shipment in time under the transferred credit would be late under the original",
  ],
  [
    /^El plazo de presentación del crédito transferido es mayor que el del original$/g,
    "The period for presentation of the transferred credit is longer than that of the original",
  ],
  [
    /^puede acortarse, no estirarse: los documentos llegarían al emisor fuera del plazo que él fijó$/g,
    "it may be curtailed, not extended: the documents would reach the issuing bank outside the period it set",
  ],
  [
    /^La cobertura de seguro del crédito transferido es menor que la del original$/g,
    "The insurance cover of the transferred credit is lower than that of the original",
  ],
  [
    /^el porcentaje puede aumentarse, no reducirse: sobre un importe menor hace falta más porcentaje para llegar a la cobertura que el crédito exige$/g,
    "the percentage may be increased, not reduced: on a lower amount a higher percentage is needed to reach the cover the credit requires",
  ],
  [
    /^El banco emisor difiere entre el crédito original y el transferido$/g,
    "The issuing bank differs between the original and the transferred credit",
  ],
  [
    /^el transferido es el mismo crédito puesto a disposición de otro beneficiario, no uno nuevo$/g,
    "the transferred credit is the same credit made available to another beneficiary, not a new one",
  ],
  [
    /^La moneda difiere entre el crédito original y el transferido$/g,
    "The currency differs between the original and the transferred credit",
  ],
  [
    /^la moneda no está entre lo que el artículo deja cambiar$/g,
    "the currency is not among what the article allows to change",
  ],
  [
    /^Los documentos exigidos difieren entre el crédito original y el transferido$/g,
    "The documents required differ between the original and the transferred credit",
  ],
  [
    /^el segundo beneficiario presentaría un juego que el crédito original no cubre, o le faltaría uno que el emisor va a pedir$/g,
    "the second beneficiary would present a set the original credit does not cover, or would be missing one the issuing bank will ask for",
  ],
  [
    /^La tolerancia difiere entre el crédito original y el transferido$/g,
    "The tolerance differs between the original and the transferred credit",
  ],
  [
    /^la lista del artículo es cerrada y la tolerancia no está en ella: tiene que reflejarse tal cual$/g,
    "the list in the article is closed and the tolerance is not in it: it has to be reflected as it stands",
  ],
  [
    /^El crédito exige el nombre del ordenante en un documento que no es la factura, y el transferido no lo refleja$/g,
    "The credit requires the applicant's name on a document other than the invoice, and the transferred credit does not reflect it",
  ],
  [
    /^sustituir el nombre del ordenante está permitido, pero esa exigencia no: el segundo beneficiario emitiría el documento con el nombre equivocado$/g,
    "substituting the applicant's name is allowed, but that requirement is not: the second beneficiary would issue the document with the wrong name",
  ],
  [
    /^Se transfiere a más de un segundo beneficiario y el crédito no permite embarques parciales$/g,
    "The credit is transferred to more than one second beneficiary and it does not allow partial shipments",
  ],
  [
    /^cada segundo beneficiario embarcaría su parte, que es un embarque parcial: el artículo lo admite solo si el crédito los permite$/g,
    "each second beneficiary would ship its part, which is a partial shipment: the article admits this only where the credit allows them",
  ],
  [
    /^El crédito que se quiere transferir ya es un crédito transferido$/g,
    "The credit to be transferred is itself a transferred credit",
  ],
  [
    /^un transferido no puede transferirse otra vez a pedido del segundo beneficiario; el primer beneficiario no cuenta como beneficiario posterior$/g,
    "a transferred credit cannot be transferred again at the request of the second beneficiary; the first beneficiary does not count as a subsequent beneficiary",
  ],
  // ── etiquetas y avisos heredados de romai que también se muestran acá ──
  [/^Emisor \/ shipper$/g, "Issuer / shipper"],
  /*
   * Los nombres de campo que el cotejo del pre-aviso usa, anclados.
   *
   * «Vencimiento» y «Beneficiario» sueltos no estaban, y la pantalla del pre-aviso salía con la
   * interfaz en inglés y el nombre del campo en castellano. Se vio abriéndola en el navegador: el
   * control de cobertura no los mira porque descarta los literales de menos de doce caracteres sin
   * espacios, y esos dos entran justo ahí.
   */
  [/^Vencimiento$/g, "Expiry"],
  // el nombre del campo de la mercadería, que también se muestra solo
  [/^Mercader[íi]a$/g, "Goods"],
  [/^Beneficiario$/g, "Beneficiary"],
  [/^Beneficiario \/ exportador$/g, "Beneficiary / exporter"],
  [/^Fecha límite de embarque$/g, "Latest date of shipment"],
  [/^Fecha a bordo \(vs\. último embarque LC\)$/g, "On board date (vs. latest shipment in the credit)"],
  [/^Fecha de embarque \(vs\. último embarque LC\)$/g, "Date of shipment (vs. latest shipment in the credit)"],
  [/^Fecha de embarque$/g, "Date of shipment"],
  [/^Número de la LC$/g, "Credit number"],
  [/^±5 % \(por defecto\)$/g, "±5 % (by default)"],
  [/^Certificado del beneficiario$/g, "Beneficiary's certificate"],
  [/^Documentos exigidos por la LC$/g, "Documents required by the credit"],
  [
    /^La LC cargada no tiene el 46A: pegá el SWIFT o cargalos\.$/g,
    "The credit on file has no field 46A: paste the SWIFT message or enter the documents.",
  ],
  [/^sin fecha legible$/g, "no legible date"],
  [/^conocimiento de embarque$/g, "bill of lading"],
  [/^carta de crédito$/g, "letter of credit"],
  [/^el conocimiento$/g, "the bill of lading"],
  [
    / Si se embarca tarde, el banco puede rechazar los documentos y el cobro queda a voluntad del comprador\.$/g,
    " If shipment is late, the bank may refuse the documents and payment is left to the buyer's discretion.",
  ],
  [
    / Corregí el dato que esté mal antes de que el documento salga del sistema\.$/g,
    " Correct whichever figure is wrong before the document leaves the system.",
  ],
  [
    /^Se abre la edición de la operación para ajustar el dato$/g,
    "The transaction opens for editing to adjust the figure",
  ],
  [
    /^Discrepancia marcada como falso positivo \(queda registrado quién y cuándo\)$/g,
    "Discrepancy marked as a false positive (who and when is recorded)",
  ],
  [
    /^El total de bultos tiene que ser el mismo en BL, packing list y factura\.$/g,
    "The total number of packages must be the same on the bill of lading, the packing list and the invoice.",
  ],
  [
    /^El peso bruto del BL tiene que coincidir con el del packing list \/ weight note\.$/g,
    "The gross weight on the bill of lading must agree with that of the packing list or weight note.",
  ],
  [
    /^Cantidades distintas entre documentos \(comparadas en kilos\): la LC puede fijar la contratada y el BL\/packing lo embarcado — dentro de la tolerancia es normal; fuera, discrepancia\.$/g,
    "Quantities differ between documents (compared in kilos): the credit may state the contracted quantity and the bill of lading or packing list what was shipped — within the tolerance this is usual; outside it, a discrepancy.",
  ],
  [
    /^La partida arancelaria tiene que ser la misma en LC, factura, packing, BL y certificado de origen\.$/g,
    "The tariff heading must be the same on the credit, the invoice, the packing list, the bill of lading and the certificate of origin.",
  ],
  /*
   * ── certificados del 46A (ISBP 821 L, Q) ──
   *
   * Estaban enteros sin traducir, y por el mismo motivo que las especificaciones: el producto no
   * ejecutaba el módulo, así que ningún escenario producía estos textos y el test de piezas los
   * saltea por ser plantillas. El nombre de la regla empieza con la exigencia tal como la escribe
   * el crédito —cita del papel— y por eso va en $1 sin tocarse.
   */
  [/^(.+): lo emite (.+)$/g, "$1: issued by $2"],
  [/^(.+): no lo emite el beneficiario$/g, "$1: not issued by the beneficiary"],
  [/^(.+): acredita un hecho anterior al embarque$/g, "$1: evidences a fact predating shipment"],
  [/^(.+): fechado después del embarque$/g, "$1: dated after shipment"],
  [/^(.+): el peso coincide con el packing$/g, "$1: the weight matches the packing list"],
  [/^(.+): el peso coincide con el conocimiento$/g, "$1: the weight matches the bill of lading"],
  [/^(.+): el peso coincide con los demás documentos$/g, "$1: the weight matches the other documents"],
  [/^(.+): la especificación que el crédito exige$/g, "$1: the specification the credit requires"],
  // con el parámetro nombrado en el certificado: «protein que el crédito exige»
  [/^(.+): (.+) que el crédito exige$/g, "$1: the $2 the credit requires"],
  [
    /^(.+): declara lo que el crédito pide \(plazo de (\d+) días\)$/g,
    "$1: states what the credit requires ($2-day period)",
  ],
  [/^(.+): declara lo que el crédito pide$/g, "$1: states what the credit requires"],
  [/^(.+): el archivo parece traer más de un documento$/g, "$1: the file seems to hold more than one document"],
  [/^(.+): indica origen (.+)$/g, "$1: states origin $2"],
  // las citas ya salieron del texto —son huecos— así que el patrón no lleva las comillas
  [
    /^el documento lo emite (.+): verificar que sea el organismo que el crédito nombra$/g,
    "the document is issued by $1: check that this is the body the credit names",
  ],
  [
    /^lo emite el beneficiario (.+) y el crédito nombra a un tercero$/g,
    "it is issued by the beneficiary $1 and the credit names a third party",
  ],
  [/^el documento lo emite (.+)$/g, "the document is issued by $1"],
  [/^el documento dice (.+)$/g, "the document states $1"],
  [
    /^dice (.+) — cotejar el texto con el que exige el crédito$/g,
    "states $1 — compare the wording with the one the credit requires",
  ],
  [
    /^documento (.+) · embarque (.+) — admitido: el crédito no lo pide previo$/g,
    "document $1 · shipment $2 — admitted: the credit does not require it to predate shipment",
  ],
  [
    /^el hecho que acredita es del (.+) · embarque (.+) \(documento (.+)\)$/g,
    "the fact it evidences is dated $1 · shipment $2 (document $3)",
  ],
  [
    /^documento (.+) · embarque (.+) — y no dice cuándo ocurrió lo que acredita$/g,
    "document $1 · shipment $2 — and it does not say when what it evidences took place",
  ],
  [/^documento (.+) · embarque (.+)$/g, "document $1 · shipment $2"],
  [/^nota de peso (.+) kg · el packing (.+) kg$/g, "weight note $1 kg · packing list $2 kg"],
  [/^nota de peso (.+) kg · el conocimiento (.+) kg$/g, "weight note $1 kg · bill of lading $2 kg"],
  [
    /^falta la fecha del certificado o la del embarque para compararlas$/g,
    "the certificate date or the shipment date is missing, so they cannot be compared",
  ],
  // ── certificados: las ramas «no se leyó» ──
  [/^no se leyó el emisor: verificar a mano$/g, "the issuer was not read: check by hand"],
  /*
   * ── especificaciones: la calidad del 45A contra la que el análisis certifica ──
   *
   * Ninguna de estas estaba traducida, y el test de cobertura no las veía: son plantillas con
   * `${}` adentro, que ese test saltea a propósito. Así que el aviso salía mezclado —«the credit
   * pide al menos 54 % y el certificado declara 61,1 %»— justo en el hallazgo que un banco
   * corresponsal tiene que poder leer. Ahora las cubre un escenario de `ingles.test.ts`.
   */
  [
    /^el crédito pide al menos (.+) y el certificado declara (.+)$/g,
    "the credit calls for at least $1 and the certificate states $2",
  ],
  [
    /^el crédito pide como mucho (.+) y el certificado declara (.+)$/g,
    "the credit calls for at most $1 and the certificate states $2",
  ],
  [
    /^el crédito nombra (.+) y el certificado declara lo mismo$/g,
    "the credit names $1 and the certificate states the same",
  ],
  [
    /^el crédito nombra (.+) y el certificado declara (.+); el crédito no dice si es mínimo, máximo o nominal, así que hay que verificarlo contra el contrato$/g,
    "the credit names $1 and the certificate states $2; the credit does not say whether that is a minimum, a maximum or a nominal figure, so it has to be checked against the contract",
  ],
  [
    /^el crédito pide «(.+)» y no se leyó un resultado equivalente en el certificado$/g,
    "the credit calls for «$1» and no equivalent result was read in the certificate",
  ],
  // ── art. 30: la cantidad de la factura contra la del crédito ──
  [
    /^Cantidad de la factura dentro de lo que pide el crédito \((.+)\)$/g,
    "Invoice quantity within what the credit calls for ($1)",
  ],
  [/^Cantidad de la factura dentro de lo que pide el crédito$/g, "Invoice quantity within what the credit calls for"],
  [/^factura (.+) · el crédito pide (.+)$/g, "invoice $1 · the credit calls for $2"],
  [
    /^la factura dice (.+) y el crédito (.+): magnitudes que no se pueden comparar, verificar a mano$/g,
    "the invoice states $1 and the credit $2: these magnitudes cannot be compared, check by hand",
  ],
  [
    /^el crédito pide «(.+)» sin decir de qué parámetro y el certificado declara más de un resultado en (.+): verificar a mano contra cuál se compara$/g,
    "the credit calls for «$1» without saying which parameter and the certificate states more than one result in $2: check by hand which one it is compared against",
  ],
  // el certificado imprimió el renglón del crédito y no el resultado medido
  [
    /^el certificado repite la exigencia «(.+)» pero no se leyó el resultado medido: verificar a mano cuánto declara$/g,
    "the certificate repeats the requirement «$1» but the measured result was not read: check by hand what it states",
  ],
  [/^no se leyó un peso comparable: verificar a mano$/g, "no comparable weight was read: check by hand"],
  [/^no se leyó el origen: verificar a mano$/g, "the origin was not read: check by hand"],
  [
    /^no se leyó el origen; el documento dice (.+): verificar a mano$/g,
    "the origin was not read; the document states $1: check by hand",
  ],
  [
    /^falta la fecha del certificado o la del embarque para compararlas$/g,
    "the date of the certificate or that of shipment is missing, so they cannot be compared",
  ],
  [
    /^leer el texto del certificado y cotejarlo con el que exige el crédito$/g,
    "read the text of the certificate and check it against the one the credit requires",
  ],
  // ── transporte y contrato: los textos que quedaban sueltos ──
  [/^conocimiento de embarque marítimo$/g, "marine bill of lading"],
  [
    /^documento de transporte por carretera, ferrocarril o vía navegable$/g,
    "road, rail or inland waterway transport document",
  ],
  [
    /^no se pudo determinar de qué clase es: no se leyó cómo se titula, ni un buque, ni los lugares$/g,
    "the class of document could not be determined: neither its heading, nor a vessel, nor the places were read",
  ],
  [
    /^puede reclamar por esto, hay que pedirle al ordenante que gestione una enmienda\.$/g,
    "can be claimed from it for this; the applicant has to be asked to arrange an amendment.",
  ],
  [
    / puede reclamar por esto, hay que pedirle al ordenante que gestione una enmienda\.$/g,
    " can be claimed from it for this; the applicant has to be asked to arrange an amendment.",
  ],
  /*
   * ── las variantes «no se leyó» ──
   *
   * Cada regla tiene dos textos: el del veredicto y el de cuando el dato no se leyó. El expediente
   * del caso tiene todos los datos cargados, así que la segunda rama no se generaba nunca en los
   * escenarios y quedaba en castellano. En la vida real es la rama más frecuente, porque la lectura
   * de un escaneo no siempre trae todo.
   */
  [/^Anotación de a bordo con fecha$/g, "On board notation with a date"],
  [/^la anotación de a bordo$/g, "the on board notation"],
  [
    /^Con «intended vessel» hace falta anotación de a bordo con fecha y buque real$/g,
    "Where the vessel is qualified as intended, an on board notation with the date and the actual vessel is required",
  ],
  [
    /^el documento califica el buque como previsto y no se leyó la anotación de a bordo$/g,
    "the document qualifies the vessel as intended and the on board notation was not read",
  ],
  [/^Se presenta el juego completo de originales$/g, "The full set of originals is presented"],
  [/^cuántos originales se emitieron$/g, "how many originals were issued"],
  [/^si hay cláusula de mercadería defectuosa$/g, "whether there is a clause declaring the goods defective"],
  [/^Embarques parciales prohibidos por el crédito$/g, "Partial shipments prohibited by the credit"],
  [
    /^verificar que se presenta un solo juego de documentos de transporte$/g,
    "check that a single set of transport documents is presented",
  ],
  [
    /^El seguro lo emite una compañía de seguros o un asegurador$/g,
    "The insurance document is issued by an insurance company or underwriter",
  ],
  [/^El seguro lo emite una compañía de seguros$/g, "The insurance document is issued by an insurance company"],
  [/^No es una nota de cobertura \(cover note\)$/g, "It is not a cover note"],
  [/^El seguro no está fechado después del embarque$/g, "The insurance document is not dated after shipment"],
  [/^la fecha del seguro$/g, "the date of the insurance document"],
  [/^la moneda del seguro$/g, "the currency of the insurance document"],
  [
    /^Cobertura de al menos el 110 % del valor de la mercadería$/g,
    "Cover for at least 110 % of the value of the goods",
  ],
  [/^Cobertura de al menos el 110 %$/g, "Cover for at least 110 %"],
  [/^el importe asegurado$/g, "the amount insured"],
  [
    /^La cobertura va del lugar de embarque al de destino$/g,
    "Cover runs from the place of shipment to the place of destination",
  ],
  [/^La cobertura va del embarque al destino$/g, "Cover runs from shipment to destination"],
  [/^el tramo cubierto$/g, "the stretch covered"],
  [
    /^El crédito expresa la cantidad en bultos: no corre la tolerancia del 5 %$/g,
    "The credit states the quantity in packing units: the 5 % tolerance does not apply",
  ],
  [
    /^Sin tolerancia en el crédito, la cantidad admite ±5 %$/g,
    "With no tolerance in the credit, the quantity admits ±5 %",
  ],
  [/^la cantidad se compara exacta$/g, "the quantity is compared exactly"],
  [/^Lugar de embarque$/g, "Place of shipment"],
  [/^la fecha de emisión$/g, "the date of issuance"],
  [/^verificar a mano$/g, "check by hand"],
  [/^el comprador$/g, "the buyer"],
  [/^Conocimiento de embarque$/g, "Bill of lading"],
  // la etiqueta del quinto tipo: los otros siete papeles que el 46A pide
  [/^Certificado del 46A$/g, "Field 46A certificate"],
  [/^Documento de seguro$/g, "Insurance document"],
  [/^documento de seguro$/g, "insurance document"],
  [/^Certificado$/g, "Certificate"],
  [/^certificado$/g, "certificate"],
  [/^Carta de crédito$/g, "Letter of credit"],
  // ── multimodal, terrestre y courier (UCP 600 arts. 19, 24 y 25) ──
  [
    /^La mercadería consta despachada, tomada a cargo o embarcada en el lugar del crédito$/g,
    "The goods are shown as dispatched, taken in charge or shipped on board at the place stated in the credit",
  ],
  [
    /^La mercadería consta despachada, tomada a cargo o embarcada$/g,
    "The goods are shown as dispatched, taken in charge or shipped on board",
  ],
  [/^esa constancia$/g, "that indication"],
  [
    /^Lugar de despacho o toma a cargo el que indica el crédito/g,
    "Place of dispatch or taking in charge as stated in the credit",
  ],
  [/^Lugar de destino final el que indica el crédito/g, "Place of final destination as stated in the credit"],
  [/^lugar de despacho o toma a cargo$/g, "place of dispatch or taking in charge"],
  [/^lugar de destino final$/g, "place of final destination"],
  [
    /^El transbordo no hace discrepante a un documento multimodal$/g,
    "Transhipment does not make a multimodal transport document discrepant",
  ],
  [
    /, pero el artículo 19 \(c\) \(ii\) lo admite mientras todo el trayecto vaya en el mismo documento$/g,
    ", but article 19 (c) (ii) admits it as long as the entire carriage is covered by one and the same document",
  ],
  [
    /^La fecha de embarque es la del sello de recepción o, si no lo hay, la de emisión$/g,
    "The date of shipment is that of the reception stamp or, failing that, the date of issuance",
  ],
  [/^Fecha de recepción o de emisión$/g, "Date of receipt or of issuance"],
  [/^rige el sello de recepción, /g, "the reception stamp governs, "],
  [
    /^no se leyó sello de recepción: rige la fecha de emisión, /g,
    "no reception stamp was read: the date of issuance governs, ",
  ],
  [/^Lugar de embarque el que indica el crédito/g, "Place of shipment as stated in the credit"],
  [/^Lugar de destino el que indica el crédito/g, "Place of destination as stated in the credit"],
  [/^lugar de embarque$/g, "place of shipment"],
  [/^lugar de destino$/g, "place of destination"],
  [
    /^Un documento ferroviario marcado «duplicate» se acepta como original$/g,
    "A rail transport document marked 'duplicate' is accepted as an original",
  ],
  [
    /^El documento es el original para el expedidor o no lleva marca de destinatario$/g,
    "The document is the original for consignor or shipper, or bears no marking of whom it was prepared for",
  ],
  [/, y el artículo 24 \(b\) \(ii\) lo acepta como original$/g, ", and article 24 (b) (ii) accepts it as an original"],
  [
    /^El recibo nombra al courier y está sellado o firmado por él$/g,
    "The receipt names the courier service and is stamped or signed by it",
  ],
  [/: verificar el sello o la firma a mano$/g, ": check the stamp or the signature by hand"],
  [/^el documento se titula /g, "the document is headed "],
  [
    /^El contrato de fletamento se presenta pero no se examina$/g,
    "The charter party contract is presented but not examined",
  ],
  [
    /^el crédito exige presentarlo; el artículo 22 \(b\) dice que el banco no examina contratos de fletamento$/g,
    "the credit requires it to be presented; article 22 (b) provides that a bank will not examine charter party contracts",
  ],
  [
    / — el crédito indica una zona o un rango de puertos, así que hay que verificar a mano que el lugar del documento esté dentro$/g,
    " — the credit states a geographical area or a range of ports, so it has to be checked by hand that the place on the document falls within it",
  ],
  [
    /^El conocimiento no indica estar sujeto a contrato de fletamento$/g,
    "The bill of lading contains no indication that it is subject to a charter party",
  ],
  [
    /^La fecha de recogida o de recibo es la fecha de embarque$/g,
    "The date of pick-up or of receipt is the date of shipment",
  ],
  [/^Fecha de recogida o de recibo$/g, "Date of pick-up or of receipt"],
  [/^la fecha del recibo$/g, "the date of the receipt"],
  [/^rige la fecha del recibo, /g, "the date of the receipt governs, "],
  [
    /^El crédito pide un conocimiento sujeto a fletamento y el presentado lo es$/g,
    "The credit calls for a charter party bill of lading and the one presented is such",
  ],
  // ── transporte aéreo (UCP 600 art. 23) ──
  [
    /^El documento indica que la mercadería fue aceptada para transporte$/g,
    "The document indicates that the goods have been accepted for carriage",
  ],
  [/^La mercadería consta aceptada para transporte$/g, "The goods are shown as accepted for carriage"],
  [
    /^La fecha de embarque es la de emisión, salvo notación del embarque real$/g,
    "The date of shipment is the date of issuance, unless a notation of the actual shipment says otherwise",
  ],
  [/^Fecha de emisión del documento aéreo$/g, "Date of issuance of the air transport document"],
  [/^rige la fecha de emisión, /g, "the date of issuance governs, "],
  [
    /: el número de vuelo y su fecha no cuentan para determinar la fecha de embarque$/g,
    ": the flight number and its date are not taken into account in determining the date of shipment",
  ],
  [/^el crédito /g, "the credit "],
  [/^Aeropuerto de salida el que indica el crédito \(([^)]*)\)$/g, "Airport of departure as stated in the credit ($1)"],
  [
    /^Aeropuerto de destino el que indica el crédito \(([^)]*)\)$/g,
    "Airport of destination as stated in the credit ($1)",
  ],
  [/^Aeropuerto de salida el que indica el crédito$/g, "Airport of departure as stated in the credit"],
  [/^Aeropuerto de destino el que indica el crédito$/g, "Airport of destination as stated in the credit"],
  [/^el aeropuerto de salida$/g, "the airport of departure"],
  [/^el aeropuerto de destino$/g, "the airport of destination"],
  [
    /^Basta el original para el expedidor, aunque el crédito pida el juego completo$/g,
    "The original for consignor or shipper suffices, even if the credit calls for a full set",
  ],
  [
    /; el artículo 23 \(a\) \(v\) admite el original del expedidor aunque el crédito exija el juego completo$/g,
    "; article 23 (a) (v) admits the original for consignor or shipper even where the credit stipulates a full set",
  ],
  [
    /^el artículo 23 \(a\) \(v\) admite el original del expedidor aunque el crédito exija el juego completo$/g,
    "article 23 (a) (v) admits the original for consignor or shipper even where the credit stipulates a full set",
  ],
  [
    /^El transbordo no hace discrepante a un documento aéreo$/g,
    "Transhipment does not make an air transport document discrepant",
  ],
  [
    /, pero el artículo 23 \(c\) \(ii\) lo admite aunque el crédito lo prohíba$/g,
    ", but article 23 (c) (ii) admits it even where the credit prohibits transhipment",
  ],
  [/^esa indicación$/g, "that indication"],
  // ── la clase del documento de transporte (`transporte.ts`) ──
  [/^Clase del documento de transporte$/g, "Class of transport document"],
  [/^conocimiento de embarque marítimo: /g, "marine bill of lading: "],
  [/^documento de transporte multimodal: /g, "multimodal transport document: "],
  [/^sea waybill no negociable: /g, "non-negotiable sea waybill: "],
  [/^conocimiento sujeto a contrato de fletamento: /g, "bill of lading subject to a charter party: "],
  [/^documento de transporte aéreo: /g, "air transport document: "],
  [
    /^documento de transporte por carretera, ferrocarril o vía navegable: /g,
    "road, rail or inland waterway transport document: ",
  ],
  [/^recibo de courier o de correo: /g, "courier or post receipt: "],
  [/nombra un buque, /g, "it names a vessel, "],
  [/se titula /g, "it is headed "],
  [/el documento dice /g, "the document states "],
  [/el número (.*) tiene la forma de un air waybill/g, "the number $1 has the shape of an air waybill"],
  [/los lugares son aeropuertos: /g, "the places are airports: "],
  [/los lugares son puertos: /g, "the places are ports: "],
  [
    /^no se pudo determinar de qué clase es: no se leyó cómo se titula, ni un buque, ni los lugares\. Se examinó con el artículo 20, el del conocimiento marítimo: si el documento es aéreo, terrestre o multimodal, este examen no corresponde\.$/g,
    "the class of document could not be determined: neither its heading, nor a vessel, nor the places were read. It was examined under article 20, that of the marine bill of lading: if the document is an air, road or multimodal one, this examination does not apply.",
  ],
  [
    /^El crédito pide un conocimiento sujeto a fletamento y el presentado lo es$/g,
    "The credit calls for a charter party bill of lading and the one presented is such",
  ],
  [/^el 46A lo exige y el documento dice /g, "field 46A calls for it and the document states "],
  // ── el crédito contra el contrato de venta (`contrato.ts`) ──
  [/^Documento no pactado$/g, "Document not agreed"],
  [/^no está en el contrato$/g, "not in the contract"],
  [
    /^Hay que conseguirlo igual: sin ese documento la presentación queda incompleta\.$/g,
    "It has to be obtained anyway: without it the presentation is incomplete.",
  ],
  [/^Plazo de presentación$/g, "Period for presentation"],
  [/^(\d+) días$/g, "$1 days"],
  [
    /^(\d+) días menos para juntar los documentos y presentarlos\.$/g,
    "$1 days less to gather the documents and present them.",
  ],
  [/^(\d+) días más que lo pactado\.$/g, "$1 days more than agreed."],
  [/^Último embarque$/g, "Latest shipment"],
  [
    /^El crédito cierra el embarque antes de lo pactado: hay que adelantar la carga\.$/g,
    "The credit closes shipment earlier than agreed: loading has to be brought forward.",
  ],
  [
    /^El crédito da más tiempo para embarcar que el contrato\.$/g,
    "The credit allows more time to ship than the contract.",
  ],
  [/^Monto$/g, "Amount"],
  [
    /^El crédito abre por ([\d.,]+) menos de lo pactado: eso no se cobra contra este crédito\.$/g,
    "The credit is opened for $1 less than agreed: that amount is not collected under this credit.",
  ],
  [/^El crédito abre por ([\d.,]+) más de lo pactado\.$/g, "The credit is opened for $1 more than agreed."],
  [/^Moneda$/g, "Currency"],
  [
    /^Se cobra en una moneda distinta de la pactada: el riesgo de cambio cambia de manos\.$/g,
    "Payment comes in a currency other than the one agreed: the exchange risk changes hands.",
  ],
  [/^Tolerancia$/g, "Tolerance"],
  [
    /^Menos margen que el pactado: un embarque que el contrato admitía puede quedar fuera del crédito\.$/g,
    "Less margin than agreed: a shipment the contract allowed may fall outside the credit.",
  ],
  [/^Más margen que el pactado\.$/g, "More margin than agreed."],
  [/^Embarques parciales$/g, "Partial shipments"],
  [/^permitidos$/g, "allowed"],
  [/^no permitidos$/g, "not allowed"],
  [
    /^Todo tiene que salir en un solo embarque, contra lo pactado\.$/g,
    "Everything has to go in a single shipment, against what was agreed.",
  ],
  [
    /^El crédito admite partir el embarque aunque el contrato no lo previera\.$/g,
    "The credit allows splitting the shipment even though the contract did not provide for it.",
  ],
  [/^Puerto de embarque$/g, "Port of loading"],
  [/^Puerto de destino$/g, "Port of discharge"],
  [
    /^No coincide con lo pactado: confirmarlo antes de reservar la bodega\.$/g,
    "It does not match what was agreed: confirm it before booking the space.",
  ],
  [
    /^Los documentos de un mismo embarque no pueden contradecirse \(UCP 600 art\. 14d\): el banco lo marca como discrepancia\. Unificar la descripción de los bultos antes de presentar\.$/g,
    "Documents covering the same shipment must not conflict with one another (UCP 600 art. 14(d)): the bank raises this as a discrepancy. Align the description of the packages before presenting.",
  ],
  [
    /^La factura la emite el beneficiario y el BL\/packing el productor que embarca\. Que el embarcador no sea el beneficiario no es discrepancia: el artículo 14 \(k\) lo admite\. Lo que sí tiene que emitir el beneficiario es la factura \(18 a i\)\.$/g,
    "The invoice is issued by the beneficiary while the bill of lading and packing list are issued by the producer who ships. That the shipper is not the beneficiary is not a discrepancy: article 14 (k) admits it. What the beneficiary does have to issue is the invoice (18 a i).",
  ],
  [
    /^no se leyó un número de LC en el documento: verificar a mano$/g,
    "no credit number was read in the document: check by hand",
  ],
  [
    /^no se leyó si hay cláusula de mercadería defectuosa en el documento: verificar a mano$/g,
    "it could not be read whether the document bears a clause about defective goods: check by hand",
  ],
  [
    /^sin fecha real de BL en el seguimiento: la cuenta no arranca$/g,
    "no actual bill of lading date on file: the count cannot start",
  ],
  [
    /^La descripción de la mercadería en la factura se corresponde con la del crédito$/g,
    "The goods description in the invoice corresponds to the one in the credit",
  ],
  [
    /^Se presenta el juego completo de originales, no una copia$/g,
    "The full set of originals is presented, not a copy",
  ],
  [
    /^cláusula de opción del transportista, admitida por el artículo:/g,
    "carrier's option clause, permitted by the article:",
  ],

  // ── los nombres de los documentos, que el motor escribe en mayúsculas como clave ──
  [/\bFACTURA\b(?=:)/g, "INVOICE"],
  [/\bPACKING\b(?=:)/g, "PACKING LIST"],
  [/\(FACTURA\)/g, "(INVOICE)"],
  [/\(PACKING\)/g, "(PACKING LIST)"],
  [/\(BL\)/g, "(B/L)"],

  // ── plantillas de regla ──
  [/\bcita el número de la LC\b/g, "quotes the credit number"],
  [/\bel número de LC que cita es el del crédito\b/g, "the credit number it quotes is this credit's"],
  [
    /^el crédito lo pide en el campo (47A|46A) y no se leyó en el documento: verificar a mano$/g,
    "the credit requires it in field $1 and none was read on the document: check by hand",
  ],
  [/^dice "(.+)" y el crédito es "(.+)"$/g, 'states "$1" while the credit is "$2"'],
  [/\bfechado el día de la LC o después\b/g, "dated on or after the credit date"],
  [/^BL consignado\b/g, "B/L consigned"],
  [/^BL marcado\b/g, "B/L marked"],
  [/^BL notify: el ordenante \(applicant\)$/g, "B/L notify party: the applicant"],
  [/^BL: /g, "B/L: "],
  [/\bvalor FOB y flete por separado\b/g, "FOB value and freight shown separately"],
  [/\bdentro del monto de la LC\b/g, "within the credit amount"],
  [/\bemitida por el beneficiario\b/g, "issued by the beneficiary"],
  [/\bemitida a nombre del ordenante\b/g, "made out in the name of the applicant"],
  [/\ben la moneda del crédito\b/g, "in the currency of the credit"],
  [
    /\bla descripción de la mercadería no contradice al crédito\b/g,
    "the goods description does not conflict with the credit",
  ],
  [/^Tipo de bulto: /g, "Package type: "],
  [/^Exportador \/ shipper: /g, "Shipper: "],
  [/^Plazo de presentación$/g, "Presentation period"],
  [/^A bordo a más tardar el /g, "On board no later than "],
  [/^Puerto de carga el que indica el crédito\b/g, "Port of loading as stated in the credit"],
  [/^Puerto de descarga el que indica el crédito\b/g, "Port of discharge as stated in the credit"],
  [/^Anotación de a bordo con fecha de embarque$/g, "On board notation bearing the date of shipment"],
  [/^La mercadería no viaja declarada sobre cubierta$/g, "The goods are not declared as shipped on deck"],
  [/^Documento de transporte limpio$/g, "Clean transport document"],
  [/\bno está fechado después de la presentación\b/g, "not dated after the presentation"],
  [/^Factura comercial: /g, "Commercial invoice: "],
  [/^Packing list: /g, "Packing list: "],
  [/^Conocimiento de embarque: /g, "Bill of lading: "],
  [/^Factura: /g, "Invoice: "],
  [/^Factura /g, "Invoice "],

  // ── plantillas de evidencia ──
  [/^Analizado\b/g, "Examined"],
  [/^No está en el paquete\b/g, "Not in the set"],
  [/\bsin cantidad indicada\b/g, "no number of copies stated"],
  [/\b(\d+) originales\b/g, "$1 originals"],
  [/\b(\d+) copias\b/g, "$1 copies"],
  [/^documento /g, "document "],
  [/\bLC emitida\b/g, "credit issued"],
  [/^dice\b/g, "says"],
  [/\bdice\b/g, "says"],
  [/\bordenante\b/g, "applicant"],
  [/^flete desglosado:/g, "freight shown separately:"],
  [/^factura /g, "invoice "],
  [/\bfactura:/g, "invoice:"],
  [/\bfactura comercial\b/g, "commercial invoice"],
  [/^emisor\b/g, "issuer"],
  [/\bbeneficiario\b/g, "beneficiary"],
  // Sobre el texto original, no sobre el ya traducido: ningún patrón puede dar por hecho
  // que otro corrió antes, porque el orden lo decide la especificidad y no la escritura.
  [/^el documento dice\b/g, "the document says"],
  [/^BL a bordo\b/g, "B/L on board"],
  [/^originales emitidos:/g, "originals issued:"],
  [/\bel crédito nombra a\b/g, "the credit names"],
  [/\bcrédito 45A:/g, "credit field 45A:"],
  [/\bpresentación (\d)/g, "presentation $1"],

  // ── los giros parciales del artículo 31, que solo aparecen del segundo giro en adelante ──
  [
    /^El crédito prohíbe los giros parciales y ya hay una presentación anterior$/g,
    "The credit prohibits partial drawings and there is already an earlier presentation",
  ],
  [/^Giro número (\d+) contra el mismo crédito$/g, "Drawing number $1 against the same credit"],
  [/^los parciales están permitidos por defecto$/g, "partial drawings are allowed by default"],
  [/^los parciales están permitidos /g, "partial drawings are allowed "],
  [/^ya se giró (.+) en (\d+) presentaciones$/g, "$1 has already been drawn in $2 presentations"],
  [/^ya se giró (.+) en (\d+) presentación$/g, "$1 has already been drawn in $2 presentation"],
  [
    /^Documentos propios con la dirección del beneficiario que dice la LC$/g,
    "The beneficiary's own documents show the address stated in the credit",
  ],

  // ── el saldo del crédito (presentaciones.ts) ──
  [/^El total girado no supera el crédito\b/g, "The total drawn does not exceed the credit"],
  [/\bgirados \+ /g, "drawn + "],
  [/\bde esta presentación = /g, "of this presentation = "],
  [/ · tope /g, " · cap "],

  // ── los plazos: estas reglas solo aparecen cuando una fecha pasó, así que se cubren con un
  //    escenario vencido y no con el del expediente al día ──
  [
    /^Presentar dentro de (\d+) días del BL y antes del vencimiento$/g,
    "Present within $1 days of the bill of lading date and before expiry",
  ],
  [
    /^Presentada antes del vencimiento, corrido al primer día hábil /g,
    "Presented before expiry, rolled to the first banking day ",
  ],
  [/^Presentada antes del vencimiento /g, "Presented before expiry "],
  [/^presentada el /g, "presented on "],
  [/\bquedan (\d+) días\b/g, "$1 days left"],
  [/\bvenció hace (\d+) días\b/g, "expired $1 days ago"],
  [/\b(\d+) días después del vencimiento\b/g, "$1 days after expiry"],
  [/^BL (\S+) → límite /g, "B/L $1 → limit "],

  // ── los avisos de cómo se leyó una cifra (numeros.ts) ──
  // Sin ancla, porque el aviso llega con el documento adelante («INVOICE: Cantidad …»), y por
  // palabras y no por frase, porque para cuando esto corre la cita ya es un marcador y un patrón
  // que la incluyera no coincidiría.
  [/\bCantidad\b/g, "Quantity"],
  [/\bleída como\b/g, "read as"],
  [/^el número se lee de una sola forma$/g, "the figure can only be read one way"],
  [/\bdividido\b/g, "divided by"],
  [/\bda ([\d.,]+): la cantidad es\b/g, "gives $1: the quantity is"],
  [
    /\bse puede leer como ([\d.,]+) o como ([\d.,]+): verificar contra el documento\b/g,
    "can be read as $1 or as $2: check against the document",
  ],

  // ── las fechas que el motor embute en el texto: «30-abr-25» dentro de un aviso en inglés ──
  [/\b(\d{2})-ene-(\d{2})\b/g, "$1-Jan-20$2"],
  [/\b(\d{2})-feb-(\d{2})\b/g, "$1-Feb-20$2"],
  [/\b(\d{2})-mar-(\d{2})\b/g, "$1-Mar-20$2"],
  [/\b(\d{2})-abr-(\d{2})\b/g, "$1-Apr-20$2"],
  [/\b(\d{2})-may-(\d{2})\b/g, "$1-May-20$2"],
  [/\b(\d{2})-jun-(\d{2})\b/g, "$1-Jun-20$2"],
  [/\b(\d{2})-jul-(\d{2})\b/g, "$1-Jul-20$2"],
  [/\b(\d{2})-ago-(\d{2})\b/g, "$1-Aug-20$2"],
  [/\b(\d{2})-sep-(\d{2})\b/g, "$1-Sep-20$2"],
  [/\b(\d{2})-oct-(\d{2})\b/g, "$1-Oct-20$2"],
  [/\b(\d{2})-nov-(\d{2})\b/g, "$1-Nov-20$2"],
  [/\b(\d{2})-dic-(\d{2})\b/g, "$1-Dec-20$2"],

  // ── lo que queda a la persona ──
  [
    /^Que cada documento esté firmado, sellado o autenticado por quien corresponde$/g,
    "That each document is signed, stamped or authenticated by whoever must do so",
  ],
  [
    /^el motor lee el texto de la firma y el rol que declara, pero no puede juzgar si la firma es auténtica$/g,
    "the engine reads the text of the signature and the capacity it states, but cannot judge whether the signature is genuine",
  ],
  [
    /^Que los ejemplares presentados sean originales: firma, sello o papel membretado del emisor$/g,
    "That the copies presented are originals: signature, stamp or the issuer's letterhead",
  ],
  [
    /^un archivo escaneado no permite distinguir un original de una fotocopia$/g,
    "a scanned file does not allow an original to be told apart from a photocopy",
  ],
  [
    /^Que toda corrección o enmienda esté autenticada por quien emitió el documento$/g,
    "That every correction or amendment is authenticated by whoever issued the document",
  ],
  [
    /^la marca de autenticación es física y suele ser manuscrita$/g,
    "the mark of authentication is physical and usually handwritten",
  ],
  [
    /^Que sellos, estampillas y anotaciones manuscritas se lean con claridad$/g,
    "That stamps, seals and handwritten notations can be read clearly",
  ],
  [
    /^lo ilegible para una persona también lo es para el modelo, y no se puede dar por bueno$/g,
    "what a person cannot read the model cannot read either, and it cannot be taken as good",
  ],
  [
    /^Contar los originales del documento de transporte que efectivamente se presentan$/g,
    "Count the originals of the transport document actually presented",
  ],
  [
    /^el documento declara cuántos se emitieron, pero cuántos llegaron se cuenta a mano$/g,
    "the document states how many were issued, but how many arrived is counted by hand",
  ],
  [
    /^Que cada certificado lo emita el organismo que el crédito nombra$/g,
    "That each certificate is issued by the body the credit names",
  ],
  [
    /^el nombre del emisor se lee, pero que esté habilitado para emitirlo no surge del papel$/g,
    "the issuer's name can be read, but whether it is entitled to issue it does not appear on the paper",
  ],
];

/**
 * Cuán específico es un patrón: primero las frases ancladas en los dos extremos, después las
 * ancladas en uno, al final las libres. A igual anclaje, gana el patrón más largo, que es el que
 * describe más texto.
 */
function especificidad([re]: [RegExp, string]): number {
  const f = re.source;
  const anclas = (f.startsWith("^") ? 2 : 0) + (f.endsWith("$") ? 2 : 0);
  return anclas * 10_000 + f.length;
}

/** Los mismos reemplazos, ordenados una sola vez al cargar el módulo. */
const POR_ESPECIFICIDAD = [...REEMPLAZOS].sort((a, b) => especificidad(b) - especificidad(a));

/** Las partes entre comillas, que son cita y quedan intactas. */
const CITA = /"[^"]*"/g;

const MESES_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_IN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Las cifras y las fechas, escritas como las escribe quien lee en inglés.
 *
 * El diccionario traducía las palabras y dejaba el formato de es-UY, así que un hallazgo decía
 * «the operative credit is for less: 100.000 → 90.000» y «31-dic-25». Un punto de miles donde el
 * lector espera un punto decimal no es una molestia de estilo: «54.150» se lee cincuenta y cuatro
 * con ciento cincuenta milésimas, y el número está en un papel que se cursa a otro banco.
 *
 * Se tocan tres cosas y nada más, porque cada una es inequívoca:
 *
 * - un número con **punto de miles** —«54.150,00»—, que en inglés no se escribe así nunca;
 * - una **coma decimal pegada a su unidad** —«61,1 %», «26,5 kg»—, donde la coma no puede ser una
 *   enumeración;
 * - el **mes abreviado en castellano** de una fecha, que no se confunde con otra cosa.
 *
 * Lo que queda afuera: un número suelto con coma, que podría ser una lista, y cualquier cosa dentro
 * de comillas, que es lo que el documento dice y reformatearlo sería cambiar la cita.
 */
export function cifrasEnIngles(texto: string): string {
  return texto
    .replace(/\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/g, (n) =>
      n
        .replace(/\./g, "\u0001")
        .replace(/,/g, ".")
        .replace(/\u0001/g, ","),
    )
    .replace(/\b(\d+),(\d+)(?=\s*(?:%|(?:pct|kg|kgs|mt|mts|tn|usd|eur|gbp)\b))/gi, "$1.$2")
    .replace(/\b(\d{1,2})-([a-záéíóú]{3})-(\d{2,4})\b/gi, (todo, d: string, mes: string, a: string) => {
      const i = MESES_ES.indexOf(mes.toLowerCase());
      return i === -1 ? todo : `${d}-${MESES_IN[i]}-${a}`;
    });
}

/**
 * Traduce un texto del motor dejando las citas como están.
 *
 * El procedimiento: se sacan las citas, se traduce el resto, se reponen. Así una cita que
 * contenga una palabra que el diccionario traduciría —«dice», por ejemplo, si el documento
 * estuviera en español— no se toca.
 */
export function textoEnIngles(texto: string): string {
  if (!texto) return texto;
  const citas: string[] = [];
  const conHuecos = texto.replace(CITA, (m) => {
    citas.push(m);
    return `\u0000${citas.length - 1}\u0000`;
  });

  let out = conHuecos;
  for (const [re, con] of POR_ESPECIFICIDAD) out = out.replace(re, con);
  out = cifrasEnIngles(out);

  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => citas[Number(i)] ?? "");
}

/** Un hallazgo entero en inglés. La fuente y el estado no se traducen: son claves. */
export function reglaEnIngles(r: ReglaPresentacion): ReglaPresentacion {
  return { ...r, regla: textoEnIngles(r.regla), evidencia: textoEnIngles(r.evidencia ?? "") };
}

/** Un desvío contra el contrato, en inglés: el campo, los valores y la consecuencia. */
export function desvioEnIngles(d: DiferenciaContrato): DiferenciaContrato {
  return {
    ...d,
    campo: textoEnIngles(d.campo),
    contrato: textoEnIngles(d.contrato),
    consecuencia: textoEnIngles(d.consecuencia),
  };
}

export function manualEnIngles(m: VerificacionManual): VerificacionManual {
  return { ...m, que: textoEnIngles(m.que), porQue: textoEnIngles(m.porQue) };
}

/**
 * Las palabras que solo existen en español, para detectar lo que el diccionario no cubre.
 *
 * Se usa en el test: si un hallazgo del expediente de referencia queda con una de estas afuera de las
 * comillas, es que hay una plantilla nueva sin traducir. Preferimos que el test falle antes que
 * mandarle a un banco un aviso a medias.
 */
const SOLO_ESPANOL =
  // «no» queda afuera a propósito: en inglés significa lo mismo y aparece en «no number stated».
  // Lo mismo «la», que es una nota musical, y «sin», que es una palabra inglesa.
  /\b(el|los|las|una|del|al|que|se|con|por|para|desde|hasta|está|estan|están|dice|debe|hay|más|pero|como|cuando|donde|según|entre|cada|todo|toda|todos|todas|esto|esta|este|esa|ese|sus|día|días|fecha|número|cantidad|paquete|originales|copias|factura|crédito|banco|documento|documentos|mercadería|embarque|presentación|beneficiario|ordenante|emisor|emitida|emitido|verificar|leyó|firmado|sellado|contar|nombra|girados|tope)\b/i;

/**
 * Los meses en español, pero solo dentro de una fecha.
 *
 * Sueltos dan falsos positivos: «ago» es parte de «16 days ago» y «mar» y «may» son palabras
 * inglesas. Solo cuentan pegados a un día y un año, que es como el motor los escribe.
 */
const FECHA_ESPANOL = /\b\d{1,2}-(ene|abr|ago|dic)-\d{2,4}\b/i;

/** ¿Este texto todavía tiene español fuera de las comillas? */
export function quedaEspanol(texto: string): string | null {
  const sinCitas = texto.replace(CITA, " ");
  const m = SOLO_ESPANOL.exec(sinCitas) ?? FECHA_ESPANOL.exec(sinCitas);
  return m ? m[0] : null;
}
