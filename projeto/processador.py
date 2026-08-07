# projeto/processador.py

import sys
import os
import cv2
from collections import Counter

from detectores import DetectorPlacar


class ProcessadorVideo:

    def __init__(self):
        self.detector = DetectorPlacar()
        self.pasta_clips = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "clips"
        )

    def cortar_replay_retroativo(self, video_path, frame_gol, fps):
        """Volta 8 segundos antes do gol e pega 5 segundos depois"""
        os.makedirs(self.pasta_clips, exist_ok=True)

        cap = cv2.VideoCapture(video_path)
        largura = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        altura = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        inicio = max(0, frame_gol - int(fps * 8))
        fim = min(total_frames, frame_gol + int(fps * 5))

        nome = f"gol_{int(frame_gol)}.mp4"
        saida = os.path.join(self.pasta_clips, nome)

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
        print(f"🎬 Replay criado: {saida}")
        return saida

    def analisar_jogo(self, video_path):
        """
        Analisa o vídeo e retorna uma lista de gols detectados.
        Cada gol tem: segundo_gol, clip, nome
        """
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        if not fps or fps <= 0:
            fps = 30

        frame = 0
        placar_inicial = None
        placar_referencia = None
        gols = []

        print("🔎 Analisando vídeo...")

        # Coleta placares nos primeiros 3 segundos para definir o placar inicial
        placares_iniciais = []
        frames_iniciais = int(fps * 3)

        while cap.isOpened() and frame < frames_iniciais:
            ok, imagem = cap.read()
            if not ok:
                break

            if frame % 5 == 0:
                placar = self.detector.extrair_placar(imagem)
                if placar:
                    placares_iniciais.append(placar)

            frame += 1

        # Define o placar inicial como o mais comum nos primeiros frames
        if placares_iniciais:
            contador = Counter(placares_iniciais)
            placar_inicial = contador.most_common(1)[0][0]
            placar_referencia = placar_inicial
            print(f"🏁 Placar inicial: {placar_inicial[0]}x{placar_inicial[1]}")
        else:
            print("⚠️ Não consegui detectar o placar inicial")
            cap.release()
            return []

        # Continua analisando o resto do vídeo
        while cap.isOpened():
            ok, imagem = cap.read()
            if not ok:
                break

            # Analisa ~3 vezes por segundo
            if frame % 10 == 0:
                placar = self.detector.extrair_placar(imagem)

                if placar:
                    # Verifica se o placar mudou em relação à referência
                    if (placar[0] > placar_referencia[0] or
                        placar[1] > placar_referencia[1]):

                        # Confirma com o detector (histórico)
                        if self.detector.confirmou_mudanca():
                            print(f"⚽ GOL DETECTADO! Placar: {placar[0]}x{placar[1]}")

                            clip = self.cortar_replay_retroativo(
                                video_path, frame, fps
                            )

                            gols.append({
                                "segundo_gol": round(frame / fps, 1),
                                "clip": clip,
                                "nome": os.path.basename(clip)
                            })

                            # Atualiza a referência para o novo placar
                            placar_referencia = placar
                            self.detector.historico = []

            frame += 1

        cap.release()

        if gols:
            print(f"🎉 {len(gols)} gol(s) encontrado(s)")
            return gols

        print("Nenhum gol encontrado")
        return []


if __name__ == "__main__":
    if len(sys.argv) > 1:
        resultado = ProcessadorVideo().analisar_jogo(sys.argv[1])
        print(resultado)