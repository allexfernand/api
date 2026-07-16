# Glossário comercial de sinistralidade

Versão técnica: `1.0.0`

Status comercial: aguardando aprovação dos itens listados ao final

Este documento é o contrato de linguagem entre negócio, dados, API e dashboard. Alterações de fórmula ou significado exigem nova versão e validação de negócio.

| Termo comercial | Definição | Fórmula/campo | Não confundir com |
| --- | --- | --- | --- |
| Custo assistencial bruto | Valor cobrado pela utilização antes do desconto de coparticipação. | `SUM(sinistro)` | Prêmio, receita ou loss ratio. |
| Coparticipação | Valor de coparticipação escolhido como oficial após reconciliação com a operadora. | Inicialmente `SUM(valor_coparticipacao)` | `valor_fat_coparticipacao` sem validação. |
| Custo líquido aproximado | Custo bruto menos coparticipação disponível. | `SUM(sinistro - COALESCE(valor_coparticipacao, 0))` | Valor contábil definitivo. |
| Linha de cobrança | Um registro do arquivo de utilização. | `COUNT(*)` | Quantidade de serviços. |
| Quantidade de serviços | Quantidade informada pela operadora dentro das linhas. | `SUM(qtd_servico)` | Número de linhas. |
| Procedimento | Código e descrição do item assistencial. | `cd_operadora`, `descricao_procedimento` | Tipo de evento. |
| Utilizante | Pessoa canônica com pelo menos uma utilização no período. | `COUNT(DISTINCT person_key)` | Vida elegível. |
| Vida elegível | Pessoa coberta em pelo menos um dia do mês. | Elegibilidade mensal | Utilizante. |
| Beneficiário-mês | Exposição mensal de uma vida elegível conforme dias cobertos. | `dias_elegiveis / dias_no_mes` | Contagem de pessoas no fim do mês. |
| Família | Titular e dependentes ligados por uma chave familiar canônica e temporal. | `family_key` | CPF exposto no dashboard. |
| Empresa | Cliente contratante canônico. | `company_key`, `nome_empresa_canonico` | Operadora. |
| Operadora | Organização que fornece/administra o arquivo assistencial. | `operator_key`, `operadora` | Empresa cliente. |
| Episódio | Conjunto de linhas pertencentes ao mesmo atendimento assistencial. | `episode_key` | Uma única linha de cobrança. |
| Mês fechado | Mês com arquivos esperados recebidos, reconciliação aprovada e lag cumprido. | `sinistralidade_month_status_v2.status = 'closed'` | Mês com custo acima de um limite arbitrário. |
| Evento principal | Tipo de evento de maior custo no recorte; desempate por linhas e nome. | Ranking sobre `tipo_evento` | Diagnóstico. |
| Doença principal | CID válido de maior custo, exibido somente quando a cobertura permitir. | Ranking sobre `codigo_cid_normalizado` | Evento principal ou inferência clínica. |

## Regras de apresentação

- Usar “custo assistencial” na leitura executiva; “sinistro” pode aparecer apenas em metodologia ou quando for nomenclatura contratual.
- Sempre qualificar “beneficiário” como vida elegível, utilizante, titular ou dependente.
- Sempre qualificar “item” como linha de cobrança, quantidade de serviços ou procedimento.
- Mostrar período, denominador, freshness e status fechado/parcial em cada bloco.
- Não chamar custo assistencial de sinistralidade ou loss ratio sem a fonte de prêmio.
- CID ausente não deve ser preenchido por inferência no dashboard.
- Rankings individuais são internos, mascarados e sujeitos a autorização específica.

## Decisões ainda pendentes de aprovação de negócio

1. Campo oficial de coparticipação.
2. Manter “custo assistencial bruto” como KPI principal ou adotar líquido.
3. Bimestre de calendário versus janela móvel de dois meses.
4. Definição de entrada familiar: benefício, Sanus ou primeiro contato.
5. Cobertura mínima de CID para publicação de doença principal.
