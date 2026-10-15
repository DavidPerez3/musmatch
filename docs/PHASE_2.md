# Fase 2 — Reglas antes de apuntarse

## Contrato de la mesa

La creación exige modalidad 4 reyes/4 ases o 8 reyes/8 ases, 30 o 40 tantos, juegos necesarios para ganar una vaca (1–4) y vacas necesarias para ganar la partida (1–3). El formulario propone 8/8, 40 tantos, 3 juegos y 1 vaca y muestra el resumen antes de crear. Son opciones del piloto, no un reglamento federativo universal.

En 8/8 los treses cuentan como reyes y los doses como ases; en 4/4 conservan su valor. El texto opcional de reglas de mesa admite hasta 1000 caracteres y permite indicar juego real, deje, señas u otros acuerdos. Las notas generales son independientes.

Modalidad, tantos, juegos, vacas, reglas adicionales y tipo amistoso/competitivo quedan inmutables desde la creación, incluso antes de que se complete la mesa. Para otro formato se crea otra partida. La ficha muestra estas condiciones antes de los botones para entrar, junto con fecha, ubicación y notas; inicio y mis partidas muestran el resumen. Los filtros incluyen los cuatro valores del formato.

Las filas históricas conservan `rules_version=0` y campos nulos; se muestran como reglas no especificadas, sin inventar condiciones retroactivas. Siguen usando el formulario de resultado antiguo. No se modifica su ELO ni sus resultados.

## Resultados

Las partidas con contrato versión 1 usan dos campos numéricos, siempre equipo A–equipo B. En una partida de una vaca se reportan juegos; con varias vacas, se reportan vacas. Se calcula el ganador a partir del marcador. Un equipo debe alcanzar exactamente el objetivo y el otro quedar por debajo; se rechazan empates, negativos, decimales y valores incompatibles.

SQL valida ambos reportes antes de guardar. El protocolo por equipos, presencia competitiva, disputa neutral, timeout y aplicación única del ELO siguen vigentes. En una resolución administrativa el marcador final se toma del primer reporte compatible con el ganador elegido (A antes que B); si no hay ninguno válido, se rechaza. La edición administrativa de un marcador distinto requiere un flujo posterior con auditoría.

## Implementación y despliegue

Migración `20261015065214_phase2_match_rules.sql`, aplicada en cloud y verificada (permisos, CHECK y vista con RLS): columnas con CHECK, RPC `create_match_with_rules`, trigger de contrato inmutable y de marcadores, vista con `security_invoker` y permisos explícitos. La antigua RPC de creación devuelve un aviso para actualizar la aplicación; no permite crear partidas sin reglas desde clientes desactualizados. Aplicar la migración antes de publicar el cliente nuevo y recargar la aplicación.

24 escenarios SQL en esquema limpio y variante heredada, incluidos los 48 formatos, reglas inválidas/nulas, reversión atómica, inmutabilidad, victoria A/B, amistosa, varias vacas y disputa con resolución consistente. Se conserva toda la batería de seguridad de fase 0. Las pruebas de navegador ahora son 12: diez pantallas en seis tamaños, OAuth, selección y envío real de parámetros al mock de creación, filtros, empate bloqueado y reporte ganador B en orden A–B. No se crean usuarios de prueba en cloud.

## Límites y siguiente fase

No se simulan las manos, envites ni tantos de cada lance. El marcador resume el resultado final; no se registran los juegos de cada vaca. No hay acreditación individual de lectura de reglas: se muestran antes de entrar, y siguen pendientes las invitaciones con aceptación expresa del compañero. El ranking ELO sigue siendo común a las modalidades.

El usuario confirma acceso Google recuperado y aspecto del botón correcto; ha probado en Android. La aceptación física en iOS sigue pendiente. La protección administrativa de main sigue pendiente; el flujo de trabajo usa PR y CI antes de integrar.

Siguiente fase: QR efímero sobre el protocolo de presencia existente, caducidad, alternativa manual y pruebas en cámara real.

## Referencias

- [Reglamento de la Federación de Mus](https://lafederaciondemus.es/wp-content/uploads/2026/02/Reglamento-de-Juego-Federacion.pdf): ejemplo de 8/8 a cuatro juegos de cuarenta tantos.
- [Reglamento Barcelona Mus Club](https://barcelonamus.com/club/reglamento): el formato se anuncia al inicio; variantes locales deben acordarse.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): las vistas y RPC mantienen las restricciones de fase 0.
