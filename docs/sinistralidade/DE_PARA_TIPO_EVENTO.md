# De-para — grupo estatístico nativo → tipo_evento (RASCUNHO para validação)

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
