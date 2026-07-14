# Arquitetura do dashboard

## Visão geral

O projeto usa o Next.js App Router. A página principal é renderizada no servidor, o shell interativo é React e as APIs são Route Handlers executados como funções serverless na Vercel.

```text
Navegador
  ├─ app/page.tsx
  │   ├─ DashboardShell (login, navegação e filtros)
  │   └─ painéis por domínio em src/features
  │       └─ fragmentos + runtime de compatibilidade durante a migração
  └─ /api/*
      └─ app/api/**/route.ts
          └─ adaptador HTTP
              └─ src/server/routes
                  └─ src/server/databricks
                      └─ Databricks SQL Warehouse
```

## Frontend

- `app/layout.tsx` concentra metadados, fontes, CSS externo e scripts globais.
- `app/page.tsx` monta a página e carrega o runtime do dashboard.
- `src/features/dashboard/components/DashboardShell.tsx` controla autenticação, cabeçalho, navegação entre abas e filtros compartilhados.
- Cada domínio possui uma pasta em `src/features`.
- Os painéis mais antigos ainda são lidos de `src/dashboard/fragments` e executados pelos módulos em `public/scripts/features`. Essa é uma fronteira de compatibilidade explícita: o antigo `index.html` não participa mais da aplicação.

O runtime antigo foi dividido por domínio. `public/scripts/dashboard.js` é apenas o carregador dos módulos, o que permite substituir cada módulo por React sem interromper as demais abas.

## Autenticação

1. O login envia as credenciais para `POST /api/auth/login`.
2. O servidor valida as credenciais com comparação resistente a timing attacks.
3. Uma sessão assinada é gravada em cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
4. O navegador chama `/api/*` com o cookie, sem salvar senha no `localStorage`.
5. Basic Auth continua aceito temporariamente nas APIs para compatibilidade com integrações existentes.

Em produção, configure `DASHBOARD_SESSION_SECRET` com um valor aleatório e privado.

## Backend

- `app/api/**/route.ts`: interface HTTP nativa do App Router.
- `src/server/http/route-adapter.ts`: adapta os handlers preservados, normaliza query strings, adiciona `requestId` e converte respostas e erros para `NextResponse`.
- `src/server/routes`: regras e consultas das rotas atuais.
- `src/server/databricks`: comunicação com o SQL Warehouse, timeout, logs de duração e utilitários compartilhados.
- `src/server/auth`: credenciais, papéis e sessões.
- `src/server/observability`: logs estruturados.
- `src/contracts`: schemas e tipos compartilhados.

Todas as respostas continuam disponíveis nos mesmos caminhos `/api/*`, portanto o deploy não exige alteração de URL ou de consumidores.

## Rotas

| Rota                                   | Responsabilidade principal                                             |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `/api/auth/login` e `/api/auth/logout` | criação e encerramento da sessão                                       |
| `/api/data`                            | autenticação, grupos, parceiros, linhas de cuidado e agregações gerais |
| `/api/demographics`                    | KPIs e distribuição demográfica                                        |
| `/api/agegroups`                       | faixas etárias                                                         |
| `/api/companies`                       | empresas disponíveis para os filtros                                   |
| `/api/appointments`                    | volumes e KPIs de agendamentos                                         |
| `/api/appointments-evolution`          | séries temporais de agendamentos                                       |
| `/api/appointment-types`               | tipos, exames e especialidades solicitadas                             |
| `/api/sessions`                        | sessões, tipificações e utilização                                     |
| `/api/sessions-evolution`              | evolução e comparativos de sessões                                     |
| `/api/solicitations`                   | distribuição de solicitações                                           |
| `/api/quality`                         | indicadores estratégicos e operacionais de qualidade                   |
| `/api/quality-criterion-insights`      | detalhe por critério de qualidade                                      |
| `/api/gold-preview`                    | prévia agregada das visões gold de sinistro                            |

## Estratégia de evolução

A migração foi feita preservando os contratos e o comportamento já implantado. O limite entre React e a compatibilidade está isolado por domínio, permitindo migrar uma aba de cada vez. Quando uma aba for reescrita em React, seu fragmento e seu módulo em `public/scripts/features` podem ser removidos sem alterar as demais APIs ou abas.

## Validação

- `npm run lint`: regras do Next.js e TypeScript.
- `npm run typecheck`: checagem estática.
- `npm test`: testes unitários com Vitest.
- `npm run test:e2e`: login e navegação pelas dez abas com Playwright.
- `npm run build`: build equivalente ao deploy da Vercel.
