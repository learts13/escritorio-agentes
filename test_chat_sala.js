"use strict";
// Chat da sala (static/chat_sala.js): o evento minha-sala (sala e nome), o texto que o servidor aceita e a deduplicação por seq.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const contexto = { window: {} };   // sem document: só a parte pura carrega
vm.runInNewContext(fs.readFileSync("static/chat_sala.js", "utf8"), contexto);
const { daSala, validar, limpar, novas, TEXTO_MAX } = contexto.window.ChatSala;

assert.equal(JSON.stringify(daSala({ sala: "cozinha", nome: "Cozinha", andar: "principal" })), '{"sala":"cozinha","nome":"Cozinha"}');
assert.equal(daSala({ sala: "time:Design", nome: " Design " }).nome, "Design");
for (const d of [{ sala: null, nome: null }, { sala: "", nome: "" }, { sala: "cozinha", nome: null }, { sala: "cozinha" }, { sala: 3, nome: "x" }, null, undefined])
  assert.equal(daSala(d).sala, "", `sem chat: ${JSON.stringify(d)}`);

assert.equal(validar("oi"), null);
assert.equal(validar("   "), "Escreva a mensagem.");
assert.equal(validar("\u0000​"), "Escreva a mensagem.", "só controle e invisível é vazio");
assert.equal(validar("é".repeat(TEXTO_MAX)), null);
assert.equal(validar("😀".repeat(TEXTO_MAX)), null, "conta por caractere, como o len() do servidor");
assert.match(validar("a".repeat(TEXTO_MAX + 1)), /500/);
assert.equal(limpar(" a\u0007b‮c\r\nd "), "abc\nd", "tira controle e bidi, mantém a quebra de linha");

const vistos = new Set([2]);
const ms = [{ seq: 3, texto: "c" }, { seq: 1, texto: "a" }, { seq: 2, texto: "b" }, { seq: "4", texto: "x" }, null, { seq: 5 }];
assert.deepEqual([...novas(ms, vistos).map(m => m.seq)], [1, 3], "fora as já vistas e as malformadas, em ordem de seq");
assert.equal(novas(undefined, vistos).length, 0);
// GET atrasado depois do "minha-sala" (entrei na sala nova no seq 3): a mensagem 1, da sala de antes, fica de fora
assert.deepEqual([...novas(ms, new Set(), 3).map(m => m.seq)], [3], "só o seq da entrada em diante");
assert.deepEqual([...novas(ms, new Set(), 0).map(m => m.seq)], [1, 2, 3], "sem seq de entrada, tudo vale");
// M2: quem sou eu nas mensagens. O "eu" do /api/ao-vivo vale (no saguão, id opaco); sem ele, o login da sessão
const { euDe, deMim } = contexto.window.ChatSala;
assert.equal(euDe({ eu: "p_0123456789abcdef" }, "carla"), "p_0123456789abcdef");
for (const d of [{}, { eu: "" }, { eu: 3 }, null]) assert.equal(euDe(d, "carla"), "carla", JSON.stringify(d));
assert.equal(euDe({}, null), null);
assert.equal(deMim({ usuario: "p_0123456789abcdef" }, "p_0123456789abcdef"), true);
assert.equal(deMim({ usuario: "carla" }, "p_0123456789abcdef"), false, "no saguão o login não casa com o id");
assert.equal(deMim({ usuario: null }, null), false);
assert.equal(deMim({}, null), false);
// o "usuario" nunca é texto: o nome da mensagem vem do "nome" ou "Alguém"/"Você"
const fonte = fs.readFileSync("static/chat_sala.js", "utf8");
assert.match(fonte, /quem\.textContent = mim \? "Você" : \(typeof m\.nome === "string" && m\.nome \? m\.nome : "Alguém"\)/);

// ---- 1.6 Onda 2: o painel de conversa da equipe (a parte pura)
const P = contexto.window.ChatSala;
// os objetos do vm são de outro realm: compara pelo JSON
const igual = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);
// canal da sala do mapa: "sala:<chave>" (1 a 80 caracteres, como o store)
assert.equal(P.canalDaSala("cozinha"), "sala:cozinha");
assert.equal(P.canalDaSala("time:Design"), "sala:time:Design");
for (const s of ["", null, 3, "x".repeat(81)]) assert.equal(P.canalDaSala(s), "", JSON.stringify(s));
// histórico: junta por id, em ordem, e a versão nova (apagada, reação) troca a velha
{
  const atuais = [{ id: 5, texto: "e" }, { id: 7, texto: "g" }];
  const m = P.mesclar(atuais, [{ id: 6, texto: "f" }, { id: 7, texto: null, apagada: true }, { id: "8" }, null]);
  igual(m.map(x => x.id), [5, 6, 7]);
  assert.equal(m[2].apagada, true, "a versão nova substitui");
  assert.equal(atuais.length, 2, "não muda a lista de entrada");
  assert.equal(P.maisAntiga(m), 5);
  assert.equal(P.maisAntiga([]), null);
}
// menção: o "@" em curso antes do cursor (começo do texto ou depois de espaço)
igual(P.mencaoEmCurso("oi @an", 6), { inicio: 3, termo: "an" });
igual(P.mencaoEmCurso("@", 1), { inicio: 0, termo: "" });
assert.equal(P.mencaoEmCurso("email@an", 8), null, "no meio da palavra não é menção");
assert.equal(P.mencaoEmCurso("oi @ana já", 10), null, "depois do espaço acabou");
assert.equal(P.mencaoEmCurso("oi", 2), null);
// sugestões: só gente do andar (a lista que o servidor deu), sem mim, por login ou nome, sem acento e sem caixa
{
  const pessoas = [{ usuario: "ana.lima", nome: "Ana Lima" }, { usuario: "joao", nome: "João Souza" }, { usuario: "carla", nome: "Carla" }, { usuario: "andre", nome: "André" }];
  igual(P.sugestoes("an", pessoas, "carla").map(p => p.usuario), ["ana.lima", "andre"]);
  igual(P.sugestoes("JO", pessoas, "carla").map(p => p.usuario), ["joao"]);
  igual(P.sugestoes("so", pessoas, null).map(p => p.usuario), ["joao"], "pelo sobrenome também");
  igual(P.sugestoes("ca", pessoas, "carla").map(p => p.usuario), [], "eu não me menciono");
  assert.equal(P.sugestoes("", pessoas, null, 2).length, 2, "teto");
  igual(P.sugestoes("x", [null, { usuario: 3 }], null), []);
}
// completar: troca o "@termo" pelo "@login " e devolve o cursor depois do espaço
igual(P.completarMencao("oi @an tudo", 3, 6, "ana.lima"), { texto: "oi @ana.lima  tudo", cursor: 13 });
// partes: a menção a alguém do andar vira destaque; o resto é texto puro
igual(P.partes("oi @ana.lima e @ninguem!", new Set(["ana.lima"])).map(p => [p.texto, !!p.mencao]),
  [["oi ", false], ["@ana.lima", true], [" e @ninguem!", false]]);
igual(P.partes("sem", new Set()).map(p => p.texto), ["sem"]);
igual(P.partes("valeu, @bia.santos.", new Set(["bia.santos"])).map(p => p.texto), ["valeu, ", "@bia.santos", "."], "o ponto final não é do login");
// anexos: tamanho legível, teto de 25 MiB e o nome que o servidor aceita
assert.equal(P.tamanho(512), "512 B");
assert.equal(P.tamanho(1536), "1,5 KB");
assert.equal(P.tamanho(25 * 1024 * 1024), "25 MB");
assert.equal(P.conferirArquivo({ name: "a.pdf", size: 1 }), null);
assert.equal(P.conferirArquivo({ name: "a.pdf", size: 25 * 1024 * 1024 }), null);
assert.match(P.conferirArquivo({ name: "a.pdf", size: 25 * 1024 * 1024 + 1 }), /25 MB/);
assert.match(P.conferirArquivo({ name: "a.pdf", size: 0 }), /vazio/);
assert.match(P.conferirArquivo({ name: "a".repeat(121), size: 3 }), /nome/);
assert.equal(P.ehImagem("image/png") && P.ehImagem("image/jpeg") && P.ehImagem("image/webp") && P.ehImagem("image/gif"), true);
for (const t of ["image/svg+xml", "text/html", "application/pdf", null]) assert.equal(P.ehImagem(t), false, String(t));
// reações: as 8 do store; alternar a minha (otimista) sem mexer na de entrada
assert.equal(P.EMOJIS.length, 8);
{
  const r = [{ emoji: "👍", n: 2, eu: false }];
  igual(P.alternarReacao(r, "👍").map(x => [x.n, x.eu]), [[3, true]]);
  igual(P.alternarReacao([{ emoji: "👍", n: 1, eu: true }], "👍"), [], "a última sai");
  igual(P.alternarReacao([], "🎉").map(x => x.emoji), ["🎉"]);
  assert.equal(r[0].n, 2);
}
// os avisos de privacidade: a retenção, a DM legível pela empresa e o registro de quando a administração abriu
assert.equal(P.textoRetencao(365), "As mensagens ficam guardadas por 1 ano.");
assert.equal(P.textoRetencao(90), "As mensagens ficam guardadas por 90 dias.");
assert.equal(P.textoRetencao(undefined), "As mensagens ficam guardadas por 1 ano.", "o padrão do D3");
assert.equal(P.avisoHistorico(365, false), "Esta conversa fica guardada por 1 ano e todo o andar pode ler.");
assert.equal(P.avisoHistorico(30, false), "Esta conversa fica guardada por 30 dias e todo o andar pode ler.");
assert.equal(P.avisoHistorico(undefined, true), "Esta conversa fica guardada por 1 ano e todo o prédio pode ler.");
assert.equal(P.avisoDM("Acme"), "As mensagens diretas da Acme podem ser lidas pela administração da empresa.");
assert.equal(P.avisoDM(""), "As mensagens diretas desta empresa podem ser lidas pela administração da empresa.");
assert.equal(P.linhaAcessos([]), "");
assert.equal(P.linhaAcessos(["2026-11-12T13:00:00Z"]), "A administração da empresa abriu esta conversa em 12/11/2026.");
assert.equal(P.linhaAcessos(["2026-11-10T13:00:00Z", "2026-11-12T13:00:00Z", "x"]), "A administração da empresa abriu esta conversa em 10/11/2026 e 12/11/2026.");
assert.equal(P.contagem(0), "");
assert.equal(P.contagem(12), "9+");
// as abas pelo config.equipe: no saguão (sem DM) só o Geral; num andar, Geral, a sala onde estou (se estou numa) e Diretas
const ANDAR = { dm: true, anexo: true, mencao: true, auditoria: false }, SAGUAO = { dm: false, anexo: false, mencao: false, auditoria: false };
igual(P.abas(SAGUAO, { sala: "recepcao", nome: "Recepção" }), [{ id: "geral", rotulo: "Geral" }]);
igual(P.abas(ANDAR, { sala: "", nome: "" }), [{ id: "geral", rotulo: "Geral" }, { id: "diretas", rotulo: "Diretas" }]);
igual(P.abas(ANDAR, { sala: "cozinha", nome: "Cozinha" }),
  [{ id: "geral", rotulo: "Geral" }, { id: "sala:cozinha", rotulo: "Cozinha" }, { id: "diretas", rotulo: "Diretas" }]);
// o que cada vista mostra: o saguão nunca tem anexo nem menção; auditoria e listas não têm caixa de escrever
igual(P.controles(SAGUAO, "geral"), { escrever: true, anexar: false, mencionar: false, auditoria: false });
igual(P.controles(ANDAR, "sala:x"), { escrever: true, anexar: true, mencionar: true, auditoria: false });
igual(P.controles(ANDAR, "dm:3"), { escrever: true, anexar: true, mencionar: false, auditoria: false });
igual(P.controles({ ...ANDAR, auditoria: true }, "diretas"), { escrever: false, anexar: false, mencionar: false, auditoria: true });
igual(P.controles(ANDAR, "diretas"), { escrever: false, anexar: false, mencionar: false, auditoria: false });
igual(P.controles({ ...ANDAR, auditoria: true }, "auditoria"), { escrever: false, anexar: false, mencionar: false, auditoria: false });
igual(P.controles({ ...ANDAR, auditoria: true }, "busca"), { escrever: false, anexar: false, mencionar: false, auditoria: false });
igual(P.controles(null, "geral"), { escrever: true, anexar: false, mencionar: false, auditoria: false }, "sem config.equipe, nada a mais");
console.log("test_chat_sala.js ok");
