/* ============================================================
   GONZÁLEZ INMUEBLES · Aplicación
   Un único componente Alpine: sesión, histórico, asistente,
   motor de cálculo y exportaciones.
   ============================================================ */
let _uid = 0;

function app() {
  return {
    /* ---------- Navegación ---------- */
    pantalla: 'cargando',      // cargando | login | lista | editor | config
    usuario: '',
    acceso: { usuario: '', clave: '', error: '', enviando: false },
    toast: '',
    confirmacion: null,

    /* ---------- Histórico ---------- */
    lista: [],
    filtro: '',
    idActual: null,
    estado: 'borrador',
    guardando: false,
    guardandoConfig: false,

    /* ---------- Configuración compartida ---------- */
    params: {
      mes1Pct: 13, mes2Pct: 7, redondeo: 1000,
      coefCub: 1, coefSemi: 0.7, coefDesc: 0.33,
      dias: 120, honorarios: 3,
      ciudad: 'Ciudad Autónoma de Buenos Aires',
      agente: 'Martín González', matricula: 'MN 524 · CPI'
    },
    barrios: [],

    /* ---------- Asistente ---------- */
    paso: 0,
    pasos: [
      { corto: 'Propiedad',   nombre: 'La propiedad',            hoja: 4, ayuda: 'Datos de la unidad visitada y superficies relevadas.' },
      { corto: 'Competencia', nombre: 'Competencia en la zona',  hoja: 2, ayuda: 'Cuántas propiedades similares se publican y con qué material.' },
      { corto: 'Referencias', nombre: 'Referencias del mercado',  hoja: 3, ayuda: 'La más económica, la más cara y la más parecida a la tuya.' },
      { corto: 'Comparables', nombre: 'Comparables',             hoja: 5, ayuda: 'Las publicaciones que alimentan el cálculo del valor.' },
      { corto: 'Precios',     nombre: 'Estrategia de precios',   hoja: 6, ayuda: 'Escalonamiento de publicación y objetivo de cierre.' },
      { corto: 'Cierre',      nombre: 'Contexto y condiciones',  hoja: 1, ayuda: 'Datos generales del mercado, condiciones de trabajo y firma.' }
    ],

    /* ---------- Vista previa ---------- */
    visor: false,
    zoom: 70,
    zoomManual: false,
    hojaActiva: 0,
    hojas: ['1 · Portada', '2 · Mercado', '3 · Competencia', '4 · Referencias',
            '5 · Tu propiedad', '6 · Valuación', '7 · Estrategia'],

    /* ---------- Datos de la tasación ---------- */
    prop: { dir: '', zona: '', tipo: '', cub: 0, semi: 0, desc: 0 },
    coef: { cub: 1, semi: 0.7, desc: 0.33 },
    comp: { similares: 0, fotos: 0, video: 0, tour: 0, min: 0, max: 0 },
    destacadas: [],
    comps: [],
    estrategia: { mes1: 0, mes2: 0, objetivo: 0 },
    objetivoAuto: true,
    mercado: { enVenta: 110000, vendidas: 6051, ref: 'Julio 2026' },
    cond: { dias: 120, honorarios: 3, agente: 'Martín González', matricula: 'MN 524 · CPI' },
    zonaSel: '',
    mapaAbierto: false,

    /* ============================================================
       ARRANQUE Y SESIÓN
       ============================================================ */
    async init() {
      window.addEventListener('resize', () => {
        clearTimeout(this._t);
        this._t = setTimeout(() => { if (this.visor && !this.zoomManual) this.ajustarZoom(); }, 180);
      });

      try {
        const me = await this.api('GET', '/api/me');
        this.usuario = me.usuario;
        await this.trasIngresar();
      } catch {
        this.pantalla = 'login';
      }
    },

    async api(metodo, url, cuerpo) {
      const r = await fetch(url, {
        method: metodo,
        headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
        body: cuerpo ? JSON.stringify(cuerpo) : undefined
      });
      if (r.status === 401 && this.pantalla !== 'login') {
        this.pantalla = 'login';
        throw new Error('Sesión vencida');
      }
      const datos = r.status === 204 ? null : await r.json().catch(() => null);
      if (!r.ok) throw new Error((datos && datos.error) || 'Error de conexión');
      return datos;
    },

    async entrar() {
      this.acceso.error = '';
      this.acceso.enviando = true;
      try {
        const r = await this.api('POST', '/api/login', {
          usuario: this.acceso.usuario.trim(), clave: this.acceso.clave
        });
        this.usuario = r.usuario;
        this.acceso.clave = '';
        await this.trasIngresar();
      } catch (e) {
        this.acceso.error = e.message;
      } finally {
        this.acceso.enviando = false;
      }
    },

    async trasIngresar() {
      await this.cargarConfig();
      await this.cargarLista();
      this.pantalla = 'lista';
    },

    async salir() {
      await this.api('POST', '/api/logout').catch(() => {});
      this.usuario = '';
      this.lista = [];
      this.pantalla = 'login';
    },

    /* ============================================================
       CONFIGURACIÓN
       ============================================================ */
    async cargarConfig() {
      const c = await this.api('GET', '/api/config');
      this.params = Object.assign(this.params, c.params || {});
      this.barrios = (c.barrios || []).map(b => Object.assign({ id: 'b' + (++_uid) }, b));
      if (c.mercado) this.mercado = Object.assign({}, c.mercado);
    },

    async guardarConfig() {
      this.guardandoConfig = true;
      try {
        await this.api('PUT', '/api/config', {
          params: this.params, barrios: this.barrios, mercado: this.mercado
        });
        this.avisar('Configuración guardada.');
      } catch (e) {
        this.avisar(e.message);
      } finally {
        this.guardandoConfig = false;
      }
    },

    async restablecer() {
      await this.api('PUT', '/api/config', { params: null, barrios: null, mercado: null }).catch(() => {});
      location.reload();
    },

    bajarConfig() {
      descargar(JSON.stringify({ params: this.params, barrios: this.barrios, mercado: this.mercado }, null, 2),
        'config-gonzalez-inmuebles.json', 'application/json');
    },

    subirConfig(ev) {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      const lector = new FileReader();
      lector.onload = () => {
        try {
          const d = JSON.parse(lector.result);
          if (d.params) this.params = Object.assign(this.params, d.params);
          if (d.barrios) this.barrios = d.barrios;
          if (d.mercado) this.mercado = d.mercado;
          this.avisar('Copia cargada. Acordate de guardar los cambios.');
        } catch { this.avisar('El archivo no tiene un formato válido.'); }
      };
      lector.readAsText(f);
      ev.target.value = '';
    },

    /* ============================================================
       HISTÓRICO
       ============================================================ */
    async cargarLista() {
      this.lista = await this.api('GET', '/api/tasaciones');
    },

    get listaFiltrada() {
      const q = this.filtro.trim().toLowerCase();
      if (!q) return this.lista;
      return this.lista.filter(t =>
        (t.direccion + ' ' + t.zona + ' ' + t.tipo).toLowerCase().includes(q));
    },

    etiquetaEstado(e) {
      return { borrador: 'Borrador', enviada: 'Enviada', cerrada: 'Cerrada' }[e] || 'Borrador';
    },

    fecha(iso) {
      if (!iso) return '—';
      return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    },

    volverALista() {
      this.pantalla = 'lista';
      this.cargarLista();
    },

    // Tasación en blanco, tomando los valores por defecto de la configuración
    nueva(conEjemplo) {
      this.idActual = null;
      this.estado = 'borrador';
      this.paso = 0;
      this.prop = { dir: '', zona: '', tipo: '', cub: 0, semi: 0, desc: 0 };
      this.coef = { cub: n(this.params.coefCub, 1), semi: n(this.params.coefSemi, .7), desc: n(this.params.coefDesc, .33) };
      this.comp = { similares: 0, fotos: 0, video: 0, tour: 0, min: 0, max: 0 };
      this.destacadas = [
        { rol: 'La más económica', destacar: false, foto: '', titulo: '', precio: 0, m2: 0, ambientes: 0, caracteristicas: '', url: '' },
        { rol: 'La más cara',      destacar: false, foto: '', titulo: '', precio: 0, m2: 0, ambientes: 0, caracteristicas: '', url: '' },
        { rol: 'La más parecida',  destacar: true,  foto: '', titulo: '', precio: 0, m2: 0, ambientes: 0, caracteristicas: '', url: '' }
      ];
      this.comps = [];
      this.estrategia = { mes1: 0, mes2: 0, objetivo: 0 };
      this.objetivoAuto = true;
      this.cond = {
        dias: n(this.params.dias, 120), honorarios: n(this.params.honorarios, 3),
        agente: this.params.agente || '', matricula: this.params.matricula || ''
      };
      this.zonaSel = '';
      this.mapaAbierto = false;
      if (conEjemplo) this.cargarDemo();
      this.pantalla = 'editor';
    },

    async abrir(id) {
      try {
        const t = await this.api('GET', '/api/tasaciones/' + id);
        this.idActual = t.id;
        this.estado = t.estado || 'borrador';
        ['prop', 'coef', 'comp', 'destacadas', 'comps', 'estrategia', 'mercado', 'cond']
          .forEach(k => { if (t[k]) this[k] = t[k]; });
        this.objetivoAuto = typeof t.objetivoAuto === 'boolean' ? t.objetivoAuto : true;
        this.zonaSel = this.barrioActual ? this.prop.zona : (this.prop.zona ? '__otro' : '');
        this.paso = 0;
        this.pantalla = 'editor';
      } catch (e) { this.avisar(e.message); }
    },

    cuerpoTasacion() {
      return {
        estado: this.estado, prop: this.prop, coef: this.coef, comp: this.comp,
        destacadas: this.destacadas, comps: this.comps, estrategia: this.estrategia,
        objetivoAuto: this.objetivoAuto, mercado: this.mercado, cond: this.cond,
        // se guardan calculados para poder listarlos sin recalcular
        resumen: { supHom: this.supHom, promedioM2: this.promedioM2, valuacion: this.valuacion }
      };
    },

    async guardar(silencioso) {
      if (this.guardando) return;
      this.guardando = true;
      try {
        const cuerpo = this.cuerpoTasacion();
        if (this.idActual) {
          await this.api('PUT', '/api/tasaciones/' + this.idActual, cuerpo);
        } else {
          const t = await this.api('POST', '/api/tasaciones', cuerpo);
          this.idActual = t.id;
        }
        if (!silencioso) this.avisar('Tasación guardada.');
      } catch (e) {
        this.avisar(e.message);
      } finally {
        this.guardando = false;
      }
    },

    async duplicar(id) {
      try {
        await this.api('POST', '/api/tasaciones/' + id + '/duplicar');
        await this.cargarLista();
        this.avisar('Tasación duplicada.');
      } catch (e) { this.avisar(e.message); }
    },

    pedirBorrado(t) {
      this.confirmacion = {
        titulo: 'Borrar tasación',
        texto: 'Se va a eliminar la tasación de ' + t.direccion + '. Esta acción no se puede deshacer.',
        accion: async () => {
          this.confirmacion = null;
          try {
            await this.api('DELETE', '/api/tasaciones/' + t.id);
            if (this.idActual === t.id) this.idActual = null;
            await this.cargarLista();
            this.avisar('Tasación borrada.');
          } catch (e) { this.avisar(e.message); }
        }
      };
    },

    /* ============================================================
       MOTOR DE CÁLCULO
       ============================================================ */
    get supHom() {
      const p = this.prop, k = this.coef;
      return n(p.cub) * n(k.cub) + n(p.semi) * n(k.semi) + n(p.desc) * n(k.desc);
    },
    get supTotal() { return n(this.prop.cub) + n(this.prop.semi) + n(this.prop.desc); },

    valorM2(c) {
      const m2 = n(c.m2);
      return m2 > 0 ? (n(c.precio) / m2) * n(c.coef, 1) : 0;
    },

    get promedioM2() {
      const v = this.comps.filter(c => n(c.m2) > 0 && n(c.precio) > 0);
      return v.length ? v.reduce((a, c) => a + this.valorM2(c), 0) / v.length : 0;
    },

    get valuacion() { return this.supHom * this.promedioM2; },

    get objetivoCierre() {
      return this.objetivoAuto ? redondear(this.valuacion, this.params.redondeo) : n(this.estrategia.objetivo);
    },

    get brechaPct() {
      const p1 = n(this.estrategia.mes1);
      return p1 > 0 ? ((p1 - this.objetivoCierre) / p1) * 100 : 0;
    },

    pctDe(v) {
      const t = n(this.comp.similares);
      return t > 0 ? Math.min(100, (n(v) / t) * 100) : 0;
    },
    get pctFotos() { return this.pctDe(this.comp.fotos); },
    get pctVideo() { return this.pctDe(this.comp.video); },
    get pctTour()  { return this.pctDe(this.comp.tour); },

    posEnRango(v) {
      const min = n(this.comp.min), max = n(this.comp.max);
      if (max <= min) return 50;
      return Math.min(100, Math.max(0, ((n(v) - min) / (max - min)) * 100));
    },
    posEtiqueta(v) { return Math.min(87, Math.max(13, this.posEnRango(v))); },

    get porcentajeVenta() {
      const ev = n(this.mercado.enVenta);
      return ev > 0 ? (n(this.mercado.vendidas) / ev) * 100 : 0;
    },
    get casasLlenas() {
      const p = this.porcentajeVenta;
      return Math.min(100, Math.max(p > 0 ? 1 : 0, Math.round(p)));
    },

    /* ============================================================
       BARRIOS
       ============================================================ */
    get barrioActual() {
      const z = (this.prop.zona || '').trim().toLowerCase();
      return this.barrios.find(b => (b.nombre || '').trim().toLowerCase() === z) || null;
    },
    get valorRefM2() { return this.barrioActual ? n(this.barrioActual.valorM2) : 0; },
    get desvioRefPct() {
      const ref = this.valorRefM2;
      return ref > 0 ? (this.promedioM2 / ref - 1) * 100 : 0;
    },

    elegirBarrio() {
      if (this.zonaSel === '__otro') { this.prop.zona = ''; return; }
      this.prop.zona = this.zonaSel;
      const b = this.barrioActual;
      if (b) this.coef = { cub: n(b.cub, 1), semi: n(b.semi, .7), desc: n(b.desc, .33) };
    },

    agregarBarrio() {
      this.barrios.push({
        id: 'b' + (++_uid), nombre: '', valorM2: 0,
        cub: n(this.params.coefCub, 1), semi: n(this.params.coefSemi, .7), desc: n(this.params.coefDesc, .33)
      });
    },
    quitarBarrio(i) { this.barrios.splice(i, 1); },

    async guardarBarrioActual() {
      const nom = (this.prop.zona || '').trim();
      if (!nom) { this.avisar('Escribí primero el nombre del barrio.'); return; }
      if (this.barrioActual) { this.avisar('Ese barrio ya está en la matriz.'); return; }
      this.barrios.push({
        id: 'b' + (++_uid), nombre: nom, valorM2: Math.round(this.promedioM2),
        cub: n(this.coef.cub, 1), semi: n(this.coef.semi, .7), desc: n(this.coef.desc, .33)
      });
      this.zonaSel = nom;
      await this.guardarConfig();
    },

    /* ---------- Google Maps (por URL, sin API key) ---------- */
    get consultaMapa() {
      return [this.prop.dir, this.prop.zona, this.params.ciudad].filter(Boolean).join(', ');
    },
    get urlMapa() {
      return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(this.consultaMapa);
    },
    get urlMapaEmbed() {
      return 'https://maps.google.com/maps?q=' + encodeURIComponent(this.consultaMapa) + '&z=16&output=embed';
    },

    /* ============================================================
       ASISTENTE
       ============================================================ */
    irA(i) {
      this.paso = Math.min(this.pasos.length - 1, Math.max(0, i));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      this.guardar(true);
    },
    next() { this.irA(this.paso + 1); },
    prev() { this.irA(this.paso - 1); },

    agregarComp() {
      this.comps.push({ id: ++_uid, titulo: '', url: '', precio: 0, m2: 0, coef: 1 });
    },
    quitarComp(i) { this.comps.splice(i, 1); },

    fijarObjetivo(v) { this.objetivoAuto = false; this.estrategia.objetivo = n(v); },
    volverAuto() { this.objetivoAuto = true; },

    precioSugerido(pct) {
      return redondear(this.objetivoCierre * (1 + n(pct) / 100), this.params.redondeo);
    },
    sugerirPrecios() {
      this.estrategia.mes1 = this.precioSugerido(this.params.mes1Pct);
      this.estrategia.mes2 = this.precioSugerido(this.params.mes2Pct);
    },

    aplicarDefaults() {
      if (!this.barrioActual) {
        this.coef = { cub: n(this.params.coefCub, 1), semi: n(this.params.coefSemi, .7), desc: n(this.params.coefDesc, .33) };
      }
      this.cond.dias = n(this.params.dias, 120);
      this.cond.honorarios = n(this.params.honorarios, 3);
      this.avisar('Parámetros aplicados a la tasación actual.');
    },

    cargarFoto(ev, destino) {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      if (f.size > 4 * 1024 * 1024) { this.avisar('La imagen supera los 4 MB. Probá con una más liviana.'); return; }
      const lector = new FileReader();
      lector.onload = () => { destino.foto = lector.result; };
      lector.onerror = () => this.avisar('No se pudo leer la imagen.');
      lector.readAsDataURL(f);
    },

    /* ============================================================
       VISTA PREVIA
       ============================================================ */
    async abrirVisor() {
      await this.guardar(true);
      this.visor = true;
      document.body.style.overflow = 'hidden';
      this.$nextTick(() => {
        this.ajustarZoom();
        this.observarHojas();
        this.verHoja(0);
      });
    },

    cerrarVisor() {
      this.visor = false;
      document.body.style.overflow = '';
    },

    observarHojas() {
      if (this._obs) return;
      this._obs = new IntersectionObserver(entradas => {
        entradas.forEach(e => {
          if (e.isIntersecting) this.hojaActiva = Number(e.target.id.replace('hoja', ''));
        });
      }, { threshold: 0.4 });
      document.querySelectorAll('.page').forEach(p => this._obs.observe(p));
    },

    verHoja(i) {
      this.hojaActiva = i;
      const el = document.getElementById('hoja' + i);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    setZoom(d) {
      this.zoomManual = true;
      this.zoom = Math.min(130, Math.max(25, this.zoom + d));
      this.aplicarZoom();
    },

    // Encaja el ancho de la hoja A4 (210 mm ≈ 794 px) en el espacio disponible
    ajustarZoom() {
      this.zoomManual = false;
      const cont = this.$refs.lienzo;
      const ancho = cont && cont.clientWidth ? cont.clientWidth : window.innerWidth;
      const util = Math.max(200, ancho - (window.innerWidth < 820 ? 16 : 48));
      this.zoom = Math.min(110, Math.max(25, Math.round((util / 794) * 100)));
      this.aplicarZoom();
    },

    aplicarZoom() {
      document.documentElement.style.setProperty('--zoom', this.zoom / 100);
    },

    avisar(msg) {
      this.toast = msg;
      clearTimeout(this._toast);
      this._toast = setTimeout(() => { this.toast = ''; }, 3200);
    },

    /* ---------- Formato ---------- */
    num(v, d = 0) {
      return n(v).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
    },
    usd(v, d = 0) { return 'USD ' + this.num(v, d); },

    /* ============================================================
       DATOS DE EJEMPLO
       ============================================================ */
    cargarDemo() {
      this.prop = { dir: 'Campana 3874', zona: 'Villa Devoto',
                    tipo: 'PH de 3 ambientes con terraza propia',
                    cub: 67.77, semi: 4.93, desc: 66.51 };
      this.zonaSel = 'Villa Devoto';
      this.elegirBarrio();
      this.comp = { similares: 38, fotos: 22, video: 7, tour: 3, min: 159000, max: 289000 };
      this.destacadas = [
        { rol: 'La más económica', destacar: false, foto: '', titulo: 'PH 2 ambientes a refaccionar',
          precio: 159000, m2: 61, ambientes: 2,
          caracteristicas: 'Interno, sin luz natural directa, cocina y baño originales. Sin espacio exterior propio.', url: '' },
        { rol: 'La más cara', destacar: false, foto: '', titulo: 'PH 3 ambientes reciclado con terraza y parrilla',
          precio: 289000, m2: 96, ambientes: 3,
          caracteristicas: 'Reciclado a nuevo, cocina integrada, terraza con parrilla y cochera.', url: '' },
        { rol: 'La más parecida', destacar: true, foto: '', titulo: 'PH 3 ambientes con terraza propia',
          precio: 214000, m2: 84, ambientes: 3,
          caracteristicas: 'Superficie y distribución equivalentes, terraza propia, sin expensas, apto crédito.', url: '' }
      ];
      this.comps = [
        { id: ++_uid, titulo: 'PH 2 dormitorios, sin expensas · Villa Devoto', url: '', precio: 229000, m2: 117.90, coef: 1.05 },
        { id: ++_uid, titulo: 'PH en venta · Villa Devoto', url: '', precio: 220000, m2: 82.89, coef: 0.95 },
        { id: ++_uid, titulo: 'PH 3 ambientes con patio y terraza · Villa Devoto', url: '', precio: 214000, m2: 84.00, coef: 1.05 },
        { id: ++_uid, titulo: 'PH 3 ambientes con terraza propia · Villa Devoto', url: '', precio: 260000, m2: 84.75, coef: 0.95 }
      ];
      this.estrategia = { mes1: 208000, mes2: 197000, objetivo: 184000 };
      this.objetivoAuto = false;
    },

    /* ============================================================
       EXPORTACIÓN A WORD
       ============================================================ */
    async exportarWord() {
      const V = '#1B4332', D = '#C59B27', CR = '#F7F5EE';
      const t = (s) => esc(s || '');
      const A = {
        logo: await imagenBase64('/img/logo.jpg'),
        foto: await imagenBase64('/img/fotos.jpg'),
        video: await imagenBase64('/img/video.jpg'),
        tour: await imagenBase64('/img/tour.jpg'),
        plano: await imagenBase64('/img/planos.jpg')
      };
      const salto = '<br clear="all" style="mso-special-character:line-break;page-break-before:always">';

      const filaComparable = (c, i) => `
        <tr>
          <td style="border:1px solid #E3E0D6;padding:6pt;font-size:9pt">${t(c.titulo || 'Comparable ' + (i + 1))}
            ${c.url ? `<br><a href="${t(c.url)}" style="color:${D};font-size:7.5pt">Ver publicación</a>` : ''}</td>
          <td style="border:1px solid #E3E0D6;padding:6pt;font-size:9pt;text-align:right">${this.usd(c.precio)}</td>
          <td style="border:1px solid #E3E0D6;padding:6pt;font-size:9pt;text-align:right">${this.num(c.m2, 2)}</td>
          <td style="border:1px solid #E3E0D6;padding:6pt;font-size:9pt;text-align:right">${this.usd(this.valorM2(c), 2)}
            <br><span style="font-size:7.5pt;color:#5A5A54">ajustado por ${this.num(c.coef, 2)}</span></td>
        </tr>`;

      const celdaFicha = (d) => `
        <td width="33%" valign="top" style="border:1px solid ${d.destacar ? D : '#E3E0D6'};padding:0">
          <div style="background:${d.destacar ? D : V};color:${d.destacar ? '#241b00' : '#ffffff'};
                      padding:5pt;font-size:8pt;font-weight:bold;text-transform:uppercase">${t(d.rol)}</div>
          <div style="padding:8pt">
            ${d.foto ? `<img src="${d.foto}" width="160" style="width:160px"><br><br>` : ''}
            <span style="font-size:15pt;color:${V};font-weight:bold">${this.usd(d.precio)}</span><br>
            <span style="font-size:8pt;color:${D};font-weight:bold">
              ${d.m2 > 0 ? this.usd(d.precio / d.m2) + ' / m²' : '—'}
              ${d.m2 > 0 ? ' · ' + this.num(d.m2, 0) + ' m²' : ''}
              ${d.ambientes > 0 ? ' · ' + this.num(d.ambientes) + ' amb.' : ''}
            </span><br><br>
            <span style="font-size:9pt;font-weight:bold">${t(d.titulo)}</span><br>
            <span style="font-size:8.5pt;color:#5A5A54">${t(d.caracteristicas)}</span>
            ${d.url ? `<br><a href="${t(d.url)}" style="color:${D};font-size:8pt">Ver publicación</a>` : ''}
          </div>
        </td>`;

      const doc = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Tasación ${t(this.prop.dir)}</title>
<style>
  @page WordSection1 { size:21cm 29.7cm; margin:2cm; }
  div.WordSection1 { page:WordSection1; }
  body { font-family:'Montserrat',Calibri,Arial,sans-serif; color:#1C1C1A; font-size:10pt; }
  h1 { font-family:Georgia,serif; color:${V}; font-size:22pt; margin:0 0 6pt; }
  h2 { font-family:Georgia,serif; color:${V}; font-size:15pt; margin:18pt 0 6pt; }
  h3 { color:${V}; font-size:10pt; letter-spacing:1pt; text-transform:uppercase; margin:14pt 0 6pt; }
  p  { font-size:9.5pt; line-height:150%; margin:0 0 8pt; }
  table { border-collapse:collapse; width:100%; }
  .eyebrow { color:${D}; font-size:8pt; letter-spacing:2pt; text-transform:uppercase; font-weight:bold; }
  .def { font-size:8.5pt; color:#4A4A44; background:#FBFAF7; padding:8pt; border:1px solid #E3E0D6; }
</style></head>
<body><div class="WordSection1">

  <p align="center"><img src="${A.logo}" width="300" style="width:300px"></p>
  <p align="center" style="font-size:9.5pt;color:#3B3B36">
    Vender una propiedad es una decisión patrimonial, no una publicación más. Trabajamos con
    información verificable, precios sostenidos en el análisis de mercado y un proceso transparente
    en cada etapa: desde la tasación hasta la escritura.</p>

  <table style="background:${V};color:#ffffff"><tr><td style="padding:10pt;text-align:center;
    font-size:14pt;font-weight:bold">ESTRATEGIA COMERCIAL PREMIUM</td></tr></table>
  <table style="margin-top:10pt"><tr>
    ${[['Fotografías profesionales', A.foto], ['Video recorridos', A.video],
       ['Tour virtual 360°', A.tour], ['Planos comerciales', A.plano]].map(([tit, img]) => `
      <td width="25%" valign="top" style="border:1px solid #E3E0D6;padding:6pt">
        <p style="font-size:8pt;font-weight:bold;color:${V};text-transform:uppercase">${tit}</p>
        <img src="${img}" width="120" style="width:120px"></td>`).join('')}
  </tr></table>
  <table style="background:${V};color:#ffffff;margin-top:10pt"><tr><td style="padding:8pt;text-align:center">
    <span style="color:${D};font-weight:bold;font-size:11pt">UNA ESTRATEGIA COMPLETA PARA VENDER MEJOR</span><br>
    <span style="font-size:9pt">MÁS ALCANCE · MÁS CONSULTAS · MÁS VISITAS · MEJOR CIERRE</span>
  </td></tr></table>

  ${salto}

  <h2>El mercado y la importancia del precio</h2>
  <table><tr>
    <td width="50%" style="text-align:center;padding:10pt;border:1px solid #E3E0D6">
      <span style="font-size:8pt;text-transform:uppercase;color:${V};font-weight:bold">Propiedades en venta</span><br>
      <span style="font-size:26pt;font-weight:bold;color:${V}">${this.num(this.mercado.enVenta)}</span></td>
    <td width="50%" style="text-align:center;padding:10pt;border:1px solid #E3E0D6">
      <span style="font-size:8pt;text-transform:uppercase;color:${V};font-weight:bold">Propiedades vendidas</span><br>
      <span style="font-size:26pt;font-weight:bold;color:${V}">${this.num(this.mercado.vendidas)}</span></td>
  </tr></table>
  <p align="center" class="eyebrow">Datos de referencia · ${t(this.mercado.ref)}</p>
  <p align="center" style="font-size:13pt;font-weight:bold;color:${V}">
    Hoy se vende solo el ${this.num(this.porcentajeVenta, 1)} % de lo publicado.</p>
  <p class="def"><b style="color:${V}">Precio de publicación</b> es el que figura en el aviso.
    <b style="color:${V}">Precio de cierre</b> es el que finalmente se firma en la escritura, después
    de negociar. Rara vez son el mismo número.</p>

  ${salto}

  <p class="eyebrow">Análisis de mercado</p>
  <h2>Contra quién compite tu propiedad en ${t(this.prop.zona)}</h2>
  <table>
    <tr style="background:${V};color:#ffffff">
      <th style="padding:6pt;font-size:8pt;text-align:left">Indicador</th>
      <th style="padding:6pt;font-size:8pt;text-align:right">Cantidad</th>
      <th style="padding:6pt;font-size:8pt;text-align:right">% del total</th></tr>
    ${[['Propiedades similares publicadas', this.comp.similares, 100],
       ['Con fotografías profesionales', this.comp.fotos, this.pctFotos],
       ['Con video', this.comp.video, this.pctVideo],
       ['Con recorrido 360°', this.comp.tour, this.pctTour]].map(([l, c, p]) => `
      <tr><td style="border:1px solid #E3E0D6;padding:6pt;font-size:9pt">${l}</td>
          <td style="border:1px solid #E3E0D6;padding:6pt;text-align:right">${this.num(c)}</td>
          <td style="border:1px solid #E3E0D6;padding:6pt;text-align:right">${this.num(p, 0)} %</td></tr>`).join('')}
  </table>
  <table style="background:${CR};margin-top:10pt"><tr><td style="padding:10pt;border-left:3pt solid ${D}">
    <p style="margin:0;font-size:9pt">De las ${this.num(this.comp.similares)} publicaciones que compiten con tu
    propiedad, ${this.num(n(this.comp.similares) - n(this.comp.video))} no tienen video y
    ${this.num(n(this.comp.similares) - n(this.comp.tour))} no ofrecen recorrido 360°.</p></td></tr></table>

  <h3>Rango de precios de la competencia</h3>
  <table><tr>
    <td width="33%" style="border:1px solid #E3E0D6;padding:8pt;text-align:center">
      <span class="eyebrow">Más económica</span><br>
      <span style="font-size:14pt;font-weight:bold;color:${V}">${this.usd(this.comp.min)}</span></td>
    <td width="34%" style="border:1px solid ${D};padding:8pt;text-align:center">
      <span class="eyebrow">Publicación propuesta</span><br>
      <span style="font-size:14pt;font-weight:bold;color:${V}">${this.usd(this.estrategia.mes1)}</span><br>
      <span style="font-size:8pt;color:#5A5A54">por encima del ${this.num(this.posEnRango(this.estrategia.mes1), 0)} % de la oferta</span></td>
    <td width="33%" style="border:1px solid #E3E0D6;padding:8pt;text-align:center">
      <span class="eyebrow">Más cara</span><br>
      <span style="font-size:14pt;font-weight:bold;color:${V}">${this.usd(this.comp.max)}</span></td>
  </tr></table>

  ${salto}

  <p class="eyebrow">Análisis de mercado</p>
  <h2>Los tres extremos del mercado hoy</h2>
  <table><tr>${this.destacadas.map(celdaFicha).join('')}</tr></table>

  ${salto}

  <p class="eyebrow">Carpeta de tasación</p>
  <h1>${t(this.prop.dir)} · ${t(this.prop.zona)}</h1>

  <table style="background:${V};margin-bottom:12pt"><tr><td style="padding:12pt;border-left:8pt solid ${D}">
    <p style="color:${D};font-size:8pt;letter-spacing:2pt;text-transform:uppercase;font-weight:bold;margin:0">En pocas palabras</p>
    <p style="color:#ffffff;font-size:10pt;line-height:165%;margin:6pt 0 0">
      Tu propiedad equivale a <b>${this.num(this.supHom, 2)} m² comparables</b>. Hoy, propiedades parecidas
      en ${t(this.prop.zona)} se ofrecen a un promedio de <b>${this.usd(this.promedioM2)} por metro</b>.
      Multiplicando una cosa por la otra, el valor estimado de mercado es de <b>${this.usd(this.valuacion)}</b>.
      Proponemos publicarla en <b>${this.usd(this.estrategia.mes1)}</b> y trabajar con un objetivo de cierre
      de <b>${this.usd(this.objetivoCierre)}</b>.</p></td></tr></table>

  <h3>1 · La propiedad y cómo se mide</h3>
  <p>La tasación se realizó a partir de la visita a ${t(this.prop.dir)}
     ${this.prop.tipo ? '(' + t(this.prop.tipo) + ')' : ''}, considerando superficies, distribución y
     estado, y comparándola con propiedades que hoy se ofrecen en ${t(this.prop.zona)}.</p>
  <p class="def"><b style="color:${V}">Superficie comparable</b> (u homogeneizada): un metro de patio o
     terraza no vale lo mismo que un metro de living. Para poder comparar propiedades distintas, cada tipo
     de metro se cuenta según cuánto aporta al valor. Así quedan medidas con la misma vara.</p>
  <table><tr>
    ${[['Cubiertos', this.prop.cub], ['Semicubiertos', this.prop.semi], ['Descubiertos', this.prop.desc]]
      .map(([l, v]) => `<td width="25%" style="border:1px solid #E3E0D6;padding:8pt;text-align:center;background:${CR}">
        <span style="font-size:8pt;text-transform:uppercase;color:#5A5A54">${l}</span><br>
        <span style="font-size:14pt;font-weight:bold;color:${V}">${this.num(v, 2)}</span></td>`).join('')}
    <td width="25%" style="border:1px solid ${V};padding:8pt;text-align:center;background:${V}">
      <span style="font-size:8pt;text-transform:uppercase;color:#A9C4B5">Comparable</span><br>
      <span style="font-size:14pt;font-weight:bold;color:${D}">${this.num(this.supHom, 2)}</span></td>
  </tr></table>
  <p style="font-size:8.5pt;color:#5A5A54;margin-top:8pt">
    (${this.num(this.prop.cub, 2)} × ${this.coef.cub}) + (${this.num(this.prop.semi, 2)} × ${this.coef.semi})
    + (${this.num(this.prop.desc, 2)} × ${this.coef.desc}) = ${this.num(this.supHom, 2)} m² comparables
    sobre ${this.num(this.supTotal, 2)} m² totales.</p>

  ${salto}

  <h3>2 · Propiedades comparables</h3>
  <p class="def"><b style="color:${V}">Comparable</b> es una propiedad parecida a la tuya que hoy está
     publicada en venta. El <b style="color:${V}">coeficiente de estado</b> ajusta ese precio antes de
     promediar: 1,05 suma 5 % porque está mejor; 0,95 resta 5 % porque está peor.</p>
  <table>
    <tr style="background:${V};color:#ffffff">
      <th style="padding:6pt;font-size:8pt;text-align:left">Comparable</th>
      <th style="padding:6pt;font-size:8pt;text-align:right">Precio pedido</th>
      <th style="padding:6pt;font-size:8pt;text-align:right">m² comparables</th>
      <th style="padding:6pt;font-size:8pt;text-align:right">USD por m²</th></tr>
    ${this.comps.map(filaComparable).join('')}
    <tr style="background:${V};color:#ffffff">
      <td colspan="3" style="padding:8pt;font-size:9pt;font-weight:bold">PROMEDIO DE LA ZONA POR M²</td>
      <td style="padding:8pt;text-align:right;font-size:12pt;font-weight:bold;color:${D}">${this.usd(this.promedioM2, 2)}</td></tr>
  </table>
  ${this.valorRefM2 > 0 ? `<p style="font-size:8.5pt;color:#5A5A54;margin-top:8pt">
    Valor de referencia registrado para ${t(this.prop.zona)}: <b>${this.usd(this.valorRefM2)} por m²</b>.
    El promedio de los comparables se ubica ${this.num(Math.abs(this.desvioRefPct), 1)} %
    ${this.desvioRefPct >= 0 ? 'por encima' : 'por debajo'} de esa referencia.</p>` : ''}
  <table style="margin-top:10pt;border:1.5pt solid ${D}"><tr><td style="padding:10pt">
    <span class="eyebrow">Valor estimado de mercado</span><br>
    <span style="font-size:9pt;color:#5A5A54">${this.num(this.supHom, 2)} m² × ${this.usd(this.promedioM2, 2)} por m²</span>
    </td><td style="padding:10pt;text-align:right;font-size:18pt;font-weight:bold;color:${V}">
    ${this.usd(this.valuacion)}</td></tr></table>

  ${salto}

  <h3>3 · Estrategia comercial de publicación</h3>
  <table><tr>
    <td width="50%" valign="top" style="border:1px solid ${V};padding:0">
      <div style="background:${V};color:#ffffff;padding:6pt;font-size:8pt;font-weight:bold;text-transform:uppercase">Primeros 30 días</div>
      <div style="padding:10pt;text-align:center">
        <span style="font-size:18pt;font-weight:bold;color:${V}">${this.usd(this.estrategia.mes1)}</span>
        <p style="font-size:8.5pt;color:#5A5A54">Ingreso competitivo y medición de demanda real.</p></div></td>
    <td width="50%" valign="top" style="border:1px solid ${D};padding:0">
      <div style="background:${D};color:#241b00;padding:6pt;font-size:8pt;font-weight:bold;text-transform:uppercase">Desde el día 31</div>
      <div style="padding:10pt;text-align:center">
        <span style="font-size:18pt;font-weight:bold;color:#8A6B10">${this.usd(this.estrategia.mes2)}</span>
        <p style="font-size:8.5pt;color:#5A5A54">Reposicionamiento para ampliar el universo de compradores.</p></div></td>
  </tr></table>
  <p class="def">Los primeros 30 días son los de mayor exposición: el aviso es nuevo y aparece primero
    en los portales. Si en ese mes no llegan ofertas concretas, el mercado está avisando que el precio
    quedó alto.</p>

  <h3>4 · Objetivo de cierre</h3>
  <table style="background:${V}"><tr><td style="padding:14pt;text-align:center;color:#ffffff">
    <span style="font-size:9pt;letter-spacing:2pt;text-transform:uppercase;color:${D};font-weight:bold">Valor objetivo de cierre</span><br>
    <span style="font-size:28pt;font-weight:bold">${this.usd(this.objetivoCierre)}</span>
    <p style="color:#CBDCD2;font-size:8.5pt;margin:6pt 0 0">Representa ${this.num(this.brechaPct, 1)} %
    por debajo del precio de salida.</p></td></tr></table>

  <h3>Condiciones de trabajo</h3>
  <table><tr>
    <td width="60%" valign="top" style="padding:8pt">
      <p style="font-size:9pt;font-weight:bold;color:${V}">Documentación requerida</p>
      <p style="font-size:9pt">Escritura · DNI de todos los propietarios · Últimas expensas y facturas de
      electricidad, agua y gas · Últimas boletas de ABL / ARBA e impuesto municipal · Reglamento de
      copropiedad · Plano de subdivisión y mensura</p></td>
    <td width="40%" valign="top" style="padding:8pt;background:${CR};text-align:center">
      <p style="font-size:9pt;font-weight:bold;color:${V};margin:0">TRABAJAMOS EN EXCLUSIVA</p>
      <p style="font-size:14pt;font-weight:bold;color:${V};margin:4pt 0">${this.num(this.cond.dias)} días</p>
      <p style="font-size:8pt;color:#5A5A54;margin:0">Somos la única inmobiliaria que la comercializa
      durante ese plazo.</p>
      <p style="font-size:9pt;margin:8pt 0 0">Honorarios de comercialización</p>
      <p style="font-size:14pt;font-weight:bold;color:${V};margin:4pt 0">${this.num(this.cond.honorarios, 1)} %</p>
      <p style="font-size:8pt;color:#5A5A54;margin:0">Sobre el precio final de venta, al cerrarse la
      operación.</p></td>
  </tr></table>

  <p align="center" style="margin-top:24pt">
    <span style="font-size:12pt;font-weight:bold;color:${V}">${t(this.cond.agente)}</span><br>
    <span style="font-size:9pt;color:#5A5A54">Corredor Inmobiliario · ${t(this.cond.matricula)}</span></p>

</div></body></html>`;

      const nombre = 'Tasacion_' + (this.prop.dir || 'Propiedad').replace(/[^\w]+/g, '_') + '.doc';
      descargar('\ufeff' + doc, nombre, 'application/msword');
      this.avisar('Documento Word generado: ' + nombre);
    }
  };
}

/* ============================================================
   Utilidades
   ============================================================ */
function n(v, porDefecto = 0) {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : porDefecto;
}

function redondear(v, paso) {
  const p = n(paso, 1000) || 1000;
  return Math.round(n(v) / p) * p;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function descargar(contenido, nombre, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* Word necesita las imágenes embebidas: se leen del servidor y se pasan a base64 */
const _cacheImg = new Map();
async function imagenBase64(url) {
  if (_cacheImg.has(url)) return _cacheImg.get(url);
  const blob = await fetch(url).then(r => r.blob());
  const dato = await new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });
  _cacheImg.set(url, dato);
  return dato;
}
