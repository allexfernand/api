// Catálogo único de menus laterais do dashboard. É a fonte de verdade usada
// em três lugares que precisam concordar entre si: a sidebar (navegação), a
// tela de Configurações (o que pode ser marcado por usuário) e o bloqueio no
// servidor (quais rotas cada menu autoriza). Adicionar um menu novo aqui é o
// suficiente para ele aparecer selecionável em Configurações.

export const MENU_SECTIONS = [
  {
    label: "Visão Geral",
    items: [
      { id: "demografica", label: "Análise Demográfica", icon: "fa-chart-pie" },
      { id: "visao-parceiros", label: "Visão Parceiros", icon: "fa-handshake-angle" },
      { id: "agendamentos", label: "Agendamentos", icon: "fa-calendar-check" },
      { id: "sessoes", label: "Sessões", icon: "fa-comments" },
    ],
  },
  {
    label: "Executivo",
    items: [
      { id: "petit-comite", label: "Petit Comitê", icon: "fa-briefcase" },
      { id: "petit-comite-mds", label: "Petit Comitê MDS", icon: "fa-handshake" },
      { id: "coordenacao-cuidado", label: "Coordenação de Cuidado", icon: "fa-heart-pulse" },
    ],
  },
  {
    label: "Sinistralidade",
    items: [
      { id: "analise-sinistro", label: "Análise Sinistro", icon: "fa-file-invoice-dollar" },
      { id: "sinistralidade-v2", label: "Visão 360", icon: "fa-compass-drafting" },
    ],
  },
  {
    label: "Qualidade",
    items: [
      { id: "qualidade-estrategica", label: "Estratégica", icon: "fa-bullseye" },
      { id: "qualidade-operacional", label: "Operacional", icon: "fa-list-check" },
    ],
  },
] as const;

export type MenuId = (typeof MENU_SECTIONS)[number]["items"][number]["id"];

export const ALL_MENU_IDS = MENU_SECTIONS.flatMap((section) => section.items.map((item) => item.id)) as MenuId[];

export const MENU_LABEL_BY_ID: Record<MenuId, string> = Object.fromEntries(
  MENU_SECTIONS.flatMap((section) => section.items.map((item) => [item.id, item.label] as const)),
) as Record<MenuId, string>;

export function isMenuId(value: string): value is MenuId {
  return (ALL_MENU_IDS as string[]).includes(value);
}

// Baseline de hoje para as duas contas legadas (env vars), preservada como
// fallback quando NINGUÉM configurou uma lista explícita em Configurações
// para aquele usuário — ver server/auth/managed-users.ts. Ficar igual ao
// comportamento atual é o que garante que publicar esta função não muda nada
// para quem já usa o dashboard.
export const MDS_DEFAULT_ALLOWED_MENUS: MenuId[] = ["demografica", "agendamentos", "sessoes", "petit-comite-mds"];

// Conjunto padrão para uma conta nova de papel "full" criada em Configurações
// (sem petit-comite-mds, que é a visão espelhada para o parceiro MDS).
export const FULL_DEFAULT_ALLOWED_MENUS: MenuId[] = ALL_MENU_IDS.filter((id) => id !== "petit-comite-mds");

// Rotas genéricas (/api/demographics, /api/sessions, /api/appointments, ...)
// são infraestrutura compartilhada: alimentam cards/resumo de várias telas ao
// mesmo tempo, então não têm dono único. A checagem no servidor usa "OU": só
// bloqueia quem não tem NENHUM destes menus liberados — não dá pra restringir
// por essas rotas com granularidade fina sem duplicar cada endpoint por tela.
export const CORE_DATA_MENUS: MenuId[] = [
  "demografica",
  "visao-parceiros",
  "agendamentos",
  "sessoes",
  "petit-comite",
  "petit-comite-mds",
  "coordenacao-cuidado",
];
