# Roadmap vigente — 2026-10-15

Esta secuencia sustituye la numeración del plan histórico de mayo que se conserva más abajo.

| Fase | Alcance | Estado |
| --- | --- | --- |
| 0 | Seguridad, contratos SQL, ELO idempotente, disputa neutral y CI | Implementada; protección administrativa de main pendiente |
| 1 | Responsive con prioridad móvil, navegación, accesibilidad básica y pruebas de navegador | Implementada; aceptación física iOS/Android pendiente |
| 2 | Reglas acordadas antes de apuntarse: 8/8 o 4/4, tantos, juegos/vacas y modo; contrato y filtros | Siguiente |
| 3 | Presencia QR sobre códigos cruzados existentes, caducidad y alternativa manual | Pendiente |
| 4 | Invitaciones, revisión de disputas y piloto cerrado | Pendiente |

Ver [PHASE_0.md](PHASE_0.md) y [PHASE_1.md](PHASE_1.md) para alcance, pruebas y limitaciones. No se considera terminada una función porque exista una pantalla: se exige validación de permisos, reglas y flujo real.

---

## Plan histórico (mayo de 2026)

# MusMatch - Roadmap de Implementacion

Fecha base: 2026-05-13

## Fase 0 (Semana actual)

Objetivo: estabilizar base tecnica y reglas de justicia.

1. Alineacion de datos y contratos
- Unificar esquema de `events` con frontend (`match_type`, `pair_mode`, `status`, `result_status`).
- Revisar y corregir firmas RPC usadas por UI.
- Crear carpeta `supabase/migrations` con SQL ordenado.

2. Disputa neutral (cambio de politica)
- Quitar penalizacion automatica al abrir disputa.
- Penalizar solo con evidencia o reincidencia.
- Definir estados de disputa: `OPEN`, `UNDER_REVIEW`, `RESOLVED_VALID`, `RESOLVED_INVALID`.

3. Seguridad
- Rotar claves y secretos expuestos.
- Revisar `.env.local` y documentar gestion segura.

Entregable Fase 0:
- Build estable.
- Schema/RPC alineados.
- Nueva politica de disputas documentada y aplicada.

## Fase 1 (1-2 semanas)

Objetivo: introducir prueba minima de partida real.

1. Check-in y presencia
- Check-in por jugador dentro de ventana.
- Codigo efimero cruzado entre equipos para validar presencia.
- Registro de timestamps y evidencia minima.

2. Ubicacion flexible
- Tipos de ubicacion:
- `PUBLIC_VENUE`
- `PRIVATE_LOCATION`
- Visibilidad de ubicacion privada solo para participantes confirmados.

3. Flujo de resultado robusto
- Timebox para confirmar resultado.
- Si no hay acuerdo, apertura de disputa sin penalizacion por defecto.

Entregable Fase 1:
- Match competitivo solo valido con 4 check-ins.
- Flujo de disputa justo en produccion.

## Fase 2 (2-4 semanas)

Objetivo: automatizar confianza y anti-abuso.

1. Match confidence score
- Calculo 0-100 con check-in, cercania y consistencia temporal.
- Reglas de auto-cierre segun umbrales.

2. Anti-multicuenta y anti-boost
- Alertas por patrones de cuentas repetidas.
- Limite de impacto ELO por repeticion sospechosa.
- Flags para revision admin.

3. Observabilidad
- Auditoria de acciones sensibles.
- Logs estructurados para disputas y sanciones.

Entregable Fase 2:
- Reduccion de disputas no resolubles.
- Menor superficie de fraude ELO.

## Fase 3 (Escalado)

Objetivo: crecer con experiencia movil real.

1. PWA completa
- Manifest, iconos, install prompt, offline basico.

2. Expansion geografica
- Multi-ciudad por radio geolocalizado.
- Parametrizacion por ciudad.

3. Mejora continua de reglas
- Ajuste de penalizaciones por datos reales.
- Ajuste de umbrales de confianza.

Entregable Fase 3:
- Operacion escalable y medible fuera de Vitoria.

## Primer sprint sugerido (accionable)

1. Migraciones SQL base + alineacion de columnas/events.
2. RPC de disputa neutral y politicas RLS asociadas.
3. Tabla/campos de check-in en `event_participants`.
4. UI minima de check-in en detalle de partida.
5. Documentacion de reglas en este repo (`MUSMATCH_PROJECT_GUIDE.md`).

## Estado a 2026-05-15 (MVP tecnico)

Completado para MVP:
1. Fase 0: alineacion de schema/RPC + disputa neutral + base estable.
2. Fase 1: protocolo robusto de resultado + timeout + presencia por codigo.
3. Fase 2: anti-boost ELO + auditoria + match confidence score.
4. API interna de pruebas backend (`/api/v1/internal/*`) para test E2E con `curl`.

Pendiente para escalado (no bloqueante para MVP):
1. PWA avanzada (offline real y push).
2. Expansion geolocalizada multi-ciudad.
3. Ajuste dinamico de reglas con datos en produccion.


## Actualización 2026-10-14

Fase 0 de preparación para el piloto: permisos por columna, allowlist RPC, protección de vistas, ELO idempotente, disputa neutral por timeout, pruebas PostgreSQL aisladas y CI por push/PR. Ver PHASE_0.md. La navegación responsive es la siguiente fase; el QR visual aún no está implementado. El scheduler de timeout y la protección administrativa de main requieren configuración aparte.
