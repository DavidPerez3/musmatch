# Fase 5 — Actualizaciones PWA y conexión

20 de octubre de 2026. La instalación y la recepción push en Android están confirmadas por el usuario. El piloto con cuatro personas y la comprobación física iOS siguen pendientes.

## Comportamiento

- Al encontrar una versión lista, aparece un aviso con **Actualizar y recargar** y **Más tarde**. No se recarga la página automáticamente al detectar la versión.
- Si se ha editado un campo, se pide confirmación adicional antes de recargar. Es una detección conservadora: puede avisar también de cambios que ya se hayan guardado. No se guardan borradores de formularios ni contraseñas en almacenamiento offline.
- Más tarde oculta el aviso durante esa sesión del componente. **Más opciones → Buscar actualizaciones** permite volver a mostrarlo o comprobar que la app está al día.
- Se comprueba al registrar el worker, al volver a primer plano (limitado a una comprobación por minuto) y cada quince minutos mientras la app está visible. El control manual no está sujeto a ese intervalo.
- Solo recarga automáticamente la pestaña cuyo usuario pidió actualizar. Las otras conservan su formulario y reciben un aviso informativo de la nueva versión activa.
- La primera instalación no solicita actualizar. Si todas las ventanas antiguas se cierran, el navegador puede activar la versión pendiente mediante su ciclo normal.
- El navegador ofrece una pista de estado sin conexión. Al recuperar red se muestra un mensaje, sin recargar la pantalla ni repetir acciones. `navigator.onLine` no demuestra disponibilidad de Supabase; no sustituye los errores que devuelve cada operación ni bloquea globalmente los formularios.
- Una navegación que falla por red muestra una pantalla genérica, adaptada al móvil. Mantiene la URL original, incluidos parámetros. **Reintentar** vuelve a esa ruta. Recuperar conexión no recarga por sorpresa.

## Worker y exportación

`npm run build` ejecuta Next y después `scripts/prepare-pwa.mjs`. El segundo paso genera un identificador de versión a partir del BUILD_ID y las plantillas públicas, y prepara `out/sw.js` con los JS/CSS públicos de la exportación. No lee archivos de credenciales ni incorpora valores de entorno adicionales. Una publicación nueva cambia el worker aunque su lógica no cambie.

Instalar una versión precarga el offline genérico, iconos y assets inmutables. Si una descarga falla, se elimina esa caché incompleta y se conserva la versión activa. La nueva versión espera consentimiento: el worker solo acepta `MUSMATCH_SKIP_WAITING` de una ventana del mismo origen y ámbito de MusMatch.

La activación conserva la versión actual y una anterior; borra únicamente cachés de MusMatch. Los chunks de la anterior siguen disponibles para otra pestaña que aún no se haya recargado. Las pestañas que atraviesen más de dos publicaciones deben recargar para actualizarse. La disponibilidad del almacenamiento depende del navegador; no es una copia de seguridad.

Las navegaciones siguen usando red; nunca se cachean HTML autenticado, payloads de navegación de Next, respuestas de Supabase, OAuth, ubicaciones privadas ni acciones. La caché anterior de la PWA solo contenía assets públicos y puede conservarse durante la primera transición. Push y suscripciones mantienen el mismo ámbito y no se vuelven a pedir permisos por actualizar.

La primera transición desde la versión anterior puede necesitar una recarga para cargar la interfaz nueva de actualización. En adelante el aviso permite elegir el momento.

## Validación

- 67 pruebas backend/Edge/worker, tanto esquema estándar como cloud drift. Los tests del worker cubren consentimiento, aislamiento de otras apps, retención de una versión anterior, descarga incompleta y ausencia de caché de datos personales.
- 55 pruebas de navegador. Las dos nuevas ejecutan workers reales en servidores locales aislados: primera instalación, dos publicaciones, posponer/cancelar/aceptar actualización, campos conservados, otra pestaña sin recarga, URLs con query, corte y recuperación de red, fallback offline y cachés inspeccionadas. También se comprueba el ancho móvil de 320 px.
- Tres verificaciones del export: ámbito/manifest, rutas públicas y worker compilado con catálogo exclusivamente de JS/CSS públicos existentes.
- Lint, TypeScript, build y pipeline por push/PR. No requiere migración ni cambiar claves de Supabase.

Referencias de implementación: https://web.dev/learn/pwa/update, https://web.dev/articles/service-worker-lifecycle, https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine.

La fase 5 queda implementada. Siguiente bloque: piloto real con cuatro jugadores, validación física iOS y preparación operativa del MVP público (fase 6).
