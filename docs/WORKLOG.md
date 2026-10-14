# MusMatch - Worklog

## 2026-05-13

### Cambios aplicados en frontend
- Home:
- Se anadio filtro de estado `En disputa` en [page.tsx](C:\Users\david\dev\musmatch\src\app\page.tsx).
- Se anadio soporte de `result_status` en el filtrado de partidas.
- Se aplico clase `mm-select` a los `select` de filtros.

- Estilos globales:
- Se anadieron estilos para `mm-select` y `option` en [globals.css](C:\Users\david\dev\musmatch\src\app\globals.css).
- Se forzo `color-scheme: dark` para mejorar visibilidad de dropdown nativo.

- Detalle de partida:
- Se anadio feedback cuando el resultado esta pendiente y la cuenta no es participante.
- Se anadio bloque de estado para quien envio propuesta de resultado y boton de retirada.

### Cambios aplicados en backend SQL (migraciones)
- Se creo migracion de alineacion base Fase 0:
- [20260513_phase0_alignment.sql](C:\Users\david\dev\musmatch\supabase\migrations\20260513_phase0_alignment.sql)
- Incluye schema alineado con frontend, RPC faltantes y politicas RLS.

- Se creo migracion de protocolo de resultado por equipos (Fase 1, parcial a nivel producto):
- [20260513_phase1_team_result_protocol.sql](C:\Users\david\dev\musmatch\supabase\migrations\20260513_phase1_team_result_protocol.sql)
- Nota: el frontend todavia no consume esta RPC nueva de forma completa.

### Que debes ejecutar en Supabase
- Obligatorio para estado actual estable:
- Ejecutar `supabase/migrations/20260513_phase0_alignment.sql`.

- Opcional por ahora:
- `supabase/migrations/20260513_phase1_team_result_protocol.sql` solo si vamos a activar el nuevo flujo de resultado por equipos en frontend.

### Estado funcional actual
- Flujo vigente de resultados:
- Un jugador reporta.
- Rival confirma o disputa.
- Si disputa, va a cola de admin.

- Admin:
- Debe resolver disputas desde `/admin`.

### Pendiente proximo paso
- Integrar en UI la RPC `submit_team_result(...)` para auto-resolucion por doble reporte de equipos y menor carga de admin.

---

Compromiso de trazabilidad:
- A partir de este punto, cada cambio relevante se registrara en este archivo con fecha, archivos tocados, SQL requerido y estado.

## 2026-05-13 (actualizacion 2)

### Integracion de Fase 1 en frontend (resultado por equipos)
- Archivo actualizado:
- [page.tsx](C:\Users\david\dev\musmatch\src\app\events\[id]\page.tsx)

Cambios aplicados:
- El reporte de resultado ya usa RPC nueva:
- `submit_team_result(match_id, winner_team, result_score)`.
- Se anadio feedback visual de estado:
- `PENDING_OTHER_TEAM`
- `CONFIRMED_AUTO`
- `DISPUTED_AUTO`
- La UI muestra ahora:
- Espera al reporte rival cuando tu equipo ya reporto.
- Aviso para reportar cuando el rival ya envio su version.
- Se mantiene compatibilidad con flujo legacy para partidas antiguas en estado `PENDING` sin columnas de protocolo.
- Se actualizo el texto de formulario para reflejar cruce automatico entre equipos.

Estado:
- Build local en verde tras cambios (`npm run build` OK).

SQL requerido:
- Ninguno adicional si ya ejecutaste:
- `20260513_phase0_alignment.sql`
- `20260513_phase1_team_result_protocol.sql`

Prueba recomendada:
1. Crear partida 2v2.
2. Equipo A reporta resultado.
3. Equipo B reporta el suyo.
4. Si coincide: cierre automatico.
5. Si no coincide: disputa automatica para revision admin.

## 2026-05-13 (actualizacion 3)

### Timeout de respuesta del segundo equipo
- Nueva migracion:
- [20260513_phase1b_result_timeout.sql](C:\Users\david\dev\musmatch\supabase\migrations\20260513_phase1b_result_timeout.sql)

Incluye:
- Nuevas columnas en `events`:
- `result_pending_since`
- `result_pending_deadline`
- Actualizacion de `submit_team_result(...)`:
- al primer reporte deja deadline (12h)
- si ambos equipos reportan y coinciden => confirma auto
- si no coinciden => disputa auto
- Nueva funcion de resolucion por timeout:
- `resolve_pending_results_by_timeout()`
- Si el segundo equipo no responde a tiempo, confirma automaticamente el primer reporte.

### UI actualizada
- [page.tsx](C:\Users\david\dev\musmatch\src\app\events\[id]\page.tsx)
- Se muestra fecha limite de respuesta en estados `PENDING`.

### SQL pendiente por ejecutar en Supabase
- Ejecutar:
- `supabase/migrations/20260513_phase1b_result_timeout.sql`

### Nota operativa importante
- Para que el timeout se aplique automaticamente en segundo plano, hay que invocar periodicamente:
- `select public.resolve_pending_results_by_timeout();`
- Se puede programar con cron en Supabase o llamar desde un job externo (por ejemplo cada 5 minutos).

## 2026-05-13 (actualizacion 4)

### Regla de fiabilidad en amistosas y competitivas
- Nueva migracion:
- [20260513_phase1c_reliability_penalty.sql](C:\Users\david\dev\musmatch\supabase\migrations\20260513_phase1c_reliability_penalty.sql)

Implementado:
- `resolve_pending_results_by_timeout()` ahora penaliza fiabilidad del equipo que no responde al resultado.
- Penalizacion aplicada en ambos modos (`FRIENDLY` y `COMPETITIVE`).
- ELO solo se toca en competitivo, como antes.

Penalizacion actual:
- `reliability_score - 6` para cada jugador del equipo no respondedor.

SQL pendiente por ejecutar en Supabase:
- Ejecutar:
- `supabase/migrations/20260513_phase1c_reliability_penalty.sql`
- Nota: este script asume aplicado antes `20260513_phase1b_result_timeout.sql`.

Politica actualizada en docs:
- [MUSMATCH_PROJECT_GUIDE.md](C:\Users\david\dev\musmatch\docs\MUSMATCH_PROJECT_GUIDE.md)

## 2026-05-13 (actualizacion 5)

### Presencia manual por codigo (QR-ready, usable en localhost)
- Nueva migracion:
- [20260513_phase2_presence_manual_codes.sql](C:\Users\david\dev\musmatch\supabase\migrations\20260513_phase2_presence_manual_codes.sql)

Incluye backend:
- Tablas:
- `event_presence_tokens`
- `event_presence_proofs`
- RPCs:
- `create_presence_token(p_event_id)` -> devuelve codigo efimero
- `submit_presence_token(p_event_id, p_token)` -> valida codigo rival y genera prueba
- `recalculate_presence_for_event(p_event_id)` -> recalcula `attendance_status`
- `submit_team_result(...)` reforzada:
- En `COMPETITIVE` exige 4/4 jugadores con `attendance_status = CHECKED_IN`.
- Mantiene flujo de doble reporte y timeout.

Frontend:
- [page.tsx](C:\Users\david\dev\musmatch\src\app\events\[id]\page.tsx)
- Nueva seccion de "Verificacion de presencia (competitiva)" en detalle de partida.
- Muestra progreso 0..4 jugadores validados.
- Permite:
- generar codigo propio
- introducir codigo rival manualmente
- Bloquea reporte competitivo si no hay 4/4 validados.

SQL pendiente por ejecutar en Supabase:
- `supabase/migrations/20260513_phase2_presence_manual_codes.sql`

Notas:
- Este flujo esta pensado para desktop/local sin camara.
- Cuando quieras, se puede anadir QR encima sin tocar logica backend (solo capa visual).

## 2026-05-13 (actualizacion 6)

### Presencia UX mejorada + cola admin por riesgo
- Nueva migracion:
- [20260513_phase2b_presence_ux_admin.sql](C:\Users\david\dev\musmatch\supabase\migrations\20260513_phase2b_presence_ux_admin.sql)

Backend:
- `create_presence_token(p_event_id)` ahora devuelve JSON con:
- `token`
- `expires_at`
- `next_refresh_at` (cooldown 30s)
- `get_my_presence_token_status(p_event_id)` para refrescar estado del codigo en UI.
- Nueva vista:
- `admin_event_presence_overview` para priorizar partidas competitivas con presencia incompleta.

Frontend detalle partida:
- [page.tsx](C:\Users\david\dev\musmatch\src\app\events\[id]\page.tsx)
- Contador de expiracion del codigo de presencia.
- Cooldown visual para renovar codigo.
- Carga de estado de codigo al entrar en partida.

Frontend admin:
- [page.tsx](C:\Users\david\dev\musmatch\src\app\admin\page.tsx)
- Nueva seccion "Prioridad Presencia (Competitivas)".
- Ordena por `pending_checkins` para ver primero partidas con mayor riesgo.

SQL pendiente por ejecutar en Supabase:
- `supabase/migrations/20260513_phase2b_presence_ux_admin.sql`

## 2026-05-13 (actualizacion 7)

### Nueva funcionalidad: Mis partidas
- Nueva pagina:
- [page.tsx](C:\Users\david\dev\musmatch\src\app\my-matches\page.tsx)
- Nuevo acceso en navegacion:
- [Navbar.tsx](C:\Users\david\dev\musmatch\src\components\Navbar.tsx)

Que aporta:
- Vista personal de estado con secciones:
- Accion requerida (falta tu reporte de equipo)
- Esperando rival
- En disputa
- Proximas
- Finalizadas

Objetivo:
- Reducir friccion del usuario para saber "que tengo que hacer ahora".

SQL requerido:
- Ninguno adicional (consume esquema actual).

## 2026-05-13 (actualizacion 8)

### Nueva funcionalidad: contador de acciones pendientes en navbar
- Archivo:
- [Navbar.tsx](C:\Users\david\dev\musmatch\src\components\Navbar.tsx)

Que hace:
- En el enlace "Mis partidas" muestra badge rojo con numero de acciones pendientes.
- Se considera pendiente cuando:
- la partida esta en `PENDING`
- el rival ya envio su reporte
- tu equipo aun no envio el suyo

Detalles tecnicos:
- Carga inicial al abrir sesion.
- Refresco por cambios de auth.
- Polling cada 30 segundos para mantener contador actualizado.

SQL requerido:
- Ninguno adicional.

## 2026-05-13 (actualizacion 9)

### Roadmap Fase 2 - Anti-abuso ELO (anti-boost por repeticion)
- Nueva migracion:
- [20260513_phase3_antiboost_elo.sql](C:\Users\david\dev\musmatch\supabase\migrations\20260513_phase3_antiboost_elo.sql)

Implementado:
- `apply_match_elo(...)` ahora aplica multiplicador anti-boost segun repeticion de mismas parejas en 7 dias:
- 1 repeticion: x0.75
- 2 repeticiones: x0.50
- 3 repeticiones: x0.25
- 4 o mas: x0.00 (sin impacto ELO)
- Auditoria por evento en `events`:
- `elo_multiplier`
- `elo_base_delta`
- `elo_final_delta`
- `elo_antiboost_reason`

SQL pendiente por ejecutar en Supabase:
- `supabase/migrations/20260513_phase3_antiboost_elo.sql`

Objetivo roadmap:
- Reducir inflado artificial de ELO por farming entre mismas parejas.

## 2026-05-13 (actualizacion 10)

### Roadmap Fase 2 - Observabilidad y auditoria estructurada
- Nueva migracion:
- [20260513_phase3b_audit_observability.sql](C:\Users\david\dev\musmatch\supabase\migrations\20260513_phase3b_audit_observability.sql)

Implementado:
- Nueva tabla `audit_logs` con metadata JSON por evento.
- Logging automatico de cambios criticos:
- `EVENT_STATE_CHANGED` (cambios de estado/resultado/ELO por partida)
- `PROFILE_SCORE_CHANGED` (cambios de ELO/fiabilidad por usuario)
- `PRESENCE_PROOF_CREATED` (pruebas de presencia cruzada)
- RLS en `audit_logs`: solo admins autenticados pueden consultar.

SQL pendiente por ejecutar en Supabase:
- `supabase/migrations/20260513_phase3b_audit_observability.sql`

Objetivo roadmap:
- Mejor trazabilidad para revisar abusos, disputas y sanciones.

## 2026-05-15 (actualizacion 11)

### Roadmap Fase 2 - Match Confidence Score automatico
- Nueva migracion:
- [20260515_phase4_match_confidence.sql](C:\Users\david\dev\musmatch\supabase\migrations\20260515_phase4_match_confidence.sql)

Implementado:
- Nuevos campos en `events`:
- `match_confidence_score` (0..100)
- `match_confidence_breakdown` (jsonb explicativo)
- Nueva funcion:
- `recompute_match_confidence(event_id)` calcula score usando:
- presencia validada (`attendance_status`)
- pruebas cruzadas (`event_presence_proofs`)
- fiabilidad media de jugadores (`reliability_score`)
- estado de resultado (`PENDING` / `CONFIRMED` / `DISPUTED`)
- Triggers automaticos para recalculo al cambiar:
- participantes
- presencia
- estado de evento/resultado
- fiabilidad de usuarios
- Backfill de score para eventos existentes.

SQL pendiente por ejecutar en Supabase:
- `supabase/migrations/20260515_phase4_match_confidence.sql`

Objetivo roadmap:
- Disponer de una señal cuantitativa de confianza para priorizar revision y reducir disputas no resolubles.

## 2026-05-15 (actualizacion 12)

### Roadmap MVP - API interna backend para pruebas E2E por curl
- Nueva migracion:
- [20260515_phase5_internal_api_helpers.sql](C:\Users\david\dev\musmatch\supabase\migrations\20260515_phase5_internal_api_helpers.sql)

Incluye:
- Helpers SQL internos con `security definer` limitados a `service_role`:
- `internal_create_event(...)`
- `internal_add_participant(...)`
- `internal_create_presence_token(...)`
- `internal_submit_presence_token(...)`
- `internal_submit_team_result(...)`
- `internal_admin_resolve_dispute(...)`
- `internal_resolve_timeouts()`
- `internal_get_event(...)`

Frontend/API (server-side Next.js):
- Cliente admin Supabase:
- [supabaseAdmin.ts](C:\Users\david\dev\musmatch\src\lib\server\supabaseAdmin.ts)
- Guard de autenticacion API interna:
- [internalApi.ts](C:\Users\david\dev\musmatch\src\lib\server\internalApi.ts)
- Wrapper RPC:
- [internalRpc.ts](C:\Users\david\dev\musmatch\src\lib\server\internalRpc.ts)
- Nuevas rutas:
- [health](C:\Users\david\dev\musmatch\src\app\api\v1\internal\health\route.ts)
- [create event](C:\Users\david\dev\musmatch\src\app\api\v1\internal\events\route.ts)
- [event inspect](C:\Users\david\dev\musmatch\src\app\api\v1\internal\events\[id]\route.ts)
- [participants](C:\Users\david\dev\musmatch\src\app\api\v1\internal\events\[id]\participants\route.ts)
- [presence token](C:\Users\david\dev\musmatch\src\app\api\v1\internal\events\[id]\presence\token\route.ts)
- [presence submit](C:\Users\david\dev\musmatch\src\app\api\v1\internal\events\[id]\presence\submit\route.ts)
- [result submit](C:\Users\david\dev\musmatch\src\app\api\v1\internal\events\[id]\result\route.ts)
- [resolve dispute](C:\Users\david\dev\musmatch\src\app\api\v1\internal\disputes\resolve\route.ts)
- [resolve timeouts](C:\Users\david\dev\musmatch\src\app\api\v1\internal\jobs\resolve-timeouts\route.ts)

Documentacion nueva:
- [INTERNAL_API.md](C:\Users\david\dev\musmatch\docs\INTERNAL_API.md)
- [DEPLOY_MVP.md](C:\Users\david\dev\musmatch\docs\DEPLOY_MVP.md)
- Estado de roadmap actualizado:
- [ROADMAP.md](C:\Users\david\dev\musmatch\docs\ROADMAP.md)

Variables nuevas requeridas para API interna:
- `SUPABASE_SERVICE_ROLE_KEY`
- `INTERNAL_API_KEY`

SQL pendiente por ejecutar en Supabase:
- Si no esta aplicado aun:
- `supabase/migrations/20260515_phase5_internal_api_helpers.sql`

## 2026-05-15 (actualizacion 13)

### Roadmap Fase 3 (parcial MVP) - Base PWA instalable

Implementado:
- Manifest web:
- [manifest.ts](C:\Users\david\dev\musmatch\src\app\manifest.ts)
- Registro de service worker en cliente:
- [PwaRegister.tsx](C:\Users\david\dev\musmatch\src\components\PwaRegister.tsx)
- Service worker base:
- [sw.js](C:\Users\david\dev\musmatch\public\sw.js)
- Metadata/viewport actualizados en layout:
- [layout.tsx](C:\Users\david\dev\musmatch\src\app\layout.tsx)

Objetivo:
- Permitir instalacion como app web en movil/escritorio para pruebas reales fuera de localhost.


## 2026-10-14 — GitHub Pages y PWA

Exportación estática con base /musmatch, detalle de partida por query, rutas OAuth corregidas, API interna preservada fuera del App Router, iconos PWA dimensionados, service worker limitado a MusMatch y aviso offline. Workflow con validación en PR y despliegue solo desde main. Build estático y TypeScript comprobados localmente con configuración pública de prueba. Backend activo, permisos y cron requieren validación independiente.


## 2026-10-14 — Fase 0: seguridad y CI

Migración versionada para permisos de perfiles/partidas, RPC allowlist, vistas con RLS, capacidad de equipos, invalidación de presencia, ELO aplicado una sola vez y timeout neutral con revisión. Retirada legacy vía RPC. Lint corregido sin desactivar reglas; TypeScript y build obligatorio. Tests con seis usuarios ficticios en PostgreSQL aislado, esquema limpio y variante heredada cloud; validación de export PWA. Ver PHASE_0.md para alcance y limitaciones.
