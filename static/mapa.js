// Monta o prédio do escritório a partir dos times.
// Em cima: recepção (logo) + uma sala por time (cresce com o número de agentes), no máximo 6 por fileira.
// No meio: corredor. Embaixo: sala de reunião, sala comunal (montada por "cantinhos"), cozinha e banheiro.
// Mais abaixo, se precisar: blocos com os outros times e as salas de projeto, cada um com o seu corredor, ligados ao
// principal por um corredor à esquerda.
// Todo móvel é ancorado pela base (centro, chão); peça que o tema não tem é simplesmente pulada.
"use strict";

const Mapa = (() => {   // tudo aqui dentro é privado; fora só existe window.Mapa
const T = 16;
const PAREDE = 3;              // altura da parede, em tiles
const MESA_W = 3, MESA_H = 3;  // célula de mesa, em tiles
const BAIXO_PISO = 8;          // piso das salas de baixo, em tiles
const WC_W = 12;               // largura do banheiro, em tiles
const CORREDOR_H = 3;
const MX = 3, MY = 2;          // área externa: laterais e topo (em tiles); embaixo, fachada, calçada e rua (em px, abaixo)
const FACHADA = 32;  // px: a frente do prédio vista de frente, embaixo da planta (Firmópolis); empurra a rua para baixo
const CALCADA = 24, RUA_ALT = 30;   // px: a calçada da rua e a faixa de asfalto, enxutas (o prédio é o assunto)
const ruaY = p => p.y + p.h + FACHADA + CALCADA + 3;   // topo do asfalto (p: o retângulo do prédio)
const MAX_FILEIRA = 6;         // salas por fileira, no máximo; passou, abre outra fileira (e outro corredor)
const CON_W = 3;               // tiles: o corredor de ligação, à esquerda, que desce do corredor principal até os outros
const LOUNGE_MIN = 30;         // tiles: a sala comunal mínima (entrada, o espaço do ringue e o painel do logo)
// Uma parede e um piso para o prédio todo (a identidade de cada time vem do tapete na cor dele); a planta do modo
// construção ainda pinta sala por sala. Cozinha e banheiro ficam com o azulejo
const PAREDE_UNICA = 0, PISO_UNICO = 1, PISO_COZINHA = 3;
const ESTILOS_MESA = [
  { tampo: "#c9a777", brilho: "#dcbd8c", frente: "#8a6a45", borda: "#6e5236", pe: "#2b2b36" },   // madeira clara
  { tampo: "#7a5236", brilho: "#946646", frente: "#53361f", borda: "#3e2716", pe: "#1f1f26" },   // madeira escura
  { tampo: "#e8e8ec", brilho: "#ffffff", frente: "#b8b8c4", borda: "#9a9aa8", pe: "#6b6b78" },   // branca
  { tampo: "#3a3a46", brilho: "#4c4c5a", frente: "#26262f", borda: "#1a1a20", pe: "#111116" },   // preta
  { tampo: "#b07a4f", brilho: "#c4906a", frente: "#7a5034", borda: "#5e3c26", pe: "#2b2b36" },   // freijó
  { tampo: "#9fb59a", brilho: "#b5c9b0", frente: "#6f8a6a", borda: "#56704f", pe: "#3a3a46" },   // verde-sálvia
];
// onde fica a tela em cada sprite (x, y, w, h em pixels do sprite), para TV e fliperama animados
const TELAS = { rack_tv: [2, 2, 38, 20], tv_parede: [2, 1, 32, 18], arcade1: [6, 13, 10, 9], arcade2: [4, 10, 13, 9], arcade3: [5, 10, 12, 10] };
const CORES_CADEIRA = [["#30303c", "#454556"], ["#7a2d3a", "#9e4152"], ["#24506e", "#326c92"], ["#2f5a3a", "#3f7a4e"], ["#a84f2f", "#c96a45"], ["#a8841c", "#c9a227"]];

function sprite(atlas, nome) { return atlas.json.sprites[nome] || (PROCEDURAIS[nome] && [0, 0, ...PROCEDURAIS[nome]]); }

// Placa de porta: tamanho fixo no mundo (pixel art), com ícone, nome e o contador "na mesa x/y" ao lado
const PLACA_FONTE = "8px Silkscreen, monospace", PLACA_H = 14;
let medidor = null;
function larguraTexto(txt) { medidor = medidor || document.createElement("canvas").getContext("2d"); medidor.font = PLACA_FONTE; return Math.ceil(medidor.measureText(txt).width); }
const nomePlaca = n => (n.length > 14 ? n.slice(0, 13).trimEnd() + "…" : n);   // nome curto: a placa é igual em toda sala
function tamanhoPlaca(s) {   // sala de projeto (band do Maestri) não tem contador: as mesas dela não têm dono
  const w = 18 + larguraTexto(nomePlaca(s.nome).toUpperCase()) + 6, cont = s.handles && !s.projeto ? 3 + larguraTexto("00/00") + 6 : 0;
  return { w, total: w + cont };
}

// sorteio estável (mesmo nome = mesma decoração)
function semente(txt) { let h = 2166136261; for (const ch of txt) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let s = seed || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296; }
function escolhe(r, lista) { return lista[Math.floor(r() * lista.length)]; }

// carpetes que ganham a cor do time (geométrico e triângulos); sem cor no times.json, uma da paleta quente
const PISOS_DO_TIME = new Set([3, 5]);
const CORES_CARPETE = ["#c2410c", "#0f766e", "#7c3aed", "#b45309", "#be185d", "#15803d", "#1d4ed8"];

// cor entre a e b (k = 0: a; k = 1: b), em hex; cor inválida vira a reserva
const hex6 = (cor, reserva) => (/^#[0-9a-f]{6}$/i.test(cor || "") ? cor : reserva);
// Cores da interface: a fonte única são os tokens do estilo.css (:root). "destaque" é a cor da marca (o app.js aplica a da
// configuração e o Personalizar troca ao vivo, por isso não fica guardada); "ambar" (esperando aprovação) e "azul" (pergunta)
// são cores de estado, fixas, e não seguem a marca.
const coresFixas = {};
function cor(nome) {
  if (coresFixas[nome]) return coresFixas[nome];
  const v = hex6(getComputedStyle(document.documentElement).getPropertyValue(`--${nome}`).trim(), "#ffffff");
  if (nome !== "destaque") coresFixas[nome] = v;
  return v;
}
const rgb = hex => { const n = parseInt(hex.slice(1), 16); return `${n >> 16},${(n >> 8) & 255},${n & 255}`; };
function mistura(a, b, k) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const f = s => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
  return "#" + ((1 << 24) | (f(16) << 16) | (f(8) << 8) | f(0)).toString(16).slice(1);
}
const corDoTime = s => hex6(s.cor, CORES_CARPETE[semente(s.nome) % CORES_CARPETE.length]);

// Função do time (pelo ícone ou pelo nome; sem pista, sorteada pelo nome): define a peça-assinatura da sala
const FUNCOES = ["dev", "marketing", "vendas", "produto"];
function funcaoDaSala(s) {
  if (s.tipo !== "mesas") return null;
  const n = s.nome.toLowerCase();
  if (s.icone === "codigo" || /dev|eng|tec|c[oó]d|back|front|qa|infra/.test(n)) return "dev";
  if (s.icone === "megafone" || s.icone === "pincel" || /market|social|comun|conte[uú]|marca|brand|design|cria|m[ií]dia/.test(n)) return "marketing";
  if (/vend|comerc|sales|neg[oó]c|client|sucesso|sdr|financ/.test(n)) return "vendas";
  if (s.icone === "grafico" || /produt|product|\bpm\b|ux|roadmap|estrat|dado/.test(n)) return "produto";
  return FUNCOES[semente(s.nome + "f") % FUNCOES.length];
}

// Peças-assinatura de parede, em pixel art desenhada em código: [largura, altura, desenho(c, x, y, r, cor)]
const pintaPx = (c, x, y, w, h, cor) => { c.fillStyle = cor; c.fillRect(x, y, w, h); };
const pontosPx = (c, x, y, lista, cor) => { c.fillStyle = cor; for (const [a, b] of lista) c.fillRect(x + a, y + b, 1, 1); };
const quadroBranco = (c, x, y, w) => { pintaPx(c, x, y, w, 24, "#8a909c"); pintaPx(c, x + 1, y + 1, w - 2, 22, "#f6f6f2"); pintaPx(c, x + 1, y + 22, w - 2, 1, "#dcdcd6"); pintaPx(c, x + 2, y + 24, w - 4, 1, "#6b6b78"); };
const ASSINATURAS = {
  dev: [42, 26, (c, x, y, r) => { // lousa com código a giz e a bandeja de giz
    pintaPx(c, x, y, 42, 24, "#4a3020"); pintaPx(c, x + 1, y + 1, 40, 22, "#7a5232"); pintaPx(c, x + 2, y + 2, 38, 20, "#1f3b33");
    pintaPx(c, x + 2, y + 2, 38, 1, "#2a4a40");
    pontosPx(c, x, y, [[5, 5], [4, 6], [3, 7], [4, 8], [5, 9]], "#ffd36b");
    pontosPx(c, x, y, [[9, 5], [8, 6], [8, 7], [7, 8], [7, 9]], "#e8efe9");
    pontosPx(c, x, y, [[11, 5], [12, 6], [13, 7], [12, 8], [11, 9]], "#ffd36b");
    const giz = ["#e8efe9", "#e8efe9", "#8affc1", "#7cc4ff", "#ff94ad", "#ffd36b"];
    for (const [ly, lx0] of [[5, 16], [8, 16], [11, 4], [14, 4], [17, 4], [20, 4]]) {
      let lx = lx0 + Math.floor(r() * 3) * 3;
      for (let k = 0; k < 3 && lx < 38; k++) { const w = 3 + Math.floor(r() * 7); if (lx + w > 38) break; pintaPx(c, x + lx, y + ly, w, 1, escolhe(r, giz)); lx += w + 2; }
    }
    pintaPx(c, x, y + 24, 42, 2, "#5a3a22"); pintaPx(c, x + 29, y + 24, 3, 1, "#f4f4f0"); pintaPx(c, x + 34, y + 24, 2, 1, "#ffd36b");
  }],
  marketing: [40, 26, (c, x, y, r, cor) => { // moodboard de cortiça com fotos, amostras de cor e alfinetes
    pintaPx(c, x, y, 40, 26, "#6e4a2c"); pintaPx(c, x + 1, y + 1, 38, 24, "#c1925a");
    for (let i = 0; i < 40; i++) pintaPx(c, x + 1 + Math.floor(r() * 38), y + 1 + Math.floor(r() * 24), 1, 1, r() < 0.5 ? "#a87a45" : "#d4a76e");
    const fotos = [[3, 3, 10, 8, ["#7fc8f0", "#3fae5a"]], [15, 2, 8, 10, ["#ff9e7a", "#ffd36b"]], [25, 4, 11, 8, ["#2a1446", "#ff5d8f"]], [3, 14, 9, 8, ["#f4f4f0", "#e8587a"]], [28, 15, 8, 7, ["#3ec1d3", "#0f766e"]]];
    for (const [a, b, w, h, [k1, k2]] of fotos) {
      pintaPx(c, x + a + 1, y + b + 1, w, h, "rgba(40,20,0,.3)"); pintaPx(c, x + a, y + b, w, h, "#ffffff");
      pintaPx(c, x + a + 1, y + b + 1, w - 2, h - 2, k1); pintaPx(c, x + a + 1, y + b + Math.ceil(h / 2), w - 2, Math.floor(h / 2) - 1, k2);
      pintaPx(c, x + a + Math.floor(w / 2), y + b - 1, 1, 2, escolhe(r, ["#d23c3c", "#3a92e6", "#f2a93b"]));
    }
    [mistura(cor, "#000000", 0.35), cor, mistura(cor, "#ffffff", 0.35), mistura(cor, "#ffffff", 0.7)].forEach((k, i) => pintaPx(c, x + 14 + i * 3, y + 16, 3, 5, k));   // amostras da cor do time
    pintaPx(c, x + 14, y + 22, 12, 1, "rgba(40,20,0,.3)");
  }],
  vendas: [46, 26, (c, x, y) => { // quadro de metas (barras subindo até a linha da meta) e o sino das vendas
    quadroBranco(c, x, y, 34);
    pintaPx(c, x + 3, y + 3, 12, 1, "#d23c3c");
    for (let k = 3; k < 31; k += 2) pintaPx(c, x + k, y + 7, 1, 1, "#e8587a");   // linha da meta
    [4, 6, 8, 11, 15].forEach((h, i) => { pintaPx(c, x + 4 + i * 5, y + 21 - h, 3, h, i === 4 ? "#3fb35c" : "#3a92e6"); pintaPx(c, x + 4 + i * 5, y + 21 - h, 1, h, i === 4 ? "#5fd07a" : "#5aa7e6"); });
    pontosPx(c, x, y, [[27, 2], [26, 3], [27, 3], [28, 3], [27, 4]], "#f2a93b");
    pintaPx(c, x + 3, y + 21, 28, 1, "#9aa0ab");
    pintaPx(c, x + 38, y + 3, 6, 1, "#3a3a46"); pintaPx(c, x + 40, y + 3, 1, 3, "#3a3a46");   // suporte
    pintaPx(c, x + 39, y + 6, 3, 1, "#c98f2a"); pintaPx(c, x + 38, y + 7, 5, 1, "#e0a93b"); pintaPx(c, x + 37, y + 8, 7, 3, "#e0a93b");
    pintaPx(c, x + 38, y + 7, 1, 4, "#ffd36b"); pintaPx(c, x + 36, y + 11, 9, 1, "#9a6a1f"); pintaPx(c, x + 40, y + 12, 1, 1, "#5a3d10");
    pintaPx(c, x + 43, y + 4, 1, 12, "#b08a5a"); pintaPx(c, x + 42, y + 16, 3, 2, "#c8102e");   // cordinha
  }],
  produto: [44, 26, (c, x, y, r) => { // kanban: três colunas de post-its (a fazer, fazendo, feito)
    quadroBranco(c, x, y, 44);
    pintaPx(c, x + 15, y + 2, 1, 20, "#c9ccd4"); pintaPx(c, x + 29, y + 2, 1, 20, "#c9ccd4");
    ["#6b6b78", "#3a92e6", "#3fb35c"].forEach((k, i) => pintaPx(c, x + 3 + i * 14, y + 3, 8, 1, k));
    const cores = ["#ffe066", "#ff9ec4", "#8ecdf7", "#a8e6a1", "#ffc078"];
    [[[2, 6], [8, 6], [2, 11], [8, 11], [2, 16]], [[17, 6], [23, 6], [17, 11]], [[31, 6], [37, 6], [31, 11]]].forEach((col, i) => col.forEach(([a, b]) => {
      const k = escolhe(r, cores);
      pintaPx(c, x + a, y + b, 5, 4, k); pintaPx(c, x + a, y + b + 3, 5, 1, mistura(k, "#000000", 0.18)); pintaPx(c, x + a + 1, y + b + 1, 3, 1, "rgba(0,0,0,.28)");
      if (i === 2) pontosPx(c, x + a, y + b, [[1, 2], [2, 3], [3, 1]], "#15803d");   // feito
    }));
  }],
};

// Ringue da Sala comunal (vida social): a lona, o avental, os degraus da entrada e as cordas dos lados vão no fundo; os postes
// e as cordas de trás e da frente são peças do efeitos.js (ringue_tras, ringue_frente), e quem luta fica atrás da corda da frente
const RINGUE = { w: 6 * T, h: 56, abertura: 32 };   // lona e entrada no meio da frente, em pixels
function pintarRingue(c, x, y, w, h, abertura, corP) {
  const lona = "#e9e2cf", borda = mistura(corP, "#1b1622", 0.35), avental = mistura(corP, "#1b1622", 0.55);
  pintaPx(c, x + 2, y + h + 6, w, 2, "rgba(0,0,0,.2)");                                          // sombra do tablado
  pintaPx(c, x, y + h, w, 6, avental); pintaPx(c, x, y + h, w, 1, mistura(avental, "#ffffff", 0.25));
  for (let k = 6; k < w - 3; k += 10) pintaPx(c, x + k, y + h + 2, 1, 4, mistura(avental, "#000000", 0.3));   // pregas do avental
  pintaPx(c, x, y, w, h, borda); pintaPx(c, x + 3, y + 3, w - 6, h - 6, lona);
  const r = rng(semente("ringue"));
  for (let i = 0; i < (w * h) / 40; i++) pintaPx(c, x + 3 + Math.floor(r() * (w - 6)), y + 3 + Math.floor(r() * (h - 6)), 1, 1, r() < 0.5 ? "#dbd2bb" : "#f4efe2");
  const cx = x + w / 2, cy = y + h / 2, emblema = mistura(corP, lona, 0.3);                       // círculo do meio, na cor da marca
  for (let j = -9; j <= 9; j++) for (let i = -9; i <= 9; i++) { const d = Math.hypot(i, j); if (d > 6.4 && d <= 8.4) pintaPx(c, cx + i, cy + j, 1, 1, emblema); }
  const ex = cx - abertura / 2 + 3;                                                               // degraus na frente da entrada
  pintaPx(c, ex, y + h, abertura - 6, 3, "#c99a5b"); pintaPx(c, ex, y + h, abertura - 6, 1, "#e0b77a");
  pintaPx(c, ex - 2, y + h + 3, abertura - 2, 4, "#a87a45"); pintaPx(c, ex - 2, y + h + 3, abertura - 2, 1, "#c99a5b"); pintaPx(c, ex - 2, y + h + 7, abertura - 2, 1, "rgba(0,0,0,.25)");
  for (const [sx, lado] of [[x, -1], [x + w - 1, 1]]) {                                          // cordas dos lados (de cima, as três viram uma linha)
    pintaPx(c, sx, y - 15, 1, h + 10, "#f4f1ea"); pintaPx(c, sx + lado, y - 14, 1, h + 10, "rgba(0,0,0,.22)");
  }
}

// quadro do placar do ringue: moldura e fundo; o título, o top 3 e o campeão anterior são do efeitos.js (mudam a cada leitura)
const QUADRO_PLACAR = { w: 64, h: 40 };
// mural da sala (1.6): quadro de cortiça com moldura de madeira; os avisos (app.js) entram por cima, presos com tachinha
const MURAL = { w: 24, h: 16 };
function pintarMural(c, x, y) {
  pintaPx(c, x, y, MURAL.w, MURAL.h, "#4a3220"); pintaPx(c, x + 1, y + 1, MURAL.w - 2, MURAL.h - 2, "#6e4a2c");
  pintaPx(c, x + 2, y + 2, MURAL.w - 4, MURAL.h - 4, "#c08a52");
  pontosPx(c, x + 2, y + 2, [[2, 1], [7, 3], [12, 1], [17, 4], [4, 7], [10, 9], [15, 8], [1, 10], [18, 10], [8, 6]], "#a8703c");
  pintaPx(c, x + 2, y + 2, MURAL.w - 4, 1, "#d6a36c");
  pintaPx(c, x + 1, y + MURAL.h, MURAL.w - 2, 1, "rgba(0,0,0,.25)");   // sombra na parede
}
function pintarQuadroPlacar(c, x, y, w, h) {
  pintaPx(c, x + 1, y + h, w, 1, "rgba(0,0,0,.25)");                                    // sombra na parede
  pintaPx(c, x, y, w, h, "#4a3020"); pintaPx(c, x + 1, y + 1, w - 2, h - 2, "#7a5232"); pintaPx(c, x + 2, y + 2, w - 4, h - 4, "#171a24");
  pintaPx(c, x + 2, y + 2, w - 4, 9, "#222736"); pintaPx(c, x + 2, y + 11, w - 4, 1, "#2e3446");   // faixa do título
  pintaPx(c, x + 2, y + 2, w - 4, 1, "#2a3042");
}
// o rádio da firma (22×17): antena, caixa de madeira com o alto-falante, o mostrador e dois botões, numa prateleirinha
function pintarRadio(c, x, y) {
  for (let k = 0; k < 3; k++) pintaPx(c, x + 15 + k * 2, y + 2 - k, 2, 1, "#9aa3b5");                    // antena
  pintaPx(c, x + 1, y + 3, 20, 11, "#5a3a22"); pintaPx(c, x + 2, y + 4, 18, 9, "#a8703f");                 // caixa
  pintaPx(c, x + 2, y + 4, 18, 1, "#c58a52");                                                               // brilho em cima
  pintaPx(c, x + 3, y + 5, 8, 7, "#3b2a1e");                                                                // alto-falante
  for (let k = 0; k < 3; k++) pintaPx(c, x + 4, y + 6 + k * 2, 6, 1, "#6b4a2e");
  pintaPx(c, x + 12, y + 5, 7, 3, "#f2d48a"); pintaPx(c, x + 15, y + 5, 1, 3, "#c8102e");                  // mostrador e ponteiro
  pintaPx(c, x + 12, y + 10, 2, 2, "#2a1a0c"); pintaPx(c, x + 17, y + 10, 2, 2, "#2a1a0c");                // botões
  pintaPx(c, x, y + 14, 22, 2, "#6b4a2e"); pintaPx(c, x, y + 14, 22, 1, "#8a6240");                        // prateleira
  pintaPx(c, x + 2, y + 16, 2, 1, "#4a3220"); pintaPx(c, x + 18, y + 16, 2, 1, "#4a3220");                 // mãos-francesas
  pintaPx(c, x + 1, y + 17, 20, 1, "rgba(0,0,0,.25)");                                                      // sombra na parede
}

// ---------------- banheiro (Firmópolis): tudo em pixel art desenhada aqui, no fundo do mapa
const WC_CABINES = 3, CABINE = { w: 26, alto: 28, fundo: 40 };   // cabine: largura, altura das divisórias e onde fica a frente (px do chão)
// piso de pastilhas brancas com a faixa azul junto das paredes e a parede de azulejo com a faixa azul (por cima da parede 6)
function pintarBanheiro(c, s) {
  const x0 = s.px, y0 = s.chao, w = s.pw, h = s.py + s.ph - y0, r = rng(semente("banheiro"));
  const cols = Math.ceil(w / 8), lins = Math.ceil(h / 8);
  for (let j = 0; j < lins; j++) for (let i = 0; i < cols; i++) {
    const borda = i === 1 || i === cols - 2 || j === lins - 2, x = x0 + i * 8, y = y0 + j * 8;
    const k = r(), cor = borda ? "#5b8fcc" : k < 0.08 ? "#d4e4f2" : k < 0.5 ? "#f1f5f8" : "#eaf0f4";
    pintaPx(c, x, y, 8, 8, "#b9c6d2"); pintaPx(c, x + 1, y + 1, 7, 7, cor);                    // rejunte e pastilha
    pintaPx(c, x + 1, y + 1, 2, 1, borda ? "#8fb6e2" : "#ffffff");                             // brilho no canto
  }
  pintaPx(c, x0, y0, w, 3, "rgba(36,40,60,.16)"); pintaPx(c, x0, y0 + 3, w, 2, "rgba(36,40,60,.08)");   // sombra da parede
  pintaPx(c, x0, y0, 2, h, "rgba(36,40,60,.08)"); pintaPx(c, x0 + w - 2, y0, 2, h, "rgba(36,40,60,.08)");
  { // o ralo no meio do piso
    const rx = x0 + Math.round(w * 0.42), ry = y0 + 84;
    pintaPx(c, rx - 4, ry - 3, 9, 7, "#8d99a6"); pintaPx(c, rx - 3, ry - 2, 7, 5, "#5f6b78");
    for (let k = 0; k < 3; k++) pintaPx(c, rx - 2 + k * 2, ry - 1, 1, 3, "#b9c3cd");
  }
  for (let x = x0; x < x0 + w; x++) { // a faixa decorativa da parede de azulejo, em azul
    const k = (x - x0) % 6;
    pintaPx(c, x, s.py + 22, 1, 7, k === 0 ? "#2f5fb3" : "#e4edf6");
    if (k === 3) { pintaPx(c, x, s.py + 23, 1, 5, "#5b8fcc"); pintaPx(c, x - 1, s.py + 25, 3, 1, "#5b8fcc"); }
  }
}
// uma cabine vista de frente: o vaso lá dentro (só a caixa e a tampa aparecem por cima da porta), as divisórias até o chão
// e a porta com a fresta embaixo. O sinal de vago/ocupado e os pés na fresta são do desenharCabines (mudam a cada quadro)
function pintarCabine(c, x, chao) {
  const { w, alto, fundo } = CABINE, fy = chao + fundo, cx = x + 1 + w / 2, topo = fy - alto;
  // o vaso: a caixa na parede e o assento no chão
  pintaPx(c, cx - 6, chao - 13, 12, 11, "#7d8a97"); pintaPx(c, cx - 5, chao - 12, 10, 9, "#f4f6f8"); pintaPx(c, cx - 5, chao - 12, 10, 2, "#ffffff");
  pintaPx(c, cx - 1, chao - 10, 3, 1, "#b9c3cd");   // a descarga
  [3, 4, 5, 5, 5, 5, 5, 5, 4, 4, 3].forEach((m, j) => { // o assento oval, de cima: contorno, louça e a tampa aberta
    pintaPx(c, cx - m, chao - 3 + j, 2 * m, 1, "#7d8a97");
    if (j > 0 && j < 10) pintaPx(c, cx - m + 1, chao - 3 + j, 2 * m - 2, 1, j < 3 ? "#ffffff" : "#eef2f5");
  });
  pintaPx(c, cx - 2, chao + 1, 4, 5, "#c9d4de"); pintaPx(c, cx - 1, chao + 2, 2, 3, "#a9c3da");   // a água
  // o rolo de papel na divisória
  pintaPx(c, x + 3, chao + 2, 4, 4, "#7d8a97"); pintaPx(c, x + 4, chao + 3, 2, 2, "#ffffff");
  // as divisórias: de cima, a quina sobe da parede até a frente; embaixo, o pé de metal
  for (const px of [x, x + w]) {
    pintaPx(c, px, chao - alto, 2, fy - (chao - alto), "#3f5f86"); pintaPx(c, px, chao - alto, 1, fy - (chao - alto), "#7fa4cc");
    pintaPx(c, px - 1, fy - 3, 4, 3, "#9aa5b1"); pintaPx(c, px - 1, fy - 3, 4, 1, "#c9d1d9");
  }
  // a porta (com a fresta de 3 px embaixo) e o frontão em cima dela
  pintaPx(c, x + 2, topo, w - 2, 3, "#3f5f86"); pintaPx(c, x + 2, topo, w - 2, 1, "#7fa4cc");
  pintaPx(c, x + 2, topo + 3, w - 2, alto - 6, "#2f4766");
  pintaPx(c, x + 3, topo + 3, w - 4, alto - 7, "#5f86b3"); pintaPx(c, x + 3, topo + 3, w - 4, 1, "#86aad3");
  pintaPx(c, x + 5, topo + 6, w - 8, alto - 13, "#5580ad"); pintaPx(c, x + 5, topo + 6, 1, alto - 13, "#7099c4");   // o painel
  pintaPx(c, x + w - 6, topo + 9, 4, 4, "#1d2b3d");                                                                  // o visor do trinco
  pintaPx(c, x + w - 5, topo + 14, 2, 2, "#d9dee4"); pintaPx(c, x + w - 5, topo + 15, 2, 1, "#8d99a6");             // a maçaneta
  pintaPx(c, x + 2, fy, w + 2, 2, "rgba(30,40,60,.18)");                                                             // sombra
}
// a bancada de mármore claro sobre o gabinete de madeira, com duas cubas, as torneiras, o sabonete e o espelho em cima
function pintarBancada(c, x, chao, w) {
  const cubas = [x + Math.round(w * 0.27), x + Math.round(w * 0.73)];
  // espelho: moldura, vidro azulado e o reflexo na diagonal
  const ex = x + 2, ey = chao - 27, ew = w - 4, eh = 19;
  pintaPx(c, ex, ey, ew, eh, "#6b7682"); pintaPx(c, ex + 1, ey + 1, ew - 2, eh - 2, "#bcdcec");
  for (let k = 0; k < 3; k++) for (let j = 0; j < eh - 2; j++) { const px = ex + 6 + k * 13 + Math.floor((eh - 2 - j) / 2); if (px < ex + ew - 1) pintaPx(c, px, ey + 1 + j, k === 1 ? 2 : 1, 1, "#e8f6fc"); }
  pintaPx(c, ex + 1, ey + eh - 3, ew - 2, 2, "#a7c9db"); pintaPx(c, ex + 1, ey + eh, ew - 2, 1, "rgba(0,0,0,.18)");
  // torneiras cromadas na parede
  for (const cx of cubas) { pintaPx(c, cx, chao - 7, 1, 4, "#9aa5b1"); pintaPx(c, cx - 1, chao - 7, 3, 1, "#d9dee4"); pintaPx(c, cx, chao - 4, 1, 2, "#6b7682"); }
  // tampo
  pintaPx(c, x, chao - 3, w, 10, "#9aa5b1"); pintaPx(c, x + 1, chao - 2, w - 2, 8, "#eef1f4"); pintaPx(c, x + 1, chao - 2, w - 2, 1, "#ffffff");
  for (let k = 0; k < w / 3; k++) pintaPx(c, x + 2 + ((k * 7) % (w - 4)), chao - 1 + ((k * 5) % 6), 1, 1, "#d3dae1");   // veios do mármore
  for (const cx of cubas) { // a cuba oval e o ralinho
    pintaPx(c, cx - 7, chao - 1, 14, 6, "#8d99a6"); pintaPx(c, cx - 6, chao - 1, 12, 6, "#c9d4de"); pintaPx(c, cx - 5, chao, 10, 4, "#dfe7ee");
    pintaPx(c, cx - 7, chao - 1, 1, 1, "#eef1f4"); pintaPx(c, cx + 6, chao - 1, 1, 1, "#eef1f4"); pintaPx(c, cx - 7, chao + 4, 1, 1, "#eef1f4"); pintaPx(c, cx + 6, chao + 4, 1, 1, "#eef1f4");
    pintaPx(c, cx, chao + 2, 1, 1, "#6b7682");
  }
  const sx = x + Math.round(w / 2);   // o sabonete líquido entre as cubas
  pintaPx(c, sx - 1, chao - 5, 3, 5, "#2f6b4a"); pintaPx(c, sx, chao - 4, 1, 3, "#5fbf8a"); pintaPx(c, sx, chao - 7, 1, 2, "#d9dee4");
  // gabinete de madeira com duas portinhas e os puxadores
  pintaPx(c, x, chao + 7, w, 12, "#5e3c26"); pintaPx(c, x + 1, chao + 7, w - 2, 11, "#9b7653"); pintaPx(c, x + 1, chao + 7, w - 2, 1, "#b48d66");
  for (const cx of cubas) { pintaPx(c, cx - 8, chao + 9, 16, 8, "#8a6a45"); pintaPx(c, cx - 7, chao + 10, 14, 6, "#a98260"); pintaPx(c, cx - 1, chao + 12, 2, 1, "#e0c08a"); }
  pintaPx(c, x, chao + 19, w, 2, "rgba(30,40,60,.18)");
}
// o secador de mãos na parede (10x12) e a lixeira de pedal no chão (pé em base)
function pintarSecador(c, x, y) {
  pintaPx(c, x, y, 10, 12, "#6b7682"); pintaPx(c, x + 1, y + 1, 8, 9, "#e3e8ec"); pintaPx(c, x + 1, y + 1, 8, 1, "#ffffff");
  pintaPx(c, x + 2, y + 10, 6, 2, "#3a3f48"); pintaPx(c, x + 3, y + 12, 4, 1, "#1d2129");   // o bocal
  pintaPx(c, x + 7, y + 3, 1, 1, "#e5484d");                                                  // a luzinha
  pintaPx(c, x + 2, y + 5, 4, 1, "#b9c3cd"); pintaPx(c, x + 2, y + 7, 4, 1, "#b9c3cd");       // a grade
  pintaPx(c, x + 1, y + 13, 9, 1, "rgba(0,0,0,.15)");
}
function pintarLixeiraWc(c, x, base) {
  pintaPx(c, x, base - 11, 9, 11, "#5f6b78"); pintaPx(c, x + 1, base - 10, 7, 9, "#aab4be"); pintaPx(c, x + 2, base - 10, 1, 9, "#d3dae1");
  pintaPx(c, x - 1, base - 12, 11, 2, "#7d8a97"); pintaPx(c, x, base - 12, 9, 1, "#c9d1d9");   // a tampa
  pintaPx(c, x + 3, base - 1, 3, 1, "#3a3f48");                                                // o pedal
  pintaPx(c, x, base, 10, 1, "rgba(0,0,0,.18)");
}
// por cima do fundo, a cada quadro: o sinal do trinco (verde vago, vermelho ocupado) e, ocupada, os pés na fresta da porta
function desenharCabines(c, b) {
  for (const k of (b && b.cabines) || []) {
    const fy = k.chao + CABINE.fundo, topo = fy - CABINE.alto, x = k.px + CABINE.w - 5;
    pintaPx(c, x, topo + 10, 2, 2, k.ocupada ? "#e5484d" : "#3fbf5f");
    if (k.ocupada) { pintaPx(c, k.x - 4, fy - 2, 3, 2, "#1d1b26"); pintaPx(c, k.x + 1, fy - 2, 3, 2, "#1d1b26"); }
  }
}

// A identidade do time: um tapete (9-slice em pixel art) sob o grupo de mesas, na cor do time, e um filete dela no alto
// da parede. É a única cor da sala: piso e parede são os do prédio inteiro
function pintarTapete(c, s, chao, cor) {
  const x0 = s.px + 2 * T + 2, x1 = s.px + 2 * T + s.cols * MESA_W * T - 2, y0 = chao + 12, y1 = chao + 8 + (s.linhas - 1) * MESA_H * T + 38;
  const w = x1 - x0, h = y1 - y0, fundo = mistura(cor, "#3a3040", 0.5), borda = mistura(cor, "#1b1622", 0.65), filete = mistura(cor, "#f4ead8", 0.45);
  pintaPx(c, x0 + 1, y1, w, 1, "rgba(0,0,0,.18)");                                                       // sombra
  pintaPx(c, x0, y0, w, h, borda); pintaPx(c, x0 + 2, y0 + 2, w - 4, h - 4, fundo);                         // borda e miolo
  pintaPx(c, x0 + 1, y0, w - 2, 1, mistura(borda, "#ffffff", 0.15));                                      // brilho da borda
  pintaPx(c, x0 + 4, y0 + 4, w - 8, 1, filete); pintaPx(c, x0 + 4, y1 - 5, w - 8, 1, filete);               // filete por dentro
  pintaPx(c, x0 + 4, y0 + 4, 1, h - 8, filete); pintaPx(c, x1 - 5, y0 + 4, 1, h - 8, filete);
  for (const [cx, cy] of [[x0 + 4, y0 + 4], [x1 - 5, y0 + 4], [x0 + 4, y1 - 5], [x1 - 5, y1 - 5]]) pintaPx(c, cx - 1, cy - 1, 3, 3, filete);   // cantos
  for (let x = x0 + 1; x < x1 - 1; x += 3) { pintaPx(c, x, y0 - 1, 1, 1, filete); pintaPx(c, x, y1, 1, 1, filete); }   // franja
  pintaPx(c, s.px, s.py, s.pw, 2, cor); pintaPx(c, s.px, s.py + 2, s.pw, 1, mistura(cor, "#1b1622", 0.4));   // filete no alto da parede
}

function pintarSala(c, atlas, sala) {
  const { tx, ty, tw, th, parede, piso } = sala;
  const p = sprite(atlas, `piso${piso}`), chao = { x: tx * T, y: (ty + PAREDE) * T, w: tw * T, h: (th - PAREDE) * T };
  for (let y = ty + PAREDE; y < ty + th; y += 2)
    for (let x = tx; x < tx + tw; x += 3) {
      const w = Math.min(3, tx + tw - x) * T, h = Math.min(2, ty + th - y) * T;
      c.drawImage(atlas.img, p[0], p[1], w, h, x * T, y * T, w, h);
    }
  if (PISOS_DO_TIME.has(piso) && sala.tipo !== "cozinha") { // carpete na cor do time (multiplica: o desenho do carpete continua aparecendo); a cozinha usa o ladrilho creme cru
    c.save(); c.globalCompositeOperation = "multiply"; c.globalAlpha = 0.55;
    c.fillStyle = sala.cor || CORES_CARPETE[semente(sala.nome) % CORES_CARPETE.length]; c.fillRect(chao.x, chao.y, chao.w, chao.h);
    c.restore();
  }
  { // variação sutil por tile, para o piso não parecer carimbado
    const r = rng(semente(sala.nome + "piso"));
    for (let y = chao.y; y < chao.y + chao.h; y += T) for (let x = chao.x; x < chao.x + chao.w; x += T) {
      const k = r(); if (k > 0.55) continue;
      c.fillStyle = k < 0.27 ? "rgba(255,240,220,.05)" : "rgba(40,24,10,.06)"; c.fillRect(x, y, T, T);
    }
  }
  for (let x = tx; x < tx + tw; x++) {
    const col = x === tx ? 0 : x === tx + tw - 1 ? 3 : 1 + ((x - tx) % 2);
    for (let r = 0; r < PAREDE; r++) {
      const s = sprite(atlas, `parede${parede}_${col}_${r}`) || sprite(atlas, `parede${parede}_${col}_${Math.min(r, 1)}`);
      if (s) c.drawImage(atlas.img, s[0], s[1], T, T, x * T, (ty + r) * T, T, T);
    }
  }
  // sombra de canto: embaixo da parede e nas laterais, puxada para o marrom (combina com a paleta quente)
  c.fillStyle = "rgba(36,20,8,.16)"; c.fillRect(chao.x, chao.y, chao.w, 3);
  c.fillStyle = "rgba(36,20,8,.08)"; c.fillRect(chao.x, chao.y + 3, chao.w, 2);
  c.fillRect(chao.x, chao.y, 2, chao.h); c.fillRect(chao.x + chao.w - 2, chao.y, 2, chao.h);
}

function contorno(c, sala, portasBaixo) {
  const x = sala.tx * T, y = sala.ty * T, w = sala.tw * T, h = sala.th * T;
  c.fillStyle = "#23212f";
  c.fillRect(x - 3, y - 3, w + 6, 3); c.fillRect(x - 3, y, 3, h); c.fillRect(x + w, y, 3, h);
  let cur = x - 3;
  for (const [px, pw] of [...portasBaixo].sort((a, b) => a[0] - b[0])) { c.fillRect(cur, y + h, px - cur, 3); cur = px + pw; }
  c.fillRect(cur, y + h, x + w + 3 - cur, 3);
}

function placaLogo(c, x, y, cor) {
  const claro = "#ffffff";
  c.fillStyle = "#23212f"; c.fillRect(x - 2, y - 2, 40, 24);
  c.fillStyle = "#0d1b2a"; c.fillRect(x, y, 36, 20);
  const px = (a, b, k) => { c.fillStyle = k || cor; c.fillRect(x + a, y + b, 1, 1); };
  [[6, 6], [5, 7], [4, 8], [5, 9], [6, 10]].forEach(([a, b]) => px(a, b));
  [[11, 5], [11, 6], [10, 7], [10, 8], [9, 9], [9, 10], [8, 11]].forEach(([a, b]) => px(a, b, claro));
  [[13, 6], [14, 7], [15, 8], [14, 9], [13, 10]].forEach(([a, b]) => px(a, b));
  [[20, 5], [22, 4], [24, 4], [26, 5], [27, 7], [27, 9], [26, 11], [24, 12]].forEach(([a, b]) => px(a, b));
  [[21, 7], [23, 6], [24, 7], [24, 9], [23, 10]].forEach(([a, b]) => px(a, b, claro));
  [[5, 15], [7, 15], [9, 15], [10, 15], [11, 15], [16, 16], [18, 15], [20, 16], [22, 15], [19, 17]].forEach(([a, b]) => px(a, b));
}

// Conteúdo da tela 6x5 de um monitor conforme o estado de quem usa a mesa:
// "codigo" (trabalhando), "descanso" (livre no escritório), "aprovacao"/"pergunta" (esperando você), "apagada" (fora ou sem dono).
const CORES_CODIGO = ["#7cc4ff", "#c4a0ff", "#8affc1", "#ffd36b", "#ff94ad"];
function desenharTela(c, sx, sy, tela, t, k) {
  if (tela === "codigo") { // linhas de código subindo, com recuo e cores de sintaxe
    c.fillStyle = "#0f1626"; c.fillRect(sx, sy, 6, 5);
    const passo = Math.floor(t / 180) + k * 7;
    for (let l = 0; l < 5; l++) {
      const n = (passo + l) * 2654435761 >>> 0, recuo = n % 3, larg = 1 + (n >> 3) % (5 - recuo);
      c.fillStyle = CORES_CODIGO[(n >> 7) % CORES_CODIGO.length]; c.fillRect(sx + recuo, sy + l, larg, 1);
    }
    if (Math.floor(t / 400) % 2) { c.fillStyle = "#ffffff"; c.fillRect(sx + 5, sy + 4, 1, 1); } // cursor piscando
  } else if (tela === "descanso") { // protetor de tela: bolinha quicando e cor que muda devagar
    const h = (t / 60 + k * 90) % 360;
    c.fillStyle = `hsl(${h},45%,18%)`; c.fillRect(sx, sy, 6, 5);
    const fx = (t / 700 + k) % 2, fy = (t / 530 + k * 0.6) % 2;
    c.fillStyle = `hsl(${(h + 180) % 360},80%,70%)`;
    c.fillRect(sx + Math.round((fx < 1 ? fx : 2 - fx) * 4), sy + Math.round((fy < 1 ? fy : 2 - fy) * 3), 2, 2);
  } else if (tela === "aprovacao" || tela === "pergunta") { // janela de alerta piscando
    const alerta = cor(tela === "aprovacao" ? "ambar" : "azul");
    const aceso = Math.floor(t / 450) % 2;
    c.fillStyle = aceso ? alerta : "#15151c"; c.fillRect(sx, sy, 6, 5);
    c.fillStyle = aceso ? "#15151c" : alerta; c.fillRect(sx + 2, sy + 1, 2, 2); c.fillRect(sx + 2, sy + 4, 2, 1);   // "!" no meio
  } else { // apagada: só um reflexo no vidro
    c.fillStyle = "#15151c"; c.fillRect(sx, sy, 6, 5);
    c.fillStyle = "#2a2a36"; c.fillRect(sx + 1, sy, 1, 2); c.fillRect(sx, sy + 1, 1, 1);
  }
}

// x da luminária da mesa: o canto direito do abajur com 1 monitor; com 2 ou 3, no lugar dos papéis (o meio fica para o rosto)
function lampadaX(mesa) { return mesa ? mesa.x - 16 + ((mesa.monitores || 2) === 1 ? 25 : 17) : 0; }

function desenharMesa(c, x, y, tela, t, mesa) {
  const e = ESTILOS_MESA[(mesa && mesa.estilo) || 0], L = x - 16, itens = (mesa && mesa.itens) || 0;
  c.fillStyle = "rgba(0,0,0,.18)"; c.fillRect(L + 1, y + 17, 31, 2);
  c.fillStyle = e.pe; c.fillRect(L + 2, y + 10, 2, 8); c.fillRect(L + 28, y + 10, 2, 8);
  c.fillStyle = e.frente; c.fillRect(L, y + 8, 32, 4);
  c.fillStyle = e.tampo; c.fillRect(L, y + 1, 32, 7);
  c.fillStyle = e.brilho; c.fillRect(L, y + 1, 32, 1);
  c.fillStyle = e.borda; c.fillRect(L, y + 12, 32, 1);
  // 1 ou 2 monitores nas pontas (o meio fica livre para o rosto de quem senta); o 3º é um notebook no tampo
  const monitores = (mesa && mesa.monitores) || 2;
  const posicoes = monitores === 1 ? [L + 2] : [L + 1, L + 23];
  posicoes.forEach((mx, k) => {
    c.fillStyle = "#3a3a48"; c.fillRect(mx, y - 6, 8, 7);
    c.fillStyle = "#2b2b36"; c.fillRect(mx + 3, y + 1, 2, 2);
    desenharTela(c, mx + 1, y - 5, tela, t, k + x);
  });
  if (monitores === 3) {
    c.fillStyle = "#2b2b36"; c.fillRect(L + 12, y + 4, 8, 3);
    c.fillStyle = tela === "codigo" ? "#3b5f9a" : tela === "apagada" ? "#1b1b22" : "#4a4a5a"; c.fillRect(L + 13, y + 4, 6, 1);
  }
  const cor = (mesa && mesa.corItem) || "#e8587a";
  if (itens & 1) { // caneca, fumegando enquanto o dono está por perto
    c.fillStyle = "#f4f4f5"; c.fillRect(L + 11, y + 4, 3, 2); c.fillStyle = cor; c.fillRect(L + 11, y + 5, 3, 1);
    if (t && tela !== "apagada") for (let k = 0; k < 2; k++) {
      const f = (t / 1100 + k / 2 + x * 0.013) % 1;
      c.fillStyle = `rgba(255,255,255,${0.55 * (1 - f)})`; c.fillRect(L + 12 + Math.round(Math.sin(f * 6 + k * 2)), y + 3 - Math.round(f * 6), 1, 1);
    }
  }
  // hora extra (vida.js): a luminária acende; a mesa sem abajur ganha uma, no canto dele (1 monitor) ou no lugar dos papéis
  const lx = lampadaX(mesa), extra = !!mesa && !!mesa.horaExtra && !mesa.abajur;
  if (itens & 2 && !(extra && lx === L + 17)) { c.fillStyle = "#e9e3d5"; c.fillRect(L + 17, y + 3, 5, 3); c.fillStyle = "#c9c2b0"; c.fillRect(L + 17, y + 5, 5, 1); } // papéis
  if (mesa && (mesa.abajur || extra)) { // abajur: acende com o dono por perto (ou no toque, mesa.abajurAceso)
    const aceso = mesa.horaExtra || (mesa.abajurAceso ?? tela !== "apagada");
    c.fillStyle = "#2b2b36"; c.fillRect(lx, y + 5, 4, 1); c.fillStyle = "#3a3a46"; c.fillRect(lx + 2, y + 2, 1, 3);
    c.fillStyle = aceso ? "#ffd36b" : "#c98f3c"; c.fillRect(lx, y, 5, 2); c.fillStyle = aceso ? "#fff3c4" : "#e0a95a"; c.fillRect(lx + 1, y, 2, 1);
  }
  if (!(mesa && mesa.abajur) && !(extra && lx === L + 25) && itens & 4) { c.fillStyle = "#8a5a3a"; c.fillRect(L + 25, y + 4, 3, 2); c.fillStyle = "#3fae5a"; c.fillRect(L + 24, y + 1, 5, 3); c.fillStyle = "#5fd07a"; c.fillRect(L + 25, y + 1, 2, 1); } // plantinha
  if (mesa && mesa.pato) { // patinho de borracha (a mesa do Dev)
    c.fillStyle = "#ffd23f"; c.fillRect(L + 7, y + 1, 2, 2); c.fillRect(L + 7, y + 3, 4, 2); c.fillStyle = "#e0a91c"; c.fillRect(L + 8, y + 4, 3, 1);
    c.fillStyle = "#f28c28"; c.fillRect(L + 6, y + 2, 1, 1); c.fillStyle = "#1b1b22"; c.fillRect(L + 7, y + 1, 1, 1);
  } else if (itens & 8) { c.fillStyle = cor; c.fillRect(L + 6, y + 2, 2, 3); c.fillStyle = "#ffffff"; c.fillRect(L + 6, y + 2, 2, 1); } // bonequinho
  if (itens & 16) { ["#e8587a", "#3a92e6", "#f2a93b"].forEach((k, i) => { c.fillStyle = k; c.fillRect(L + 20 + i * 2, y + 1, 2, 4); }); } // livros
}

// cadeira de escritório: 0 encosto simples, 1 tela (malha), 2 encosto alto estofado
function desenharCadeira(c, x, y, cor, estilo) {
  const k = CORES_CADEIRA[cor || 0];
  if (estilo === 2) {
    c.fillStyle = k[0]; c.fillRect(x - 6, y - 13, 12, 10); c.fillRect(x - 5, y - 14, 10, 1);
    c.fillStyle = k[1]; c.fillRect(x - 4, y - 13, 8, 2); c.fillRect(x - 1, y - 10, 2, 5);
    return;
  }
  c.fillStyle = k[0]; c.fillRect(x - 6, y - 12, 12, 9);
  c.fillStyle = k[1]; c.fillRect(x - 5, y - 11, 10, 2);
  if (estilo === 1) for (let i = 0; i < 10; i += 2) c.fillRect(x - 5 + i, y - 8, 1, 4);
}

// Decoração possível por tipo de time (só entra o que o tema tem). Cada sala sorteia primeiro
// as peças menos usadas no prédio, então salas novas não repetem as anteriores.
const DECOR_PAREDE = {
  mesas: ["lousa", "grafico", "grafico2", "poster1", "poster2", "poster3", "neon", "relogio", "quadro", "quadro2", "mural", "calendario", "prateleira", "quadro_abstrato", "tv_grafico"],
  ops: ["grafico", "grafico2", "tv_grafico", "relogio", "calendario", "poster1", "mural"],
  gabinete: ["quadro", "quadro_montanha", "diploma", "trofeus", "relogio", "prateleira", "quadro2"],
};
const DECOR_CHAO = {
  mesas: ["planta_alta", "planta_alta2", "planta_alta3", "planta_g1", "planta_g3", "planta_cacto", "arquivo", "arquivo2", "caixas", "violao", "impressora",
    "bebedouro", "estante_baixa", "aparador", "cabideiro", "cafeteira", "luminaria_chao", "estante_livros", "luminaria_arco", "poltrona_tecido", "aparador_baixo", "quadro_branco", "lixeiras"],
  ops: ["rack_rede", "nobreak", "carrinho_ferramentas", "arquivo2", "caixas", "extintor", "planta_cacto", "lixeiras"],
  gabinete: ["vitrine", "globo", "cofre", "estante", "planta_alta", "aparador", "luminaria_chao", "cabideiro", "estante_livros", "poltrona_tecido", "luminaria_arco", "aparador_baixo"],
};
// peças que dão a cara de cada tipo de sala: entram 2, as menos usadas no prédio
const FIXOS_CHAO = { ops: ["servidor", "rack_rede", "servidor2", "nobreak"], gabinete: ["armario", "aquario", "globo", "vitrine", "estante", "cofre"] };
// cantinhos que combinam entre si (cada sala leva o menos usado no prédio)
const KITS = {
  mesas: [["cafeteira", "bebedouro"], ["impressora", "arquivo", "caixas"], ["planta_alta", "planta_g1", "planta_cacto"], ["estante_baixa", "violao", "luminaria_chao"],
    ["cabideiro", "aparador"], ["arquivo2", "ventilador", "planta_alta3"], ["bebedouro", "planta_g3"], ["estante_livros", "poltrona_tecido", "luminaria_arco"],
    ["aparador_baixo", "planta_alta2"], ["impressora", "lixeiras", "quadro_branco"]],
  ops: [["nobreak", "carrinho_ferramentas"], ["extintor", "caixas", "ventilador"], ["arquivo2", "planta_cacto"]],
  gabinete: [["luminaria_chao", "planta_alta"], ["aparador", "cabideiro"], ["estante_baixa", "planta_g1"], ["ventilador", "planta_alta2"], ["estante_livros", "poltrona_tecido", "luminaria_arco"], ["aparador_baixo", "planta_g3"]],
};
const PEQUENOS = ["lixeira", "planta", "planta2", "extintor", "planta_fina"];
// peças desenhadas em código (efeitos.js): tamanho do quadro [w, h]
const PROCEDURAIS = { ventilador: [14, 22], hidrante: [7, 10], ring_light: [16, 36], quadro_avisos: [24, 24], lixeiras: [26, 16],
  estante_livros: [30, 42], luminaria_arco: [24, 40], poltrona_tecido: [22, 24], aparador_baixo: [34, 22], placa_expediente: [70, 34] };   // a placa tem 2 px de folga de cada lado

// Modo construção (planta.js): o que dá para pôr (só enfeite de chão, sem atividade na vida.js nem no brincar.js),
// o que só sai (a animação fica presa ao lugar) e o que não se espelha (direção, tela ou letreiro no desenho)
const CATALOGO = new Set(["planta", "planta2", "planta_fina", "planta_alta", "planta_alta2", "planta_alta3", "planta_cacto", "planta_g1", "planta_g3", "planta_g4",
  "tapete", "tapete2", "tapete3", "tapete_persa", "luminaria", "luminaria_chao", "luminaria_arco", "estante", "estante_baixa", "estante_livros", "armario", "armario2",
  "arquivo", "arquivo2", "caixas", "sofa", "sofa2", "sofa3", "sofa_cinza", "poltrona_amarela", "poltrona_azul", "poltrona_couro", "poltrona_tecido",
  "pufe_amarelo", "pufe_azul", "pufe_branco", "pufe_vermelho", "mesinha", "mesinha2", "aparador", "aparador_baixo", "cabideiro", "quadro_branco", "impressora",
  "globo", "vitrine", "cofre", "violao", "ventilador", "lixeira", "lixeiras", "extintor", "bicicleta"]);
const FIXOS = new Set(["balcao", "rack_tv"]);
const SEM_ESPELHO = new Set(["reuniao", "balcao", "rack_tv", "arcade1", "arcade2", "arcade3", "console", "estacao_gamer", "jukebox", "vendas", "vendas2", "recepcao"]);
const dePlanta = (o, k) => (o && typeof o === "object" && Object.hasOwn(o, k) ? o[k] : undefined);   // nada da planta chega ao protótipo
const coordOk = n => Number.isInteger(n) && n >= 0 && n <= 4095;
function tamanho(atlas, nome) {
  const s = typeof nome !== "string" ? null : Object.hasOwn(atlas.json.sprites, nome) ? atlas.json.sprites[nome] : Object.hasOwn(PROCEDURAIS, nome) ? [0, 0, ...PROCEDURAIS[nome]] : null;
  return s ? [s[2], s[3]] : null;
}

// Planta ruim nunca derruba a página: em qualquer exceção, o prédio sai automático
function montarPredio(atlas, config, grupos, planta) {
  if (planta === undefined) planta = config && config.planta;
  if (!planta || typeof planta !== "object") return montar(atlas, config, grupos, null);
  try { return montar(atlas, config, grupos, planta); } catch (e) {
    console.warn("Planta do escritório ignorada; o prédio saiu automático.", e && e.message);
    return montar(atlas, config, grupos, null);
  }
}

function montar(atlas, config, grupos, planta) {
  const tem = n => !!sprite(atlas, n);
  const marca = semente(config.empresa || "escritorio");   // cada empresa ganha seu próprio sorteio
  // Fileiras de no máximo 6 salas, com larguras parecidas: em cima do corredor principal, a recepção e os primeiros times;
  // embaixo dele, reunião, sala comunal, cozinha e banheiro. Os outros times e as salas de projeto (bands do Maestri)
  // ganham blocos mais abaixo, cada um com o seu corredor (uma fileira em cima, porta embaixo; outra embaixo, porta em
  // cima), ligados ao principal por um corredor que desce pela esquerda. Assim o prédio fica mais perto de 2:1
  const qtd = g => Math.max(1, g.handles.length);
  const recepcao = { tipo: "recepcao", chave: "recepcao", nome: "Recepção", tw: 10, parede: PAREDE_UNICA, piso: PISO_UNICO, mesas: [] };
  const salaDoGrupo = g => {
    const n = qtd(g), cols = Math.min(Math.max(n, 2), 4), linhas = Math.ceil(n / cols);
    return { tipo: g.tipo || "mesas", chave: "time:" + g.nome, nome: g.nome, cor: g.cor, icone: g.icone, tw: cols * MESA_W + 4,
      parede: PAREDE_UNICA, piso: PISO_UNICO, cols, linhas, handles: g.handles, mesas: [], projeto: !!g.virtual };
  };
  const fileiras = lista => {   // em n fileiras de tamanhos parecidos (no máximo 6 cada)
    const n = Math.ceil(lista.length / MAX_FILEIRA), out = [];
    for (let k = 0, i = 0; k < n; k++) { const q = Math.ceil((lista.length - i) / (n - k)); out.push(lista.slice(i, i + q)); i += q; }
    return out;
  };
  const doTime = fileiras([recepcao, ...grupos.filter(g => !g.virtual).map(salaDoGrupo)]);
  const deProjeto = fileiras(grupos.filter(g => g.virtual).map(salaDoGrupo));
  const salas = [...doTime.flat(), ...deProjeto.flat()];
  // blocos: os times que sobraram primeiro; um bloco com projetos começa por eles em cima (a faixa "Projetos" fica acima)
  const blocos = [], resto = doTime.slice(1), proj = [...deProjeto];
  while (resto.length >= 2) blocos.push({ cima: resto.shift(), baixo: resto.shift() });
  if (resto.length) blocos.push(proj.length ? { cima: proj.shift(), baixo: resto.shift() } : { cima: null, baixo: resto.shift() });
  while (proj.length) blocos.push(proj.length >= 2 ? { cima: proj.shift(), baixo: proj.shift() } : { cima: null, baixo: proj.shift() });
  const xL = blocos.length ? MX + CON_W + 1 : MX;   // as fileiras de baixo começam depois do corredor de ligação
  const larg = f => f.reduce((t, q) => t + q.tw, 0) + f.length - 1;
  const minimoBaixo = 12 + 1 + LOUNGE_MIN + 1 + 14 + 1 + WC_W;  // reunião + comunal + cozinha + banheiro
  const B = Math.max(MX + larg(doTime[0]), xL + minimoBaixo, ...blocos.flatMap(k => [k.cima, k.baixo]).filter(Boolean).map(f => xL + larg(f)));   // primeira coluna depois do prédio
  // a fileira ocupa a largura toda: a sobra vai para as salas de time por igual (a sala larga ganha um cantinho de estar)
  const porNaFileira = (f, x0, ty, portaEmCima) => {
    const sobra = B - (x0 + larg(f)), crescem = f.filter(q => q.tipo !== "recepcao"), alvo = crescem.length ? crescem : f;
    alvo.forEach((q, i) => { q.tw += Math.floor(sobra / alvo.length) + (i < sobra % alvo.length ? 1 : 0); });
    let x = x0;
    for (const q of f) { Object.assign(q, { tx: x, ty }); if (portaEmCima) q.emCima = true; x += q.tw + 1; }
    const th = PAREDE + Math.max(...f.map(q => q.linhas || 1)) * MESA_H + 2;
    for (const q of f) q.th = th;
    return th;
  };
  let y = MY;
  y += porNaFileira(doTime[0], MX, y, false);
  const corredor = { ty: y, h: CORREDOR_H }; y += CORREDOR_H;
  const yb = y, thb = PAREDE + BAIXO_PISO; y += thb;
  const rotulos = [];   // faixas com o nome do bloco (app.js desenha: a fonte só existe depois de carregar)
  for (const k of blocos) {
    y += 1;   // a parede grossa entre os blocos
    if ((k.cima || k.baixo)[0].projeto && !blocos.some(o => o !== k && o.rotulo)) { k.rotulo = true; rotulos.push({ texto: "PROJETOS", x: xL * T, y: (y - 1) * T + 3 }); }
    if (k.cima) y += porNaFileira(k.cima, xL, y, false);
    k.corredor = { ty: y, h: CORREDOR_H }; y += CORREDOR_H;
    y += porNaFileira(k.baixo, xL, y, true);
  }
  const fimPredio = y;
  const reuniao = { tipo: "reuniao", chave: "reuniao", nome: "Reunião", tx: xL, ty: yb, tw: 12, th: thb, parede: PAREDE_UNICA, piso: PISO_UNICO };
  const wc = { tipo: "banheiro", chave: "banheiro", nome: "Banheiro", tx: B - WC_W, ty: yb, tw: WC_W, th: thb, parede: 6, piso: 0 };
  const cozinha = { tipo: "cozinha", chave: "cozinha", nome: "Cozinha", tx: wc.tx - 1 - 14, ty: yb, tw: 14, th: thb, parede: 6, piso: PISO_COZINHA };
  const lounge = { tipo: "lounge", chave: "lounge", nome: "Sala comunal", tx: reuniao.tx + reuniao.tw + 1, ty: yb, th: thb, parede: PAREDE_UNICA, piso: PISO_UNICO };
  lounge.tw = cozinha.tx - 1 - lounge.tx;
  const baixo = [reuniao, lounge, cozinha, wc];   // a cozinha fica no índice 2 (efeitos.js: festaChao)
  // planta: a pintura vale mais que o times.json (valor cru); sala que não existe nesta montagem é ignorada e contada
  const resumoPlanta = { rev: planta && Number.isInteger(planta.rev) ? planta.rev : 0, aplicados: 0, ignorados: [] };
  const pinturas = planta && planta.salas && typeof planta.salas === "object" ? planta.salas : null;
  if (pinturas) for (const chaveSala of Object.keys(pinturas)) {
    const p = pinturas[chaveSala], minhas = [...salas, ...baixo].filter(s => s.chave === chaveSala);
    const parede = dePlanta(p, "parede"), piso = dePlanta(p, "piso");
    const okParede = parede === undefined || (Number.isInteger(parede) && tem(`parede${parede}_1_0`));
    const okPiso = piso === undefined || (Number.isInteger(piso) && tem(`piso${piso}`));
    if (!minhas.length || !okParede || !okPiso || (parede === undefined && piso === undefined)) { resumoPlanta.ignorados.push(chaveSala); continue; }
    for (const s of minhas) { if (parede !== undefined) s.parede = parede; if (piso !== undefined) s.piso = piso; }
    resumoPlanta.aplicados++;
  }
  const W = (B + MX) * T;
  const predioRet = { x: (MX - 1) * T, y: (MY - 1) * T, w: (B - MX + 2) * T, h: (fimPredio - MY + 2) * T };
  const H = ruaY(predioRet) + RUA_ALT + 3 + 8;
  const corredorY = (corredor.ty + 1.5) * T;
  // os corredores (o principal primeiro): onde se anda em cada um e, nos de baixo, o caminho pela ligação até o principal
  const conX0 = MX * T, conX1 = (MX + CON_W) * T, conX = (conX0 + conX1) / 2;
  const corredores = [corredor, ...blocos.map(k => k.corredor)].map((k, i) => {
    const topo = k.ty * T, yk = (k.ty + 1.5) * T;
    return Object.assign(k, { topo, alt: CORREDOR_H * T, y: yk, lig: i ? [[conX, yk], [conX, corredorY]] : [] });
  });
  for (const k of blocos) for (const q of [...(k.cima || []), ...k.baixo]) { q.corY = k.corredor.y; q.lig = k.corredor.lig; q.nc = corredores.indexOf(k.corredor); }
  const corMarca = cor("destaque");

  const fundo = document.createElement("canvas"); fundo.width = W; fundo.height = H;
  const c = fundo.getContext("2d"); c.imageSmoothingEnabled = false;
  const pc = sprite(atlas, "piso0");
  pintarExterior(c, atlas, W, H, predioRet, marca);
  // corredores: o granilite vai exatamente de parede a parede das salas; à esquerda, a entrada do prédio (no principal)
  // e o corredor de ligação, que desce do principal até os de baixo
  const cx0 = MX * T, cx1 = B * T, cT0 = corredor.ty * T, cB0 = cT0 + corredor.h * T;
  const granilite = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y += 32)
      for (let x = x0; x < x1; x += 48) { const w = Math.min(48, x1 - x), h = Math.min(32, y1 - y); c.drawImage(atlas.img, pc[0], pc[1], w, h, x, y, w, h); }
  };
  for (const k of corredores) { granilite(cx0, k.topo, cx1, k.topo + k.alt); pintaPx(c, cx1, k.topo, 3, k.alt, "#23212f"); }   // fundo de cada corredor
  const ultimo = corredores[corredores.length - 1];
  if (corredores.length > 1) { // a ligação: chão, paredes dos lados e a sombra das paredes
    granilite(conX0, cB0, conX1, ultimo.topo);
    pintaPx(c, conX0 - 3, cB0, 3, ultimo.topo + ultimo.alt - cB0, "#23212f"); pintaPx(c, conX1, cB0, 3, ultimo.topo - cB0, "#23212f");
    pintaPx(c, conX0, cB0, 2, ultimo.topo - cB0, "rgba(36,20,8,.1)"); pintaPx(c, conX1 - 2, cB0, 2, ultimo.topo - cB0, "rgba(36,20,8,.1)");
  }
  pintaPx(c, cx0 - 3, cT0, 3, 8, "#23212f"); pintaPx(c, cx0 - 3, cB0 - 8, 3, 8, "#23212f");   // batentes da entrada
  { // lado de fora: calçada de pedra portuguesa (ondas) da porta até a rua, capacho na porta e soleira por dentro
    const px0 = predioRet.x - 26, fimCaminho = predioRet.y + predioRet.h + FACHADA + 2;
    const pedra = (x, y, w, h) => {
      pintaPx(c, x, y, w, h, "#ece8de");
      c.fillStyle = "#5c5c64";
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if ((((y + j + Math.round(1.5 * Math.sin((x + i) / 3))) % 6) + 6) % 6 === 0) c.fillRect(x + i, y + j, 1, 1);
    };
    pedra(px0, cT0 + 4, cx0 - 3 - px0, corredor.h * T - 8); pedra(px0, cB0 - 4, 16, fimCaminho - cB0 + 4);
    pintaPx(c, px0 - 1, cT0 + 4, 1, fimCaminho - cT0 - 4, "#a7a49c"); pintaPx(c, px0 + 16, cB0 - 4, 1, fimCaminho - cB0 + 4, "#a7a49c");   // meio-fio do caminho
    const my = Math.round(corredorY) - 10;
    pintaPx(c, cx0 - 19, my, 15, 20, "#4a3020"); pintaPx(c, cx0 - 18, my + 1, 13, 18, "#7a5636");
    for (let y = my + 2; y < my + 18; y += 2) pintaPx(c, cx0 - 17, y, 11, 1, "#6b4a2e");   // capacho de fibra
    pintaPx(c, cx0, cT0 + 8, 3, corredor.h * T - 16, "#d6cfbf"); pintaPx(c, cx0 + 3, cT0 + 8, 1, corredor.h * T - 16, "#b5ad9c");   // soleira
  }

  const objetos = [], animados = [], vagas = [], janelas = [], portas = [];
  let estiloAtual = 0;
  const janela = (cx, base, w = 26, h = 22) => janelas.push({ x: Math.round(cx - w / 2), y: Math.round(base - h), w, h, estilo: estiloAtual });
  const pegadas = [];   // pegada no chão (parte de baixo) de cada móvel, para não encavalar
  const sobre = (r, p) => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y;
  const colide = r => pegadas.some(p => sobre(r, p));
  const reservas = [];  // trechos de parede guardados para placas: nenhum quadro nem móvel alto na frente
  // modo construção: cada peça de chão de uma sala ganha o id "<sala>|<sprite>|<k>" (k conta as chamadas daquele sprite naquela
  // sala antes de qualquer desvio, então tirar ou mover uma peça não muda o id das outras); a planta é aplicada no passe final
  const editaveis = new Map(), ocorrencias = new Map(), ligados = new Map();   // ligados: assentos e anexos que andam com a peça
  const liga = (o, chave, item) => { if (!o) return; if (!ligados.has(o)) ligados.set(o, { vagas: [], anexos: [] }); ligados.get(o)[chave].push(item); };
  const obj = (nome, cx, base, evitar = true, cheio = false) => {   // desvia de móveis, portas e passagens; cheio: pelo sprite inteiro
    const s = sprite(atlas, nome); if (!s) return null;
    // dentro de uma sala, o móvel inteiro fica entre as paredes laterais
    const sala = [...salas, ...baixo].find(q => q.pw && cx >= q.px && cx <= q.px + q.pw && base > q.py && base <= q.py + q.ph + 2);
    let id = null;
    if (sala && evitar) { const k = `${sala.chave}|${nome}`, n = ocorrencias.get(k) || 0; ocorrencias.set(k, n + 1); if (n < 100) id = `${k}|${n}`; }
    const prender = x => (sala ? Math.max(sala.px + s[2] / 2 + 1, Math.min(sala.px + sala.pw - s[2] / 2 - 1, x)) : x);
    const cx0 = cx; cx = prender(cx);
    let peg = null;
    const fundo = /^tapete/.test(nome) ? null : cheio ? s[3] : Math.max(6, s[3] * 0.35);
    if (fundo !== null) {
      const pegada = x => ({ x: x - s[2] / 2 + 1, y: base - fundo, w: s[2] - 2, h: fundo });
      if (evitar) {
        const inteiro = x => ({ x: x - s[2] / 2, y: base - s[3], w: s[2], h: s[3] });
        const d = [0, -8, 8, -16, 16, -24, 24].find(d => !colide(pegada(prender(cx + d))) && !reservas.some(q => sobre(inteiro(prender(cx + d)), q)));
        if (d === undefined) return null;
        cx = prender(cx + d);
      }
      peg = pegada(cx); pegadas.push(peg);
    }
    const dx = cx - cx0;
    usoPredio.set(nome, (usoPredio.get(nome) || 0) + 1);
    // dx: quanto o móvel andou para desviar (o assento dele anda junto)
    const o = { nome, x: Math.round(cx - s[2] / 2), y: Math.round(base - s[3]), w: s[2], h: s[3], dx, chave: /^tapete/.test(nome) ? -1 : base };
    if (id) {
      o.id = id; o.salaChave = sala.chave; o.auto = { x: Math.round(cx) - sala.px, y: Math.round(base) - sala.chao }; o.pos = { ...o.auto };
      editaveis.set(id, { o, sala, sp: s, cx, base, fundo, peg });
    }
    objetos.push(o); return o;
  };
  // sorteia entre as peças menos usadas no prédio até agora
  const usoPredio = new Map(), usoKit = new Map();
  const escolheNova = (r, lista, fora = new Set()) => {
    const ok = lista.filter(n => !fora.has(n)), base = ok.length ? ok : lista;
    const menor = Math.min(...base.map(n => usoPredio.get(n) || 0));
    return escolhe(r, base.filter(n => (usoPredio.get(n) || 0) === menor));
  };
  const paredeOcupada = [], quadros = [];
  const lugarNaParede = (w, h, cx, base) => {
    // quadro centralizado na altura da parede (nunca encostado no rodapé)
    let py = Math.round(base - 22 - h / 2);
    if (py + h > base - 5) py = base - 5 - h;
    py = Math.max(base - PAREDE * T + 4, py);
    const d = [0, 8, -8, 16, -16, 24, -24, 32, -32].find(d => !reservas.some(q => sobre({ x: Math.round(cx + d - w / 2) - 2, y: py, w: w + 4, h }, q)));
    if (d === undefined) return null;   // não cobre a placa: fica sem esse quadro
    const px = Math.round(cx + d - w / 2);
    paredeOcupada.push({ x: px - 4, w: w + 8, y: py });
    return { px, py };
  };
  const naParede = (nome, cx, base) => {
    const s = sprite(atlas, nome); if (!s) return null;
    const lugar = lugarNaParede(s[2], s[3], cx, base); if (!lugar) return null;
    const { px, py } = lugar;
    const vez = usoPredio.get(nome) || 0;
    usoPredio.set(nome, vez + 1);
    c.save();
    if (vez % 2 === 1) { c.translate(px + s[2], 0); c.scale(-1, 1); c.translate(-px, 0); }   // espelhada
    if (vez >= 2) c.filter = `hue-rotate(${(vez * 67) % 300 + 30}deg)`;                       // outra cor
    c.drawImage(atlas.img, s[0], s[1], s[2], s[3], px, py, s[2], s[3]);
    c.restore();
    const q = { nome, x: px, y: py, w: s[2], h: s[3] }; quadros.push(q); return q;
  };
  // trecho de parede sem quadro e sem móvel alto subindo na frente (onde cabe janela ou quadro)
  const paredeLivreEm = (x0, x1, chao) => paredeOcupada.every(o => x1 < o.x || x0 > o.x + o.w || o.y < chao - PAREDE * T - 8 || o.y > chao)
    && objetos.every(o => o.chave < 0 || !o.w || o.y >= chao - 4 || o.y + o.h <= chao - PAREDE * T || x1 < o.x || x0 > o.x + o.w);   // só o que sobe nesta parede
  const vaga = (sala, x, y, tipo) => { const v = { sala, x: Math.round(x), y: Math.round(y), tipo }; vagas.push(v); return v; };
  const junto = (sala, o, x, y, tipo) => { if (!o) return null; const v = vaga(sala, x + o.dx, y, tipo); liga(o, "vagas", v); return v; };   // assento de um móvel (some se ele não coube)

  // ---------------- salas de cima
  let vizinha = new Set();   // peças da sala anterior na mesma fileira (a vizinha nunca repete)
  for (const s of salas) {
    pintarSala(c, atlas, s);
    const minhas = new Set(), anterior = vizinha; vizinha = minhas;
    s.px = s.tx * T; s.py = s.ty * T; s.pw = s.tw * T; s.ph = s.th * T; s.luz = 1;
    const chao = s.py + PAREDE * T, baseParede = chao - 3, fim = s.py + s.ph;
    s.chao = chao;
    s.porta = s.emCima ? { x: s.px + 18, y: s.py, emCima: true } : { x: s.px + 14, y: fim };
    if (s.emCima) s.portas = [s.porta.x];
    s.faixaX = s.px + 10;
    const livre = (x, y, w, h) => pegadas.push({ x, y, w, h, livre: true });
    const r = rng(semente(s.nome));
    estiloAtual = semente(s.nome + "j") % 5;
    if (s.tipo === "recepcao") {
      s.porta.x = s.px + s.pw / 2;
      livre(s.porta.x - 22, fim - 30, 44, 30);                          // frente da porta
      { const tp = tamanhoPlaca(s), x = s.porta.x + 18; s.placa = { x, y: fim - 10, ...tp, max: s.px + s.pw - 4 - x }; livre(x - 3, fim - 12, tp.total + 6, 12); }
      s.placaLogo = { x: s.px + s.pw / 2 - 16, y: s.py + 8, w: 32, h: 26 };
      c.fillStyle = "#1b1a26"; c.fillRect(s.placaLogo.x - 2, s.placaLogo.y - 2, 36, 30); c.fillStyle = "#0d1020"; c.fillRect(s.placaLogo.x, s.placaLogo.y, 32, 26);
      janela(s.px + 24, baseParede - 10);
      naParede(tem("relogio") ? "relogio" : "quadro", s.px + s.pw - 22, baseParede - 10);
      obj("recepcao", s.px + s.pw / 2, chao + 34);
      obj("planta_alta", s.px + 10, chao + 30);
      obj("planta_alta3", s.px + s.pw - 10, chao + 30);
      const pa = obj("poltrona_azul", s.px + 28, fim - 6);
      const pb = obj("poltrona_amarela", s.px + 52, fim - 6);
      obj("mesinha", s.px + 40, fim - 2);
      animados.push({ tipo: "gato", ...ancorar(atlas, "gato_0", s.px + s.pw - 36, chao + 58) });   // longe da placa da fachada
      // assento preso à poltrona; sem ela no automático (não coube), fica o ponto de espera de sempre
      const assento = (o, x) => (o ? junto(s, o, x, fim - 8, "recepcao") : vaga(s, x, fim - 8, "recepcao"));
      s.vagasLivres = [assento(pa, s.px + 28), assento(pb, s.px + 52)];
      continue;
    }
    if (s.emCima) livre(s.porta.x - 22, chao - 2, 44, 36); else livre(s.porta.x - 20, fim - 34, 40, 34);
    livre(s.px, chao, 24, fim - chao);   // porta e corredor interno
    for (let i = 0; i < (s.cols || 0) * (s.linhas || 0); i++) { // rota fixa de saída de cada mesa (saidaMesa da vida.js, sem grade):
      const cx = s.px + 2 * T + (i % s.cols) * MESA_W * T, cy = chao + 8 + Math.floor(i / s.cols) * MESA_H * T;   // coluna da saída e faixa até o corredor
      livre(cx + 40, cy + 14, 12, 34); livre(s.faixaX, cy + 36, cx + 52 - s.faixaX, 12);
    }
    // placa: na fachada, ao lado da porta (sala de cima) ou no alto da parede, ao lado da porta (sala de baixo)
    {
      const tp = tamanhoPlaca(s), x = s.porta.x + (s.emCima ? 20 : 18);
      s.placa = { x, y: s.emCima ? s.py + 4 : fim - 10, ...tp, max: s.px + s.pw - (s.emCima ? 34 : 4) - x };   // em baixo, longe dos móveis altos da direita
      if (s.emCima) paredeOcupada.push({ x: x - 2, w: Math.min(tp.total, s.placa.max) + 4, y: s.py + 4 }); else livre(x - 3, fim - 12, tp.total + 6, 12);
    }
    const tipo = DECOR_CHAO[s.tipo] ? s.tipo : "mesas", funcao = funcaoDaSala(s), corTime = corDoTime(s);
    if (!PISOS_DO_TIME.has(s.piso)) pintarTapete(c, s, chao, corTime);   // a cor do time: o tapete sob as mesas e a faixa no alto da parede
    // sala mais larga que as mesas (a última da fileira cresce até o fim): cantinho do time no espaço que sobra
    let cantinho = false;
    {
      const zx0 = s.px + 2 * T + s.cols * MESA_W * T + 6, zx1 = s.px + s.pw - 34, m = Math.round((zx0 + zx1) / 2);
      if (tipo === "mesas" && zx1 - zx0 >= 60) {
        // canto de estar: tapete, sofá e mesinha centrados; a peça alta (ring light ou quadro branco) de lado, junto da parede
        cantinho = !!obj(funcao === "marketing" ? "ring_light" : "quadro_branco", zx1 - 10, chao + 40) && funcao === "marketing";
        obj("tapete2", m - 6, fim - 2);
        const sofa = obj("sofa_cinza", m - 6, fim - 6); junto(s, sofa, m - 6 - 0.6 * T, fim - 12, "papo"); junto(s, sofa, m - 6 + 0.6 * T, fim - 12, "papo");
        if (fim - chao > 90) obj("mesinha", m - 6, fim - 32);
      }
    }
    // faixa da direita: peças da cara do time e depois as sorteadas, uma atrás da outra sem se cobrirem
    const dx = s.px + s.pw - 16;
    const fixos = (FIXOS_CHAO[tipo] || []).filter(tem), fila = [];
    while (fila.length < Math.min(2, fixos.length)) fila.push(escolheNova(r, fixos, new Set(fila)));
    const kits = (KITS[tipo] || []).map(k => k.filter(tem)).filter(k => k.length);
    if (kits.length) {
      const menor = Math.min(...kits.map(k => usoKit.get(k.join()) || 0)), kit = escolhe(r, kits.filter(k => (usoKit.get(k.join()) || 0) === menor));
      usoKit.set(kit.join(), menor + 1);
      for (const n of kit) if (!fila.includes(n)) fila.push(n);
    }
    const opcoesChao = DECOR_CHAO[tipo].filter(tem);
    while (fila.length < 5 && opcoesChao.length) fila.push(escolheNova(r, opcoesChao, new Set([...fila, ...anterior])));
    if (funcao === "marketing" && !cantinho) fila.unshift("ring_light");   // ring light encostada na parede, antes das outras peças
    fila.forEach(n => minhas.add(n));
    let baseAnt = null, lado = 1;
    for (const nome of fila) {
      const sp = sprite(atlas, nome); if (!sp) continue;
      // a primeira encosta na parede; as outras começam abaixo da anterior (sem virar torre) e alternam o lado
      const base = baseAnt === null ? chao + 16 : baseAnt + 3 + sp[3];
      if (base > fim - 6) continue;                              // não coube: tenta a próxima (menor)
      if (obj(nome, dx + lado * Math.min(4, Math.max(0, 28 - sp[2]) / 2), base, true)) { baseAnt = base; lado = -lado; }
    }
    obj(escolheNova(r, PEQUENOS.filter(tem)) || "planta", s.px + s.pw - 40, fim - 3, true, true);
    // parede: placa do time à esquerda; quadros no meio, sem invadir a faixa dos móveis altos; a janela no fim
    // ar-condicionado no alto da parede, entre a porta e os quadros (Ops sempre; os outros times, metade)
    if (!s.emCima && (tipo === "ops" || r() < 0.5)) { animados.push({ tipo: "ar", parede: true, x: s.px + 39, y: s.py + 5, w: 22, h: 8, sala: s }); paredeOcupada.push({ x: s.px + 35, w: 30, y: s.py + 5 }); }
    const paredeIni = s.emCima ? Math.max(s.px + 70, s.placa.x + Math.min(s.placa.total, s.placa.max) + 24) : s.px + 70, paredeFim = s.px + s.pw - 34;
    const nQuadros = paredeFim - paredeIni < 30 ? 0 : Math.max(1, Math.floor((paredeFim - paredeIni) / 48));   // sala estreita: a placa já ocupa a parede
    const opcoesParede = DECOR_PAREDE[tipo].filter(tem);
    const usados = new Set(anterior);
    for (let i = 0; i < nQuadros; i++) {
      const cx = paredeIni + (i + 0.5) * ((paredeFim - paredeIni) / nQuadros);
      if (i === nQuadros - 1 && nQuadros > 1 && paredeLivreEm(cx - 17, cx + 17, chao)) { janela(cx, baseParede - 10, 30, 22); paredeOcupada.push({ x: cx - 19, w: 38, y: baseParede - 32 }); continue; }
      if (i === 0 && ASSINATURAS[funcao]) { // peça-assinatura da função do time, no primeiro trecho da parede
        const [w, h, desenha] = ASSINATURAS[funcao], lugar = lugarNaParede(w, h, cx, baseParede);
        if (lugar) { desenha(c, lugar.px, lugar.py, rng(semente(s.nome + "a")), corTime); quadros.push({ nome: "assinatura_" + funcao, x: lugar.px, y: lugar.py, w, h }); continue; }
      }
      if (tipo === "ops" && i === 0 && !anterior.has("telas_noc") && (usoPredio.get("telas_noc") || 0) <= (usoPredio.get("tv_grafico") || 0)) { usoPredio.set("telas_noc", (usoPredio.get("telas_noc") || 0) + 1); minhas.add("telas_noc"); const t = ancorar(atlas, "telas_noc_0", cx, baseParede - 4); if (t.w) { animados.push({ tipo: "telas_noc", parede: true, ...t }); paredeOcupada.push({ x: t.x - 4, w: t.w + 8, y: t.y }); continue; } }
      const nome = escolheNova(r, opcoesParede, usados); usados.add(nome); minhas.add(nome);
      naParede(nome, cx, baseParede - (nome === "relogio" ? 8 : 0));
    }
    // mesas (2 tiles de corredor à esquerda, 2 tiles de decoração à direita)
    for (let i = 0; i < s.cols * s.linhas; i++) {
      const col = i % s.cols, lin = Math.floor(i / s.cols);
      const cx = s.px + 2 * T + col * MESA_W * T, cy = chao + 8 + lin * MESA_H * T;
      const mesa = { sala: s, x: cx + 24, topo: cy + 14, pe: cy + 21, saida: cx + 46, corredor: cy + 42, handle: s.handles[i] || null };
      const rm = rng(semente((s.handles[i] || s.nome) + i));
      mesa.estilo = semente(s.nome) % ESTILOS_MESA.length; mesa.itens = 1 + Math.floor(rm() * 31); mesa.monitores = 1 + Math.floor(rm() * 2.4);
      mesa.corItem = escolhe(rm, ["#e8587a", "#3a92e6", "#f2a93b", "#3fb35c", "#9566e6"]); mesa.cadeira = semente(s.nome + "c") % CORES_CADEIRA.length; mesa.cadeiraEstilo = semente(s.nome + "ce") % 3;
      mesa.abajur = mesa.monitores === 1 && rm() < 0.6;   // com 2 monitores não sobra canto para ele
      mesa.pato = funcao === "dev" && i === semente(s.nome + "pato") % (s.cols * s.linhas);
      s.mesas.push(mesa);
      objetos.push({ tipo: "cadeira", x: mesa.x, y: mesa.pe, chave: mesa.pe - 1, cor: mesa.cadeira, estilo: mesa.cadeiraEstilo });
      objetos.push({ tipo: "mesa", mesa, x: mesa.x, y: mesa.topo, chave: mesa.topo + 17 });
    }
    // entre as fileiras: jardineira ou divisória baixa na cor do time, logo abaixo do caminho de quem anda
    if (tipo !== "gabinete") for (let lin = 0; lin < s.linhas - 1; lin++) {   // (Ops: sempre a divisória)
      const y = chao + 8 + lin * MESA_H * T + 44, x = s.px + 2 * T + 6, w = s.cols * MESA_W * T - 12;
      objetos.push({ nome: tipo === "mesas" && semente(s.nome + "d") % 2 ? "jardineira" : "divisoria", x, y, w, h: 9, dx: 0, chave: y + 9, cor: corTime });
      pegadas.push({ x, y: y + 5, w, h: 4 });
    }
  }

  // ---------------- salas de baixo
  for (const s of baixo) {
    pintarSala(c, atlas, s);
    estiloAtual = semente(s.nome + "j") % 5;
    Object.assign(s, { px: s.tx * T, py: s.ty * T, pw: s.tw * T, ph: s.th * T, luz: 1 });
    s.chao = s.py + PAREDE * T; s.faixa = s.chao + 3.6 * T; s.portas = [];
  }
  const fimB = reuniao.py + reuniao.ph;
  // portas: abrem a parede de cima para o corredor
  reuniao.portas.push(reuniao.px + reuniao.pw / 2);
  cozinha.portas.push(cozinha.px + cozinha.pw - 26);   // na ponta: a bancada corre inteira pela parede
  wc.portas.push(wc.px + wc.pw - 24);                  // na ponta direita: a fila do corredor fica na frente do próprio banheiro
  const reservarPorta = (s, px) => pegadas.push({ x: px - 22, y: s.chao - 2, w: 44, h: 36, livre: true });
  for (const s of [reuniao, cozinha, wc]) for (const px of s.portas) reservarPorta(s, px);
  // Placa no alto da parede, no trecho livre (sem porta, janela, quadro, TV, relógio ou logo) mais perto da porta;
  // se a parede não tiver um trecho do tamanho dela, a placa encolhe (o nome espreme) em vez de cobrir algo
  const placaBaixo = s => {
    const tp = tamanhoPlaca(s), d = s.portas[0], y = s.py + 4, cont = tp.total - tp.w;
    const cabe = (x, w) => x >= s.px + 4 && x + w <= s.px + s.pw - 4 && paredeLivreEm(x - 2, x + w + 2, s.chao)
      && s.portas.every(p => x > p + 18 || x + w < p - 18) && janelas.every(j => x > j.x + j.w + 4 || x + w < j.x - 4);
    let achou = null;
    for (let total = tp.total; total >= cont + 34 && !achou; total -= 8)
      for (let k = 0; k <= s.pw && !achou; k += 2)   // anda para os dois lados a partir da porta
        for (const x of [d + 20 + k, d - 20 - total - k]) if (cabe(x, total)) { achou = { x, total }; break; }
    achou = achou || { x: d + 20, total: tp.total };
    s.placa = { x: achou.x, y, w: achou.total - cont, total: achou.total, max: achou.total };
    paredeOcupada.push({ x: achou.x - 2, w: achou.total + 4, y });
  };

  // Reunião: mesa grande com cadeiras, tela na parede, plantas
  {
    const s = reuniao, cx = s.px + s.pw / 2, chao = s.chao;
    // a porta fica no meio da parede: a tela vai para a esquerda dela (a placa vai para a direita) e a janela no canto
    naParede(tem("tela_reuniao") ? "tela_reuniao" : "lousa", s.px + 50, chao - 3);
    janela(s.px + 16, chao - 14, 22, 22);
    obj("tapete3", cx, chao + 5.4 * T + 6);   // tapete ancorando a mesa
    const mesa = obj("reuniao", cx, chao + 5.4 * T);
    obj("planta_g1", s.px + 12, chao + 1.6 * T); obj("planta_g3", s.px + s.pw - 12, chao + 1.6 * T);
    obj("quadro_branco", s.px + s.pw - 20, chao + 5.4 * T);   // na altura da mesa, para a apresentação
    if (mesa) { // mesa de frente (efeitos.js): o tampo e os encostos de trás são anexos, para quem senta ficar entre as camadas
      for (const [nome, dy] of [["reuniao_fundo", 10], ["reuniao_mesa", 36]]) {
        const a = { nome, x: mesa.x, y: mesa.y, w: mesa.w, h: mesa.h, dx: 0, chave: mesa.y + dy }; objetos.push(a); liga(mesa, "anexos", a);
      }
      // pé de quem senta em cada cadeira (três atrás, olhando para baixo, e três de costas na frente) e para onde olha
      for (const cx0 of [19, 38, 57]) for (const [cy0, olha] of [[19, "baixo"], [44, "cima"]]) {
        const v = vaga(s, mesa.x + cx0, mesa.y + cy0, "reuniao"); v.olha = olha; liga(mesa, "vagas", v);
      }
    }
  }
  // Cozinha de verdade: bancada contínua na parede (geladeira na ponta, pia sob a janela, cooktop com coifa e
  // micro-ondas no tampo) e o balcão do café no fim; mesas de refeição alinhadas no meio, com a frente do café livre
  // para a roda (vida.js); filtro, recicláveis e máquinas de venda no canto de baixo (montados depois da sala comunal)
  {
    const s = cozinha, chao = s.chao, L = s.px, base = chao + 22;
    obj(tem("geladeira2") ? "geladeira2" : "geladeira", L + 16, chao + 14);
    const b = { nome: "bancada", x: L + 29, y: base - 30, w: 96, h: 30, dx: 0, chave: base, pia: 18, fogao: 52 };
    objetos.push(b); pegadas.push({ x: b.x, y: base - 12, w: b.w, h: 12 });
    janela(b.x + b.pia + 8, chao - 18, 26, 22); paredeOcupada.push({ x: b.x + b.pia - 7, w: 30, y: chao - 40 });
    { // coifa de inox sobre o cooktop
      const hx = b.x + b.fogao + 10;
      pintaPx(c, hx - 3, chao - 46, 6, 24, "#b8bec8"); pintaPx(c, hx - 3, chao - 46, 1, 24, "#d9dde4");
      for (let k = 0; k < 8; k++) pintaPx(c, hx - 5 - k, chao - 22 + k, 10 + 2 * k, 1, k < 7 ? "#c9ced8" : "#8a909c");
      pintaPx(c, hx - 11, chao - 15, 22, 1, "#6b7280");
      paredeOcupada.push({ x: hx - 14, w: 28, y: chao - 46 });
    }
    vaga(s, b.x + b.fogao + 10, chao + 2.6 * T, "cozinha");
    const bal = obj("balcao", L + 146, base);   // máquina de café: centro da roda de café
    if (bal) { const a = { tipo: "cafe", ...ancorar(atlas, "cafe_0", bal.x + bal.w / 2, bal.y + 4), chave: bal.chave + 0.1 }; animados.push(a); liga(bal, "anexos", a); }
    junto(s, bal, L + 146, chao + 2.8 * T, "cafe");
    const m1 = obj("mesa_cozinha", L + 44, chao + 100), m2 = obj("mesa_cozinha2", L + 92, chao + 100);
    for (const m of [m1, m2]) if (m) { liga(m, "vagas", vaga(s, m.x + 6, m.y + m.h - 6, "lanche")); liga(m, "vagas", vaga(s, m.x + m.w - 6, m.y + m.h - 6, "lanche")); }
    // placa no alto da parede, logo à esquerda da porta (a bancada é baixa: cabe embaixo dela)
    const tp = tamanhoPlaca(s), x = s.portas[0] - 20 - tp.total;
    s.placa = { x, y: s.py + 4, w: tp.w, total: tp.total, max: tp.total };
    paredeOcupada.push({ x: x - 2, w: tp.total + 4, y: s.py + 4 });
  }
  // Banheiro: piso de pastilhas, três cabines na parede do fundo (o vago e o ocupado são do vida.js; app.js: desenharCabines),
  // a bancada com duas cubas e o espelho, o secador de mãos com a lixeira e um vaso no canto. A porta fica na ponta direita
  const cabines = [];
  {
    const s = wc, chao = s.chao, L = s.px;
    pintarBanheiro(c, s);
    for (let i = 0; i < WC_CABINES; i++) {
      const x = L + 4 + i * CABINE.w;
      pintarCabine(c, x, chao);
      cabines.push({ x: x + 1 + CABINE.w / 2, y: chao + CABINE.fundo + 7, px: x, chao, ocupada: false });
    }
    pegadas.push({ x: L + 2, y: chao - 2, w: WC_CABINES * CABINE.w + 4, h: CABINE.fundo + 2 });   // cabines
    paredeOcupada.push({ x: L + 2, w: WC_CABINES * CABINE.w + 4, y: chao - CABINE.alto });
    const xb = L + 6 + WC_CABINES * CABINE.w;   // secador e lixeira entre as cabines e a bancada
    pintarSecador(c, xb + 2, chao - 28); paredeOcupada.push({ x: xb, w: 14, y: chao - 28 });
    pintarLixeiraWc(c, xb + 3, chao + 18); pegadas.push({ x: xb + 2, y: chao + 6, w: 12, h: 12 });
    const bx = xb + 14, bw = s.portas[0] - 22 - bx;   // a bancada vai até perto da porta
    pintarBancada(c, bx, chao, bw); pegadas.push({ x: bx, y: chao - 2, w: bw, h: 22 });
    paredeOcupada.push({ x: bx, w: bw, y: chao - 28 });
    obj("planta_alta", L + 18, fimB - 4, false);
    obj("planta_fina", L + s.pw - 16, fimB - 4, false);
    // placa no alto da parede, logo à esquerda da porta (o espelho fica embaixo dela)
    const tp = tamanhoPlaca(s), x = s.portas[0] - 20 - tp.total;
    s.placa = { x, y: s.py + 4, w: tp.w, total: tp.total, max: tp.total };
    paredeOcupada.push({ x: x - 2, w: tp.total + 4, y: s.py + 4 });
  }
  placaBaixo(reuniao);   // as da sala comunal saem depois dos cantinhos
  // Sala comunal por cantinhos: entram na ordem enquanto houver largura
  {
    const s = lounge, chao = s.chao, fim = fimB;
    // jogos de parede (vida.js joga sozinho ou em dupla): a peça na parede e a vaga no chão da frente, olhando para cima
    const jogoNaParede = (nome, tipoVaga, w, h, x, dist, desenha) => {
      const pe = { x: x - 8, y: chao + dist - 8, w: 16, h: 14 };
      if (!paredeLivreEm(x - w / 2 - 4, x + w / 2 + 4, chao) || colide(pe)) return false;
      const lugar = lugarNaParede(w, h, x, chao - 3); if (!lugar) return false;
      desenha(lugar.px, lugar.py); quadros.push({ nome, x: lugar.px, y: lugar.py, w, h }); reservas.push({ x: lugar.px - 2, y: lugar.py, w: w + 4, h });
      vaga(s, x, chao + dist, tipoVaga).olha = "cima";
      pegadas.push({ ...pe, livre: true });
      return true;
    };
    const alvoDardos = (x, y) => {
      pintaPx(c, x, y, 18, 20, "#5a3d26"); pintaPx(c, x + 1, y + 1, 16, 18, "#3e2716");
      for (let j = 0; j < 15; j++) for (let i = 0; i < 15; i++) {
        const d = Math.hypot(i - 7, j - 7); if (d > 7.3) continue;
        const ang = Math.floor(((Math.atan2(j - 7, i - 7) + Math.PI) / (Math.PI * 2)) * 10) % 2;
        pintaPx(c, x + 2 + i, y + 2 + j, 1, 1, d < 1.2 ? "#c8102e" : d < 2.2 ? "#2f9a4a" : d > 6.2 ? (ang ? "#c8102e" : "#2f9a4a") : ang ? "#1b1b22" : "#e9dcc0");
      }
      pintaPx(c, x + 12, y + 5, 3, 1, "#e0a91c"); pintaPx(c, x + 6, y + 11, 3, 1, "#3a92e6");   // dois dardos cravados
    };
    const cestaBasquete = (x, y) => {
      pintaPx(c, x, y, 24, 14, "#c9ccd4"); pintaPx(c, x + 1, y + 1, 22, 12, "#f6f6f2");
      pintaPx(c, x + 8, y + 5, 8, 1, "#d23c3c"); pintaPx(c, x + 8, y + 5, 1, 6, "#d23c3c"); pintaPx(c, x + 15, y + 5, 1, 6, "#d23c3c");   // quadradinho da tabela
      pintaPx(c, x + 7, y + 12, 10, 2, "#f2711c"); pintaPx(c, x + 7, y + 12, 10, 1, "#ff9a4d");                                         // aro
      for (let k = 0; k < 4; k++) pintaPx(c, x + 8 + k * 2 + (k > 1 ? 1 : 0), y + 14, 1, 6 - Math.abs(k - 1.5), "#e9ecf2");             // rede
      pintaPx(c, x + 9, y + 18, 6, 1, "#e9ecf2");
    };
    const cantos = [
      [8, zx => { // TV e videogame
        obj("tapete", zx + 4 * T, chao + 3.2 * T);
        const tv = obj("rack_tv", zx + 4 * T, chao + 10);
        if (tv) { const a = { tipo: "tela", nome: "rack_tv", para: ["videogame", "tv"], ...telaDe(atlas, "rack_tv", tv.x + tv.w / 2, tv.y + tv.h) }; animados.push(a); liga(tv, "anexos", a); }
        junto(s, obj("pufe_amarelo", zx + 2.8 * T, chao + 2.7 * T), zx + 2.8 * T, chao + 2.4 * T, "videogame");
        junto(s, obj("pufe_azul", zx + 5.2 * T, chao + 2.7 * T), zx + 5.2 * T, chao + 2.4 * T, "videogame");
        // nas laterais da TV, os jogos de parede (vida.js): alvo de dardos à esquerda e cesta de basquete à direita
        jogoNaParede("alvo_dardos", "dardos", 18, 20, zx + 1.2 * T, 2.5 * T, alvoDardos);
        jogoNaParede("cesta_basquete", "basquete", 24, 22, zx + 6.8 * T, 3 * T, cestaBasquete);
        obj("tapete2", zx + 4 * T, fim - 2);
        { const o = obj("sofa", zx + 4 * T, fim - 6); junto(s, o, zx + 3 * T, fim - 12, "tv"); junto(s, o, zx + 5 * T, fim - 12, "tv"); }
        obj("luminaria", zx + 0.7 * T, fim - 4);
      }],
      [9, zx => { // painel com o logo da empresa e sofá
        const logo = { x: zx + 4.5 * T - 44, y: chao - 44, w: 88, h: 38 };
        if (s.logo || reservas.some(q => sobre({ x: logo.x - 4, y: logo.y - 4, w: logo.w + 8, h: logo.h + 8 }, q))) return false;   // um painel só, longe da placa
        s.logo = logo;
        paredeOcupada.push({ x: s.logo.x - 4, w: s.logo.w + 8, y: s.logo.y });
        obj("tapete", zx + 4.5 * T, fim - 4);
        { const o = obj("sofa3", zx + 4.5 * T, fim - 8); junto(s, o, zx + 3.6 * T, fim - 16, "papo"); junto(s, o, zx + 5.4 * T, fim - 16, "papo"); }
        obj("mesinha", zx + 4.5 * T, fim - 34);
        obj("planta_g1", zx + 0.7 * T, chao + 1.4 * T); obj("planta_g3", zx + 8.3 * T, chao + 1.4 * T);
      }],
      [7, zx => { // fliperamas e sinuca
        ["arcade1", "arcade2", "arcade3"].forEach((n, i) => junto(s, obj(n, zx + (1.2 + i * 2.2) * T, chao + 8), zx + (1.2 + i * 2.2) * T, chao + 1.8 * T, "arcade"));
        obj("tapete3", zx + 3.5 * T, fim - 2);
        { const o = obj(marca % 2 && tem("sinuca2") ? "sinuca2" : "sinuca", zx + 3.5 * T, fim - 8); junto(s, o, zx + 1 * T, fim - 22, "sinuca"); junto(s, o, zx + 6 * T, fim - 22, "sinuca"); }
      }],
      [6, zx => { // pebolim e dardos
        naParede("dardos", zx + 1.5 * T, chao - 12); naParede("neon", zx + 4 * T, chao - 4);
        { const o = obj("pebolim", zx + 3 * T, chao + 3 * T); junto(s, o, zx + 0.8 * T, chao + 2.6 * T, "pebolim"); junto(s, o, zx + 5.2 * T, chao + 2.6 * T, "pebolim"); }
        obj("tapete2", zx + 3 * T, fim - 2);
        { const o = obj("sofa2", zx + 3 * T, fim - 6); junto(s, o, zx + 2.2 * T, fim - 12, "papo"); junto(s, o, zx + 3.8 * T, fim - 12, "papo"); }
      }],
      [6, zx => { // pingue-pongue
        naParede("poster1", zx + 3 * T, chao - 4);
        // a mesa sobe 12 px da parede de baixo: o jogador de baixo fica numa faixa livre, com passagem pelos lados
        { const o = obj("pingpong", zx + 3 * T, fim - 22); junto(s, o, zx + 3 * T, chao + 1.2 * T, "pingpong"); junto(s, o, zx + 3 * T, fim - 10, "pingpong"); }
        obj("planta_cacto", zx + 0.6 * T, chao + 1.4 * T);   // a planta_g2 é de pendurar: não vai no chão
      }],
      [5, zx => { // canto gamer
        naParede("poster2", zx + 2.5 * T, chao - 4);
        junto(s, obj("estacao_gamer", zx + 2.5 * T, chao + 2.4 * T), zx + 2.5 * T, chao + 1.3 * T, "pc");
        junto(s, obj("pufe_vermelho", zx + 1.5 * T, fim - 8), zx + 1.5 * T, fim - 12, "pufe");
        junto(s, obj("pufe_branco", zx + 3.5 * T, fim - 8), zx + 3.5 * T, fim - 12, "pufe");
      }],
      [5, zx => { // música
        naParede("trofeus", zx + 2.5 * T, chao - 8);
        junto(s, obj("piano", zx + 2.5 * T, chao + 1.8 * T), zx + 2.5 * T, chao + 2.6 * T, "musica");
        obj("violao", zx + 0.8 * T, chao + 2 * T);
        junto(s, obj("poltrona_couro", zx + 2.5 * T, fim - 6), zx + 2.5 * T, fim - 12, "poltrona");
      }],
      [5, zx => { // leitura e aquário
        obj("armario2", zx + 1.2 * T, chao + 10); obj("aquario", zx + 3.6 * T, chao + 1.8 * T);
        junto(s, obj("poltrona_amarela", zx + 1.5 * T, fim - 6), zx + 1.5 * T, fim - 12, "poltrona");
        junto(s, obj("mesinha2", zx + 3.2 * T, fim - 4), zx + 4 * T, fim - 16, "papo");
        obj("luminaria", zx + 4.6 * T, fim - 4);
      }],
      [5, zx => { // café e conversa
        obj("bebedouro", zx + 0.8 * T, chao + 8); obj("vendas2", zx + 2.6 * T, chao + 10);
        vaga(s, zx + 1.8 * T, chao + 2.6 * T, "cafe"); vaga(s, zx + 3.6 * T, chao + 2.8 * T, "papo");
        obj("planta_g4", zx + 4.4 * T, fim - 4); obj("bicicleta", zx + 2 * T, fim - 4);
      }],
      [6, zx => { // biblioteca
        naParede("prateleira", zx + 3 * T, chao - 10);
        obj("estante_baixa", zx + 1.6 * T, chao + 12); obj("planta_cacto", zx + 5 * T, chao + 14);
        junto(s, obj("poltrona_azul", zx + 1.6 * T, fim - 6), zx + 1.6 * T, fim - 12, "poltrona");
        obj("luminaria_chao", zx + 0.5 * T, fim - 4);
        { const o = obj("sofa_cinza", zx + 4 * T, fim - 6); junto(s, o, zx + 3.4 * T, fim - 12, "papo"); junto(s, o, zx + 4.6 * T, fim - 12, "papo"); }
      }],
      [5, zx => { // copa
        temCopa = true;
        junto(s, obj("cafeteira", zx + 1 * T, chao + 12), zx + 1 * T, chao + 2.4 * T, "cafe");
        junto(s, obj("geladeira_bebidas", zx + 2.6 * T, chao + 12), zx + 2.8 * T, chao + 2.6 * T, "papo");
        const m = obj("mesinha", zx + 2.5 * T, fim - 14);
        if (m && tem("fruteira")) { const f = obj("fruteira", m.x + m.w / 2, m.y + 9, false); if (f) { f.chave = m.chave + 0.1; liga(m, "anexos", f); } }
        junto(s, m, zx + 1.3 * T, fim - 8, "lanche"); junto(s, m, zx + 3.7 * T, fim - 8, "lanche");
        obj("planta_alta2", zx + 4.4 * T, chao + 1.6 * T);
      }],
      [6, zx => { // jukebox e xadrez
        naParede("poster3", zx + 4 * T, chao - 6);
        junto(s, obj("jukebox", zx + 1.3 * T, chao + 12), zx + 1.3 * T, chao + 2.6 * T, "musica");
        { const o = obj("mesa_xadrez", zx + 3.9 * T, chao + 3.4 * T); junto(s, o, zx + 2.6 * T, chao + 3.2 * T, "papo"); junto(s, o, zx + 5.2 * T, chao + 3.2 * T, "papo"); }
        junto(s, obj("poltrona_couro", zx + 2 * T, fim - 6), zx + 2 * T, fim - 12, "poltrona");
        obj("planta_g3", zx + 5.1 * T, fim - 4);
      }, ["jukebox", "mesa_xadrez"]],
      [6, zx => { // descanso: rede e pipoca
        obj("planta_alta", zx + 0.8 * T, chao + 1.6 * T);
        junto(s, obj("pipoqueira", zx + 3 * T, chao + 12), zx + 3 * T, chao + 2.6 * T, "papo");
        { const o = obj("rede_descanso", zx + 3 * T, fim - 6); junto(s, o, zx + 5.4 * T, fim - 12, "papo"); }
        obj("luminaria", zx + 5.4 * T, chao + 1.8 * T);
      }, ["rede_descanso", "pipoqueira"]],
      [5, zx => { // console retrô na TV de parede
        const tv = naParede("tv_parede", zx + 2.5 * T, chao - 6);
        if (tv) { const q = TELAS.tv_parede; animados.push({ tipo: "tela", nome: "tv_parede", parede: true, para: ["videogame"], x: tv.x + q[0], y: tv.y + q[1], w: q[2], h: q[3], chave: -1 }); }
        obj("console", zx + 2.5 * T, chao + 22);
        junto(s, obj("pufe_vermelho", zx + 1.4 * T, chao + 3.4 * T), zx + 1.4 * T, chao + 3.1 * T, "videogame");
        junto(s, obj("pufe_amarelo", zx + 3.6 * T, chao + 3.4 * T), zx + 3.6 * T, chao + 3.1 * T, "videogame");
        obj("planta_g4", zx + 0.6 * T, fim - 4);
      }, ["tv_parede", "console"]],
      [8, zx => { // ringue da vida social (vida.js): cordas sólidas para o caminho, com a entrada no meio da frente
        if (s.ringue) return false;
        const { w, h, abertura } = RINGUE, x = zx + T, y = chao + 26;
        if (colide({ x: x - 4, y: y - 20, w: w + 8, h: h + 32 })) return false;
        // o ringue só aparece na briga (app.js desenha a arte, as cordas e o placar): no resto do tempo é chão livre, com
        // a marcação da arena em fita no piso; o espaço fica guardado (nenhum móvel entra) e ninguém esbarra em corda
        const arte = document.createElement("canvas"); arte.width = w + 8; arte.height = h + 28;
        const ac = arte.getContext("2d"); ac.imageSmoothingEnabled = false;
        pintarRingue(ac, 4, 16, w, h, abertura, corMarca);
        const fita = "rgba(244,234,216,.5)";   // fita creme, discreta: marca o chão sem parecer seleção
        for (let k = 0; k < w; k += 6) { pintaPx(c, x + k, y, 3, 1, fita); pintaPx(c, x + k, y + h - 1, 3, 1, fita); }
        for (let k = 0; k < h; k += 6) { pintaPx(c, x, y + k, 1, 3, fita); pintaPx(c, x + w - 1, y + k, 1, 3, fita); }
        objetos.push({ nome: "ringue_tras", x: x - 2, y: y - 18, w: w + 4, h: 20, dx: 0, chave: y, cor: corMarca, luta: true });
        objetos.push({ nome: "ringue_frente", x: x - 2, y: y + h - 18, w: w + 4, h: 20, dx: 0, chave: y + h, cor: corMarca, abertura, luta: true });
        pegadas.push({ x: x - 4, y: y - 4, w: w + 8, h: h + 30, livre: true });   // a arena fica sem móvel
        const q = lugarNaParede(QUADRO_PLACAR.w, QUADRO_PLACAR.h, x + w / 2, chao - 3);   // o placar na parede do cantinho (só na briga)
        s.ringue = { sala: s, x, y, w, h, pontos: [[Math.round(x + w * 0.3), y + 32], [Math.round(x + w * 0.7), y + 32]],
          arte: { cv: arte, x: x - 4, y: y - 16 }, quadro: q ? { x: q.px, y: q.py, w: QUADRO_PLACAR.w, h: QUADRO_PLACAR.h } : null };
      }],
    ].filter(([, , precisa]) => (precisa || []).every(tem));
    // ordem: primeiro o ringue e o painel do logo (cabem na menor sala comunal, de 30 tiles); depois, sorteados por empresa,
    // os de jogo (TV, fliperama) e os outros; quando um cantinho não cabe, tenta o próximo (menor) para não sobrar buraco
    let zx = s.px + T, temCopa = false, ultima = -Infinity;
    const limite = s.px + s.pw - T, rc = rng(marca);
    const embaralha = l => { for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(rc() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l; };
    const iRingue = cantos.length - 1;   // o ringue é o último da lista; o painel do logo é o 1
    const ordem = [iRingue, 1, ...embaralha([0, 2]), ...embaralha([...cantos.keys()].slice(3, iRingue))];   // o ringue (a arena da briga) sempre cabe
    // portas reservadas antes dos cantinhos; ao lado da primeira, o trecho de parede da placa
    const porta = (z, larg) => { const px = z + 1.5 * T; s.portas.push(px); reservarPorta(s, px); ultima = px; return larg * T; };
    {
      // entrada: porta, a placa na parede ao lado e, embaixo dela, um cantinho de estar só com peças baixas
      const z = zx, tp = tamanhoPlaca(s);
      zx += porta(zx, 3);
      const x = s.portas[0] + 20, y = s.py + 4, larg = Math.ceil((x + tp.total + 8 - z) / T);
      s.placa = { x, y, ...tp, max: tp.total };
      reservas.push({ x: x - 3, y: y - 2, w: tp.total + 6, h: PLACA_H + 4 }); paredeOcupada.push({ x: x - 2, w: tp.total + 4, y });
      const m = z + (3 + (larg - 3) / 2) * T;   // meio do trecho embaixo da placa
      obj("tapete2", m, fim - 2);
      { const o = obj("sofa_cinza", m, fim - 6); junto(s, o, m - 0.6 * T, fim - 12, "papo"); junto(s, o, m + 0.6 * T, fim - 12, "papo"); }
      junto(s, obj("poltrona_amarela", m - 2.6 * T, fim - 10), m - 2.6 * T, fim - 16, "poltrona");
      obj("planta_g1", z + 3.6 * T, chao + 1.6 * T); obj("bebedouro", z + (larg - 0.8) * T, chao + 10);
      obj("luminaria_chao", m + 2.6 * T, fim - 4);
      zx = z + larg * T;
    }
    for (const i of [...ordem, ...ordem]) {
      if (zx - ultima > 16 * T && zx + 3 * T <= limite) zx += porta(zx, 3);   // outra porta a cada ~16 tiles
      const [larg, montar] = cantos[i];
      if (zx + larg * T > limite || montar(zx) === false) continue;
      zx += larg * T;
    }
    { // o rádio da firma (radio.js, aberto pelo brincar.js): numa prateleira da parede, no primeiro trecho livre perto do meio
      const W = 22, H = 17, meio = s.px + s.pw / 2;
      for (const d of [0, 3, -3, 6, -6, 9, -9, 12, -12, 15, -15]) {
        const x = Math.round(meio + d * T);
        if (x - W < s.px + T || x + W > s.px + s.pw - T || !paredeLivreEm(x - W / 2 - 4, x + W / 2 + 4, chao)) continue;
        const l = lugarNaParede(W, H, x, chao - 3);
        if (!l) continue;
        pintarRadio(c, l.px, l.py); quadros.push({ nome: "radio", x: l.px, y: l.py, w: W, h: H });
        break;
      }
    }
    { // canto da cozinha: filtro de água, recicláveis e máquinas de venda (sem copa na sala comunal, a geladeira de bebidas fica aqui)
      const L = cozinha.px, R = L + cozinha.pw;
      obj("bebedouro", L + 12, fimB - 4);
      obj("vendas", R - 18, fimB - 4); obj(temCopa || !tem("geladeira_bebidas") ? "vendas2" : "geladeira_bebidas", R - 50, fimB - 4);
      obj("lixeiras", R - 82, fimB - 4);
    }
    { // vãos de parede que sobraram entre os cantinhos: estante baixa, aparador e vasos no fundo, jardineira e vaso na frente.
      // Longe da arena do ringue (e da plateia), das portas, dos assentos e do que já está lá; nada sobe na frente de quadro
      const rg = s.ringue, zona = rg ? { x: rg.x - 30, y: rg.y - 48, w: rg.w + 60, h: rg.h + 96 } : null;
      const livre = r => !colide(r) && !(zona && sobre(r, zona)) && !reservas.some(q => sobre(r, q))
        && !vagas.some(v => v.x > r.x - 10 && v.x < r.x + r.w + 10 && v.y > r.y - 14 && v.y < r.y + r.h + 14)
        && objetos.every(o => o.chave < 0 || !o.w || !sobre(r, o));
      if (rg) { // a arena fora da briga: um tapete no meio (some na luta, app.js)
        const t = obj("tapete", rg.x + rg.w / 2, rg.y + rg.h - 8, false); if (t) t.semLuta = true;
      }
      const FUNDO = ["estante_baixa", "planta_alta", "aparador_baixo", "planta_g3"], FRENTE = ["jardineira", "planta_g1"];
      for (const [lista, base] of [[FUNDO, chao + 12], [FRENTE, fim - 4]]) {
        let k = 0;
        for (let x = s.px + T; x < s.px + s.pw - T - 30; x += 4) {
          const nome = lista[k % lista.length], sp = nome === "jardineira" ? [0, 0, 30, 9] : sprite(atlas, nome);
          if (!sp) { k++; continue; }
          const w = sp[2], h = sp[3];
          if (x + w > s.px + s.pw - T || !livre({ x: x - 6, y: base - h, w: w + 12, h }) || (base - h < chao && !paredeLivreEm(x - 2, x + w + 2, chao))) continue;
          if (nome === "jardineira") { objetos.push({ nome, x, y: base - h, w, h, dx: 0, chave: base }); pegadas.push({ x, y: base - h, w, h }); }
          else if (!obj(nome, x + w / 2, base, false)) continue;
          k++; x += w + 3 * T;
        }
      }
    }
    // corredor de passagem: a linha com menos móveis no caminho
    let melhor = s.faixa, menor = Infinity;
    for (let y = chao + 24; y <= fim - 22; y += 2) {
      const n = pegadas.filter(q => q.x < s.px + s.pw && q.x + q.w > s.px && q.y < y + 5 && q.y + q.h > y - 5).reduce((t, q) => t + q.w, 0);
      const custo = n + Math.abs(y - (chao + fim) / 2) * 0.5;
      if (custo < menor) { menor = custo; melhor = y; }
    }
    s.faixa = melhor;
    for (let jx = s.px + 3 * T; jx < s.px + s.pw - 3 * T; jx += 7 * T)
      if (s.portas.every(p => Math.abs(p - jx) > 3 * T) && paredeLivreEm(jx - 16, jx + 16, chao)) janela(jx, chao - 14, 28, 22);
  }
  // ---------------- planta (modo construção): peças tiradas, movidas, espelhadas e postas, por cima do prédio automático.
  // Mudança que não cabe volta ao lugar automático e entra em ignorados; o prédio continua igual para todo o resto.
  function aplicarPlanta() {
    const ignora = id => resumoPlanta.ignorados.push(id);
    const tira = (lista, item) => { const i = lista.indexOf(item); if (i >= 0) lista.splice(i, 1); return i; };
    // o que nada movido ou posto pode encostar: mesas e cadeiras (não têm pegada), o gato da recepção, o ringue com a plateia
    // (30 px de folga e a frente da entrada) e o painel do logo da recepção
    const mesas = salas.flatMap(s => s.mesas.map(m => ({ x: m.x - 17, y: m.topo - 7, w: 34, h: 27 })));
    const gatos = animados.filter(a => a.tipo === "gato" && a.w).map(a => ({ x: a.x, y: a.y, w: a.w, h: a.h }));
    const rg = lounge.ringue, ab = RINGUE.abertura;
    const zonas = rg ? [{ x: rg.x - 30, y: rg.y - 48, w: rg.w + 60, h: rg.h + 96 }, { x: rg.x + (rg.w - ab) / 2 - 8, y: rg.y + rg.h, w: ab + 16, h: 72 }] : [];
    for (const s of salas) if (s.placaLogo) zonas.push({ x: s.placaLogo.x - 4, y: s.placaLogo.y - 4, w: s.placaLogo.w + 8, h: s.placaLogo.h + 8 });
    // a peça (sprite sp, centro cx, pé base, espelhada ou não) cabe ali? fundo null: tapete, que não tem pegada
    // parado: só espelhou no lugar automático (a pegada é simétrica), então basta conferir os assentos
    const suspensas = new Set();   // assentos das peças que ainda vão andar: não contam como obstáculo
    const cabe = (sp, s, cx, base, fundo, assentos, proprias, parado = false) => {
      const w = sp[2], h = sp[3], inteiro = { x: cx - w / 2, y: base - h, w, h };
      const assentosOk = () => assentos.every(([x, y]) => x >= s.px + 5 && x <= s.px + s.pw - 5 && y >= s.chao + 5 && y <= s.py + s.ph - 3
        && !pegadas.some(p => !p.livre && x > p.x && x < p.x + p.w && y > p.y && y < p.y + p.h));
      if (parado) return assentosOk();
      if (cx - w / 2 < s.px + 1 || cx + w / 2 > s.px + s.pw - 1 || base < s.chao + 8 || base > s.py + s.ph - 2) return false;
      if (zonas.some(z => sobre(inteiro, z)) || reservas.some(q => sobre(inteiro, q))) return false;
      // subindo na parede: não cobre placa, quadro, painel do logo, quadro do placar, TV, ar nem telas
      if (inteiro.y < s.chao && paredeOcupada.some(q => q.y >= s.py - 8 && q.y < s.chao && inteiro.x < q.x + q.w && inteiro.x + w > q.x)) return false;
      if (fundo === null) return true;
      const peg = { x: cx - w / 2 + 1, y: base - fundo, w: w - 2, h: fundo };
      if (colide(peg) || mesas.some(q => sobre(peg, q)) || gatos.some(q => sobre(peg, q))) return false;   // colide: portas, corredores e entrada
      if (vagas.some(v => !proprias.has(v) && !suspensas.has(v) && v.x > peg.x - 3 && v.x < peg.x + peg.w + 3 && v.y > peg.y - 3 && v.y < peg.y + peg.h + 3)) return false;
      return assentosOk();
    };
    // tirar primeiro (libera espaço), depois mover e espelhar
    const pendentes = [];
    for (const [id, m] of Object.entries(planta.moveis && typeof planta.moveis === "object" ? planta.moveis : {})) {
      const ed = editaveis.get(id);
      if (!ed || !m || typeof m !== "object") { ignora(id); continue; }
      const fora = dePlanta(m, "fora"), x = dePlanta(m, "x"), y = dePlanta(m, "y"), e = dePlanta(m, "e");
      if (fora === true) {
        const { o } = ed, lig = ligados.get(o);
        tira(objetos, o); if (ed.peg) tira(pegadas, ed.peg);
        if (lig) {
          for (const v of lig.vagas) { tira(vagas, v); if (v.sala.vagasLivres) tira(v.sala.vagasLivres, v); }
          for (const a of lig.anexos) { tira(objetos, a); tira(animados, a); }
        }
        editaveis.delete(id); resumoPlanta.aplicados++;
        continue;
      }
      const temPos = x !== undefined || y !== undefined;
      if (fora !== undefined || (temPos && !(coordOk(x) && coordOk(y))) || (e !== undefined && typeof e !== "boolean") || (!temPos && e === undefined)
        || FIXOS.has(ed.o.nome) || (e === true && SEM_ESPELHO.has(ed.o.nome))) { ignora(id); continue; }
      const anda = temPos && (x !== ed.o.auto.x || y !== ed.o.auto.y);   // x, y iguais aos do automático: fica no lugar exato dele
      pendentes.push({ id, ed, cx: anda ? ed.sala.px + x : ed.cx, base: anda ? ed.sala.chao + y : ed.base, e: e === true });
    }
    // tudo o que vai andar sai do chão antes (trocar duas peças de lugar funciona em qualquer ordem); cada uma tenta o destino e,
    // se não coube, volta ao lugar automático, e quem tinha ido para lá volta também
    const vagasDe = p => (ligados.get(p.ed.o) || { vagas: [] }).vagas;
    for (const p of pendentes) { if (p.ed.peg) tira(pegadas, p.ed.peg); vagasDe(p).forEach(v => suspensas.add(v)); }
    const aplicar = p => {
      const { ed, cx, base, e } = p, { o, sp, sala: s, fundo } = ed, lig = ligados.get(o) || { vagas: [], anexos: [] };
      const ddx = Math.round(cx - sp[2] / 2) - o.x, ddy = Math.round(base - sp[3]) - o.y, meio = o.x + ddx + o.w / 2;
      const espelha = e !== !!o.espelho, gira = x => (espelha ? Math.round(2 * meio - x) : x);
      const assentos = lig.vagas.map(v => [gira(v.x + ddx), v.y + ddy]);
      if (!cabe(sp, s, cx, base, fundo, assentos, new Set(lig.vagas), cx === ed.cx && base === ed.base)) return false;
      p.antes = { x: o.x, y: o.y, chave: o.chave, espelho: o.espelho, peg: ed.peg, cx: ed.cx, base: ed.base,
        vagas: lig.vagas.map(v => [v.x, v.y, v.olha]), anexos: lig.anexos.map(a => [a.x, a.y, a.chave]) };
      lig.vagas.forEach((v, k) => {
        [v.x, v.y] = assentos[k]; suspensas.delete(v);
        if (espelha && (v.olha === "dir" || v.olha === "esq")) v.olha = v.olha === "dir" ? "esq" : "dir";
      });
      for (const a of lig.anexos) { a.x += ddx; a.y += ddy; a.chave += ddy; if (espelha) a.x = Math.round(2 * meio - a.x - a.w); }
      o.x += ddx; o.y += ddy; if (o.chave >= 0) o.chave = base;
      if (e) o.espelho = true; else delete o.espelho;
      if (fundo !== null) { ed.peg = { x: cx - sp[2] / 2 + 1, y: base - fundo, w: sp[2] - 2, h: fundo }; pegadas.push(ed.peg); }
      ed.cx = cx; ed.base = base;
      o.pos = { x: Math.round(cx) - s.px, y: Math.round(base) - s.chao };
      return true;
    };
    const desfazer = p => {
      const { ed } = p, { o } = ed, a0 = p.antes, lig = ligados.get(o) || { vagas: [], anexos: [] };
      if (ed.peg) tira(pegadas, ed.peg);
      Object.assign(o, { x: a0.x, y: a0.y, chave: a0.chave }); if (a0.espelho) o.espelho = true; else delete o.espelho;
      lig.vagas.forEach((v, k) => { [v.x, v.y, v.olha] = a0.vagas[k]; if (v.olha === undefined) delete v.olha; });
      lig.anexos.forEach((a, k) => { [a.x, a.y, a.chave] = a0.anexos[k]; });
      Object.assign(ed, { peg: a0.peg, cx: a0.cx, base: a0.base }); o.pos = { ...o.auto };
    };
    const colocadas = new Set();
    for (let volta = 0; volta < 2; volta++) for (const p of pendentes) if (!colocadas.has(p) && aplicar(p)) colocadas.add(p);
    const falhas = pendentes.filter(p => !colocadas.has(p));
    const dentro = (v, r) => v.x > r.x - 3 && v.x < r.x + r.w + 3 && v.y > r.y - 3 && v.y < r.y + r.h + 3;
    const bate = (p, f) => (p.ed.peg && f.ed.peg && sobre(p.ed.peg, f.ed.peg)) || (p.ed.peg && vagasDe(f).some(v => dentro(v, p.ed.peg)))
      || (f.ed.peg && vagasDe(p).some(v => dentro(v, f.ed.peg)));
    for (let mudou = true; mudou;) {
      mudou = false;
      for (const p of colocadas) if (falhas.some(f => bate(p, f))) { desfazer(p); colocadas.delete(p); falhas.push(p); mudou = true; }
    }
    for (const f of falhas) { if (f.ed.peg) pegadas.push(f.ed.peg); ignora(f.id); }
    resumoPlanta.aplicados += colocadas.size;
    // peças novas: só enfeite do catálogo (conferido antes de qualquer busca no atlas), com o desvio de sempre
    (Array.isArray(planta.novos) ? planta.novos : []).forEach((n, i) => {
      const id = "novo:" + i, nome = dePlanta(n, "nome"), chaveSala = dePlanta(n, "sala"), x = dePlanta(n, "x"), y = dePlanta(n, "y"), e = dePlanta(n, "e");
      const s = typeof chaveSala === "string" ? [...salas, ...baixo].find(q => q.chave === chaveSala) : null;
      const sp = typeof nome === "string" && CATALOGO.has(nome) ? sprite(atlas, nome) : null;
      if (!sp || !s || !coordOk(x) || !coordOk(y) || (e !== undefined && typeof e !== "boolean")) { ignora(id); return; }
      const tapete = /^tapete/.test(nome), fundo = tapete ? null : Math.max(6, sp[3] * 0.35), base = s.chao + y;
      const prender = cx => Math.max(s.px + sp[2] / 2 + 1, Math.min(s.px + s.pw - sp[2] / 2 - 1, cx));
      const cx = [0, -8, 8, -16, 16, -24, 24].map(d => prender(s.px + x + d)).find(cx => cabe(sp, s, cx, base, fundo, [], new Set()));
      if (cx === undefined) { ignora(id); return; }
      const o = { nome, x: Math.round(cx - sp[2] / 2), y: Math.round(base - sp[3]), w: sp[2], h: sp[3], dx: 0, chave: tapete ? -1 : base,
        id, salaChave: s.chave, pos: { x: Math.round(cx) - s.px, y } };
      if (e === true) o.espelho = true;
      if (fundo !== null) pegadas.push({ x: cx - sp[2] / 2 + 1, y: base - fundo, w: sp[2] - 2, h: fundo });
      objetos.push(o); resumoPlanta.aplicados++;
    });
  }
  if (planta) aplicarPlanta();
  for (const v of vagas) if (v.sala && v.sala.faixa) v.via = v.sala.faixa;
  const tapada = (j, x) => objetos.some(o => o.nome && o.chave >= 0 && o.y + o.h > j.y + j.h && x < o.x + o.w && x + j.w > o.x && j.y < o.y + o.h && j.y + j.h > o.y);
  for (let i = janelas.length - 1; i >= 0; i--) {
    const j = janelas[i], s = [...salas, ...baixo].find(q => j.x + j.w / 2 >= q.px && j.x + j.w / 2 <= q.px + q.pw && j.y >= q.py && j.y <= q.py + q.ph);
    if (!tapada(j, j.x)) continue;
    const outros = paredeOcupada.filter(o => !(o.x <= j.x && o.x + o.w >= j.x + j.w));
    const x = [8, -8, 16, -16, 24, -24, 32, -32].map(d => j.x + d).find(x => s && x > s.px + 4 && x + j.w < s.px + s.pw - 4 && !tapada(j, x)
      && outros.every(o => x + j.w + 2 < o.x || x - 2 > o.x + o.w) && (s.portas || []).every(p => x > p + 20 || x + j.w < p - 20));
    if (x === undefined) janelas.splice(i, 1); else j.x = x;
  }
  // ---------------- corredores: passadeira, luminárias de teto e, encostados na parede de baixo do principal (longe da linha
  // por onde se anda e fora da frente das portas), banco, quadro de avisos, vasos e bebedouro
  const luzesTeto = [], luzesTeto2 = [];   // as do principal (a zeladoria troca a lâmpada) e as dos corredores de baixo
  const corP = corMarca, filete = mistura(corP, "#fff1d6", 0.2);
  // nc: o corredor de cada sala (0, o principal); as de porta embaixo ficam em cima dele, as de porta em cima, embaixo
  const doCorredor = i => [...salas, ...baixo].filter(q => (q.nc || 0) === i);
  const ligacao = { px: conX0 + 3, pw: conX1 - conX0 - 6 };   // a abertura do corredor de ligação (sem parede)
  const detalhar = (k, i) => {
    const cT = k.topo, cB = k.topo + k.alt, x0 = cx0, x1 = cx1, cy = k.y;
    const ry = Math.round(cy) - 8, rx0 = x0 + 10, rw = x1 - 10 - rx0;
    pintaPx(c, rx0, ry, rw, 16, mistura(corP, "#2a1620", 0.66));
    pintaPx(c, rx0, ry, rw, 1, mistura(corP, "#2a1620", 0.8)); pintaPx(c, rx0, ry + 15, rw, 1, mistura(corP, "#2a1620", 0.8));
    pintaPx(c, rx0 + 2, ry + 2, rw - 4, 1, filete); pintaPx(c, rx0 + 2, ry + 13, rw - 4, 1, filete);
    for (let x = rx0 + 10; x < rx0 + rw - 10; x += 16) pontosPx(c, x, ry + 8, [[0, -2], [-1, -1], [1, -1], [-2, 0], [2, 0], [-1, 1], [1, 1], [0, 2]], filete);   // losangos
    pintaPx(c, rx0, ry + 16, rw, 1, "rgba(0,0,0,.18)");
    for (const x of [rx0 - 2, rx0 + rw]) for (let y = ry + 1; y < ry + 15; y += 2) pintaPx(c, x, y, 2, 1, "#e9dcc0");   // franjas
    const daqui = doCorredor(i), cima = daqui.filter(q => !q.emCima && !q.portas), embaixo = daqui.filter(q => q.emCima || q.portas);
    const portasCima = cima.map(q => q.porta.x), portasBaixo = embaixo.flatMap(q => q.portas).sort((a, b) => a - b);
    // parede fina nos vãos entre as salas (o corredor termina nelas), rodapé dos dois lados e soleira em cada porta
    const vaos = (lista, y) => {
      let cur = x0 - 3;
      for (const [a, b] of lista.map(q => [q.px - 3, q.px + q.pw + 3]).sort((p, q) => p[0] - q[0])) { if (a > cur) pintaPx(c, cur, y, a - cur, 3, "#23212f"); cur = Math.max(cur, b); }
      if (cur < x1 + 3) pintaPx(c, cur, y, x1 + 3 - cur, 3, "#23212f");
    };
    const abertoCima = i > 0 ? [ligacao] : [], abertoBaixo = i < corredores.length - 1 ? [ligacao] : [];
    vaos([...cima, ...abertoCima], cT); vaos([...embaixo, ...abertoBaixo], cB - 3);
    pintaPx(c, x0, cT + 3, x1 - x0, 2, "#a89f90"); pintaPx(c, x0, cB - 5, x1 - x0, 2, "#a89f90"); pintaPx(c, x0, cT + 5, x1 - x0, 1, "rgba(36,20,8,.1)");
    for (const p of portasCima) { pintaPx(c, p - 14, cT, 28, 5, "#d6cfbf"); pintaPx(c, p - 14, cT + 5, 28, 1, "#b5ad9c"); }
    for (const p of portasBaixo) pintaPx(c, p - 16, cB - 5, 32, 2, "#d6cfbf");
    // luminárias de teto a cada ~6 tiles, fora da frente das portas e das placas de cima (à noite acendem: app.js)
    const placasCima = cima.filter(q => q.placa).map(q => [q.placa.x - 4, q.placa.x + Math.min(q.placa.total, q.placa.max) + 4]);
    const tetoLivre = x => portasCima.every(p => Math.abs(p - x) > 16) && placasCima.every(([a, b]) => x < a - 4 || x > b + 4) && (i === 0 || x > conX1 + 8);
    for (let x = x0 + 40; x < x1 - 24; x += 6 * T) {
      const lx = [0, 8, -8, 16, -16, 24, -24].map(d => x + d).find(tetoLivre); if (lx === undefined) continue;
      (i ? luzesTeto2 : luzesTeto).push({ x: lx, y: cT + 3 });
      pintaPx(c, lx, cT, 1, 3, "#3a3a46"); pintaPx(c, lx - 4, cT + 3, 9, 3, "#3a3a46"); pintaPx(c, lx - 3, cT + 3, 7, 1, "#6b6b78");   // fio e cúpula
      pintaPx(c, lx - 2, cT + 6, 5, 1, "#d9d2c0"); pintaPx(c, lx - 4, cT + 10, 9, 1, "rgba(0,0,0,.14)");                                 // lâmpada e sombra
    }
    return { portasCima, portasBaixo, placasCima };
  };
  corredores.slice(1).forEach((k, i) => detalhar(k, i + 1));
  {
    const cT = cT0, cB = cB0, x0 = cx0, x1 = cx1;
    const { portasCima, portasBaixo, placasCima } = detalhar(corredor, 0);
    const base = cB - 2, ocupado = [];
    const portas = [...portasBaixo, ...portasCima];
    const encosta = (nome, cx) => { // desvia da frente de todas as portas e das outras peças
      const sp = sprite(atlas, nome); if (!sp) return null;
      const alto = base - sp[3] < cT + 8;   // sobe até a fachada: também não pode cobrir placa
      const cabe = x => x - sp[2] / 2 > x0 + 6 && x + sp[2] / 2 < x1 - 4 && portas.every(p => x + sp[2] / 2 < p - 22 || x - sp[2] / 2 > p + 22) && ocupado.every(([a, b]) => x + sp[2] / 2 < a - 6 || x - sp[2] / 2 > b + 6)
        && (!alto || placasCima.every(([a, b]) => x + sp[2] / 2 < a || x - sp[2] / 2 > b));
      const d = [0, 8, -8, 16, -16, 24, -24, 32, -32, 40, -40, 48, -48].find(d => cabe(cx + d)); if (d === undefined) return null;
      const o = obj(nome, cx + d, base, true); if (o) ocupado.push([o.x, o.x + o.w]);
      return o;
    };
    const rec = salas[0];
    encosta(tem("banco") ? "banco" : "poltrona_azul", rec.px + 34);   // banco de espera perto da recepção
    encosta("quadro_avisos", rec.px + 146);
    if (encosta("bebedouro", x1 - 16)) encosta("planta_fina", x1 - 40);   // bebedouro no fim do corredor, onde ninguém passa
    // vasos entre as portas de baixo: um no meio de cada trecho (dois nos trechos longos)
    const vasos = ["planta", "planta_fina", "planta2"].filter(tem), limites = [x0 + 40, ...portasBaixo, x1 - 50];
    let nv = marca;
    for (let i = 0; i + 1 < limites.length && vasos.length; i++) {
      const a = limites[i], b = limites[i + 1], n = b - a > 320 ? 2 : b - a > 90 ? 1 : 0;
      for (let k = 1; k <= n; k++) encosta(vasos[nv++ % vasos.length], Math.round(a + ((b - a) * k) / (n + 1)));
    }
  }

  // contornos e portas
  // porta das salas de cima: Ops é de metal, Gabinete de madeira escura; os outros times sorteiam
  const tipoPorta = s => s.tipo === "ops" ? "metal" : s.tipo === "gabinete" ? "madeira_escura" : ["madeira", "fosca", "cor", "madeira", "fosca"][semente(s.nome + "p") % 5];
  for (const s of salas) if (!s.emCima) { contorno(c, s, [[s.porta.x - 14, 28]]); portas.push({ tipo: s.tipo === "recepcao" ? "fosca" : tipoPorta(s), sala: s, x: s.porta.x - 14, y: s.py + s.ph - 1, w: 28, abre: 0 }); }
  for (const s of [...baixo, ...salas.filter(q => q.emCima)]) {
    contorno(c, s, []);
    const ps = sprite(atlas, `piso${s.piso}`);
    for (const px of s.portas) { // vão da porta: soleira de pedra em cima e, na passagem pela parede, o piso da própria sala
      c.drawImage(atlas.img, ps[0], ps[1], 2 * T, 32, px - T, s.py + 1, 2 * T, 32);
      c.drawImage(atlas.img, ps[0], ps[1], 2 * T, 15, px - T, s.py + 33, 2 * T, 15);
      if (PISOS_DO_TIME.has(s.piso) && s.tipo !== "cozinha") { c.save(); c.globalCompositeOperation = "multiply"; c.globalAlpha = 0.55; pintaPx(c, px - T, s.py + 1, 2 * T, 47, s.cor || CORES_CARPETE[semente(s.nome) % CORES_CARPETE.length]); c.restore(); }
      pintaPx(c, px - T, s.py - 3, 2 * T, 4, "#d6cfbf"); pintaPx(c, px - T, s.py + 1, 2 * T, 1, "#b5ad9c"); pintaPx(c, px - T, s.py + 2, 2 * T, 2, "rgba(36,20,8,.16)");
      portas.push({ tipo: s.tipo === "cozinha" ? "vaivem" : "vidro", x: px - T, y: s.py - 3, w: 2 * T, h: PAREDE * T + 3, abre: 0 });
    }
  }
  // F) mural de cada sala (1.6, só com o store: config.equipe.mural), no trecho de parede que sobrou livre, da direita
  // para a esquerda, sem mexer em mais nada. A recepção mostra o canal "geral" (no saguão, o mural do prédio)
  if (config.equipe && config.equipe.mural) for (const s of [...salas, ...baixo]) {
    if (s.tipo === "banheiro") continue;   // o banheiro não é canal de conversa (o servidor não tem essa sala)
    const { w, h } = MURAL;
    const ocupados = [...janelas, ...quadros, ...reservas, ...paredeOcupada.map(o => ({ ...o, h: 20 })), ...objetos.filter(o => o.w && o.h),
      ...animados.filter(a => a.w && a.h), s.placaLogo, s.logo, s.placa && { x: s.placa.x, y: s.placa.y, w: s.placa.total, h: PLACA_H }];
    const cabe = (x, y) => (s.portas || []).every(p => x > p + 18 || x + w < p - 18) && !ocupados.some(r => r && sobre({ x: x - 3, y: y - 2, w: w + 6, h: h + 4 }, r));
    let lugar = null;
    for (const y of [s.chao - 33, s.chao - 21]) {   // na altura dos quadros; senão, mais embaixo
      for (let x = s.px + s.pw - 6 - w; x >= s.px + 6 && !lugar; x -= 2) if (cabe(x, y)) lugar = { x, y };
      if (lugar) break;
    }
    if (!lugar) continue;   // parede cheia: a sala fica sem o quadro (o mural continua na lista do andar)
    pintarMural(c, lugar.x, lugar.y);
    s.mural = { ...lugar, w, h, canal: s.tipo === "recepcao" ? "geral" : "sala:" + s.chave };
    paredeOcupada.push({ x: lugar.x - 4, w: w + 8, y: lugar.y });
  }
  // o banheiro para o vida.js e a zeladoria: a porta (no corredor, onde a fila se forma), a sala e a frente de cada cabine
  const banheiro = { x: wc.portas[0], y: corredorY, sala: wc, cabines };
  // caminho da entrada lateral até a calçada fica livre (nenhuma árvore ou banco no meio)
  pegadas.push({ x: predioRet.x - 46, y: corredor.ty * T - 10, w: 62, h: predioRet.y + predioRet.h + 24 - corredor.ty * T, livre: true });
  const externos = montarExterior(atlas, (n, x, y) => obj(n, x, y, true, true), W, H, predioRet, marca, corredor.ty * T);
  const entrada = { x: (MX - 1) * T - 2, calcadaY: predioRet.y + predioRet.h + 14 };
  portas.push({ tipo: "lateral", x: cx0 - 3, y: corredor.ty * T + 8, w: 3, h: corredor.h * T - 16, abre: 0 });
  // E) ponto (pé do agente) no chão de uma sala ou do corredor e fora de móvel sólido, com folga de 5 px
  const solidos = [...pegadas.filter(q => !q.livre), ...salas.flatMap(s => s.mesas.map(m => ({ x: m.x - 16, y: m.topo, w: 32, h: 13 })))];
  const livre = (x, y) => {
    const naSala = [...salas, ...baixo].some(s => x >= s.px + 5 && x <= s.px + s.pw - 5 && y >= s.chao + 5 && y <= s.py + s.ph - 3);
    const noCorredor = corredores.some(k => x >= predioRet.x + T && x <= predioRet.x + predioRet.w - T && y >= k.topo + 5 && y <= k.topo + k.alt - 3)
      || (corredores.length > 1 && x >= conX0 + 5 && x <= conX1 - 5 && y >= cB0 - 3 && y <= ultimo.topo + 5);   // a ligação
    return (naSala || noCorredor) && !solidos.some(q => x > q.x - 5 && x < q.x + q.w + 5 && y > q.y - 5 && y < q.y + q.h + 5);
  };
  // plateia do ringue: chão livre em duas voltas por fora das cordas, sem tapar a entrada (o vida.js ainda confere o alcance)
  const ringue = lounge.ringue || null;
  if (ringue) {
    const { x, y, w, h } = ringue, meio = x + w / 2, pts = [];
    for (const d of [14, 28]) {
      const x0 = x - d, x1 = x + w + d, y0 = y - d, y1 = y + h + 6 + d;
      for (let px = x0; px <= x1; px += 12) pts.push([px, y0], [px, y1]);
      for (let py = y0 + 12; py < y1; py += 12) pts.push([x0, py], [x1, py]);
    }
    ringue.plateia = pts.filter(([px, py]) => livre(px, py) && !(py > y + h && Math.abs(px - meio) < RINGUE.abertura / 2 + 6));
  }
  return { livre, W, H, fundo, salas, baixo, lounge, ringue, corredorY, objetos, animados, vagas, janelas, portas, quadros, predioRet, externos, entrada, luzesTeto, luzesTeto2, banheiro, corredorTopo: corredor.ty * T, corredorAlt: corredor.h * T, corredores, rotulos, planta: resumoPlanta };
}

// Área externa: grama, calçada em volta do prédio e rua embaixo, com os detalhes sorteados por empresa.
function pintarExterior(c, atlas, W, H, p, marca) {
  const r = rng(marca ^ 7);
  c.fillStyle = "#5f9e4a"; c.fillRect(0, 0, W, H);
  for (let i = 0; i < W * H / 18; i++) { // textura da grama
    const x = Math.floor(r() * W), y = Math.floor(r() * H);
    c.fillStyle = r() < 0.5 ? "#6fb257" : "#538c40"; c.fillRect(x, y, 1, r() < 0.3 ? 2 : 1);
  }
  for (let i = 0; i < W * H / 900; i++) { // florzinhas
    const x = Math.floor(r() * W), y = Math.floor(r() * H);
    c.fillStyle = ["#fff6a8", "#ff9ec4", "#ffffff", "#ffd27a"][i % 4]; c.fillRect(x, y, 1, 1);
  }
  // calçada em volta do prédio
  const m = 10;
  c.fillStyle = "#b9b6ae"; c.fillRect(p.x - m, p.y - m, p.w + 2 * m, p.h + 2 * m);
  c.fillStyle = "#a7a49c";
  for (let x = p.x - m; x < p.x + p.w + m; x += 8) { c.fillRect(x, p.y - m, 1, m); c.fillRect(x, p.y + p.h, 1, m); }
  for (let y = p.y - m; y < p.y + p.h + m; y += 8) { c.fillRect(p.x - m, y, m, 1); c.fillRect(p.x + p.w, y, m, 1); }
  c.fillStyle = "#8f8578"; c.fillRect(p.x, p.y, p.w, p.h);   // a estrutura do prédio: entre as salas, parede grossa
  // sombra do prédio (embaixo, a fachada faz a sombra)
  c.fillStyle = "rgba(0,0,0,.22)"; c.fillRect(p.x + p.w, p.y + 4, 5, p.h + FACHADA);
  pintarFachada(c, atlas, p, r);
  // calçada da rua, logo embaixo da fachada, com rachaduras e tufos de grama no meio-fio
  const yRua = ruaY(p), alt = RUA_ALT, y0 = p.y + p.h + FACHADA;
  c.fillStyle = "#b9b6ae"; c.fillRect(0, y0, W, yRua - 3 - y0);
  c.fillStyle = "#a7a49c"; for (let x = 0; x < W; x += 8) c.fillRect(x, y0, 1, yRua - 3 - y0);
  for (let y = y0 + 8; y < yRua - 3; y += 8) c.fillRect(0, y, W, 1);
  c.fillStyle = "rgba(0,0,0,.18)"; c.fillRect(p.x, y0, p.w, 2);   // sombra da fachada na calçada
  c.fillStyle = "#8f8c84";
  for (let i = 0; i < W / 120; i++) { const x = Math.floor(r() * W), y = y0 + 4 + Math.floor(r() * (CALCADA - 8)); c.fillRect(x, y, 2, 1); c.fillRect(x + 2, y + 1, 2, 1); c.fillRect(x + 4, y + 1, 1, 2); }
  // rua: meio-fio, uma faixa de asfalto com a linha do meio e o meio-fio do outro lado
  c.fillStyle = "#d7d4cc"; c.fillRect(0, yRua - 3, W, 3);
  c.fillStyle = "#3d3f46"; c.fillRect(0, yRua, W, alt);
  for (let i = 0; i < W * alt / 30; i++) { c.fillStyle = r() < 0.5 ? "#45474f" : "#36383f"; c.fillRect(Math.floor(r() * W), yRua + Math.floor(r() * alt), 1, 1); }
  c.fillStyle = "#f2d16b"; for (let x = 4; x < W; x += 20) c.fillRect(x, yRua + alt / 2 - 1, 10, 1);
  c.fillStyle = "#d7d4cc"; c.fillRect(0, yRua + alt, W, 3);
  for (let x = 40 + Math.floor(r() * 60); x < W - 10; x += 170 + Math.floor(r() * 80)) { // bueiros no meio-fio
    c.fillStyle = "#26272d"; c.fillRect(x, yRua - 3, 9, 3); c.fillStyle = "#5b5d66"; for (let k = 1; k < 9; k += 2) c.fillRect(x + k, yRua - 3, 1, 3);
  }
  c.fillStyle = "#ecebe6"; for (let x = p.x - 40; x < p.x - 4; x += 6) c.fillRect(x, yRua + 3, 3, alt - 6);   // faixa de pedestre na frente da entrada
  c.fillStyle = "#4f8a3c"; for (let i = 0; i < W / 40; i++) c.fillRect(Math.floor(r() * W), yRua - 4, 1, 1);
}

// A frente do prédio, vista de frente, numa faixa embaixo da planta: reboco, cornija, rodapé de pedra, janelas, a porta de
// vidro no meio com arandelas dos lados e floreiras no chão. As peças são do PixelLab (arte/pixellab/fachada); a parede, daqui.
function pintarFachada(c, atlas, p, r) {
  const y0 = p.y + p.h, x0 = p.x, x1 = p.x + p.w, h = FACHADA;
  c.fillStyle = "#e6cfa6"; c.fillRect(x0, y0, p.w, h);
  for (let i = 0; i < p.w * h / 14; i++) { c.fillStyle = r() < 0.5 ? "#dcc298" : "#efdab4"; c.fillRect(x0 + Math.floor(r() * p.w), y0 + 3 + Math.floor(r() * (h - 6)), 1, 1); }
  c.fillStyle = "#b8956a"; c.fillRect(x0, y0, p.w, 3); c.fillStyle = "#d9bd8f"; c.fillRect(x0, y0 + 3, p.w, 1);   // cornija
  c.fillStyle = "#958d80"; c.fillRect(x0, y0 + h - 3, p.w, 3); c.fillStyle = "#7d766b"; c.fillRect(x0, y0 + h - 1, p.w, 1);   // rodapé
  for (let x = x0 + 40; x < x1; x += 80) { c.fillStyle = "#d4b88c"; c.fillRect(x, y0 + 4, 2, h - 7); }   // pilastras
  const peca = (n, cx, base) => { const s = sprite(atlas, n); if (s) c.drawImage(atlas.img, s[0], s[1], s[2], s[3], Math.round(cx - s[2] / 2), base - s[3], s[2], s[3]); return s; };
  const porta = Math.round(x0 + p.w / 2), fora = [porta - 34, porta + 34];
  for (let x = x0 + 20; x < x1 - 10; x += 40) if (Math.abs(x - porta) > 30) peca("fachada_janela", x, y0 + h - 3);
  peca("fachada_porta", porta, y0 + h - 2);
  for (const x of [porta - 18, porta + 18]) peca("fachada_arandela", x, y0 + 22);
  // floreiras entre as janelas, na calçada
  for (let x = x0 + 40; x < x1 - 20; x += 160) if (!fora.some(f => Math.abs(f - x) < 40)) peca("fachada_floreira", x, y0 + h + 8);
}
// onde ficam as arandelas da fachada (acendem à noite, com os postes)
const arandelas = p => { const porta = Math.round(p.x + p.w / 2); return [porta - 18, porta + 18].map(x => ({ x, y: p.y + p.h + 8 })); };

function montarExterior(atlas, obj0, W, H, p, marca, portaY) {
  const r = rng(marca ^ 11), ext = { carros: [], postes: [], ruaY: ruaY(p), ruaAlt: RUA_ALT };
  const tem = n => !!sprite(atlas, n);
  // planta sai espelhada metade das vezes; fora: balança com o vento do clima (efeitos.js). Sem árvore enfeitando o
  // topo nem a rua: a cor do mapa vem dos times
  const obj = (n, x, y) => { const o = obj0(n, x, y); if (o && /^(arbusto|planta)/.test(n)) { o.fora = true; if (r() < 0.5) o.espelho = true; } return o; };
  // entrada lateral: vaso ao lado da porta; na calçada, à direita do caminho de pedra, a placa de loja com o expediente
  // (aberto/fechado, desenhada no efeitos.js) e o bicicletário, fora da rota de quem sai (pelo caminho e para a esquerda)
  const meioFio = ext.ruaY - 5;
  obj("planta2", p.x - 14, portaY - 12);
  obj("placa_expediente", p.x + 44, meioFio); obj("bicicletario", p.x + 110, meioFio);
  // calçada da rua: postes num passo próprio da empresa e mobiliário baixo sorteado (o alto cobriria a fachada)
  const passo = 190 + r() * 80;
  for (let x = 160 + r() * 70; x < W - 20; x += passo + (r() - 0.5) * 40) {
    const o = obj("poste", x, meioFio); if (o) ext.postes.push({ x: o.x + o.w / 2, y: o.y + 4 });
  }
  ext.postes.push(...arandelas(p));
  obj("caixa_correio", p.x - 6, meioFio);
  const urbano = ["banco", "banco", "lixeira_rua", "lixeira_rua", "hidrante"].filter(tem);
  const vagasRua = Math.max(3, Math.floor((W - p.x - 200) / 220));
  for (let i = 0; i < vagasRua; i++) {
    const n = urbano.length ? urbano.splice(Math.floor(r() * urbano.length), 1)[0] : null; if (!n) break;
    const x = p.x + 180 + (i + 0.2 + r() * 0.6) * ((W - p.x - 200) / vagasRua);
    obj(n, x, n === "banco" ? meioFio - 2 : meioFio, true);
  }
  // carros passando
  const carros = ["carro1", "carro2", "carro3", "carro4"].filter(tem);
  for (let i = 0; i < carros.length; i++) ext.carros.push({ nome: carros[i], x: (W / carros.length) * i + r() * 60, faixa: i % 2, vel: 18 + r() * 22 });
  return ext;
}

function ancorar(atlas, nome, cx, base) {
  const s = sprite(atlas, nome);
  if (!s) return { x: 0, y: 0, w: 0, h: 0, chave: base };
  return { x: Math.round(cx - s[2] / 2), y: Math.round(base - s[3]), w: s[2], h: s[3], chave: base };
}

function telaDe(atlas, nome, cx, base) {
  const s = sprite(atlas, nome); if (!s) return { x: 0, y: 0, w: 0, h: 0, chave: -1 };
  const r = TELAS[nome] || [0.1 * s[2], 0.06 * s[3], 0.8 * s[2], 0.5 * s[3]].map(Math.round);
  const x0 = Math.round(cx - s[2] / 2), y0 = Math.round(base - s[3]);
  return { x: x0 + r[0], y: y0 + r[1], w: r[2], h: r[3], chave: base + 0.2 };
}

// Status da pessoa (1.6): ícone 9x9 ao lado do nome. "o" = contorno escuro, "#" = a cor, "+" = o desenho em branco, que
// muda de um status para o outro (não depende só da cor); as cores dão pelo menos 3:1 com o branco
const ICONES_STATUS = {
  disponivel: { cor: "#15803d", rotulo: "Disponível", linhas: ["..ooooo..", ".o#####o.", "o######+o", "o#####++o", "o+#+#++#o", "o#+++###o", "o##+####o", ".o#####o.", "..ooooo.."] },
  ocupado:    { cor: "#dc2626", rotulo: "Ocupado",    linhas: ["..ooooo..", ".o#####o.", "o#######o", "o#######o", "o+++++++o", "o#######o", "o#######o", ".o#####o.", "..ooooo.."] },
  reuniao:    { cor: "#2563eb", rotulo: "Em reunião", linhas: ["..ooooo..", ".o#####o.", "o#+###+#o", "o#+###+#o", "o#######o", "o+++#+++o", "o+++#+++o", ".o#####o.", "..ooooo.."] },
  ausente:    { cor: "#b45309", rotulo: "Ausente",    linhas: ["..ooooo..", ".o##+##o.", "o###+###o", "o###+###o", "o###+++#o", "o#######o", "o#######o", ".o#####o.", "..ooooo.."] },
};
const iconeStatus = st => (Object.hasOwn(ICONES_STATUS, st) ? ICONES_STATUS[st] : null);
// o ícone com o canto em (x, y), cada pixel com px de lado
function desenharStatus(c, st, x, y, px) {
  const ic = iconeStatus(st); if (!ic) return;
  const cores = { o: "#141320", "#": ic.cor, "+": "#ffffff" };
  ic.linhas.forEach((l, j) => { for (let i = 0; i < 9; i++) if (cores[l[i]]) { c.fillStyle = cores[l[i]]; c.fillRect(x + i * px, y + j * px, px, px); } });
}

// Placa "Em reunião" (1.6 Onda 3) na porta da sala com reunião acontecendo (Vida.emReuniao): vermelha, ao lado da porta,
// do lado de fora. Sala de cima (porta embaixo): pendurada no corredor; sala de baixo (porta em cima): na parede. Em
// coordenadas do mundo, desenhada depois das portas
const PLACA_REUNIAO = { w: 66, h: 12, folga: 16 };   // o texto na fonte das placas (8 px: a Silkscreen só fica nítida assim)
function placaReuniao(s) {
  const { w, h, folga } = PLACA_REUNIAO, px = s.portas ? s.portas[0] : s.porta.x;
  const y = s.portas ? s.py + 4 : s.py + s.ph + 2;
  const x = px + folga + w <= s.px + s.pw - 2 ? px + folga : px - folga - w >= s.px + 2 ? px - folga - w : Math.round(px - w / 2);
  return { x, y, w, h };
}
function desenharPlacaReuniao(c, s) {
  const { x, y, w, h } = placaReuniao(s);
  c.save();
  c.fillStyle = "rgba(0,0,0,.25)"; c.fillRect(x, y + h + 1, w + 1, 1);                 // sombra
  c.fillStyle = "#141320"; c.fillRect(x - 1, y - 1, w + 2, h + 2);                       // moldura
  c.fillStyle = "#b91c1c"; c.fillRect(x, y, w, h);                                       // branco sobre ele: 6,5:1
  c.fillStyle = "#ef4444"; c.fillRect(x, y, w, 1);
  c.fillStyle = "#fecaca"; c.fillRect(x + 3, y + 5, 2, 2);                               // a luzinha de "no ar"
  c.font = PLACA_FONTE; c.textAlign = "left"; c.textBaseline = "middle"; c.fillStyle = "#ffffff";
  c.fillText("EM REUNIÃO", x + 8, y + h / 2 + 1, w - 10);
  c.restore();
}

return { pintarQuadroPlacar, desenharCabines, iconeStatus, desenharStatus, placaReuniao, desenharPlacaReuniao, nomePlaca, montarPredio, desenharMesa, lampadaX, desenharCadeira, mistura, hex6, cor, rgb, T, TELAS, PLACA_FONTE, PLACA_H, CATALOGO, FIXOS, SEM_ESPELHO, tamanho };
})();
window.Mapa = Mapa;
