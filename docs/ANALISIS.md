# Análisis del proyecto "APP BARBERIA" (Google Apps Script + Sheets + Calendar)

## 1. Qué es
Sistema de reservas para una barbería multi-sede. El cliente elige barbero, servicio, fecha, hora, sede y forma de pago; el sistema calcula la hora de fin según la duración del servicio, verifica disponibilidad contra Google Calendar, crea el evento, guarda la fila en Google Sheets y envía correo de confirmación al cliente y al administrador. Permite duplicar la reserva en hasta 9 fechas adicionales.

Piezas: `Code.gs` (backend), `Index.html` (UI Bootstrap oscuro/dorado + calendario embebido), `JavaScript.html` (lógica cliente), `Styles.html` (CSS).

## 2. Fortalezas
- **Separación clara** backend / UI / estilos y configuración editable desde la hoja `Config` (sedes, formas de pago, email admin).
- **Validación en servidor** de campos obligatorios, fecha pasada, rango horario y email (no se confía solo en el navegador).
- **Hora de fin automática** a partir de la duración del servicio.
- **Identidad visual coherente** (negro + dorado), sprite SVG propio, escape de HTML al pintar `<option>`.
- **Reserva recurrente** (duplicar en varias fechas) con tope de 10.
- **Cero costo de infraestructura**: todo vive en la cuenta Google.

## 3. Debilidades y bugs concretos

### Críticos (afectan el negocio)
| # | Problema | Dónde | Consecuencia |
|---|----------|-------|--------------|
| 1 | **Condición de carrera**: se verifica y luego se crea, sin `LockService` ni restricción única | `processForm` | Dos clientes pueden reservar el mismo hueco a la vez |
| 2 | **La disponibilidad se mide por sede, no por barbero** (`getLocation() === lugar`) | `verificarDisponibilidad` | Dos barberos distintos en la misma sede se bloquean entre sí; el mismo barbero puede estar en dos sedes a la misma hora |
| 3 | **El precio y la hora de fin los manda el navegador** | `handleSubmit` → `processForm` | Cualquiera puede cambiar el precio o la duración desde la consola |
| 4 | **No hay horarios de atención ni días libres**: se puede reservar a las 03:00 o en domingo | — | Reservas imposibles |
| 5 | **Datos personales en la descripción del evento** y calendario embebido | `createEvent`, iframe | Si el calendario es público se filtran teléfono y correo de clientes |

### Bugs de código
- `mostrarMensaje` usa `textContent` pero recibe HTML (`ICONS.ok + ' texto'`): **el usuario ve el código `<svg …>` como texto** en vez del icono.
- `sumarMinutos` hace `% 24`: un servicio que cruza medianoche genera `horaFin < horaInicio` y falla sin explicar.
- El resultado de `processForm` es un **string** que el cliente interpreta con `startsWith('error')` / `includes('éxito')`: frágil ante cambios de texto o idioma.
- Las **fechas adicionales no se verifican** antes de confirmar; solo la principal. Se informa "No disponibles: N" sin decir cuáles.
- El correo describe solo la primera fecha aunque se hayan reservado varias.
- `descripcion` almacena la **forma de pago** (nombre engañoso); la hoja `Reservas` no tiene encabezados definidos ni ID de reserva.
- Fechas con `new Date('YYYY-MM-DDTHH:mm:00')` dependen de la zona horaria del script; el iframe del calendario tiene `ctz=America/Bogota` fijo.
- `onclick="removeFechaRow(...)"` inline + función global rompe con una CSP estricta.
- Errores de carga de barberos/servicios solo van a `console.error`; el usuario ve "Cargando…" para siempre.

### Estructurales
- **Google Sheets como base de datos**: sin integridad, sin transacciones, sin índices, sin historial; cualquiera con acceso a la hoja puede dañar datos. Cada visita dispara 3 llamadas `google.script.run` (lentas, ~1–2 s).
- **Sin gestión de la reserva**: no hay código de reserva, cancelar, reprogramar, estados (confirmada/completada/no asistió) ni recordatorios.
- **Sin panel de administración**: todo se hace editando hojas a mano.
- **Sin entidad cliente**: el mismo cliente se repite como texto en cada fila; no hay historial ni métricas.
- **Cuotas de Google**: `MailApp` ≈ 100 correos/día en cuentas gratuitas; Calendar y Apps Script tienen límites de tiempo/ejecución.
- **Dependencia del iframe de Apps Script** (`XFrameOptionsMode.ALLOWALL`), URL poco profesional (`script.google.com/macros/...`) y sin dominio propio.
- **Accesibilidad**: mensajes sin `aria-live`, placeholder `#555` sobre `#252525` con contraste bajo, el calendario depende de `filter: invert()` (hack).

## 4. Mejoras aplicadas en la migración (carpeta `barberia/`)

| Área | Antes | Ahora |
|------|-------|-------|
| Hosting | Apps Script | **Vercel** (estático + función serverless) |
| BD | Google Sheets | **Neon Postgres** con claves foráneas, checks y restricciones |
| Doble reserva | Posible | Imposible: `EXCLUDE USING gist` por barbero sobre rango de tiempo |
| Disponibilidad | Por sede | **Por barbero**, con horarios por día/sede y bloqueos (vacaciones, almuerzo) |
| Precio/duración | Del cliente | **Del servidor** (se guarda copia histórica en la reserva) |
| Horas disponibles | Escribir hora y "verificar" | **Botones de hora libres** calculados en el servidor |
| Clientes | Texto repetido | Tabla `clientes` (por teléfono) con historial |
| Reserva | Sin ID | **Código de 6 caracteres**, consulta y cancelación por el cliente |
| Admin | Hojas | **/admin.html**: agenda, estados, ingresos, catálogo y horarios |
| Correo | MailApp | **Resend** opcional (gratis 100/día, 3000/mes); la reserva no falla si el correo falla |
| Calendario | iframe con filtro invert | Agenda propia en el admin (sin exponer datos de clientes) |
| Seguridad | — | Honeypot anti-bot, límite de reservas activas por teléfono, login admin con límite de intentos y token firmado |
| UI | Una sola página larga | Flujo en 4 pasos con resumen lateral, tipografía de marca, mobile-first, `aria-live`, foco visible |

## 5. Siguientes acciones recomendadas (por prioridad)
1. **Desplegar** (ver README): Neon → `schema.sql` → GitHub → Vercel con las variables de entorno.
2. Cambiar `ADMIN_PASSWORD` y crear el dominio propio (Vercel permite uno gratis `*.vercel.app`).
3. Cargar barberos, servicios, sedes y **horarios reales** desde `/admin.html`.
4. Configurar **Resend** y verificar un dominio de correo (sin dominio solo envía a la cuenta propia).
5. Migrar el histórico de Sheets: exportar la hoja `Reservas` a CSV y usar `COPY`/importador de Neon (mapeo en `docs/PROMPT_PROYECTO.md`).
6. Fase 2: recordatorios 24 h antes (Vercel Cron, gratis 1/día), WhatsApp (enlace `wa.me` prellenado), reprogramar, anticipo/pago en línea, reseñas, barbero-servicio (qué barbero hace qué).

## 6. Límites del plan gratuito (a tener presentes)
- **Neon Free**: 0.5 GB por proyecto; el cómputo se suspende tras ~5 min de inactividad (primera consulta tarda ~1 s).
- **Vercel Hobby**: uso personal/no comercial según sus términos; 12 funciones serverless por despliegue (aquí se usa 1), cron limitado a 1 ejecución diaria.
- **Resend Free**: 100 correos/día.
Si la barbería factura, Vercel exige plan Pro para uso comercial; alternativa gratuita equivalente: Cloudflare Pages/Workers o Netlify.
