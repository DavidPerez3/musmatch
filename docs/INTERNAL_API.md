# MusMatch - Internal API (MVP)

Fecha: 2026-05-15

Objetivo:
- Probar flujos backend completos por `curl` sin cambiar de cuenta en UI.
- Ejecutar acciones sensibles con `service_role` de forma controlada.

## 1) Variables de entorno requeridas

En el entorno donde corre Next.js:

```env
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
INTERNAL_API_KEY=...
```

Importante:
- `SUPABASE_SERVICE_ROLE_KEY` e `INTERNAL_API_KEY` nunca en cliente.
- Todas las rutas de este documento exigen header `x-internal-api-key`.

## 2) Header comun

```bash
-H "x-internal-api-key: TU_INTERNAL_API_KEY"
```

Base URL local:

```bash
http://localhost:3000
```

## 3) Endpoints

### 3.1 Health

```bash
curl -X GET "http://localhost:3000/api/v1/internal/health" \
  -H "x-internal-api-key: TU_INTERNAL_API_KEY"
```

### 3.2 Crear partida

```bash
curl -X POST "http://localhost:3000/api/v1/internal/events" \
  -H "Content-Type: application/json" \
  -H "x-internal-api-key: TU_INTERNAL_API_KEY" \
  -d '{
    "actor_user_id":"UUID_USER_1",
    "title":"Test MVP interna",
    "match_type":"COMPETITIVE",
    "pair_mode":"FIXED_PAIR",
    "starts_at":"2026-05-15T20:00:00Z",
    "location_text":"Vitoria-Gasteiz",
    "notes":"flujo backend"
  }'
```

### 3.3 Anadir participante

```bash
curl -X POST "http://localhost:3000/api/v1/internal/events/EVENT_ID/participants" \
  -H "Content-Type: application/json" \
  -H "x-internal-api-key: TU_INTERNAL_API_KEY" \
  -d '{
    "user_id":"UUID_USER_2",
    "team":"A"
  }'
```

`team` puede ser `"A"`, `"B"` o `null`.

### 3.4 Generar codigo de presencia

```bash
curl -X POST "http://localhost:3000/api/v1/internal/events/EVENT_ID/presence/token" \
  -H "Content-Type: application/json" \
  -H "x-internal-api-key: TU_INTERNAL_API_KEY" \
  -d '{
    "actor_user_id":"UUID_USER_1"
  }'
```

### 3.5 Validar codigo de presencia rival

```bash
curl -X POST "http://localhost:3000/api/v1/internal/events/EVENT_ID/presence/submit" \
  -H "Content-Type: application/json" \
  -H "x-internal-api-key: TU_INTERNAL_API_KEY" \
  -d '{
    "actor_user_id":"UUID_USER_3",
    "token":"ABC123"
  }'
```

### 3.6 Reportar resultado por equipo

```bash
curl -X POST "http://localhost:3000/api/v1/internal/events/EVENT_ID/result" \
  -H "Content-Type: application/json" \
  -H "x-internal-api-key: TU_INTERNAL_API_KEY" \
  -d '{
    "actor_user_id":"UUID_USER_1",
    "winner_team":"A",
    "result_score":"3-1"
  }'
```

Respuesta esperada (`status`):
- `PENDING_OTHER_TEAM`
- `CONFIRMED_AUTO`
- `DISPUTED_AUTO`

### 3.7 Resolver timeouts de resultados pendientes

```bash
curl -X POST "http://localhost:3000/api/v1/internal/jobs/resolve-timeouts" \
  -H "x-internal-api-key: TU_INTERNAL_API_KEY"
```

### 3.8 Resolver disputa como admin

```bash
curl -X POST "http://localhost:3000/api/v1/internal/disputes/resolve" \
  -H "Content-Type: application/json" \
  -H "x-internal-api-key: TU_INTERNAL_API_KEY" \
  -d '{
    "admin_user_id":"UUID_ADMIN",
    "match_id":"EVENT_ID",
    "winner_team":"B",
    "apply_elo":true
  }'
```

### 3.9 Inspeccionar estado de una partida

```bash
curl -X GET "http://localhost:3000/api/v1/internal/events/EVENT_ID" \
  -H "x-internal-api-key: TU_INTERNAL_API_KEY"
```

## 4) Flujo E2E recomendado para pruebas

1. Crear partida competitiva.
2. Anadir 4 participantes (2 por equipo).
3. Cruce de presencia (generar token y validarlo por jugadores del rival).
4. Enviar resultado de equipo A y luego B.
5. Comprobar auto-confirmacion o disputa.
6. Si hay timeout, ejecutar endpoint de `resolve-timeouts`.
7. Inspeccionar estado final del evento.

## 5) Seguridad minima en produccion

1. Permitir estas rutas solo para uso interno (API key larga y rotacion periodica).
2. Limitar por IP en reverse proxy si es posible.
3. No exponer `SUPABASE_SERVICE_ROLE_KEY` al cliente.
4. Registrar cada uso interno en logs del proveedor cloud.
