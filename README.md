# Dashboard Sanus

Dashboard Next.js App Router com Route Handlers serverless na Vercel, sessão segura e consultas ao Databricks.

## Desenvolvimento

1. Copie as variáveis necessárias para `.env.local` ou mantenha o `.env` usado pela Vercel CLI.
2. Instale as dependências com `npm install`.
3. Execute `npm run dev` e acesse `http://localhost:3000`.

## Estrutura

- `app`: página, layout, estados e Route Handlers do App Router.
- `src/features`: componentes organizados por domínio do dashboard.
- `src/dashboard/fragments`: painéis ainda mantidos pela camada de compatibilidade.
- `styles/dashboard.css`: estilos globais preservados do dashboard em produção.
- `public/scripts/features`: compatibilidade JavaScript dividida por domínio.
- `src/server/routes`: implementação das rotas existentes.
- `src/server/auth`: credenciais e sessão assinada em cookie HttpOnly.
- `src/server/databricks`: cliente, timeout e utilitários de query.
- `src/contracts`: contratos e validações compartilhadas.
- `tests`: testes unitários e E2E.
- `legacy`: snapshot do HTML anterior à migração, sem participação no build.

O frontend continua estático e as APIs continuam serverless. Um push para a branch conectada à Vercel dispara o deploy. Defina `DASHBOARD_SESSION_SECRET` na Vercel; sem ele, a aplicação usa temporariamente a senha principal como fallback para assinar a sessão.

## Documentos do Auditor Mestre

A subaba **Auditoria de Contas → Documentos** usa um Vercel Blob privado para manter versões imutáveis dos manuais e planilhas:

1. No projeto da Vercel, crie ou conecte um Blob Store com acesso **Private**.
2. Disponibilize `BLOB_READ_WRITE_TOKEN` no ambiente do projeto. O token é necessário para assinar uploads feitos diretamente pelo navegador.
3. Faça um novo deploy e envie os documentos pela subaba administrativa.
4. Revise a versão enviada e clique em **Ativar**. Somente versões ativas entram nas próximas análises.

Sem Blob configurado, o desenvolvimento continua usando os arquivos de `knowledge/nivel1/` como fallback local. O limite é de 12 MB por arquivo e 20 MB no conjunto de versões ativas.

As análises usam `glm-5` pela API geral da Z.AI. Configure `ZAI_API_KEY`; PDFs são convertidos em texto no servidor e apenas os trechos relevantes seguem para o modelo, respeitando a janela de contexto.
