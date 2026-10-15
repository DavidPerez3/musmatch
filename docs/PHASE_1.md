# Fase 1 — Experiencia móvil y pruebas de navegador

## Implementado

- Navegación inferior de cinco destinos en móvil/tablet, navegación superior en escritorio desde 1024 px, menú de cuenta y aviso de acciones pendientes.
- Cabecera compacta, áreas seguras para dispositivos con notch, espacio inferior para que la navegación no tape el final de las páginas, controles táctiles y campos de 16 px para evitar zoom automático en iOS.
- Inicio, acceso, recuperación de contraseña, creación, mis partidas, detalle, ranking, perfil, jugadores y administración adaptados a pantallas estrechas.
- Ranking en tarjetas semánticas, puesto y ELO visibles, nombre largo ajustado, cuenta propia destacada y estados de carga, invitado, vacío y error.
- Detalle con accesos a jugadores, presencia y resultado. Se conserva el protocolo de códigos cruzados; no se presenta como lector QR.
- Paleta trasladada a `@theme` de Tailwind 4; retirada configuración antigua que no se cargaba. Botones, foco de teclado y movimiento reducido compartidos.
- Etiquetas vinculadas a campos y enlace para saltar al contenido. Textos con codificación dañada corregidos.
- Supabase Cron ejecuta `resolve_pending_results_by_timeout()` cada cinco minutos, dentro de PostgreSQL y sin exponer claves. Migración `20261015060445_schedule_result_reviews.sql`; ejecución cloud verificada como `succeeded`. El timeout abre revisión neutral.

## Verificación

`npm run test:ui` prepara Chromium desde un paquete npm versionado y ejecuta Playwright contra el export estático servido bajo `/musmatch/`. Está integrado en el job `build`, antes de desplegar. Los informes y capturas se conservan como artefactos de Actions durante siete días.

Se prueban diez rutas a 320×740, 390×844, 768×1024, 844×390, 1024×768 y 1440×900. Se comprueba que cargan sin errores JS, no hay desbordamiento horizontal, aparece la navegación adecuada y las zonas táctiles de navegación miden al menos 44 px de alto. Hay pruebas adicionales para navegación móvil, filtros, selección de modo, acceso al resultado, invitado y ranking vacío/con error.

El navegador usa seis perfiles sintéticos con nombres largos y respuestas HTTP interceptadas, incluido Auth y WebSocket. No crea cuentas, no envía resultados ni contacta con Supabase real. Las reglas de victorias, derrotas, disputas y ELO se verifican por separado con los 17 escenarios SQL de fase 0, en esquema limpio y heredado.

Para reproducir:

```sh
npm ci
export NEXT_PUBLIC_BASE_PATH=/musmatch
export NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co
export NEXT_PUBLIC_SUPABASE_ANON_KEY=test-key
npm run build
npm run test:export
npm run test:ui
```

La preparación del Chromium incluido requiere Linux x64, como el runner Ubuntu del workflow. No sustituye las pruebas físicas de instalación PWA, teclado virtual, cámara o Safari/iOS: siguen en la lista de aceptación del piloto. OAuth real se prueba con cuentas de ensayo del propietario, sin automatizar Google.

## Pendientes y siguiente fase

- Protección administrativa de `main`: el conector de GitHub disponible no permite modificar reglas de rama. Crear una regla activa para `main` que exija PR y el check `build`, bloquee force-push y borrado. CI se ejecuta ya, pero no impide por sí mismo un merge manual que lo omita.
- Fase 2: contrato de partida visible antes de apuntarse (8 reyes/8 ases o 4/4, tantos, juegos/vacas, amistosa o competitiva), validación SQL y selector en creación, detalle y filtros. No inferir una variante por la ubicación.
- Fase 3: QR efímero por jugador usando el protocolo de presencia existente, alternativa manual, caducidad y prueba en cámara real. Escanear un QR es evidencia de presencia, no una garantía absoluta contra fraude.
- Después: invitaciones completas, revisión administrativa de disputas y piloto cerrado con seguimiento de incidencias.
