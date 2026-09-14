/* ============================================================
   González Inmuebles · Servidor
   Express + sesión + almacenamiento en archivo JSON.
   ============================================================ */
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const PRODUCCION = process.env.NODE_ENV === 'production';

/* ---------- Credenciales (configurables por variables de entorno) ---------- */
const USUARIO = process.env.APP_USER || 'admin';
const CLAVE = process.env.APP_PASSWORD || 'Familia01';

/* ---------- Almacenamiento ----------
   En Render conviene montar un disco persistente y apuntar DATA_DIR ahí;
   sin disco, el archivo se reinicia en cada deploy. */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

const CONFIG_INICIAL = {
  params: {
    mes1Pct: 13, mes2Pct: 7, redondeo: 1000,
    coefCub: 1, coefSemi: 0.7, coefDesc: 0.33,
    dias: 120, honorarios: 3,
    ciudad: 'Ciudad Autónoma de Buenos Aires',
    agente: 'Martín González', matricula: 'MN 524 · CPI'
  },
  barrios: [
    { id: 'b1',  nombre: 'Villa Devoto',     valorM2: 2350, cub: 1, semi: 0.70, desc: 0.33 },
    { id: 'b2',  nombre: 'Villa del Parque', valorM2: 2250, cub: 1, semi: 0.70, desc: 0.33 },
    { id: 'b3',  nombre: 'Villa Pueyrredón', valorM2: 2200, cub: 1, semi: 0.70, desc: 0.33 },
    { id: 'b4',  nombre: 'Agronomía',        valorM2: 2300, cub: 1, semi: 0.70, desc: 0.35 },
    { id: 'b5',  nombre: 'Villa Urquiza',    valorM2: 2600, cub: 1, semi: 0.65, desc: 0.30 },
    { id: 'b6',  nombre: 'Caballito',        valorM2: 2500, cub: 1, semi: 0.65, desc: 0.30 },
    { id: 'b7',  nombre: 'Almagro',          valorM2: 2300, cub: 1, semi: 0.65, desc: 0.28 },
    { id: 'b8',  nombre: 'Flores',           valorM2: 1900, cub: 1, semi: 0.70, desc: 0.33 },
    { id: 'b9',  nombre: 'Belgrano',         valorM2: 3000, cub: 1, semi: 0.60, desc: 0.25 },
    { id: 'b10', nombre: 'Palermo',          valorM2: 3100, cub: 1, semi: 0.60, desc: 0.25 }
  ],
  mercado: { enVenta: 110000, vendidas: 6051, ref: 'Julio 2026' }
};

function leerDB() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.tasaciones = db.tasaciones || [];
    db.config = Object.assign({}, CONFIG_INICIAL, db.config || {});
    return db;
  } catch {
    return { tasaciones: [], config: CONFIG_INICIAL };
  }
}

// Escritura atómica: primero a un temporal, después rename
function escribirDB(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

if (!fs.existsSync(DB_FILE)) escribirDB({ tasaciones: [], config: CONFIG_INICIAL });

/* ---------- Middleware ---------- */
app.set('trust proxy', 1);            // Render corre detrás de un proxy TLS
app.use(express.json({ limit: '30mb' })); // las fotos de referencia viajan en base64

app.use(session({
  name: 'gi.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: PRODUCCION,
    maxAge: 1000 * 60 * 60 * 12   // 12 horas
  }
}));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

function requiereSesion(req, res, next) {
  if (req.session && req.session.usuario) return next();
  res.status(401).json({ error: 'Sesión no iniciada' });
}

/* ---------- Autenticación ---------- */
const intentos = new Map();   // freno simple a la fuerza bruta

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

/* ---------- Configuración ---------- */
app.get('/api/config', requiereSesion, (req, res) => {
  res.json(leerDB().config);
});

app.put('/api/config', requiereSesion, (req, res) => {
  const db = leerDB();
  db.config = Object.assign({}, db.config, req.body || {});
  escribirDB(db);
  res.json(db.config);
});

/* ---------- Tasaciones ---------- */
const nuevoId = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

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

app.get('/api/tasaciones', requiereSesion, (req, res) => {
  const lista = leerDB().tasaciones
    .map(resumen)
    .sort((a, b) => (b.actualizada || '').localeCompare(a.actualizada || ''));
  res.json(lista);
});

app.get('/api/tasaciones/:id', requiereSesion, (req, res) => {
  const t = leerDB().tasaciones.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'No encontrada' });
  res.json(t);
});

app.post('/api/tasaciones', requiereSesion, (req, res) => {
  const db = leerDB();
  const ahora = new Date().toISOString();
  const t = Object.assign({}, req.body, { id: nuevoId(), creada: ahora, actualizada: ahora });
  db.tasaciones.push(t);
  escribirDB(db);
  res.status(201).json(t);
});

app.put('/api/tasaciones/:id', requiereSesion, (req, res) => {
  const db = leerDB();
  const i = db.tasaciones.findIndex(x => x.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'No encontrada' });
  db.tasaciones[i] = Object.assign({}, db.tasaciones[i], req.body, {
    id: db.tasaciones[i].id,
    creada: db.tasaciones[i].creada,
    actualizada: new Date().toISOString()
  });
  escribirDB(db);
  res.json(db.tasaciones[i]);
});

// Duplicar: útil para tasar otra unidad del mismo edificio o rehacer una vieja
app.post('/api/tasaciones/:id/duplicar', requiereSesion, (req, res) => {
  const db = leerDB();
  const orig = db.tasaciones.find(x => x.id === req.params.id);
  if (!orig) return res.status(404).json({ error: 'No encontrada' });
  const ahora = new Date().toISOString();
  const copia = Object.assign({}, JSON.parse(JSON.stringify(orig)), {
    id: nuevoId(), creada: ahora, actualizada: ahora, estado: 'borrador'
  });
  copia.prop.dir = (copia.prop.dir || '') + ' (copia)';
  db.tasaciones.push(copia);
  escribirDB(db);
  res.status(201).json(copia);
});

app.delete('/api/tasaciones/:id', requiereSesion, (req, res) => {
  const db = leerDB();
  const antes = db.tasaciones.length;
  db.tasaciones = db.tasaciones.filter(x => x.id !== req.params.id);
  if (db.tasaciones.length === antes) return res.status(404).json({ error: 'No encontrada' });
  escribirDB(db);
  res.json({ ok: true });
});

/* ---------- Salud y arranque ---------- */
app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'No encontrado' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`González Inmuebles · escuchando en http://localhost:${PORT}`);
  console.log(`Datos en ${DB_FILE}`);
});
