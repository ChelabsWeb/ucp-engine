# @chelabs/ucp-engine

El examen documental de una carta de crédito contra las **UCP 600** y la **ISBP 821**, como motor
puro y determinista. Sin red, sin base de datos, sin reloj propio: entra lo que dicen el crédito y
los papeles, sale lo que las reglas deciden.

Lo usan dos productos y por eso vive acá:

- **cotejo** — el examen para un banco: el producto es el veredicto.
- **romai** — el ERP del trader: el examen es una parte de la operación, y lo que importa es llegar
  al mostrador sin discrepancias.

Antes de este repo había dos copias del mismo motor, una en cada uno, y la paridad se mantenía a
mano. No se mantuvo: cinco arreglos encontrados en uno tardaron cinco días en cruzar al otro, y el
de incoterm —que daba DIFERENTE en 91 de 91 puertos reales del ERP— llevaba más.

## El principio

> La IA extrae, el motor decide, la persona firma.

De ahí salen las tres reglas que gobiernan todo lo de adentro:

1. **Un falso positivo es peor que un hueco.** Rechazar una presentación conforme le cuesta plata al
   beneficiario y credibilidad al banco. Cuando el dato no alcanza, el veredicto es «a verificar», no
   «discrepancia».
2. **Cada hallazgo tiene que poder ir a buscarse al papel.** La evidencia cita lo que el documento
   dice, y la fuente nombra el artículo que lo sostiene. Nunca se le atribuye a un artículo una regla
   que no tiene.
3. **Lo que el motor no puede saber, se carga o se dice.** El horario del banco, sus feriados, el
   calendario de cuotas: cuando están, el motor decide; cuando no, avisa en vez de inventar.

## Cómo se trabaja

```bash
pnpm install
pnpm verificar     # lint + typecheck + los 1.107 tests
```

Un cambio acá llega a los dos productos. Eso es lo que este repo vino a resolver y también lo que lo
hace delicado: **antes de tocar una regla, reproducí el caso**. El repo tiene un historial largo de
tests que pasaban por el motivo equivocado, y la forma de saber que un test muerde es romper el
código a propósito y mirar que se ponga rojo.

## Qué hay adentro

| | |
|---|---|
| `swift-lc.ts`, `enmiendas.ts` | leer un MT700/710/707 como llega, incluso dentro de un correo reenviado |
| `reglas-ucp.ts`, `presentacion.ts`, `consistencia.ts` | el examen artículo por artículo |
| `isbp.ts` | abreviaturas, erratas, incoterms, quién puede emitir un certificado |
| `certificados.ts`, `especificaciones.ts` | los documentos del 46A y la calidad que el 45A exige |
| `transporte.ts`, `transferible.ts`, `back-to-back.ts` | arts. 19-27, 38 y el par del trader |
| `presentaciones.ts` | el crédito y sus giros: saldo, parciales, cuotas, vencimiento (arts. 29-32) |
| `emision.ts` | la cara del emisor: si un crédito es operable antes de emitirlo |
| `papel.ts` | qué le exigen las UCP al banco que examina, según el papel que el crédito le da |
| `sanciones.ts` | screening de partes y buques, con evidencia trazable |
| `checking-list.ts`, `mt7*.ts` | los papeles que salen del escritorio |
| `verificaciones-manuales.ts` | **qué no se revisó**, que es lo que un examen honesto tiene que decir |
