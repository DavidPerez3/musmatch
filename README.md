# MusMatch

Aplicacion web para organizar partidas de mus 2vs2, con modos amistoso y competitivo, emparejamiento, validacion de presencia y sistema de resultados/disputas.

## Stack

- Next.js 16 + React 19 + TypeScript
- Supabase (Postgres, Auth, RLS, RPC)

## Estado actual MVP

- Flujo de partidas completo (crear, unirse, equipos, cola NEED_PARTNER).
- Presencia competitiva por codigos cruzados entre rivales.
- Resultado por equipos con confirmacion automatica o disputa.
- Timeout de respuesta rival con auto-resolucion.
- Penalizacion de fiabilidad por no respuesta/no-show.
- Anti-boost ELO por repeticion sospechosa.
- Match confidence score y auditoria estructurada.
- API interna `/api/v1/internal/*` para pruebas backend por `curl`.

## Despliegue PWA en GitHub Pages

Ver [configuración y pruebas](docs/GITHUB_PAGES.md). La API interna se conserva en `internal-api/`, fuera de la web estática. Las pantallas utilizan Supabase directamente.

## Arranque local

```bash
npm install
npm run dev
```

## Variables de entorno minimas

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## Documentacion clave

- [Guia del proyecto](docs/MUSMATCH_PROJECT_GUIDE.md)
- [Roadmap](docs/ROADMAP.md)
- [Worklog](docs/WORKLOG.md)
- [API interna para pruebas](docs/INTERNAL_API.md)
- [Guia de deploy MVP](docs/DEPLOY_MVP.md)

## Migraciones SQL

Ver carpeta `supabase/migrations`. Ejecuta las migraciones en orden cronologico.
