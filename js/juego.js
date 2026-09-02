/* ============================================================
   LEGEND OF LA PAPITA — juego.js
   Motor 3D (Three.js r128, sin servidor) · combate inspirado
   en Zenless Zone Zero.
   ========================================================= */
'use strict';

/* ---------------- CONFIG ----------------
   Valores de balance del juego. Ajusta aquí la dificultad. */
const CFG = {
  player: {
    hp: 600, speed: 21,
    combos: [[10,2.4],[12,2.6],[14,2.9],[24,3.4]],
    combWindow: 0.55,
    heavy:  { dmg: 38, radio: 4.6, charge: 0.28 },
    shield: { dur: 0.5, redux: 0.45, perfect: 0.22 },
    counter:{ dmg: 34 },
    dash:   { vel: 42, dur: 0.2, cd: 0 },
    ult:    { dmg: 95, radio: 7.5, heal: 120 }
  },
  cam: { dist: 10, pitch: 0.34, fov: 56, minD: 5, maxD: 14 },
  arenaR: 22, gY: 42
};

/* Oleadas: cantidad de enemigos de cada tipo, por oleada. */
const OLEADAS = [
  { skirmish: 5 },
  { skirmish: 4, shooter: 3 },
  { skirmish: 5, shooter: 3, bomb: 3 },
  { skirmish: 6, shooter: 4, bomb: 3 },
  { skirmish: 7, shooter: 4, bomb: 4 }
];

/* Estadísticas base de enemigos. */
const ESTATS = {
  skirmish:{ hp:170, dmg:18, vel:19.5, radio:2.3, cd:0.25 },
  shooter: { hp:140, dmg:12, vel:17, radio:7.2, cd:0.35 },
  bomb:    { hp:120, dmg:36, vel:19, radio:2.2, blast:3.6 },
  boss:    { hp:5750, dmg:36, vel:18.5, radio:9 }
};

/* ---------------- utilidades ---------------- */
const $ = id => document.getElementById(id);
const rand = (a,b) => a + Math.random()*(b-a);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const lerp = (a,b,t) => a + (b-a)*t;
const V3 = (x,y,z) => new THREE.Vector3(x,y,z);
const distXZ = (a,b) => Math.hypot(a.x - b.x, a.z - b.z);

/* ---------------- globals ---------------- */
let escena, camara, renderer, reloj;
let hero = null;              // jugador (instancia de la clase Jugador)
let enemyList = [], shots = [], parts = [], marks = [];
let state = 'menu', stateT = 0, tScale = 1;
let tW = 0;                   // tiempo global del juego (simulado)
let camYaw = 0, camPi = CFG.cam.pitch, camDist = CFG.cam.dist;
let camShake = 0, camKick = 0;
let waveIdx = -1, pendienSpawn = 0, bannerOleadaT = 0;
let boss = null;
let dialogo = null;           // { lineas: [], idx: 0 }
let escudoT = 0, chgT = -1;
let dashT = 0, dashCD = 0, dashDx = 0, dashDz = 0;
let comboIdx = -1, comboT = 0, swingT = 0;
let inAtaque = false, hitAplicado = false;
let ultCarga = 0, invuln = 0, hitFlashT = 0, slowmoT = 0;
let impactT = 0, flashT = 0;   // impact frames: congelado total + flash blanco
let lluviaT = 0;               // lluvia desde las nubes de tormenta
let ventiscaT = 0;             // ráfagas de ventisca cruzando la arena
let cintiT = 0;               // tiempo de la cinemática final
let cartaMesh = null, cartaAbierta = false, cartaTocoSuelo = false;
let bossMuertoT = -1;
let cartaHintT = 0;

/* ---------- referencias DOM ---------- */
const UI = {};
['pantallaInicio','hud','hpLleno','hpText','ultLleno','ultText','nucaCombo',
 'bannerOleada','barrJefe','barrJefeLleno','barrJefeTxto','cajaDialogo',
 'txtDialogo','merte','btnIntentar','pantallaCarta','cartaPara','cartaFecha',
 'cartaTxto','cartaFirma','btnOtraVez','btnFullscreen','daos','penter','flashBlanco','auraCombo'
].forEach(k => UI[k] = $(k));

/* ---------- entrada: teclado y ratón ---------- */
const M = { x:0, y:0, lx:0, ly:0, rx:0, ry:0, izq:false, der:false,
            izqT:0, derT:0, arrIzq:false, arrDer:false };
/* ================= SONIDO (sintetizado con Web Audio, sin archivos) ================= */
let AC = null;
function audioCtx(){
  if(!AC){
    try{ AC = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(err){ AC = null; }
  }
  if(AC && AC.state === 'suspended') AC.resume();
  return AC;
}
/* tono con envolvente: la base de casi todos los efectos */
function tono(freq, dur, tipo, vol, freqFin){
  const c = audioCtx(); if(!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = tipo || 'sine';
  o.frequency.setValueAtTime(freq, c.currentTime);
  if(freqFin) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqFin), c.currentTime + dur);
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + dur + 0.02);
}
/* ruido blanco filtrado: golpes, explosiones, dashes */
function ruido(dur, vol, freqCorte, tipoFiltro){
  const c = audioCtx(); if(!c) return;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for(let i = 0; i < n; i++) d[i] = (Math.random()*2 - 1) * (1 - i/n);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = tipoFiltro || 'lowpass';
  f.frequency.value = freqCorte || 800;
  const g = c.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(c.destination);
  src.start();
}
/* --- efecto: swing de espada --- */
const SFX = {
  swing(){ tono(320, 0.12, 'sawtooth', 0.06, 90); ruido(0.09, 0.10, 2600, 'bandpass'); },
  golpe(){ ruido(0.14, 0.28, 700); tono(150, 0.14, 'square', 0.12, 55); tono(520, 0.08, 'triangle', 0.10, 180); },
  papazo(){ ruido(0.30, 0.38, 420); tono(95, 0.30, 'square', 0.20, 38); tono(700, 0.18, 'sawtooth', 0.10, 120); },
  pesado(){ ruido(0.25, 0.32, 500); tono(110, 0.25, 'square', 0.16, 45); },
  parry(){ tono(880, 0.16, 'square', 0.14, 1650); tono(1320, 0.14, 'sine', 0.10, 2100); ruido(0.10, 0.14, 5200, 'highpass'); },
  esquiva(){ tono(700, 0.16, 'sine', 0.12, 1400); ruido(0.12, 0.08, 4000, 'highpass'); },
  dash(){ ruido(0.14, 0.16, 3200, 'bandpass'); tono(240, 0.12, 'sine', 0.07, 520); },
  escudo(){ tono(420, 0.18, 'triangle', 0.09, 300); },
  dano(){ ruido(0.18, 0.26, 600); tono(200, 0.18, 'sawtooth', 0.13, 70); },
  muerte(){ tono(220, 0.7, 'sawtooth', 0.16, 60); ruido(0.5, 0.22, 900); },
  caida(){ ruido(0.45, 0.4, 380); tono(70, 0.45, 'square', 0.20, 30); },
  salto(){ tono(180, 0.2, 'sine', 0.10, 360); },
  azote(){ ruido(0.4, 0.45, 350); tono(60, 0.4, 'square', 0.24, 25); },
  spawn(){ tono(160, 0.25, 'triangle', 0.09, 90); },
  semilla(){ tono(620, 0.12, 'square', 0.07, 240); },
  oleada(){ tono(392, 0.14, 'square', 0.10); setTimeout(() => tono(523, 0.16, 'square', 0.10), 130); setTimeout(() => tono(659, 0.22, 'square', 0.11), 280); },
  jefe(){ tono(98, 0.5, 'sawtooth', 0.15, 55); ruido(0.4, 0.2, 700); setTimeout(() => tono(92, 0.5, 'sawtooth', 0.14, 49), 300); },
  ult(){ tono(523, 0.3, 'sine', 0.13, 1046); ruido(0.2, 0.14, 3000, 'highpass'); setTimeout(() => tono(659, 0.3, 'sine', 0.12, 1318), 120); setTimeout(() => { tono(784, 0.45, 'sawtooth', 0.14, 392); ruido(0.35, 0.30, 500); }, 260); },
  ultBlast(){ ruido(0.6, 0.4, 420); tono(80, 0.6, 'square', 0.22, 28); tono(880, 0.3, 'sine', 0.10, 220); },
  roca(){ ruido(0.3, 0.24, 800); tono(140, 0.22, 'triangle', 0.10, 60); },
  carta(){ /* arpegio suave de la carta */
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tono(f, 0.5, 'sine', 0.10), i*160));
  },
  abrirCarta(){ /* acorde mágico al abrir la carta */
    [523, 659, 784, 988, 1318].forEach((f, i) => setTimeout(() => tono(f, 0.8, 'sine', 0.09), i*90));
    ruido(0.4, 0.12, 6000, 'highpass');
  }
};

/* --- música de fondo: PELEA enérgica en bucle (generada en vivo, sin archivos) --- */
let musicoOn = false, musicoBeat = 0, musicoTimer = null;
function iniciarMusica(){
  if(musicoOn) return;
  const c = audioCtx(); if(!c) return;
  musicoOn = true; musicoBeat = 0;
  const corchea = 214;                       /* 140 BPM */
  /* línea de bajo en Mi menor: potencia y urgencia */
  const bajo = [41.2,41.2,0,41.2, 49,0,41.2,41.2, 55,0,55,49, 41.2,0,36.7,41.2];
  const acorde = [[164.8,196],[164.8,196],[174.6,207.7],[146.8,185]];
  const paso = () => {
    if(!musicoOn) return;
    const b = musicoBeat++;
    /* batería: bombo en negras */
    if(b % 2 === 0){ tono(120, 0.12, 'sine', 0.16, 42); ruido(0.06, 0.10, 300); }
    /* charles agudo en todos los pasos */
    ruido(0.03, b % 2 === 0 ? 0.035 : 0.05, 7500, 'highpass');
    /* caja en el contratiempo */
    if(b % 8 === 4) ruido(0.09, 0.11, 1800, 'bandpass');
    /* bajo marcando el riff */
    const f = bajo[b % 16];
    if(f) tono(f, 0.19, 'sawtooth', 0.075);
    /* golpe de acorde de poder cada compás */
    if(b % 8 === 0){
      const a = acorde[Math.floor(b/8) % 4];
      tono(a[0], 0.42, 'square', 0.030); tono(a[1], 0.42, 'square', 0.026);
      tono(a[0]/2, 0.42, 'sawtooth', 0.028);
    }
    /* campanita de tensión esporádica arriba */
    if(b % 32 === 24 && Math.random() < 0.6) tono(1318, 0.3, 'sine', 0.014, 988);
  };
  paso();
  musicoTimer = setInterval(paso, corchea);
}
function pararMusica(){
  musicoOn = false;
  if(musicoTimer){ clearInterval(musicoTimer); musicoTimer = null; }
}

/* ---------------- ENTRADA / CÁMARA ---------------- */
const K = {};

addEventListener('keydown', e => {
  K[e.code] = true;
  if(e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'Space'){
    e.preventDefault();
  }
  if(e.code === 'ShiftLeft' || e.code === 'ShiftRight'){ if(!e.repeat) tryDash(); }
  else if(e.code === 'ControlLeft' || e.code === 'ControlRight'){ if(!e.repeat) tryParry(); }
  else if(e.code === 'Space'){ if(!e.repeat) tryUlt(); }
});
addEventListener('keyup', e => { K[e.code] = false; });

addEventListener('mousemove', e => {
  if(M.izq && Math.abs(e.clientX - M.lx) > 6) M.arrIzq = true;
  if(M.der && Math.abs(e.clientX - M.lx) > 6) M.arrDer = true;
  if(M.der){
    camYaw -= (e.clientX - M.rx) * 0.0052;
    camPi = clamp(camPi + (e.clientY - M.ry) * 0.0052, 0.05, 1.52);
  }
  M.x = e.clientX; M.y = e.clientY; M.rx = e.clientX; M.ry = e.clientY;
});

addEventListener('mousedown', e => {
  if(e.button === 0){ M.izq = true; M.lx = e.clientX; M.ly = e.clientY; M.izqT = performance.now(); M.arrIzq = false; }
  if(e.button === 2){ M.der = true; M.rx = e.clientX; M.ry = e.clientY; M.derT = performance.now(); M.arrDer = false; }
});
addEventListener('mouseup', e => {
  if(e.button === 0){
    const dt = (performance.now() - M.izqT) / 1000;
    const fuePesado = (chgT >= 0);
    if(!M.arrIzq){ if(fuePesado){ fireHeavy(); } else if(dt < 0.22){ tryCombo(); } }
    M.izq = false; chgT = -1; M.arrIzq = false;
  }
  if(e.button === 2){
    M.der = false; M.arrDer = false;
  }
});
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('wheel', e => {
  camDist = clamp(camDist + e.deltaY * 0.008, CFG.cam.minD, CFG.cam.maxD);
}, { passive:true });

addEventListener('resize', () => {
  if(renderer){
    renderer.setSize(innerWidth, innerHeight);
    camara.aspect = innerWidth / innerHeight;
    camara.updateProjectionMatrix();
  }
});
/* ---------------- ESCENA ---------------- */
function crearTexturaGlow(){
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64,64,0,64,64,64);
  grad.addColorStop(0,'rgba(255,255,255,1)');
  grad.addColorStop(0.4,'rgba(255,255,255,.5)');
  grad.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0,0,128,128);
  return new THREE.CanvasTexture(c);
}
const TEX_GLOW = crearTexturaGlow();
let nubesList = [];
let agujeroNegro = null;       // el agujero negro gigante del fondo

function construirEscena(){
  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('juego'), antialias:true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  escena = new THREE.Scene();
  escena.background = new THREE.Color(0x8ecdf2);
  escena.fog = new THREE.Fog(0xaad8f2, 110, 560);
  camara = new THREE.PerspectiveCamera(CFG.cam.fov, innerWidth/innerHeight, 0.3, 26000);
  estadoBg = escena.background;

  /* AGUJERO NEGRO gigante plantado en la ciudad, dominando el horizonte */
  agujeroNegro = new THREE.Group();
  const bhHorizonte = new THREE.Mesh(new THREE.SphereGeometry(42, 32, 24),
    new THREE.MeshBasicMaterial({ color:0x000000, fog:false }));
  agujeroNegro.add(bhHorizonte);
  /* disco de acreción (doble anillo de fuego girando) */
  const bhDisc = new THREE.Mesh(new THREE.TorusGeometry(74, 11, 2, 64),
    new THREE.MeshBasicMaterial({ color:0xff8a3d, transparent:true, opacity:.8, blending:THREE.AdditiveBlending, fog:false, depthWrite:false, side:THREE.DoubleSide }));
  bhDisc.rotation.x = Math.PI/2.25;
  agujeroNegro.add(bhDisc); agujeroNegro.userData.disc = bhDisc;
  const bhDisc2 = new THREE.Mesh(new THREE.TorusGeometry(58, 6, 2, 48),
    new THREE.MeshBasicMaterial({ color:0xffd23f, transparent:true, opacity:.9, blending:THREE.AdditiveBlending, fog:false, depthWrite:false, side:THREE.DoubleSide }));
  bhDisc2.rotation.x = Math.PI/2.25;
  agujeroNegro.add(bhDisc2); agujeroNegro.userData.disc2 = bhDisc2;
  /* resplandor del borde de fotones */
  const bhGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map:TEX_GLOW, color:0xffb35c, transparent:true, opacity:.75, blending:THREE.AdditiveBlending, fog:false, depthWrite:false }));
  bhGlow.scale.setScalar(185);
  agujeroNegro.add(bhGlow);
  /* anillo de fotones alrededor del horizonte de sucesos */
  const bhRing = new THREE.Mesh(new THREE.TorusGeometry(46, 2.4, 8, 64),
    new THREE.MeshBasicMaterial({ color:0xfff3c8, transparent:true, opacity:.9, blending:THREE.AdditiveBlending, fog:false, depthWrite:false }));
  bhRing.rotation.x = Math.PI/2.4;
  agujeroNegro.add(bhRing);
  agujeroNegro.position.set(4800, -1512, -11700);  /* MONSTRUOSO (x3): hundido bajo el piso, solo asoma el 35% */
  agujeroNegro.scale.setScalar(120);
  agujeroNegro.rotation.x = 0.12;
  escena.add(agujeroNegro);

  /* REFLEJOS DE ENTORNO (realismo PBR): cielo/sol sintetizado en un mapa PMREM */
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const cvE = document.createElement('canvas'); cvE.width = 256; cvE.height = 128;
  const gE = cvE.getContext('2d');
  const gradE = gE.createLinearGradient(0, 0, 0, 128);
  gradE.addColorStop(0, '#2e6fd8');   /* cenit azul saturado */
  gradE.addColorStop(0.45, '#8ecdf2');/* horizonte */
  gradE.addColorStop(0.55, '#d8cfc0');/* bruma urbana */
  gradE.addColorStop(1, '#6b7b8c');   /* suelo */
  gE.fillStyle = gradE; gE.fillRect(0, 0, 256, 128);
  const solE = gE.createRadialGradient(175, 34, 2, 175, 34, 32);
  solE.addColorStop(0, 'rgba(255,255,242,1)'); solE.addColorStop(1, 'rgba(255,255,242,0)');
  gE.fillStyle = solE; gE.fillRect(128, 0, 100, 76);
  const texE = new THREE.CanvasTexture(cvE);
  texE.mapping = THREE.EquirectangularReflectionMapping;
  const envRT = pmrem.fromEquirectangular(texE);
  escena.environment = envRT.texture;   /* cristal, metal, espada y escudo reflejan el cielo */
  texE.dispose(); pmrem.dispose();

  /* luces de día */
  const hemi = new THREE.HemisphereLight(0xcfe9ff, 0x6b7b8c, 0.85); escena.add(hemi);
  const sol = new THREE.DirectionalLight(0xfff1d6, 1.25); sol.position.set(60, 130, 45);
  sol.castShadow = true; sol.shadow.mapSize.set(2048,2048);
  sol.shadow.camera.left=-34; sol.shadow.camera.right=34;
  sol.shadow.camera.top=34; sol.shadow.camera.bottom=-34;
  sol.shadow.camera.far=280;
  escena.add(sol);
  sol.target.position.set(0, CFG.gY, 0); escena.add(sol.target);
  const rebote = new THREE.PointLight(0xffe9c9, .45, 70); rebote.position.set(0, CFG.gY + 7, 0); escena.add(rebote);
  /* luz de contorno (backlight frío) para separar a los personajes del fondo */
  const contra = new THREE.DirectionalLight(0xbfd9ff, .4); contra.position.set(-50, 80, -70); escena.add(contra);

  /* sol brillante */
  const solSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map:TEX_GLOW, color:0xfff3c8, transparent:true, opacity:.95, blending:THREE.AdditiveBlending, depthWrite:false }));
  solSpr.scale.setScalar(55); solSpr.position.set(150, 190, 110); escena.add(solSpr);

  /* azotea del rascacielos */
  const gy = CFG.gY;
  const losa = new THREE.Mesh(new THREE.BoxGeometry((CFG.arenaR+2.6)*2, 2.4, (CFG.arenaR+2.6)*2),
    new THREE.MeshStandardMaterial({ color:0xb6bfc9, roughness:.85, metalness:.15 }));
  losa.position.y = gy - 1.2; losa.receiveShadow = true; losa.castShadow = true; escena.add(losa);
  const torre = new THREE.Mesh(new THREE.BoxGeometry(25, gy-2.4, 25),
    new THREE.MeshStandardMaterial({ color:0x7e8ea3, roughness:.5, metalness:.35 }));
  torre.position.y = (gy-2.4)/2; torre.castShadow = true; escena.add(torre);
  /* piso con rejilla técnica */
  const cvS = document.createElement('canvas'); cvS.width = cvS.height = 256;
  const gS = cvS.getContext('2d');
  gS.fillStyle = '#a7b0ba'; gS.fillRect(0,0,256,256);
  gS.strokeStyle = '#8d96a1'; gS.lineWidth = 2;
  for(let i=0;i<=8;i++){ gS.beginPath(); gS.moveTo(i*32,0); gS.lineTo(i*32,256); gS.stroke(); gS.beginPath(); gS.moveTo(0,i*32); gS.lineTo(256,i*32); gS.stroke(); }
  gS.strokeStyle = 'rgba(63,212,255,.55)'; gS.lineWidth = 4;
  gS.strokeRect(2,2,252,252);
  const texSuelo = new THREE.CanvasTexture(cvS);
  texSuelo.wrapS = texSuelo.wrapT = THREE.RepeatWrapping; texSuelo.repeat.set(5,5);
  const suelo = new THREE.Mesh(new THREE.CircleGeometry(CFG.arenaR+1.6, 48),
    new THREE.MeshStandardMaterial({ map:texSuelo, roughness:.8, metalness:.2 }));
  suelo.rotation.x = -Math.PI/2; suelo.position.y = gy; suelo.receiveShadow = true; escena.add(suelo);
  /* baranda de cristal */
  const baranda = new THREE.Mesh(new THREE.CylinderGeometry(CFG.arenaR+1.3, CFG.arenaR+1.3, 1.1, 48, 1, true),
    new THREE.MeshStandardMaterial({ color:0xbfe9ff, transparent:true, opacity:0.2, roughness:.1, metalness:.2, side:THREE.DoubleSide }));
  baranda.position.y = gy + 0.55; escena.add(baranda);
  const perfil = new THREE.Mesh(new THREE.TorusGeometry(CFG.arenaR+1.3, 0.06, 6, 48),
    new THREE.MeshBasicMaterial({ color:0x3fd4ff }));
  perfil.rotation.x = Math.PI/2; perfil.position.y = gy + 1.12; escena.add(perfil);

  /* anillos holográficos del arena */
  for(let i=0;i<3;i++){
    const r = CFG.arenaR * 0.30 * (i+1);
    const an = new THREE.Mesh(new THREE.RingGeometry(r-0.18*(i+1), r+0.1, 48),
      new THREE.MeshBasicMaterial({ color:(i%2)? 0xff5ca8 : 0x3fd4ff, transparent:true, opacity:0.3+i*0.08, side:THREE.DoubleSide }));
    an.rotation.x = -Math.PI/2; an.position.y = gy+0.05; escena.add(an);
  }
 
  
  /* postes neón del borde */
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent:true, opacity:.9, blending:THREE.AdditiveBlending, depthWrite:false });
  for(let i=0;i<8;i++){
    const ang = (i/8)*Math.PI*2; const r = CFG.arenaR + 0.3;
    const x = Math.cos(ang)*r, z = Math.sin(ang)*r;
    const colon = (i%2)? 0xff5ca8 : 0x3fd4ff;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.30,0.50,2.8,8),
      new THREE.MeshStandardMaterial({ color: colon, emissive: colon, emissiveIntensity:.8, roughness:.4 }));
    p.position.set(x, gy+1.4, z); p.receiveShadow = true; p.castShadow = true; escena.add(p);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.4,10,8), glowMat);
    b.position.set(x, gy+2.95, z); escena.add(b);  }
 
 /* rayos de luz */
  function rayo(x,z,c,rad,h){
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rad*0.5, rad, h, 12, 1, true),
      new THREE.MeshBasicMaterial({ color:c, transparent:true, opacity:0.13, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, depthWrite:false }));
    m.position.set(x, gy + h/2, z); escena.add(m);
  }
   rayo(-CFG.arenaR-1, -CFG.arenaR-1, 0xff5ca8, 2.2, 30);   rayo(CFG.arenaR+1, CFG.arenaR+1, 0x37c8ff, 2.2, 30);
   rayo(-CFG.arenaR-1, CFG.arenaR+1, 0x7b2f7f, 2.2, 30);    rayo(CFG.arenaR+1, -CFG.arenaR-1, 0x37c8ff, 2.2, 30);
  
  /* nubs autour */
  const nubmat = new THREE.MeshStandardMaterial({ color:0xffffff, transparent:true, opacity:.72, flatShading:true });
  for(let i=0;i<16;i++){
    const g = new THREE.Group(); const s = rand(2,4.5);
    for(let j=0;j<6;j++){
      const e = new THREE.Mesh(new THREE.SphereGeometry(rand(1,2.2),8,6), nubmat);
      e.position.set(rand(-1,1)*s*.45, rand(-.6,1)*s*.32, rand(-1,1)*s*.45);
      g.add(e);
    }
    g.position.set(rand(-60,60), rand(CFG.gY-26, CFG.gY+16), rand(-60,60));
    g.userData.vel = V3(rand(.2,.8), 0, rand(-.4,.4));
    escena.add(g); nubesList.push(g);
  }

  /* nubes de tormenta gigantes sobre la ciudad (de donde cae la lluvia) */
  const matTormenta = new THREE.MeshStandardMaterial({ color:0x66707f, transparent:true, opacity:.88, flatShading:true });
  for(let i=0;i<110;i++){
    const g = new THREE.Group(); const s = rand(9, 15);
    for(let j=0;j<10;j++){
      const e = new THREE.Mesh(new THREE.SphereGeometry(rand(2.5,5),8,6), matTormenta);
      e.position.set(rand(-1,1)*s*.5, rand(-.5,.6)*s*.25, rand(-1,1)*s*.5);
      g.add(e);
    }
    g.position.set(rand(-160,160), CFG.gY + rand(42,95), rand(-160,160));
    g.userData.vel = V3(rand(-1.5,1.5), 0, rand(-1.2,1.2));
    escena.add(g); nubesList.push(g);
    /* segundas pisas de nube encima de cada tormenta (más gigantes aún) */
    const g2 = g.clone();
    g2.position.y += rand(8, 16);
    g2.scale.setScalar(rand(1.2, 1.9));
    g2.userData.vel = V3(rand(-1,1), 0, rand(-0.8,0.8));
    escena.add(g2); nubesList.push(g2);
  }
  
  /* props de azotea: A/C, ventilación y jardineras */
  const propMat = new THREE.MeshStandardMaterial({ color:0xcfd6e0, roughness:.7, metalness:.25 });
  const propMat2 = new THREE.MeshStandardMaterial({ color:0x8f9aa8, roughness:.6, metalness:.4 });
  for(let i=0;i<10;i++){
    const ang = rand(0, Math.PI*2); const r = rand(CFG.arenaR*0.45, CFG.arenaR*0.92);
    const x = Math.cos(ang)*r, z = Math.sin(ang)*r;
    if(i%3 === 0){
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 1.1), propMat);
      b.position.set(x, gy+0.45, z); b.rotation.y = rand(0,3); b.castShadow = true; escena.add(b);
    } else if(i%3 === 1){
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 1.1, 10), propMat2);
      c.position.set(x, gy+0.55, z); c.castShadow = true; escena.add(c);
    } else {
      const j = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.6), propMat);
      j.position.set(x, gy+0.25, z); j.castShadow = true; escena.add(j);
      const arb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6),
        new THREE.MeshStandardMaterial({ color:0x63b463, roughness:.9 }));
      arb.position.set(x, gy+0.65, z); arb.castShadow = true; escena.add(arb);
    }
  }
  /* carretera con coches debajo de la ciudad */
  const cvR = document.createElement('canvas'); cvR.width = cvR.height = 256;
  const gR = cvR.getContext('2d');
  gR.fillStyle = '#2b2f36'; gR.fillRect(0,0,256,256);
  gR.fillStyle = '#e8d44d';
  for(let i=0;i<8;i++){ gR.fillRect(120, i*40+8, 16, 22); }
  const texR = new THREE.CanvasTexture(cvR);
  texR.wrapS = texR.wrapT = THREE.RepeatWrapping; texR.repeat.set(1, 14);
  const matCar = new THREE.MeshStandardMaterial({ map:texR, roughness:.9 });
  const carr1 = new THREE.Mesh(new THREE.BoxGeometry(14, 0.3, 560), matCar);
  carr1.position.set(0, 0.15, 0); escena.add(carr1);
  const carr2 = new THREE.Mesh(new THREE.BoxGeometry(560, 0.3, 14), matCar);
  carr2.position.set(0, 0.12, 0); escena.add(carr2);
  const matCoche = new THREE.MeshStandardMaterial({ color:0x39424e, roughness:.5, metalness:.4 });
  const matFaro = new THREE.MeshBasicMaterial({ color:0xfff3c8 });
  for(let i=0;i<14;i++){
    const c = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 4.6), matCoche);
    body.position.y = 0.9; c.add(body);
    const faro = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.25, 0.1), matFaro);
    faro.position.set(0, 0.9, -2.35); c.add(faro);
    const lane = (Math.random()<0.5 ? -3.5 : 3.5) * (Math.random()<0.5 ? 1 : -1);
    if(Math.random() < 0.5){ c.position.set(rand(-260,260), 0.3, lane); }
    else { c.position.set(lane, 0.3, rand(-260,260)); c.rotation.y = Math.PI/2; }
    escena.add(c);
  }
  crearCiudad();
}

/* ---------------- CIUDAD FUTURISTA ----------------
   Optimizada: geometrías y materiales COMPARTIDOS (nada de clonar
   texturas por edificio), así no hay subidas a GPU ni pausas de GC */
function crearCiudad(){
  const basesTex = [];
  for(let k=0;k<4;k++){
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g2 = cv.getContext('2d');
    g2.fillStyle = '#dfe9f3'; g2.fillRect(0,0,64,64);
    for(let y=0;y<8;y++){
      for(let x=0;x<8;x++){
        g2.fillStyle = Math.random() < 0.16 ? '#9fe4ff' : (k===0 ? '#33475e' : (k===1 ? '#2c3f57' : (k===2 ? '#3a506b' : '#435e7d')));
        g2.fillRect(x*8+1, y*8+1, 6, 6);
      }
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    basesTex.push(t);
  }
  /* 12 materiales compartidos (4 texturas × 3 densidades de ventana) */
  const matsEdificio = [];
  for(const t of basesTex) for(const rep of [2, 5, 9]){
    const tc = t.clone(); tc.needsUpdate = true; tc.repeat.set(rep, rep);
    matsEdificio.push(new THREE.MeshStandardMaterial({ map:tc, roughness:.55, metalness:.3 }));
  }
  const geoEdificio = new THREE.BoxGeometry(1, 1, 1);   /* geometría única escalada */
  const acentos = [0x37c8ff, 0xff5ca8, 0x8f7bff];
  const matTrim = acentos.map(c => new THREE.MeshBasicMaterial({ color:c }));
  const geoTrim = new THREE.BoxGeometry(1, 1, 1);
  const geoAnt = new THREE.CylinderGeometry(0.15, 0.25, 1, 6);
  const matAnt = new THREE.MeshStandardMaterial({ color:0x5b6672, roughness:.6, metalness:.5 });
  const geoHeli = new THREE.CylinderGeometry(2.6, 2.6, 0.25, 20);
  const matHeli = new THREE.MeshStandardMaterial({ color:0x39424e, roughness:.8 });
  for(let i=0;i<2200;i++){
    const ang = rand(0, Math.PI*2);
    const r = rand(38, 700);
    /* rejilla urbana: manzanas alineadas, como ciudad de verdad */
    const x = Math.round(Math.cos(ang)*r / 17) * 17 + rand(-2.5, 2.5);
    const z = Math.round(Math.sin(ang)*r / 17) * 17 + rand(-2.5, 2.5);
    if(Math.abs(x) < 15 || Math.abs(z) < 15) continue;   /* dejamos libres las avenidas */
    if(Math.hypot(x, z) < 36) continue;                  /* plaza libre alrededor de la torre */
    const w = rand(7, 15), d = rand(7, 15);
    let h = rand(8, 64);
    if(r < 62) h = Math.min(h, rand(5, 34));
    if(Math.hypot(x, z) > 330) h = rand(12, 130);        /* más altos hacia el horizonte */
    const mat = matsEdificio[(h > 40 ? 3 : 0) + (i%3)*4 % 12];
    const b = new THREE.Mesh(geoEdificio, mat);
    b.scale.set(w, h, d);
    b.position.set(x, h/2 - 0.5, z);
    escena.add(b);
    /* borde luminoso de neón en la cima */
    const trim = new THREE.Mesh(geoTrim, matTrim[i%3]);
    trim.scale.set(w+0.4, 0.3, d+0.4);
    trim.position.set(x, h-0.35, z);
    escena.add(trim);
    const az = Math.random();
    if(az < 0.12){
      const hh = rand(3,7);
      const ant = new THREE.Mesh(geoAnt, matAnt);
      ant.scale.set(1, hh, 1);
      ant.position.set(x + rand(-w/4,w/4), h + hh/2, z + rand(-d/4,d/4));
      escena.add(ant);
    } else if(az < 0.2){
      const heli = new THREE.Mesh(geoHeli, matHeli);
      heli.position.set(x, h + 0.12, z);
      escena.add(heli);
    }
  }
  /* PISO de la ciudad: los edificios nacen de la tierra, no flotan */
  const cvP = document.createElement('canvas'); cvP.width = cvP.height = 128;
  const gP = cvP.getContext('2d');
  gP.fillStyle = '#3a4048'; gP.fillRect(0,0,128,128);
  gP.strokeStyle = '#2e333a'; gP.lineWidth = 3;
  for(let i=0;i<=4;i++){
    gP.beginPath(); gP.moveTo(i*32,0); gP.lineTo(i*32,128); gP.stroke();
    gP.beginPath(); gP.moveTo(0,i*32); gP.lineTo(128,i*32); gP.stroke();
  }
  const texPiso = new THREE.CanvasTexture(cvP);
  texPiso.wrapS = texPiso.wrapT = THREE.RepeatWrapping; texPiso.repeat.set(60, 60);
  const piso = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800),
    new THREE.MeshStandardMaterial({ map:texPiso, roughness:.95, metalness:.05 }));
  piso.rotation.x = -Math.PI/2; piso.position.y = 0;
  escena.add(piso);
}
/* ---------------- JUGADOR (papita caballera) ---------------- */
const MAT = {
  papa:   new THREE.MeshStandardMaterial({ color:0xd9a441, roughness:.75 }),
  papaD:  new THREE.MeshStandardMaterial({ color:0xb8862f, roughness:.85 }),
  blanco: new THREE.MeshStandardMaterial({ color:0xffffff, roughness:.4 }),
  negro:  new THREE.MeshStandardMaterial({ color:0x1a1a1a, roughness:.6 }),
  plata:  new THREE.MeshStandardMaterial({ color:0xd7dbe7, roughness:.3, metalness:.85 }),
  oro:    new THREE.MeshStandardMaterial({ color:0xffd23f, roughness:.35, metalness:.8 }),
  rosita: new THREE.MeshStandardMaterial({ color:0xff8fa3, roughness:.5 }),
  rojo:   new THREE.MeshStandardMaterial({ color:0xb3372f, roughness:.7 }),
  verde:  new THREE.MeshStandardMaterial({ color:0x9fbf4d, roughness:.6 }),
  violeta:new THREE.MeshStandardMaterial({ color:0x6d3fc9, roughness:.4, emissive:0x4a2c8a, emissiveIntensity:.4 }),
  glowW:  new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:.95, blending:THREE.AdditiveBlending, depthWrite:false }),
  cian:   new THREE.MeshStandardMaterial({ color:0x37c8ff, roughness:.35, emissive:0x1f7fb5, emissiveIntensity:.6 }),
  amarillo: new THREE.MeshStandardMaterial({ color:0xffd23f, roughness:.5 }),
  naranja:  new THREE.MeshStandardMaterial({ color:0xff7a2f, roughness:.55 }),
  chaqueta: new THREE.MeshStandardMaterial({ color:0xff7bac, roughness:.6 }),
  rosaNeon: new THREE.MeshStandardMaterial({ color:0xff9ecf, roughness:.35, emissive:0xff4f9a, emissiveIntensity:.8 }),
  holoRosa: new THREE.MeshStandardMaterial({ color:0xffa8d4, emissive:0xff5fae, emissiveIntensity:.9, transparent:true, opacity:.6, roughness:.2 }),
  holo:     new THREE.MeshStandardMaterial({ color:0x66e0ff, emissive:0x2ec5ff, emissiveIntensity:.9, transparent:true, opacity:.6, roughness:.2 })
};

class Jugador {
  constructor(){
    this.hp = CFG.player.hp;
    this.maxHp = CFG.player.hp;
    this.pos = V3(0, 0, 0);
    this.facing = 0;
    this.g = new THREE.Group();
  this.g.rotation.order = 'YXZ';   /* para inclinarse hacia su propia dirección */
    this.buildMesh();
    this.g.position.copy(this.pos);
    escena.add(this.g);
  }

  buildMesh(){
    const g = this.g;
    this.cuerpo = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 18), MAT.papa);
    this.cuerpo.scale.set(1, 0.9, 0.78);
    this.cuerpo.castShadow = true;
    g.add(this.cuerpo);

    /* rostro */
    const ojo = (x,y,dir) => {
      const w = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), MAT.blanco);
      w.position.set(x, y, dir);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), MAT.negro);
      p.position.set(x*0.25, y*0.12, dir + 0.11);
      w.add(p); g.add(w);
      const ceja = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.045, 0.04), MAT.negro);
      ceja.position.set(x*0.9, y+0.16, dir+0.02); ceja.rotation.z = x>0 ? -0.3 : 0.3;
      g.add(ceja);
    };
    ojo(-0.26, 0.12, 0.52); ojo(0.26, 0.12, 0.52);
    const mejilla = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), MAT.rosita);
    mejilla.position.set(-0.24, -0.02, 0.46); g.add(mejilla);
    const mejilla2 = mejilla.clone(); mejilla2.position.x = 0.24; g.add(mejilla2);
    const boca = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), MAT.negro);
    boca.position.set(0, -0.14, 0.56); boca.scale.set(1, 0.45, 0.3); g.add(boca);

    /* auriculares gamer con aro de neón (look moderno) */
    const bandaAud = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.05, 8, 20, Math.PI), MAT.negro);
    bandaAud.position.y = 0.40; g.add(bandaAud);
    const orejera = (x) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.09, 14), MAT.negro);
      c.rotation.z = Math.PI/2; c.position.set(x*0.55, 0.40, 0); g.add(c);
      const aro = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.028, 6, 16), MAT.cian);
      aro.rotation.y = Math.PI/2; aro.position.set(x*0.60, 0.40, 0); g.add(aro);
    };
    orejera(1); orejera(-1);
    const micro = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 6), MAT.negro);
    micro.position.set(-0.42, 0.12, 0.28); micro.rotation.x = 0.9; g.add(micro);

    /* chaqueta técnica con capucha */
    const capucha = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), MAT.chaqueta);
    capucha.position.set(0, 0.18, -0.38); capucha.scale.set(1.05, 0.8, 0.6); g.add(capucha);
    const chaqueta = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.5), MAT.chaqueta);
    chaqueta.position.set(0, -0.15, 0.12); chaqueta.castShadow = true; g.add(chaqueta);
    const franja = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.09, 0.52), MAT.rosaNeon);
    franja.position.set(0, -0.28, 0.12); g.add(franja);
    const cinturon = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.62, 0.16, 14), MAT.negro);
    cinturon.position.set(0, -0.42, 0); g.add(cinturon);
    const hebilla = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.06), MAT.rosaNeon);
    hebilla.position.set(0, -0.42, 0.56); g.add(hebilla);
    /* brazo izquierdo + escudo */
    this.brazoIzq = new THREE.Group(); this.brazoIzq.position.set(-0.66, -0.1, 0.05); g.add(this.brazoIzq);
    const habIzq = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), MAT.plata);
    habIzq.position.set(-0.16, 0, 0); this.brazoIzq.add(habIzq);
    this.escudo = new THREE.Group();
    const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 6), MAT.holoRosa);
    s1.rotation.z = Math.PI/2; this.escudo.add(s1);
    const s2 = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 6, 6), MAT.rosaNeon);
    s2.rotation.y = Math.PI/2; s2.position.z = -0.03; this.escudo.add(s2);
    const joya = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), MAT.glowW); joya.position.z = 0.03; this.escudo.add(joya);
    this.escudo.position.set(-0.34, 0.05, -0.12); this.brazoIzq.add(this.escudo);

    /* brazo derecho + ESPADA DE ENERGÍA (mejorada) */
    this.brazoDer = new THREE.Group(); this.brazoDer.position.set(0.66, -0.04, 0.05); g.add(this.brazoDer);
    const habDer = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), MAT.plata);
    habDer.position.set(0.14, 0, 0); this.brazoDer.add(habDer);
    this.espada = new THREE.Group(); this.brazoDer.add(this.espada);
    /* núcleo de la hoja: brilla más cuanto más combo llevas */
    this.hojaMat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:.15, metalness:.4, emissive:0x66e0ff, emissiveIntensity:.9 });
    const hoja = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.65, 0.045), this.hojaMat);
    hoja.position.y = 0.85; hoja.castShadow = true; this.espada.add(hoja);
    /* aura de energía alrededor de la hoja */
    const auraHoja = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.7, 0.11),
      new THREE.MeshBasicMaterial({ color:0x59d9ff, transparent:true, opacity:.4, blending:THREE.AdditiveBlending, depthWrite:false }));
    auraHoja.position.y = 0.85; this.espada.add(auraHoja);
    /* punta de energía */
    const punta = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 8), MAT.glowW);
    punta.position.y = 1.82; this.espada.add(punta);
    /* guarda con anillo de neón rosa */
    const guarda = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 0.09), MAT.plata);
    guarda.position.y = 0.06; this.espada.add(guarda);
    const anilloG = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 6, 16), MAT.rosaNeon);
    anilloG.rotation.x = Math.PI/2; anilloG.position.y = 0.1; this.espada.add(anilloG);
    const mango = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.24, 8), MAT.negro);
    mango.position.y = -0.1; this.espada.add(mango);
    const pomo = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), MAT.rosaNeon);
    pomo.position.y = -0.24; this.espada.add(pomo);
    this.espada.position.set(0.14, 0.0, 0);

    /* patitas */
    const pie = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.14, 10), MAT.blanco);
    pie.position.set(-0.2, -0.62, 0.12); g.add(pie);
    const pie2 = pie.clone(); pie2.position.set(0.2, -0.62, 0.12); g.add(pie2);
  }

  postura(dt){
    const gy = CFG.gY;
    let mx = 0, mz = 0;
    if(K['KeyW']) mz += 1;
    if(K['KeyS']) mz -= 1;
    if(K['KeyA']) mx -= 1;
    if(K['KeyD']) mx += 1;
    const len = Math.hypot(mx, mz);
    if(len > 0){ mx /= len; mz /= len; }
    const sy = Math.sin(camYaw), cy = Math.cos(camYaw);
    /* A/D relativos a la pantalla: derecha en pantalla = (-cos, sin) */
    let wx = mz*sy - mx*cy;
    let wz = mz*cy + mx*sy;

    if(dashT > 0){
      this.pos.x += dashDx * CFG.player.dash.vel * dt;
      this.pos.z += dashDz * CFG.player.dash.vel * dt;
    } else if(!inAtaque){
      this.pos.x += wx * CFG.player.speed * dt;
      this.pos.z += wz * CFG.player.speed * dt;
      if(len > 0) this.facing = Math.atan2(wx, wz);
    }
    const rr = Math.hypot(this.pos.x, this.pos.z);
    if(rr > CFG.arenaR - 1.5){
      const f = (CFG.arenaR - 1.5) / rr;
      this.pos.x *= f; this.pos.z *= f;
    }
    const mov = (len > 0.1 || dashT > 0);
    const bob = mov ? Math.sin(tW*16)*0.09 : Math.sin(tW*2.2)*0.025;
    this.g.position.set(this.pos.x, gy + 0.55 + bob, this.pos.z);
    if(!inAtaque) this.g.rotation.y = this.facing;
    /* inclinación frenética: se agacha al correr, se lanza al esquivar */
    this.g.rotation.x = dashT > 0 ? 0.38 : (mov && !inAtaque ? 0.14 : 0);
  }
}
/* ---------------- ENEMIGOS: PAPAS MALAS ---------------- */
function papaBase(g, color, radio){
  const cuerpo = new THREE.Mesh(new THREE.SphereGeometry(radio, 16, 12),
    new THREE.MeshStandardMaterial({ color:color, roughness:.8 }));
  cuerpo.scale.set(1, 0.85, 0.75); cuerpo.castShadow = true; g.add(cuerpo);
  const ojo = new THREE.Group();
  const w = new THREE.Mesh(new THREE.SphereGeometry(radio*0.26, 8, 6), MAT.blanco); ojo.add(w);
  const p = new THREE.Mesh(new THREE.SphereGeometry(radio*0.14, 6, 4), MAT.negro);
  p.position.set(0, 0, radio*0.22); ojo.add(p);
  const ceja = new THREE.Mesh(new THREE.BoxGeometry(radio*0.4, radio*0.08, radio*0.08), MAT.negro);
  ceja.position.set(0, radio*0.34, radio*0.12); ceja.rotation.z = -0.4; ojo.add(ceja);
  ojo.position.set(-radio*0.4, radio*0.28, radio*0.76); ojo.scale.setScalar(0.8); g.add(ojo);
  const ojo2 = ojo.clone(); ojo2.position.x = radio*0.4; g.add(ojo2);
  const boca = new THREE.Mesh(new THREE.SphereGeometry(radio*0.16, 8, 6), MAT.negro);
  boca.scale.set(1, 0.35, 0.3); boca.position.set(0, -radio*0.2, radio*0.82); g.add(boca);
  return cuerpo;
}

function crearPapita(tipo){
  const st = ESTATS[tipo];
  const g = new THREE.Group();
  let radio = 1;
  if(tipo === 'skirmish'){
    radio = 2.2;   /* 4 veces más grande que la papita héroe */
    papaBase(g, 0xb46b3f, radio);
    /* visor táctico con luz de neón (look moderno) */
    const visor = new THREE.Mesh(new THREE.BoxGeometry(radio*1.05, radio*0.3, radio*0.14), MAT.negro);
    visor.position.set(0, radio*0.3, radio*0.7); g.add(visor);
    const luzV = new THREE.Mesh(new THREE.BoxGeometry(radio*1.07, radio*0.06, radio*0.15), MAT.cian);
    luzV.position.set(0, radio*0.16, radio*0.7); g.add(luzV);
    const garra = (x) => {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 6), MAT.blanco);
      c.position.set(radio*0.55*x, -radio*0.2, radio*0.55); c.rotation.z = x>0? -1.4 : 1.4; g.add(c);
    };
    garra(-1);
    /* espada corta de energía roja (¡las malas también pelean!) */
    const espE = new THREE.Group();
    const hojaE = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.75, 0.03),
      new THREE.MeshStandardMaterial({ color:0xfff2f5, roughness:.3, metalness:.5, emissive:0xff4d88, emissiveIntensity:.85 }));
    hojaE.position.y = 0.42; espE.add(hojaE);
    const auraE = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.78, 0.08),
      new THREE.MeshBasicMaterial({ color:0xff6aa5, transparent:true, opacity:.4, blending:THREE.AdditiveBlending, depthWrite:false }));
    auraE.position.y = 0.42; espE.add(auraE);
    const puntaE = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), MAT.glowW);
    puntaE.position.y = 0.86; espE.add(puntaE);
    const guE = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.05), MAT.negro);
    guE.position.y = 0.05; espE.add(guE);
    espE.position.set(radio*0.62, -radio*0.15, radio*0.3);
    espE.rotation.z = -0.5;
    espE.scale.setScalar(2.7);   /* la espada crece con la papa */
    g.add(espE);
  } else if(tipo === 'shooter'){
    radio = 2.0;
    papaBase(g, 0xc9a227, radio);
    /* gorra hacia atrás con logo */
    const gorra = new THREE.Mesh(new THREE.CylinderGeometry(radio*0.55, radio*0.62, radio*0.42, 12), MAT.negro);
    gorra.position.set(0, radio*0.95, 0); g.add(gorra);
    const viseraG = new THREE.Mesh(new THREE.BoxGeometry(radio*0.85, radio*0.07, radio*0.55), MAT.negro);
    viseraG.position.set(0, radio*0.78, radio*0.62); g.add(viseraG);
    const logoG = new THREE.Mesh(new THREE.BoxGeometry(radio*0.18, radio*0.18, radio*0.05), MAT.rojo);
    logoG.position.set(0, radio*1.02, radio*0.56); g.add(logoG);
    const tuvol = new THREE.Mesh(new THREE.TorusGeometry(radio*0.7, 0.12, 6, 6), MAT.rojo);
    tuvol.position.set(0, radio*0.92, radio*0.5); tuvol.rotation.z = 0.4; g.add(tuvol);
  } else if(tipo === 'bomb'){
    radio = 2.08;
    papaBase(g, 0xd43a2f, radio);
    /* antena con LED y chaleco reflectante */
    const antena = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, radio*0.75, 6), MAT.negro);
    antena.position.set(0, radio*1.05, 0); g.add(antena);
    const chispa = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), MAT.glowW);
    chispa.position.set(0, radio*1.28, 0); g.add(chispa);
    g.userData.chispa = chispa;
    const chaleco = new THREE.Mesh(new THREE.TorusGeometry(radio*0.78, 0.06, 6, 16), MAT.amarillo);
    chaleco.rotation.x = Math.PI/2; chaleco.position.y = 0; g.add(chaleco);
    const chaleco2 = chaleco.clone(); chaleco2.position.y = -radio*0.35; chaleco2.scale.setScalar(0.92); g.add(chaleco2);
  }
  const e = {
    tipo, hp: st.hp, maxHp: st.hp, dmg: st.dmg, vel: st.vel,
    radio: st.radio, radioEn: radio,
    cd: rand(0.4, 1.0), cdT: 0, stun: 0, flash: 0,
    wobPhase: rand(0, Math.PI*2), orbitDir: Math.random()<0.5 ? -1 : 1,
    fase: 'cae', caeT: 0, durCae: 0.9,
    velK: V3(0,0,0), muerto: false,
    atacaT: 0, golpeHecho: false, esJefe: false,
    mesh: g, matCuerpo: null
  };
  g.traverse(o => { if(o.isMesh && o.material && o.material.color){ e.matCuerpo = o.material; } });
  g.userData.ene = e;
  return e;
}

/* caída desde el cielo */
function spawnEnemigo(tipo, x, z){
  const e = crearPapita(tipo);
  const ang = Math.random()*Math.PI*2;
  const r = rand(5, CFG.arenaR - 3);
  const px = (x !== undefined) ? x : Math.cos(ang)*r;
  const pz = (z !== undefined) ? z : Math.sin(ang)*r;
  escena.add(e.mesh);
  e.mesh.position.set(px, CFG.gY + 11, pz);
  e.mesh.rotation.y = Math.random()*Math.PI*2;
  e.destX = px; e.destZ = pz;
  enemyList.push(e);
  SFX.spawn();
  return e;
}

/* ---------------- JEFE: PAPA GIGANTE ---------------- */
function crearJefe(){
  const st = ESTATS.boss;
  SFX.jefe();
  const g = new THREE.Group();
  const radio = st.radio;
  const cuerpo = papaBase(g, 0x8a4a2c, radio*0.62);
  cuerpo.scale.set(1, 0.9, 0.85);
  g.scale.setScalar(1);
  const panza = new THREE.Mesh(new THREE.SphereGeometry(radio*0.5, 14, 10),
    new THREE.MeshStandardMaterial({ color:0x9c5a34, roughness:.8 }));
  panza.position.set(0, -radio*0.42, 0); panza.scale.set(1.1, 0.9, 0.9); g.add(panza);
  const brazos = new THREE.Group(); brazos.position.set(0, -radio*0.2, 0); g.add(brazos);
  const brazo = (x) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(radio*0.18, radio*0.24, radio*0.9, 8),
      new THREE.MeshStandardMaterial({ color:0x8a4a2c, roughness:.85 }));
    b.position.set(radio*0.8*x, 0, 0); b.rotation.z = x>0? -0.3 : 0.3; g.add(b);
  };
  brazo(1); brazo(-1);
  /* casco de obra con luz y chaleco reflectante (look moderno) */
  const casco = new THREE.Mesh(new THREE.SphereGeometry(radio*0.48, 14, 10, 0, Math.PI*2, 0, Math.PI/2), MAT.amarillo);
  casco.position.y = radio*0.98; g.add(casco);
  const ala = new THREE.Mesh(new THREE.CylinderGeometry(radio*0.56, radio*0.6, radio*0.08, 16), MAT.amarillo);
  ala.position.y = radio*0.98; g.add(ala);
  const luzCasco = new THREE.Mesh(new THREE.BoxGeometry(radio*0.3, radio*0.1, radio*0.06), MAT.cian);
  luzCasco.position.set(0, radio*1.15, radio*0.44); g.add(luzCasco);
  const chalecoJ = new THREE.Mesh(new THREE.TorusGeometry(radio*0.58, radio*0.09, 8, 18), MAT.naranja);
  chalecoJ.rotation.x = Math.PI/2; chalecoJ.position.y = -radio*0.22; g.add(chalecoJ);
  const aura = new THREE.Mesh(new THREE.RingGeometry(radio*0.72, radio*0.95, 24),
    new THREE.MeshBasicMaterial({ color:0xff3d2e, transparent:true, opacity:.4, side:THREE.DoubleSide }));
  aura.rotation.x = -Math.PI/2; aura.position.y = 0.1; g.add(aura);

  const e = crearPapita('skirmish');
  e.tipo = 'boss'; e.hp = st.hp; e.maxHp = st.hp; e.dmg = st.dmg; e.vel = st.vel;
  e.radio = st.radio; e.radioEn = radio; e.esJefe = true;
  escena.remove(e.mesh); e.mesh = g; g.userData.ene = e;
  escena.add(g);
  e.fase2 = false;
  e.cdT = 1.2;
  e.matCuerpo = cuerpo.material;
  e.mesh.position.set(0, CFG.gY + 22, 0);
  e.destX = 0; e.destZ = -8;
  boss = e;
  enemyList.push(e);
  return e;
}
/* ---------------- PROYECTILES ---------------- */
let flotantes = [];

function spawnProyectil(obj){ escena.add(obj.mesh); shots.push(obj); }

function dispararSemilla(x, y, z, dx, dz){
  SFX.semilla();
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), MAT.verde);
  m.position.set(x, y, z);
  spawnProyectil({ mesh:m, vel:V3(dx,0,dz), tipo:'semilla', dmg:ESTATS.shooter.dmg, radio:0.9, t:0, hit:false });
}

function soltarRoca(x, z){
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0),
    new THREE.MeshStandardMaterial({ color:0x7a5a3a, roughness:.9 }));
  m.position.set(x, CFG.gY + 12, z);
  spawnProyectil({ mesh:m, vel:V3(0,-13,0), tipo:'roca', dmg:24, radio:1.2, t:0, hit:false });
}

function ondaExpansiva(x, z, maxR, dmg, target, color){
  const m = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.5, 28),
    new THREE.MeshBasicMaterial({ color:color, transparent:true, opacity:.9, side:THREE.DoubleSide, blending:THREE.AdditiveBlending, depthWrite:false }));
  m.rotation.x = -Math.PI/2; m.position.set(x, CFG.gY + 0.3, z);
  spawnProyectil({ mesh:m, tipo:'ondaE', dmg: dmg, target: target, t:0, maxR:maxR, rad:0.4, hit:false });
}

function actualizarProyectiles(dt){
  for(let i = shots.length-1; i >= 0; i--){
    const o = shots[i];
    if(o.tipo === 'semilla' || o.tipo === 'roca'){
      o.mesh.position.addScaledVector(o.vel, dt);
      if(o.tipo === 'roca' && o.mesh.position.y <= CFG.gY + 0.3){
        explosion(o.mesh.position.x, o.mesh.position.y + 0.3, o.mesh.position.z, 0x9c6b3f, 10, 0.8);
        destello(o.mesh.position.x, o.mesh.position.y + 0.3, o.mesh.position.z, 0xffb066, 1.4);
        removerProyectil(i, o);
        continue;
      }
      if(state !== 'menu' && state !== 'carta' && state !== 'muerte' &&
         distXZ(o.mesh.position, hero.pos) < o.radio){
        herirJugador(o.dmg, o.mesh.position);
        explosion(o.mesh.position.x, CFG.gY+0.5, o.mesh.position.z, o.tipo==='semilla'? 0x9fbf4d : 0x9c6b3f, 6, 0.8);
        removerProyectil(i, o);
        continue;
      }
      o.t += dt;
      if(o.t > 6){ removerProyectil(i, o); }
    } else if(o.tipo === 'ondaE'){
      o.t += dt;
      o.rad += dt * 8.5;
      const s = o.rad; o.mesh.scale.set(s, 1, s);
      if(!o.hit){
        if(o.target === 'enemigo'){ dañarEnemigosRadio(o.mesh.position, o.rad*0.55, o.dmg); }
        else if(o.target === 'jugador' && distXZ(o.mesh.position, hero.pos) < o.rad*0.55){ herirJugador(o.dmg, o.mesh.position); }
        o.hit = true;
      }
      if(o.rad > o.maxR || o.t > 1.4){ removerProyectil(i, o); }
    }
  }
}
function removerProyectil(i, o){
  escena.remove(o.mesh);
  shots.splice(i,1);
}

/* ---------------- MARCADORES DE TIERRA (telegraph) ---------------- */
function marcarTierra(x, z, radio, dur, color){
  const m = new THREE.Mesh(new THREE.RingGeometry(radio*0.86, radio, 28),
    new THREE.MeshBasicMaterial({ color:color, transparent:true, opacity:.55, side:THREE.DoubleSide, depthWrite:false }));
  m.rotation.x = -Math.PI/2; m.position.set(x, CFG.gY + 0.12, z);
  escena.add(m);
  marks.push({ mesh:m, t:0, dur:dur });
}
function actualizarMarcas(dt){
  for(let i = marks.length-1; i >= 0; i--){
    const mk = marks[i];
    mk.t += dt;
    mk.mesh.material.opacity = 0.3 + 0.35 * Math.sin(mk.t * 14);
    if(mk.t >= mk.dur){
      escena.remove(mk.mesh);
      marks.splice(i,1);
    }
  }
}

/* ---------------- PARTÍCULAS ---------------- */
function explosion(x, y, z, color, cantidad, vel){
  /* geometrías y materiales compartidos: cero basura para el recolector */
  if(!explosion.geo){
    explosion.geo = [new THREE.SphereGeometry(0.04, 6, 4), new THREE.SphereGeometry(0.07, 6, 4), new THREE.SphereGeometry(0.1, 6, 4)];
    explosion.mats = {};
  }
  if(!explosion.mats[color]) explosion.mats[color] = new THREE.MeshBasicMaterial({ color:color });
  for(let i = 0; i < cantidad; i++){
    const s = new THREE.Mesh(explosion.geo[i%3], explosion.mats[color]);
    s.position.set(x + rand(-0.1,0.1), y + rand(-0.1,0.1), z + rand(-0.1,0.1));
    const v = V3(rand(-1,1), rand(0.3,1.4), rand(-1,1)).multiplyScalar(vel);
    escena.add(s);
    parts.push({ mesh:s, vel:v, t:0, vida:rand(0.4, 0.9), sprite:false });
  }
}
const matDestello = {};
function destello(x, y, z, color, size){
  if(!matDestello[color]) matDestello[color] = new THREE.SpriteMaterial({ map:TEX_GLOW, color:color, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false });
  const s = new THREE.Sprite(matDestello[color]);
  s.position.set(x, y, z); s.scale.setScalar(size);
  parts.push({ mesh:s, t:0, vida:0.5, sprite:true, baseS:size });
  escena.add(s);
}
function corazon(x, y, z){
  const g = new THREE.Group();
  const a = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), MAT.rosita);
  a.position.set(-0.05, 0.05, 0);
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), MAT.rosita);
  b.position.set(0.05, 0.05, 0);
  const tri = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.16, 6), MAT.rosita);
  tri.position.y = -0.05; tri.rotation.z = Math.PI;
  g.add(a, b, tri);
  g.position.set(x, y, z);
  const p = { mesh:g, vel:V3(rand(-0.3,0.3), rand(1.3,2.2), rand(-0.3,0.3)), t:0, vida:rand(1, 1.6), sprite:false };
  parts.push(p);
  escena.add(g);
}
function actualizarPartes(dt){
  for(let i = parts.length-1; i >= 0; i--){
    const p = parts[i];
    p.t += dt;
    if(p.vel) p.mesh.position.addScaledVector(p.vel, dt);
    if(p.sprite){ const k = 1 - p.t/p.vida; p.mesh.scale.setScalar(p.baseS * (0.25 + k*1.75)); }
    else if(!p.noFade){
      p.mesh.rotation.x += dt*4; p.mesh.rotation.y += dt*3;
      if(p.mesh.material && p.mesh.material.transparent) p.mesh.material.opacity = Math.max(0, 1 - p.t/p.vida);
    }
    if(p.t >= p.vida){ escena.remove(p.mesh); parts.splice(i,1); }
  }
}
function actualizarFlotantes(dt){
  const now = performance.now();
  for(let i = flotantes.length-1; i >= 0; i--){
    const f = flotantes[i];
    const k = (now - f.t0)/f.dur;
    if(k >= 1){ f.el.remove(); flotantes.splice(i,1); continue; }
    const pop = k < 0.15 ? 1 + k*1.5 : 1;
    f.el.style.transform = 'translate(-50%,-50%) scale('+pop+')';
    f.el.style.left = f.x+'px';
    f.el.style.top  = (f.y - k*70)+'px';
    f.el.style.opacity = 1 - k;
  }
}
/* ---------------- COMBATE ---------------- */
function proyectar3D(v){
  const p = v.clone().project(camara);
  if(p.z > 1 || p.z < -1) return null;
  return { x: (p.x*0.5 + 0.5) * innerWidth, y: (-p.y*0.5 + 0.5) * innerHeight };
}
function numDaño(x, y, z, val, clase){
  const pr = proyectar3D(V3(x, y, z));
  if(!pr) return;
  const el = document.createElement('div');
  el.className = 'numDaño' + (clase ? ' '+clase : '');
  el.textContent = String(Math.round(val));
  el.style.left = pr.x+'px'; el.style.top = pr.y+'px';
  UI.daos.appendChild(el);
  flotantes.push({ el, x:pr.x, y:pr.y, t0:performance.now(), dur:900 });
}
function textoFlotante(x, y, z, str, color){
  const pr = proyectar3D(V3(x, y, z));
  if(!pr) return;
  const el = document.createElement('div');
  el.className = 'numDaño crit';
  el.textContent = str;
  el.style.color = color || '#9adcff';
  el.style.left = pr.x+'px'; el.style.top = pr.y+'px';
  UI.daos.appendChild(el);
  flotantes.push({ el, x:pr.x, y:pr.y, t0:performance.now(), dur:1100 });
}
function dañarEnemigo(e, dmg, clase){
  if(e.muerto) return;
  e.hp -= dmg;
  e.flash = 0.18;
  e.pop = 0.22;
  e.stun = Math.max(e.stun, 0.22);
  if(e.esJefe) actualizarBarrJefe();
  numDaño(e.mesh.position.x, CFG.gY + 1.4, e.mesh.position.z, dmg, clase);
  ultCarga = Math.min(100, ultCarga + 3);
  if(e.hp <= 0) matarEnemigo(e);
}
function dañarEnemigosRadio(pos, radio, dmg){
  for(const e of enemyList){
    if(e.muerto) continue;
    if(distXZ(e.mesh.position, pos) <= radio + e.radio){
      dañarEnemigo(e, dmg, e.esJefe ? 'jefe' : '');
    }
  }
}
function matarEnemigo(e){
  e.muerto = true;
  if(e.esJefe){
    bossMuertoT = 0;
    /* al caer el jefe, TODAS sus papitas caen con él */
    for(const o of enemyList){
      if(o !== e && !o.muerto){
        o.muerto = true;
        explosion(o.mesh.position.x, CFG.gY + 0.8, o.mesh.position.z, 0xc9a24b, 8, 1.0);
      }
    }
    UI.barrJefe.classList.add('oculto');
    impactFrame(0.26, 1.2);
    slowmoIn(1.2);
    camShake = 1.3; camKick = 12;
    explosion(e.mesh.position.x, CFG.gY + 1, e.mesh.position.z, 0xff8a3d, 26, 2.0);
    destello(e.mesh.position.x, CFG.gY + 2, e.mesh.position.z, 0xffe27a, 12);
    destello(e.mesh.position.x, CFG.gY + 4, e.mesh.position.z, 0xffffff, 10);
  } else {
    explosion(e.mesh.position.x, CFG.gY+0.6, e.mesh.position.z, e.tipo==='bomb'?  0xff8a3d : 0xc9a24b, 14, 1.1);
    destello(e.mesh.position.x, CFG.gY+0.8, e.mesh.position.z,  0xffd27f, 2.2);
  }
}
/* ---------------- ACCIONES DEL JUGADOR ---------------- */
function slowmoIn(t){ slowmoT = t; }
function impactFrame(t, f){ impactT = Math.max(impactT, t); if(f) flashT = Math.max(flashT, f); }

function actualizarAtaque(dt){
  if(!inAtaque){
    hero.brazoDer.rotation.x = Math.sin(tW*22)*0.15;
    hero.brazoDer.rotation.z = 0.2;
    hero.brazoDer.rotation.y = 0;
    if(escudoT <= 0) hero.brazoIzq.rotation.x = Math.sin(tW*18)*0.05;
    return;
  }
  swingT += dt;
  const dur = 0.16;   /* sin cooldown: puedes encadenar golpes al instante */
  const p = Math.min(swingT/dur, 1);
  const s = Math.sin(p*Math.PI);
  /* cada golpe del combo barre en una dirección distinta */
  if(comboIdx === 0){          /* diagonal descendente derecha→izquierda */
    hero.brazoDer.rotation.x = -s*1.9 + 0.2;
    hero.brazoDer.rotation.z = 0.6 - s*1.1;
  } else if(comboIdx === 1){   /* tajo horizontal ascendente */
    hero.brazoDer.rotation.x = -s*1.3 + 0.35;
    hero.brazoDer.rotation.z = -0.8 + s*1.5;
  } else if(comboIdx === 2){   /* diagonal inversa izquierda→derecha */
    hero.brazoDer.rotation.x = -s*1.7 + 0.25;
    hero.brazoDer.rotation.z = 1.0 - s*1.9;
  } else {                     /* PAPAZO: giro completo de 360° */
    hero.brazoDer.rotation.x = -s*2.1 + 0.2;
    hero.brazoDer.rotation.z = 0.3;
    hero.brazoDer.rotation.y = s * Math.PI * 1.6;
  }
  /* estela luminosa que sigue el rastro del filo */
  rastroEspada(comboIdx);
  if(p >= 0.2 && !hitAplicado && comboIdx >= 0){
    aplicarGolpe(comboIdx);
    hitAplicado = true;
  }
  if(p >= 1) inAtaque = false;
}

function rastroEspada(idx){
  if(!hero || !hero.espada) return;
  const col = (idx === 3) ? 0xff5ca8 : 0x9adcff;
  const tip = hero.espada.localToWorld(V3(0, 1.85, 0));
  const mid = hero.espada.localToWorld(V3(0, 1.1, 0));
  for(const pt of [tip, mid]){
    if(!matDestello[col]) matDestello[col] = new THREE.SpriteMaterial({ map:TEX_GLOW, color:col, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false });
    const sp = new THREE.Sprite(matDestello[col]);
    sp.position.copy(pt);
    const bs = rand(0.35, 0.6);
    sp.scale.setScalar(bs);
    parts.push({ mesh:sp, t:0, vida:0.22, sprite:true, baseS:bs });
    escena.add(sp);
  }
}

function aplicarGolpe(idx){
  /* la espada golpea más fuerte cuanto más largo llevas el combo */
  const dmg = Math.round(CFG.player.combos[idx][0] * (1 + idx*0.3));
  SFX[idx === 3 ? 'papazo' : 'golpe']();
  const alcance = 2.7;
  const angulo = 1.9;
  const fx = Math.sin(hero.facing);
  const fz = Math.cos(hero.facing);
  let golpea = false;
  for(const e of enemyList){
    if(e.muerto) continue;
    const dx = e.mesh.position.x - hero.pos.x;
    const dz = e.mesh.position.z - hero.pos.z;
    const dist = Math.hypot(dx, dz);
    if(dist > alcance + e.radio) continue;
    if(dist > 0.001){
      const dot = (dx*fx + dz*fz)/dist;
      if(dot < Math.cos(angulo/2)) continue;
    }
    golpea = true;
    dañarEnemigo(e, dmg, (idx===3) ? 'crit' : '');
    const k = Math.min(1, 1.3/e.radioEn);   /* las papas grandes aguantan más el empujón */
    e.velK.set(fx*3.4*k, 1.0, fz*3.4*k);
  }
  if(golpea){
    ultCarga = Math.min(100, ultCarga + (idx===3 ? 14 : 8));
    if(idx < 3) impactFrame(0.07, 0.8);   /* mini hitstop estroboscópico en cada golpe */
    camShake = Math.max(camShake, 0.24 + idx*0.09);
    camKick = Math.min(12, camKick + (idx===3 ? 6 : 3.2));
    destello(hero.pos.x + fx*1.2, CFG.gY + 1.1, hero.pos.z + fz*1.2, 0xbfe8ff, 1.2);
    /* chispas del impacto */
    for(let i=0;i<4;i++){
      destello(hero.pos.x + fx*rand(0.7,1.9) + rand(-0.4,0.4), CFG.gY + rand(0.6,1.6), hero.pos.z + fz*rand(0.7,1.9) + rand(-0.4,0.4),
        Math.random()<0.5 ? 0xffe27a : 0x9adcff, rand(0.4,0.8));
    }
    if(idx===3){
      /* papazo final: IMPACT FRAME + onda, polvo y micro slow-mo */
      impactFrame(0.14, 1);
      marcarTierra(hero.pos.x + fx*1.4, hero.pos.z + fz*1.4, 1.1, 0.4, 0xff5ca8);
      explosion(hero.pos.x + fx*1.3, CFG.gY + 0.9, hero.pos.z + fz*1.3, 0xffe27a, 8, 1.3);
      slowmoIn(0.18);
    }
  }
}

function tryCombo(){
  if(state === 'menu' || state === 'dialogo' || state === 'cinema' || state === 'carta' || state === 'muerte') return;
  if(inAtaque || dashT > 0) return;
  if(comboIdx < 0 || comboT > CFG.player.combWindow) comboIdx = 0;
  else if(comboIdx < 3) comboIdx += 1;
  else comboIdx = 0;
  comboT = 0;
  swingT = 0;
  hitAplicado = false;
  inAtaque = true;
  SFX.swing();
}

function fireHeavy(){
  if(state !== 'pelear' && state !== 'jefe'){ chgT = -1; return; }
  const cfg = CFG.player.heavy;
  chgT = -1;
  inAtaque = true; hitAplicado = true;
  impactFrame(0.11, 0.95);
  camShake = 0.9; camKick = 8; slowmoIn(0.12);
  SFX.pesado();
  dañarEnemigosRadio(hero.pos, 2.4, Math.round(cfg.dmg*0.6));
  ondaExpansiva(hero.pos.x, hero.pos.z, 7.5, cfg.dmg, 'enemigo', 0xffd27f);
  destello(hero.pos.x, CFG.gY + 1, hero.pos.z, 0xffd27f, 3.5);
  explosion(hero.pos.x, CFG.gY + 0.6, hero.pos.z, 0xffb066, 12, 1.2);
  ultCarga = Math.min(100, ultCarga + 12);
}
function tryParry(){
  if(state === 'menu' || state === 'dialogo' || state === 'cinema' || state === 'carta' || state === 'muerte') return;
  if(escudoT > 0) return;
  escudoT = CFG.player.shield.dur;
  hero.brazoIzq.rotation.x = -1.0;
  SFX.escudo();
}
function herirJugador(dmg, desde){
  if(invuln > 0 || !hero) return;
  if(state === 'menu' || state === 'dialogo' || state === 'carta' || state === 'cinema') return;
  const sh = CFG.player.shield;
  if(escudoT > 0){
    if(escudoT > sh.dur - sh.perfect){
      parryPerfecto();
      return;
    }
    dmg = Math.round(dmg * sh.redux);
    destello(hero.pos.x, CFG.gY + 1.3, hero.pos.z, 0x9adcff, 1.6);
    camShake = Math.max(camShake, 0.3);
    ultCarga = Math.min(100, ultCarga + 8);
    SFX.escudo();
  } else if(dashT > 0){
    esquivaPerfecta();
    return;
  }
  hero.hp = Math.max(0, hero.hp - dmg);
  hitFlashT = 0.45;
  camShake = Math.max(camShake, 0.85);
  camKick = Math.min(14, camKick + 6);
  SFX.dano();
  invuln = 0.3;
  textoFlotante(hero.pos.x, CFG.gY + 1.8, hero.pos.z, '-' + dmg, '#ffb3c1');
  if(hero.hp <= 0) gameOver();
}
function parryPerfecto(){
  escudoT = 0;
  impactFrame(0.2, 1.1);
  slowmoIn(0.7);
  invuln = 0.9;
  camShake = 0.6; camKick = 5;
  SFX.parry();
  textoFlotante(hero.pos.x, CFG.gY + 2.2, hero.pos.z, '¡PARRY PERFECTO!', '#9adcff');
  destello(hero.pos.x, CFG.gY + 1.2, hero.pos.z, 0x9adcff, 3.2);
  for(const e of enemyList){
    if(e.muerto) continue;
    const d = distXZ(e.mesh.position, hero.pos);
    if(d < 6.0){
      e.stun = Math.max(e.stun, 2.6);
      dañarEnemigo(e, CFG.player.counter.dmg, 'crit');
      e.velK.set((e.mesh.position.x - hero.pos.x)/d*6, 1.5, (e.mesh.position.z - hero.pos.z)/d*6);
    }
  }
}
function esquivaPerfecta(){
  dashT = 0;
  impactFrame(0.12, 0.85);
  slowmoIn(0.7);
  invuln = 0.9;
  camShake = 0.5;
  SFX.esquiva();
  textoFlotante(hero.pos.x, CFG.gY + 2.0, hero.pos.z, '¡ESQUIVA PERFECTA!', '#7bdc8f');
  destello(hero.pos.x, CFG.gY + 1.2, hero.pos.z, 0x7bdc8f, 3);
  dañarEnemigosRadio(hero.pos, 4.5, CFG.player.counter.dmg);
}

function tryDash(){
  if(state !== 'pelear' && state !== 'jefe' && state !== 'intro') return;
  if(dashCD > 0 || dashT > 0) return;
  let mx = 0, mz = 0;
  if(K['KeyW']) mz += 1; if(K['KeyS']) mz -= 1; if(K['KeyA']) mx -= 1; if(K['KeyD']) mx += 1;
  const len = Math.hypot(mx, mz);
  const sy = Math.sin(camYaw), cy = Math.cos(camYaw);
  let wx, wz;
  if(len > 0){ wx = (mz*sy - mx*cy)/len; wz = (mz*cy + mx*sy)/len; }
  else { wx = Math.sin(hero.facing); wz = Math.cos(hero.facing); }
  dashDx = wx; dashDz = wz;
  impactFrame(0.06, 0.65);
  camKick = 3; camShake = Math.max(camShake, 0.25);
  SFX.dash();
  dashT = CFG.player.dash.dur;
  dashCD = CFG.player.dash.cd;
  inAtaque = false;
  for(let i = 0; i < 10; i++){
    destello(hero.pos.x - wx*i*0.14, CFG.gY + 0.7, hero.pos.z - wz*i*0.14, 0x9adcff, 0.7);
  }
}

function tryUlt(){
  if(ultCarga < 100) return;
  if(state !== 'pelear' && state !== 'jefe') return;
  ultCarga = 0;
  UI.ultLleno.style.width = '0%';
  inAtaque = false;
  const cfg = CFG.player.ult;
  const cx = hero.pos.x, cz = hero.pos.z;
  /* --- FASE 1: impact frame congelado + flash blanco --- */
  impactFrame(0.22, 1.25);
  camShake = 0.8; camKick = 14;
  SFX.ult();
  textoFlotante(cx, CFG.gY + 2.6, cz, '¡PAPA SUPREMA!', '#d9a8ff');
  destello(cx, CFG.gY + 1.4, cz, 0xffffff, 6);
  ondaExpansiva(cx, cz, 4, 0, 'visual', 0xffffff);
  /* --- FASE 2: la explosión real, 160ms después del congelado --- */
  setTimeout(() => {
    if(!hero) return;
    slowmoIn(0.6);
    camShake = 1.4; camKick = 10;
    SFX.ultBlast();
    dañarEnemigosRadio(V3(cx, 0, cz), cfg.radio, cfg.dmg);
    hero.hp = Math.min(hero.maxHp, hero.hp + cfg.heal);
    ondaExpansiva(cx, cz, 9, 0, 'visual', 0xd9a8ff);
    ondaExpansiva(cx, cz, 12, 0, 'visual', 0xff5ca8);
    ondaExpansiva(cx, cz, 15, 0, 'visual', 0x9adcff);
    /* pilar central de luz celestial */
    const pilar = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.1, 26, 18, 1, true),
      new THREE.MeshBasicMaterial({ color:0xd9a8ff, transparent:true, opacity:.5, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, depthWrite:false }));
    pilar.position.set(cx, CFG.gY + 13, cz);
    parts.push({ mesh:pilar, vel:V3(0,0,0), t:0, vida:0.7, sprite:false });
    escena.add(pilar);
    /* 6 mini pilares alrededor */
    for(let i = 0; i < 6; i++){
      const a = (i/6)*Math.PI*2 + 0.4;
      const mp = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 12, 10, 1, true),
        new THREE.MeshBasicMaterial({ color: i%2 ? 0x9adcff : 0xff5ca8, transparent:true, opacity:.55, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, depthWrite:false }));
      mp.position.set(cx + Math.cos(a)*3.6, CFG.gY + 6, cz + Math.sin(a)*3.6);
      parts.push({ mesh:mp, vel:V3(0,0,0), t:0, vida:0.65, sprite:false });
      escena.add(mp);
    }
    explosion(cx, CFG.gY + 0.5, cz, 0xd9a8ff, 30, 1.8);
    destello(cx, CFG.gY + 1.2, cz, 0xd9a8ff, 6);
    destello(cx, CFG.gY + 1.2, cz, 0xff5ca8, 4.5);
    for(let i = 0; i < 5; i++) corazon(cx + rand(-1.5,1.5), CFG.gY + 0.9, cz + rand(-1.5,1.5));
  }, 160);
}

function actualizarTimers(dt){
  if(slowmoT > 0){ slowmoT -= dt; tScale = 0.3; }
  else tScale = 1;
  /* impact frame: el mundo se congela del todo (hitstop) */
  if(impactT > 0){ impactT -= dt; tScale = 0; }
  if(flashT > 0){
    flashT = Math.max(0, flashT - dt*1.6);
    /* estrobo de alto contraste: el blanco parpadea a frecuencia altísima */
    const st = 0.5 + 0.5 * Math.sign(Math.sin(performance.now() * 0.10));
    UI.flashBlanco.style.opacity = Math.min(1, flashT * (0.45 + 0.55*st)).toFixed(3);
  }
  if(dashT > 0 && hero) rastroEspada(3);   /* estela luminosa del dash */
  if(dashT > 0) dashT -= dt;
  /* lluvia desde las nubes de tormenta (algunas gotas suben: lluvia mágica) */
  lluviaT -= dt;
  if(lluviaT <= 0){
    lluviaT = 0.08;
    if(!actualizar.gotaGeo){
      actualizar.gotaGeo = new THREE.BoxGeometry(0.06, 1.7, 0.06);
      actualizar.matsLluvia = {
        sube: new THREE.MeshBasicMaterial({ color:0xcfe8ff }),
        baja: new THREE.MeshBasicMaterial({ color:0xa9c6e8 })
      };
    }
    for(let i = 0; i < 2; i++){
      const up = Math.random() < 0.35;
      const g = new THREE.Mesh(actualizar.gotaGeo, up ? actualizar.matsLluvia.sube : actualizar.matsLluvia.baja);
      const rr = rand(20, 250), aa = Math.random()*Math.PI*2;
      g.position.set(Math.cos(aa)*rr, up ? CFG.gY + rand(0, 8) : CFG.gY + rand(46, 78), Math.sin(aa)*rr);
      escena.add(g);
      parts.push({ mesh:g, vel:V3(0, up ? rand(10,18) : rand(-34,-26), 0), t:0, vida: up ? rand(1.8,2.6) : rand(1.6,2.4), sprite:false, noFade:true });
    }
  }
  /* VENTISCA: ráfagas horizontales cruzando la azotea */
  ventiscaT -= dt;
  if(ventiscaT <= 0){
    ventiscaT = 0.009;
    if(!actualizar.vientoGeo){
      actualizar.vientoGeo = new THREE.BoxGeometry(5.0, 0.05, 0.05);
      actualizar.matsViento = [
        new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:.5 }),
        new THREE.MeshBasicMaterial({ color:0xcfe8ff, transparent:true, opacity:.4 })
      ];
    }
    const w = new THREE.Mesh(actualizar.vientoGeo, actualizar.matsViento[Math.random()<0.5 ? 0 : 1]);
    const aa = Math.random()*Math.PI*2, rr = rand(6, 30);
    const cx = hero ? hero.pos.x : 0, cz = hero ? hero.pos.z : 0;
    w.position.set(cx + Math.cos(aa)*rr, CFG.gY + rand(0.3, 9), cz + Math.sin(aa)*rr);
    const av = rand(0, Math.PI*2);
    escena.add(w);
    parts.push({ mesh:w, vel:V3(Math.cos(av)*rand(28,44), 0, Math.sin(av)*rand(16,26)), t:0, vida:rand(0.8,1.3), sprite:false, noFade:true });
    /* ráfagas 2 a 21 al mismo tiempo: VENTISCA HURACANADA */
    for(let k = 0; k < 20; k++){
      const w2 = new THREE.Mesh(actualizar.vientoGeo, actualizar.matsViento[Math.random()<0.5 ? 0 : 1]);
      const aa2 = Math.random()*Math.PI*2, rr2 = rand(4, 26);
      w2.position.set(cx + Math.cos(aa2)*rr2, CFG.gY + rand(0.3, 10), cz + Math.sin(aa2)*rr2);
      const av2 = rand(0, Math.PI*2);
      escena.add(w2);
      parts.push({ mesh:w2, vel:V3(Math.cos(av2)*rand(28,44), 0, Math.sin(av2)*rand(16,26)), t:0, vida:rand(0.7,1.2), sprite:false, noFade:true });
    }
  }
  if(dashCD > 0) dashCD -= dt;
  if(invuln > 0) invuln -= dt;
  if(escudoT > 0){
    escudoT -= dt;
    if(escudoT <= 0) hero.brazoIzq.rotation.x = 0;
  }
  if(hitFlashT > 0) hitFlashT -= dt;
  if(camShake > 0) camShake = Math.max(0, camShake - dt*1.6);
  if(camKick > 0) camKick = Math.max(0, camKick - dt*26);
  comboT += dt;
  if(M.izq && !M.arrIzq && state !== 'menu' && state !== 'carta' && state !== 'muerte'){
    if(!inAtaque && (performance.now() - M.izqT) > CFG.player.heavy.charge*1000){
      if(chgT < 0) chgT = 0;
      chgT += dt;
      hero.brazoDer.rotation.x = -0.75 + Math.sin(tW*22)*0.25;
      if(Math.random() < 0.4){
        destello(hero.pos.x + rand(-0.3,0.3), CFG.gY + 1.4, hero.pos.z + rand(-0.3,0.3), 0xffd27f, 0.45);
      }
    }
  }
}

function gameOver(){
  state = 'muerte';
  SFX.muerte();
  UI.hud.classList.add('oculto');
  UI.merte.classList.remove('oculto');
  UI.barrJefe.classList.add('oculto');
  UI.pantallaInicio.classList.add('oculto');
  UI.cajaDialogo.classList.add('oculto');
}
/* ---------------- IA DE ENEMIGOS ---------------- */
function actualizarEnemigos(dt){
  for(const e of enemyList){
    if(e.muerto){
      e.mesh.rotation.y += dt*2;
      e.mesh.position.y -= dt*4;
      continue;
    }
    if(e.esJefe) continue; /* el jefe se controla aparte */
    /* pop de impacto: la papa se agranda un instante al recibir el golpe */
    if(e.pop > 0){
      e.pop -= dt*3;
      if(e.escBase === undefined) e.escBase = e.mesh.scale.x || 1;
      e.mesh.scale.setScalar(e.escBase * (1 + Math.max(0, e.pop)*1.4));
    }
    /* parpadeo de daño */
    if(e.flash > 0){
      e.flash -= dt;
      if(e.matCuerpo){
        if(e.matCuerpo.emissive) e.matCuerpo.emissive.setHex(0xffffff);
        if(e.matCuerpo.emissiveIntensity !== undefined) e.matCuerpo.emissiveIntensity = Math.max(0.8, e.flash*4);
      }
    } else if(e.matCuerpo && e.matCuerpo.emissive !== undefined){
      if(e.matCuerpo.emissive) e.matCuerpo.emissive.setHex(0x000000);
      if(e.matCuerpo.emissiveIntensity !== undefined) e.matCuerpo.emissiveIntensity = 0;
    }

    /* fase 'cae': caen del cielo */
    if(e.fase === 'cae'){
      const g = CFG.gY + 11;
      e.caeT += dt;
      const p = e.caeT / e.durCae;
      const y = g - (g - CFG.gY) * (p*p);
      e.mesh.position.y = y;
      e.mesh.rotation.x += dt*3;
      if(e.caeT >= e.durCae){
        e.fase = 'activo';
        e.mesh.rotation.x = 0;
        e.mesh.position.y = CFG.gY + e.radioEn*0.4;
        destello(e.mesh.position.x, CFG.gY + 0.5, e.mesh.position.z, 0xffe27a, 1.4);
        camShake = Math.max(camShake, 0.28);
        explosion(e.mesh.position.x, CFG.gY + 0.3, e.mesh.position.z, 0xcfd6e0, 8, 1.0);
        marcarTierra(e.mesh.position.x, e.mesh.position.z, 1.0, 0.35, 0x3fd4ff);
      }
      continue;
    }

    if(e.fase === 'activo'){
      /* velocidad de knockback */
      if(e.velK) e.mesh.position.addScaledVector(e.velK, dt);
      if(e.velK){ e.velK.multiplyScalar(0.92); }

      if(e.stun > 0){
        e.stun -= dt;
        e.mesh.rotation.z = Math.sin(tW*22) * 0.18;   /* mareado: se tambalea */
        continue;
      }

      /* distancia al héroe */
      const dx = hero.pos.x - e.mesh.position.x;
      const dz = hero.pos.z - e.mesh.position.z;
      const dist = Math.hypot(dx, dz);

      /* orientar al héroe (yaw puro con atan2: nunca se voltea de cabeza) */
      if(dist > 0.001){
        const yawE = Math.atan2(hero.pos.x - e.mesh.position.x, hero.pos.z - e.mesh.position.z);
        e.mesh.rotation.set(0, yawE, e.mesh.rotation.z || 0);
      }
      /* animación frenética: saltitos bien altos y balanceo al moverse */
      e.animT = (e.animT || rand(0, 6)) + dt * 14;
      e.mesh.position.y = CFG.gY + e.radioEn*0.4 + Math.abs(Math.sin(e.animT)) * 0.45;
      e.mesh.rotation.z = Math.sin(e.animT * 0.5) * 0.13;

      /* bombas: se aproximan en zigzag y explotan */
      if(e.tipo === 'bomb'){
        const wobB = Math.sin(tW*1.9 + (e.wobPhase||0)) * 0.8;
        const mxb = (dx/dist) + (-dz/dist)*wobB + (dz/dist)*(e.orbitDir||1)*0.3;
        const mzb = (dz/dist) + ( dx/dist)*wobB + (-dx/dist)*(e.orbitDir||1)*0.3;
        const mlb = Math.hypot(mxb, mzb) || 1;
        e.mesh.position.x += (mxb/mlb) * e.vel * dt;
        e.mesh.position.z += (mzb/mlb) * e.vel * dt;
        if(distXZ(e.mesh.position, hero.pos) < e.radioEn + 1.6){
          explotarBomba(e);
        }
        continue;
      }

      if(e.tipo === 'skirmish'){
        /* carga al héroe en zigzag con fase propia (nada de línea recta) */
        const dAtaque = e.radioEn + 1.5;
        if(dist > dAtaque){
          const wob = Math.sin(tW*1.9 + (e.wobPhase||0)) * 0.85;
          const orb = (e.orbitDir||1) * 0.35;
          const mxz = (dx/dist) + (-dz/dist)*wob + (dz/dist)*orb;
          const mzz = (dz/dist) + ( dx/dist)*wob + (-dx/dist)*orb;
          const ml = Math.hypot(mxz, mzz) || 1;
          e.mesh.position.x += (mxz/ml) * e.vel * dt;
          e.mesh.position.z += (mzz/ml) * e.vel * dt;
        } else if(dist > e.radioEn*0.5){
          /* tajo de espada */
          e.cd -= dt;
          if(e.cd <= 0){
            e.cd = ESTATS.skirmish.cd;
            e.atacaT = 0.35;
            mordida(e);
          }
        }
        if(e.atacaT > 0){
          e.atacaT -= dt;
          if(e.atacaT <= 0 && !e.golpeHecho){
            e.golpeHecho = true;
            if(distXZ(e.mesh.position, hero.pos) < e.radioEn + 2.2){
              herirJugador(e.dmg, e.mesh.position);
            }
          }
        }
      }

      if(e.tipo === 'shooter'){
        /* mantiene la distancia: retrocede si te acercas, avanza si te alejas */
        if(dist < e.radioEn + 4){
          e.mesh.position.x -= (dx/dist) * e.vel * 0.65 * dt;
          e.mesh.position.z -= (dz/dist) * e.vel * 0.65 * dt;
        } else if(dist > 20){
          e.mesh.position.x += (dx/dist) * e.vel * 0.5 * dt;
          e.mesh.position.z += (dz/dist) * e.vel * 0.5 * dt;
        }
        if(dist < 17){
          e.cd -= dt;
          if(e.cd <= 0){
            e.cd = ESTATS.shooter.cd;
            const nx = dx/dist, nz = dz/dist;
            dispararSemilla(e.mesh.position.x, CFG.gY + 1.4, e.mesh.position.z, nx*4.2, nz*4.2);
            destello(e.mesh.position.x, CFG.gY + 1.6, e.mesh.position.z, 0x9fbf4d, 0.9);
          }
        }
      }
    }
  }

  /* separación entre papas: se empujan para NUNCA apilarse en el mismo punto */
  for(let i = 0; i < enemyList.length; i++){
    const a = enemyList[i];
    if(a.muerto || a.fase !== 'activo') continue;
    for(let j = i + 1; j < enemyList.length; j++){
      const b = enemyList[j];
      if(b.muerto || b.fase !== 'activo') continue;
      const sx = b.mesh.position.x - a.mesh.position.x;
      const sz = b.mesh.position.z - a.mesh.position.z;
      const d2 = sx*sx + sz*sz;
      const minD = (a.radioEn + b.radioEn) * 1.15;
      if(d2 < minD*minD && d2 > 0.0001){
        const d = Math.sqrt(d2);
        const push = (minD - d) * 0.5 / d;
        a.mesh.position.x -= sx * push; a.mesh.position.z -= sz * push;
        b.mesh.position.x += sx * push; b.mesh.position.z += sz * push;
      } else if(d2 <= 0.0001){
        /* exactamente en el mismo punto: separación aleatoria */
        a.mesh.position.x += rand(-0.4, 0.4); a.mesh.position.z += rand(-0.4, 0.4);
      }
    }
  }

  /* el héroe NUNCA se funde con las papas: mantienen su distancia */
  for(const e of enemyList){
    if(e.muerto || e.fase !== 'activo') continue;
    const sx = e.mesh.position.x - hero.pos.x;
    const sz = e.mesh.position.z - hero.pos.z;
    const d2 = sx*sx + sz*sz;
    const minDH = e.esJefe ? e.radioEn*0.62 + 0.7 : (e.radioEn + 0.9);
    if(d2 < minDH*minDH && d2 > 0.0001){
      const d = Math.sqrt(d2);
      const push = (minDH - d) / d;
      if(e.esJefe){
        /* el jefe es tan enorme que te empuja a ti fuera de su cuerpo */
        hero.pos.x -= sx * push; hero.pos.z -= sz * push;
      } else {
        e.mesh.position.x += sx * push;
        e.mesh.position.z += sz * push;
      }
    }
  }
}

function mordida(e){
  /* animación: embestida agresiva proporcional a su tamaño */
  e.golpeHecho = false;
  const l = 0.35 * (e.radioEn/0.55);
  e.mesh.position.x += Math.sin(e.mesh.rotation.y) * l;
  e.mesh.position.z += Math.cos(e.mesh.rotation.y) * l;
}
function explotarBomba(e){
  matarEnemigo(e);
  explosion(e.mesh.position.x, CFG.gY + 0.5, e.mesh.position.z, 0xff8a3d, 12, 1);
  destello(e.mesh.position.x, CFG.gY + 0.6, e.mesh.position.z, 0xffb066, 2);
  if(distXZ(e.mesh.position, hero.pos) < ESTATS.bomb.blast + 0.5){
    herirJugador(e.dmg, e.mesh.position);
  }
  if(boss && boss.mesh.position.distanceTo(e.mesh.position) < ESTATS.bomb.blast + 0.5){
    dañarEnemigo(boss, e.dmg*2, 'jefe');
  }
}
/* ---------------- IA DEL JEFE ---------------- */
function actualizarMuerteJefe(dt){
  if(!boss || !boss.muerto || boss.muerteFin) return;
  const e = boss;
  if(!e.sonidoMuerte){ e.sonidoMuerte = true; SFX.muerte(); }
  e.muerteT = (e.muerteT || 0) + dt;
  const t = e.muerteT;
  /* se tambalea, suelta chispas y cae de espaldas lentamente */
  const p = Math.min(1, t / 1.4);
  e.mesh.rotation.x = -(Math.PI/2) * (p*p);
  e.mesh.rotation.z = Math.sin(t*9) * 0.14 * (1-p);
  e.mesh.position.y = CFG.gY + 0.1 + Math.abs(Math.sin(t*11)) * 0.35 * (1-p) - p*1.3;
  /* estrobo de alto contraste mientras agoniza */
  if(Math.random() < dt*8) impactFrame(0.07, 0.8);
  if(Math.random() < dt*9){
    explosion(e.mesh.position.x + rand(-e.radio,e.radio)*0.7, CFG.gY + rand(1,5), e.mesh.position.z + rand(-e.radio,e.radio)*0.7,
      Math.random()<.5 ? 0xff8a3d : 0xffe27a, 8, 1.6);
    camShake = Math.max(camShake, 0.85); camKick = 7;
  }
  if(t >= 2.0){
    e.muerteFin = true;
    /* IMPACTO FINAL: congelado + flash brutal + última explosión */
    impactFrame(0.32, 1.35);
    slowmoIn(0.9);
    camShake = 1.5; camKick = 14;
    SFX.azote();
    explosion(e.mesh.position.x, CFG.gY + 1.5, e.mesh.position.z, 0xffe27a, 40, 2.4);
    explosion(e.mesh.position.x, CFG.gY + 3, e.mesh.position.z, 0xffffff, 22, 1.8);
    destello(e.mesh.position.x, CFG.gY + 2.5, e.mesh.position.z, 0xffffff, 16);
    ondaExpansiva(e.mesh.position.x, e.mesh.position.z, 14, 0, 'visual', 0xffe27a);
    escena.remove(e.mesh);
  }
}
function actualizarJefe(dt){
  if(!boss || boss.muerto) return;
  const e = boss;

  /* flash de daño */
  if(e.flash > 0){
    e.flash -= dt;
    if(e.matCuerpo && e.matCuerpo.emissive){
      e.matCuerpo.emissive.setHex(0xffffff);
      e.matCuerpo.emissiveIntensity = Math.max(0.8, e.flash*4);
    }
  } else if(e.matCuerpo && e.matCuerpo.emissive){
    e.matCuerpo.emissive.setHex(0x000000);
    e.matCuerpo.emissiveIntensity = 0;
  }

  /* fase 2 pasada al 50% de vida */
  if(!e.fase2 && e.hp < e.maxHp*0.5){
    e.fase2 = true;
    mostrarDialogo(TEXTOS.jefeFase2);
    slowmoIn(0.8);
    explosion(e.mesh.position.x, CFG.gY + 1, e.mesh.position.z, 0xff3d2e, 18, 1.4);
    destello(e.mesh.position.x, CFG.gY + 1.5, e.mesh.position.z, 0xff5ca8, 4);
  }

  if(e.fase === 'cae'){
    e.caeT += dt;
    const p = e.caeT / e.durCae;
    e.mesh.position.y = (CFG.gY + 22) - (CFG.gY + 22 - CFG.gY) * (p*p);
    if(e.caeT >= e.durCae){
      e.fase = 'activo';
      e.mesh.position.y = CFG.gY + 0.1;
      camShake = Math.max(camShake, 1.0);
      SFX.caida();
      explosion(e.mesh.position.x, CFG.gY + 0.6, e.mesh.position.z, 0xff8a3d, 20, 1.6);
      destello(e.mesh.position.x, CFG.gY + 1, e.mesh.position.z, 0xffe27a, 6);
      mostrarDialogo(TEXTOS.jefeIntro);
      UI.barrJefe.classList.remove('oculto');
      UI.barrJefeLleno.style.width = '100%';
      actualizarBarrJefe();
    }
    return;
  }

  /* en marcha */
  const dx = hero.pos.x - e.mesh.position.x;
  const dz = hero.pos.z - e.mesh.position.z;
  const dist = Math.hypot(dx, dz);
  if(dist > 0.001){
    const yawE = Math.atan2(hero.pos.x - e.mesh.position.x, hero.pos.z - e.mesh.position.z);
    e.mesh.rotation.set(0, yawE, 0);
  }

  /* escoge ataque según distancia */
  e.cdT -= dt;
  if(e.cdT <= 0 && e.atacando === undefined){
    e.atacando = elegirAtaqueJefe(e, dist);
    UI.barrJefeTxto.textContent = habilidadJefe(e.atacando);
  }
  if(e.atacando !== undefined) ejecutarAtaqueJefe(e, dt);
}

function habilidadJefe(a){
  const map = {
    slap: '👊 ¡PISOTÓN!', charge: '💨 ¡CARGA!', summon: '🌧 ¡CAEN PAPAS!',
    spit: '🔥 ¡ESCUPIDO!', rocks: '🪨 ¡LLUVIA DE ROCAS!', jump: '🌪 ¡SALTAZO!'
  };
  return map[a] || '';
}
function elegirAtaqueJefe(e, dist){
  const pool = ['slap','slap','charge','summon','jump'];
  if(e.fase2){ pool.push('spit','rocks','jump'); pool.push('slap','charge'); }
  if(dist < 6) pool.push('slap');
  else { pool.push('charge','spit'); if(dist > 12) pool.push('jump','jump'); }
  const r = Math.random();
  let picked = pool[Math.floor(Math.random()*pool.length)];
  if(e.fase2 && r < 0.3) picked = 'rocks';
  e.ataqueDur = { slap:0.9, charge:1.4, summon:1.6, spit:1.2, rocks:1.5, jump:1.9 }[picked];
  e.ataqueT = 0;
  return picked;
}
function ejecutarAtaqueJefe(e, dt){
  const x = e.mesh.position.x, z = e.mesh.position.z;
  const dx = hero.pos.x - x, dz = hero.pos.z - z;
  const dist = Math.hypot(dx, dz);
  const nx = dx/(dist||1), nz = dz/(dist||1);
  e.ataqueT += dt;

  if(e.atacando === 'slap'){
    if(e.ataqueT > 0.55 && !e.golpeHecho){
      e.golpeHecho = true;
      e.mesh.rotation.x = -0.5;
      if(dist < e.radio + 2){
        herirJugador(e.dmg, e.mesh.position);
      }
      explosion(e.mesh.position.x + nx*2, CFG.gY + 0.5, e.mesh.position.z + nz*2, 0x9c6b3f, 10, 1);
      soltarRoca(e.mesh.position.x + nx*3.5, e.mesh.position.z + nz*3.5);
      impactFrame(0.15, 1.05);
      camShake = Math.max(camShake, 0.8); camKick = 6;
      marcarTierra(e.mesh.position.x + nx*2.5, e.mesh.position.z + nz*2.5, 1.6, 0.6, 0xff5ca8);
    }
  }
  if(e.atacando === 'charge'){
    if(e.ataqueT < 0.6){
      e.mesh.position.x += nx * e.vel * 3.2 * dt;
      e.mesh.position.z += nz * e.vel * 3.2 * dt;
      if(distXZ(e.mesh.position, hero.pos) < e.radio + 1.6){
        herirJugador(e.dmg*1.4, e.mesh.position);
        impactFrame(0.18, 1.1);
        e.ataqueT = e.ataqueDur;
      }
    }
  }
  if(e.atacando === 'summon'){
    if(e.ataqueT > 0.8 && !e.hechoSummon){
      e.hechoSummon = true;
      for(let i = 0; i < 4; i++){
        const ang = Math.random()*Math.PI*2;
        const r = Math.random()*CFG.arenaR*0.7;
        spawnEnemigo(['skirmish','skirmish','shooter'][Math.floor(Math.random()*3)], Math.cos(ang)*r, Math.sin(ang)*r);
      }
      textoFlotante(x, CFG.gY + 2.5, z, '¡REFUERZOS!', '#ff8a3d');
    }
  }
  if(e.atacando === 'spit'){
    if(e.ataqueT > 0.5 && !e.hechoSpit){
      e.hechoSpit = true;
      for(let i = -2; i <= 2; i++){
        const a = Math.atan2(dz, dx) + i*0.35;
        dispararSemilla(e.mesh.position.x, CFG.gY + 1.2, e.mesh.position.z, Math.cos(a)*6, Math.sin(a)*6);
      }
      destello(x, CFG.gY + 1.5, z, 0xff8a3d, 2.4);
    }
  }
  if(e.atacando === 'jump'){
    /* ¡SALTAZO! se eleva, vuela hacia ti y se azota contra la azotea */
    if(!e.marcadoJump){
      e.marcadoJump = true;
      marcarTierra(hero.pos.x, hero.pos.z, 8, 1.2, 0xff3d2e);   /* telegraph de la zona */
    }
    if(e.ataqueT < 0.8){
      e.mesh.position.y = CFG.gY + 0.1 + (e.ataqueT/0.8) * 16;
      e.mesh.position.x += nx * e.vel * 1.6 * dt;
      e.mesh.position.z += nz * e.vel * 1.6 * dt;
    } else if(!e.golpeHecho){
      e.golpeHecho = true;
      e.mesh.position.y = CFG.gY + 0.1;
      impactFrame(0.18, 1.2);
      camShake = Math.max(camShake, 1.5); camKick = 12;
      marcarTierra(e.mesh.position.x, e.mesh.position.z, e.radio*1.4, 0.6, 0xff3d2e);
      explosion(e.mesh.position.x, CFG.gY + 0.6, e.mesh.position.z, 0x9c6b3f, 26, 2.2);
      ondaExpansiva(e.mesh.position.x, e.mesh.position.z, e.radio*2.2, e.dmg*1.6, 'jugador', 0xff8a3d);
      if(dist < e.radio*1.7) herirJugador(Math.round(e.dmg*1.6), e.mesh.position);
    }
  }
  if(e.atacando === 'rocks'){
    if(e.ataqueT > 0.5 && !e.hechoRocks){
      e.hechoRocks = true;
      for(let i = 0; i < 5; i++){
        const a = Math.random()*Math.PI*2;
        const r = Math.random()*e.radio*0.6;
        const rx = e.mesh.position.x + Math.cos(a)*r;
        const rz = e.mesh.position.z + Math.sin(a)*r;
        soltarRoca(rx, rz);
      }
      camShake = Math.max(camShake, 0.55);
    }
  }

  if(e.ataqueT >= e.ataqueDur){
    e.atacando = undefined;
    e.golpeHecho = false; e.hechoSummon = false; e.hechoSpit = false; e.hechoRocks = false;
    e.marcadoJump = false;
    e.mesh.position.y = CFG.gY + 0.1;
    e.cdT = rand(0.8, 1.5);
  }
}
function actualizarBarrJefe(){
  if(!boss) return;
  UI.barrJefeLleno.style.width = Math.max(0, boss.hp / boss.maxHp * 100).toFixed(1) + '%';
}
function limpiarBarrJefe(){
  UI.barrJefe.classList.add('oculto');
}
/* ---------------- OLEADAS Y DIÁLOGOS ---------------- */
let colaSpawn = [], statePrev = 'menu';
let seqVict = 0, seqT = 0, cartaDropT = -1;

function mostrarDialogo(lineas, alCerrar){
  dialogo = { lineas: lineas, idx: 0, alCerrar: alCerrar };
  UI.txtDialogo.textContent = lineas[0];
  UI.cajaDialogo.classList.remove('oculto');
  statePrev = state;
  state = 'dialogo';
}
function cerrarDialogo(){
  if(!dialogo) return;
  dialogo.idx++;
  if(dialogo.idx >= dialogo.lineas.length){
    UI.cajaDialogo.classList.add('oculto');
    const cb = dialogo.alCerrar;
    dialogo = null;
    state = statePrev;
    if(cb) cb();
  } else {
    UI.txtDialogo.textContent = dialogo.lineas[dialogo.idx];
  }
}

function iniciarJuego(){
  /* reset global */
  enemyList = []; shots = []; marks = [];
  iniciarMusica();
  UI.daos.innerHTML = '';
  boss = null; bossMuertoT = -1;
  waveIdx = -1; colaSpawn = [];
  ultCarga = 0; comboIdx = -1; inAtaque = false;
  dialogo = null; seqVict = 0; seqT = 0; cartaDropT = -1; cartaAbierta = false;
  if(cartaMesh){ escena.remove(cartaMesh); cartaMesh = null; }

  if(!hero){
    hero = new Jugador();
  } else {
    hero.hp = hero.maxHp;
    hero.pos.set(0, 0, 0);
  }

  UI.hud.classList.remove('oculto');
  UI.pantallaInicio.classList.add('oculto');
  UI.merte.classList.add('oculto');
  UI.pantallaCarta.classList.add('oculto');
  UI.barrJefe.classList.add('oculto');
  camYaw = 0; camPi = CFG.cam.pitch;
  hero.g.position.set(0, CFG.gY + 0.55, 0);

  mostrarDialogo(TEXTOS.intro, () => nextOleada());
}
function bannerOleada(idx){
  const o = TEXTOS.oleadas[idx];
  const el = UI.bannerOleada;
  el.innerHTML = o.titulo + '<small>' + o.sub + '</small>';
  bannerOleadaT = 2.6;
  SFX.oleada();
}
function nextOleada(){
  waveIdx++;
  if(waveIdx >= OLEADAS.length) return;
  state = 'pelear';
  bannerOleada(waveIdx);
  colaSpawn = [];
  const w = OLEADAS[waveIdx];
  const tipos = [];
  if(w.skirmish) for(let i=0;i<w.skirmish;i++) tipos.push('skirmish');
  if(w.shooter)  for(let i=0;i<w.shooter;i++)  tipos.push('shooter');
  if(w.bomb)     for(let i=0;i<w.bomb;i++)     tipos.push('bomb');
  let t = 0.4;
  for(const tp of tipos){
    colaSpawn.push({ tipo: tp, t: t });
    t += 0.4;
  }
}
function limpiarMuertos(){
  for(let i = enemyList.length-1; i >= 0; i--){
    if(enemyList[i].muerto){
      if(enemyList[i].mesh.position.y < CFG.gY - 3){
        escena.remove(enemyList[i].mesh);
        enemyList.splice(i,1);
      }
    }
  }
}
function vivosCuenta(){
  return enemyList.reduce((a,e) => a + (e.muerto ? 0 : 1), 0);
}
function actualizarOleada(dt){
  /* spawns de la cola */
  for(let i = colaSpawn.length-1; i >= 0; i--){
    colaSpawn[i].t -= dt;
    if(colaSpawn[i].t <= 0){
      const s = colaSpawn[i];
      spawnEnemigo(s.tipo);
      colaSpawn.splice(i,1);
    }
  }
  if(colaSpawn.length > 0) return;
  if(vivosCuenta() > 0) return;
  if(waveIdx < OLEADAS.length - 1){
    nextOleada();
  } else {
    iniciarBoss();
  }
}

/* jefe */
function iniciarBoss(){
  state = 'jefe';
  bannerOleada(4);
  UI.barrJefeTxto.textContent = '👑 PAPA GIGANTE';
  crearJefe();
}

/* victoria y carta */
function iniciarVictoria(){
  state = 'cinema';
  seqVict = 0; seqT = 0;
  /* reset completo del estado de combate: si el jefe murió a mitad de un
     swing, 'actualizarAtaque' ya no corre en 'cinema' y 'inAtaque' se
     quedaría en true bloqueando el movimiento para siempre */
  inAtaque = false; hitAplicado = false; comboIdx = -1;
  chgT = -1; escudoT = 0; dashT = 0; invuln = 0;
  if(hero){
    hero.brazoDer.rotation.x = 0; hero.brazoDer.rotation.z = 0; hero.brazoDer.rotation.y = 0;
    hero.brazoIzq.rotation.x = 0;
  }
  M.izq = false; M.arrIzq = false;
  /* destello celestial: el cielo anuncia la carta */
  destello(hero.pos.x, CFG.gY + 3, hero.pos.z, 0xffffff, 10);
  const pilar = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.0, 40, 16, 1, true),
    new THREE.MeshBasicMaterial({ color:0xffe9a8, transparent:true, opacity:.35, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, depthWrite:false }));
  pilar.position.set(hero.pos.x, CFG.gY + 20, hero.pos.z);
  escena.add(pilar);
  parts.push({ mesh:pilar, vel:V3(0,0,0), t:0, vida:2.2, sprite:false });
  mostrarDialogo(TEXTOS.jefeDerrotado, () => {
    seqVict = 1;
    mostrarDialogo(TEXTOS.cartaCaida, () => {
      seqVict = 2;
      crearCarta3D();
    });
  });
}
function crearCarta3D(){
  const g = new THREE.Group();
  const papel = new THREE.MeshStandardMaterial({ color:0xfff6ee, roughness:.6, metalness:.05 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.14, 3.2), papel);
  base.position.y = 0; g.add(base);
  const cubierta = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 3.2), papel);
  cubierta.position.y = 0.14; g.add(cubierta);
  const sello = new THREE.Mesh(new THREE.SphereGeometry(0.35, 14, 10), MAT.rosita);
  sello.position.set(0, 0.26, 1.1); g.add(sello);
  const brillo = new THREE.Sprite(new THREE.SpriteMaterial({ map:TEX_GLOW, color:0xff5ca8, transparent:true, opacity:.9, blending:THREE.AdditiveBlending, depthWrite:false }));
  brillo.scale.setScalar(3.4); brillo.position.y = 0.3; g.add(brillo);

  /* cae cerca del héroe, delante de él, dentro de la arena */
  const lx0 = hero ? hero.pos.x + Math.sin(hero.facing)*9 : 0;
  const lz0 = hero ? hero.pos.z + Math.cos(hero.facing)*9 : 0;
  const lr = Math.hypot(lx0, lz0);
  const lf = lr > CFG.arenaR - 4 ? (CFG.arenaR - 4)/lr : 1;
  g.position.set(lx0*lf, CFG.gY + 34, lz0*lf);
  g.rotation.z = 0.5;
  escena.add(g);
  cartaMesh = g;
  cartaDropT = 0;
  cartaAbierta = false;
  cartaHintT = 1.5;
  seqVict = 3;
  /* rayos que se encienden */
  for(let i = 0; i < 6; i++){
    const a = (i/6)*Math.PI*2;
    destello(Math.cos(a)*2.6, CFG.gY + 2, Math.sin(a)*2.6, 0xffe27a, 1.6);
  }
  textoFlotante(0, CFG.gY + 3.5, 0, '💌 ¡Una carta del cielo! 💌', '#ffe27a');
  SFX.carta();
}
function actualizarCartaDrop(dt){
  if(cartaDropT < 0 || !cartaMesh) return;
  cartaDropT += dt;
  const yBase = CFG.gY + 1.3;
  if(cartaMesh.position.y > yBase){
    /* descenso flotante LENTO con vaivén lateral suave (cinemática) */
    const y = CFG.gY + 34 - (cartaDropT * (34 - yBase) / 9.0);
    cartaMesh.position.y = Math.max(yBase, y);
    cartaMesh.rotation.z = Math.sin(cartaDropT*2)*0.25;
    cartaMesh.rotation.x = Math.sin(cartaDropT*1.7)*0.1;
    if(cartaMesh.position.y <= yBase && !cartaTocoSuelo){
      cartaTocoSuelo = true;
      /* IMPACT FRAME de aterrizaje: congelado + flash + explosión dorada */
      impactFrame(0.22, 1.25);
      slowmoIn(0.5);
      camShake = 1.2; camKick = 10;
      SFX.caida();
      explosion(cartaMesh.position.x, CFG.gY + 1.2, cartaMesh.position.z, 0xffe27a, 26, 1.8);
      destello(cartaMesh.position.x, CFG.gY + 2, cartaMesh.position.z, 0xffffff, 8);
      ondaExpansiva(cartaMesh.position.x, cartaMesh.position.z, 6, 0, 'visual', 0xffe27a);
    }
  } else {
    /* queda suspendida flotando, esperando al héroe */
    cartaMesh.position.y = yBase + Math.sin(tW*1.8)*0.18;
    cartaMesh.rotation.z = Math.sin(tW*1.4)*0.16;
    cartaMesh.rotation.x = Math.sin(tW*1.1)*0.08;
  }
}
function abrirCarta(){
  if(cartaAbierta || !cartaMesh) return;
  cartaAbierta = true;
  /* IMPACT FRAME de apertura: el flash más grande del juego */
  impactFrame(0.3, 1.4);
  slowmoIn(0.8);
  camShake = 1.4; camKick = 12;
  pararMusica();
  SFX.abrirCarta();
  const cx = cartaMesh.position.x, cz = cartaMesh.position.z;
  explosion(cx, CFG.gY + 1.2, cz, 0xffe27a, 30, 2.0);
  explosion(cx, CFG.gY + 2, cz, 0xff5ca8, 18, 1.4);
  destello(cx, CFG.gY + 2.5, cz, 0xffffff, 12);
  destello(cx, CFG.gY + 2.5, cz, 0xff5ca8, 8);
  ondaExpansiva(cx, cz, 9, 0, 'visual', 0xff5ca8);
  for(let i = 0; i < 12; i++){
    corazon(cx + rand(-2,2), CFG.gY + 2, cz + rand(-2,2));
    destello(cx + rand(-2.8,2.8), CFG.gY + 2.5, cz + rand(-2.8,2.8), Math.random()<0.5?0xff5ca8:0xffe27a, 1.6);
  }
  setTimeout(() => mostrarCartaHTML(), 1500);
}
function mostrarCartaHTML(){
  state = 'carta';
  UI.cartaPara.textContent = TEXTOS.carta.para;
  UI.cartaFecha.textContent = TEXTOS.carta.fecha;
  UI.cartaTxto.textContent = TEXTOS.carta.texto;
  UI.cartaFirma.textContent = TEXTOS.carta.firma;
  UI.pantallaCarta.classList.remove('oculto');
  /* bloquear que los eventos de scroll/mouse en la carta lleguen al canvas */
  const carta = UI.pantallaCarta;
  ['wheel','mousedown','mousemove','mouseup','touchstart','touchmove','touchend'].forEach(ev => {
    carta.addEventListener(ev, e => e.stopPropagation(), true);
  });
}
/* ---------------- LOOP PRINCIPAL ---------------- */
function actualizar(dt){
  tW += dt;

  /* nubes a la deriva */
  for(const n of nubesList){
    n.position.addScaledVector(n.userData.vel, dt);
    if(n.position.x >  260) n.position.x = -260;
    if(n.position.x < -260) n.position.x =  260;
    if(n.position.z >  260) n.position.z = -260;
    if(n.position.z < -260) n.position.z =  260;
  }
  /* el agujero negro gira lentamente en el cielo */
  if(agujeroNegro){
    agujeroNegro.userData.disc.rotation.z += dt * 0.35;
    agujeroNegro.userData.disc2.rotation.z -= dt * 0.55;
    agujeroNegro.rotation.y += dt * 0.02;
  }

  /* banner */
  if(bannerOleadaT > 0){
    bannerOleadaT -= dt;
    UI.bannerOleada.style.opacity = Math.min(1, bannerOleadaT);
  } else if(UI.bannerOleada.style.opacity !== '') {
    UI.bannerOleada.style.opacity = 0;
  }

  if(state === 'menu'){
    camYaw += dt * 0.1;
  }
  else if(state === 'dialogo'){
    /* nada: el mundo pausa, sólo partículas */
  }
  else if(state === 'pelear'){
    if(hero) hero.postura(dt);
    actualizarEnemigos(dt);
    actualizarOleada(dt);
    actualizarAtaque(dt);
  }
  else if(state === 'jefe'){
    if(hero) hero.postura(dt);
    actualizarEnemigos(dt);
    actualizarJefe(dt);
    actualizarAtaque(dt);
    if(boss && boss.muerto){
      actualizarMuerteJefe(dt);
      if(boss.muerteFin) iniciarVictoria();
    }
  }
  else if(state === 'cinema'){
    /* tras la carta caer, el héroe puede caminar hasta ella */
    if(hero && seqVict >= 3){
      inAtaque = false;   /* seguro extra: nunca bloquear el movimiento aquí */
      hero.postura(dt);
      cartaHintT -= dt;
      if(cartaHintT <= 0 && cartaMesh && !cartaAbierta){
        cartaHintT = 2.2;
        textoFlotante(cartaMesh.position.x, CFG.gY + 3.2, cartaMesh.position.z, '💌 ¡Acércate a la carta!', '#ffe27a');
      }
      if(cartaMesh && !cartaAbierta && distXZ(hero.pos, cartaMesh.position) < 3.4) abrirCarta();
    }
    actualizarCartaDrop(dt);
  }
  else if(state === 'carta'){
    actualizarCartaDrop(dt);
  }
  else if(state === 'muerte'){
    /* esperando reintento */
  }

  /* partículas, ondas, marcas, flotantes */
  actualizarPartes(dt);
  actualizarProyectiles(dt);
  actualizarMarcas(dt);
  actualizarFlotantes(dt);
  limpiarMuertos();
  actualizarHUD();
  actualizarCamara(dt);

  /* flash de daño en el renderer */
  if(hitFlashT > 0 && renderer){
    const k = hitFlashT * 2;
    escena.background = new THREE.Color().setHSL(0.98, 0.85, 0.28 + k*0.22);
  } else if(state !== 'cinema' && estadoBg){
    escena.background = estadoBg;
  }
}
let estadoBg = null;

function actualizarCamara(dt){
  const tg = hero ? hero.pos : V3(0, 0, 0);
  /* CINEMÁTICA: mientras la carta desciende del cielo, la cámara la contempla */
  if(state === 'cinema' && cartaMesh && !cartaTocoSuelo){
    const cx = cartaMesh.position.x, cyC = cartaMesh.position.y, czC = cartaMesh.position.z;
    camara.fov = CFG.cam.fov;
    camara.updateProjectionMatrix();
    camara.position.set(cx + 11, Math.min(cyC + 2, CFG.gY + 15), czC + 13);
    camara.lookAt(cx, cyC, czC);
    return;
  }
  const cy = camYaw, cp = camPi;
  const horiz = Math.cos(cp) * camDist;
  const vert  = Math.sin(cp) * camDist;
  const fwdX = Math.sin(cy), fwdZ = Math.cos(cy);
  const s = camShake*camShake*1.5;   /* curva: los golpes fuertes tiemblan mucho más */
  const ox = (Math.random()-0.5) * s;
  const oy = (Math.random()-0.5) * s;
  const oz = (Math.random()-0.5) * s;
  camara.fov = CFG.cam.fov + camKick;
  camara.updateProjectionMatrix();
  const apuntaY = CFG.gY + 1.2;
  let px = tg.x - fwdX*horiz + ox;
  let py = apuntaY + vert + 0.8 + oy;
  let pz = tg.z - fwdZ*horiz + oz;
  /* LA CÁMARA NUNCA ENTRA en el cuerpo de las papas ni del jefe:
     si queda dentro de alguno, la empujamos a la superficie de su esfera.
     (antes, meterse dentro del cuerpo gigante hundía los FPS y parecía un congelamiento) */
  const cuerpos = boss ? enemyList.concat([boss]) : enemyList;
  for(const e of cuerpos){
    if(!e.mesh || e.fase === 'cae') continue;
    const r = Math.max(1.2, (e.radioEn || e.radio || 1.5) * 0.92);
    const c = e.mesh.position;
    const cy2 = c.y + r*0.35;
    const dx2 = px - c.x, dy2 = py - cy2, dz2 = pz - c.z;
    const d2 = Math.sqrt(dx2*dx2 + dy2*dy2 + dz2*dz2);
    if(d2 < r && d2 > 0.0001){
      const k = r / d2;
      px = c.x + dx2*k; py = cy2 + dy2*k; pz = c.z + dz2*k;
    }
  }
  camara.position.set(px, py, pz);
  camara.lookAt(tg.x, apuntaY, tg.z);
  /* roll de cámara: rotación brusca extra en los impactos */
  if(camShake > 0.01) camara.rotation.z += (Math.random()-0.5) * camShake * 0.09;
  if(state === 'menu') camara.lookAt(0, CFG.gY + 1, 0);
}

function actualizarHUD(){
  if(!hero || state === 'menu') return;
  UI.hpLleno.style.width = (hero.hp / hero.maxHp * 100).toFixed(1) + '%';
  UI.hpText.textContent = '❤ ' + Math.ceil(hero.hp);
  UI.ultLleno.style.width = ultCarga.toFixed(0) + '%';
  UI.ultText.textContent = ultCarga >= 100 ? '✨ ¡ULTIMATE LISTA! [ESPACIO]' : '✨ ULTIMATE [' + Math.floor(ultCarga) + '%]';
  /* combo */
  /* aura azul de combo: degradado pulsante en los bordes + espada encendida */
  if(inAtaque || (comboIdx >= 0 && comboT < CFG.player.combWindow)){
    const n = UI.nucaCombo.querySelector('.n');
    const l = UI.nucaCombo.querySelector('.l');
    n.textContent = (comboIdx + 1) + 'x';
    l.textContent = comboIdx === 3 ? '¡PAPAZO FINAL!' : 'Combo';
    UI.nucaCombo.classList.remove('oculto');
    UI.auraCombo.style.opacity = Math.min(1, 0.35 + comboIdx*0.22);
    UI.auraCombo.classList.add('on');
    if(hero && hero.hojaMat) hero.hojaMat.emissiveIntensity = 0.9 + comboIdx*0.55;
  } else {
    UI.nucaCombo.classList.add('oculto');
    UI.auraCombo.style.opacity = 0;
    UI.auraCombo.classList.remove('on');
    if(hero && hero.hojaMat) hero.hojaMat.emissiveIntensity = 0.9;
  }
}

/* ---------------- BOTONES / EVENTOS UI ---------------- */
function vincularUI(){
  UI.pantallaInicio.addEventListener('click', iniciarJuego);
  UI.cajaDialogo.addEventListener('click', cerrarDialogo);
  UI.btnIntentar.addEventListener('click', () => location.reload());
  UI.btnOtraVez.addEventListener('click', () => location.reload());
  UI.btnFullscreen.addEventListener('click', () => {
    if(!document.fullscreenElement){
      if(document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    } else if(document.exitFullscreen){
      document.exitFullscreen();
    }
  });
}

/* ---------------- ARRANQUE ---------------- */
function iniciar(){
  reloj = new THREE.Clock();
  construirEscena();
  estadoBg = escena.background.clone();
  vincularUI();
  renderer.setAnimationLoop(animar);
}
function animar(){
  const raw = Math.min(reloj.getDelta(), 0.05);
  actualizarTimers(raw);
  const dt = raw * tScale;
  actualizar(dt);
  renderer.render(escena, camara);
}
iniciar();