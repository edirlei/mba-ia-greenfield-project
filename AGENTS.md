# AGENTS.md

## Projeto

StreamTube e uma plataforma de compartilhamento de videos. O monorepo contem o
backend NestJS em `nestjs-project/`, o frontend Next.js em `next-frontend/` e os
artefatos de planejamento em `docs/`.

Leia tambem o `CLAUDE.md` da raiz e o arquivo de instrucoes do subprojeto antes
de trabalhar nele. Em caso de divergencia operacional, este arquivo define a
convencao do Codex; os contratos de arquitetura e qualidade continuam vindo do
`CLAUDE.md` e dos documentos existentes.

## Fluxo Obrigatorio De Fases

Para uma nova fase, siga a ordem abaixo e nao implemente antes da validacao:

1. `$research` gera `docs/decisions/technical-decisions-{slug}.md`.
2. `$plan-context` gera `context.md`.
3. `$plan-validate` gera `validation.md`.
4. `$plan-resolve` resolve pendencias e gera `library-refs.md` quando necessario.
5. Repita validate/resolve ate `validation.md` terminar com `status: clean`.
6. `$plan-build` gera o plano com SIs e especificacoes tecnicas.
7. `$implement` executa um SI por vez e mantem `progress.md` atualizado.

Os contratos detalhados continuam em `.claude/skills/`; as skills equivalentes
do Codex em `.agents/skills/` aplicam esses contratos usando as ferramentas do
Codex. Nao invente requisitos para fechar lacunas: registre a origem de cada
decisao e pare para revisao do usuario quando houver escolha de produto ou
arquitetura.

## Arquitetura E Escopo

- Mantenha controllers, services, repositorios e integracoes externas com
  responsabilidades separadas.
- Prefira os padroes ja usados pelos modulos existentes.
- Use TypeScript estrito e contratos explicitos nas fronteiras.
- Limite cada alteracao ao SI ou tarefa em andamento.
- Nao misture refatoracoes, renomeacoes ou formatacao sem relacao com o escopo.

## Docker E Rede

O projeto roda em containers. Em configuracoes usadas dentro dos containers,
use o nome do servico do Compose como host, nunca `localhost` ou `127.0.0.1`.
Ferramentas MCP executadas no host podem usar a porta publicada, pois nao fazem
parte da rede interna do Compose.

## Fluxo De Videos Implementado

- `nestjs-api` autoriza uploads e grava a outbox; nao recebe os bytes do video.
- `minio` mantem fontes e thumbnails em bucket privado.
- `redis` e BullMQ transportam comandos de processamento.
- `video-worker` executa FFmpeg/ffprobe e atualiza o PostgreSQL.
- Uploads aceitam ate 10 GB, usam partes de 64 MiB e URLs assinadas temporarias.
- Streaming, download e thumbnail exigem o proprietario autenticado e estado
  `READY` na Fase 03.

## Git

- `main` e estavel e nao recebe commits diretos.
- O trabalho parte de `dev` em uma branch `feature/*` e retorna para `dev`.
- Nao faca commit, push, merge, rebase ou alteracoes destrutivas sem autorizacao
  explicita do usuario.

## Qualidade E Testes

Uma mudanca so esta concluida quando:

1. Os testes relevantes passam.
2. A suite completa passa.
3. `npx tsc --noEmit` termina com codigo 0.
4. O lint passa.

Use `*.spec.ts` para unidade, `*.integration-spec.ts` para integracao real e
`*.e2e-spec.ts` para o ciclo HTTP completo. Nao afirme que um comando passou
sem executa-lo.

## Documentacao De Bibliotecas

Antes de adotar ou implementar uma biblioteca nova, confirme a versao no
manifesto e consulte sua documentacao oficial via Context7. Registre as
referencias fixadas em `library-refs.md`. Se o Context7 estiver indisponivel,
pare a etapa que depende dele e informe a limitacao.
