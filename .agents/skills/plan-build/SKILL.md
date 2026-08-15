---
name: plan-build
description: Gera o plano tecnico final de uma fase ou tarefa validada, com SIs, especificacoes, dependencias e entregaveis. Use somente quando `validation.md` estiver clean.
---

# Plan Build

1. Leia `.agents/references/claude-to-codex.md`.
2. Leia `.claude/skills/plan-pipeline/SKILL.md` e
   `.claude/skills/plan-build/SKILL.md`.
3. Leia `phase-a.md`, `phase-b.md`, `phase-c.md` e apenas os templates citados
   pelo contrato e aplicaveis ao escopo.
4. Aplique todos os gates antes de escrever o plano. Para a Fase 03, inclua
   Modelo de Dados, Contratos API, Matriz de Autorizacao, Catalogo de Erros,
   Eventos/Mensagens, Mapa de Dependencias e Entregaveis.
5. Nao implemente codigo. Gere o plano com SIs pequenos, testaveis e rastreaveis,
   pronto para `$implement`.
