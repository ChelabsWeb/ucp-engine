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
  // ── certificados: las ramas «no se leyó» ──
  [/^no se leyó el emisor: verificar a mano$/g, "the issuer was not read: check by hand"],
  [/^no se leyó un peso comparable: verificar a mano$/g, "no comparable weight was read: check by hand"],
  [/^no se leyó el origen: verificar a mano$/g, "the origin was not read: check by hand"],
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
    /^La factura la emite el beneficiario y el BL\/packing el productor que embarca: es normal si la LC admite documentos de terceros \(47A\); si no, es discrepancia\.$/g,
    "The invoice is issued by the beneficiary while the bill of lading and packing list are issued by the producer who ships: this is usual where the credit allows third party documents (field 47A); where it does not, it is a discrepancy.",
  ],
  [
    /^La factura la emite el beneficiario y el BL\/packing el productor que embarca: es normal si la LC admite documentos de terceros \(47A\); si no, es discrepancia\.$/g,
    "The invoice is issued by the beneficiary while the bill of lading and packing list are issued by the producer who ships: this is usual where the credit allows third party documents (field 47A); where it does not, it is a discrepancy.",
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
 * Se usa en el test: si un hallazgo del expediente real queda con una de estas afuera de las
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
