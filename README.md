# 🥔 LEGEND OF LA PAPITA — Carta del 5to Mes 💜

Un mini-juego 3D de acción estilo *Zenless Zone Zero* para regalar en el
quinto mes. Controlas una **papita héroa con auriculares gamer, chaqueta
técnica y espada de luz** que pelea desde la **azotea de un rascacielos** en
una **ciudad futurista de día**, contra oleadas de papas malas, vence a la
**PAPA GIGANTE** y, al final, hace que **caiga una carta del cielo** con tu
mensaje.

## 🚀 Cómo jugarlo (sin internet, sin instalar nada)

1. **Doble clic sobre `index.html`**. Se abre solo en tu navegador.
2. Clic en **>>> Clic para jugar** y ¡a luchar!
3. Si se ve pequeño, pulsa **F11** para pantalla completa.

> No necesita servidor ni internet: Three.js ya está en la carpeta `lib/`.

## 🎮 Controles (estilo ZZZ)

| Control | Acción |
|---|---|
| **WASD** | Moverse (relativo a la cámara) |
| **Clic izquierdo** | Combo de espada (hasta 4 golpes, el 4º es un papazo) |
| **Mantén clic izq.** | Golpe pesado con **onda de choque** (área) |
| **Mayús (Shift)** | **Dash** con esquiva (esquiva perfecta → cámara lenta + contra) |
| **Clic der. (arrastra)** | Girar cámara / **vista desde arriba** / zoom con la rueda |
| **Ctrl** | Escudo / **Parry perfecto** (defiende justo en el golpe → cámara lenta) |
| **Espacio** | **ULTIMATE PAPA SUPREMA** (se llena la barra al golpear) |

## 📝 Personalizar los textos (tus diálogos y tu carta)

Abre **`js/textos.js`** con un bloc de notas o VS Code y edita:

- `introduccion` → el saludo inicial (cada línea = un clic).
- `oleadas[]` → los títulos de cada oleada.
- `jefeIntro`, `jefeFase2`, `jefeDerrotado` → todo el diálogo del jefe.
- **`carta.texto`** → **TU CARTA del 5to mes**. Escribe el mensaje con
  `\n` para los saltos de línea (cada `\n` = nueva línea).
- `carta.firma` → cómo firmas la carta.

Guárdalo y refresca la página. ✨

## ⚙️ Balance (si quieres más o menos difícil)

En `js/juego.js`, al inicio, la sección `CFG` y `ESTATS`:
- `CFG.player.hp` → vida del héroe.
- `CFG.player.combos` → daño de cada golpe.
- `CFG.player.ult` → daño del ultimátum.
- `ESTATS.*.hp / dmg / vel` → vida/daño/velocidad de cada enemigo.
- `ESTATS.boss.hp` → vida del jefe.

## 📂 Estructura

```
index.html        → página + interfaz (HUD, carta, menú)
js/textos.js       → TODOS los textos personalizables
js/juego.js        → motor 3D y lógica del juego
lib/three.min.js   → Three.js r128 (funciona sin internet)
```

Puedes añadir música creando un archivo `musica.mp3` junto a index.html y
descomentando la línea del `<audio>` en `index.html`. 💜