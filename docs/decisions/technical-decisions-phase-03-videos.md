---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-08-08
scope_description: "Upload direto e retomavel, armazenamento S3/MinIO, fila, worker de video, processamento, URL publica, streaming e download da Fase 03."
---

# Technical Decisions - Fase 03: Upload e Processamento de Videos

_Subprojetos no escopo:_

- `nestjs-project/` - backend da fase; recebe o modulo de videos, contratos HTTP,
  persistencia, integracao S3/MinIO, fila, worker FFmpeg e infraestrutura Docker.
- `next-frontend/` - fora do escopo de implementacao desta fase. O protocolo de
  upload e as URLs de reproducao serao contratos da API para um cliente futuro,
  sem decisao de runtime ou interface no frontend agora.

---

## TD-01: Tecnologia da fila de processamento

**Scope:** Backend

**Capability:** Transversal - covers: "Servico de processamento em segundo plano (filas)", "Processamento automatico do video apos upload (extracao de duracao e metadados)", "Geracao automatica de thumbnail a partir de um frame do video"

**Context:** O diagrama de arquitetura exige uma fila real entre a API e um
worker separado, mas deixa a tecnologia como TBD. O projeto usa NestJS 11,
TypeScript e PostgreSQL 17 e precisa de retries, concorrencia controlada,
observabilidade basica e execucao local integral via Docker Compose.

**Options:**

### Option A: BullMQ com Redis

O NestJS publica jobs com `@nestjs/bullmq`; um worker separado consome a fila
BullMQ armazenada no Redis. BullMQ fornece retries, backoff, concorrencia,
deduplicacao e eventos de worker.

- **Pros:** integracao oficial com NestJS; modelo de jobs adequado a tarefas
  demoradas; retries e backoff nativos; baixa complexidade de codigo; Redis e
  worker escalam separadamente.
- **Cons:** adiciona um servico Redis; exige persistencia AOF e
  `maxmemory-policy=noeviction`; entrega pode ocorrer mais de uma vez, portanto
  o worker precisa ser idempotente.

### Option B: RabbitMQ

A API publica mensagens AMQP em uma fila duravel e o worker usa acknowledgements
manuais, prefetch e dead-letter queue para controlar falhas e reentregas.

- **Pros:** broker maduro; garantias explicitas de confirmacao; filas duraveis,
  publisher confirms e dead-lettering; bom isolamento entre componentes.
- **Cons:** retries e politica de falha exigem mais topologia/configuracao;
  integracao representa mensagens, nao jobs, deixando mais orquestracao no
  codigo; operacao local e testes ficam mais complexos para uma unica fila.

### Option C: pg-boss sobre PostgreSQL

Os jobs ficam no PostgreSQL existente e o worker usa `SKIP LOCKED` para buscar
trabalho, podendo inserir o job na mesma transacao dos dados do video.

- **Pros:** elimina um novo datastore; permite atomicidade entre dados e job;
  suporta retry, backoff e dead-letter queue.
- **Cons:** processamento compete com a carga transacional do StreamTube; cria
  tabelas e manutencao da fila no banco principal; oferece menor isolamento
  operacional e nao materializa o servico de fila separado previsto no Compose.

**Recommendation:** **Option A (BullMQ com Redis)** - e a opcao de menor atrito
com NestJS 11 que ainda entrega fila real, retry, concorrencia e worker separado.
O custo adicional do Redis e aceitavel e suas exigencias operacionais podem ser
expressas no Compose e testadas localmente.

**Decision:** **A (BullMQ com Redis)**

**Libraries:** `@nestjs/bullmq`, `bullmq`

**Revisions:**

- 2026-08-08 - Confirma BullMQ com Redis como tecnologia da fila e worker
  separado. Rationale: torna a escolha autossuficiente quando o prefixo da
  recomendacao e removido no contexto consolidado.

---

## TD-02: Protocolo de upload retomavel de ate 10 GB

**Scope:** Backend

**Capability:** Transversal - covers: "Upload de videos com suporte a arquivos de ate 10GB sem impacto na performance", "Pre-cadastro automatico do video como rascunho ao iniciar o upload"

**Context:** O arquivo nao pode atravessar a API NestJS. Alem de suportar 10 GB,
o plano geral exige retomada apos falha de conexao. S3/MinIO ja e uma restricao
do projeto, portanto a decisao e como o cliente envia os bytes ao storage.

**Options:**

### Option A: Multipart upload S3 com URLs pre-assinadas

A API cria o video em rascunho, inicia `CreateMultipartUpload` e fornece URLs
pre-assinadas para `UploadPart`. O cliente envia partes diretamente ao MinIO/S3,
guarda `PartNumber` e `ETag`, repete somente partes com falha e depois solicita a
conclusao.

- **Pros:** nenhum byte do video passa pela API; protocolo nativo de MinIO/S3;
  upload paralelo e retomavel por parte; suporta 10 GB com ampla margem; troca
  de MinIO por S3 nao muda o contrato central.
- **Cons:** contrato possui mais etapas; cliente precisa controlar partes e
  ETags; exige CORS do bucket, expiracao de assinaturas e limpeza de uploads
  multipart abandonados.

### Option B: Protocolo tus com servidor tusd e backend S3

Um servico tusd recebe `HEAD`/`PATCH`, controla offsets retomaveis e grava o
resultado em armazenamento S3 compativel. A API continua responsavel pelo
registro do video e pela autorizacao do inicio.

- **Pros:** protocolo aberto e especializado em retomada; clientes oficiais;
  abstrai o controle manual de partes e offsets.
- **Cons:** adiciona outro servico, protocolo e superficie de autenticacao;
  aumenta o caminho operacional e de testes; a integracao com o ciclo do video
  e eventos de conclusao fica menos direta que o multipart nativo ja disponivel.

**Recommendation:** **Option A (multipart S3 com URLs pre-assinadas)** - atende
10 GB e retomada sem criar um servidor de upload adicional, mantem os bytes fora
da API e usa a mesma API em MinIO local e S3 em producao.

**Decision:** **A (multipart S3 com URLs pre-assinadas)**

**Libraries:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`

**Revisions:**

- 2026-08-08 - Confirma multipart S3 com URLs pre-assinadas para cada parte.
  Rationale: torna a escolha autossuficiente quando o prefixo da recomendacao e
  removido no contexto consolidado.

---

## TD-03: Deteccao de conclusao e inicio automatico do processamento

**Scope:** Backend

**Capability:** Transversal - covers: "Pre-cadastro automatico do video como rascunho ao iniciar o upload", "Processamento automatico do video apos upload (extracao de duracao e metadados)"

**Context:** Em um upload direto, a API nao observa o fim da transferencia. Ela
precisa de um gatilho confiavel para validar o dono, concluir o multipart e
iniciar o processamento exatamente para o video pre-cadastrado.

**Options:**

### Option A: Endpoint explicito de conclusao

O cliente autenticado envia `UploadId`, partes e ETags a um endpoint idempotente.
A API valida propriedade e estado, executa `CompleteMultipartUpload`, confirma o
objeto e registra o comando de processamento.

- **Pros:** fluxo deterministico e facilmente testavel; mantem autorizacao na
  API; recebe os ETags exigidos pelo S3; falhas podem ser repetidas com a mesma
  identidade do video.
- **Cons:** requer uma chamada final do cliente; a idempotencia precisa cobrir
  falhas entre conclusao no storage e persistencia no banco.

### Option B: Notificacao de objeto criado do storage

MinIO/S3 emite um evento quando o objeto e criado; esse evento aciona a fila ou
um consumidor que encontra o video pela chave do objeto.

- **Pros:** nao depende de uma chamada final do cliente; processamento reage ao
  evento do storage.
- **Cons:** configuracao e semantica variam entre MinIO local e S3; multipart
  ainda precisa ser concluido por alguem; autorizacao e correlacao ficam
  indiretas; testes ganham mais uma integracao assincrona.

### Option C: Reconciliacao periodica

Um job lista uploads/objetos e compara com videos em rascunho para descobrir o
que terminou e ainda nao foi processado.

- **Pros:** recupera inconsistencias mesmo apos falhas prolongadas; nao depende
  de notificacoes do storage.
- **Cons:** inicio deixa de ser imediato; listagens recorrentes custam mais;
  correlacao e concorrencia sao mais complexas; e inadequado como gatilho
  principal.

**Recommendation:** **Option A (endpoint explicito e idempotente de conclusao)** -
combina naturalmente com multipart, preserva autorizacao e produz um contrato
HTTP reproduzivel. A confiabilidade da transicao para a fila e complementada
pela TD-08.

**Decision:** **A (endpoint explicito e idempotente de conclusao)**

**Libraries:** —

**Revisions:**

- 2026-08-08 - Confirma endpoint HTTP explicito e idempotente de conclusao como
  gatilho do processamento. Rationale: torna a escolha autossuficiente quando o
  prefixo da recomendacao e removido no contexto consolidado.

---

## TD-04: Organizacao e politica do armazenamento de objetos

**Scope:** Backend

**Capability:** Servico de armazenamento de arquivos (videos e thumbnails)

**Context:** O storage S3/MinIO esta decidido pelo enunciado. Restam a separacao
logica, privacidade e estabilidade das chaves usadas pela API e pelo worker.
Videos ainda sao rascunhos nesta fase e nao devem depender de nomes fornecidos
pelo usuario para formar chaves internas.

**Options:**

### Option A: Um bucket privado com prefixos por video

Um bucket privado guarda fonte e thumbnail em chaves imutaveis derivadas do ID
interno, por exemplo `videos/{videoId}/source` e
`videos/{videoId}/thumbnails/default.jpg`.

- **Pros:** configuracao simples; uma politica de acesso; chaves estaveis e sem
  conflito; lifecycle pode ser aplicado por prefixo; nenhum objeto precisa ser
  publico permanentemente.
- **Cons:** regras de retencao e acesso de fontes e thumbnails compartilham o
  mesmo bucket; uma politica mal configurada tem alcance maior.

### Option B: Buckets privados separados para fontes e thumbnails

Fontes ficam em um bucket e thumbnails em outro, ambos privados e organizados
pelo ID do video.

- **Pros:** politicas, lifecycle e permissoes isolados; thumbnails podem ganhar
  distribuicao/cache independente no futuro.
- **Cons:** mais configuracao, bootstrap e variaveis; duas politicas para manter;
  o beneficio operacional e pequeno na escala e no escopo atuais.

### Option C: Fonte privada e thumbnails publicas

O video original permanece privado, enquanto thumbnails ficam em bucket ou
prefixo de leitura publica.

- **Pros:** entrega simples e cacheavel de thumbnails; evita assinatura para
  cada imagem.
- **Cons:** antecipa politica de publicacao da Fase 04; pode expor thumbnail de
  rascunho; exige coordenar visibilidade e remocao em dois modelos de acesso.

**Recommendation:** **Option A (um bucket privado com prefixos por video)** - e
a estrutura mais simples que preserva privacidade de rascunhos e permite separar
politicas por prefixo sem antecipar publicacao. Chaves baseadas em ID desacoplam
storage de titulo, nome original e URL publica.

**Decision:** **A (um bucket privado com prefixos por video)**

**Libraries:** —

**Revisions:**

- 2026-08-08 - Confirma um bucket privado com prefixos por video e por tipo de
  objeto. Rationale: torna a escolha autossuficiente quando o prefixo da
  recomendacao e removido no contexto consolidado.

---

## TD-05: Topologia do worker e ferramenta de processamento

**Scope:** Backend

**Capability:** Transversal - covers: "Servico de processamento em segundo plano (filas)", "Processamento automatico do video apos upload (extracao de duracao e metadados)", "Geracao automatica de thumbnail a partir de um frame do video"

**Context:** O processamento precisa executar fora da API, ler um objeto de ate
10 GB, extrair dados com ffprobe e gerar uma imagem com FFmpeg. O worker precisa
reutilizar configuracao, storage e persistencia sem acoplar seu ciclo de vida ao
servidor HTTP.

**Options:**

### Option A: Aplicacao Nest standalone no mesmo codigo e imagem base

Um segundo entrypoint cria um `NestFactory.createApplicationContext`, registra o
consumer BullMQ e roda em container proprio com os binarios `ffmpeg`/`ffprobe`.
Cada job baixa a fonte para volume temporario, processa localmente, envia a
thumbnail e remove temporarios em `finally`.

- **Pros:** reutiliza DI, configs, entidades e adapters do backend; separacao
  real de processo/container; chamada direta dos binarios oficiais via
  `execFile` evita wrapper abandonado; processamento local permite seek
  previsivel e limita conexoes longas ao storage.
- **Cons:** imagem fica maior por causa do FFmpeg; exige disco temporario maior
  que o arquivo; compartilhar codigo requer limites claros para o worker nao
  importar controllers HTTP.

### Option B: Servico Node independente com imagem e pacote proprios

O worker e um subprojeto Node separado, com seu proprio bootstrap, dependencias,
cliente de fila, cliente S3 e acesso ao PostgreSQL.

- **Pros:** isolamento forte; imagem do worker pode ser otimizada para FFmpeg;
  API nao carrega dependencias exclusivas de processamento.
- **Cons:** duplica configuracao e contratos; aumenta estrutura, build e testes
  do monorepo; compartilhamento de tipos e migracoes exige novo mecanismo;
  complexidade desproporcional para um unico worker da fase.

**Recommendation:** **Option A (Nest standalone em container separado)** -
preserva o limite operacional exigido sem criar outro subprojeto. `ffprobe` em
JSON extrai duracao/metadados e `ffmpeg` gera um unico frame representativo; o
instante exato e os limites de recursos serao fixados no plano tecnico.

**Decision:** **A (Nest standalone em container separado)**

**Libraries:** —

**Revisions:**

- 2026-08-08 - Confirma worker Nest standalone em container separado usando
  ffprobe e ffmpeg. Rationale: torna a escolha autossuficiente quando o prefixo
  da recomendacao e removido no contexto consolidado.

---

## TD-06: Estrategia de streaming e download

**Scope:** Backend

**Capability:** Transversal - covers: "Reproducao via streaming (sem necessidade de download completo)", "Download do video pelo usuario"

**Context:** O arquivo esta no storage, nao na API. A reproducao precisa aceitar
HTTP Range e retornar `206 Partial Content`; o download precisa reutilizar o
mesmo objeto com `Content-Disposition: attachment`. A URL publica do video deve
permanecer estavel mesmo que a autorizacao de storage expire.

**Options:**

### Option A: URL estavel da API redireciona para GET pre-assinado

O endpoint identificado pelo ID publico valida estado/permissao e retorna uma
URL curta de leitura no storage. MinIO/S3 atende diretamente os pedidos Range;
para download, a assinatura sobrescreve `Content-Disposition`.

- **Pros:** banda e conexoes longas nao passam pela API; S3/MinIO ja implementa
  Range/206; storage continua privado; a URL da plataforma e estavel enquanto a
  credencial de objeto e temporaria.
- **Cons:** requer CORS e endpoint externo acessivel pelo cliente; a URL assinada
  pode ser reutilizada ate expirar; testes precisam seguir o redirecionamento ou
  consumir a URL retornada.

### Option B: API faz proxy de Range para o storage

O cliente chama somente a API; ela repassa `Range` ao S3 e transmite o corpo e
os headers `206`, `Content-Range`, `Accept-Ranges` e `Content-Length`.

- **Pros:** storage e credenciais ficam totalmente escondidos; autorizacao pode
  ser reavaliada em cada range; contrato usa uma unica origem HTTP.
- **Cons:** todo trafego passa pela API, consumindo sockets, banda e memoria de
  buffers; reduz escalabilidade e contraria o objetivo de nao impactar o sistema
  com arquivos grandes.

### Option C: Objetos publicos com URL permanente do storage

O banco guarda ou deriva a URL publica direta do objeto; streaming e download
sao feitos sem assinatura.

- **Pros:** caminho mais curto e cacheavel; nenhuma chamada de autorizacao para
  reproduzir.
- **Cons:** expoe rascunhos se a politica falhar; dificulta aplicar visibilidade
  futura; URL interna de storage vira contrato permanente; download com nome de
  arquivo exige metadado ou endpoint adicional.

**Recommendation:** **Option A (URL da API + GET pre-assinado no storage)** -
mantem a API fora do caminho dos bytes, preserva storage privado e delega Range
ao componente que ja responde corretamente com 206. Streaming e download usam
o mesmo objeto, mudando apenas a disposicao da resposta.

**Decision:** **A (URL da API com GET pre-assinado no storage)**

**Libraries:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`

**Revisions:**

- 2026-08-08 - Confirma URL estavel da API que autoriza e redireciona para GET
  pre-assinado no storage. Rationale: torna a escolha autossuficiente quando o
  prefixo da recomendacao e removido no contexto consolidado.

---

## TD-07: Identificador da URL unica do video

**Scope:** Backend

**Capability:** URL unica por video, sem conflito com outros videos

**Context:** A URL precisa ser curta, estavel e independente do titulo, que sera
editavel em uma fase posterior. A unicidade deve continuar garantida sob criacao
concorrente e sem expor IDs sequenciais.

**Options:**

### Option A: Token aleatorio Base64URL com indice unico

A aplicacao gera um identificador opaco com `node:crypto`, usando alfabeto seguro
para URL, e o banco aplica `UNIQUE`. Uma violacao extremamente improvavel gera
novo token e repete a insercao.

- **Pros:** curto; sem dependencia adicional; nao revela volume ou ordem de
  criacao; independente de titulo; garantia definitiva fica no PostgreSQL.
- **Cons:** nao e legivel; exige definir entropia/tamanho e implementar retry de
  colisao; nao possui ordenacao temporal.

### Option B: UUID como identificador publico

O UUID interno ou um segundo UUID e usado diretamente no caminho publico.

- **Pros:** suporte nativo no PostgreSQL/TypeORM; unicidade bem compreendida;
  praticamente nenhum codigo adicional.
- **Cons:** URL longa; reaproveitar o ID interno acopla contrato publico ao modelo
  de dados; pior experiencia para compartilhar manualmente.

### Option C: Slug do titulo com sufixo incremental ou aleatorio

O titulo e normalizado para uma parte legivel e recebe sufixo quando houver
conflito.

- **Pros:** URLs descritivas; melhor leitura humana.
- **Cons:** titulo inicial pode mudar ou se repetir; Unicode e normalizacao
  aumentam casos de borda; concorrencia exige retry; revela parte do titulo de
  rascunhos e mistura identidade com apresentacao da Fase 04.

**Recommendation:** **Option A (token Base64URL aleatorio + `UNIQUE`)** - gera
uma URL curta e imutavel sem dependencia nova. O plano deve fixar tamanho com
entropia suficiente e manter um indice unico com retry de colisao como garantia
final.

**Decision:** **A (token Base64URL aleatorio com indice unico)**

**Libraries:** —

**Revisions:**

- 2026-08-08 - Confirma token Base64URL aleatorio e indice unico no banco como
  identificador publico. Rationale: torna a escolha autossuficiente quando o
  prefixo da recomendacao e removido no contexto consolidado.

---

## TD-08: Confiabilidade, retries e ciclo de status

**Scope:** Backend

**Capability:** Transversal - covers: "Pre-cadastro automatico do video como rascunho ao iniciar o upload", "Processamento automatico do video apos upload (extracao de duracao e metadados)", "Geracao automatica de thumbnail a partir de um frame do video"

**Context:** O enunciado exige o ciclo `rascunho -> processando -> pronto/erro`.
Como PostgreSQL e Redis nao compartilham transacao, atualizar o video e publicar
diretamente na fila cria uma janela em que o upload pode ficar processando sem
job. A fila tambem pode reentregar um job apos falha do worker.

**Options:**

### Option A: Transactional outbox e worker idempotente

Ao concluir o upload, uma transacao muda `DRAFT` para `PROCESSING` e grava um
evento outbox. Um publisher entrega `video.processing.requested` ao BullMQ com
identidade derivada do video; o worker pode repetir sem duplicar resultado.
Falhas transitorias usam backoff e, apos esgotar tentativas, o video vai para
`ERROR`; sucesso so marca `READY` depois de metadados e thumbnail persistidos.

- **Pros:** elimina a janela DB-fila no caminho normal; suporta indisponibilidade
  temporaria do Redis; permite auditoria do comando; acomoda entrega pelo menos
  uma vez e crash do worker.
- **Cons:** adiciona tabela/outbox, publisher e testes de recuperacao; maior
  quantidade de codigo que publicar diretamente.

### Option B: Publicacao direta idempotente no endpoint de conclusao

A API conclui o objeto, atualiza o status e chama `queue.add` com `jobId` estavel.
Repetir o endpoint tenta garantir que o job exista; retries do worker tratam
falhas de processamento.

- **Pros:** implementacao menor; recursos de deduplicacao do BullMQ evitam a
  maioria das duplicidades; suficiente enquanto API e Redis estao saudaveis.
- **Cons:** permanece uma janela de crash entre commit e enqueue; o video pode
  ficar preso em `PROCESSING` sem reconciliacao; a API depende da fila para
  finalizar a requisicao.

### Option C: Estado detalhado e historico de tentativas como saga

O banco registra estados adicionais de upload, enqueue, probing e thumbnail,
alem de uma entidade de tentativas; cada etapa emite o proximo comando.

- **Pros:** maxima observabilidade e recuperacao por etapa; permite retomar
  somente a operacao incompleta.
- **Cons:** excede os quatro estados requeridos; multiplica transicoes, eventos e
  casos de teste; complexidade desproporcional para extrair metadados e um frame.

**Recommendation:** **Option A (transactional outbox + worker idempotente)** -
e a opcao que torna verdadeiro o requisito de processamento automatico mesmo
quando Redis ou worker falham temporariamente. Mantem o ciclo externo simples
(`DRAFT`, `PROCESSING`, `READY`, `ERROR`) e trata retries como detalhe interno.

**Decision:** **A (transactional outbox e worker idempotente)**

**Libraries:** `@nestjs/bullmq`, `bullmq`

**Revisions:**

- 2026-08-08 - Confirma transactional outbox para publicacao confiavel e worker
  idempotente para retries. Rationale: torna a escolha autossuficiente quando o
  prefixo da recomendacao e removido no contexto consolidado.

---

## TD-09: Enderecos interno e publico do storage

**Scope:** Backend

**Capability:** Transversal - covers: "Upload de videos com suporte a arquivos de ate 10GB sem impacto na performance", "Reproducao via streaming (sem necessidade de download completo)", "Download do video pelo usuario"

**Context:** Dentro do Compose, API e worker devem acessar o storage pelo nome do
servico, por exemplo `minio:9000`. Esse hostname nao e resolvido pelo navegador
ou por testes executados no host. Como a assinatura S3 protege tambem o destino
da requisicao, trocar o hostname depois de assinar invalida a URL.

**Options:**

### Option A: Endpoints configuraveis separados para uso interno e assinatura

Operacoes servidor-servidor usam o endpoint interno da rede Compose. A geracao
de URLs pre-assinadas usa um endpoint publico configuravel e alcancavel pelo
cliente, com as mesmas credenciais, regiao e bucket.

- **Pros:** respeita DNS do Docker; produz URLs utilizaveis no host; funciona com
  MinIO local e com dominio S3/CDN em producao; nao coloca a API no caminho dos
  bytes.
- **Cons:** exige duas configuracoes coerentes; testes precisam validar ambos os
  enderecos; CORS do storage deve permitir a origem cliente e os headers usados.

### Option B: Um hostname unico resolvido dentro e fora do Compose

Ambiente local configura DNS/hosts ou proxy para que um mesmo dominio alcance o
MinIO tanto dos containers quanto do host.

- **Pros:** um unico endpoint e um unico cliente S3; reduz risco de divergencia
  de assinatura.
- **Cons:** exige configuracao de DNS/hosts especifica de cada maquina; piora a
  reproducibilidade academica; tende a falhar em CI ou em outro computador sem
  preparacao externa ao repositorio.

**Recommendation:** **Option A (endpoints interno e publico separados)** - torna
o Compose portavel sem violar a regra de usar nomes de servico entre containers.
O endpoint publico existe apenas para construir URLs consumidas fora da rede;
API e worker nunca o usam para trafego interno.

**Decision:** **A (endpoints interno e publico separados)**

**Libraries:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`

**Revisions:**

- 2026-08-08 - Confirma endpoints interno e publico separados para trafego e
  geracao de URLs externas. Rationale: torna a escolha autossuficiente quando o
  prefixo da recomendacao e removido no contexto consolidado.

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Tecnologia da fila | A - BullMQ com Redis | **A** |
| TD-02 | Backend | Upload retomavel de 10 GB | A - Multipart S3 pre-assinado | **A** |
| TD-03 | Backend | Conclusao e gatilho | A - Endpoint idempotente de conclusao | **A** |
| TD-04 | Backend | Organizacao do storage | A - Bucket privado com prefixos | **A** |
| TD-05 | Backend | Worker e processamento | A - Nest standalone + FFmpeg | **A** |
| TD-06 | Backend | Streaming e download | A - GET pre-assinado com Range | **A** |
| TD-07 | Backend | URL unica | A - Token Base64URL + indice unico | **A** |
| TD-08 | Backend | Status e confiabilidade | A - Outbox + worker idempotente | **A** |
| TD-09 | Backend | Endpoints do storage | A - Endpoints interno e publico separados | **A** |

## Dependencias candidatas

As versoes exatas nao sao decididas neste documento. Elas devem ser confirmadas
contra NestJS 11 e Node.js do container via Context7 durante `plan-resolve` e
registradas em `docs/phases/phase-03-videos/library-refs.md`.

| Componente | Candidato | Finalidade |
|------------|-----------|------------|
| Integracao da fila | `@nestjs/bullmq` | Modulos, producer e consumer NestJS |
| Motor da fila | `bullmq` | Jobs, retries, backoff e eventos sobre Redis |
| Cliente de storage | `@aws-sdk/client-s3` | API S3 compativel com MinIO e AWS S3 |
| Assinatura de URLs | `@aws-sdk/s3-request-presigner` | URLs temporarias de upload e leitura |
| Processamento | binarios `ffmpeg` e `ffprobe` | Metadados e geracao de thumbnail |

## Fontes primarias consultadas

- [NestJS - Queues](https://docs.nestjs.com/techniques/queues)
- [NestJS - Standalone applications](https://docs.nestjs.com/standalone-applications)
- [BullMQ - Going to production](https://docs.bullmq.io/guide/going-to-production)
- [BullMQ - Idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)
- [RabbitMQ - Queues](https://www.rabbitmq.com/docs/queues)
- [RabbitMQ - Reliability guide](https://www.rabbitmq.com/docs/reliability)
- [pg-boss - repositorio oficial](https://github.com/timgit/pg-boss)
- [Amazon S3 - Multipart upload overview](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)
- [Amazon S3 - Multipart upload limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html)
- [AWS SDK for JavaScript v3 - S3 presigner](https://github.com/aws/aws-sdk-js-v3/tree/main/packages/s3-request-presigner)
- [Amazon S3 - GetObject e Range](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)
- [MinIO - conceitos operacionais e multipart](https://min.io/docs/minio/linux/operations/concepts.html)
- [tus - protocolo de upload retomavel](https://tus.io/protocols/resumable-upload)
- [FFprobe - documentacao oficial](https://ffmpeg.org/ffprobe.html)
- [FFmpeg - documentacao oficial](https://ffmpeg.org/ffmpeg.html)
- [Node.js - child_process](https://nodejs.org/api/child_process.html)
