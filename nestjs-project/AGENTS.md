# AGENTS.md

## Backend NestJS

Leia `nestjs-project/CLAUDE.md`, as regras aplicaveis em `.claude/rules/` e o
plano do SI atual antes de editar o backend.

## Execucao

Execute `npm`, `npx`, `node`, `tsc`, migracoes e testes dentro do container
`nestjs-api`. Use, por exemplo:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e
docker compose exec nestjs-api npx tsc --noEmit
```

Testes de integracao e E2E compartilham banco e devem executar de forma serial.
Nao inicie o servidor NestJS a menos que o usuario solicite executar a
aplicacao. Ao preparar apenas o ambiente, suba os servicos de infraestrutura e
confirme os respectivos health checks.

## Convencoes

- Organize cada dominio em seu proprio modulo.
- Controllers tratam HTTP; services concentram regras de negocio.
- Persistencia e integracoes externas ficam atras de interfaces claras.
- Use migrations versionadas; nunca dependa de `synchronize`.
- Use DTOs e validacao nas entradas e mantenha o envelope de erros existente.
- Inclua assets nao TypeScript necessarios em producao no `nest-cli.json`.

## Videos E Processamento

- A API cria e conclui uploads multipart, mas os bytes trafegam diretamente
  entre o cliente e o MinIO.
- O bucket `streamtube` e privado; leitura e upload usam URLs temporarias.
- O publicador outbox roda na API e publica jobs idempotentes no BullMQ/Redis.
- O `video-worker` e um processo Nest standalone com FFmpeg/ffprobe.
- Rode `npm run openapi:export` no container ao alterar contratos HTTP.
- Para a validacao final da fase, mantenha `nestjs-api`, `db`, `redis`, `minio`,
  `minio-init`, `video-worker` e `mailpit` em execucao.
