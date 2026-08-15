---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.2
target_file: test/videos-upload.e2e-spec.ts
---

# Videos Upload Endpoint Test Plan

## Application Overview

Valida o contrato HTTP que pre-cadastra o video em rascunho e fornece URLs multipart para envio direto ao MinIO, incluindo autenticacao, validacao, propriedade do canal, limite de 10 GB e ausencia de bytes do arquivo no caminho da API.

## Test Scenarios

### 1. Criacao da sessao de upload

**Setup:** iniciar `AppModule` com os mesmos pipes e filtros globais de `main.ts`; usar PostgreSQL e MinIO reais; limpar `outbox_events`, `videos`, `channels`, `users` e objetos de teste antes de cada caso; criar usuario confirmado, canal e JWT validos.

#### 1.1. criar-sessao-multipart-em-rascunho

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-08-09T00:47:35Z

**Steps:**
  1. Enviar `POST /videos` autenticado com titulo, nome original, `video/mp4` e `sizeBytes = 10737418240`.
    - expect: status `201`.
    - expect: body contem `id`, `publicId`, `status: DRAFT`, `uploadId`, `partSizeBytes: 67108864`, `totalParts: 160` e TTL positivo.
    - expect: `publicId` tem exatamente 22 caracteres Base64URL.
  2. Consultar o PostgreSQL pelo `id` retornado.
    - expect: existe exatamente um video ligado ao canal autenticado.
    - expect: `public_id` e `source_storage_key` estao preenchidos e nao conflitam com outro video criado no mesmo teste.
  3. Repetir `POST /videos` sem `Authorization`.
    - expect: status `401` e nenhuma nova linha em `videos`.

#### 1.2. rejeitar-tamanho-ou-tipo-invalido

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-08-09T00:47:35Z

**Steps:**
  1. Enviar `POST /videos` com `sizeBytes = 10737418241`.
    - expect: status `413`.
    - expect: body segue `{ statusCode, error, message }` com `error: VIDEO_UPLOAD_TOO_LARGE`.
    - expect: nenhuma linha de video e nenhuma sessao multipart sao criadas.
  2. Enviar `POST /videos` com `contentType: application/octet-stream`.
    - expect: status `400`, provando que o `ValidationPipe` esta ligado ao DTO.

### 2. Assinatura e retomada das partes

**Setup:** criar uma sessao valida por `POST /videos` e manter `id`, `uploadId` e JWT do proprietario.

#### 2.1. assinar-parte-no-endpoint-publico

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-08-09T00:47:35Z

**Steps:**
  1. Enviar `POST /videos/:id/upload-parts` com o `uploadId` salvo e `partNumbers: [1]`.
    - expect: status `200`.
    - expect: body contem o mesmo `videoId`, `uploadId`, `expiresAt` futuro e uma parte numero 1 com URL.
    - expect: o hostname da URL corresponde ao endpoint publico do MinIO, nao ao hostname interno `minio`.
  2. Enviar bytes diretamente para a URL retornada.
    - expect: MinIO aceita a parte e retorna `ETag` sem que a requisicao passe pelo NestJS.
  3. Enviar o endpoint com `partNumbers` fora do intervalo da sessao.
    - expect: status `400`, provando a validacao HTTP do DTO.

#### 2.2. renovar-parte-e-ocultar-video-de-outro-canal

**Covers AC:** #4, #6
**Source:** auto
**Last sync:** 2026-08-09T00:47:35Z

**Steps:**
  1. Solicitar a assinatura da parte 1 duas vezes para a mesma sessao ainda em `DRAFT`.
    - expect: ambas as chamadas retornam `200` com assinatura valida e expiracao vigente para a mesma parte.
    - expect: o PostgreSQL continua com uma unica linha de video e o mesmo `multipart_upload_id`.
  2. Criar um segundo usuario/canal e chamar `POST /videos/:id/upload-parts` com o JWT desse usuario.
    - expect: status `404`.
    - expect: body usa `error: VIDEO_NOT_FOUND` e nao revela o proprietario real.
  3. Repetir a chamada sem JWT.
    - expect: status `401`.
