---
name: plan-validate
description: Valida coerencia, lacunas, decisoes ausentes e dependencias do contexto de uma fase ou tarefa. Use depois de plan-context e apos cada ciclo de resolucao para gerar `validation.md` clean ou dirty.
---

# Plan Validate

1. Leia `.agents/references/claude-to-codex.md`.
2. Leia `.claude/skills/plan-pipeline/SKILL.md` e
   `.claude/skills/plan-validate/SKILL.md`.
3. Execute todas as familias de checagem aplicaveis; nao declare `clean` por
   inspecao superficial.
4. Preserve IDs de problemas, historico de resolucoes, staleness e
   `sources_mtime`.
5. Gere apenas `validation.md`. Se estiver `dirty`, a proxima etapa e
   `$plan-resolve`; se estiver `clean`, e `$plan-build`.
