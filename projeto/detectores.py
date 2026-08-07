# projeto/detectores.py

import cv2
import easyocr
import re
import numpy as np


class DetectorPlacar:

    def __init__(self):
        print("🤖 Inicializando OCR...")

        try:
            self.reader = easyocr.Reader(['pt', 'en'], gpu=True)
            print("✅ OCR usando GPU")
        except Exception as erro:
            print("⚠️ GPU não disponível:", erro)
            self.reader = easyocr.Reader(['pt', 'en'], gpu=False)
            print("✅ OCR usando CPU")

        # Guarda últimos placares encontrados
        self.historico = []

    def extrair_placar(self, frame):
        """
        Detecta o placar do eFootball.
        O placar fica no TOPO CENTRAL da tela, com formato "0 - 0" ou "0x0".
        O relógio fica logo abaixo do placar.
        """
        altura, largura, _ = frame.shape

        # Região do placar: topo central, bem no meio
        # O placar do eFootball fica no centro superior
        regioes = [
            # Região principal: topo central (mais estreita para pegar só o placar)
            (
                int(altura * 0.02),
                int(altura * 0.08),
                int(largura * 0.40),
                int(largura * 0.60)
            ),
            # Região alternativa: topo central mais ampla
            (
                int(altura * 0.01),
                int(altura * 0.10),
                int(largura * 0.35),
                int(largura * 0.65)
            ),
        ]

        melhor_placar = None

        for ymin, ymax, xmin, xmax in regioes:
            recorte = frame[ymin:ymax, xmin:xmax]

            if recorte.size == 0:
                continue

            # Aumenta para facilitar OCR
            imagem = cv2.resize(
                recorte,
                None,
                fx=4,
                fy=4,
                interpolation=cv2.INTER_CUBIC
            )

            cinza = cv2.cvtColor(imagem, cv2.COLOR_BGR2GRAY)

            # Melhora contraste
            _, imagem_processada = cv2.threshold(
                cinza,
                0,
                255,
                cv2.THRESH_BINARY + cv2.THRESH_OTSU
            )

            try:
                resultado = self.reader.readtext(
                    imagem_processada,
                    detail=1,
                    paragraph=False
                )
            except Exception as erro:
                print("Erro OCR:", erro)
                continue

            # Junta o texto e substitui letras que parecem números
            texto = ""
            for item in resultado:
                texto += item[1] + " "

            # Substituições comuns do OCR
            texto = texto.replace("O", "0")
            texto = texto.replace("o", "0")
            texto = texto.replace("I", "1")
            texto = texto.replace("l", "1")
            texto = texto.replace("S", "5")
            texto = texto.replace("B", "8")

            # Procura padrões de placar: "0 - 0", "0x0", "0:0", "0 0"
            # O placar tem DOIS números separados por um separador
            padroes = [
                r'(\d+)\s*[-x:]\s*(\d+)',  # 0-0, 0x0, 0:0
                r'(\d+)\s+(\d+)',           # 0 0
            ]

            for padrao in padroes:
                match = re.search(padrao, texto)
                if match:
                    num1 = int(match.group(1))
                    num2 = int(match.group(2))

                    # Placar válido: números entre 0 e 20
                    if 0 <= num1 <= 20 and 0 <= num2 <= 20:
                        placar = (num1, num2)
                        melhor_placar = placar
                        break

            if melhor_placar:
                break

        if melhor_placar:
            self.historico.append(melhor_placar)

            # Mantém somente últimos 10
            if len(self.historico) > 10:
                self.historico.pop(0)

            print(f"📊 Placar detectado: {melhor_placar[0]}x{melhor_placar[1]}")

        return melhor_placar

    def confirmou_mudanca(self):
        """
        Verifica se o placar realmente mudou.
        Usa o histórico para confirmar que a mudança é real.
        """
        if len(self.historico) < 3:
            return False

        ultimo = self.historico[-1]
        anteriores = self.historico[-3:-1]

        # O placar NUNCA pode diminuir.
        # Se o último é maior que os anteriores, é gol.
        for placar in anteriores:
            if placar is None:
                continue

            # Verifica se o último placar é maior que o anterior
            if (ultimo[0] > placar[0] or ultimo[1] > placar[1]):
                # Confirma que NÃO é um erro de leitura
                # (o placar não pode ter números menores que o anterior)
                if (ultimo[0] >= placar[0] and ultimo[1] >= placar[1]):
                    return True

        return False