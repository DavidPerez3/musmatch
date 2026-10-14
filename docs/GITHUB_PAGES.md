# MusMatch: pruebas en GitHub Pages

La web se exporta como archivos estáticos. Supabase sigue gestionando Auth, datos, RPC y Realtime.

## Configuración

- Settings > Pages > Source: GitHub Actions.
- Repository variables: NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.
- No añadir service_role al frontend ni al workflow.
- El workflow fija NEXT_PUBLIC_BASE_PATH=/musmatch.
- URL: https://davidperez3.github.io/musmatch/

En Supabase > Authentication > URL Configuration:
- Site URL: https://davidperez3.github.io/musmatch/
- Redirect URLs: https://davidperez3.github.io/musmatch/ y https://davidperez3.github.io/musmatch/reset-password/
- Conservar URLs locales necesarias.
- Google debe conservar el callback de Supabase: https://<project-ref>.supabase.co/auth/v1/callback.

## Navegación y PWA

Las partidas usan /events/?id=<uuid> para abrir partidas nuevas sin reconstruir la web.
Los iconos, manifest y service worker se limitan al subdirectorio de MusMatch.
Android: instalar desde el navegador; iPhone: Safari > Compartir > Añadir a pantalla de inicio.
Sin conexión se muestra una página de aviso. No se guardan respuestas de Supabase, cuentas ni resultados; gestionar partidas requiere conexión.

## API interna y jobs

Los antiguos Route Handlers se conservan en internal-api/v1/internal, fuera de src/app, para no exportar endpoints que requieren servidor. Las pantallas no los utilizan.
Para reactivar esas herramientas en un despliegue con servidor: devolver internal-api a src/app/api y retirar output: export; configurar sus claves solo en servidor.
GitHub Pages no ejecuta jobs. Configurar por separado un cron de Supabase que invoque public.resolve_pending_results_by_timeout(); verificar antes su funcionamiento y permisos.

## Validación pendiente en el backend activo

Antes de abrir las pruebas a otras personas: comprobar migraciones aplicadas y permisos de columnas de profiles (is_admin, ELO, fiabilidad), events y funciones privilegiadas. El SQL versionado contiene políticas amplias; desplegar la web no corrige esos permisos.
Probar login email/Google, recuperación, cuatro participantes, presencia, reportes coincidentes, disputa y timeout.

## Desarrollo local

npm ci
npm run dev

Definir las dos variables públicas de Supabase en .env.local. Para una exportación equivalente a Pages, usar NEXT_PUBLIC_BASE_PATH=/musmatch con npm run build. El resultado está en out/.
