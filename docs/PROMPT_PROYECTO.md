# Prompt del proyecto (para pegar en cualquier IA / desarrollador)

> Construye una aplicación web de **reservas para una barbería multi-sede**, en español (Colombia, zona horaria `America/Bogota`, moneda COP), desplegable gratis en **GitHub + Neon (PostgreSQL) + Vercel**.
>
> ## Usuarios
> - **Cliente (público, sin login):** reserva en 4 pasos: servicio → barbero y sede → fecha y hora (botones con horas libres) → datos (nombre, teléfono, email, forma de pago). Recibe un **código de reserva** y puede consultarla/cancelarla con código + teléfono.
> - **Administrador (login con contraseña):** ve la agenda por rango de fechas, cambia estados (confirmada, completada, cancelada, no asistió), ve ingresos y conteos, y gestiona barberos, servicios, sedes, formas de pago, horarios semanales por barbero/sede, bloqueos y configuración.
>
> ## Reglas de negocio
> 1. Un barbero no puede tener dos citas que se solapen (garantizado en BD con `EXCLUDE USING gist`).
> 2. La duración y el precio se leen **siempre del servidor/BD**; el precio se copia a la reserva como histórico.
> 3. Solo se ofrecen horas dentro del horario del barbero en esa sede y día, sin bloqueos, sin citas y con anticipación mínima configurable.
> 4. Se puede duplicar una reserva en hasta 9 fechas extra (misma hora/barbero); cada una se valida y se informa cuáles se lograron.
> 5. Máximo N reservas futuras activas por teléfono; cancelación del cliente hasta X horas antes.
> 6. Correo de confirmación opcional (Resend); un fallo de correo nunca cancela la reserva.
>
> ## Arquitectura
> - Frontend estático sin build (`public/index.html`, `public/admin.html`, CSS/JS vanilla), mobile-first, tema oscuro/dorado, accesible (`aria-live`, foco visible, contraste AA).
> - Backend: **una sola función serverless** `api/index.js` (Node 22, CommonJS) con protocolo `POST /api { action, token, ... }` y driver `@neondatabase/serverless`.
> - Admin: token HMAC con expiración, comparación en tiempo constante, límite de intentos de login por IP.
> - Anti-abuso: campo honeypot, validación de teléfono/email, límites de longitud.
> - Variables: `DATABASE_URL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `RESEND_API_KEY` (opcional), `MAIL_FROM` (opcional).
>
> ## Modelo de datos
> `sedes`, `barberos`, `servicios`, `formas_pago`, `horarios(barbero, sede, dia_semana, hora_inicio, hora_fin)`, `bloqueos`, `clientes(telefono único)`, `reservas(codigo único, serie_id, estado, precio, servicio_nombre, inicio/fin generados)`, `config(clave, valor)`, `intentos_login`.
>
> ## Entregables
> `schema.sql`, `api/index.js`, `public/*`, `package.json`, `vercel.json`, `.env.example`, `README.md` con pasos de despliegue.

## Origen (para contexto)
Migración de una app Google Apps Script (Sheets: `Barberos`, `Servicios(nombre, precio, duración)`, `Reservas`, `Config(email_admin, lugares, formas_pago)` + Google Calendar).

### Mapeo de migración de datos
| Hoja de Sheets | Tabla Neon |
|---|---|
| Barberos.A | `barberos.nombre` |
| Servicios A/B/C | `servicios.nombre/precio/duracion_min` |
| Config.lugares (CSV) | `sedes.nombre` (una fila por valor) |
| Config.formas_pago (CSV) | `formas_pago.nombre` |
| Config.email_admin | `config` clave `email_admin` |
| Reservas (cliente, barbero, servicio, precio, fecha, inicio, fin, lugar, pago, email, teléfono, timestamp) | `clientes` (por teléfono) + `reservas` |
