# Barbería — reservas (GitHub + Neon + Vercel, gratis)

- `schema.sql` — **código para Neon**: ejecutar una vez en Neon > SQL Editor
- `api/index.js` — backend (una función serverless de Vercel)
- `public/index.html` + `app.js` — reserva para clientes
- `public/admin.html` + `admin.js` — panel de administración
- `docs/ANALISIS.md` — análisis del proyecto original (fortalezas, debilidades, mejoras)
- `docs/PROMPT_PROYECTO.md` — prompt que describe el proyecto

## Despliegue
1. **Neon**: crear proyecto en neon.tech → copiar la *connection string* (la del pooler) → SQL Editor → pegar y ejecutar `schema.sql`.
2. **GitHub**: subir esta carpeta como repositorio (`.env` nunca se sube).
3. **Vercel**: *Add New Project* → importar el repo → en *Environment Variables* cargar `DATABASE_URL`, `ADMIN_PASSWORD`, `SESSION_SECRET` (y opcional `RESEND_API_KEY`, `MAIL_FROM`) → Deploy.
4. Abrir `/admin.html`, ingresar y cargar barberos, servicios, sedes y **horarios reales** (sin horarios no hay horas disponibles).

## Desarrollo local
```bash
npm install
npx vercel dev
```
(requiere `.env` local copiado de `.env.example`)
