# phase-03-videos - Progress

**Status:** in_progress
**SIs:** 2/6 completed

### SI-03.1 - Preparar storage, fila e configuracao
- **Status:** completed
- **Tests:** `docker compose exec nestjs-api npm test -- --runInBand --detectOpenHandles src/config/storage.config.spec.ts src/config/video-processing.config.spec.ts src/storage/storage.module.spec.ts src/queue/queue.module.spec.ts` - 4 suites e 7 testes aprovados.
- **Observations:** PostgreSQL, Mailpit, Redis, MinIO, inicializador do bucket e container da API confirmados em execucao; Redis saudavel com AOF `everysec` e `noeviction`; job de verificacao permaneceu `waiting` depois do reinicio do Redis e foi removido ao final; bucket privado recriado de forma idempotente; CORS publico e limpeza nativa de uploads incompletos configurados no MinIO. A instalacao reportou 36 vulnerabilidades no conjunto completo de dependencias (`2 low`, `14 moderate`, `19 high`, `1 critical`), ainda sem triagem e sem `npm audit fix` automatico.

### SI-03.2 - Criar upload multipart de videos
- **Status:** completed
- **Tests:** 6 suites e 21 testes aprovados: 5 suites unitarias/integracao (17 testes) com Jest serial e `test/videos-upload.e2e-spec.ts` (4 testes) com a configuracao E2E, todos dentro do container `nestjs-api`.
- **Observations:**
  - Migration `1786239926949-CreateVideosAndOutbox` aplicada; `typeorm schema:log` confirmou o schema alinhado sem SQL pendente.
  - Integracao real confirmou bucket privado, URL assinada com host publico e envio de bytes direto ao MinIO; a limpeza final deixou zero uploads multipart incompletos e zero registros de teste em `videos`/`outbox_events`.
  - O E2E terminou com codigo zero, mas `--detectOpenHandles` reportou um `CustomGC` originado pela cadeia preexistente `HandlebarsAdapter -> @css-inline/css-inline -> MailModule`; as demais suites nao reportaram handles.
  - Persistem avisos nao bloqueantes de `--localstorage-file` sem caminho e deprecacao do `pg` para chamadas concorrentes de `client.query()`.

### SI-03.3 - Finalizar upload com outbox transacional
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.4 - Processar video no worker FFmpeg
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.5 - Expor status, streaming e download
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.6 - Fechar documentacao e qualidade da fase
- **Status:** pending
- **Tests:** pending
- **Observations:** none
