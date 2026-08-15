---
libs:
  "@nestjs/bullmq":
    version: "^11.0.5"
    context7_id: "/nestjs/docs.nestjs.com"
    fetched_at: "2026-08-09T00:17:10.0906092Z"
  bullmq:
    version: "^6.0.9"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-08-09T00:17:10.0906092Z"
  "@aws-sdk/client-s3":
    version: "^3.1106.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-08-09T00:17:10.0906092Z"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1106.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-08-09T00:17:10.0906092Z"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-08-09T00:16:34.1227528Z"
---

# phase-03-videos — Library References

Documentacao relevante para as bibliotecas decididas na Fase 03. Referencias
consultadas via Context7; versoes estaveis confirmadas no registro npm.

### @nestjs/bullmq

**Source:** `/nestjs/docs.nestjs.com` (Context7)

**Version:** `^11.0.5`; compativel com NestJS 10 e 11 e BullMQ 3 a 6.

- O modulo oficial requer `@nestjs/bullmq` junto com `bullmq`.
- Use `BullModule.forRootAsync()` para obter host, porta e credenciais Redis da
  configuracao namespaced do projeto.
- Registre a fila com `BullModule.registerQueue({ name })` e o consumidor com
  `@Processor(queueName)`.
- O worker separado pode iniciar apenas o container de DI com
  `NestFactory.createApplicationContext()`, sem listener HTTP.
- Processadores devem ser providers do modulo importado pelo contexto do worker.

### bullmq

**Source:** `/taskforcesh/bullmq` (Context7)

**Version:** `^6.0.9`; requer Node.js `>=14.17.0`.

- `attempts` define o total de tentativas e `backoff` aceita estrategia
  exponencial com atraso base configuravel.
- `jobId` deterministico impede a inclusao de outro job enquanto o mesmo ID
  existir na fila; use o identificador do evento de outbox como chave.
- Configure `concurrency` explicitamente no worker para limitar processos FFmpeg
  simultaneos e preservar CPU, memoria e disco temporario.
- O handler continua responsavel por idempotencia no banco e no storage; a
  deduplicacao da fila nao substitui verificacao de status e chaves de objeto.
- A conexao Redis de API e worker deve usar o hostname do servico Compose.

### @aws-sdk/client-s3

**Source:** `/aws/aws-sdk-js-v3` (Context7)

**Version:** `^3.1106.0`; requer Node.js `>=20.0.0`.

- O fluxo multipart usa `CreateMultipartUploadCommand`, um
  `UploadPartCommand` por parte, `CompleteMultipartUploadCommand` com os ETags e
  `AbortMultipartUploadCommand` quando a sessao falha ou expira.
- Instancie `S3Client` uma vez por processo, usando endpoint interno, regiao e
  credenciais vindos da configuracao namespaced.
- MinIO local usa endpoint customizado e enderecamento path-style; containers
  acessam o hostname do servico, nunca `localhost`.
- Persistir `uploadId`, chave do objeto, numero das partes e ETags permite
  finalizar o upload de forma idempotente.
- `GetObjectCommand` aceita `ResponseContentDisposition` para diferenciar
  streaming inline e download como anexo.

### @aws-sdk/s3-request-presigner

**Source:** `/aws/aws-sdk-js-v3` (Context7)

**Version:** `^3.1106.0`; requer Node.js `>=20.0.0`.

- `getSignedUrl(client, command, { expiresIn })` gera URLs temporarias para
  comandos S3; fixe a expiracao em configuracao em vez de depender do default de
  900 segundos.
- Para upload multipart, assine cada `UploadPartCommand` com `UploadId` e
  `PartNumber`; os bytes seguem diretamente para MinIO/S3.
- Para streaming e download, assine `GetObjectCommand` somente depois de validar
  autenticacao, propriedade e status do video na API.
- Parametros de resposta, como `ResponseContentDisposition`, precisam fazer parte
  do comando antes da assinatura.
