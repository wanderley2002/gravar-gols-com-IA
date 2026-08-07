require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const ffmpegPath = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { inicializarBanco } = require('./database');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobeStatic.path);

const JWT_SECRET = process.env.JWT_SECRET || 'segredo_wa_games';

function gerarToken(usuario) {
    return jwt.sign({ id: usuario.id, nome: usuario.nome, email: usuario.email }, JWT_SECRET, {
        expiresIn: '8h'
    });
}

function autenticarToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ mensagem: 'Token não fornecido.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.usuario = payload;
        next();
    } catch (err) {
        return res.status(401).json({ mensagem: 'Token inválido.' });
    }
}

const app = express();
const PORT = 3000;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// =========================
// ARQUIVOS ESTÁTICOS (HTML, CSS, JS)
// =========================
app.use(express.static(__dirname));

// =========================
// UPLOAD FOLDER
// =========================
const uploadsPath = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsPath)) {
    fs.mkdirSync(uploadsPath, { recursive: true });
}

app.use('/uploads', express.static(uploadsPath));

// =========================
// MULTER CONFIG
// =========================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsPath),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.mp4';
        cb(null, `bruto_${Date.now()}${ext}`);
    }
});

const upload = multer({ storage });

// =========================
// DB (INICIALIZAÇÃO SEGURA)
// =========================
let db;

async function startServer() {
    db = await inicializarBanco();
    console.log("🛠️ Banco de dados pronto!");

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 API rodando em http://localhost:${PORT}`);
    });
}

// =========================
// LOGIN
// =========================
app.post('/login', async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ mensagem: "Preencha email e senha." });
    }

    try {
        const usuario = await db.get(
            `SELECT * FROM usuarios WHERE email = ?`,
            [email]
        );

        if (!usuario) {
            return res.status(401).json({ mensagem: "Usuário não encontrado." });
        }

        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) {
            return res.status(401).json({ mensagem: "Senha incorreta." });
        }

        const token = gerarToken(usuario);

        return res.json({
            token,
            nome: usuario.nome,
            id: usuario.id
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ mensagem: "Erro no servidor." });
    }
});

// =========================
// CADASTRO
// =========================
app.post('/usuarios', async (req, res) => {
    const { nome, email, senha } = req.body;

    if (!nome || !email || !senha) {
        return res.status(400).json({ mensagem: "Preencha nome, email e senha." });
    }

    try {
        const id = `usr_${Date.now()}`;
        const dataRegistro = new Date().toISOString();
        const senhaHash = await bcrypt.hash(senha, 10);

        await db.run(
            `INSERT INTO usuarios (id, nome, email, senha, dataRegistro)
             VALUES (?, ?, ?, ?, ?)`,
            [id, nome, email, senhaHash, dataRegistro]
        );

        return res.json({ mensagem: "Usuário criado com sucesso!" });

    } catch (err) {
        console.error(err);
        return res.status(400).json({ mensagem: "Erro ao cadastrar (email pode já existir)." });
    }
});

// =========================
// UPLOAD + IA + FFmpeg
// =========================
app.post('/enviar-gol', autenticarToken, upload.single('video'), async (req, res) => {

    if (!req.file) {
        return res.status(400).json({ mensagem: "Nenhum vídeo enviado." });
    }

    const caminhoVideoOriginal = req.file.path;
    const usuarioId = req.usuario?.id;

    try {
        console.log("🎬 Vídeo recebido... enviando para IA", "usuarioId=", usuarioId);

        const form = new FormData();
        form.append('video', fs.createReadStream(caminhoVideoOriginal));

        let segundoDoGol = null;
        let jogador = "Artilheiro WA";
        let golsIA = [];

        try {
            const respostaIA = await axios.post(
                'http://127.0.0.1:5000/analisar-video',
                form,
                {
                    headers: form.getHeaders(),
                    maxBodyLength: Infinity,
                    timeout: 120000 // 2 min
                }
            );

            golsIA = respostaIA.data.gols || [];

            if (golsIA.length > 0) {
                segundoDoGol = golsIA[0].segundo_gol;
                jogador = golsIA[0].nome || "Artilheiro WA";
            }

            console.log("🤖 IA respondeu:", golsIA.length, "gol(s)");

        } catch (err) {
            console.log("⚠️ IA offline ou timeout:", err.message);
        }

        // =========================
        // DEFINIÇÃO DO CORTE
        // =========================
        let duracaoReplay = 14;
        let inicioCorte = 0;

        const getDuration = () =>
            new Promise((resolve) => {
                ffmpeg.ffprobe(caminhoVideoOriginal, (err, data) => {
                    if (err || !data?.format?.duration) return resolve(30);
                    resolve(data.format.duration);
                });
            });

        const duracao = await getDuration();

        if (segundoDoGol !== null && segundoDoGol > 0) {
            // Se o vídeo é curto (replay de gol), corta do início até o gol + 3s
            if (duracao <= 30) {
                inicioCorte = 0;
                duracaoReplay = Math.min(duracao, segundoDoGol + 3);
            } else {
                // Se é um vídeo longo (jogo inteiro), volta 11s antes do gol
                inicioCorte = Math.max(0, segundoDoGol - 11);
            }
        } else {
            inicioCorte = Math.max(0, duracao - duracaoReplay);
        }

        const nomeFinal = `replay_${Date.now()}.mp4`;
        const caminhoFinal = path.join(uploadsPath, nomeFinal);

        console.log("✂️ Cortando vídeo...");

        await new Promise((resolve, reject) => {
            ffmpeg(caminhoVideoOriginal)
                .setStartTime(inicioCorte)
                .setDuration(duracaoReplay)
                .output(caminhoFinal)
                .videoCodec('libx264')
                .audioCodec('aac')
                .on('end', resolve)
                .on('error', reject)
                .run();
        });

        const urlVideo = `/uploads/${nomeFinal}`.replace(/\\/g, '/');

        // =========================
        // SALVAR RANKING
        // =========================
        if (usuarioId) {
            try {
                const data = new Date().toLocaleDateString('pt-BR');

                await db.run(
                    `INSERT INTO ranking (usuario_id, nome_jogador, video_url, data_gol)
                     VALUES (?, ?, ?, ?)`,
                    [usuarioId, jogador, urlVideo, data]
                );

            } catch (err) {
                console.log("⚠️ erro ranking:", err.message);
            }
        }

        // limpa original
        fs.unlinkSync(caminhoVideoOriginal);

        console.log("✅ Processado com sucesso!");

        return res.json({
            urlVideo,
            jogador
        });

    } catch (error) {
        console.error("Erro geral:", error);

        if (fs.existsSync(caminhoVideoOriginal)) {
            fs.unlinkSync(caminhoVideoOriginal);
        }

        return res.status(500).json({
            mensagem: "Erro ao processar vídeo."
        });
    }
});

// =========================
// RANKING
// =========================
app.get('/ranking', autenticarToken, async (req, res) => {
    try {
        const rows = await db.all(`
            SELECT nome_jogador, COUNT(*) as gols
            FROM ranking
            WHERE nome_jogador IS NOT NULL
            GROUP BY nome_jogador
            ORDER BY gols DESC
        `);

        res.json(rows);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =========================
// START
// =========================
startServer();