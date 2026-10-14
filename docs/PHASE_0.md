# Fase 0 — Seguridad y validación automática

## Reglas aplicadas

- El navegador solo modifica username, full_name y avatar_url del perfil propio. Admin, ELO, fiabilidad y estadísticas antiguas quedan protegidos.
- Crear partidas, resultados, relaciones sociales y ajustes administrativos pasan por RPCs con autorización; no por escrituras arbitrarias en tablas.
- Participantes: solo la cuenta propia puede entrar/salir/cambiar su equipo mientras la mesa admite cambios. Máximo cuatro plazas, dos por equipo; bloqueo de fila de evento para serializar entradas.
- Cambiar la composición invalida los códigos y las pruebas de presencia de la mesa.
- Funciones de ELO, auditoría, suplantación para pruebas, recalculo y timeout son internas. RPCs públicas autenticadas están enumeradas en la migración.
- Vistas normales respetan RLS; la vista de presencia de administración filtra por admin. Se retira acceso anónimo a los datos.
- El reporte por equipos requiere dos parejas completas; en competitivo, cuatro check-ins. La confirmación antigua no puede saltarse el protocolo nuevo ni aceptar al compañero como rival.
- ELO se aplica una sola vez bajo bloqueo. Las partidas competitivas históricas ya confirmadas se marcan como aplicadas sin recalcular su clasificación.
- Solo se resuelve una disputa abierta. Repetir una resolución no vuelve a mover ELO.
- Un reporte unilateral vencido pasa a disputa/revisión: no otorga victoria, no mueve ELO y no resta fiabilidad. Abrir disputa tampoco penaliza.
- La retirada de propuestas antiguas usa una RPC acotada a su autor; el navegador ya no actualiza events directamente.

## CI

Cada push de rama y cada PR ejecuta lint (sin warnings), TypeScript, tests PostgreSQL, build estático y tests del export. Solo main despliega y solo tras pasar los checks.

Comandos:

```
npm ci
npm run lint
npm run typecheck
npm test
npm run test:drift
npm run build
npm run test:export
```

Los tests usan PostgreSQL WASM (PGlite) con roles, RLS, triggers y las migraciones reales. No acceden a Supabase cloud ni necesitan claves secretas. Simulan la parte de Auth usada por SQL (auth.users y auth.uid), no el servidor de login OAuth.

Se ejecutan contra una instalación limpia y contra una variante que reproduce columnas text y estadísticas heredadas del proyecto cloud. Únicamente se omite instalar pgcrypto/citext en el harness: ninguna tabla utiliza citext y gen_random_uuid es nativo. Los cuerpos de las funciones de aplicación se ejecutan sin mocks.

Fixtures: seis usuarios sintéticos y partidas dentro de transacciones que se revierten después de cada caso. No quedan en ranking real ni generan correos. Esta fase prueba backend y artefacto exportado; las pruebas visuales móvil/cámara y sesiones de navegador vendrán en las fases siguientes.

## Backend cloud y operación

La migración `20261014191837_phase0_security_ci.sql` está aplicada en MusMatch. Se verificó el bloqueo real de columnas y RPCs con el rol authenticated; el analizador no devuelve errores de seguridad. Quedan avisos sobre APIs autenticadas intencionales, citext y protección de contraseñas filtradas. No usar las claves de Gazalbide o Resaka. El SQL no elimina usuarios ni partidas reales.

El job de timeout queda restringido a servicio/administración de base de datos. Todavía hace falta programar su invocación periódica (por ejemplo con Supabase Cron); Pages no ejecuta jobs. Durante el piloto, los pendientes vencidos no se auto-confirman.

El repositorio ejecuta checks, pero exigirlos para impedir merges manuales requiere una regla de protección de main en Settings > Rules. Añadir el check build como obligatorio; no confundir ejecutar CI con proteger administrativamente la rama.

Permisos nuevos y tablas futuras deben tener RLS y grants explícitos. No conceder de nuevo UPDATE general a profiles ni EXECUTE público a helpers internos.

## Siguiente fase

Fase 1: experiencia responsive móvil, tablet y escritorio. Formatos estructurados de reglas/marcador, lector QR y ciclo completo de invitaciones se abordan en fases posteriores.
