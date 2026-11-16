"use strict";
// Reuniões na página (1.6 Onda 3): o index.html traz tudo o que o reunioes.js procura, o "Entrar" em aba nova sem opener, e
// o app.js liga a rota #reunioes (só com config.equipe.reunioes), o menu, o Personalizar e o "Entrar" da lista de salas.
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("static/index.html", "utf8"), app = fs.readFileSync("static/app.js", "utf8"), js = fs.readFileSync("static/reunioes.js", "utf8");
const tag = id => { const m = new RegExp(`<[a-z][a-z0-9]* [^>]*id="${id}"[^>]*>`).exec(html); assert.ok(m, `falta #${id} no index.html`); return m[0]; };

// todo $("…") do reunioes.js existe no index.html, uma vez só
for (const id of new Set([...js.matchAll(/\$\("([a-z0-9-]+)"\)/g)].map(m => m[1]))) {
  tag(id);
  assert.equal(html.split(`id="${id}"`).length, 2, `#${id} repetido`);
}
// estilo e script: o reunioes.js antes do app.js (o app.js chama Reunioes ao subir)
assert.match(html, /<link rel="stylesheet" href="reunioes\.css\?v=\d+">/);
assert.ok(html.indexOf('src="reunioes.js?v=') > 0 && html.indexOf('src="reunioes.js?v=') < html.indexOf('src="app.js?v='));
// o menu e a tela: escondidos até o config dizer que há reuniões
assert.match(tag("nav-reunioes"), /href="#reunioes"[^>]*data-rota="reunioes"[^>]*hidden|data-rota="reunioes"[^>]*hidden/);
assert.match(tag("v-reunioes"), /class="visao"[^>]*hidden/);
// o título da semana recebe o foco quando o botão que abriu o diálogo some
assert.match(tag("reunioes-titulo"), /tabindex="-1"/);
// os links fixos: aba nova, sem opener nem referrer
for (const id of ["reuniao-entrar", "reuniao-aviso-entrar"]) assert.match(tag(id), /target="_blank" rel="noopener noreferrer"/, id);
// o "Entrar" do aviso com a mesma cara do da agenda
assert.match(tag("reuniao-aviso-entrar"), /class="botao reuniao-entrar-bt"/);
// o aviso de 5 min é lido pelo leitor de tela; os diálogos têm título
assert.match(tag("reuniao-aviso"), /role="status"/);
assert.match(tag("dlg-reuniao"), /<dialog [^>]*aria-labelledby="reuniao-titulo"/);
assert.match(tag("dlg-reuniao-confirmar"), /<dialog [^>]*aria-labelledby="rc-titulo"[^>]*aria-describedby="rc-texto"/);
// cada campo do formulário com rótulo
for (const id of ["r-titulo", "r-sala", "r-dia", "r-hora", "r-duracao", "rc-sala"]) assert.match(html, new RegExp(`<label [^>]*for="${id}"`), id);

// app.js: a rota existe e só abre com reuniões; o reunioes.js é iniciado com as salas do mapa e recebe o config
assert.match(app, /const TELAS = \[[^\]]*"reunioes"/);
assert.match(app, /r === "reunioes" && !Reunioes\.ligado\(config\)/);
assert.match(app, /if \(valida === "reunioes"\) Reunioes\.abrir\(\);/);
assert.match(app, /Reunioes\.iniciar\(\{ salas: \(\) => \(predio \? \[\.\.\.predio\.salas, \.\.\.predio\.baixo\] : \[\]\) \}\);/);
assert.match(/\nfunction aplicarConfig\(\) \{[\s\S]*?\n\}\n/.exec(app)[0], /Reunioes\.configurar\(config\);/);
assert.match(app, /Reunioes\.ajustes\(config\)/);
// a lista de salas da lateral: o "Entrar" ao lado do botão da sala (link não vai dentro de botão)
assert.match(/\nfunction montarSalas\(\) \{[\s\S]*?\n\}\n/.exec(app)[0], /li\.append\(b, Reunioes\.entrar\(s\.chave, s\.nome\)\)/);
// o toque no aviso de reunião (sw.js): com a aba aberta, o postMessage {tipo: "reuniao"}; sem ela, o ?reuniao= do endereço
assert.match(app, /d\.tipo === "reuniao" && Andar\.valido\(d\.andar\)/);
// aberto direto em #reunioes (recarregar a página): a agenda abre quando o config chega
assert.match(/\nfunction aplicarConfig\(\) \{[\s\S]*?\n\}\n/.exec(app)[0], /if \(location\.hash === "#reunioes" && telaAtual !== "reunioes"\) rota\(\);/);
assert.match(app, /searchParams\.get\("reuniao"\)/);
assert.match(/\nasync function abrirReuniao\(andar, id\) \{[\s\S]*?\n\}\n/.exec(app)[0], /Reunioes\.destacar\(id\)[\s\S]*location\.hash = "#reunioes"/);
console.log("test_reunioes_pagina.js ok");
