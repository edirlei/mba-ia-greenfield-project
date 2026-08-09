---
name: plan-resolve
description: Resolve problemas registrados em `validation.md`, atualiza decisoes e fixa documentacao de bibliotecas via Context7. Use entre validacoes enquanto o status estiver dirty ou para materializar `library-refs.md`.
---

# Plan Resolve

1. Leia `.agents/references/claude-to-codex.md`.
2. Leia `.claude/skills/plan-pipeline/SKILL.md` e
   `.claude/skills/plan-resolve/SKILL.md`.
3. Resolva somente problemas existentes. Na modalidade fase, nao crie decisoes
   tecnicas novas para encobrir uma lacuna: retorne a `$research`.
4. Consulte Context7 para cada biblioteca nova e registre versao, ID e data real
   em `library-refs.md`. Se a ferramenta nao estiver ativa, pare antes de fixar a
   biblioteca.
5. Atualize todos os fingerprints exigidos e retorne a `$plan-validate`; esta
   skill nunca atribui `clean` por conta propria.
