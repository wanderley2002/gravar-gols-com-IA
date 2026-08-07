const AUTH_API = "http://localhost:3000";

function setMsg(text, color = "#ff4b4b") {
    const msg = document.getElementById("msg");
    if (!msg) return; // 🔥 evita crash

    msg.innerText = text;
    msg.style.color = color;
}

// =========================
// TROCA DE TELA (só se existir)
// =========================
function switchTab(type) {
    const loginBox = document.getElementById('box-login');
    const cadastroBox = document.getElementById('box-cadastro');

    if (!loginBox || !cadastroBox) return; // 🔥 dashboard não quebra

    const tabLogin = document.getElementById('t-login');
    const tabCadastro = document.getElementById('t-cadastro');

    if (type === 'login') {
        loginBox.classList.remove('hidden');
        cadastroBox.classList.add('hidden');
    } else {
        loginBox.classList.add('hidden');
        cadastroBox.classList.remove('hidden');
    }

    setMsg("");
}

// =========================
// LOGIN
// =========================
async function login() {
    const email = document.getElementById('l-email');
    const senha = document.getElementById('l-senha');

    if (!email || !senha) return;

    if (!email.value || !senha.value) {
        return setMsg("Preencha todos os campos.");
    }

    try {
        setMsg("Entrando...", "#00f2ff");

        const res = await fetch(`${AUTH_API}/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: email.value,
                senha: senha.value
            })
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            return setMsg(data.mensagem || "Erro no login.");
        }

        localStorage.setItem("token", data.token || "");
        localStorage.setItem("nomeUsuario", data.nome || "");
        localStorage.setItem("usuarioId", data.id || "");

        setMsg("Login OK!", "#00ff88");

        setTimeout(() => {
            window.location.href = "dashboard.html";
        }, 800);

    } catch (err) {
        setMsg("Servidor offline.");
    }
}

// =========================
// CADASTRO
// =========================
async function cadastrar() {
    const nome = document.getElementById("c-nome");
    const email = document.getElementById("c-email");
    const senha = document.getElementById("c-senha");

    if (!nome || !email || !senha) return;

    if (!nome.value || !email.value || !senha.value) {
        return setMsg("Preencha todos os campos.");
    }

    try {
        setMsg("Criando conta...", "#00f2ff");

        const res = await fetch(`${AUTH_API}/usuarios`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                nome: nome.value,
                email: email.value,
                senha: senha.value
            })
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            return setMsg(data.mensagem || "Erro ao cadastrar.");
        }

        setMsg("Conta criada!", "#00ff88");

        setTimeout(() => switchTab("login"), 1000);

    } catch (err) {
        setMsg("Erro de conexão.");
    }
}