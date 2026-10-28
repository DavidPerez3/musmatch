# Fase 7 — Descubrimiento, ayuda y enlaces de partida

## Auditoría previa

Base: `main` en `e13865f` (28 de octubre de 2026).

Ya existían: CTA Crear partida en portada, creación en navegación móvil, filtros, autenticación email/Google, perfiles, parejas y amistades, invitaciones con aceptación, reglas acordadas, QR/código de presencia, validación rival, ELO y revisión de disputas, notificaciones, PWA con actualización consentida y exportación estática con `/musmatch/`.

No había ayuda/FAQ pública, páginas de privacidad/condiciones, 404 temática, sitemap, robots ni metadatos por pantalla. El acceso a una partida recibida sin sesión perdía el destino al ir al login. La portada invitada no explicaba el carácter presencial ni el proceso completo.

## Implementación

- Conserva tapete, baraja española, CTA y navegación. Introducción de tres pasos compacta y enlace a ayuda; Buscar partida y Crear reutilizan el login y Registrarse abre su pestaña. No consulta partidas para visitantes sin sesión.
- Ayuda estática con detalles nativos, operables por teclado, y enlaces a funciones existentes. ELO descrito desde `apply_match_elo_live` en `20261019163531_phase5_simulator.sql`: medias de equipos, escala 400, K32, redondeo, factor por repeticiones (se filtra por creación de partidas en últimos 7 días), aplicación idempotente. No se cambia la fórmula.
- 404 exportada a `out/404.html`, respuesta 404 en el servidor de prueba que reproduce Pages, recuperación mediante enlaces absolutos respecto al ámbito. Sin redirección SPA que oculte errores.
- Compartir solo en detalle de partidas ordinarias cargadas con permisos actuales. Web Share, copiar con confirmación y alternativa manual, y enlace WhatsApp iniciado por el usuario. Mensaje genérico + URL construida desde origen actual, basePath y UUID, sin parámetros extras, fragmentos, título, notas, fechas, direcciones, coordenadas, nombres ni códigos. No publica tarjetas ni genera imágenes. Enlace no equivale a invitación, aceptación ni inscripción. No modifica RLS.
- Retorno de acceso con allowlist estricta de destinos (crear, búsqueda, partida UUID). Email vuelve al destino; Google conserva la URL callback raíz ya configurada y guarda temporalmente el destino en sessionStorage de esta pestaña (30 min, consumo único). Si falta username se conserva en la ruta de perfil hasta guardar. No acepta URLs externas, rutas admin, parámetros duplicados ni separadores codificados. Si el navegador bloquea storage, el login funciona pero puede requerir reabrir el enlace tras Google. No promete continuidad entre dispositivos ni tras caducar.
- Pie discreto y acceso desde Más opciones a la ayuda; aviso/enlaces también en formulario de acceso. Privacidad y condiciones son documentos provisionales explícitos, no declaraciones de cumplimiento.
- Metadata por sección y `noindex,nofollow` por defecto, incluidas cuentas, ranking, usuarios, administración, partidas parametrizadas, piloto y simulador. Inicio/ayuda tienen título, descripción, canonical y OG de texto genérico; no se intenta producir OG dinámico de partidas en exportación estática. No se prerenderizan datos de jugadores ni IDs reales.
- Sitemap con allowlist de inicio y ayuda, sin fechas artificiales. Robots estático y noindex complementarios. No se bloquea el rastreo de HTML privado para que los buscadores puedan leer noindex: los controles de acceso siguen siendo los existentes, no el SEO.
- Estados de carga/anuncios de copia/error accesibles, foco y áreas seguras existentes; scroll-padding inferior para navegación fija.

## Limitaciones reales y tareas pendientes

`https://davidperez3.github.io/musmatch/robots.txt` es una ruta de proyecto. Los robots buscan las reglas en `https://davidperez3.github.io/robots.txt`; este repositorio no puede instalar ese archivo en la raíz del host ni cambiar otras apps. El sitemap exportado puede enviarse manualmente a Search Console por quien gestione la propiedad. No se ha conectado ni enviado nada a Search Console. Si se adopta un dominio propio, deben revisarse `src/lib/site.ts`, sitemap/canonical y las URLs de Auth/PWA.

El aviso de privacidad refleja código, no una auditoría de contratos/configuración legal de proveedores. Antes de producción faltan identidad/contacto del responsable, bases jurídicas por finalidad, retención de cuentas/historial/incidencias/auditoría/copias, proveedores/región/transferencias, canal y procedimiento de derechos, edad aplicable y condiciones definitivas. No existe todavía borrado/exportación integral de cuenta. No se han inventado datos, añadido checkbox de aceptación ni bloqueado el piloto.

Las vistas previas de enlaces son genéricas por las limitaciones del hosting estático y el acceso autenticado. Los parámetros `id` no se incorporan al sitemap ni a metadata de build. Acceder con enlace sigue necesitando cuenta, username y permisos; el código cliente no amplía el acceso a direcciones privadas.

## Validación

Pruebas aisladas con backend simulado; ninguna invitación, WhatsApp, notificación o alta real enviada. Tests adicionales de allowlist/caducidad, HTML exportado/SEO/sitemap/404 y navegador: invitado, registro, login email, retorno OAuth, perfil incompleto, compartir nativo/cancelado/error, clipboard ausente/denegado, WhatsApp, ayuda con teclado y responsive 320/390/768/1440. Se conservan las pruebas previas de partidas, presencia, disputas, notificaciones, PWA y piloto.

Comandos: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:drift` (CI), `npm run build`, `npm run test:export`, `npm run test:ui`. Verificación final del despliegue: inicio, ayuda, privacidad, condiciones, sitemap, robots y una URL inexistente con estado 404 y enlaces bajo `/musmatch/`.

## Referencias contrastadas

- Next exportación: https://nextjs.org/docs/app/guides/static-exports
- Next robots: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots
- GitHub Pages 404: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site
- Google: robots no sustituye a noindex ni autenticación: https://developers.google.com/search/docs/crawling-indexing/robots/intro
- AEPD, información por completar: https://www.aepd.es/derechos-y-deberes/conoce-tus-derechos/derecho-de-informacion
- Supabase OAuth: https://supabase.com/docs/reference/javascript/auth-signinwithoauth

Changelog Supabase revisado (28/10): sin cambios de API necesarios para esta fase; no se usan SDKs ni adaptadores nuevos y no se realizan migraciones ni cambios de Auth en nube.
