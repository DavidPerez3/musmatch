# MusMatch - Analisis del Proyecto y Decisiones de Producto

Fecha: 2026-05-13

## 1) Vision

MusMatch es una app tipo Playtomic para mus, con partidas siempre 2 vs 2.

Objetivo:
- Encontrar pareja y rivales para jugar de verdad.
- Separar modo amistoso y competitivo.
- Proteger ELO y fiabilidad contra fraude y mala fe.

## 2) Estado actual del repo

Stack actual:
- Frontend: Next.js 16 + React 19 + TypeScript + Tailwind.
- Plataforma: Supabase (Postgres, Auth, RLS, RPC, Realtime).
- Arquitectura: frontend directo a Supabase (sin backend intermedio).

Funcionalidad ya disponible:
- Login/registro (email y Google OAuth).
- Perfil (username, nombre, ELO, fiabilidad).
- Listado de partidas con filtros.
- Creacion de partida:
- `FRIENDLY` o `COMPETITIVE`.
- `FIXED_PAIR` o `NEED_PARTNER`.
- Detalle de partida con equipos, cola, reporte y confirmacion de resultado.
- Social (usuarios, amistades, solicitudes).
- Panel admin para disputas y ajustes manuales.
- Script SQL para emails transaccionales (Resend + pg_net).

Riesgos tecnicos detectados:
- Frontend usa RPC no presentes en SQL versionado actual:
- `join_queue`, `assign_team`, `dispute_match`, `send_friend_request`, `accept_friend_request`, `reject_friend_request`, `remove_friend`, `admin_resolve_dispute`, `admin_adjust_user`.
- Desalineacion entre `schema.sql` y frontend:
- SQL usa `mode`; frontend usa `match_type` y `pair_mode`.
- Firma de `confirm_match_and_update_elo` desalineada con llamada frontend.
- Hay secretos en `.env.local`; deben rotarse y sacarse de cualquier canal compartido.
- El proyecto compila hoy con `npm run build`.

## 3) Tu punto clave: como demostrar que se jugo de verdad

Problema real:
- Solo con "subo resultado y otro confirma" dependes de sinceridad.
- Si alguien miente, la disputa no tiene evidencia fuerte.
- Penalizar a ambos por abrir disputa puede castigar al inocente.

Decision recomendada:
- La disputa debe ser **neutral al inicio**.
- No penalizar a nadie automaticamente por disputar.
- Penalizar solo cuando haya evidencia de mala fe o reincidencia.

### 3.1 Modelo de evidencia de partida (sin reserva de pista)

Como no hay reserva oficial (como en padel), la app debe crear su propia prueba minima:

1) Prueba de presencia antes de empezar
- Check-in de 4 jugadores dentro de ventana (ejemplo: T-30 a T+15).
- Cada equipo debe validar presencia cruzada con un codigo efimero de 6 digitos.
- Si hay permisos, guardar geolocalizacion aproximada (no exacta) para verificar cercania.

2) Prueba de cierre al terminar
- Resultado con score por una parte.
- Confirmacion por la parte rival.
- Si hay desacuerdo, subir evidencia opcional:
- foto del tanteo,
- chat interno de la partida,
- metadatos de hora/ubicacion.

3) Puntuacion de confianza del match
- `match_confidence_score` (0 a 100) calculado con:
- 4 check-ins validos,
- cercania de ubicacion,
- consistencia temporal,
- historial de fiabilidad de jugadores.

Uso:
- Si score alto, auto-cierre rapido.
- Si score medio, requiere doble confirmacion.
- Si score bajo, cola de revision admin.

### 3.2 Politica de disputas justa

Regla nueva:
- Abrir disputa no baja karma por defecto.

Solo penalizar cuando:
- Se demuestra envio repetido de resultados falsos.
- Se demuestra patron de bloqueo sistematico (no confirmar nunca).
- Hay reincidencia clara en no-show o fraude.

Y si no hay evidencia concluyente:
- Partida anulada para ELO.
- Sin penalizacion o penalizacion minima simetrica.

## 4) No-shows con partidas en casa o lugar privado

Tu caso es correcto: muchas partidas seran en casas o acuerdos privados.

Decision de producto:
- Permitir dos tipos de lugar:
- `PUBLIC_VENUE` (bar, sociedad, local).
- `PRIVATE_LOCATION` (casa o direccion privada simplificada).

En `PRIVATE_LOCATION`:
- No se muestra direccion exacta en publico.
- Solo ven detalle los 4 confirmados.
- El anfitrion puede compartir punto de encuentro final por chat interno.

Para reducir no-show en privado:
- Confirmacion de asistencia en dos pasos:
- "Voy" (24h antes),
- "Llego en camino" (60 min antes).
- Si falla el segundo paso y no hay justificacion: marca de riesgo no-show.

## 5) ELO y fiabilidad con menos injusticias

Reglas recomendadas:
- `FRIENDLY`: nunca afecta ELO.
- `COMPETITIVE`: afecta ELO solo si:
- hay 4 check-ins,
- resultado confirmado o resuelto con evidencia.
- En ambos modos (`FRIENDLY` y `COMPETITIVE`), la falta de respuesta o no-show debe afectar fiabilidad.

Para disputas no resueltas:
- no mover ELO.
- guardar incidente para perfil de riesgo.

Para no-show claro:
- baja de fiabilidad.
- sin mover ELO del resto, salvo reglas especificas futuras.

## 6) Arquitectura recomendada (con backend ligero)

Mantener Supabase como base y anadir capa server para reglas sensibles.

Propuesta:
- Frontend: Next.js (web + PWA).
- BFF/API: Route Handlers de Next o Edge Functions.
- Dominio server-side:
- validacion de check-in,
- resolucion de resultados,
- scoring de evidencia,
- sanciones y anticuenta multiple.

Motivo:
- No dejar decisiones criticas en cliente.
- Mejor trazabilidad y control anti-fraude.

## 7) Ubicaciones y expansion geografica

Fase Vitoria:
- Filtro por ciudad y radio.
- `PUBLIC_VENUE` opcional.
- `PRIVATE_LOCATION` permitido.

Fase expansion:
- Mantener modelo de ciudad + radio por GPS.
- Evitar dependencia de catalogo cerrado de bares.

## 8) Estado Git observado en este repo

Revision local realizada:
- `.git/config` no tiene `remote` configurado.
- El primer commit local existe: "Initial commit from Create Next App".

Interpretacion:
- En este repo local no hay ahora mismo push configurado a GitHub.
- Si en tu interfaz aparece otro repo, probablemente viene de otra carpeta o de la configuracion del cliente externo, no de este `.git/config`.

## 9) Roadmap de ejecucion (arranque inmediato)

### Fase 0 - Esta semana

1) Unificar modelo SQL/frontend
- Alinear `events` con `match_type` y `pair_mode`.
- Corregir firmas RPC y completar funciones faltantes.

2) Seguridad base
- Rotar claves expuestas.
- Limpiar `.env.local` y reglas de secretos.

3) Disputa neutral
- Cambiar logica: abrir disputa no penaliza por defecto.

### Fase 1 - 1 a 2 semanas

1) Evidencia de partida v1
- Check-in 4 jugadores.
- Codigo efimero cruzado por equipos.
- Resultado + confirmacion con tiempo limite.

2) Lugares privados
- Soporte `PRIVATE_LOCATION`.
- Visibilidad limitada a participantes.

3) Admin operativo
- Cola de disputas con datos de evidencia.
- Resolucion estandarizada.

### Fase 2 - 2 a 4 semanas

1) Scoring de confianza
- `match_confidence_score`.
- Auto-cierre segun umbral.

2) Anti abuso
- Alertas por patrones repetitivos de cuentas.
- Regla anti-boost para ELO.

3) PWA productiva
- Instalacion, iconos, manifest y comportamiento movil.

### Fase 3 - Escalado

1) Expansion por ciudades.
2) Push notifications.
3) Ajustes finos de sanciones y reputacion segun datos reales.

---

Documento vivo. Se actualiza al cerrar cada fase.
