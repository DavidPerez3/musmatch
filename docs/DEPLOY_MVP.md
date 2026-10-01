# MusMatch - Deploy MVP (Cloud)

Fecha: 2026-05-15

## 1) Arquitectura MVP recomendada

1. Frontend + API en Next.js (Vercel o similar).
2. Base de datos/Auth en Supabase.
3. Jobs periodicos para timeout de resultados.

## 2) Checklist previo

1. Ejecutar todas las migraciones en Supabase (incluida fase 5 interna).
2. Revisar usuarios admin (`profiles.is_admin = true`).
3. Configurar variables de entorno en cloud:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `INTERNAL_API_KEY`
4. Rotar secretos antiguos que hayan quedado en local.

## 3) Dominio

1. Comprar dominio en registrador (Cloudflare, Namecheap, etc).
2. Apuntar DNS al proveedor donde despliegues Next.js.
3. Activar HTTPS obligatorio.

## 4) Cron/Jobs obligatorios

Debe ejecutarse periodicamente:

```sql
select public.resolve_pending_results_by_timeout();
```

Opciones:
- Supabase cron (si lo tienes habilitado).
- Job externo (GitHub Actions, cron cloud, o endpoint interno `/api/v1/internal/jobs/resolve-timeouts`).

## 5) Verificacion post-deploy

1. Login/registro funcionando.
2. Crear partida y unirse 4 jugadores.
3. Check de presencia y reporte de resultado competitivo.
4. Forzar un caso en disputa y resolver desde admin.
5. Validar que timeout resuelve pendientes.

## 6) Siguiente iteracion recomendada (post-MVP)

1. Endpoints publicos versionados para app movil nativa.
2. Notificaciones push (resultado pendiente, disputa, partida cercana).
3. Hardening anti-abuso (device fingerprint opcional y reglas avanzadas).
