---
name: implement
description: Executa um plano de fase ou tarefa SI por SI, com testes e progresso persistente. Use somente depois de plan-build para implementar, construir ou entregar o plano aprovado.
---

# Implement

1. Leia `.agents/references/claude-to-codex.md` e
   `.claude/skills/implement/SKILL.md`.
2. Confirme que o plano tem SIs, especificacoes, dependencias e entregaveis e
   que a validacao correspondente esta `clean`.
3. Crie uma lista persistente com um item por SI. Execute em ordem topologica,
   um SI por vez, sem paralelizar implementacao.
4. Leia o SI atual e as especificacoes citadas, implemente apenas seu escopo,
   rode exatamente seus testes e corrija falhas antes de avancar.
5. Atualize `progress.md` durante o trabalho. Ao final, execute os checks globais
   do plano, incluindo suite completa, TypeScript e lint.
