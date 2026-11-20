"use strict";
// Gancho do modo apresentação (static/apresentacao.js, do mapa) no app.js e no index.html: com ela ligada, não há balões de
// fala (nem dos agentes, nem das visitas). Os nomes já saem mascarados do vida.js. E os ganchos da Onda 3 no mapa: a placa
// "em reunião" na porta e a faixa da convocação.
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("static/app.js", "utf8"), html = fs.readFileSync("static/index.html", "utf8");

// (1) o script logo depois do vida.js
assert.match(html, /<script src="vida\.js\?v=\d+"><\/script>\s*<script src="apresentacao\.js\?v=\d+"><\/script>/);

// (2) os balões (agentes, visitas e a equipe da zeladoria) só fora da apresentação
const cena = /\nfunction desenharCena\([\s\S]*?\n\}\n/.exec(app)[0];
const baloes = cena.split("\n").filter(l => l.includes("desenharBalao("));
assert.equal(baloes.length, 3);
assert.match(cena, /const baloes = !\(window\.Apresentacao && Apresentacao\.ligado\(\)\);/);
for (const l of baloes) assert.match(l, /^\s*if \(baloes\) /, l.trim());
// (3) a placa "em reunião" na porta (mapa.js), logo depois das portas, nas coordenadas do mundo
assert.match(cena, /\n  desenharPortas\(t\);\n  for \(const s of \[\.\.\.predio\.salas, \.\.\.predio\.baixo\]\) if \(Vida\.emReuniao\(s\.chave\)\) Mapa\.desenharPlacaReuniao\(ctx, s\);.*\n/);

// (4) a convocação (o vida.js dispara "convocacao" {nome, sala}): a mesma faixa do aceno, lida pelo leitor de tela
{
  const vm = require("node:vm"), ouvintes = {}, el = { hidden: true, textContent: "" };
  const trecho = /\n\/\/ aceno recebido[\s\S]*?\n\}\);\n[\s\S]*?addEventListener\("convocacao"[\s\S]*?\n\}\);\n/.exec(app)[0];
  vm.runInNewContext(trecho, { addEventListener: (t, f) => (ouvintes[t] = f), $: () => el, setTimeout: () => 1, clearTimeout() {} });
  ouvintes.convocacao({ detail: { nome: "Beto", sala: "Sala de reunião" } });
  assert.equal(el.textContent, "Beto chamou a equipe para a Sala de reunião");
  assert.equal(el.hidden, false);
  ouvintes.convocacao({ detail: { nome: "Beto" } });
  assert.equal(el.textContent, "Beto chamou a equipe para uma reunião");
  ouvintes.aceno({ detail: { nome: "Ana", tipo: "porta" } });
  assert.equal(el.textContent, "Ana bateu na porta", "o aceno continua igual");
}
// (5) ligar e desligar a apresentação (evento window "apresentacao") redesenha o painel: a lista de agentes volta aos nomes
assert.match(app, /\naddEventListener\("apresentacao", \(\) => \{ if \(estado\) desenharPainel\(\); \}\);/);
console.log("test_apresentacao_gancho.js ok");
