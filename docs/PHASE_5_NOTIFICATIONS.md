# Fase 5 — Avisos y notificaciones push

Implementación: 20 de octubre de 2026. Complementa el simulador; no se generan avisos por sus partidas ni sus cuentas mock.

## Uso

La campana de la cabecera abre `/notifications/`. Muestra el número de avisos sin leer, una bandeja paginada con lectura explícita y preferencias por categoría. El contador y la bandeja se actualizan cada 30 segundos mientras la página está visible, al volver a la app y tras marcar avisos.

Se generan avisos transaccionales por:

- invitación a partida y rechazo; la aceptación aparece como incorporación a la mesa;
- incorporación, salida o cambio de equipo de otro jugador y cancelación de partida;
- primer reporte rival pendiente, resultado confirmado, disputa y resolución;
- recordatorio en la última hora antes de empezar, para quienes siguen apuntados;
- solicitud de amistad y aceptación.

Los administradores reciben avisos de disputas reales. Las invitaciones se abren en Mis partidas, donde se aceptan tras revisar las reglas. El resto enlaza a la partida o al perfil. No se notifican retroactivamente eventos históricos. Los recordatorios sí se aplican a próximas partidas existentes.

En Avisos → Activar en este dispositivo, la petición de permiso se realiza solo al pulsar. Hay envío de prueba propio, pausa global, preferencias compartidas y eliminación individual de dispositivos. La prueba se limita a una por minuto. Cerrar sesión intenta retirar el vínculo del servidor, con timeout de ocho segundos, y cancela la suscripción local. Cambiar de cuenta no reasigna silenciosamente una suscripción ajena.

En iOS/iPadOS se explica la necesidad de abrir la PWA instalada; si no hay soporte o el permiso está bloqueado, la bandeja continúa funcionando. La compatibilidad física en iOS sigue pendiente. El usuario confirmó la recepción real en Android el 20 de octubre de 2026.

## Arquitectura y permisos

- `notifications` y `notification_preferences`: solo SELECT de filas propias mediante RLS; cambios únicamente por RPC validada. Desactivar una categoría evita nuevos avisos y cancela push pendiente de esa categoría; los avisos anteriores se mantienen.
- `push_subscriptions`: sin acceso directo del navegador, ni siquiera a endpoints y claves. RPC de registro, listado de metadatos, comprobación propia y baja. Máximo diez dispositivos por cuenta. No se transfieren endpoints entre cuentas.
- `musmatch_private.push_runtime` y `push_outbox`: esquema privado sin permisos de cliente y con RLS defensiva. Los helpers de triggers no son RPC públicas.
- Clave VAPID privada generada por la función Edge y cifrada en Supabase Vault. Solo se publica la clave pública. Token aleatorio independiente para autenticar cada llamada del scheduler; no se guarda en git ni en el navegador.
- `push-dispatch`: `verify_jwt=false` porque usa la credencial privada del scheduler; rechaza solicitudes sin ese token antes de leer la cola. Un JWT de usuario no autoriza envíos.
- Endpoints de proveedores de navegador con allowlist en SQL y Edge; se rechazan credenciales, puertos, URLs internas y redirecciones. Cifrado Web Push y firma VAPID con `web-push@3.6.7`, importación fijada en Edge y dependencia local de desarrollo para comprobación y pruebas.
- Los payloads de la pantalla bloqueada son genéricos: sin título de partida, dirección, coordenadas, email, marcador ni claves. El service worker construye destinos dentro del ámbito `/musmatch/` y nunca navega a otro origen ni a otra app del mismo dominio.

## Cola y operación

`musmatch-push-dispatch` se ejecuta cada dos minutos con pg_cron. Genera recordatorios deduplicados y llama a la Edge Function mediante pg_net únicamente si falta inicializar VAPID o hay trabajo pendiente. No requiere proveedor de email ni suscripción a un servicio de notificaciones adicional; consume los recursos y cuotas habituales del proyecto Supabase.

Reclama hasta 30 entregas mediante `FOR UPDATE SKIP LOCKED`, con lease de tres minutos y token por intento. Envío en grupos de cinco, timeout de ocho segundos por proveedor y TTL de una hora. Reintentos con espera exponencial, máximo cinco intentos y caducidad de un día. HTTP 404/410 elimina la suscripción; 408/429/5xx reintentan; otros 4xx son terminales. Las confirmaciones antiguas no pueden modificar un lease nuevo. Las preferencias, lectura y vigencia de invitaciones/recordatorios se comprueban de nuevo al reclamar.

No se garantiza una entrega física exactamente una vez: un proveedor puede aceptar un mensaje y perderse su confirmación. La etiqueta estable por aviso permite agrupar reintentos en el dispositivo. La recepción también depende de red, permisos, navegador y ahorro de batería. El retraso habitual de la cola es hasta unos dos minutos, más los tiempos del dispositivo/proveedor.

Retención: avisos y dispositivos sin actividad durante 90 días. Abrir la app con una suscripción propia refresca su actividad sin activar otra vez los envíos pausados. Un navegador que rote o pierda su suscripción requerirá volver a activar desde Avisos.

### Configuración de un proyecto nuevo

1. Aplicar las migraciones y desplegar `supabase/functions/push-dispatch/index.ts` con `verify_jwt=false`.
2. Solo desde administración de base de datos, fijar `musmatch_private.push_runtime.edge_url` al endpoint de ese proyecto y `enabled=true`.
3. Ejecutar `select public.dispatch_push_notifications();` para inicializar las claves. No copiar ni imprimir la clave privada ni el token del scheduler.
4. Comprobar estado booleano de clave pública y referencia a Vault, y HTTP 200 en `net._http_response`.
5. Activar push desde una cuenta real y pulsar Enviar notificación de prueba. No crear suscripciones sintéticas persistentes en nube.

Para pausar el servicio completo: poner `enabled=false`. La bandeja sigue funcionando. Revisar cola con recuentos por estado, respuestas HTTP de pg_net y logs genéricos de Edge; no registrar endpoints o secretos.

## Verificación

- 63 pruebas backend/Edge/service worker (también modo cloud drift): RLS, estados de partidas, opt-in, preferencias, deduplicación, límites, aislamiento del simulador, leases, retries, endpoints expirados, SSRF, cifrado Web Push y firma VAPID reales con transporte simulado, destinos y foco del service worker.
- 53 pruebas de navegador: incluye 11 nuevas para bandeja, contador, lectura, preferencias, permiso explícito, registro/baja, prueba propia, errores, instrucciones iOS y cinco anchos de pantalla de 320 a 1440 px. Backend y PushManager aislados: no se envían pruebas a personas reales.
- Lint, TypeScript (incluidas ambas Edge Functions), build y dos verificaciones de exportación estática.
- Nube: migración aplicada, Edge ACTIVE, VAPID inicializado en Vault, scheduler con respuesta 200; registro, bandeja, aislamiento entre cuentas y reclamación probados en una transacción con ROLLBACK, sin entregas externas ni fixtures persistentes.
- Advisors: ningún ERROR nuevo. Los INFO de RLS sin políticas en tablas exclusivamente servidor son intencionados. Las advertencias de API/GraphQL autenticada reflejan las tablas propias y RPC explícitas con autorización comprobada; permanecen las advertencias previas de citext en public y protección de contraseñas filtradas. Referencias: https://supabase.com/docs/guides/database/database-linter y https://supabase.com/docs/guides/auth/password-security.

La recepción real en Android ha sido confirmada por el usuario. El pulido posterior de actualización PWA se documenta en PHASE_5_PWA.md; el piloto con usuarios reales sigue pendiente.
