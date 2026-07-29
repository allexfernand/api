# Episódios contínuos de internação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer todos os totais de internação do dashboard contarem intervalos clínicos contínuos por pessoa.

**Architecture:** Criar uma visão Databricks no grão de episódio contínuo, usando uma janela para identificar o fim máximo dos intervalos anteriores de cada pessoa. Marts de internação derivam da visão; a rota que consulta a Gold diretamente replica o mesmo algoritmo em CTE.

**Tech Stack:** Databricks SQL, Next.js/TypeScript, Vitest.

## Global Constraints

- Unir somente períodos que se sobrepõem ou tocam na mesma data.
- Manter a chave de admissão atual como fallback quando faltarem datas.
- Não modificar custos, linhas assistenciais ou beneficiários distintos.
- Não adicionar dependências.

---

### Task 1: Consolidar episódios no Databricks

**Files:**

- Modify: `databricks/sinistralidade/sql/008_longitudinal_marts.sql`

**Interfaces:**

- Produces: `mart_internacao_episodio_v2` com `company_key`, `person_key`, `episodio_key`, `month_key`, custo, duração, saúde mental e acomodação.
- Produces: marts mensal e por acomodação com `episodios_internacao` derivado de `episodio_key`.

- [ ] **Step 1: Criar a visão canônica**

Agrupar linhas de internação com datas em intervalos distintos e usar `max(data_alta)` sobre as linhas anteriores para marcar o início de um novo episódio apenas quando `data_inicio_internacao` for maior que esse máximo. Agregar as linhas de cada ilha por empresa, pessoa e sequência.

- [ ] **Step 2: Derivar os marts da visão**

Substituir `COUNT(DISTINCT admission_key)` por `COUNT(DISTINCT episodio_key)` nos marts de internação mensal e por acomodação.

- [ ] **Step 3: Validar a compilação do plano de deploy**

Run: `npm run databricks:sinistralidade:plan`

Expected: os arquivos SQL são separados em statements sem erro.

### Task 2: Alinhar a Análise Sinistro e a interface

**Files:**

- Modify: `src/server/routes/gold-preview.ts`
- Modify: `src/server/sinistralidade/queries/hospitalizations.ts`
- Modify: `src/features/claims/components/Hospitalization.tsx`
- Modify: `src/features/sinistralidade/components/HospitalizationAnalysis.tsx`
- Modify: `src/features/sinistralidade/components/ExecutiveKpis.tsx`

**Interfaces:**

- Consumes: a mesma regra de consolidação por intervalo da Task 1.
- Produces: totais e textos do dashboard consistentes com a regra de episódio contínuo.

- [ ] **Step 1: Substituir a agregação da Gold direta**

Na CTE de estatísticas de internação, associar cada linha a uma ilha contínua e calcular custo, duração e contagem por `episodio_key`.

- [ ] **Step 2: Atualizar a linhagem e os rótulos**

Trocar referências a `admission_key` e `episode_key` pelo critério de intervalos contínuos e trocar “Admissões clínicas distintas” por “Episódios contínuos distintos”.

- [ ] **Step 3: Verificar o projeto**

Run: `npm run typecheck && npm run lint && npm test -- --runInBand`

Expected: comandos terminam com sucesso; se o runner não aceitar `--runInBand`, executar `npm test`.
