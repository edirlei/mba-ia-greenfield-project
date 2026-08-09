---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.3
target_file: test/videos-upload-completion.e2e-spec.ts
---

# Videos Upload Completion Endpoint Test Plan

## Application Overview

Valida a conclusao idempotente do multipart e a transicao atomica de `DRAFT` para `PROCESSING`, incluindo confirmacao do objeto no MinIO, criacao unica da outbox e protecao contra partes, tamanho, concorrencia e propriedade invalidos.

## Test Scenarios

### 1. Conclusao confiavel

**Setup:** iniciar `AppModule` com configuracao global equivalente a `main.ts`; usar PostgreSQL e MinIO reais; limpar banco, bucket e fila entre casos; criar usuario confirmado, canal, JWT, video `DRAFT`, multipart e partes enviadas diretamente ao MinIO.

#### 1.1. concluir-upload-e-criar-comando-de-processamento

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-08-09T00:47:35Z

**Steps:**
  1. Enviar `POST /videos/:id/upload-completion` com o `uploadId` e todas as partes `{ partNumber, eTag }` em ordem.
    - expect: status `202`.
    - expect: body contem o mesmo `id`, `publicId` e `status: PROCESSING`.
  2. Consultar o objeto fonte no MinIO e a linha do video no PostgreSQL.
    - expect: chave e tamanho do objeto correspondem ao pre-cadastro.
    - expect: status e `PROCESSING`, `multipart_upload_id` esta nulo e `upload_completed_at` esta preenchido.
  3. Consultar `outbox_events` para o video.
    - expect: existe exatamente um `video.processing.requested.v1` com `eventId`, `videoId`, chave fonte e data solicitada.

#### 1.2. repetir-conclusao-sem-duplicar-outbox

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-08-09T00:47:35Z

**Steps:**
  1. Concluir uma sessao valida e repetir a mesma requisicao com o mesmo `uploadId` e ETags.
    - expect: as duas respostas usam status `202`.
    - expect: a segunda resposta informa `PROCESSING` ou o estado `READY` ja alcancado.
  2. Consultar banco e storage depois da repeticao.
    - expect: existe um objeto fonte, uma transicao de upload e exatamente um evento outbox.

#### 1.3. serializar-conclusoes-concorrentes

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-08-09T00:47:35Z

**Steps:**
  1. Disparar simultaneamente duas chamadas identicas para `POST /videos/:id/upload-completion`.
    - expect: ambas terminam de forma idempotente sem resposta `500`.
    - expect: pelo menos uma resposta e `202` com `PROCESSING`.
  2. Consultar `videos` e `outbox_events` apos ambas terminarem.
    - expect: ha uma unica transicao observavel e exatamente um comando de processamento.

### 2. Rejeicoes sem efeitos parciais

**Setup:** criar um novo video `DRAFT` e multipart por caso; manter snapshots do status, upload ID, contagem da outbox e objetos no bucket.

#### 2.1. rejeitar-lista-de-partes-invalida

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-08-09T00:47:35Z

**Steps:**
  1. Enviar conclusao com partes duplicadas, ausentes ou fora de ordem.
    - expect: status `400`.
    - expect: body segue o envelope de dominio com `error: VIDEO_UPLOAD_INVALID_PARTS`.
    - expect: video permanece `DRAFT` e nenhuma outbox e criada.
  2. Enviar body sem `eTag`.
    - expect: status `400`, provando o wiring do DTO no `ValidationPipe`.

#### 2.2. rejeitar-objeto-com-tamanho-divergente

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-08-09T00:47:35Z

**Steps:**
  1. Pre-cadastrar tamanho maior que os bytes efetivamente enviados e concluir o multipart com ETags validos.
    - expect: status `422`.
    - expect: body usa `error: VIDEO_UPLOAD_OBJECT_INVALID`.
    - expect: video nao avanca para `PROCESSING` e nenhuma outbox e criada.

#### 2.3. ocultar-upload-de-outro-canal

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-08-09T00:47:35Z

**Steps:**
  1. Criar segundo usuario/canal e chamar a conclusao do primeiro video com o JWT do segundo.
    - expect: status `404` e `error: VIDEO_NOT_FOUND`.
    - expect: video, multipart e outbox permanecem inalterados.
  2. Repetir sem `Authorization`.
    - expect: status `401` e nenhum efeito no banco ou storage.
