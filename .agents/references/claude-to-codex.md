# Mapeamento Claude Para Codex

As definicoes em `.claude/skills/` permanecem como contratos canonicos do
pipeline. Ao executa-las pelo Codex, aplique este mapeamento:

| Contrato Claude | Execucao no Codex |
| --- | --- |
| `Read`, `Glob`, `Grep` | `Get-Content`, `rg --files` e `rg` |
| `Write`, `Edit` | `apply_patch` |
| `Bash` | shell PowerShell; adapte comandos POSIX sem mudar a semantica |
| `AskUserQuestion` | pergunta direta e curta, somente quando nao for seguro inferir |
| `TaskCreate`, `TaskUpdate` | `update_plan` e `progress.md` |
| subagentes leitores | faca a extracao no fluxo principal e preserve o contrato de saida |
| `mcp__context7__*` | ferramentas Context7 configuradas em `.codex/config.toml` |
| `/nome-da-skill` | `$nome-da-skill` |
| `stat -c '%y'` | `LastWriteTimeUtc.ToString('o')` no PowerShell |

Preserve nomes de arquivos, frontmatter, IDs, status, matrizes de rastreabilidade
e mensagens canonicas exigidas pelo contrato original. Nao simplifique uma
checagem apenas porque ela foi originalmente delegada a um subagente.

Para a Fase 03, ignore ramos exclusivamente de frontend/Figma quando eles nao
forem acionados pelo escopo. Use as regras NestJS, TypeORM e de testes existentes
em `.claude/rules/` e `.claude/skills/` como referencias de implementacao.
