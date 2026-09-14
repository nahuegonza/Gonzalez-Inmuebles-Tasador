/* ============================================================
   Almacenamiento
   Dos backends intercambiables:
   · Postgres  → si existe DATABASE_URL (recomendado, persiste siempre)
   · Archivo   → db.json en DATA_DIR (para desarrollo local)
   El resto de la aplicación no sabe cuál está en uso.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

const nuevoId = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const ahora = () => new Date().toISOString();

/* ============================================================
   BACKEND POSTGRES
   ============================================================ */
function backendPostgres(urlConexion) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: urlConexion,
    // Neon, Supabase y Render exigen TLS; en local se apaga con PGSSL=off
    ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
    max: 4
  });

  async function iniciar() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS documentos (
        clave       TEXT PRIMARY KEY,
        datos       JSONB NOT NULL,
        creada      TIMESTAMPTZ NOT NULL DEFAULT now(),
        actualizada TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  async function leerConfig() {
    const r = await pool.query('SELECT datos FROM documentos WHERE clave = $1', ['config']);
    return r.rows.length ? Object.assign({}, CONFIG_INICIAL, r.rows[0].datos) : CONFIG_INICIAL;
  }

  async function guardarConfig(config) {
    await pool.query(`
      INSERT INTO documentos (clave, datos) VALUES ('config', $1)
      ON CONFLICT (clave) DO UPDATE SET datos = $1, actualizada = now()
    `, [JSON.stringify(config)]);
    return config;
  }

  async function listar() {
    const r = await pool.query(`
      SELECT clave, datos, creada, actualizada FROM documentos
      WHERE clave LIKE 'tasacion:%' ORDER BY actualizada DESC
    `);
    return r.rows.map(f => Object.assign({}, f.datos, {
      id: f.clave.slice(9),
      creada: f.creada.toISOString(),
      actualizada: f.actualizada.toISOString()
    }));
  }

  async function obtener(id) {
    const r = await pool.query('SELECT clave, datos, creada, actualizada FROM documentos WHERE clave = $1', ['tasacion:' + id]);
    if (!r.rows.length) return null;
    const f = r.rows[0];
    return Object.assign({}, f.datos, {
      id, creada: f.creada.toISOString(), actualizada: f.actualizada.toISOString()
    });
  }

  async function crear(datos) {
    const id = nuevoId();
    await pool.query('INSERT INTO documentos (clave, datos) VALUES ($1, $2)', ['tasacion:' + id, JSON.stringify(datos)]);
    return obtener(id);
  }

  async function actualizar(id, datos) {
    // "||" fusiona a nivel superficial, igual que el Object.assign del otro backend
    const r = await pool.query(`
      UPDATE documentos SET datos = datos || $2::jsonb, actualizada = now()
      WHERE clave = $1 RETURNING clave
    `, ['tasacion:' + id, JSON.stringify(datos)]);
    return r.rowCount ? obtener(id) : null;
  }

  async function borrar(id) {
    const r = await pool.query('DELETE FROM documentos WHERE clave = $1', ['tasacion:' + id]);
    return r.rowCount > 0;
  }

  return { tipo: 'postgres', iniciar, leerConfig, guardarConfig, listar, obtener, crear, actualizar, borrar };
}

/* ============================================================
   BACKEND ARCHIVO
   ============================================================ */
function backendArchivo(carpeta) {
  const ARCHIVO = path.join(carpeta, 'db.json');

  function leer() {
    try {
      const db = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
      db.tasaciones = db.tasaciones || [];
      db.config = Object.assign({}, CONFIG_INICIAL, db.config || {});
      return db;
    } catch {
      return { tasaciones: [], config: CONFIG_INICIAL };
    }
  }

  // Escritura atómica: primero a un temporal, después rename
  function escribir(db) {
    const tmp = ARCHIVO + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, ARCHIVO);
  }

  async function iniciar() {
    fs.mkdirSync(carpeta, { recursive: true });
    if (!fs.existsSync(ARCHIVO)) escribir({ tasaciones: [], config: CONFIG_INICIAL });
  }

  return {
    tipo: 'archivo',
    iniciar,
    async leerConfig() { return leer().config; },
    async guardarConfig(config) {
      const db = leer(); db.config = config; escribir(db); return config;
    },
    async listar() {
      return leer().tasaciones.slice().sort((a, b) => (b.actualizada || '').localeCompare(a.actualizada || ''));
    },
    async obtener(id) {
      return leer().tasaciones.find(t => t.id === id) || null;
    },
    async crear(datos) {
      const db = leer();
      const t = Object.assign({}, datos, { id: nuevoId(), creada: ahora(), actualizada: ahora() });
      db.tasaciones.push(t); escribir(db); return t;
    },
    async actualizar(id, datos) {
      const db = leer();
      const i = db.tasaciones.findIndex(t => t.id === id);
      if (i === -1) return null;
      db.tasaciones[i] = Object.assign({}, db.tasaciones[i], datos, {
        id, creada: db.tasaciones[i].creada, actualizada: ahora()
      });
      escribir(db); return db.tasaciones[i];
    },
    async borrar(id) {
      const db = leer();
      const antes = db.tasaciones.length;
      db.tasaciones = db.tasaciones.filter(t => t.id !== id);
      if (db.tasaciones.length === antes) return false;
      escribir(db); return true;
    }
  };
}

/* ============================================================
   Selección automática
   ============================================================ */
const almacen = process.env.DATABASE_URL
  ? backendPostgres(process.env.DATABASE_URL)
  : backendArchivo(process.env.DATA_DIR || path.join(__dirname, 'data'));

almacen.CONFIG_INICIAL = CONFIG_INICIAL;
almacen.nuevoId = nuevoId;

module.exports = almacen;
