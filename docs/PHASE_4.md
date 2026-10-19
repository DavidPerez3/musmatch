# Fase 4 — Invitaciones, ubicaciones y revisión de partidas

## Invitaciones y gestión

Crear con pareja fija envía una invitación al amigo, sin inscribirlo automáticamente. Mis partidas permite revisar las reglas y aceptar o rechazar. El organizador puede invitar a amigos a A o B desde Gestionar partida. No se reservan plazas: la aceptación bloquea el evento y comprueba capacidad (cuatro jugadores, dos por equipo), pertenencia, fecha y estado. Solo el destinatario puede responder. La bandeja y el indicador incluyen invitaciones pendientes; no hay email ni push.

Los inscritos pueden salir mientras se admitan cambios; se invalidan las pruebas de presencia y se puede cubrir la vacante. No se añade expulsión unilateral ni sanción automática. Para cambiar fecha, reglas o lugar se cancela y se crea otra partida, evitando modificar lo acordado por los inscritos.

El organizador puede cancelar una partida abierta/completa sin resultado, con motivo. Se cancelan invitaciones y caducan códigos sin afectar al ELO. Mis partidas muestra canceladas/anuladas y partidas cuya fecha pasó pero siguen sin cerrar. No se inventa un resultado por el transcurso del tiempo.

## Ubicaciones

Selector de local del catálogo, establecimiento/punto público OSM o manual, y lugar privado. Bar Indartsu y Taberna Txustarra son candidatos **sin colaboración confirmada**: no se inventan direcciones, coordenadas, horarios, aforos ni permisos. Solo administración de la base puede verificar un colaborador; los clientes no pueden escribir en el catálogo.

Búsqueda explícita por nombre/municipio y bares/pubs/cafeterías en un radio de 1,5 km. No hay autocompletado ni solicitudes al escribir. La ubicación se pide solo al pulsar. Los resultados muestran dirección, lista y mapa OSM con atribución; también se admiten coordenadas manuales. Los fallos o la falta de permiso GPS no impiden escribir el lugar.

La función `place-search` valida el usuario con Auth, mantiene la clave administrativa únicamente en el servidor, emplea caché de 24 horas y límites compartidos transaccionales: dos segundos entre consultas externas y cinco por cuenta. La posición cercana se redondea a tres decimales antes de enviarla. No se guarda en perfiles; clientes no pueden consultar la caché ni alterar los límites. Las consultas por nombre se envían al proveedor: no introducir datos personales.

Nominatim/Overpass comunitarios son la configuración del **piloto pequeño**, sin garantía de disponibilidad para el lanzamiento comercial. Las variables de servidor `NOMINATIM_URL` y `OVERPASS_URL` permiten cambiar a servicios compatibles propios o de proveedor antes de crecer. Los mapas no se descargan para uso offline.

La dirección privada vive en `match_locations`, con RLS para organizador, participantes y administración. En `events` y sus vistas solo aparece la zona aproximada indicada. Una invitación pendiente no concede acceso; salir retira acceso en nuevas consultas, aunque no borra información ya vista. Los lugares privados no se envían al buscador ni al iframe. El formulario advierte que título, zona y notas son públicos para usuarios autenticados. La migración protege también ubicaciones privadas heredadas (no había ninguna en cloud al revisar).

Seleccionar un local **no reserva mesa** ni acredita permiso o aforo. La creación exige que el organizador confirme que gestionará disponibilidad/autorización y respetará las normas. Esa confirmación no se presenta como una exención legal general.

## Revisión de disputas

El panel muestra ambos reportes, reglas, participantes/check-ins y número de pruebas. Una resolución exige motivo de 10–1000 caracteres y registra administrador, fecha, decisión y ELO en `match_reviews`, visible a participantes y administración. Permite anular sin ganador ni ELO. La victoria conserva el reporte válido elegido y solo aplica ELO si se solicita y se cumplen los cuatro check-ins. La RPC administrativa antigua deja de ser ejecutable por clientes, para no eludir la revisión. No se permite resolver dos veces ni revertir ELO ya aplicado.

La resolución y su motivo aparecen en el detalle. Se elimina el enlace al buzón de soporte no confirmado. El historial distingue pendientes y canceladas de derrotas, incluido el resultado nulo, y ordena las partidas por fecha.

## Verificación y límites

38 pruebas de base de datos/endpoint en esquema limpio y en reproducción del esquema heredado: privacidad por API/vistas y tras salir, consentimiento/capacidad/repetición de invitaciones, cancelaciones, resoluciones justificadas, permisos del catálogo, caché y límites globales. Auth/proveedores se simulan en los tests de búsqueda; no se crean usuarios ni partidas en cloud. TypeScript comprueba también el handler Edge frente al cliente versionado.

30 pruebas de navegador: las anteriores de responsive/QR más creación privada, resultado OSM y candidatos, denegación GPS, aceptación, cancelación, revisión e historial. Se mantienen seis tamaños de pantalla y decodificación real de vídeo QR sintético.

La migración está aplicada y `place-search` desplegada con JWT obligatorio. Pendientes para fase 5: simulador interactivo de los tres mocks, avisos más completos y pulido PWA. El piloto con personas reales y la aceptación física de iOS siguen pendientes; esta fase entrega sus flujos, no declara realizadas esas pruebas.

La revisión de seguridad no devuelve errores. Mantiene los avisos ya conocidos sobre citext, exposición autenticada de las APIs y protección de contraseñas filtradas. La caché y los límites tienen RLS sin políticas deliberadamente: únicamente `service_role` dispone de permisos. Referencias: [RLS sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [funciones privilegiadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) y [protección de contraseñas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Verificados en cloud: las seis tablas con RLS; la antigua resolución administrativa, la creación anónima y la función de límites no son accesibles a sus roles no autorizados. El endpoint desplegado rechaza peticiones sin JWT con 401. La búsqueda con sesión real queda para la aceptación del usuario; los proveedores y Auth se simulan en CI.
