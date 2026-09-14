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

## Deploy en Render

### Opción A · con el blueprint incluido

1. En Render: **New → Blueprint** y elegir el repositorio.
2. Render lee `render.yaml` y crea el servicio con su disco persistente.
3. Cargar el valor de `APP_PASSWORD` cuando lo pida (está marcado como `sync: false`
   justamente para que la contraseña no quede escrita en el repositorio).

### Opción B · a mano

1. **New → Web Service**, conectar el repositorio.
2. Runtime **Node**, Build Command `npm install`, Start Command `npm start`.
3. En **Environment** agregar `NODE_ENV=production`, `APP_USER`, `APP_PASSWORD`,
   `SESSION_SECRET` y `DATA_DIR=/var/data`.
4. En **Disks** agregar un disco de 1 GB montado en `/var/data`.

### Sobre la persistencia

Las tasaciones se guardan en un archivo JSON dentro de `DATA_DIR`. **Sin un disco persistente
los datos se pierden en cada deploy o reinicio**, porque el sistema de archivos de Render es
efímero. Los discos requieren un plan pago (Starter en adelante); por eso `render.yaml` usa
`plan: starter`. Si preferís empezar en el plan gratuito, sacá el bloque `disk` y la variable
`DATA_DIR`, pero tené en cuenta esa limitación y bajá la copia de seguridad seguido.

Un servicio con disco corre en una sola instancia. Para varios usuarios simultáneos o escalado
horizontal habría que mover el almacenamiento a PostgreSQL y las sesiones a un store externo.

## Estructura

```
server.js              Servidor Express, sesión y API REST
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
