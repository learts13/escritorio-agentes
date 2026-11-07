# Deploy no Coolify (ARM64, acesso privado)

Este fork pode ser compilado no próprio servidor ARM64 pelo Coolify. A imagem roda em Docker, guarda os dados em um volume nomeado e fica acessível pela tailnet usando o Tailscale Serve do host.

## Antes de começar

- Ubuntu 24.04 ARM64 com Docker e Coolify funcionando.
- Tailscale instalado e conectado na VPS; MagicDNS e HTTPS da tailnet habilitados.
- O UUID da organização do agentes.chat, que aparece em `https://app.agentes.chat/org/<UUID>/...`.
- A URL MagicDNS da VPS, por exemplo `https://vps.minha-tailnet.ts.net`.

## Criar o recurso

1. No Coolify, crie um recurso de aplicação a partir do repositório GitHub `learts13/escritorio-agentes`.
2. Use a branch `feat/coolify-arm64` e o arquivo Compose `compose.yaml`. O próprio Coolify vai construir a imagem pelo Dockerfile do repositório.
3. Configure estas variáveis de ambiente no recurso:

   | Variável | Valor |
   | --- | --- |
   | `AGENTES_ORG` | UUID da organização no agentes.chat |
   | `ESCRITORIO_BASE` | URL HTTPS MagicDNS da VPS, sem barra no final |
   | `ESCRITORIO_FONTE` | `https://github.com/learts13/escritorio-agentes` |
   | `COOLIFY_HOST_PORT` | `7372`, ou outra porta livre no host |

   O arquivo `.env.coolify.example` serve de referência. Não use uma URL pública do proxy do Coolify: o acesso deve passar pelo Tailscale Serve.

4. Faça o primeiro deploy e confira se o container fica saudável. O Compose publica a porta somente em `127.0.0.1` da VPS.

## Publicar HTTPS privado pela Tailscale

Antes de alterar o Tailscale Serve, confira o que já está publicado:

```bash
sudo tailscale status
sudo tailscale serve status
```

Se a rota HTTPS raiz da VPS estiver livre, encaminhe-a para a porta local do Compose:

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:7372
sudo tailscale serve status
```

Acesse `https://<nome-magicdns-da-vps>/` pela tailnet. A porta 7372 não fica aberta para a internet. Se a porta 443 ou a rota raiz já publicar outro serviço, não substitua essa configuração; escolha uma porta HTTPS livre do Tailscale Serve e use exatamente a mesma URL em `ESCRITORIO_BASE`.

O aplicativo exige `ESCRITORIO_PORTA` abaixo de 1024 porque sua URL externa usa HTTPS. Dentro do container, ele recebe a capacidade mínima `NET_BIND_SERVICE`; no host, o Compose limita a publicação a `127.0.0.1`.

## Primeiro acesso e conexão

No terminal do container pelo Coolify, execute:

```bash
python3 -I /app/escritorio.py codigo
```

Use o código exibido na tela de entrada para criar a conta. Depois, siga a opção de conectar ao agentes.chat dentro do aplicativo. `ESCRITORIO_BASE` precisa estar correta antes de autorizar, pois ela compõe o endereço de retorno OAuth.

O `times.json` começa com o exemplo do repositório. Ajuste os nomes e identificadores de agentes conforme sua organização.

## Dados e atualizações

O volume nomeado `escritorio_dados` guarda os tokens OAuth, usuários, sessões, logo, placar e personalizações. Atualizar ou recriar o container mantém o volume. Não use uma opção do Coolify/Docker que remova volumes ao excluir o recurso.

Se você já instalou pelo `instalar.sh`, os dados em `/var/lib/escritorio` e o `times.json` em `/opt/escritorio` não migram sozinhos para o volume Docker. Copie-os para o volume antes de trocar a rota da Tailscale ou remover o serviço antigo; mantenha o serviço antigo até validar o login e a conexão no container.

O workflow **Coolify ARM64** compila e verifica a imagem em um runner ARM64 quando há mudanças relevantes ou um PR para `main` ou `feat/coolify-arm64`. Ele não publica imagem em um registry: o Coolify constrói diretamente do fork.

O arquivo `.github/upstream-release` guarda a tag estável selecionada, por exemplo `v2026.11.06`. Se você atualizar essa tag e fizer commit em `feat/coolify-arm64`, o workflow **Sync official release** é acionado: valida a release oficial, mescla o código, compila e faz o smoke test ARM64. Se passar, abre um PR para `feat/coolify-arm64`; depois de mesclar esse PR, o Coolify pode atualizar pelo webhook do GitHub ou pela checagem de atualizações do recurso.

O mesmo workflow também verifica diariamente a release estável mais recente e abre o PR quando encontra uma nova. O agendamento diário só fica ativo depois que o workflow estiver na branch padrão `main`, então primeiro será preciso integrar o PR inicial #1. Ele acompanha releases publicadas, não cada commit ainda não lançado do autor.

Para o workflow poder abrir PRs, em GitHub vá a **Settings → Actions → General** e permita que workflows criem pull requests. Conflitos com mudanças do upstream interrompem a sincronização automática; nesse caso, resolva o conflito em um PR antes de atualizar o deploy.
