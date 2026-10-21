# Fase 6 — Piloto presencial

21 de octubre de 2026. Estado: herramientas publicadas para iniciar el piloto; la quedada y su aceptación siguen pendientes. Las verificaciones automatizadas y las pruebas transaccionales no se registran como partidas presenciales.

## Cómo empezar

Acceso desde Más opciones → Piloto e incidencias (`/pilot/`). Cada participante debe usar su propia cuenta. El organizador crea una partida desde el flujo habitual, acuerda reglas, fecha y lugar con los demás y la incorpora al seguimiento desde Piloto. Añadirla no cambia sus reglas, ELO, participantes, fecha ni estado.

Las simulaciones, mesas con mocks, partidas con reglas históricas desconocidas y partidas canceladas no se pueden incorporar. Los mocks existentes permanecen disponibles en el simulador. No se crean cuentas, fechas, invitaciones a personas o reservas automáticamente. Indartsu y Txustarra siguen siendo locales candidatos: hay que acordar permiso y disponibilidad antes de quedar; elegir una ubicación no reserva mesa.

### Primera sesión: amistosa

1. Cada persona inicia sesión en su móvil. Comprobad que los nombres y la cuenta sean los correctos.
2. El organizador crea la partida con reglas explícitas: variante 4/4 u 8/8, tantos, juegos y vacas. Añade la partida al piloto.
3. Probáis invitación y aceptación de pareja; los rivales se apuntan a la misma partida. Comprobad dos jugadores en cada equipo y la misma fecha/ubicación/reglas en los cuatro dispositivos.
4. Activad opcionalmente push y enviad una prueba desde Avisos en cada móvil. No basta con que funcione en el del organizador.
5. Jugad y publicad los resultados de ambos equipos. Confirmad que el historial distingue ganadores/perdedores y que el ELO no cambia. La amistosa no exige presencia verificada.

### Segunda sesión: competitiva

1. Cread otra partida competitiva con cuatro cuentas reales y añadidla al piloto.
2. Antes de empezar, intercambiad los QR/códigos entre rivales en ambos sentidos hasta que los cuatro aparezcan con registro validado. Si una cámara falla, probad la alternativa manual y registrad la incidencia.
3. Jugad y publicad el resultado que realmente se haya producido, con el marcador A–B acordado. Confirmad que un solo reporte queda pendiente y que los dos reportes coincidentes cierran la partida.
4. Actualizad Piloto. Comprobad los cuatro registros, los dos reportes, el resultado confirmado y el indicador de ELO aplicado. Cada jugador revisa su perfil y el ranking.
5. Los registros técnicos no certifican por sí solos presencia física: documentad quién estuvo realmente en la quedada al revisar la sesión, sin incluir domicilios o datos sensibles en incidencias.

Las pruebas deliberadas de disputas, timeouts, abandonos o resultados falsos se mantienen en el simulador. Si una disputa sucede realmente durante el piloto, usad el flujo normal de revisión administrativa y documentad lo sucedido; no inventéis un acuerdo para cerrarla.

## Incidencias y revisión

El formulario recoge título, pasos, resultado esperado, resultado observado, apartado e impacto. Puede asociarse a una partida propia, participada o a la que el usuario haya sido invitado; las simulaciones están excluidas. La interfaz ofrece las partidas en seguimiento visibles para esa cuenta; un fallo anterior a la inscripción puede comunicarse sin partida asociada.

El reporte incluye únicamente etiquetas de plataforma, familia del navegador y modo app/navegador, derivadas localmente. No se adjuntan IP, user-agent completo, ubicación, viewport preciso, capturas, consola, tokens o códigos de presencia. El usuario ve qué se guardará antes de enviarlo. Debe evitar datos personales ajenos o secretos en el texto libre. La información de dispositivo es diagnóstico indicado por el cliente, no una prueba de identidad.

Solo el autor y administración pueden leer el contenido. Un compañero de partida no puede leer los reportes de otro. El autor no puede alterar directamente autor, contenido, prioridad, revisión o estado desde la API. Estados: abierta, en revisión, resuelta y descartada. La revisión exige una nota de 10–1000 caracteres, visible para el autor. Hay control de revisión optimista para evitar sobrescribir cambios de otro administrador; la auditoría guarda IDs, transiciones y revisión, sin copiar los textos del reporte.

Reintentar exactamente el mismo reporte en diez minutos devuelve la misma referencia; un dispositivo/contexto diferente puede dar un reporte distinto. Límite de cinco reportes nuevos por cuenta y hora. Un error de envío conserva el formulario para que el usuario decida cuándo reintentar. No hay envío automático de emails ni push de incidencias. Se consultan con Actualizar piloto. La interfaz presenta hasta 20 partidas, 30 candidatas del organizador y 100 reportes recientes visibles para esa cuenta; estos límites se indican o se documentan aquí, y no equivalen al historial completo de soporte.

La lectura se protege con RLS y la escritura con RPCs validadas. `get_pilot_match_state` es SECURITY INVOKER y devuelve solo campos necesarios, sin direcciones privadas, tokens, correos ni códigos. Solo el organizador puede incorporar su partida; participantes y administradores pueden seguirla. Al dejar la mesa, se pierde el acceso al seguimiento, salvo organizador o administrador.

## Criterios de aceptación del piloto

Registrar para cada sesión: partida, fecha real, dispositivos usados y cualquier incidencia. No marcar iOS como probado si nadie lo usa.

- Cuatro personas pueden crear/aceptar/unirse sin ayuda administrativa y entienden las reglas antes de apuntarse.
- Ubicación y permiso del lugar claros, dirección privada visible solo cuando corresponde.
- Amistosa terminada, historial correcto y ELO sin cambios.
- Competitiva con registros cruzados, resultado coincidente y ranking coherente sin doble aplicación.
- Avisos y push probados en los móviles usados; denegación de permiso permite seguir usando la app.
- Corte y recuperación de red, cierre/reapertura y actualización no provocan envíos duplicados o pérdida inesperada de un formulario.
- Ninguna incidencia que impida completar la sesión queda sin resolver o con una alternativa aceptada por los participantes.

El piloto se cierra tras revisar estas evidencias con el usuario, no automáticamente por tener indicadores técnicos completos. No se reinicia el ELO como parte de esta implementación.

## Verificación técnica realizada

- 73 pruebas backend/Edge/worker en esquema estándar y cloud drift: incorpora opt-in, exclusión de mocks/legacy, avance de estado mediante códigos cruzados reales en PostgreSQL aislado, privacidad de incidencias, validación de metadatos, límites y revisión administrativa con control de concurrencia.
- 68 pruebas de navegador, 13 nuevas para piloto, reportes, errores que conservan campos, triage y anchos de 320 a 1440 px; tres verificaciones de exportación y lint/TypeScript/build.
- Nube: migración aplicada y comprobación con cuenta autorizada dentro de una transacción: crear/inscribir, leer seguimiento, reportar/revisar e intentar acceder desde otra cuenta. ROLLBACK de todos los datos de verificación, sin una partida piloto ficticia persistente ni mensajes a terceros.
- Advisors sin ERROR; exposición autenticada de tablas/RPCs es intencional y está limitada por RLS/validación. Permanecen los avisos previos de citext, políticas exclusivamente servidor y protección de contraseñas filtradas.

## Preparación pública todavía pendiente

Quedada real y evidencias, comprobación física iOS si se dispone de dispositivo, protección administrativa de main, plan de copia/restauración comprobado, tratamiento/retención de reportes y eliminación de cuenta/datos, documentos y canal de soporte para apertura pública. Los temas de monetización siguen aplazados. Esta fase no declara la aplicación lista para producción comercial.
