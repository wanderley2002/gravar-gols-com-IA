from flask import Flask, request, jsonify
from flask_cors import CORS

from processador import ProcessadorVideo

import os
import time


app = Flask(__name__)
CORS(app)


# Pasta onde a IA recebe os vídeos
PASTA_UPLOAD = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "uploads"
)


os.makedirs(
    PASTA_UPLOAD,
    exist_ok=True
)



@app.route("/analisar-video", methods=["POST"])
def analisar_video():

    print("\n📥 Recebendo vídeo da W.A Games...")


    if "video" not in request.files:

        print("❌ Nenhum vídeo recebido")

        return jsonify({

            "sucesso": False,
            "mensagem": "Nenhum vídeo enviado"

        }), 400



    arquivo = request.files["video"]



    nome_video = (
        f"video_{int(time.time())}.mp4"
    )


    caminho_video = os.path.join(
        PASTA_UPLOAD,
        nome_video
    )



    arquivo.save(
        caminho_video
    )



    print(
        "💾 Vídeo salvo:",
        caminho_video
    )



    try:


        ia = ProcessadorVideo()



        resultado = ia.analisar_jogo(
            caminho_video
        )



        if not resultado:


            print(
                "⚠️ Nenhum gol encontrado"
            )


            return jsonify({

                "sucesso": False,

                "gols": [],

                "total_gols": 0

            })




        print(
            f"⚽ {len(resultado)} gol(s) encontrado(s)"
        )



        for gol in resultado:

            print(
                "🎬 Clip criado:",
                gol["clip"]
            )



        return jsonify({

            "sucesso": True,

            "gols": resultado,

            "total_gols": len(resultado)

        })




    except Exception as erro:


        print(
            "❌ Erro na IA:",
            erro
        )


        return jsonify({

            "sucesso": False,

            "erro": str(erro)

        }),500





@app.route("/health")
def health():

    return jsonify({

        "status":
        "IA W.A Games funcionando"

    })





if __name__ == "__main__":


    print(
        "🤖 IA W.A Games rodando na porta 5000"
    )


    app.run(

        host="127.0.0.1",

        port=5000,

        debug=False

    )