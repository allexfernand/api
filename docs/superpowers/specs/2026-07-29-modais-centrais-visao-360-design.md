# Modais centrais da Visão 360

## Objetivo

Substituir os painéis laterais da Visão 360 por modais centrais amplos para o detalhe do beneficiário e a linhagem Databricks.

## Design

Os dois componentes continuarão usando a mesma estrutura, papéis ARIA, foco inicial, fechamento por Escape e clique no fundo. A camada compartilhada passará a centralizar o diálogo; o conteúdo terá largura máxima de 1.120 px, altura máxima de 88% da viewport e rolagem interna.

Em telas estreitas, o modal ocupa a largura disponível com uma margem pequena. A animação deixa de deslizar da lateral e passa a aparecer suavemente no centro.

## Fora de escopo

Não haverá mudança nas consultas, no conteúdo dos painéis, nos gatilhos de abertura ou nas permissões.

## Validação

O teste e2e da linhagem continuará verificando abertura, troca de conteúdo e fechamento por Escape; a verificação adicional confirmará que o diálogo tem layout de modal central.
