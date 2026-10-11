/* ============================================================
   González Inmuebles · Servidor
   Express + sesión. El almacenamiento (Postgres o archivo) vive
   en almacen.js y se elige solo según las variables de entorno.
   ============================================================ */
const path = require('path');
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const almacen = require('./almacen');

const app = express();
const PORT = process.env.PORT || 3000;
const PRODUCCION = process.env.NODE_ENV === 'production';

/* ---------- Credenciales ---------- */
const USUARIO = process.env.APP_USER || 'admin';
const CLAVE = process.env.APP_PASSWORD || 'Familia01';

/* ---------- Middleware ---------- */
app.set('trust proxy', 1);                  // Render corre detrás de un proxy TLS
app.use(express.json({ limit: '30mb' }));   // las fotos de referencia viajan en base64

app.use(session({
  name: 'gi.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: PRODUCCION,
    maxAge: 1000 * 60 * 60 * 12
  }
}));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

function requiereSesion(req, res, next) {
  if (req.session && req.session.usuario) return next();
  res.status(401).json({ error: 'Sesión no iniciada' });
}

// Envuelve los handlers async para que un error no deje la petición colgada
const rutaAsync = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ============================================================
   AUTENTICACIÓN
   ============================================================ */
const intentos = new Map();

app.post('/api/login', (req, res) => {
  const ip = req.ip || 'x';
  const reg = intentos.get(ip) || { n: 0, hasta: 0 };
  if (Date.now() < reg.hasta) {
    return res.status(429).json({ error: 'Demasiados intentos. Probá de nuevo en un minuto.' });
  }

  const { usuario, clave } = req.body || {};
  const ok = usuario === USUARIO && typeof clave === 'string' &&
    crypto.timingSafeEqual(
      Buffer.from(clave.padEnd(64).slice(0, 64)),
      Buffer.from(CLAVE.padEnd(64).slice(0, 64))
    );

  if (!ok) {
    reg.n += 1;
    if (reg.n >= 6) { reg.hasta = Date.now() + 60000; reg.n = 0; }
    intentos.set(ip, reg);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  intentos.delete(ip);
  req.session.usuario = usuario;
  res.json({ usuario });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.usuario) return res.json({ usuario: req.session.usuario });
  res.status(401).json({ error: 'Sesión no iniciada' });
});

/* ============================================================
   CONFIGURACIÓN
   ============================================================ */
app.get('/api/config', requiereSesion, rutaAsync(async (req, res) => {
  res.json(await almacen.leerConfig());
}));

app.put('/api/config', requiereSesion, rutaAsync(async (req, res) => {
  const cuerpo = req.body || {};
  // Un cuerpo vacío (o con nulos) restablece los valores de fábrica
  const restablecer = !cuerpo.params && !cuerpo.barrios && !cuerpo.mercado;
  const nueva = restablecer
    ? almacen.CONFIG_INICIAL
    : Object.assign({}, await almacen.leerConfig(), cuerpo);
  res.json(await almacen.guardarConfig(nueva));
}));

/* ============================================================
   VERIFICACIÓN DE DIRECCIONES
   Consulta el geocodificador de OpenStreetMap (Nominatim) para
   confirmar que la calle y la altura existen. Google Maps no
   ofrece búsqueda sin clave de API; la confirmación visual se
   hace igual contra Google desde el navegador.
   ============================================================ */
const GEO_CACHE = new Map();              // consulta → { cuando, datos }
const GEO_TTL = 1000 * 60 * 60 * 24;      // un día
let geoUltima = 0;                        // Nominatim pide máximo 1 consulta por segundo

app.get('/api/geocodificar', requiereSesion, rutaAsync(async (req, res) => {
  const consulta = String(req.query.q || '').trim();
  if (consulta.length < 4) return res.json({ ok: false, motivo: 'Consulta demasiado corta' });

  const enCache = GEO_CACHE.get(consulta);
  if (enCache && Date.now() - enCache.cuando < GEO_TTL) {
    return res.json({ ok: true, resultados: enCache.datos, cache: true });
  }

  const espera = Math.max(0, 1100 - (Date.now() - geoUltima));
  if (espera) await new Promise(r => setTimeout(r, espera));
  geoUltima = Date.now();

  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5'
    + '&countrycodes=' + encodeURIComponent(process.env.GEO_PAIS || 'ar')
    + '&q=' + encodeURIComponent(consulta);

  try {
    const control = new AbortController();
    const corte = setTimeout(() => control.abort(), 8000);
    const r = await fetch(url, {
      signal: control.signal,
      headers: {
        // Nominatim exige identificar la aplicación
        'User-Agent': 'GonzalezInmuebles-Tasaciones/1.0 (' + (process.env.GEO_CONTACTO || 'contacto@gonzalezinmuebles.com') + ')',
        'Accept-Language': 'es'
      }
    });
    clearTimeout(corte);
    if (!r.ok) throw new Error('Respuesta ' + r.status);

    const crudo = await r.json();
    const resultados = (Array.isArray(crudo) ? crudo : []).map(x => {
      const d = x.address || {};
      return {
        etiqueta: x.display_name,
        lat: x.lat,
        lon: x.lon,
        calle: d.road || '',
        altura: d.house_number || '',
        barrio: d.suburb || d.neighbourhood || d.city_district || d.quarter || '',
        ciudad: d.city || d.town || d.state || '',
        // Un resultado con altura propia es una coincidencia exacta de puerta
        exacto: Boolean(d.house_number)
      };
    });

    GEO_CACHE.set(consulta, { cuando: Date.now(), datos: resultados });
    if (GEO_CACHE.size > 500) GEO_CACHE.delete(GEO_CACHE.keys().next().value);
    res.json({ ok: true, resultados });
  } catch (e) {
    res.json({ ok: false, motivo: e.name === 'AbortError' ? 'El servicio tardó demasiado' : e.message });
  }
}));

/* ============================================================
   TASACIONES
   ============================================================ */
// Listado liviano para el histórico: sin fotos ni comparables
function resumen(t) {
  return {
    id: t.id,
    creada: t.creada,
    actualizada: t.actualizada,
    direccion: (t.prop && t.prop.dir) || 'Sin dirección',
    zona: (t.prop && t.prop.zona) || '',
    tipo: (t.prop && t.prop.tipo) || '',
    objetivo: (t.estrategia && t.estrategia.objetivo) || 0,
    publicacion: (t.estrategia && t.estrategia.mes1) || 0,
    estado: t.estado || 'borrador'
  };
}

app.get('/api/tasaciones', requiereSesion, rutaAsync(async (req, res) => {
  res.json((await almacen.listar()).map(resumen));
}));

app.get('/api/tasaciones/:id', requiereSesion, rutaAsync(async (req, res) => {
  const t = await almacen.obtener(req.params.id);
  if (!t) return res.status(404).json({ error: 'No encontrada' });
  res.json(t);
}));

app.post('/api/tasaciones', requiereSesion, rutaAsync(async (req, res) => {
  res.status(201).json(await almacen.crear(req.body || {}));
}));

app.put('/api/tasaciones/:id', requiereSesion, rutaAsync(async (req, res) => {
  const t = await almacen.actualizar(req.params.id, req.body || {});
  if (!t) return res.status(404).json({ error: 'No encontrada' });
  res.json(t);
}));

// Duplicar: útil para otra unidad del mismo edificio o para rehacer una vieja
app.post('/api/tasaciones/:id/duplicar', requiereSesion, rutaAsync(async (req, res) => {
  const orig = await almacen.obtener(req.params.id);
  if (!orig) return res.status(404).json({ error: 'No encontrada' });
  const copia = JSON.parse(JSON.stringify(orig));
  delete copia.id; delete copia.creada; delete copia.actualizada;
  copia.estado = 'borrador';
  copia.prop = copia.prop || {};
  copia.prop.dir = (copia.prop.dir || '') + ' (copia)';
  res.status(201).json(await almacen.crear(copia));
}));

app.delete('/api/tasaciones/:id', requiereSesion, rutaAsync(async (req, res) => {
  const ok = await almacen.borrar(req.params.id);
  if (!ok) return res.status(404).json({ error: 'No encontrada' });
  res.json({ ok: true });
}));

/* ============================================================
   SALUD, ERRORES Y ARRANQUE
   ============================================================ */
app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'No encontrado' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Error del servidor' });
});

almacen.iniciar()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`González Inmuebles · escuchando en el puerto ${PORT}`);
      console.log(`Almacenamiento: ${almacen.tipo}`);
      if (almacen.tipo === 'archivo' && PRODUCCION) {
        console.warn('AVISO: sin DATABASE_URL los datos se pierden en cada reinicio del servicio.');
      }
    });
  })
  .catch(err => {
    console.error('No se pudo iniciar el almacenamiento:', err.message);
    process.exit(1);
  });
