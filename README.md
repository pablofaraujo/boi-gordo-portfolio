# boi-gordo-portfolio

Dashboard React para acompanhar posições em futuros de Boi Gordo (BGI) na B3 usando cotações do Yahoo Finance.

As posições são carregadas do Supabase. O botão **Recarregar da base** executa
somente leitura: atualizar a tela não dispara o salvamento automático nem cria
uma nova posição. Alterações feitas pelo usuário continuam sendo salvas.
Registros antigos sem chave própria preservam o ID original do banco quando são
editados, evitando que uma alteração posterior os transforme em nova posição.

URL planejada:

https://pablofaraujo.github.io/boi-gordo-portfolio
