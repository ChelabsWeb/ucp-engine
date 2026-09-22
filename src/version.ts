/**
 * La versión del motor, que va guardada en cada examen.
 *
 * Sin ella, un resultado de hace seis meses no se puede explicar: las reglas cambian, y el
 * día que alguien pregunte por qué se rechazó una presentación, la respuesta tiene que ser
 * la que daba el motor *ese día*, no la que daría hoy.
 *
 * Se sube cuando cambia el comportamiento de una regla, no cuando se arregla un comentario.
 * El test la ata al `package.json`: si se olvida una de las dos, salta.
 */
export const VERSION_MOTOR = "0.1.0";
