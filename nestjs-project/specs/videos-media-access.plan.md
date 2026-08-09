---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5
target_file: test/videos-media-access.e2e-spec.ts
---

# Videos Media Access Endpoints Test Plan

## Application Overview

Valida consulta, streaming, download e thumbnail por URL estavel da API. A API deve autenticar o dono, ocultar videos alheios e redirecionar para URLs temporarias do MinIO privado, deixando o storage responder Range/206 e os bytes da midia.

## Test Scenarios

### 1. Consulta e autorizacao

**Setup:** iniciar `AppModule` com configuracao global equivalente a `main.ts`; usar PostgreSQL e MinIO reais; limpar estado entre casos; criar dois usuarios confirmados com canais e JWTs; persistir videos com IDs publicos conhecidos e objetos privados de fonte/thumbnail.

#### 1.1. consultar-metadata-segura-do-proprio-video

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-08-09T00:47:35Z

**Steps:**
  1. Chamar `GET /videos/:publicId` com o JWT do dono.
    - expect: status `200`.
    - expect: body contem `id`, `publicId`, titulo, nome original, content type, tamanho, status, duracao, metadata normalizada, `thumbnailAvailable`, `createdAt` e `updatedAt`.
    - expect: body nao contem `sourceStorageKey`, `thumbnailStorageKey`, `multipartUploadId` nem `processingError`.
  2. Chamar o mesmo endpoint sem JWT.
    - expect: status `401`.

#### 1.2. ocultar-video-de-outro-canal-em-todas-as-rotas

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-08-09T00:47:35Z

**Steps:**
  1. Com o JWT do segundo usuario, chamar metadata, stream, download e thumbnail usando o `publicId` do primeiro.
    - expect: cada endpoint retorna status `404`.
    - expect: cada body usa `error: VIDEO_NOT_FOUND` e nao retorna URL, estado ou proprietario.

#### 1.3. bloquear-midia-antes-de-ready

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-08-09T00:47:35Z

**Steps:**
  1. Para um video `DRAFT`, chamar stream, download e thumbnail como dono.
    - expect: cada endpoint retorna status `409` com `error: VIDEO_NOT_READY`.
  2. Repetir para status `PROCESSING` e `ERROR`.
    - expect: nenhum estado diferente de `READY` recebe URL assinada.

### 2. Fonte de video pronta

**Setup:** persistir video `READY` do usuario autenticado e enviar uma fonte MP4 conhecida ao MinIO privado; manter endpoint publico acessivel ao processo de teste.

#### 2.1. redirecionar-stream-com-disposicao-inline

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-08-09T00:47:35Z

**Steps:**
  1. Chamar `GET /videos/:publicId/stream` sem seguir redirect automaticamente.
    - expect: status `307` e header `Location` com hostname do endpoint publico do storage.
    - expect: a URL e temporaria, assinada e inclui resposta com disposicao inline.
    - expect: a resposta NestJS nao contem o corpo do video.

#### 2.2. consumir-range-diretamente-do-storage

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-08-09T00:47:35Z

**Steps:**
  1. Obter o redirect de stream e requisitar seu `Location` com `Range: bytes=0-1023`.
    - expect: MinIO retorna status `206`.
    - expect: headers incluem `Accept-Ranges: bytes`, `Content-Range` correspondente e `Content-Length: 1024`.
    - expect: body contem exatamente os primeiros 1024 bytes da fixture, sem download do restante.

#### 2.3. redirecionar-download-com-nome-sanitizado

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-08-09T00:47:35Z

**Steps:**
  1. Chamar `GET /videos/:publicId/download` para video cujo nome original contem espacos e caracteres inseguros.
    - expect: status `307` para o mesmo objeto fonte usado no streaming.
  2. Consumir a URL assinada.
    - expect: resposta do MinIO usa `Content-Disposition: attachment` com filename sanitizado.
    - expect: bytes recebidos correspondem integralmente a fixture fonte.

### 3. Thumbnail pronta

**Setup:** persistir video `READY` com `thumbnail_storage_key` e enviar JPEG conhecido ao mesmo bucket privado.

#### 3.1. entregar-thumbnail-sem-publicar-bucket

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-08-09T00:47:35Z

**Steps:**
  1. Chamar `GET /videos/:publicId/thumbnail` como dono.
    - expect: status `307` para URL publica temporaria e assinada.
  2. Consumir o `Location` retornado.
    - expect: status `200`, `Content-Type: image/jpeg`, disposicao inline e bytes iguais a fixture.
  3. Tentar acessar a chave do thumbnail sem assinatura.
    - expect: MinIO nega o acesso, comprovando que o bucket continua privado.
