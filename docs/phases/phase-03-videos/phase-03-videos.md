---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-08-09T00:18:48.2465820Z"
  docs/phases/phase-03-videos/library-refs.md: "2026-08-09T00:17:46.5726912Z"
  docs/project-plan.md: "2026-08-08T20:01:37.8345380Z"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-08-09T00:16:34.1227528Z"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-08-08T20:33:31.3534953Z"
  docs/phases/phase-01-configuracao-base/context.md: "2026-08-08T20:33:31.3724950Z"
  docs/phases/phase-02-auth/context.md: "2026-08-08T20:33:31.3954974Z"
  docs/phases/phase-02-auth-frontend/context.md: "2026-08-08T20:33:31.3814943Z"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-08-08T20:01:37.5114907Z"
---

# Fase 03 - Upload e Processamento de Videos

## Objective

Entregar no backend o armazenamento privado, upload multipart direto e retomavel de arquivos de ate 10 GB, pre-cadastro em rascunho, processamento assincrono com metadados e thumbnail, URL unica e acesso por streaming ou download sem colocar os bytes do video no caminho da API.

---

## Step Implementations

### SI-03.1 - Preparar storage, fila e configuracao

**Description:** Instalar e configurar as integracoes S3/MinIO e BullMQ/Redis, deixando a infraestrutura base reproduzivel no Compose antes do comportamento de videos.

**Technical actions:**

1. Adicionar `@aws-sdk/client-s3@^3.1106.0`, `@aws-sdk/s3-request-presigner@^3.1106.0`, `@nestjs/bullmq@^11.0.5` e `bullmq@^6.0.9` ao `nestjs-project/package.json` e lockfile, conforme as versoes fixadas em `library-refs.md` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`).
2. Criar `src/config/storage.config.ts`, `queue.config.ts` e `video-processing.config.ts`, registrar os factories no `ConfigModule`, validar todas as variaveis com Joi e documenta-las em `.env.example`; separar obrigatoriamente os endpoints interno e publico do storage (per `phase-03-videos/TD-09`, `phase-01-configuracao-base/TD-01`).
3. Criar `src/storage/storage.module.ts` com clientes S3 singleton para operacoes internas e assinatura publica, path-style no MinIO e bucket privado configuravel (per `phase-03-videos/TD-04`, `phase-03-videos/TD-09`).
4. Criar `src/queue/queue.module.ts` com `BullModule.forRootAsync()` apontando para o hostname Redis do Compose e registro central da fila `video-processing` (per `phase-03-videos/TD-01`).
5. Estender `nestjs-project/compose.yaml` com Redis persistente em AOF/noeviction, MinIO, inicializador idempotente do bucket privado, healthchecks, volumes, CORS para upload/Range e lifecycle para abortar multipart incompleto; adicionar as dependencias saudaveis ao `nestjs-api` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`, `phase-03-videos/TD-04`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `storageConfig` | Unit: defaults, endpoint separation and required credentials | `src/config/storage.config.spec.ts` |
| `queueConfig` / `videoProcessingConfig` | Unit: defaults, numeric bounds and Redis host | `src/config/video-processing.config.spec.ts` |
| `StorageModule` | Unit: module compilation with test config | `src/storage/storage.module.spec.ts` |
| `QueueModule` | Unit: module compilation with test config | `src/queue/queue.module.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `docker compose up -d db mailpit redis minio minio-init nestjs-api` deixa PostgreSQL, Mailpit, Redis, MinIO e API em estado running/healthy.
- O container da API alcanca storage e fila pelos hosts `minio` e `redis`, sem usar `localhost` para trafego interno.
- O bootstrap repetido do ambiente preserva um unico bucket privado e nao falha quando o bucket ja existe.
- Configuracao sem credenciais obrigatorias do storage falha no startup com validacao explicita.
- Redis reiniciado preserva jobs pendentes e opera com `maxmemory-policy=noeviction`.

---

### SI-03.2 - Criar upload multipart de videos

**Description:** Entregar o pre-cadastro em `DRAFT` e a emissao renovavel de URLs multipart para que arquivos de ate 10 GB sigam diretamente ao storage.

**Route:** `POST /videos`; `POST /videos/:id/upload-parts`
**Test Specs:** see `nestjs-project/specs/videos-upload.plan.md`
**Authorization:** usuario autenticado; o canal associado ao JWT `sub` e o proprietario do video.

**Technical actions:**

1. Criar `Video`, `OutboxEvent`, o enum `VideoStatus`, a relacao `Channel.videos` e uma migration forward/reverse com todos os campos, constraints e indexes de `### Data Model` (per `phase-03-videos/TD-07`, `phase-03-videos/TD-08`).
2. Criar `VideosModule`, registrar repositorios TypeORM e implementar as excecoes de dominio deste SI com o envelope existente, sem expor videos de outro canal (per `phase-02-auth/TD-07`).
3. Implementar `S3StorageService` para criar/abortar multipart e assinar lotes de `UploadPartCommand` com o cliente publico, mantendo todas as demais operacoes no endpoint interno (per `phase-03-videos/TD-02`, `phase-03-videos/TD-04`, `phase-03-videos/TD-09`).
4. Implementar `VideoUploadService` para resolver `channels.user_id`, gerar `public_id` Base64URL com retry de colisao, persistir `DRAFT`, chave imutavel, sessao multipart e assinar somente partes validas de 64 MiB (per `phase-03-videos/TD-02`, `phase-03-videos/TD-07`).
5. Criar DTOs, response DTOs e `VideosController` para os dois contratos de `### API Contracts`, com validacao, mapeamento seguro de bigint e decoradores OpenAPI explicitos (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: fields, enum default, relations, unique keys and indexes | `src/videos/entities/video.entity.integration-spec.ts` |
| `OutboxEvent` | Integration: defaults and unpublished-row indexes | `src/videos/entities/outbox-event.entity.integration-spec.ts` |
| `S3StorageService` multipart creation/signing | Integration: real MinIO, private bucket and public URL host | `src/storage/s3-storage.service.integration-spec.ts` |
| `VideoUploadService` | Unit: size/state/part validation, ownership and collision retry branches | `src/videos/services/video-upload.service.spec.ts` |
| `VideoUploadService` persistence | Integration: real channel/video DB contract and multipart session | `src/videos/services/video-upload.service.integration-spec.ts` |

E2E dos dois endpoints fica exclusivamente no arquivo indicado por `Test Specs`.

**Dependencies:** SI-03.1 - clientes, configuracao e servicos MinIO/Redis precisam existir.

**Acceptance criteria:**

- `POST /videos` com metadados validos retorna `201` com `id`, `publicId`, `DRAFT`, `uploadId`, parte de 64 MiB e quantidade total correta.
- Iniciar um upload persiste exatamente um video ligado ao canal do usuario, com `public_id` e `source_storage_key` unicos.
- `POST /videos/:id/upload-parts` com partes validas retorna `200` e URLs cujo host corresponde ao endpoint publico configurado.
- Requisitar novamente uma parte falha ou expirada retorna uma nova assinatura para a mesma sessao, sem criar outro video.
- Declarar mais de 10.737.418.240 bytes retorna `413` com `VIDEO_UPLOAD_TOO_LARGE`.
- Usar o UUID de upload pertencente a outro canal retorna `404` com `VIDEO_NOT_FOUND`.

---

### SI-03.3 - Finalizar upload com outbox transacional

**Description:** Concluir o objeto de forma repetivel e registrar o processamento sem janela de perda entre PostgreSQL e Redis.

**Route:** `POST /videos/:id/upload-completion`
**Test Specs:** see `nestjs-project/specs/videos-upload-completion.plan.md`
**Authorization:** usuario autenticado e proprietario pelo canal; respostas idempotentes somente para o mesmo video.

**Technical actions:**

1. Estender `S3StorageService` com conclusao multipart e `HeadObject`, incluindo a recuperacao por chave/tamanho quando o upload ID ja tiver sido consumido (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03`).
2. Implementar `VideoCompletionService` com lock pessimista, verificacao de dono/estado/upload ID, normalizacao de partes/ETags e retorno idempotente para `PROCESSING` ou `READY` (per `phase-03-videos/TD-03`, `phase-03-videos/TD-08`).
3. Na mesma transacao PostgreSQL, mudar `DRAFT` para `PROCESSING`, limpar `multipart_upload_id`, registrar `upload_completed_at` e inserir um unico `video.processing.requested.v1` em `outbox_events` (per `phase-03-videos/TD-08`).
4. Implementar `VIDEO_UPLOAD_INVALID_PARTS`, `VIDEO_UPLOAD_INVALID_STATE`, `VIDEO_UPLOAD_OBJECT_INVALID` e os mapeamentos seguros de falha do storage conforme `### Error Catalog` (per `phase-02-auth/TD-07`).
5. Criar o DTO de conclusao e conectar o endpoint ao controller com resposta `202`, schemas, exemplos e respostas OpenAPI explicitas conforme `### API Contracts` (per `openapi-docs-nestjs/TD-01`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `S3StorageService` completion/recovery | Integration: real multipart, ETags, HeadObject and consumed upload ID | `src/storage/s3-storage-completion.integration-spec.ts` |
| `VideoCompletionService` | Unit: validation, ownership, state and idempotency branches | `src/videos/services/video-completion.service.spec.ts` |
| `VideoCompletionService` transaction | Integration: real DB lock, status transition and one outbox row | `src/videos/services/video-completion.service.integration-spec.ts` |
| Concurrent completion | Integration: two completions yield one state transition and one event | `src/videos/services/video-completion-concurrency.integration-spec.ts` |

E2E do endpoint fica exclusivamente no arquivo indicado por `Test Specs`.

**Dependencies:** SI-03.2 - o video `DRAFT`, a sessao multipart e as duas entidades precisam existir.

**Acceptance criteria:**

- `POST /videos/:id/upload-completion` com todas as partes validas retorna `202` com o video em `PROCESSING`.
- A conclusao bem-sucedida confirma no storage um objeto com a chave e o tamanho declarados no pre-cadastro.
- Repetir a mesma conclusao apos sucesso retorna `202` com o estado atual e nao cria outro evento outbox.
- Duas conclusoes concorrentes produzem uma unica transicao `DRAFT` para `PROCESSING` e um unico comando de processamento.
- Partes ausentes, duplicadas ou desordenadas retornam `400` com `VIDEO_UPLOAD_INVALID_PARTS`.
- Objeto concluido com tamanho inesperado retorna `422` com `VIDEO_UPLOAD_OBJECT_INVALID`.
- Tentar concluir video de outro canal retorna `404` com `VIDEO_NOT_FOUND` e nao altera storage nem banco.

---

### SI-03.4 - Processar video no worker FFmpeg

**Description:** Publicar a outbox com entrega pelo menos uma vez e consumir o job em processo separado, gerando metadados e thumbnail com retry idempotente.

**Technical actions:**

1. Implementar `OutboxPublisherService` com lote, `FOR UPDATE SKIP LOCKED`, `jobId = eventId`, cinco tentativas e backoff exponencial, marcando `published_at` somente depois de `queue.add` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-08`).
2. Criar `VideoWorkerModule`, `src/video-worker.ts`, script `start:worker` e `VideoProcessingConsumer` registrado na fila `video-processing`, sem controllers nem listener HTTP (per `phase-03-videos/TD-01`, `phase-03-videos/TD-05`).
3. Implementar `VideoMediaProcessor` com download interno para diretorio temporario unico, `execFile` para `ffprobe` JSON e `ffmpeg`, normalizacao do metadata e upload JPEG na chave definida em `### Data Model` (per `phase-03-videos/TD-04`, `phase-03-videos/TD-05`).
4. Implementar idempotencia e transicoes do consumer conforme `### Events/Messages`: no-op para `READY`, processamento apenas em `PROCESSING`, commit atomico de `READY`, retry transitorio, `ERROR` somente na ultima falha e limpeza em `finally` (per `phase-03-videos/TD-08`).
5. Instalar os binarios FFmpeg/ffprobe na imagem, adicionar o servico `video-worker` ao Compose usando a mesma base do backend e configurar concorrencia um, disco temporario, dependencias saudaveis e desligamento gracioso (per `phase-03-videos/TD-05`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `OutboxPublisherService` | Unit: batch, retry and publish-marking branches | `src/videos/processing/outbox-publisher.service.spec.ts` |
| Outbox to BullMQ | Integration: real PostgreSQL and Redis, including broker recovery | `src/videos/processing/outbox-publisher.service.integration-spec.ts` |
| `VideoMediaProcessor` | Integration: real MinIO and FFmpeg/ffprobe with a small fixture | `src/videos/processing/video-media-processor.integration-spec.ts` |
| `VideoProcessingConsumer` | Unit: idempotency, retry and terminal-state branches | `src/videos/processing/video-processing.consumer.spec.ts` |
| Full worker job | Integration: real DB, Redis, MinIO and worker completion | `src/videos/processing/video-processing.consumer.integration-spec.ts` |

**Dependencies:** SI-03.1 - Redis/MinIO/BullMQ; SI-03.3 - outbox e contrato `video.processing.requested.v1`.

**Acceptance criteria:**

- Um outbox pendente causa a criacao de um job `process-video` com payload e identidade definidos em `### Events/Messages`.
- Redis indisponivel mantem a outbox nao publicada; apos recuperacao, o job e entregue sem nova chamada HTTP.
- Processar um video valido grava duracao/metadados, cria `videos/{videoId}/thumbnails/default.jpg` e muda o status para `READY`.
- Reentregar um job de video `READY` termina sem duplicar thumbnail nem regredir o status.
- Uma falha transitoria e repetida com backoff; somente a quinta falha muda `PROCESSING` para `ERROR`.
- Depois de sucesso ou falha, os arquivos temporarios daquele job deixam de existir no container.
- `docker compose up -d` inicia `video-worker` como processo separado e a API continua fora do caminho de CPU e bytes do FFmpeg.

---

### SI-03.5 - Expor status, streaming e download

**Description:** Entregar URLs estaveis da plataforma que autorizam o proprietario e redirecionam os bytes de fonte ou thumbnail para o storage privado.

**Route:** `GET /videos/:publicId`; `GET /videos/:publicId/stream`; `GET /videos/:publicId/download`; `GET /videos/:publicId/thumbnail`
**Test Specs:** see `nestjs-project/specs/videos-media-access.plan.md`
**Authorization:** usuario autenticado e proprietario pelo canal; midia acessivel somente em `READY` nesta fase.

**Technical actions:**

1. Implementar `VideoQueryService` com busca conjunta por `public_id` e `channels.user_id`, serializacao segura e response DTO sem chaves/diagnosticos internos conforme `### API Contracts` (per `phase-03-videos/TD-07`).
2. Estender `S3StorageService` para assinar `GetObjectCommand` no endpoint publico com expiracao configurada, disposicao inline/attachment e nome original sanitizado (per `phase-03-videos/TD-06`, `phase-03-videos/TD-09`).
3. Implementar `VideoMediaAccessService` para exigir `READY`, selecionar fonte/thumbnail e produzir redirecionamentos temporarios sem transmitir corpo pela API (per `phase-03-videos/TD-04`, `phase-03-videos/TD-06`).
4. Adicionar os quatro endpoints ao `VideosController`, preservando `Range` no cliente apos `307` e declarando parametros, respostas e erros OpenAPI explicitamente conforme `### API Contracts` (per `openapi-docs-nestjs/TD-01`).
5. Implementar `VIDEO_NOT_FOUND`, `VIDEO_NOT_READY` e `VIDEO_STORAGE_UNAVAILABLE` conforme `### Error Catalog`, com `404` uniforme para identificadores de outro canal (per `phase-02-auth/TD-07`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoQueryService` | Unit: safe mapping and not-found branches | `src/videos/services/video-query.service.spec.ts` |
| Video owner query | Integration: real channel relation and public ID lookup | `src/videos/services/video-query.service.integration-spec.ts` |
| `VideoMediaAccessService` | Integration: real private MinIO, signed dispositions and Range/206 | `src/videos/services/video-media-access.service.integration-spec.ts` |

E2E dos quatro endpoints fica exclusivamente no arquivo indicado por `Test Specs`.

**Dependencies:** SI-03.2 - video e identificador publico; SI-03.4 - estado `READY`, metadata e thumbnail.

**Acceptance criteria:**

- `GET /videos/:publicId` pelo dono retorna `200` com status e metadata segura, sem storage keys ou erro interno.
- Consultar qualquer endpoint com `publicId` de outro canal retorna `404` com `VIDEO_NOT_FOUND`.
- Pedir fonte ou thumbnail antes de `READY` retorna `409` com `VIDEO_NOT_READY`.
- `GET /videos/:publicId/stream` em `READY` retorna `307` para URL publica assinada com disposicao inline.
- Seguir o redirecionamento de streaming com `Range` retorna `206`, `Content-Range` e somente o intervalo solicitado pelo MinIO.
- `GET /videos/:publicId/download` retorna `307` para o mesmo objeto fonte com `Content-Disposition: attachment` e nome sanitizado.
- `GET /videos/:publicId/thumbnail` retorna `307` e a URL assinada entrega `image/jpeg` sem tornar o bucket publico.

---

### SI-03.6 - Fechar documentacao e qualidade da fase

**Description:** Reconciliar contratos, documentacao operacional e evidencias da entrega somente depois que todo o fluxo de videos existir.

**Technical actions:**

1. Exportar e revisar `nestjs-project/openapi.json`, garantindo que todos os contratos de upload, status e midia tenham schemas, exemplos, autorizacao e erros por status code (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`).
2. Atualizar `CLAUDE.md` e `AGENTS.md` aplicaveis com o modulo real de videos, endpoints, MinIO, Redis, worker, comandos e limites operacionais; remover referencias `TBD` que deixem a arquitetura inconsistente com o codigo entregue.
3. Atualizar `docs/diagrams/software-arch.mermaid`, `nestjs-project/README.md` e exemplos HTTP necessarios para refletir apenas containers, configuracoes e fluxos efetivamente implementados.
4. Executar a jornada completa com infraestrutura real: criar upload, enviar partes direto ao MinIO, finalizar, aguardar `READY`, obter thumbnail, consumir um Range e baixar o objeto.
5. Executar toda a Definition of Done dentro do container e registrar comandos/resultados por SI em `docs/phases/phase-03-videos/progress.md`, sem marcar como aprovado o que nao tiver sido executado.

**Tests:** _(empty - fechamento executa as suites existentes e nao cria um novo artefato de teste)_

**Dependencies:** SI-03.1, SI-03.2, SI-03.3, SI-03.4 e SI-03.5 - fechamento depende do comportamento integral estar implementado.

**Acceptance criteria:**

- `docker compose up -d` apresenta API, PostgreSQL, Mailpit, Redis, MinIO e video worker em execucao, com dependencias prontas.
- A jornada iniciada pela API envia os bytes diretamente ao MinIO e termina com video `READY`, metadata e thumbnail persistidos.
- A URL estavel do video permite obter intervalo parcial e download completo sem tornar o bucket publico.
- O OpenAPI exportado contem os sete endpoints e os mesmos campos, status e codigos definidos em `### API Contracts`.
- A documentacao da ferramenta e da arquitetura descreve somente modulos, servicos, comandos e comportamentos existentes ao final da fase.
- `progress.md` relaciona cada SI ao respectivo status e as validacoes realmente observadas.

---

## Technical Specifications

### Data Model

#### Video

Tabela `videos`, proprietaria do ciclo de upload e processamento.

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated |
| channel_id | uuid | FK `channels.id`, not null |
| public_id | varchar(22) | not null, unique, imutavel; Base64URL de 16 bytes aleatorios |
| title | varchar(255) | not null |
| original_filename | varchar(255) | not null |
| content_type | varchar(127) | not null |
| size_bytes | bigint | not null; entre 1 e 10.737.418.240 bytes |
| status | enum `video_status` | not null, default `DRAFT`; `DRAFT`, `PROCESSING`, `READY`, `ERROR` |
| source_storage_key | varchar(512) | not null, unique; `videos/{id}/source` |
| thumbnail_storage_key | varchar(512) | nullable, unique; `videos/{id}/thumbnails/default.jpg` |
| multipart_upload_id | varchar(512) | nullable; definido enquanto o upload esta em `DRAFT` |
| duration_seconds | numeric(12,3) | nullable; preenchido pelo worker |
| metadata | jsonb | nullable; metadados normalizados do `ffprobe` |
| upload_completed_at | timestamptz | nullable |
| processing_started_at | timestamptz | nullable |
| processed_at | timestamptz | nullable |
| processing_error | text | nullable; diagnostico interno, nunca exposto na resposta HTTP |
| created_at | timestamptz | not null, default now() |
| updated_at | timestamptz | not null, auto-update |

**Relations:** `Channel` has many `Video`; `Video` belongs to one `Channel` through `channel_id` with `ON DELETE CASCADE`.

**Indexes:** unique on `public_id`; unique on `source_storage_key`; partial unique on non-null `thumbnail_storage_key`; regular indexes on `channel_id`, `status` and `(channel_id, created_at)`.

**Public identifier generation:** use `randomBytes(16).toString('base64url')`, with the PostgreSQL unique constraint as the final guarantee. Retry a collision up to five times, following the existing channel conflict pattern.

**Metadata JSON contract:** persist only normalized fields: `formatName`, `formatLongName`, `bitRate`, `videoCodec`, `width`, `height` and `frameRate`. Raw `ffprobe` output remains transient.

#### OutboxEvent

Tabela `outbox_events`, used to atomically persist the request for processing together with the `Video` status transition.

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated; event and BullMQ job identity |
| aggregate_type | varchar(50) | not null; fixed as `video` in this phase |
| aggregate_id | uuid | not null; references the logical video aggregate |
| event_type | varchar(100) | not null; `video.processing.requested.v1` |
| payload | jsonb | not null; message contract defined below |
| attempts | integer | not null, default 0 |
| next_attempt_at | timestamptz | not null, default now() |
| published_at | timestamptz | nullable |
| last_error | text | nullable; internal diagnostic |
| created_at | timestamptz | not null, default now() |

**Relations:** no ORM relation is required; `aggregate_id` is intentionally an outbox envelope field, while referential validity is guaranteed when the event is created in the same transaction as the `Video` update.

**Indexes:** partial index on `(next_attempt_at, created_at) WHERE published_at IS NULL`; index on `(aggregate_type, aggregate_id)`.

**Migration:** create `video_status`, `videos`, `outbox_events`, foreign key and all indexes in one forward migration; the reverse migration removes them in dependency order.

### API Contracts

All endpoints inherit the global JWT guard. HTTP errors use the existing envelope `{ statusCode, error, message }`. DTOs and responses receive explicit OpenAPI decorators and examples; internal storage keys, multipart credentials and processing diagnostics are never returned beyond the upload-session fields explicitly listed below.

#### POST /videos (SI-03.2)

Creates the `DRAFT` record, starts one multipart upload and returns its resumable session. No video bytes cross the API.

**Request headers:**
- `Authorization: Bearer {accessToken}`
- `Content-Type: application/json`

**Request body:**
- `title`: string, required, 1 to 255 characters after trimming
- `originalFilename`: string, required, 1 to 255 characters after basename sanitization
- `contentType`: string, required, valid `video/*` media type, max 127 characters
- `sizeBytes`: integer, required, 1 to 10.737.418.240

**Response 201:**
- `id`: string (uuid), internal upload command identifier
- `publicId`: string (22-character Base64URL)
- `status`: `DRAFT`
- `uploadId`: string, multipart session identity
- `partSizeBytes`: `67108864` (64 MiB)
- `totalParts`: integer, `ceil(sizeBytes / partSizeBytes)`
- `uploadPartUrlTtlSeconds`: integer, configured expiration reported to the client

**Error responses:**
- `400` validation error: malformed fields or non-video media type
- `401` authentication error: absent or invalid access token
- `413 VIDEO_UPLOAD_TOO_LARGE`: file exceeds 10 GB
- `502 VIDEO_STORAGE_UNAVAILABLE`: multipart creation failed in object storage

---

#### POST /videos/:id/upload-parts (SI-03.2)

Issues or renews pre-signed `UploadPart` URLs in bounded batches. The client can request failed or expired parts again without restarting the multipart upload.

**Request headers:**
- `Authorization: Bearer {accessToken}`
- `Content-Type: application/json`

**Request body:**
- `uploadId`: string, required; must match the session stored for the video
- `partNumbers`: array of unique integers, required, 1 to 100 items; every item must be between 1 and `totalParts`

**Response 200:**
- `videoId`: string (uuid)
- `uploadId`: string
- `expiresAt`: string (ISO-8601)
- `parts`: array of `{ partNumber: integer, url: string }`

**Error responses:**
- `400` validation error: malformed body or invalid part numbers
- `401` authentication error: absent or invalid access token
- `404 VIDEO_NOT_FOUND`: video does not exist or does not belong to the authenticated user's channel
- `409 VIDEO_UPLOAD_INVALID_STATE`: video is not `DRAFT` or upload identity does not match
- `502 VIDEO_STORAGE_UNAVAILABLE`: URLs could not be signed

---

#### POST /videos/:id/upload-completion (SI-03.3)

Idempotently completes the multipart upload and starts automatic processing. A successful retry returns the current `PROCESSING` or `READY` state instead of creating another event.

**Request headers:**
- `Authorization: Bearer {accessToken}`
- `Content-Type: application/json`

**Request body:**
- `uploadId`: string, required; must match the stored session
- `parts`: non-empty array of `{ partNumber: integer, eTag: string }`, with unique and ascending part numbers covering every uploaded part

**Response 202:**
- `id`: string (uuid)
- `publicId`: string
- `status`: `PROCESSING` or the already reached `READY`

**Error responses:**
- `400 VIDEO_UPLOAD_INVALID_PARTS`: missing, duplicated, unordered or malformed part/ETag data
- `401` authentication error: absent or invalid access token
- `404 VIDEO_NOT_FOUND`: video does not exist or does not belong to the authenticated user's channel
- `409 VIDEO_UPLOAD_INVALID_STATE`: completion is incompatible with the current state or upload identity
- `422 VIDEO_UPLOAD_OBJECT_INVALID`: completed object is absent or its size differs from `sizeBytes`
- `502 VIDEO_STORAGE_UNAVAILABLE`: object storage failed and completion could not be confirmed

**Idempotency/recovery:** after `CompleteMultipartUpload`, verify the expected key and size with `HeadObject`. If storage reports an already consumed upload ID during a retry, `HeadObject` is the recovery proof. In one PostgreSQL transaction, lock the `Video`, transition `DRAFT` to `PROCESSING`, clear `multipart_upload_id`, set `upload_completed_at` and insert exactly one `video.processing.requested.v1` outbox event.

---

#### GET /videos/:publicId (SI-03.5)

Returns the owner's processing state and safe metadata for polling or later frontend integration.

**Request headers:**
- `Authorization: Bearer {accessToken}`

**Response 200:**
- `id`: string (uuid)
- `publicId`: string
- `title`: string
- `originalFilename`: string
- `contentType`: string
- `sizeBytes`: integer serialized safely for JSON
- `status`: `DRAFT | PROCESSING | READY | ERROR`
- `durationSeconds`: number or `null`
- `metadata`: normalized metadata object or `null`
- `thumbnailAvailable`: boolean
- `createdAt`: string (ISO-8601)
- `updatedAt`: string (ISO-8601)

**Error responses:**
- `401` authentication error: absent or invalid access token
- `404 VIDEO_NOT_FOUND`: video does not exist or does not belong to the authenticated user's channel

---

#### GET /videos/:publicId/stream (SI-03.5)

Authorizes the owner and redirects to a short-lived, pre-signed GET with inline disposition. The client may send `Range`; MinIO/S3, not NestJS, returns `206 Partial Content` and the corresponding range headers.

**Request headers:**
- `Authorization: Bearer {accessToken}`
- `Range: bytes={start}-{end}`, optional and forwarded by the client after redirect

**Response 307:**
- `Location`: externally reachable pre-signed storage URL for the source object
- signed response disposition: `inline`

**Error responses:**
- `401` authentication error: absent or invalid access token
- `404 VIDEO_NOT_FOUND`: video does not exist or does not belong to the authenticated user's channel
- `409 VIDEO_NOT_READY`: video status is not `READY`
- `502 VIDEO_STORAGE_UNAVAILABLE`: read URL could not be signed

---

#### GET /videos/:publicId/download (SI-03.5)

Authorizes the owner and redirects to a short-lived, pre-signed GET for the same source object, overriding the response disposition to attachment with a sanitized original filename.

**Request headers:**
- `Authorization: Bearer {accessToken}`

**Response 307:**
- `Location`: externally reachable pre-signed storage URL for the source object
- signed response disposition: `attachment; filename="{sanitizedOriginalFilename}"`

**Error responses:**
- `401` authentication error: absent or invalid access token
- `404 VIDEO_NOT_FOUND`: video does not exist or does not belong to the authenticated user's channel
- `409 VIDEO_NOT_READY`: video status is not `READY`
- `502 VIDEO_STORAGE_UNAVAILABLE`: read URL could not be signed

---

#### GET /videos/:publicId/thumbnail (SI-03.5)

Authorizes the owner and redirects to a short-lived, pre-signed GET for the generated JPEG thumbnail with inline disposition.

**Request headers:**
- `Authorization: Bearer {accessToken}`

**Response 307:**
- `Location`: externally reachable pre-signed storage URL for the thumbnail object
- signed response content type: `image/jpeg`
- signed response disposition: `inline`

**Error responses:**
- `401` authentication error: absent or invalid access token
- `404 VIDEO_NOT_FOUND`: video does not exist or does not belong to the authenticated user's channel
- `409 VIDEO_NOT_READY`: video is not `READY` or has no thumbnail
- `502 VIDEO_STORAGE_UNAVAILABLE`: read URL could not be signed

---

#### Validation Rules - upload and identifiers

- `id`: valid UUID used only by owner-authorized upload commands.
- `publicId`: exactly 22 Base64URL characters (`A-Z`, `a-z`, `0-9`, `-`, `_`).
- `sizeBytes`: positive safe integer and no greater than 10.737.418.240 bytes.
- `partSizeBytes`: server-owned constant of 64 MiB; all non-final parts use this size.
- `partNumbers`: S3 numbering starts at 1; batches contain at most 100 unique values.
- `eTag`: non-empty string returned by object storage and sent without application-side reinterpretation.
- JSON `bigint` columns are mapped to number/string deliberately so TypeORM driver strings never leak as an accidental contract.

### Authorization Matrix

In this phase, a URL identifier is shareable and stable but does not make a draft public. Publication and visibility rules remain deferred to Phases 04 and 05.

| Endpoint | Anonymous | Authenticated non-owner | Channel owner |
|----------|-----------|-------------------------|---------------|
| POST /videos | no | n/a; the user's one-to-one channel becomes owner | yes |
| POST /videos/:id/upload-parts | no | no, respond as not found | yes while `DRAFT` |
| POST /videos/:id/upload-completion | no | no, respond as not found | yes; idempotent for completed upload |
| GET /videos/:publicId | no | no, respond as not found | yes |
| GET /videos/:publicId/stream | no | no, respond as not found | yes while `READY` |
| GET /videos/:publicId/download | no | no, respond as not found | yes while `READY` |
| GET /videos/:publicId/thumbnail | no | no, respond as not found | yes while `READY` |

**Ownership rule:** resolve the authenticated JWT `sub` against `channels.user_id` and constrain every query by the same channel. Return `VIDEO_NOT_FOUND`, not a permission-specific error, when another user's identifier is supplied to avoid confirming resource existence.

### Error Catalog

The response shape remains `{ statusCode: number, error: string, message: string }`, inherited from `phase-02-auth/TD-07` and implemented by the existing `DomainExceptionFilter`.

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| VIDEO_NOT_FOUND | 404 | Video identifier is absent or does not belong to the authenticated user's channel |
| VIDEO_UPLOAD_TOO_LARGE | 413 | Declared source size exceeds 10.737.418.240 bytes |
| VIDEO_UPLOAD_INVALID_PARTS | 400 | Part numbers or ETags cannot form a valid multipart completion request |
| VIDEO_UPLOAD_INVALID_STATE | 409 | Upload command conflicts with video status or stored upload identity |
| VIDEO_UPLOAD_OBJECT_INVALID | 422 | Completed source object is absent, uses the wrong key or has an unexpected size |
| VIDEO_NOT_READY | 409 | Streaming, download or thumbnail is requested before successful processing |
| VIDEO_STORAGE_UNAVAILABLE | 502 | Required MinIO/S3 operation or URL signing fails |
| VIDEO_PROCESSING_FAILED | internal | FFprobe, FFmpeg, temporary disk or thumbnail upload still fails after all retries; persist `ERROR` without exposing diagnostics |

Validation failures continue to use NestJS `400 Bad Request`; global JWT failures keep the existing authentication contract. `VIDEO_PROCESSING_FAILED` is an internal terminal result represented externally by `status: ERROR`, not a synchronous HTTP response.

### Events/Messages

#### video.processing.requested.v1

**Payload:**

```json
{
  "schemaVersion": 1,
  "eventId": "uuid",
  "videoId": "uuid",
  "sourceStorageKey": "videos/{videoId}/source",
  "requestedAt": "ISO-8601"
}
```

**Producer:** `OutboxPublisherService` in the API process (per `phase-03-videos/TD-08`).

**Consumer:** `VideoProcessingConsumer` in a Nest standalone worker container (per `phase-03-videos/TD-01` and `phase-03-videos/TD-05`).

**Trigger:** the idempotent upload-completion transaction changes the video from `DRAFT` to `PROCESSING` and inserts the outbox row. The publisher polls unpublished rows ordered by creation time using transactional row locking with `SKIP LOCKED`, calls BullMQ `queue.add` and marks `published_at` only after enqueue succeeds.

**Queue contract:** queue name `video-processing`, job name `process-video`, and `jobId = eventId`. Redis persistence uses AOF and `maxmemory-policy=noeviction`. Job options use five attempts with exponential backoff beginning at five seconds; completed and failed jobs are retained in bounded history for operational inspection.

**Delivery semantics:** at-least-once. Stable job identity reduces duplicates and consumer idempotency makes re-delivery safe (per `phase-03-videos/TD-08`).

**Consumer state rules:**

- Load the video by `videoId`; missing videos and `READY` videos are terminal no-ops.
- Process only `PROCESSING`; never move `DRAFT` directly inside the worker.
- Download the source through the internal storage endpoint to a unique temporary directory.
- Run `ffprobe` through `execFile` with JSON output, normalize metadata and duration, then run `ffmpeg` to produce one JPEG frame. Use 10% of duration capped at 30 seconds; use timestamp zero for videos shorter than one second. Fit within 1280x720 without upscaling or changing aspect ratio.
- Upload the JPEG to `videos/{videoId}/thumbnails/default.jpg` using the internal storage endpoint.
- In one DB transaction, write normalized metadata, duration and thumbnail key, set `processed_at`, clear `processing_error` and transition to `READY` only after all external processing succeeded.
- Throw transient failures so BullMQ applies retry/backoff. Only after the final failed attempt, persist the diagnostic and transition `PROCESSING` to `ERROR`.
- Remove downloaded source and generated files in `finally`; configure worker concurrency through environment with a safe default of one FFmpeg job per container.

**Storage endpoint rule:** API and worker operations use the Compose hostname from the internal endpoint; only pre-signed URLs are built with the separately configured public endpoint (per `phase-03-videos/TD-09`).

---

## Dependency Map

```text
SI-03.1 (root - dependencies, config, MinIO and Redis)
`-- SI-03.2 - depends on SI-03.1 (clients and infrastructure before multipart upload)
    `-- SI-03.3 - depends on SI-03.2 (draft video and multipart session before completion)
        `-- SI-03.4 - depends on SI-03.1 + SI-03.3 (queue infrastructure and outbox before worker)
            `-- SI-03.5 - depends on SI-03.2 + SI-03.4 (public ID and READY media before access)
                `-- SI-03.6 - depends on SI-03.1 through SI-03.5 (documentation and final verification)
```

---

## Deliverables

- [ ] SI-03.1 - Preparar storage, fila e configuracao
- [ ] SI-03.2 - Criar upload multipart de videos
- [ ] SI-03.3 - Finalizar upload com outbox transacional
- [ ] SI-03.4 - Processar video no worker FFmpeg
- [ ] SI-03.5 - Expor status, streaming e download
- [ ] SI-03.6 - Fechar documentacao e qualidade da fase

**Functional and infrastructure deliverables:**

- [ ] Um pedido no limite de 10.737.418.240 bytes cria sessao multipart de 160 partes de 64 MiB, sem receber o corpo do arquivo na API.
- [ ] A conclusao do upload inicia processamento automatico recuperavel e percorre `DRAFT -> PROCESSING -> READY` ou `ERROR`.
- [ ] FFprobe persiste duracao/metadata e FFmpeg gera a thumbnail no bucket privado.
- [ ] Cada video recebe `public_id` Base64URL imutavel protegido por indice unico.
- [ ] Streaming entrega `206 Partial Content` pelo storage e download usa disposicao attachment.
- [ ] PostgreSQL, Mailpit, Redis, MinIO, API e video worker sobem juntos via `nestjs-project/compose.yaml`.
- [ ] `docs/phases/phase-03-videos/progress.md` registra status e evidencias por SI.
- [ ] `CLAUDE.md`/`AGENTS.md`, OpenAPI e diagrama refletem o estado real da Fase 03.

**Full test suites:**

- [ ] Backend unit and integration tests pass (`cd nestjs-project && docker compose exec nestjs-api npm test -- --runInBand`).
- [ ] Backend E2E tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:e2e`).
- [ ] TypeScript check passes (`cd nestjs-project && docker compose exec nestjs-api npx tsc --noEmit`).
- [ ] Lint passes (`cd nestjs-project && docker compose exec nestjs-api npm run lint`).
- [ ] Production build succeeds (`cd nestjs-project && docker compose exec nestjs-api npm run build`).
