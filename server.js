/**
 * ============================================================
 * W.A GAMES — SERVIDOR PRINCIPAL (Node.js + Express)
 * ------------------------------------------------------------
 * Processo completo ao subir um video:
 *
 * 1. Usuario sobe um video em /dashboard.html
 * 2. server.js envia o video para a IA (Python/Flask)
 * 3. A IA devolve um job_id
 * 4. server.js consulta o status desse job até terminar
 * 5. A IA devolve os gols encontrados
 * 6. Para cada gol, o FFmpeg corta um clipe
 * 7. Os gols podem ser salvos no ranking
 * ============================================================
 */


/* ============================================================
   1. IMPORTANDO OS PACOTES
   ============================================================ */

// dotenv lê o arquivo .env e coloca suas configurações
// dentro de process.env.
//
// Lembre:
// dotenv = configurações/senhas fora do código.
require('dotenv').config();


// Express cria nosso servidor e nossas APIs.
//
// Lembre:
// express = servidor/API.
const express = require('express');


// CORS permite que frontend e backend se comuniquem
// mesmo quando estão em origens/portas diferentes.
//
// Lembre:
// cors = comunicação.
const cors = require('cors');


// Multer recebe arquivos enviados para o servidor.
//
// Exemplo:
// usuário envia um vídeo -> multer recebe o vídeo.
//
// Lembre:
// multer = upload.
const multer = require('multer');


// Path trabalha com caminhos de arquivos e pastas.
//
// Lembre:
// path = caminho.
const path = require('path');


// FS significa File System.
//
// Permite criar, ler, copiar, excluir e verificar
// arquivos e pastas.
//
// Lembre:
// fs = mexer em arquivos.
const fs = require('fs');


// Crypto fornece ferramentas de segurança,
// hashes e geração de valores aleatórios seguros.
//
// Neste projeto usamos para gerar IDs únicos.
//
// Lembre:
// crypto = segurança.
const crypto = require('crypto');


// Axios faz requisições HTTP para outros servidores/APIs.
//
// Neste projeto usamos para conversar com a IA Python.
//
// Lembre:
// axios = conversa com outra API.
const axios = require('axios');


// FormData prepara dados e arquivos para serem enviados
// em uma requisição HTTP.
//
// Neste projeto usamos para enviar o vídeo para a IA.
//
// Lembre:
// FormData = preparar arquivo/dados para envio.
const FormData = require('form-data');


// ============================================================
// RESUMO DOS PACOTES
// ============================================================
//
// express  -> servidor/API
// cors     -> comunicação entre origens
// multer   -> upload de arquivos
// path     -> caminhos
// fs       -> arquivos/pastas
// crypto   -> segurança/IDs
// axios    -> requisições HTTP
// FormData -> envio de arquivos/dados
// ============================================================



/* ============================================================
   2. PACOTES RELACIONADOS AO VIDEO
   ============================================================ */

// fluent-ffmpeg permite controlar o FFmpeg através do Node.js.
//
// Usaremos para cortar os vídeos dos gols.
const ffmpeg = require('fluent-ffmpeg');


// ffmpeg-static fornece o executável do FFmpeg.
//
// Assim o projeto consegue encontrar o FFmpeg.
const ffmpegStatic = require('ffmpeg-static');


// ffprobe-static fornece o FFprobe.
//
// FFprobe serve para descobrir informações do vídeo,
// como duração, formato, FPS etc.
const ffprobeStatic = require('ffprobe-static');



/* ============================================================
   3. SEGURANÇA E LOGIN
   ============================================================ */

// bcryptjs serve para trabalhar com senhas.
//
// Ele transforma a senha em um hash seguro e também
// permite comparar a senha digitada com o hash salvo.
const bcrypt = require('bcryptjs');


// jsonwebtoken cria e verifica tokens JWT.
//
// Usaremos o token para saber quem está logado.
const jwt = require('jsonwebtoken');



/* ============================================================
   4. BANCO DE DADOS
   ============================================================ */

// Importamos a função que inicializa o banco.
//
// O ./ significa:
// "procure o arquivo nesta mesma pasta".
const { inicializarBanco } = require('./database');



/* ============================================================
   5. CONFIGURAÇÕES DO SERVIDOR
   ============================================================ */

// __dirname representa a pasta onde este arquivo
// server.js está localizado.
const RAIZ = __dirname;


// Pega a porta do arquivo .env.
//
// Exemplo:
//
// PORT=3000
//
// Se PORT não existir, usamos 3000.
const PORT = Number(process.env.PORT) || 3000;


// Pega a chave secreta usada pelo JWT.
//
// Essa chave deve estar no .env.
const JWT_SECRET = process.env.JWT_SECRET;


// URL onde a IA Python está rodando.
//
// Se IA_URL não estiver no .env,
// usamos http://127.0.0.1:5000.
//
// replace remove "/" do final caso exista.
const IA_URL = (
  process.env.IA_URL ||
  'http://127.0.0.1:5000'
).replace(/\/+$/, '');


// Tempo máximo que o Node espera a IA terminar.
//
// 30 * 60 * 1000 = 30 minutos em milissegundos.
const IA_TEMPO_MAXIMO_MS =
  Number(process.env.IA_TEMPO_MAXIMO_MS) ||
  30 * 60 * 1000;


// Tempo entre cada consulta do status da IA.
//
// 5000 milissegundos = 5 segundos.
const IA_POLL_INTERVAL_MS =
  Number(process.env.IA_POLL_INTERVAL_MS) ||
  5000;


// Caminho onde os vídeos serão armazenados.
const uploadsPath = path.join(
  RAIZ,
  'uploads'
);


// Tamanho máximo permitido para o vídeo.
//
// 3 GB.
const TAMANHO_MAX_VIDEO =
  Number(process.env.MAX_VIDEO_BYTES) ||
  3 * 1024 * 1024 * 1024;



/* ============================================================
   6. VERIFICAR JWT_SECRET
   ============================================================ */

// Se não existir JWT_SECRET,
// não faz sentido iniciar o servidor,
// porque o sistema não conseguirá trabalhar corretamente
// com os tokens de login.
if (!JWT_SECRET) {

  console.error(
    'Falta JWT_SECRET no arquivo .env'
  );

  console.error(
    'Copie .env.example para .env e coloque um valor seguro.'
  );

  // Encerra o programa.
  process.exit(1);
}



/* ============================================================
   7. CONFIGURAR FFmpeg E FFprobe
   ============================================================ */

// Diz ao fluent-ffmpeg onde está o executável do FFmpeg.
ffmpeg.setFfmpegPath(ffmpegStatic);


// Diz ao fluent-ffmpeg onde está o FFprobe.
ffmpeg.setFfprobePath(ffprobeStatic.path);



/* ============================================================
   8. GERAR TOKEN JWT
   ============================================================ */

function gerarToken(usuario) {

  // jwt.sign() cria um token.
  //
  // Dentro dele colocamos algumas informações
  // que queremos identificar posteriormente.
  return jwt.sign(

    {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email
    },

    // Chave secreta usada para assinar o token.
    JWT_SECRET,

    // O token expira depois de 8 horas.
    {
      expiresIn: '8h'
    }
  );
}



/* ============================================================
   9. AUTENTICAR TOKEN
   ============================================================ */

function autenticarToken(req, res, next) {

  // Pega o cabeçalho Authorization enviado pelo cliente.
  //
  // Normalmente vem assim:
  //
  // Authorization: Bearer TOKEN
  const authHeader = req.headers.authorization;


  // Se não existe o cabeçalho ou ele não começa com Bearer,
  // significa que o usuário não enviou um token válido.
  if (
    !authHeader ||
    !authHeader.startsWith('Bearer ')
  ) {

    return res.status(401).json({
      mensagem: 'Token nao fornecido.'
    });
  }


  // Divide a string:
  //
  // "Bearer abc123"
  //
  // vira:
  //
  // ["Bearer", "abc123"]
  //
  // [1] pega somente o token.
  const token = authHeader.split(' ')[1];


  try {

    // Verifica se o token é válido.
    //
    // Se for válido, os dados do usuário são colocados
    // dentro de req.usuario.
    req.usuario = jwt.verify(
      token,
      JWT_SECRET
    );


    // next() manda a requisição continuar.
    next();

  } catch (err) {

    // Se o token for inválido ou expirado,
    // devolvemos erro 401.
    return res.status(401).json({
      mensagem: 'Token invalido.'
    });
  }
}



/* ============================================================
   10. REGEX PARA VALIDAR EMAIL
   ============================================================ */

// Regex é uma forma de verificar se um texto
// segue determinado padrão.
//
// Aqui usamos para verificar se parece ser um email.
const EMAIL_REGEX =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;



/* ============================================================
   11. VALIDAR CADASTRO
   ============================================================ */

function validarRegistro(
  nome,
  email,
  senha
) {

  // Verifica se algum campo está vazio.
  if (!nome || !email || !senha) {
    return 'Preencha nome, email e senha.';
  }


  // Verifica se o nome possui pelo menos 2 caracteres.
  if (nome.trim().length < 2) {
    return 'O nome deve ter pelo menos 2 caracteres.';
  }


  // Testa o email usando nossa Regex.
  if (!EMAIL_REGEX.test(email)) {
    return 'Email invalido.';
  }


  // Senha precisa ter pelo menos 6 caracteres.
  if (senha.length < 6) {
    return 'A senha deve ter pelo menos 6 caracteres.';
  }


  // null significa:
  //
  // "não existe erro".
  return null;
}



/* ============================================================
   12. DESCOBRIR DURAÇÃO DO VIDEO
   ============================================================ */

function obtenerDuracion(caminhoVideo) {

  // Promise permite trabalhar com uma operação
  // que vai terminar no futuro.
  return new Promise((resolve) => {

    // ffprobe analisa as informações do vídeo.
    ffmpeg.ffprobe(
      caminhoVideo,
      (err, data) => {

        // Se der erro ou não encontrar duração,
        // usamos 30 segundos como valor padrão.
        if (
          err ||
          !data?.format?.duration
        ) {
          return resolve(30);
        }


        // Retorna a duração real do vídeo.
        resolve(data.format.duration);
      }
    );
  });
}



/* ============================================================
   13. ESPERAR UM TEMPO
   ============================================================ */

function aguardar(ms) {

  // setTimeout espera determinada quantidade
  // de milissegundos.
  return new Promise((resolve) => {

    setTimeout(resolve, ms);

  });
}



/* ============================================================
   14. ESPERAR A IA TERMINAR
   ============================================================ */

async function aguardarResultadoIA(jobId) {

  // Guarda o momento em que começamos a esperar.
  const inicio = Date.now();


  // Enquanto não ultrapassar o tempo máximo...
  while (
    Date.now() - inicio <
    IA_TEMPO_MAXIMO_MS
  ) {

    try {

      // Consulta a IA perguntando:
      //
      // "Como está o job?"
      //
      // Exemplo:
      //
      // GET /status/abc123
      const resposta = await axios.get(
        `${IA_URL}/status/${jobId}`,
        {
          timeout: 15000
        }
      );


      // Guarda os dados enviados pela IA.
      const trabalho = resposta.data;


      // Se a IA terminou...
      if (
        trabalho.status === 'concluido'
      ) {

        // Retorna os gols encontrados.
        return trabalho.gols || [];
      }


      // Se a IA informou erro...
      if (
        trabalho.status === 'erro'
      ) {

        console.log(
          'IA retornou erro:',
          trabalho.erro
        );

        return [];
      }

    } catch (err) {

      // Se a consulta falhar,
      // mostramos o erro mas continuamos tentando.
      console.log(
        'Erro ao consultar status da IA:',
        err.message
      );
    }


    // Espera 5 segundos antes de consultar novamente.
    await aguardar(
      IA_POLL_INTERVAL_MS
    );
  }


  // Se chegou aqui, passou do tempo máximo.
  console.log(
    'Tempo maximo de espera pela IA atingido.'
  );

  return [];
}



/* ============================================================
   15. CORTAR CLIPE DO GOL
   ============================================================ */

async function cortarClipe(
  caminhoVideoOriginal,
  inicioCorte,
  duracaoClipe,
  sufixo
) {

  // Cria um nome único para o novo vídeo.
  const nomeFinal =
    `replay_${Date.now()}_${sufixo}.mp4`;


  // Caminho completo onde o novo vídeo será salvo.
  const caminhoFinal =
    path.join(
      uploadsPath,
      nomeFinal
    );


  // O FFmpeg trabalha de forma assíncrona,
  // então usamos Promise.
  await new Promise((resolve, reject) => {

    ffmpeg(caminhoVideoOriginal)

      // Define onde o corte começa.
      .setStartTime(inicioCorte)

      // Define a duração do corte.
      .setDuration(duracaoClipe)

      // Define o arquivo de saída.
      .output(caminhoFinal)

      // Codec de vídeo.
      .videoCodec('libx264')

      // Codec de áudio.
      .audioCodec('aac')

      // Quando terminar, resolve a Promise.
      .on('end', resolve)

      // Se der erro, rejeita a Promise.
      .on('error', reject)

      // Executa o FFmpeg.
      .run();
  });


  // Retorna a URL que o navegador poderá acessar.
  return `/uploads/${nomeFinal}`;
}



/* ============================================================
   15b. COMBINAR TODOS OS GOLS EM UM UNICO VIDEO LONGO
   ============================================================ */

// Junta todos os clipes de gols em um único vídeo,
// criando um "resumo de lances" (highlights).
//
// Exemplo:
//
// gol_1.mp4 + gol_2.mp4 + gol_3.mp4
//   ->
// highlights_xxx....mp4  (um vídeo só com tudo)
async function concatenarClips(
  caminhosClipes
) {

  // Cria um nome único para o vídeo final.
  const nomeFinal =
    `highlights_${Date.now()}.mp4`;

  // Caminho completo onde o vídeo final será salvo.
  const caminhoFinal =
    path.join(
      uploadsPath,
      nomeFinal
    );

  // Arquivo de lista que o FFmpeg usa no modo concat.
  const caminhoLista =
    path.join(
      uploadsPath,
      `lista_${Date.now()}.txt`
    );

  // Monta as linhas com o caminho de cada clipe.
  //
  // O FFmpeg precisa da barra normal (/) mesmo
  // no Windows, por isso trocamos as barras.
  const linhas =
    caminhosClipes
      .map(
        (caminho) =>
          `file '${caminho.replace(/\\/g, '/')}'`
      )
      .join('\n');

  // Salva a lista em um arquivo temporário.
  fs.writeFileSync(
    caminhoLista,
    linhas
  );

  try {

    // Usa o modo concat do FFmpeg
    // para juntar os vídeos em sequência.
    await new Promise((resolve, reject) => {

      ffmpeg()
        .input(caminhoLista, { f: 'concat', safe: 0 })
        .output(caminhoFinal)
        .videoCodec('libx264')
        .audioCodec('aac')
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

  } finally {

    // Apaga o arquivo de lista temporário.
    fs.unlinkSync(caminhoLista);
  }


  // Retorna a URL pública do vídeo combinado.
  return `/uploads/${nomeFinal}`;
}



/* ============================================================
   16. CRIAR A APLICAÇÃO EXPRESS
   ============================================================ */

// Aqui criamos nossa aplicação.
const app = express();



/* ============================================================
   17. CONFIGURAR CORS
   ============================================================ */

app.use(cors({

  // Permite requisições de qualquer origem.
  origin: '*',

  // Métodos HTTP permitidos.
  methods: [
    'GET',
    'POST',
    'PUT',
    'DELETE'
  ],

  // Headers que podem ser enviados.
  allowedHeaders: [
    'Content-Type',
    'Authorization'
  ]
}));



/* ============================================================
   18. PERMITIR JSON
   ============================================================ */

// Permite que o Express receba JSON.
//
// Exemplo:
//
// {
//   "nome": "Wander",
//   "email": "teste@email.com"
// }
app.use(
  express.json({
    limit: '1mb'
  })
);



/* ============================================================
   19. HEADERS DE SEGURANÇA
   ============================================================ */

app.use(
  (req, res, next) => {

    // Impede alguns tipos de interpretação incorreta
    // do conteúdo.
    res.setHeader(
      'X-Content-Type-Options',
      'nosniff'
    );


    // Controla se a página pode ser colocada
    // dentro de um iframe.
    res.setHeader(
      'X-Frame-Options',
      'SAMEORIGIN'
    );


    // Evita enviar informações da URL anterior
    // em algumas requisições.
    res.setHeader(
      'Referrer-Policy',
      'no-referrer'
    );


    // Continua para o próximo middleware.
    next();
  }
);



/* ============================================================
   20. ARQUIVOS PUBLICOS
   ============================================================ */

const ARCHIVOS_PUBLICOS = [
  'index.html',
  'dashboard.html'
];


// Quando alguém acessar:
//
// /
//
// enviamos index.html.
app.get(
  '/',
  (req, res) =>
    res.sendFile(
      path.join(
        RAIZ,
        'index.html'
      )
    )
);


// Para cada arquivo da lista...
ARCHIVOS_PUBLICOS.forEach(
  (archivo) => {

    // Criamos uma rota para ele.
    app.get(
      `/${archivo}`,
      (req, res) =>
        res.sendFile(
          path.join(
            RAIZ,
            archivo
          )
        )
    );
  }
);



/* ============================================================
   21. CRIAR PASTA UPLOADS
   ============================================================ */

// Verifica se a pasta uploads existe.
if (
  !fs.existsSync(uploadsPath)
) {

  // Se não existir, cria.
  //
  // recursive: true permite criar também
  // pastas intermediárias.
  fs.mkdirSync(
    uploadsPath,
    {
      recursive: true
    }
  );
}



/* ============================================================
   22. SERVIR VIDEOS
   ============================================================ */

// Permite acessar os arquivos da pasta uploads
// através da URL:
//
// /uploads/nome-do-video.mp4
app.use(
  '/uploads',
  express.static(uploadsPath)
);



/* ============================================================
   23. EXTENSÕES DE VIDEO PERMITIDAS
   ============================================================ */

const EXTENSIONS_VIDEO = [
  '.mp4',
  '.webm',
  '.mov',
  '.avi',
  '.mkv'
];



/* ============================================================
   24. CONFIGURAR COMO O MULTER SALVA OS VIDEOS
   ============================================================ */

const storage = multer.diskStorage({

  // Define onde o arquivo será salvo.
  destination: (
    req,
    file,
    cb
  ) => {

    cb(
      null,
      uploadsPath
    );
  },


  // Define o nome do arquivo.
  filename: (
    req,
    file,
    cb
  ) => {

    // Pega a extensão original.
    const ext =
      path
        .extname(file.originalname)
        .toLowerCase() ||
      '.mp4';


    // Cria um nome único usando Date.now().
    cb(
      null,
      `bruto_${Date.now()}${ext}`
    );
  }
});



/* ============================================================
   25. CONFIGURAR UPLOAD
   ============================================================ */

const upload = multer({

  // Usa nossa configuração de armazenamento.
  storage,

  // Limita o tamanho do arquivo.
  limits: {
    fileSize: TAMANHO_MAX_VIDEO
  },


  // Filtra quais arquivos podem ser enviados.
  fileFilter: (
    req,
    file,
    cb
  ) => {

    // Pega extensão.
    const ext =
      path
        .extname(file.originalname)
        .toLowerCase();


    // Verifica se o MIME type começa com video/.
    const tipoValido =
      (file.mimetype || '')
        .startsWith('video/');


    // Aceita se a extensão estiver na lista
    // OU se o MIME type for de vídeo.
    cb(
      null,
      EXTENSIONS_VIDEO.includes(ext) ||
      tipoValido
    );
  }
});



/* ============================================================
   26. VARIAVEL DO BANCO
   ============================================================ */

// Começa vazia.
//
// Depois será preenchida quando o banco for inicializado.
let db;



/* ============================================================
   27. INICIAR SERVIDOR
   ============================================================ */

async function startServer() {

  // Inicializa o banco de dados.
  db = await inicializarBanco();


  // Mostra no terminal que terminou.
  console.log(
    'Base de datos lista!'
  );


  // Faz o servidor começar a escutar.
  //
  // PORT normalmente é 3000.
  //
  // 0.0.0.0 permite receber conexões
  // em todas as interfaces disponíveis.
  app.listen(
    PORT,
    '0.0.0.0',
    () => {

      console.log(
        `API rodando em http://localhost:${PORT}`
      );

      console.log(
        `Endpoint da IA: ${IA_URL}`
      );
    }
  );
}



/* ============================================================
   28. ROTA DE LOGIN
   ============================================================ */

// POST /login
//
// Recebe email e senha.
app.post(
  '/login',
  async (req, res) => {

    // Pega email e senha enviados no body.
    const {
      email,
      senha
    } = req.body;


    // Verifica se os dois foram enviados.
    if (!email || !senha) {

      return res.status(400).json({
        mensagem:
          'Preencha email e senha.'
      });
    }


    try {

      // Procura o usuário no banco pelo email.
      const usuario =
        await db.get(
          `SELECT * FROM usuarios WHERE email = ?`,
          [email]
        );


      // Se não encontrou...
      if (!usuario) {

        return res.status(401).json({
          mensagem:
            'Usuario nao encontrado.'
        });
      }


      // Compara a senha digitada com o hash
      // armazenado no banco.
      const senhaValida =
        await bcrypt.compare(
          senha,
          usuario.senha
        );


      // Se a senha estiver errada...
      if (!senhaValida) {

        return res.status(401).json({
          mensagem:
            'Senha incorreta.'
        });
      }


      // Gera o token JWT.
      const token =
        gerarToken(usuario);


      // Envia o token para o frontend.
      return res.json({
        token,
        nome: usuario.nome,
        id: usuario.id
      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        mensagem:
          'Erro no servidor.'
      });
    }
  }
);



/* ============================================================
   29. CADASTRAR USUARIO
   ============================================================ */

app.post(
  '/usuarios',
  async (req, res) => {

    // Pega os dados enviados.
    const {
      nome,
      email,
      senha
    } = req.body;


    // Valida os dados.
    const erro =
      validarRegistro(
        nome,
        email,
        senha
      );


    // Se houver erro...
    if (erro) {

      return res.status(400).json({
        mensagem: erro
      });
    }


    try {

      // Cria um ID único.
      //
      // Exemplo:
      //
      // usr_550e8400-e29b...
      const id =
        `usr_${crypto.randomUUID()}`;


      // Pega a data atual.
      const dataRegistro =
        new Date().toISOString();


      // Transforma a senha em hash.
      //
      // O 10 representa o custo do processamento.
      const senhaHash =
        await bcrypt.hash(
          senha,
          10
        );


      // Insere o usuário no banco.
      await db.run(

        `INSERT INTO usuarios
        (id, nome, email, senha, dataRegistro)
        VALUES (?, ?, ?, ?, ?)`,

        [
          id,
          nome.trim(),
          email.trim().toLowerCase(),
          senhaHash,
          dataRegistro
        ]
      );


      // 201 = recurso criado.
      return res.status(201).json({
        mensagem:
          'Usuario criado com sucesso!'
      });

    } catch (err) {

      // Verifica se o erro aconteceu porque
      // o email já existe.
      const emailDuplicado =
        String(
          err.message || err
        ).includes('UNIQUE');


      const mensagem =
        emailDuplicado
          ? 'Este email ja esta registrado.'
          : 'Erro ao cadastrar.';


      return res
        .status(
          emailDuplicado
            ? 409
            : 400
        )
        .json({
          mensagem
        });
    }
  }
);



/* ============================================================
   30. ENVIAR VIDEO PARA ANALISE
   ============================================================ */

// Essa é uma das partes mais importantes do projeto.
//
// POST /enviar-gol
//
// autenticarToken:
// primeiro verifica se o usuário está logado.
//
// upload.single('video'):
// recebe um único arquivo chamado "video".
app.post(
  '/enviar-gol',
  autenticarToken,
  upload.single('video'),
  async (req, res) => {


    // Se não recebeu vídeo...
    if (!req.file) {

      return res.status(400).json({
        mensagem:
          'Nenhum video enviado ou formato nao suportado.'
      });
    }


    // Caminho onde o vídeo foi salvo.
    const caminhoVideoOriginal =
      req.file.path;


    // Pega o ID do usuário através do JWT.
    const usuarioId =
      req.usuario?.id;


    // Pega o nome do usuário.
    const nomeJogador =
      req.usuario?.nome ||
      'Artilheiro WA';


    try {

      console.log(
        'Video recebido, enviando para IA...',
        'usuarioId =',
        usuarioId
      );


      // Começamos com uma lista de gols vazia.
      let golsIA = [];


      try {

        // Cria um FormData.
        const form = new FormData();


        // Adiciona o vídeo ao FormData.
        //
        // createReadStream permite enviar o arquivo
        // sem precisar carregar todo o vídeo na memória.
        form.append(
          'video',
          fs.createReadStream(
            caminhoVideoOriginal
          )
        );


        // Envia o vídeo para a IA Python.
        const respostaEnvio =
          await axios.post(
            `${IA_URL}/analisar-video`,
            form,
            {
              headers:
                form.getHeaders(),

              // Permite enviar arquivos grandes.
              maxBodyLength:
                Infinity,

              // Tempo máximo para enviar o vídeo.
              timeout:
                120000
            }
          );


        // A IA responde com um job_id.
        const jobId =
          respostaEnvio.data.job_id;


        console.log(
          'IA aceitou o video, job_id =',
          jobId
        );


        // Agora esperamos a IA terminar.
        golsIA =
          await aguardarResultadoIA(
            jobId
          );


        console.log(
          'IA finalizou:',
          golsIA.length,
          'gol(es)'
        );

      } catch (err) {

        // Se a IA estiver desligada ou acontecer
        // algum erro, o servidor não quebra.
        console.log(
          'IA offline, timeout ou erro:',
          err.message
        );
      }


      // Descobre a duração do vídeo original.
      const duracao =
        await obtenerDuracion(
          caminhoVideoOriginal
        );


      // Aqui vamos guardar os clipes gerados.
      const clipes = [];


      // Aqui vamos guardar o caminho físico de cada clipe,
      // para depois juntar todos em um único vídeo longo.
      const caminhosClipes = [];


      // Guarda a URL do vídeo completo,
      // caso nenhum gol seja encontrado.
      let urlVideoCompleto = null;



      /* ======================================================
         31. SE A IA ENCONTROU GOLS
         ====================================================== */

      if (golsIA.length > 0) {

        // Percorre cada gol encontrado.
        //
        // Exemplo:
        //
        // golsIA = [
        //   gol 1,
        //   gol 2,
        //   gol 3
        // ]
        //
        // O for vai processar todos eles.
        for (
          const gol of golsIA
        ) {


          // Começamos o clipe 11 segundos
          // antes do momento detectado.
          //
          // Math.max(0, ...)
          // impede que o corte fique antes
          // do começo do vídeo.
          const inicioCorte =
            Math.max(
              0,
              gol.segundo_gol - 11
            );


          // O clipe pode ter no máximo 14 segundos.
          const duracaoClipe =
            Math.max(
              1,
              Math.min(
                14,
                duracao - inicioCorte
              )
            );


          // Corta o vídeo usando FFmpeg.
          const url =
            await cortarClipe(
              caminhoVideoOriginal,
              inicioCorte,
              duracaoClipe,
              Math.round(
                gol.segundo_gol
              )
            );


          // Guarda informações do clipe.
          clipes.push({
            url,
            segundo:
              gol.segundo_gol,
            placar:
              gol.placar || null
          });


          // Guarda também o caminho físico do clipe,
          // que será usado para montar o highlights.
          caminhosClipes.push(
            path.join(
              uploadsPath,
              path.basename(url)
            )
          );
        }


      } else {


        /* ====================================================
           32. NENHUM GOL ENCONTRADO
           ==================================================== */

        // Em vez de devolver um pequeno trecho,
        // copiamos o vídeo inteiro.
        const nomeCompleto =
          `partida_${Date.now()}.mp4`;


        const caminhoFinal =
          path.join(
            uploadsPath,
            nomeCompleto
          );


        // Copia o vídeo original.
        fs.copyFileSync(
          caminhoVideoOriginal,
          caminhoFinal
        );


        // Cria a URL pública.
        urlVideoCompleto =
          `/uploads/${nomeCompleto}`;


        // Coloca o vídeo completo na lista.
        clipes.push({
          url:
            urlVideoCompleto,

          segundo:
            null,

          placar:
            null,

          completo:
            true
        });
      }



      /* ======================================================
         32b. CRIAR VIDEO LONGO COM TODOS OS GOLS
         ====================================================== */

      // Se existe pelo menos um gol, juntamos todos os clipes
      // em um único vídeo "highlights" para o usuário assistir
      // os lances em sequência (um vídeo longo só).
      let urlVideoHighlights = null;

      if (
        caminhosClipes.length === 1
      ) {

        // Só um gol: o vídeo longo é o próprio clipe.
        urlVideoHighlights =
          `/uploads/${path.basename(caminhosClipes[0])}`;

      } else if (
        caminhosClipes.length > 1
      ) {

        try {

          urlVideoHighlights =
            await concatenarClips(
              caminhosClipes
            );

          console.log(
            'Video highlights criado:',
            urlVideoHighlights
          );

        } catch (err) {

          // Se falhar, não quebra o fluxo de resposta.
          console.log(
            'Nao foi possivel criar o video highlights:',
            err.message
          );
        }
      }



      /* ======================================================
         33. SALVAR GOLS NO RANKING
         ====================================================== */

      // Só salva no ranking se:
      //
      // 1. Temos usuário
      // 2. A IA encontrou pelo menos um gol
      if (
        usuarioId &&
        golsIA.length > 0
      ) {

        // Pega a data atual.
        const data =
          new Date()
            .toISOString()
            .slice(0, 10);


        // Percorre todos os clipes.
        for (
          const clipe of clipes
        ) {

          try {

            // Insere o gol no ranking.
            await db.run(

              `INSERT INTO ranking
              (usuario_id, nome_jogador, video_url, data_gol)
              VALUES (?, ?, ?, ?)`,

              [
                usuarioId,
                nomeJogador,
                clipe.url,
                data
              ]
            );

          } catch (err) {

            console.log(
              'Erro ao salvar no ranking:',
              err.message
            );
          }
        }
      }



      /* ======================================================
         34. APAGAR VIDEO ORIGINAL
         ====================================================== */

      // Depois que terminamos de processar o vídeo,
      // podemos apagar o arquivo bruto enviado pelo usuário.
      if (
        fs.existsSync(
          caminhoVideoOriginal
        )
      ) {

        fs.unlinkSync(
          caminhoVideoOriginal
        );
      }


      console.log(
        'Processado com sucesso!'
      );



      /* ======================================================
         35. CRIAR MENSAGEM PARA O FRONTEND
         ====================================================== */

      const mensagem =
        golsIA.length === 0

          ? 'Nenhum gol detectado no video. Assista ao video completo abaixo.'

          : `${golsIA.length} gol(is) detectado(s) no video.`;



      /* ======================================================
         36. RESPONDER AO FRONTEND
         ====================================================== */

      return res.json({

        // Nome do jogador.
        jogador:
          nomeJogador,

        // Quantidade de gols.
        totalGols:
          golsIA.length,

        // Lista dos clipes.
        clipes,

        // Primeiro vídeo da lista.
        urlVideo:
          clipes[0]?.url || null,

        // Vídeo completo, se existir.
        urlVideoCompleto,

        // Vídeo longo com todos os gols juntos.
        urlVideoHighlights,

        // Mensagem para o frontend.
        mensagem
      });


    } catch (error) {

      // Se acontecer algum erro geral...
      console.error(
        'Erro geral:',
        error
      );


      // Apaga o vídeo original se ele ainda existir.
      if (
        fs.existsSync(
          caminhoVideoOriginal
        )
      ) {

        fs.unlinkSync(
          caminhoVideoOriginal
        );
      }


      // Informa erro para o frontend.
      return res.status(500).json({
        mensagem:
          'Erro ao processar video.'
      });
    }
  }
);



/* ============================================================
   37. ROTA DO RANKING
   ============================================================ */

app.get(
  '/ranking',
  autenticarToken,
  async (req, res) => {

    try {

      // Consulta o banco.
      const rows =
        await db.all(`

          SELECT
            nome_jogador,
            COUNT(*) as gols

          FROM ranking

          WHERE nome_jogador IS NOT NULL

          GROUP BY nome_jogador

          ORDER BY gols DESC

        `);


      // Envia os resultados.
      res.json(rows);

    } catch (err) {

      // Se der erro...
      res.status(500).json({
        error:
          err.message
      });
    }
  }
);



/* ============================================================
   38. ROTA DE HEALTH CHECK
   ============================================================ */

// Serve para verificar se o servidor está funcionando.
//
// GET /health
//
// Resposta:
//
// {
//   "status": "ok"
// }
app.get(
  '/health',
  (req, res) => {

    res.json({
      status: 'ok'
    });
  }
);



/* ============================================================
   39. INICIAR SERVIDOR
   ============================================================ */

// Chama nossa função startServer().
startServer()

  // Se acontecer um erro durante a inicialização...
  .catch((err) => {

    console.error(
      'Nao foi possivel inicializar o servidor:',
      err
    );


    // Encerra o Node.
    process.exit(1);
  });