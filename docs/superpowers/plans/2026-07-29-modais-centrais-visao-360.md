# Modais centrais da Visão 360 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir os painéis de detalhe e linhagem da Visão 360 como modais centrais amplos.

**Architecture:** Alterar somente os estilos compartilhados pelos dois diálogos. A semântica e os handlers atuais permanecem nos componentes.

**Tech Stack:** React, CSS Modules, Playwright.

## Global Constraints

- Preservar Escape, foco e clique no fundo para fechar.
- Largura máxima de 1.120 px e altura máxima de 88vh.
- Sem alterar endpoints ou dados exibidos.

---

### Task 1: Centralizar os diálogos compartilhados

**Files:**
- Modify: `src/features/sinistralidade/SinistralidadeV2Tab.module.css`
- Test: `tests/e2e/dashboard.spec.ts`

- [ ] **Step 1: Atualizar o overlay e o painel**

Centralizar o overlay, limitar o tamanho do painel, adicionar borda arredondada e trocar a animação lateral por animação de escala vertical suave.

- [ ] **Step 2: Cobrir o layout no e2e**

Depois de abrir a linhagem, verificar que o diálogo usa as classes de modal e não ocupa a altura completa da viewport.

- [ ] **Step 3: Validar**

Run: `npm run typecheck && npm test && npm run lint`

Expected: todos os comandos terminam com sucesso.
