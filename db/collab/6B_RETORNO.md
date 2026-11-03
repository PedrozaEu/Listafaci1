# Bloco 6B: retorno seguro ao armazenamento anterior

1. No app (conta conectada): menu > Armazenamento das listas > "Voltar ao armazenamento anterior".
2. O app envia as alterações pendentes, lê a linha atual de `user_state` (trava otimista por `updated_at`),
   marca a importação como `rolled_back` e grava o estado atual (inclusive o que foi editado depois da migração) em `user_state`.
   O gatilho de histórico arquiva a versão anterior em `user_state_history`.
3. A partir daí todos os aparelhos voltam a usar `user_state`. As linhas relacionais continuam guardadas (nada é apagado)
   e uma nova atualização pode reativar (`rolled_back` -> `active`), depois de nova conferência.

Limitações conhecidas
- Histórico de preços criado depois da migração fica no aparelho (o legado importado fica em `legacy_price_history`).
- Se as listas mudarem entre uma tentativa interrompida e a retomada, a conferência não fecha e a troca não acontece;
  o usuário continua no armazenamento anterior, sem perda.
- A versão publicada antiga não conhece a troca: não atualizar contas reais antes de publicar esta versão.
