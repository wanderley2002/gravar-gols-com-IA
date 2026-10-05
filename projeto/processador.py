"""
=================================================================
 W.A GAMES — PROCESSADOR DE VIDEO
-----------------------------------------------------------------
Analisa um video INTEIRO buscando TODOS os gols atraves de
mudancas no placar. Nao corta mais os clipes por padrao (isso
agora e responsabilidade do server.js) — apenas devolve os
timestamps de cada gol confirmado.
=================================================================
"""

import os
import shutil
import subprocess
import sys
from collections import Counter

import cv2

from detectores import DetectorPlacar

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")


SEGUNDOS_ANTES = 8.0
SEGUNDOS_DESPUES = 5.0

# --- parametros de amostragem/confirmacao (ajustaveis) ---
SEGUNDOS_CALIBRACAO = 5  # janela usada para calibrar ROI + placar inicial
INTERVALO_COARSE_SEG = 1.0  # varredura "grosseira": 1 leitura por segundo
JANELA_CONFIRMACAO_SEG = 4.0  # quanto tempo reamostrar densamente apos um candidato
PASSO_FINE_FRAMES = 2  # densidade da reamostragem de confirmacao
MIN_LEITURAS_CONFIRMACAO = 2  # leituras iguais necessarias p/ confirmar o gol
COOLDOWN_SEG = 12.0  # tempo minimo entre dois gols (evita replay duplicado)


class ProcessadorVideo:
    def __init__(self, detector=None):
        # Permite reaproveitar um DetectorPlacar ja carregado (evita
        # recarregar o EasyOCR a cada video, o que e caro).
        self.detector = detector or DetectorPlacar()

        self.pasta_clips = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "clips"
        )
        self.ffmpeg = self._buscar_ffmpeg()
        os.makedirs(self.pasta_clips, exist_ok=True)

        if self.ffmpeg:
            print(f"FFmpeg encontrado: {self.ffmpeg}")
        else:
            print("FFmpeg nao encontrado. Sera usado OpenCV para cortar (se pedido).")

    @staticmethod
    def _buscar_ffmpeg():
        raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        candidatos = [
            os.path.join(raiz, "node_modules", "ffmpeg-static", "ffmpeg.exe"),
            os.path.join(raiz, "ffmpeg", "ffmpeg.exe"),
            "ffmpeg",
        ]
        for candidato in candidatos:
            if os.path.isabs(candidato):
                if os.path.exists(candidato):
                    return candidato
            else:
                encontrado = shutil.which(candidato)
                if encontrado:
                    return encontrado
        return None

    # ------------------------------------------------------------
    # Corte de clipe (opcional — mantido para uso via linha de comando
    # ou como fallback; o fluxo principal via server.js corta os
    # clipes ele mesmo a partir da lista de timestamps).
    # ------------------------------------------------------------
    def cortar_replay_retroativo(self, video_path, frame_gol, fps):
        segundo_gol = frame_gol / fps
        inicio = max(0.0, segundo_gol - SEGUNDOS_ANTES)
        duracao = SEGUNDOS_ANTES + SEGUNDOS_DESPUES
        nome = f"gol_{int(frame_gol)}.mp4"
        saida = os.path.join(self.pasta_clips, nome)

        print(
            f"Cortando replay | gol em {segundo_gol:.1f}s | inicio {inicio:.1f}s | duracao {duracao:.1f}s"
        )

        if self.ffmpeg:
            tentativas = [
                [
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "23",
                    "-c:a",
                    "aac",
                    "-movflags",
                    "+faststart",
                ],
                ["-c:v", "mpeg4", "-q:v", "3", "-c:a", "aac"],
                ["-c", "copy"],
            ]
            for configuracao in tentativas:
                try:
                    comando = (
                        [
                            self.ffmpeg,
                            "-y",
                            "-ss",
                            f"{inicio:.3f}",
                            "-i",
                            video_path,
                            "-t",
                            f"{duracao:.3f}",
                        ]
                        + configuracao
                        + [saida]
                    )
                    subprocess.run(
                        comando, check=True, capture_output=True, timeout=180
                    )
                    print(f"Replay criado: {saida}")
                    return saida
                except Exception as error:
                    print("FFmpeg falhou:", error)

        return self._cortar_com_opencv(video_path, frame_gol, fps, saida)

    def _cortar_com_opencv(self, video_path, frame_gol, fps, saida):
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            print("Nao foi possivel abrir o video para cortar.")
            return saida

        largura = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        altura = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        inicio = max(0, frame_gol - int(fps * SEGUNDOS_ANTES))
        fim = min(total_frames, frame_gol + int(fps * SEGUNDOS_DESPUES))

        codec = cv2.VideoWriter_fourcc(*"mp4v")
        video_saida = cv2.VideoWriter(saida, codec, fps, (largura, altura))

        cap.set(cv2.CAP_PROP_POS_FRAMES, inicio)
        atual = inicio
        while atual <= fim:
            ok, frame = cap.read()
            if not ok:
                break
            video_saida.write(frame)
            atual += 1

        cap.release()
        video_saida.release()
        print(f"Replay criado com OpenCV: {saida}")
        return saida

    @staticmethod
    def _gol_plausible(referencia, novo):
        """Un gol REAL incrementa el marcador en EXACTAMENTE 1 (0-0 -> 1-0).

        Esto elimina la mayoria de falsos positivos del OCR: cuando el reloj
        del partido se lee mal (p.ej. 19:42) daria numeros que no son un
        incremento de +1, y asi se descartan al instante.
        """
        if not novo:
            return False
        return novo == (referencia[0] + 1, referencia[1]) or novo == (
            referencia[0],
            referencia[1] + 1,
        )

    # ------------------------------------------------------------
    # Confirmacao de um candidato a gol: reamostra densamente por
    # alguns segundos procurando o MESMO novo placar se repetir.
    # Isso evita tanto falsos positivos (ruido de 1 frame do OCR)
    # quanto falsos negativos (a logica antiga exigia historico
    # acumulado que raramente se formava a tempo).
    # ------------------------------------------------------------
    def _confirmar_candidato(
        self, cap, placar_candidato, frame_atual, fps, janela_frames, passo_fine
    ):
        frame_inicio = frame_atual
        frame_primeira_ocorrencia = None
        contagem = 0
        lidos = 0

        while lidos < janela_frames:
            ok, imagem = cap.read()
            if not ok:
                break

            frame_atual += 1
            lidos += 1

            if lidos % passo_fine != 0:
                continue

            placar = self.detector.extrair_placar(imagem)
            if placar == placar_candidato:
                if frame_primeira_ocorrencia is None:
                    frame_primeira_ocorrencia = frame_atual
                contagem += 1
                if contagem >= MIN_LEITURAS_CONFIRMACAO:
                    return True, frame_primeira_ocorrencia, frame_atual

        return False, frame_inicio, frame_atual

    # ------------------------------------------------------------
    def analisar_jogo(self, video_path, cortar_clipes=False):
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            print("Nao foi possivel abrir o video:", video_path)
            return []

        fps = cap.get(cv2.CAP_PROP_FPS)
        if not fps or fps <= 0:
            fps = 30

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duracao_video = total_frames / fps

        print(f"FPS do video: {fps:.2f}")
        print(f"Duracao aproximada: {duracao_video:.1f}s")

        passo_coarse = max(1, int(fps * INTERVALO_COARSE_SEG))
        passo_fine = max(1, PASSO_FINE_FRAMES)
        frames_calibracao = int(fps * SEGUNDOS_CALIBRACAO)
        frames_janela_confirmacao = int(fps * JANELA_CONFIRMACAO_SEG)
        frames_cooldown = int(fps * COOLDOWN_SEG)

        # ---- Fase 1: calibrar ROI + placar inicial ----
        print("\nCalibrando regiao do placar e lendo marcador inicial...")

        frame = 0
        frames_amostra = []

        # Muestrea solo 6 frames repartidos en los primeros SEGUNDOS_CALIBRACION:
        # con 30 frames el OCR en CPU tardaba varios minutos solo en calibrar.
        while cap.isOpened() and frame < frames_calibracao:
            ok, imagem = cap.read()
            if not ok:
                break
            if frame % 25 == 0:
                frames_amostra.append(imagem)
                if len(frames_amostra) >= 6:
                    break
            frame += 1

        if not frames_amostra:
            print("Nao foi possivel ler nenhum frame inicial do video.")
            cap.release()
            return []

        self.detector.calibrar_regiao(frames_amostra)

        placares_iniciais = [
            self.detector.extrair_placar(img) for img in frames_amostra
        ]
        placares_iniciais = [p for p in placares_iniciais if p]

        if placares_iniciais:
            placar_referencia = Counter(placares_iniciais).most_common(1)[0][0]
            print(
                f"Placar inicial definido: {placar_referencia[0]}x{placar_referencia[1]}"
            )
        else:
            placar_referencia = (0, 0)
            print(
                "AVISO: nao foi possivel ler o placar nos primeiros "
                f"{SEGUNDOS_CALIBRACAO}s. Assumindo 0x0 e continuando a "
                "analise do restante do video (em vez de abortar)."
            )

        self.detector.historico = []
        gols = []
        ultimo_gol_frame = -frames_cooldown  # nao bloqueia o primeiro candidato

        print("\nVarrendo o restante do video em busca de gols...")

        while cap.isOpened():
            ok, imagem = cap.read()
            if not ok:
                break

            frame += 1
            em_cooldown = (frame - ultimo_gol_frame) < frames_cooldown

            if not em_cooldown and frame % passo_coarse == 0:
                placar = self.detector.extrair_placar(imagem)

                if placar and self._gol_plausible(placar_referencia, placar):
                    segundo_candidato = frame / fps
                    print(
                        f"\n{segundo_candidato:6.1f}s -> possivel gol: "
                        f"{placar_referencia[0]}x{placar_referencia[1]} -> {placar[0]}x{placar[1]} "
                        "(confirmando...)"
                    )

                    confirmado, frame_gol, frame_novo = self._confirmar_candidato(
                        cap, placar, frame, fps, frames_janela_confirmacao, passo_fine
                    )
                    frame = frame_novo  # pula os frames ja consumidos na confirmacao

                    if confirmado:
                        segundo_gol = frame_gol / fps
                        print(
                            f"GOL CONFIRMADO em {segundo_gol:.1f}s -> {placar[0]}x{placar[1]}"
                        )

                        clip_nome = None
                        if cortar_clipes:
                            caminho = self.cortar_replay_retroativo(
                                video_path, frame_gol, fps
                            )
                            clip_nome = os.path.basename(caminho)

                        gols.append(
                            {
                                "segundo_gol": round(segundo_gol, 1),
                                "placar": f"{placar[0]}x{placar[1]}",
                                "clip": clip_nome,
                                "nome": None,
                            }
                        )

                        placar_referencia = placar
                        ultimo_gol_frame = frame_gol
                        self.detector.historico = []
                    else:
                        print(
                            "Candidato descartado (nao confirmado — provavel ruido do OCR)."
                        )

        cap.release()

        print("\n==================================================")
        if gols:
            print(f"RESULTADO FINAL: {len(gols)} gol(es)")
            for numero, gol in enumerate(gols, start=1):
                print(f"Gol {numero}: {gol['segundo_gol']}s -> {gol['placar']}")
        else:
            print("RESULTADO FINAL: nenhum gol encontrado.")
        print("==================================================")

        return gols


if __name__ == "__main__":
    if len(sys.argv) > 1:
        # Via linha de comando, corta os clipes tambem (util pra testar isoladamente)
        resultado = ProcessadorVideo().analisar_jogo(sys.argv[1], cortar_clipes=True)
        print("\nResultado:")
        print(resultado)
    else:
        print("Informe o caminho do video.")
        print('Exemplo: python processador.py "video.mp4"')
