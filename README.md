# González Inmuebles · Tasaciones

Aplicación web para generar tasaciones y presentaciones comerciales, con histórico
de todas las tasaciones realizadas, exportación a PDF y a Word.

## Qué incluye

- Acceso con usuario y contraseña.
- Histórico de tasaciones: buscar, abrir, duplicar, borrar, marcar estado (borrador / enviada / cerrada).
- Asistente de carga en 6 pasos.
- Vista previa del informe a pantalla completa (7 hojas A4), nunca en pantalla partida.
- Descarga en PDF (impresión del navegador) y en Word (`.doc` editable).
- Configuración: matriz de barrios con valor por m² y coeficientes propios, parámetros de precios,
  condiciones comerciales.

## Correr en tu computadora

Requiere Node.js 18 o superior.

```bash
npm install
npm start
```

Abrir http://localhost:3000

Usuario y contraseña por defecto: `admin` / `Familia01`.
Se cambian con las variables de entorno `APP_USER` y `APP_PASSWORD`.

## Variables de entorno

| Variable | Para qué sirve | Valor por defecto |
|---|---|---|
| `PORT` | Puerto del servidor | `3000` |
| `APP_USER` | Usuario de acceso | `admin` |
| `APP_PASSWORD` | Contraseña de acceso | `Familia01` |
| `SESSION_SECRET` | Firma de la cookie de sesión | se genera al arrancar |
| `DATA_DIR` | Carpeta donde se guarda `db.json` | `./data` |

Si `SESSION_SECRET` no está definida se genera una al azar en cada arranque, lo que cierra
todas las sesiones abiertas cada vez que el servidor se reinicia. En producción conviene fijarla.

## Subir a GitHub

```bash
git init
git add .
git commit -m "Primera versión"
git branch -M main
git remote add origin https://github.com/USUARIO/gonzalez-inmuebles.git
git push -u origin main
```

`node_modules/` y `data/db.json` están excluidos por `.gitignore`: el primero se reinstala solo
y el segundo contiene los datos reales, que no deben viajar al repositorio.

## Deploy en Render (plan gratuito)

El plan gratuito de Render alcanza para correr la aplicación. Lo único que **no** se puede
usar gratis es el disco persistente, y sin disco el sistema de archivos se borra en cada
reinicio. Por eso el almacenamiento va a una base Postgres externa: `almacen.js` usa Postgres
cuando existe `DATABASE_URL` y cae al archivo JSON cuando no.

### 1. Base de datos gratuita

Crear un proyecto en [Neon](https://neon.com) (plan Free permanente, 0,5 GB por proyecto,
sin tarjeta) o en [Supabase](https://supabase.com). Copiar la cadena de conexión, que tiene
esta forma:

```
postgresql://usuario:clave@ep-algo-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
```

No hace falta crear tablas: la aplicación crea la suya sola al arrancar.

### 2. Servicio web en Render

**New → Blueprint**, elegir el repositorio y aplicar. El `render.yaml` ya viene con
`plan: free`. Render va a pedir dos valores:

- `APP_PASSWORD` — la contraseña de acceso
- `DATABASE_URL` — la cadena de conexión del paso anterior

Alternativa a mano: **New → Web Service**, Build `npm install`, Start `npm start`,
instancia **Free**, y cargar las variables `NODE_ENV=production`, `APP_USER`,
`APP_PASSWORD`, `SESSION_SECRET` y `DATABASE_URL`.

### 3. Verificar

En los logs del servicio tiene que aparecer `Almacenamiento: postgres`. Si dice `archivo`,
`DATABASE_URL` no llegó y los datos se van a perder en el próximo deploy.

### Qué esperar del plan gratuito

- El servicio se apaga tras unos 15 minutos sin tráfico y tarda cerca de un minuto en
  responder la primera visita. Las tasaciones no se pierden: están en Postgres.
- La base también escala a cero cuando está ociosa, así que la primera consulta puede
  demorar unos segundos más.
- Las sesiones viven en memoria: cada vez que el servicio se reinicia hay que volver a
  iniciar sesión.

Si más adelante querés que esté siempre despierto, la instancia Starter de Render cuesta
alrededor de USD 7 por mes y elimina el apagado por inactividad.

## Estructura

```
server.js              Servidor Express, sesión y API REST
almacen.js             Almacenamiento: Postgres si hay DATABASE_URL, si no archivo JSON
public/index.html      Interfaz completa (Alpine.js)
public/app.js          Estado, cálculos y exportaciones
public/estilos-app.css Interfaz
public/estilos-doc.css El documento A4 y las reglas de impresión
public/img/            Logo y fotografías de la presentación
public/vendor/         Alpine.js incluido en el repositorio (sin CDN)
data/                  db.json con la configuración y las tasaciones
```

## API

Todas las rutas bajo `/api` requieren sesión iniciada.

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/login` | Inicia sesión |
| POST | `/api/logout` | Cierra sesión |
| GET | `/api/me` | Usuario de la sesión actual |
| GET / PUT | `/api/config` | Parámetros y matriz de barrios |
| GET | `/api/tasaciones` | Listado del histórico |
| POST | `/api/tasaciones` | Crea una tasación |
| GET / PUT / DELETE | `/api/tasaciones/:id` | Lee, actualiza o borra |
| POST | `/api/tasaciones/:id/duplicar` | Copia una tasación existente |

## Nota sobre los valores por m²

La matriz de barrios viene cargada con valores de referencia **orientativos**, puestos como punto
de partida. Hay que reemplazarlos con información propia de cierres reales para que el control
contra el promedio de comparables sirva de algo.
