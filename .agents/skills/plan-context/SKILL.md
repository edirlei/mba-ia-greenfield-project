---
name: plan-context
description: Consolida o contexto obrigatorio de uma fase ou tarefa depois da pesquisa. Use para gerar ou atualizar `context.md` antes de validar o planejamento.
---

# Plan Context

1. Leia `.agents/references/claude-to-codex.md`.
2. Leia `.claude/skills/plan-pipeline/SKILL.md` e
   `.claude/skills/plan-context/SKILL.md`.
3. Quando o contrato citar leitores em `.claude/agents/`, leia seus prompts e
   produza localmente o mesmo formato de saida, incluindo Filter Trace.
4. Preserve leituras limitadas, `sources_mtime`, frontmatter, cobertura de
   capacidades e os limites entre consolidacao e validacao.
5. Gere somente o artefato de contexto previsto e indique `$plan-validate` como
   proxima etapa.
