"""
=================================================================
 W.A GAMES — API da IA (Python + Flask)
-----------------------------------------------------------------
Recebe o video do Node.js (server.js) e analisa em BACKGROUND
(thread + job_id), para nao depender de uma unica requisicao
HTTP sincrona que estourava o timeout em videos de partida
completa. O Node consulta /status/<job_id> ate a analise terminar.

Endpoints:
  POST /analisar-video        -> inicia o job, devolve {job_id}
  GET  /status/<job_id>       -> {status: processando|concluido|erro, gols: [...]}
=================================================================
"""

import os
import sys
import threading
import time
import uuid

from flask import Flask, request, jsonify
from flask_cors import CORS

from processador import ProcessadorVideo

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")


app = Flask(__name__)
CORS(app)

PASTA_UPLOAD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(PASTA_UPLOAD, exist_ok=True)

# Instancia unica, reaproveitada entre videos: carregar o EasyOCR
# do zero a cada requisicao e caro (varios segundos).
PROCESSADOR = ProcessadorVideo()

# So permite uma analise por vez (o EasyOCR/estado do detector nao
# foi feito para rodar concorrentemente). Para suportar varios
# usuarios analisando ao mesmo tempo, isso precisaria virar uma
# fila real (ex.: Celery/RQ) em vez de so uma Lock.
LOCK_PROCESSAMENTO = threading.Lock()

# job_id -> {"status": "...", "gols": [...], "erro": "..."}
TRABALHOS = {}


def _guardar_video(request) -> str | None:
    if "video" not in request.files:
        return None

    arquivo = request.files["video"]
    nome_video = f"video_{int(time.time() * 1000)}.mp4"
    caminho_video = os.path.join(PASTA_UPLOAD, nome_video)
    arquivo.save(caminho_video)
    return caminho_video


def _processar_em_background(job_id, caminho_video):
    try:
        with LOCK_PROCESSAMENTO:
            # Reseta o estado do detector para cada novo video, ja que
            # resolucao/HUD podem variar entre videos.
            PROCESSADOR.detector.historico = []
            PROCESSADOR.detector.regiao_calibrada = None

            gols = PROCESSADOR.analisar_jogo(caminho_video, cortar_clipes=False)

        TRABALHOS[job_id] = {
            "status": "concluido",
            "gols": gols,
            "total_gols": len(gols),
        }
        print(f"✅ Job {job_id} concluido: {len(gols)} gol(es)")

    except Exception as error:
        print(f"❌ Job {job_id} falhou:", error)
        TRABALHOS[job_id] = {"status": "erro", "erro": str(error), "gols": []}

    finally:
        if os.path.exists(caminho_video):
            os.remove(caminho_video)


@app.route("/analisar-video", methods=["POST"])
def analisar_video():
    print("\n📥 Recebendo video da W.A Games...")

    caminho_video = _guardar_video(request)
    if not caminho_video:
        print("❌ Nenhum video recebido")
        return jsonify({"sucesso": False, "mensagem": "Nenhum video enviado"}), 400

    job_id = str(uuid.uuid4())
    TRABALHOS[job_id] = {"status": "processando", "gols": []}

    thread = threading.Thread(
        target=_processar_em_background,
        args=(job_id, caminho_video),
        daemon=True,
    )
    thread.start()

    print(f"🚀 Job {job_id} iniciado em background")
    return jsonify({"sucesso": True, "job_id": job_id}), 202


@app.route("/status/<job_id>")
def status(job_id):
    trabalho = TRABALHOS.get(job_id)

    if not trabalho:
        return jsonify({"sucesso": False, "mensagem": "Job nao encontrado"}), 404

    return jsonify({"sucesso": True, **trabalho})


@app.route("/health")
def health():
    return jsonify({"status": "IA W.A Games funcionando"})


if __name__ == "__main__":
    print("🤖 IA W.A Games rodando na porta 5000")
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
