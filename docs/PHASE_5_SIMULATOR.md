# Simulador privado — fase 5, primer bloque

Acceso: Más opciones → Simulador de partidas (cuenta de administración habilitada). No requiere entrar con cuentas mock ni conocer contraseñas. La capacidad se concede mediante `simulation_operators` y `simulation_actors`, tablas sin escritura para clientes. La autorización se comprueba por UUID y registro administrativo, nunca por nombre de usuario ni user_metadata.

## Uso

1. Crear mesa de prueba: cuenta personal en A, mock 1 en A y mocks 2/3 en B. Se eligen 8/8 o 4/4, tantos, juegos y vacas.
2. Pulsar **Simular presencia de los cuatro** para ejecutar cuatro generaciones y cuatro validaciones de códigos reales del protocolo. Solo se admite sobre una mesa completa sin pruebas previas.
3. O abrir **Probar QR y códigos paso a paso**: generar QR de un mock rival, leerlo desde otro dispositivo con la misma cuenta o escribir su código en el control personal. Un rival mock debe validar también el código personal. Para validar al compañero mock 1 se intercambian códigos con el rival mock 3. Los códigos conservan caducidad, consumo único, espera de renovación y restricciones de equipo.
4. Probar victoria, derrota, reportes contradictorios o un reporte rival pendiente. Los atajos llaman al reporte normal con la cuenta personal y al reporte del mock 2 con la capacidad limitada de simulación. También se pueden enviar marcadores concretos por cada equipo.
5. El vencimiento simulado solo cambia esta mesa de pendiente a disputa neutral; no ejecuta el scheduler global ni toca otras partidas.
6. La disputa se resuelve con la interfaz administrativa normal y exige permisos de administración, motivo y decisión. Puede anularse o elegirse un ganador. El cálculo de puntos sobre una mesa simulada sigue aislado aunque se solicite ELO.
7. **Crear mesa de prueba** inicia otra prueba conservando resultados y evidencias de las anteriores. Se muestran las veinte más recientes. No existe un reinicio que borre registros o revierta ELO real.

## Aislamiento

- Solo el propietario puede leer la mesa y su plantilla, incluidas consultas REST directas. No se permite incorporar personas ajenas a los cuatro actores registrados ni invitar a usuarios reales a una prueba.
- `simulate_player_action` acepta un número de mock (1–3), no un UUID arbitrario. Rechaza eventos reales, mesas de otro propietario, cuentas no habilitadas y acciones fuera de la lista. Restaura la identidad original después de cada operación y también ante errores. Los mocks siguen sin credenciales ni identidades de acceso.
- La marca de simulación es inmutable. Las mesas no aparecen en descubrimiento, historial ordinario ni contador de resultados pendientes. Las cuentas marcadas mock se excluyen del ranking normal y no pueden incorporarse a nuevas partidas reales.
- El algoritmo real de ELO conserva sus validaciones, idempotencia y anti-boost. Ignora el historial simulado. Para una simulación, el mismo punto de entrada escribe exclusivamente en `simulation_scores`: una copia inicial de los puntos y un cálculo base K=32 por mesa, sin anti-boost por repetición. El panel lo etiqueta como clasificación simulada; no es una predicción de todas las reglas anti-abuso del ranking real.
- No se escriben puntos, estadísticas ni fiabilidad en perfiles al resolver una simulación. Las RPC internas y los controles de configuración no están disponibles a clientes.
- Los controles privados son exclusivamente de desarrollo/piloto. No se habilitan automáticamente para nuevos usuarios ni para quien adopte un nombre similar.

## Validación

46 pruebas de backend/endpoint sobre esquema limpio y reproducción del esquema cloud. Incluyen adversarios sin capacidad, pertenencia, lectura directa, códigos propios/de compañero/caducados/repetidos, recuperación de identidad, cuatro check-ins, victorias y derrotas con perfiles intactos, disputa neutral y resolución con puntos simulados, timeout acotado, salida e invalidación, reincorporación, retención de pruebas anteriores y revocación de capacidad.

42 pruebas de navegador: treinta anteriores y doce específicas del simulador (acceso, configuración, victoria/derrota, QR/código manual, plantilla incompleta, vencimiento y revisión, desacuerdo y seis tamaños de pantalla entre 320 y 1440 px). Los usuarios de CI y el backend HTTP están simulados; las pruebas PostgreSQL sí ejecutan las funciones y políticas reales en una base aislada.

La fase 4 se fusionó por petición del usuario mientras GitHub Actions seguía en cola. El workflow de main conserva todos los checks antes de publicar. Esta entrega implementa el bloque simulador de fase 5; los avisos adicionales y el pulido PWA siguen pendientes, así como iOS físico y el piloto con personas reales.

Migración `20261019163531_phase5_simulator` aplicada. Se registraron los tres mocks existentes (cuentas bloqueadas y sin identidades de login) para el UUID de la cuenta personal. En una transacción cloud se ejecutaron cuatro check-ins y un resultado coincidente, comprobando que los perfiles no cambiaban, que se restauraba la identidad original y que otra cuenta no podía leer evento, participantes ni puntos; la prueba se revirtió. Se dejó una mesa nueva sin validar para uso manual.

Los advisors no devuelven errores nuevos; permanecen los avisos documentados en fase 4. Referencias de revisión: [funciones privilegiadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) y [exposición autenticada GraphQL](https://supabase.com/docs/guides/database/database-linter?lint=0027_pg_graphql_authenticated_table_exposed). La versión de fase 4 ya superó todos los checks de main; su job de Pages seguía esperando infraestructura sin revisores ni temporizador configurados al comprobarlo.
