# StreamTube Backend

API NestJS da plataforma StreamTube. A Fase 03 entrega upload multipart direto
para storage privado, processamento assincrono com FFmpeg, consulta de status,
streaming parcial, download e thumbnail.

## Arquitetura Local

| Servico        | Funcao                                           | Porta publicada               |
| -------------- | ------------------------------------------------ | ----------------------------- |
| `nestjs-api`   | API REST, autenticacao e publicador outbox       | `3000`                        |
| `video-worker` | Consumidor BullMQ e processamento FFmpeg/ffprobe | nenhuma                       |
| `db`           | PostgreSQL 17                                    | `DB_PUBLISHED_PORT` ou `5432` |
| `redis`        | Fila BullMQ persistente                          | `6379`                        |
| `minio`        | Storage S3 privado                               | `9000`                        |
| `minio-init`   | Cria o bucket privado idempotentemente           | nenhuma                       |
| `mailpit`      | SMTP local e caixa de entrada web                | `1025` / `8025`               |

Os hosts internos sao sempre os nomes dos servicos Compose (`db`, `redis` e
`minio`). URLs assinadas usam `STORAGE_PUBLIC_ENDPOINT`, normalmente
`http://localhost:9000`, porque precisam ser acessiveis ao cliente.

## Preparacao

Pre-requisitos: Docker Desktop ou Rancher Desktop com suporte a Docker Compose.

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec -T nestjs-api npm install
docker compose exec -T nestjs-api npm run migration:run
docker compose ps
```

Se a porta `5432` estiver ocupada, defina `DB_PUBLISHED_PORT=5433` no `.env`.
`DB_PORT` continua `5432`, pois e a porta usada dentro da rede Compose.

## Execucao

O worker e iniciado pelo Compose. Para iniciar a API em modo desenvolvimento:

```bash
docker compose exec nestjs-api npm run start:dev
```

Servicos locais:

- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/api/docs` quando `SWAGGER_ENABLED=true`
- Mailpit: `http://localhost:8025`
- Console MinIO: `http://localhost:9001`

## Fluxo De Videos

1. `POST /videos` cria o video `DRAFT` e uma sessao multipart.
2. `POST /videos/:id/upload-parts` assina partes selecionadas.
3. O cliente envia os bytes diretamente para as URLs do MinIO.
4. `POST /videos/:id/upload-completion` conclui o objeto, muda para
   `PROCESSING` e grava um evento na outbox PostgreSQL.
5. A API publica o evento no BullMQ/Redis e o `video-worker` executa
   FFmpeg/ffprobe, persiste metadata e cria uma thumbnail JPEG.
6. O video passa para `READY`.
7. As rotas de stream, download e thumbnail respondem `307` para URLs
   temporarias; o MinIO entrega os bytes e responde pedidos `Range` com `206`.

Endpoints autenticados:

| Metodo | Rota                            | Resultado                                     |
| ------ | ------------------------------- | --------------------------------------------- |
| `POST` | `/videos`                       | Cria upload multipart de ate 10 GB            |
| `POST` | `/videos/:id/upload-parts`      | Assina ate 100 partes por chamada             |
| `POST` | `/videos/:id/upload-completion` | Finaliza upload e agenda processamento        |
| `GET`  | `/videos/:publicId`             | Retorna status e metadata segura              |
| `GET`  | `/videos/:publicId/stream`      | Redireciona para fonte com disposicao inline  |
| `GET`  | `/videos/:publicId/download`    | Redireciona para download com nome sanitizado |
| `GET`  | `/videos/:publicId/thumbnail`   | Redireciona para thumbnail JPEG               |

Todas as consultas usam o canal do JWT. Identificadores de outro canal retornam
`VIDEO_NOT_FOUND`. Midia exige `READY`; nesta fase, acesso anonimo ainda nao foi
implementado. Exemplos de chamadas estao em `api.http`.

## Limites Operacionais

- Tamanho maximo declarado: `10.737.418.240` bytes (10 GiB).
- Parte multipart: `67.108.864` bytes (64 MiB), exceto a parte final.
- URLs de upload: `STORAGE_UPLOAD_URL_TTL_SECONDS`.
- URLs de leitura: `STORAGE_READ_URL_TTL_SECONDS`.
- Tentativas e backoff: `VIDEO_PROCESSING_ATTEMPTS` e
  `VIDEO_PROCESSING_BACKOFF_MS`.
- Concorrencia do worker: `VIDEO_PROCESSING_CONCURRENCY`.
- O bucket permanece privado; a API nunca transmite o corpo do video.

## OpenAPI

O contrato versionado fica em `openapi.json`.

```bash
docker compose exec -T nestjs-api npm run openapi:export
```

## Qualidade

Todos os comandos Node executam dentro do container:

```bash
docker compose exec -T nestjs-api npm test -- --runInBand
docker compose exec -T nestjs-api npm run test:e2e -- --runInBand
docker compose exec -T nestjs-api npx tsc --noEmit
docker compose exec -T nestjs-api npm run lint
docker compose exec -T nestjs-api npm run build
```

Testes de integracao e E2E compartilham o PostgreSQL e devem permanecer
seriais. O plano e as evidencias da Fase 03 ficam em
`docs/phases/phase-03-videos/`.
