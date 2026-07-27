# De-para — grupo estatístico nativo → tipo_evento

> **REVISÃO 2026-07-24 (aplicada em homologação):**
> - **Taxa/Mat/Med** (era ~40% do custo num balde só) **quebrado** em quatro rótulos
>   nativos: **Medicamento** (MCM/MED/MAC/MIB), **Material-OPME** (MTC/MAT/MES/MOP),
>   **Taxas** (TUS/TAS/TEQ/TCC/TOT/TAD/GAS) e **Honorário médico** (HNN/HON — R$24,6M,
>   maior que Internação, por isso rótulo próprio). Medicina preventiva (MPB/MPC) → Consulta.
> - **Internação = diárias plenas nativas** (semântica muda vs LLM: itens consumidos na
>   internação vão para o que são — material/medicamento/exame; a diária é a "Internação").
>   Custo Internação R$40,8M (LLM) → R$20,0M (nativo); linhas 39.149 → 12.392.
> - **Pronto Socorro** deixa de ser categoria de evento (vira `flag_pronto_socorro`).
> - Total de custo **preservado** (~R$165,8M antes e depois — só redistribuição).
>
> **DECISÕES CONFIRMADAS (2026-07-20):**
> 1. **Rótulos**: mapeamento conservador (~12 rótulos), sem criar categorias novas.
>    - **Internação** = diárias plenas (DEF, DAP, DUT, DUP, DPE, DSI, DBR, DOT, ISO, THT).
>    - **Hospital Dia** = rótulo próprio (DDH, PDH, DDA, DDE).
>    - **Home Care** = HDC, GHC.
>    - **Pronto Socorro** = NÃO vem do grupo; vem de flag nativa (TUSS 10101039 + `raw_eme`). CUR → Consulta.
>    - **Oncologia Ambulatorial** = ONC + QMT + RDT.
>    - **Honorário médico** (HNN, HON) e **Medicina preventiva** (MPB, MPC) → baldes existentes (não viram rótulo novo).
> 2. **Coluna "Grupo" (macrogroup)**: derivar do **capítulo TUSS nativo** (prefixo do código); 28% sem código = "Sem TUSS".
> 3. **B5 agrupamento**: por **acomodação nativa** (UTI/Enfermaria/Apartamento/Day-hospital/Psiquiatria), não clínico.
> 4. **flag_saude_mental**: **keyword (determinística) UNIÃO códigos nativos** (psiquiatria PDE/PDA + psicologia TNP).
>
> **Fonte técnica:** join Silver↔Bronze por `(source_file_sha256, source_row_number)` — validado 1:1
> (1.571.862 = 1.571.862). Permite o protótipo sem esperar o pipeline Bronze→Silver carregar as colunas.

---

## As DUAS visões de internação (leia antes de comparar números)

Depois da migração para o nativo existem **duas medidas diferentes** de internação. Elas
**não** são conflitantes — respondem a perguntas diferentes. Quem olhar o dashboard precisa
saber qual está vendo.

### Visão 1 — `tipo_evento = 'Internacao'` (rubrica de leito) ≈ **R$20M**
É o **rótulo de evento** de cada linha. Só marca "Internacao" a linha que **é a diária
hospitalar** (grupo estatístico de diária: DEF, DAP, DUT, DUP, DPE, DSI, DBR, DOT, ISO, THT,
PDE, PDA). Responde: **"quanto gastamos em diária de leito?"**
Aparece em: gráfico de **composição por tipo de evento**.

### Visão 2 — `flag_internacao = true` (episódio completo) ≈ **R$40M**
É uma **flag no nível da conta/senha**: marca **todas as linhas de uma internação**, inclusive
o que foi consumido dentro dela (honorário médico, taxas de sala/OR, medicamentos, exames,
materiais). Responde: **"quanto custou o episódio de internação inteiro?"**
Aparece em: blocos de **uso assistencial / severidade**, contagem de **admissões** e o mart
`mart_internacao_grupo_mes_v2` (agrupado por acomodação nativa — B5).

### Por que os números diferem (validado em produção)
Das linhas que o pipeline **antigo (LLM)** chamava de "Internacao" (R$40,8M), o nativo mostra
o que cada uma **realmente é**:

| Reclassificação nativa | R$ mi | Linhas |
|---|--:|--:|
| **Internação** (diária de fato) | 18,0 | 9.593 |
| Honorário médico | 16,3 | 18.250 |
| Taxas (sala/OR/equipamento) | 3,8 | 4.872 |
| Medicamento | 1,5 | 2.003 |
| Terapia | 0,4 | 3.360 |
| Material-OPME / Exame / outros | ~1,0 | ~1.900 |

O LLM carimbava **"Internação"** em tudo que era faturado durante a internação (um *total de
episódio*). O nativo separa cada real na rubrica do que ele é: a diária fica em Internação, o
honorário do cirurgião em Honorário médico, o remédio em Medicamento, e assim por diante.
**Ninguém perde dinheiro** — os R$22,8M que "saíram" de Internação reaparecem nas outras
rubricas. Total geral intacto (~R$165,8M).

### Por que o nativo é o correto para a composição
1. **Não dupla-conta categoria**: honorário é honorário esteja o paciente internado ou não —
   antes o mesmo tipo de gasto caía em baldes diferentes só pelo contexto.
2. **É a classificação da própria operadora** (grupo estatístico do arquivo), auditável linha
   a linha, sem inferência de IA.
3. **Responde a pergunta certa** do gráfico de composição: gasto **em diária de leito**, não
   "faturamento de contas que tiveram internação" (isso é a Visão 2, via flag).

> **Resumo para o negócio:** o rótulo "Internação" (~R$20M) = **leito**; a flag de internação
> (~R$40M) = **episódio completo**. Ao comparar com relatórios antigos, confira qual visão a
> outra fonte usa — o número "R$40M" antigo equivale à **flag**, não ao rótulo.

---

## (rascunho original abaixo — mantido para referência das opções)



**Objetivo (B1):** substituir o `tipo_evento` enriquecido (72% regra + 25% LLM + 3% fallback)
pela classificação **nativa da operadora** `raw_codigo_grupo_estatistico` / `raw_nome_grupo_estatistico`
(59 códigos), mapeada para os rótulos atuais do dashboard. Elimina o LLM e torna a categoria auditável.

⚠️ **Este é um rascunho gerado dos dados reais — precisa de validação de negócio.**
As linhas marcadas com 🚩 são decisões que não posso tomar sozinho.

Colunas: `linhas` = volume na base; `ctx_int` = fração das linhas em contexto de internação
(`raw_ind_internacao='S'`) — quanto mais perto de 1,00, mais "hospitalar" é o código.

---

## 1. Diárias e hotelaria hospitalar → **evento de internação** (ctx_int = 1,00)

Estes códigos são o **evento de internação nativo** — resolve como identificar internação sem o
`tipo_evento` enriquecido (hoje `flag_internacao` = 39.149 linhas; a soma destes ≈ o mesmo conceito).

| Cód | Nome nativo | Linhas | ctx_int | Rótulo proposto |
|---|---|---|---|---|
| DEF | Diária Enfermaria | 3.155 | 1,00 | **Internação** |
| DAP | Diária Apartamento | 2.786 | 1,00 | **Internação** |
| DUT | Diária U.T.I. | 871 | 1,00 | **Internação** |
| DUP | Diária UTI Neo-Natal | 616 | 1,00 | **Internação** |
| DPE | Diária UTI Pediátrica | 517 | 1,00 | **Internação** |
| DSI | Diária Semi Intensiva | 411 | 1,00 | **Internação** |
| DBR | Diária Berçário | 20 | 1,00 | **Internação** |
| DOT | Outras Diárias | 219 | 1,00 | **Internação** |
| ISO | Isolamento | 377 | 1,00 | **Internação** |
| THT | Taxa Hotelaria / Governança | 2.265 | 1,00 | **Internação** |
| PDE | Psiquiatria Diária Enfermaria | 876 | 1,00 | **Internação** 🚩 (saúde mental) |
| PDA | Psiquiatria Diária Apartamento | 279 | 1,00 | **Internação** 🚩 (saúde mental) |

🚩 **Hospital-dia é internação ou categoria própria?** Hoje existe rótulo "Hospital Dia" separado:
| DDH | Diária Day-Hospital | 733 | 1,00 | Hospital Dia *ou* Internação? |
| PDH | Psiquiatria Day Hospital | 235 | 1,00 | Hospital Dia *ou* Internação? |
| DDA | Diária Day Apartamento | 54 | 1,00 | Hospital Dia *ou* Internação? |
| DDE | Diária Day Enfermaria | 48 | 1,00 | Hospital Dia *ou* Internação? |

🚩 **Home Care** (hoje rótulo próprio):
| HDC | Home Care | 989 | 1,00 | Home Care |
| GHC | Gasoterapia - Home Care | 97 | 1,00 | Home Care *ou* Taxa/Mat/Med? |

---

## 2. Exames → **Exame**
| DIG | Exame | 818.069 | Exame |
| DIC | Exame Baixo Custo | 8.279 | Exame |
| DIE | Exame Alto Custo | 92 | Exame |

## 3. Consultas → **Consulta**
| CEL | Consulta Eletiva | 133.766 | Consulta |
| CUR | Consulta Urgência | 51.731 | Consulta 🚩 (virar "Pronto Socorro"? PS hoje vem de outra flag) |
| CON | Consulta | 95 | Consulta |

## 4. Terapias → **Terapia**
| TER | Terapia | 36.362 | Terapia |
| TNP | Terapias não Médicos Psicologia | 30.017 | Terapia 🚩 (saúde mental) |
| MTE | Métodos/Terapias Infantis Especiais | 12.183 | Terapia |
| TNF | Terapias não Médicos Fonoaudiologia | 8.231 | Terapia |
| TF | Terapias não Médicos Fisioterapia | 3.710 | Terapia |
| TNO | Terapias não Médicos Ter. Ocupacional | 3.500 | Terapia |
| TNN | Terapias não Médicos Nutricionista | 1.110 | Terapia |
| TRS | Terapia Renal Substitutiva | 478 | Terapia 🚩 (diálise — categoria própria?) |
| TEE | Terapia Alto Custo | 1 | Terapia |

## 5. Oncologia → **Oncologia Ambulatorial** 🚩 (agrupar QMT+RDT+ONC?)
| ONC | Medicamento Oncológico | 1.457 | Oncologia Ambulatorial |
| QMT | Quimioterapia | 419 | Oncologia Ambulatorial |
| RDT | Radioterapia | 104 | Oncologia Ambulatorial |

## 6. Material / Medicamento / Taxas → **Taxa/Mat/Med** 🚩 (é o balde mais heterogêneo — dividir?)
| MTC | Material Comum | 183.837 | Taxa/Mat/Med |
| MCM | Medicamento Comum | 161.466 | Taxa/Mat/Med |
| MES | Material Especial | 5.896 | Taxa/Mat/Med |
| MOP | Órtese / Prótese | 2.049 | Taxa/Mat/Med 🚩 (OPME — categoria própria?) |
| MAC | Medicamento Excepcional/Alto Custo | 910 | Taxa/Mat/Med 🚩 (alto custo — separar?) |
| MIB | Imunobiológicos | 690 | Taxa/Mat/Med 🚩 (alto custo — separar?) |
| MAT | Material | 24 | Taxa/Mat/Med |
| MED | Medicamento | 15 | Taxa/Mat/Med |
| TUS | Taxa Utilização Sala | 13.564 | Taxa/Mat/Med |
| TAS | Taxa Serviço | 7.306 | Taxa/Mat/Med |
| TEQ | Taxa Uso Equipamento | 5.730 | Taxa/Mat/Med |
| TCC | Taxa Centro Cirúrgico | 3.637 | Taxa/Mat/Med 🚩 (ctx_int 0,81 — ligado a cirurgia/internação) |
| TOT | Outras Taxas | 1.484 | Taxa/Mat/Med |
| TAD | Taxa Administrativa | 151 | Taxa/Mat/Med |
| GAS | Gasoterapia | 4.481 | Taxa/Mat/Med 🚩 |

## 7. Honorários → 🚩 **decisão: categoria própria "Honorário" ou dentro de Taxa/Mat/Med?**
| HNN | Honorário Médico | 46.063 | 🚩 Honorário / Consulta / Taxa? |
| HON | Honorário | 3.752 | 🚩 Honorário / Consulta / Taxa? |

## 8. Remoção → **Remoção**
| REM | Remoção | 185 | Remoção |

## 9. Medicina preventiva → 🚩 **categoria nova "Prevenção" ou "Proc. Ambulatorial"?**
| MPB | Medicina Preventiva Benefício | 1.273 | 🚩 |
| MPC | Medicina Preventiva Cobrança | 1.171 | 🚩 |

## 10. Sem classificação / outros
| _(vazio)_ | (sem nome) | 3.600 | Sem classificação |
| OUT | Outros | 422 | Sem classificação 🚩 |
| RDS | Reembolso Despesas/Serviços | 4 | 🚩 (reembolso é flag própria, não evento) |

---

## Decisões de negócio pendentes (as 🚩)

1. **Hospital-dia** (DDH, PDH, DDA, DDE): manter rótulo "Hospital Dia" separado ou virar Internação?
2. **Pronto Socorro**: hoje vem da `flag_pronto_socorro` (campo próprio), **não** do grupo estatístico.
   Manter PS como flag independente (recomendado) e mapear CUR (Consulta Urgência) → Consulta?
3. **Saúde mental**: PDE/PDA (psiquiatria) e TNP (psicologia) — a flag de saúde mental hoje é
   `flag_saude_mental` (enriquecida). Continua valendo? Ou passa a sair destes códigos nativos?
4. **Alto custo / OPME / oncologia**: separar MAC, MIB, MOP, ONC/QMT/RDT em categorias próprias
   ou diluir em Taxa/Mat/Med e Oncologia?
5. **Honorário médico** (HNN, 46k linhas — volume alto): categoria própria, Consulta, ou Taxa/Mat/Med?
6. **Medicina preventiva** (MPB, MPC): categoria nova ou "Proc. Ambulatorial"?
7. **Rótulos que somem**: "Proc. Ambulatorial" e "Pronto Socorro" **não têm** grupo estatístico
   equivalente — se adotarmos a fonte nativa, esses rótulos deixam de existir como categoria de evento
   (PS continua via flag). Confirmar que está ok.

## Recomendação técnica de onde derivar
O grupo estatístico está só na **Bronze** (`raw_codigo_grupo_estatistico`), não na Silver.
Recomendo o pipeline **Bronze→Silver passar a carregar** esse código (uma coluna a mais) e a Gold
aplicar a de-para — evita join Gold→Bronze na leitura. Enquanto isso não acontece, a de-para pode
ser prototipada com join por hash (`silver.exact_raw_line_sha256 = bronze.raw_row_sha256`, a validar).
