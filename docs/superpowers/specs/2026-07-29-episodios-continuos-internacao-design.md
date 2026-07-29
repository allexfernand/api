# Episódios contínuos de internação

## Objetivo

Contar internações por período clínico contínuo de cada beneficiário, em vez de usar conta, senha e prestador como identidade do episódio.

## Regra

Para uma mesma empresa e pessoa, cada intervalo válido de `data_inicio_internacao` a `data_alta` pertence ao mesmo episódio quando sobrepõe ou toca o intervalo anterior. Assim, uma alta em 12/11 e uma nova internação em 12/11 são um único episódio. Um intervalo que começa após a alta anterior inicia outro episódio.

Linhas sem as duas datas continuarão usando a chave de admissão existente como fallback, para não inferir continuidade clínica sem evidência.

## Arquitetura

O Databricks materializará uma visão canônica no grão empresa + pessoa + episódio contínuo. Os marts mensal e por acomodação serão derivados dela. A consulta da Análise Sinistro, que lê a Gold diretamente, repetirá a mesma consolidação em CTE para manter os números iguais aos marts. A interface explicará o novo critério.

## Fora de escopo

Não haverá mudança nos dados de origem, nas linhas assistenciais, no custo total ou na quantidade de beneficiários distintos.

## Validação

Uma consulta de amostra com os quatro períodos do print deve retornar três episódios e uma pessoa distinta. O projeto deve continuar passando em typecheck, lint e testes unitários.
