# W.A GAMES — IA de Detección de Goles

Sistema que detecta goles automáticamente en vídeos de **eFootball** y genera
replays automáticos. Consta de dos servicios que trabajan juntos:

| Servicio        | Tecnología            | Puerto | Carpeta     |
|-----------------|-----------------------|--------|-------------|
| **Servidor web**| Node.js + Express    | 3000   | raíz        |
| **IA de goles** | Python + Flask + OCR | 5000   | `projeto/`  |

---

## Arquitectura

```
Navegador (index.html / dashboard.html)
        │  HTTP
        ▼
server.js (Node + Express) ──► banco.db (SQLite)
        │                         ├─ ranking
        │                         └─ usuarios (JWT)
        │  vídeo (multipart)
        ▼
api.py (Flask) ──► processador.py ──► detectores.py (EasyOCR)
                     └─ corta clips con FFmpeg ──► projeto/clips/
```

**Flujo completo al subir un vídeo:**
1. El usuario graba su pantalla o sube un vídeo desde `/dashboard.html`.
2. `server.js` recibe el vídeo con **multer** y lo reenvía a la IA.
3. `api.py` guarda el vídeo temporalmente y lo analiza con `ProcessadorVideo`:
   - detecta el **placar** del eFootball con EasyOCR (esquina superior central),
   - cuando el marcador **sube** (un equipo marca gol), lo confirma con un
     histórico de lecturas para evitar falsos positivos del OCR,
   - genera un **replay** de ~8 s antes y ~5 s después del gol usando FFmpeg.
4. `server.js` corta el replay final (H.264 + AAC) y lo guarda en `uploads/`.
5. Se registra el gol en el **ranking** (por usuario logado).
6. El navegador muestra el replay y actualiza el ranking.

---

## Requisitos

- **Node.js ≥ 18** (probado con v25)
- **Python 3.10–3.13** con el entorno virtual `.venv`
- FFmpeg: ya viene incluido vía `ffmpeg-static` (Node) y en la carpeta `ffmpeg/`

## Puesta en marcha

### 1) Instalar dependencias Node.js

```bash
npm install
```

### 2) Entorno Python (una sola vez)

```bash
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

### 3) Configurar secretos

```bash
copy .env.example .env
```

`JWT_SECRET` debe ser un valor largo y aleatorio:

```bash
node -pe "require('crypto').randomBytes(48).toString('base64')"
```

> ⚠️ `.env` está en `.gitignore` y **no** debe subirse al repositorio.

### 4) Arrancar

Doble clic en **`iniciar.bat`** (abre la API de IA y el servidor Node)
o en dos terminales:

```bash
# Terminal 1 — IA
cd projeto
..\.venv\Scripts\python api.py

# Terminal 2 — servidor web
node server.js
```

Abrir **http://localhost:3000** en el navegador.

---

## API

### Node.js (puerto 3000)

| Método | Ruta            | Autenticación | Descripción                          |
|--------|-----------------|---------------|--------------------------------------|
| POST   | `/usuarios`     | —             | Registrar usuario `{nome, email, senha}` |
| POST   | `/login`        | —             | Login, devuelve `{token, nome, id}`  |
| POST   | `/enviar-gol`   | Bearer JWT    | Subir vídeo → procesar → responder `{urlVideo, jogador, gols}` |
| GET    | `/ranking`      | Bearer JWT    | Ranking de goles por jugador         |
| GET    | `/health`       | —             | Estado del servidor                  |

### Python / IA (puerto 5000)

| Método | Ruta                | Descripción                              |
|--------|---------------------|------------------------------------------|
| POST   | `/analisar-video`   | Multipart `video` → `{sucesso, gols}`    |
| GET    | `/health`           | Estado de la IA                          |

Cada gol devuelto tiene:
```json
{
  "segundo_gol": 1521.3,
  "clip": "gol_45689.mp4",
  "nome": null
}
```

---

## Estructura del proyecto

```
dados-cliente/
├── server.js            # Servidor web + API + corte de replay (FFmpeg + Node)
├── database.js          # Inicialización de SQLite (banco.db)
├── index.html           # Página de login / registro
├── dashboard.html       # Subir vídeo, ver replay y ranking
├── projeto/             # IA en Python
│   ├── api.py           # Endpoint Flask
│   ├── processador.py   # Orquestador: analiza el vídeo y corta replays
│   ├── detectores.py    # Detector de placar con EasyOCR
│   ├── clips/           # Replays generados por la IA
│   └── uploads/         # Vídeos temporales de la IA (auto-limpieza)
├── uploads/             # Replays finales servidos al navegador
├── .env / .env.example  # Configuración (secreto JWT, puertos)
├── requirements.txt     # Dependencias Python
└── iniciar.bat          # Arranque de un solo clic (IA + servidor)
```

---

## Limitaciones actuales

- **Detección por OCR del placar**: funciona bien cuando el placar es legible y
  está en la franja central superior. Fallos de OCR pueden producir falsos
  positivos/negativos; la confirmación por histórico ayuda a reducirlos.
- El **nombre del jugador** que se muestra en el ranking es el del usuario
  logado (la IA no identifica quién marcó el gol).
- El visionado del vídeo grabado por pantalla se hace por *chunks* en memoria:
  para sesiones muy largas considerar subir el archivo directamente.