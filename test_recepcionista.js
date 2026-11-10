"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const codigo = fs.readFileSync("static/recepcionista.js", "utf8");

function gerador() {
  const contexto = {};
  vm.runInNewContext(codigo, contexto);
  return contexto.instrucoesRecepcionista;
}

function instrucoes() {
  const gerar = gerador();
  const texto = gerar({ nome: " Padaria\nDo Zé ", faz: "Pães e bolos.\r\n\r\nEntrega em BH.", site: "https://padaria.example",
    contato: "pelo WhatsApp (31) 0000-0000", horario: "", evitar: "- preços de atacado\n\n• concorrentes" });
  assert.match(texto, /^# Recepção da Padaria Do Zé\n/);
  assert.match(texto, /## Sobre a Padaria Do Zé\nPães e bolos\.\nEntrega em BH\.\nSite: https:\/\/padaria\.example\n\n/);
  assert.doesNotMatch(texto, /Horário/);
  assert.match(texto, /Para orçamento, suporte ou falar com a equipe: pelo WhatsApp \(31\) 0000-0000\. Não prometa/);
  assert.match(texto, /nunca ordem/);
  assert.match(texto, /Não fale de clientes/);
  assert.match(texto, /- Não trate deste assunto: preços de atacado\n- Não trate deste assunto: concorrentes$/);
  const vazio = gerar({});
  assert.match(vazio, /^# Recepção da a empresa/);
  assert.match(vazio, /anote o pedido e diga que a equipe retorna/);
  assert.doesNotMatch(gerar({ nome: "A\u0000B\u001bC" }), /[\u0000\u001b]/);
}

async function tela() {
  const el = {};
  const novo = id => (el[id] = { id, value: "", textContent: "", disabled: false, hidden: false, dataset: {},
    addEventListener(tipo, fn) { this["on" + tipo] = fn; }, replaceChildren(...filhos) { this.filhos = filhos; },
    focus() {}, select() {} });
  ["empresa", "instrucoes", "copiar", "ligar", "salvar", "limpar", "estado", "situacao", "faltam", "nome", "faz", "site",
    "contato", "horario", "evitar", "anfitriao", "canal", "confirmar", "bloco-senha", "senha"].forEach(novo);
  el["bloco-senha"].hidden = true;
  const corpos = [];
  let resposta = { origem: "nenhum", tela: "livre", anfitrioes: [], canal: "", nomes: [], faltam: ["Escolha o recepcionista e o canal das visitas."] };
  const contexto = {
    document: { getElementById: id => el[id], createElement: () => ({}) },
    navigator: { clipboard: { writeText: async t => { contexto.copiado = t; } } },
    fetch: async (url, opcoes) => {
      assert.equal(url, "/api/visitas/recepcionista");
      const corpo = JSON.parse(opcoes.body);
      corpos.push(corpo);
      if (corpo.anfitriao === "@ruim") return { ok: false, json: async () => ({ erro: "Esse agente não aparece na leitura do agentes.chat." }) };
      if (corpo.conferir) return { ok: true, json: async () => ({ anfitriao: "recepcao", canal: "c1", nome: "Recepção", canal_nome: "visitas" }) };
      if (corpo.anfitriao) resposta = { origem: "tela", tela: "livre", anfitrioes: ["recepcao"], canal: "c1", nomes: ["Recepção"], faltam: [] };
      if (corpo.limpar) resposta = { origem: "nenhum", tela: contexto.tela || "livre", anfitrioes: [], canal: "", nomes: [], faltam: [] };
      return { ok: true, json: async () => resposta };
    },
  };
  vm.runInNewContext(codigo, contexto);
  await new Promise(r => setImmediate(r));
  assert.match(el.situacao.textContent, /Nenhum recepcionista/);
  assert.equal(el.faltam.filhos.length, 1);
  assert.equal(el.limpar.hidden, true);

  el.nome.value = "Padaria"; el.faz.value = "Pães.";
  el.empresa.onsubmit({ preventDefault() {} });
  assert.match(el.instrucoes.value, /^# Recepção da Padaria/);
  assert.equal(el.copiar.disabled, false);
  await el.copiar.onclick();
  assert.equal(contexto.copiado, el.instrucoes.value);

  el.anfitriao.value = "@ruim"; el.canal.value = "https://app.agentes.chat/org/x/c/y";
  await el.ligar.onsubmit({ preventDefault() {} });
  assert.match(el.estado.textContent, /não aparece na leitura/);
  assert.equal(el.salvar.disabled, false);

  el.anfitriao.value = "@recepcao";
  await el.ligar.onsubmit({ preventDefault() {} });   // primeiro só confere e mostra em qual canal o agente vai ler
  assert.deepEqual(corpos.at(-1), { anfitriao: "@recepcao", canal: "https://app.agentes.chat/org/x/c/y", conferir: true });
  assert.match(el.confirmar.textContent, /^Recepção \(@recepcao\) vai atender no canal #visitas\./);
  assert.equal(el.salvar.textContent, "Confirmar e salvar");
  assert.match(el.situacao.textContent, /Nenhum recepcionista/);

  el.ligar.oninput();   // mexer no formulário pede conferir de novo
  assert.equal(el.salvar.textContent, "Conferir");
  await el.ligar.onsubmit({ preventDefault() {} });
  assert.equal(corpos.at(-1).conferir, true);
  await el.ligar.onsubmit({ preventDefault() {} });
  assert.deepEqual(corpos.at(-1), { anfitriao: "@recepcao", canal: "https://app.agentes.chat/org/x/c/y" });
  assert.equal(el.confirmar.textContent, "");
  assert.equal(el.situacao.textContent, "Recepcionista: Recepção (@recepcao), salvo nesta tela.");
  assert.equal(el.limpar.hidden, false);

  await el.limpar.onclick();
  assert.deepEqual(corpos.at(-1), { limpar: true });
  assert.equal(el.limpar.hidden, true);

  contexto.tela = "fechada";
  await el.limpar.onclick();
  assert.equal(el.salvar.disabled, true, "tela desligada no servidor: não salva");
}

async function senhaAliMesmo() {
  // modo resposta fechado (403 com codigo modo_fechado): a senha vai na própria tela, sem passar pela tela Conversas
  const el = {};
  const novo = id => (el[id] = { id, value: "", textContent: "", disabled: false, hidden: false, dataset: {},
    addEventListener(tipo, fn) { this["on" + tipo] = fn; }, replaceChildren() {}, focus() { this.focado = true; }, select() {} });
  ["empresa", "instrucoes", "copiar", "ligar", "salvar", "limpar", "estado", "situacao", "faltam", "nome", "faz", "site",
    "contato", "horario", "evitar", "anfitriao", "canal", "confirmar", "bloco-senha", "senha"].forEach(novo);
  el["bloco-senha"].hidden = true;
  const urls = [];
  let aberto = false;
  const contexto = {
    document: { getElementById: id => el[id], createElement: () => ({}) }, navigator: {},
    fetch: async (url, opcoes) => {
      const corpo = JSON.parse(opcoes.body);
      urls.push(url);
      if (url === "/api/conversa/modo") {
        if (corpo.senha !== "certa") return { ok: false, json: async () => ({ erro: "senha_incorreta", mensagem: "Senha incorreta." }) };
        aberto = true; return { ok: true, json: async () => ({ resta_s: 3600 }) };
      }
      if (!Object.keys(corpo).length) return { ok: true, json: async () => ({ origem: "nenhum", tela: "livre", faltam: [] }) };
      if (!aberto) return { ok: false, json: async () => ({ erro: "Para trocar o recepcionista, confirme a senha do escritório.", codigo: "modo_fechado" }) };
      return { ok: true, json: async () => ({ anfitriao: "recepcao", canal: "c1", nome: "Recepção", canal_nome: "visitas" }) };
    },
  };
  vm.runInNewContext(codigo, contexto);
  await new Promise(r => setImmediate(r));
  el.anfitriao.value = "@recepcao"; el.canal.value = "https://app.agentes.chat/org/x/c/y";
  const ev = { preventDefault() {} };
  await el.ligar.onsubmit(ev);
  assert.equal(el["bloco-senha"].hidden, false, "o servidor pediu a senha: o campo aparece");
  assert.equal(el.senha.focado, true);
  assert.match(el.estado.textContent, /confirme a senha/);
  await el.ligar.onsubmit(ev);   // vazio: nada sai
  assert.equal(el.estado.textContent, "Digite a senha do escritório.");
  el.senha.value = "errada"; el.senha.focado = false;
  await el.ligar.onsubmit(ev);
  assert.equal(el.estado.textContent, "Senha incorreta.");
  assert.equal(el.senha.focado, true, "senha errada: o foco volta ao campo");
  assert.equal(el["bloco-senha"].hidden, false);
  assert.equal(el.senha.value, "", "a senha não fica no campo");
  el.senha.value = "certa";
  await el.ligar.onsubmit(ev);
  assert.equal(el["bloco-senha"].hidden, true);
  assert.match(el.confirmar.textContent, /^Recepção \(@recepcao\) vai atender no canal #visitas\./);
  assert.deepEqual(urls.filter(u => u === "/api/conversa/modo").length, 2);
}

instrucoes();
tela().then(senhaAliMesmo).then(() => console.log("ok"), e => { console.error(e); process.exit(1); });
