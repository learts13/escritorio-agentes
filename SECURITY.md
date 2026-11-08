# Security Policy · Política de segurança

[English](#english) · [Português (Brasil)](#português-brasil)

## English

### Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through GitHub's private vulnerability reporting:

**➡️ [Report a vulnerability](https://github.com/HelbertMoura/escritorio-agentes/security/advisories/new)**

This is the only reporting channel; there is no e-mail address. Please include:

- what you found and where (file, route or step of the installer);
- how to reproduce it, and the impact you expect;
- the version or commit you tested.

Please give us a reasonable time to fix it before any public disclosure. We will keep you posted in the advisory and credit you, if you want.

### Supported versions

Only the latest version on the `main` branch receives security fixes.

### Scope

Especially welcome: login, sessions and cookies; the first-access code; the OAuth token for agentes.chat; the data folder; `instalar.sh` and the systemd unit; the `Dockerfile`, the `.dockerignore` and the `docker-compose.yml`; anything that exposes the office outside the tailnet or, on Docker with a public address, beyond the sign-in.

Out of scope: problems in agentes.chat itself (report them to agentes.chat), in Tailscale, in Coolify or in your own server and proxy setup; attacks that need root on the server; and branding (name, color, logo) shown on the sign-in screen, which is public on the tailnet (or on the internet, with a public address) by design.

The security model is summarized in the [README](./README.md#security).

## Português (Brasil)

### Como reportar uma vulnerabilidade

Por favor, **não abra uma issue pública** para problemas de segurança. Reporte em particular pelo relatório privado de vulnerabilidades do GitHub:

**➡️ [Reportar uma vulnerabilidade](https://github.com/HelbertMoura/escritorio-agentes/security/advisories/new)**

Este é o único canal; não há endereço de e-mail. Inclua, por favor:

- o que você achou e onde (arquivo, rota ou passo do instalador);
- como reproduzir e o impacto que você espera;
- a versão ou o commit que você testou.

Dê um tempo razoável para a correção antes de qualquer divulgação pública. Vamos dar notícias pelo próprio advisory e dar o crédito, se você quiser.

### Versões com suporte

Só a versão mais recente do branch `main` recebe correções de segurança.

### Escopo

São especialmente bem-vindos: login, sessões e cookies; o código de primeiro acesso; o token OAuth do agentes.chat; a pasta de dados; o `instalar.sh` e a unit systemd; o `Dockerfile`, o `.dockerignore` e o `docker-compose.yml`; qualquer coisa que exponha o escritório fora da tailnet ou, no Docker com endereço público, além do login.

Fora do escopo: problemas do próprio agentes.chat (reporte a eles), da Tailscale, do Coolify ou da configuração do seu servidor e do seu proxy; ataques que exigem root no servidor; e a marca (nome, cor, logo) na tela de entrar, que é pública na tailnet (ou na internet, com endereço público) de propósito.

O modelo de segurança está resumido no [README](./README.pt-BR.md#segurança).
