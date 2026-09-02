/* ============================================================
   LEGEND OF LA PAPITA — TEXTOS PERSONALIZABLES 💜
   ============================================================
   Aquí están TODOS los textos del juego (títulos, diálogos,
   la carta final...). Cambia lo que quieras y al recargar la
   página se verá actualizado. Busca los 【TODO】 para escribir
   tus propias palabras.
   ------------------------------------------------------------ */
const TEXTOS = {

  /* ---------------- PORTADA ---------------- */
  titulo: "LEGEND OF LA PAPITA",
  subtitulo: "La papita caballera y el quinto mes",
  portadaMini: "Una aventura heroica pa la papa",
  pistaPortada: "la papita te esta esperando",

  /* ---------------- INTRO (diálogo de inicio) ----------------
     1 línea = 1 clic. Escríbele un saludo bonito a tu novia. */
  intro: [
    "¡Hola, amor! Antes de nada... ¿tú sabes qué es lo más valiente del mundo?",
    "Pues una papita de apenas 10 centímetros con armadura de oro rosao y espada de luz.",
    "Hoy esa papita somos tu y yo, y vamos a papear papas",
    "Dicen que allá arriba vive una Papa Gigante... y que también una carta que segun el lore es del quinto mes equisde",
    "¿Me acompañas? Clic para empezar la aventura."
  ],

  /* ---------------- OLEADAS ----------------
     Se muestra en el banner antes de cada oleada. */
  oleadas: [
    { titulo: "OLEADA 1", sub: "Papas malas a la vista... ¡vamos espada en mano!" },
    { titulo: "OLEADA 2", sub: "¡Papas tiradoras! Esquiva sus semillas." },
    { titulo: "OLEADA 3", sub: "¡MRD! Papas bomba... ¡me van a papear :c !" },
    { titulo: "OLEADA 4", sub: "Se ponen serias... ¡usa tu ulti si hace falta!" },
    { titulo: "OLEADA FINAL", sub: "¡El cielo se oscurece... hsy uns pspota!" }
  ],

  /* ---------------- JEFE: PAPA GIGANTE ---------------- */
  jefeIntro: [
    "🐾 ¿Quién se atreve a llegar hasta aquí?",
    "🐾 Soy LA PAPOTA, guardiana de las nubes. Las papitas como tú no papean mi reino.",
    "🐾 Y tú... ¿tú también vienes a reclamar papitas? ¡JA! ¡Ni papas equisde!",
    "🥔 PAPITA: Ni papa equisde ¡Prepárate!"
  ],
  jefeFase2: [
    "🐾 ¡¿PERO QUÉ...?! ¡NADIE ME HA PAPEADO DE TANTO DAÑO!",
    "🐾 ¡TE VOY A PAPEAR, PAPITA CABALLERA!"
  ],
  jefeDerrotado: [
    "🐾 ...No puede ser... me has hecho... paprika... 🥔💥",
    "🥔 PAPITA: Lo siento, Papota.",
    "✨ De pronto, el cielo comienza a rasgarse..."
  ],

  /* ---------------- DIÁLOGO DE LA CARTA (tras ganar) ----------------
     Se escribe línea a línea mientras cae la carta. */
  cartaCaida: [
    "🌠 Una luz dorada atraviesa las nubes...",
    "💌 ¿Qué...? ¡¿Está... cayendo UNA CARTA?!",
    "💌 Es... es para MÍ. 📜 Hay una carta del quinto mes..."
  ],

  /* ---------------- LA CARTA (el regalo final) ----------------
     【TODO】 Escribe aquí tu mensaje para tu novia. */
  carta: {
    para: "PARA MI JULI MAPACHITA",
    fecha: "💌 Quinto mes 💌",
    texto: "wenash mapachitaaaa\ncomo estas mi juli hermosa\nwaos si lograste pasar por las papitas, sinceramente me queria inspirar en el zzz pero no me salio muy bien xdd\n\naun asi espero que disfrutes mucho de tu regalito y de la carta mi amorcito, e hecho este regalo incluso en los descansos de mi colegio libres xd\nsinceramente fue algo dificil hacerlo, pero espero lo estes disfrutando mapachita\ngracias por estos 5 meses de atencion, amor, ternura, juegos, risas y mas cositas, aaa y tambien por aguantarme XDDD\nbueño amor, feliz mez mi huroncita, la verdad me alegra haber pasado estos 5 meses y los que vienen contigo mapachita, ay dios mio julieth, no she, mira tu me gustas, te quiero, te amo, me fasinas, me encantas, me enamoras y mas cositas mi juli, y po shi amorcito, porcierto tenemos que usar con mas frecuencia la pagina de las cartas XDDD\ncomo dato curioso la cartita se me ocurrio en un sueño este regalo, que era la papita que te hice de regalo en el 2do mes aparecia en zzz y querias tirar por la papita, de hecho fue hace mas de una semana tuve ese sueño, y fua, se me ocurrio darte este regalito\n\nbueño amorcito\njoshua cartero se despide mi julicita\nbueña amorcitoooooo\nchau amorcitooooooooo\nbye mi mapachitaaaa\nteo muchito mi amorcitoooooo\nchauuuuuuu\nbye mi amorcitooooooo\nteo juliiiiiiiiiiii\n;3\n:]\n:p",
    firma: "Con todo mi amor y papitas"
  },

  /* ---------------- MUERTE ---------------- */
  muerteTitulo: "¡Te han papeado!",
  muerteSub: "Pero una papita valiente siempre resurge\ntoma tu espada y vuelve a luchar ",
  botonReintentar: "♻ INTENTAR DE NUEVO",

  /* ---------------- BOTONES ---------------- */
  btnJugarDeNuevo: "♻ Jugar de nuevo",
  btnPantallaCompleta: "⛶ Pantalla completa",

  /* ---------------- CONTROL HELP ---------------- */
  controles: [
    "<b>WASD</b>  Moverse (según cámara)",
    "<b>Clic der. (arrastra)</b>  Cámara / vista desde arriba",
    "<b>Clic izquierdo</b>  Combo",
    "<b>Mantén izq</b>  Golpe pesado (onda)",
    "<b>Mayús</b>  Dash con esquiva",
    "<b>Ctrl</b>  Escudo / Parry perfecto",
    "<b>Espacio</b>  ULTIMATE PAPA SUPREMA"
  ]
};