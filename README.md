# ListaFácil

Lista de compras para celular, feita para o dia a dia no mercado: monte a lista em casa, siga o roteiro da loja, marque o que já está no carrinho, feche a compra e repita no mês seguinte. Funciona sem conta e, com login, salva na nuvem e permite fazer a compra junto com outra pessoa, ao vivo.

---

## Aplicações práticas no dia a dia

- **Compra do mês:** monte a lista com preços, acompanhe o total estimado e o orçamento enquanto anda pelo mercado.
- **Seguir o caminho da loja:** organize os itens na ordem dos corredores. Na próxima compra, inverta o roteiro se for entrar pelo outro lado.
- **Duas pessoas no mesmo mercado:** compartilhe a lista. Cada uma vê na hora o que a outra pegou (com a cor e o nome de quem marcou) e ninguém compra em dobro.
- **Mandar alguém às compras:** convide com o perfil "Apenas marcar". A pessoa marca o que pegou, mas não altera a lista.
- **Repor a despensa:** gere um PDF para imprimir, com caixinhas para riscar o consumo de cada produto, e use como base para a próxima compra.
- **Controlar gastos:** veja o custo por categoria, compare com o preço do mês anterior e consulte as compras já concluídas.
- **Lista no WhatsApp:** envie os itens pendentes e os já comprados, organizados por categoria e com subtotais.
- **Sem internet no mercado:** continue marcando e editando. As alterações são enviadas quando a conexão volta.

---

## Funcionalidades

### Listas e itens
- Várias listas independentes, cada uma com nome, orçamento e forma de exibição próprios.
- Item com nome, quantidade, unidade (un, pacote, kg, g, L, mL), tamanho da embalagem, preço, categoria e observação.
- Preço por unidade, por kg, por litro ou por pacote. A conta é feita sem erro de arredondamento (ex.: 1,5 kg × R$ 10,00/kg = R$ 15,00).
- Preço ausente fica como "sem preço" e nunca é somado como zero.
- Botões − e + para a quantidade e "Salvar e adicionar outro".
- Sugestões a partir dos itens que você já usou, com busca que ignora acentos.
- Aviso ao cadastrar um item repetido.
- Excluir com opção "Desfazer" por 4 segundos, devolvendo o item à lista original.
- Categorias: Alimentos, Merendas, Proteínas, Limpeza, Higiene, Bebidas e Outros.

### Organização
- Exibição por Roteiro (ordem manual, arrastando), Por categoria, A a Z ou Recentes.
- Inverter o roteiro.
- Itens pendentes sempre acima dos que já estão no carrinho.
- Busca e filtro por categoria.

### No mercado
- Modo "Fazendo compras": letra maior, visual simplificado e tela que não apaga sozinha.
- Barra de orçamento que muda de cor conforme o gasto se aproxima do limite.
- Contadores de itens e "Total estimado" sempre visíveis no topo.

### Fechar a compra e repetir
- "Concluir compra" guarda um registro fixo do que foi pago, que não muda depois.
- "Criar próxima compra" gera uma nova lista a partir da anterior, com opção de levar os preços e o orçamento, sem alterar a original.
- Histórico mensal de preços com indicação de alta ou queda.

### Relatórios e compartilhamento
- PDF A4 para imprimir: itens por categoria, subtotais, total e caixinhas de controle de consumo.
- Painel de custo por categoria.
- Texto para WhatsApp (pendentes e comprados, por categoria) e arquivo TXT/CSV, da lista inteira ou só do que está visível na tela.
- Enviar uma cópia da lista: quem recebe ganha uma lista própria e separada.

### Conta e nuvem (opcional)
- Entrar com Google ou e-mail e senha.
- Listas salvas na nuvem e disponíveis em outros aparelhos.
- Cada conta vê somente os próprios dados, inclusive ao trocar de conta no mesmo aparelho.
- Em caso de divergência entre aparelhos, o app mostra as duas versões e você escolhe; nada é sobrescrito sem aviso.
- Backup para baixar e restaurar, e versões anteriores guardadas na nuvem.

### Colaboração ao vivo
- Convite por link ou QR, válido para uma lista, uma pessoa e 24 horas.
- Perfis: **Editor** (adiciona, edita, exclui e marca) e **Apenas marcar** (marca e desmarca).
- Cada marcação mostra a cor, as iniciais e "Marcado por Nome".
- Se duas pessoas marcam o mesmo item ao mesmo tempo, vale a primeira marcação e a outra recebe um aviso.
- O dono vê os participantes e pode remover alguém ou cancelar convites.
- O convidado só acessa a lista compartilhada, nunca as outras listas nem as compras antigas do dono.

### Outros
- Tema claro e escuro (segue o celular na primeira visita).
- Pode ser instalado na tela inicial do celular, como um aplicativo.
- Botões com descrição para leitores de tela e itens marcáveis como caixas de seleção.

---

## Limitações conhecidas

- Sem conta, os dados ficam só neste aparelho. Limpar os dados do navegador apaga o que não tiver sido enviado ou salvo em backup.
- Para compartilhar uma lista, as duas pessoas precisam de conta e da atualização de "Armazenamento das listas".
- Uma marcação vale para a quantidade inteira do item; não há divisão de quantidades entre pessoas.
- Não há chat nem notificações fora do app.
- Remover um participante não apaga cópias já baixadas no aparelho dele.
- Ainda não validado em iPhone e Android reais, com duas contas ao mesmo tempo nem em modo avião prolongado.

---

## Para desenvolvedores

React 18, TypeScript, Vite, Tailwind e Zustand no app; Lovable Cloud para login, banco de dados e tempo real. Regras de arquitetura em `AGENTS.md` e `db/collab/AGENTS.md`.

```sh
bun install
bun run dev          # app em desenvolvimento
bunx vitest run      # testes do app
bash db/collab/test/run.sh   # testes do banco (Postgres descartável)
```
