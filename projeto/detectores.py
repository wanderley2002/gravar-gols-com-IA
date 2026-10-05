"""
=================================================================
 W.A GAMES — DETECTOR DE PLACAR (eFootball)
-----------------------------------------------------------------
Le o marcador do eFootball usando EasyOCR. Em vez de assumir uma
unica posicao fixa na tela, testa varias regioes candidatas nos
primeiros frames do video e calibra qual delas realmente contem
o placar (isso resolve o problema de "0 gols" quando o HUD nao
esta exatamente onde o codigo antigo assumia).
=================================================================
"""

import re
import sys

import cv2
import easyocr

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")


class DetectorPlacar:
    REGIOES_CANDIDATAS = [
        (0.00, 0.14, 0.36, 0.64),  # topo-centro: caixa do placar (principal)
        (0.00, 0.16, 0.22, 0.78),  # topo-centro amplo (HUD variante)
        (0.00, 0.12, 0.58, 0.97),  # topo-direita
        (0.16, 0.36, 0.55, 0.98),  # direita media (posicao de replays)
    ]

    DIGITOS = "0123456789:-"

    SUBSTITUICOES = [
        ("O", "0"),
        ("o", "0"),
        ("Q", "0"),
        ("D", "0"),
        ("I", "1"),
        ("l", "1"),
        ("i", "1"),
        ("|", "1"),
        ("Z", "2"),
        ("S", "5"),
        ("s", "5"),
        ("G", "6"),
        ("B", "8"),
    ]

    PADROES_PLACAR = [
        r"(\d+)\s*[-x:]\s*(\d+)",  # 0-0, 0x0, 0:0
        r"(\d+)\s+(\d+)",  # 0 0
    ]

    def __init__(self):
        print("🤖 Inicializando OCR...")

        try:
            self.reader = easyocr.Reader(["pt", "en"], gpu=True)
            print("✅ OCR usando GPU")
        except Exception as erro:
            print("⚠️ GPU nao disponivel:", erro)
            self.reader = easyocr.Reader(["pt", "en"], gpu=False)
            print("✅ OCR usando CPU")

        self.historico = []
        self.regiao_calibrada = None

    def calibrar_regiao(self, frames_amostra):
        print("\n🔎 Calibrando regiao do placar...")

        melhor_regiao = None
        melhor_acertos = 0

        for regiao in self.REGIOES_CANDIDATAS:
            acertos = 0

            for frame in frames_amostra:
                if self._ler_regiao(frame, regiao) is not None:
                    acertos += 1

            print(
                f"   Regiao {regiao} -> {acertos}/{len(frames_amostra)} leituras validas"
            )

            if acertos > melhor_acertos:
                melhor_acertos = acertos
                melhor_regiao = regiao

        if melhor_regiao is not None and melhor_acertos > 0:
            self.regiao_calibrada = melhor_regiao
            print(f"✅ Regiao calibrada: {melhor_regiao} ({melhor_acertos} acertos)")
        else:
            self.regiao_calibrada = None
            print("⚠️ Nao foi possivel calibrar uma regiao confiavel.")
            print("   A analise vai continuar testando todas as regioes candidatas,")
            print("   mas isso e mais lento e menos confiavel. Verifique se o placar")
            print("   do eFootball esta realmente visivel no video.")

    def extrair_placar(self, frame):
        # Sin calibracion prueba solo la region principal (mucho mas rapido en
        # CPU): revisar las 4 regiones en cada frame seria demasiado lento en
        # partidas largas cuando el OCR no logra calibrar.
        regioes_a_testar = (
            [self.regiao_calibrada]
            if self.regiao_calibrada
            else self.REGIOES_CANDIDATAS[:1]
        )

        placar = None
        for regiao in regioes_a_testar:
            placar = self._ler_regiao(frame, regiao)
            if placar:
                break

        if placar:
            self.historico.append(placar)
            if len(self.historico) > 10:
                self.historico.pop(0)
            print(f"📊 Placar detectado: {placar[0]}x{placar[1]}")

        return placar

    def _ler_regiao(self, frame, regiao):
        altura, largura, _ = frame.shape
        ymin_f, ymax_f, xmin_f, xmax_f = regiao

        ymin, ymax = int(altura * ymin_f), int(altura * ymax_f)
        xmin, xmax = int(largura * xmin_f), int(largura * xmax_f)

        recorte = frame[ymin:ymax, xmin:xmax]
        if recorte.size == 0:
            return None

        # Amplia bastante: las grabaciones llegan en 848x382 y los digitos del
        # placar quedan minusculos. Con ~4-6x el texto pequeno se vuelve legible.
        escala = max(4.0, 160.0 / recorte.shape[0])
        imagem = cv2.resize(
            recorte, None, fx=escala, fy=escala, interpolation=cv2.INTER_CUBIC
        )

        # Limita el ancho para que CRAFT (EasyOCR) no se pierda en imagenes gigantes
        if imagem.shape[1] > 1800:
            fator = 1800.0 / imagem.shape[1]
            imagem = cv2.resize(imagem, (1800, int(imagem.shape[0] * fator)))

        cinza = cv2.cvtColor(imagem, cv2.COLOR_BGR2GRAY)

        _, normal = cv2.threshold(cinza, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        _, invertida = cv2.threshold(
            cinza, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
        )

        for variante in (normal, invertida):
            # 1) Primero intenta OCR restringido a digitos (mucho mas fiable
            #    en texto pequeno y evita leer nombres de equipos por error).
            placar = self._ocr_e_extrair_digitos(variante)
            if placar:
                return placar

            # 2) Respaldo: OCR general (lee placares como "0 - 0" con letras).
            placar = self._ocr_e_extrair(variante)
            if placar:
                return placar

        return None

    def _ocr_e_extrair_digitos(self, imagem_processada):
        try:
            resultado = self.reader.readtext(
                imagem_processada,
                detail=1,
                paragraph=False,
                allowlist=self.DIGITOS,
                text_threshold=0.5,
            )
        except Exception as erro:
            print("Erro OCR digitos:", erro)
            return None

        texto = " ".join(item[1] for item in resultado)
        return self._parsear_placar(texto)

    def _ocr_e_extrair(self, imagem_processada):
        try:
            resultado = self.reader.readtext(
                imagem_processada, detail=1, paragraph=False
            )
        except Exception as erro:
            print("Erro OCR:", erro)
            return None

        texto = " ".join(item[1] for item in resultado)

        for letra, numero in self.SUBSTITUICOES:
            texto = texto.replace(letra, numero)

        return self._parsear_placar(texto)

    def _parsear_placar(self, texto):
        for padrao in self.PADROES_PLACAR:
            match = re.search(padrao, texto)
            if match:
                num1, num2 = int(match.group(1)), int(match.group(2))
                if 0 <= num1 <= 20 and 0 <= num2 <= 20:
                    return (num1, num2)

        return None
