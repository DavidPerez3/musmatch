# Fase 3 — Presencia por QR y código manual

## Uso

En una partida competitiva, al completar dos equipos de dos, cada jugador genera su QR en Presencia. Debe mostrarlo a un rival y escanear el de un rival. El check-in individual requiere prueba saliente y entrante; con cuatro jugadores validados se habilita el formulario de resultado. El orden de las cuatro validaciones es libre.

El QR se lee dentro de MusMatch con «Escanear rival», no con un lector externo. Si falla o se deniega la cámara, se introduce el código de seis caracteres en la misma sección. Ambos caminos usan la misma RPC y las mismas validaciones. Hay un botón para actualizar el progreso si no llega Realtime.

## Protocolo

- Código de dos minutos, vinculado en servidor a cuenta autenticada y partida. Cada código se consume una sola vez.
- Renovación a partir de treinta segundos; el anterior queda caducado. Una pulsación dentro del periodo de espera reutiliza el código activo; si ya se consumió, exige esperar antes de emitir otro. Se muestra la cuenta atrás.
- Los códigos activos anteriores al despliegue adoptan como máximo otros dos minutos de vida; no se eliminan pruebas ya aceptadas.
- Generación y validación requieren cuatro plazas con equipo, estado OPEN/FULL y ausencia de disputa. El bloqueo de fila de evento serializa estas operaciones con los cambios de mesa.
- Cambiar la composición sigue invalidando códigos y pruebas, según fase 0. Las partidas cerradas no permiten nuevas validaciones.
- El QR contiene solo identificador de partida y código en un formato versionado `musmatch:presence:v1:…`. No incluye datos de perfil, claves de API ni tokens de sesión. El lector no navega a URLs; rechaza formatos ajenos y otras partidas antes de contactar con la RPC.
- Los rechazos por código propio, compañero, caducado o consumido se muestran en la página. No se habilita ELO por leer una imagen: siguen siendo necesarios los cuatro check-ins y los reportes por equipos.

La caducidad es la del código, no la de una prueba ya aceptada. Este mecanismo acredita un intercambio de retos entre cuentas; no demuestra ubicación física ni que hayan jugado. Una fotografía compartida a distancia sigue siendo una limitación conocida. No se solicita GPS.

## Cámara y privacidad

Se pide permiso solo después de pulsar Escanear, con preferencia por cámara trasera y sin audio. jsQR decodifica fotogramas localmente: las imágenes no se suben, guardan ni envían a un servicio externo. El QR propio se dibuja localmente con qrcode. Las dependencias están versionadas y se cargan al necesitarlas.

El stream y el temporizador se detienen al detectar un QR, cerrar el escáner, navegar, ocultar la pestaña o pasar un minuto sin detección. También se libera una concesión de cámara que llegue después de cerrar. Los errores de permiso, dispositivo ausente/ocupado o navegador incompatible mantienen la alternativa manual. La lectura usa getUserMedia y canvas, sin depender de BarcodeDetector.

## Migración cloud

`20261016112723_phase3_presence_qr.sql` aplicada en MusMatch. Se verificaron los permisos autenticados, la ausencia de acceso anónimo y search_path de las tres RPC. Los avisos del analizador de seguridad son los ya documentados en fase 0; no aparecen errores nuevos.

## Verificación

26 escenarios SQL en esquema limpio y heredado. Se conservan las 24 pruebas previas y se comprueban duración exacta, reutilización durante espera, renovación, rechazo del anterior, enfriamiento tras consumir, pertenencia a partida, mesa incompleta y cierre/disputa.

23 pruebas de navegador: las 12 previas y 11 de presencia. Incluyen decodificación de un fotograma de vídeo sintético con el lector real, lectura independiente de los píxeles del QR propio, una sola validación, audio desactivado, QR ajeno/malformado, permiso denegado, cámara ausente/ocupada, cierre/cambio de pantalla/segundo plano, concesión tardía, caducidad, renovación, mesa incompleta y transición a los cuatro check-ins.

Auth y HTTP de las pruebas están interceptados; los usuarios sintéticos no se crean en Supabase cloud. Lint, TypeScript, tests SQL en ambos esquemas, build estático, export y navegador forman parte del job build antes de publicar.

Pendiente: aceptación de cámara con teléfonos Android e iOS reales. La cámara de CI es una fuente de vídeo simulada; no reproduce enfoque, iluminación o peculiaridades de permisos de cada dispositivo. La prueba Android que el usuario confirmó en fases anteriores no acredita todavía este escáner nuevo.

## Siguiente fase

Fase 4: invitaciones con aceptación individual del compañero, revisión administrativa de disputas y piloto cerrado. La protección administrativa de main sigue pendiente de configurar en GitHub.

## Referencias

- [jsQR](https://github.com/cozmo/jsQR)
- [qrcode](https://github.com/soldair/node-qrcode)
- [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
