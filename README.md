# boi-gordo-portfolio

Dashboard React para acompanhar posições em futuros de Boi Gordo (BGI) na B3.

As posições são carregadas do Supabase. O botão **Recarregar da base** executa
somente leitura: atualizar a tela não dispara o salvamento automático nem cria
uma nova posição. Alterações feitas pelo usuário continuam sendo salvas.
Registros antigos sem chave própria preservam o ID original do banco quando são
editados, evitando que uma alteração posterior os transforme em nova posição.
O rateio aceita espaços acidentais, hífens, dois-pontos e o sufixo `cts`; quando
há vários lotes, quantidades ausentes não são preenchidas por suposição.

URL publicada:

https://pablofaraujo.github.io/boi-gordo-portfolio

## Encerramento e confirmação na base

O editor permanece disponível depois de informar a saída. **Salvar alteração**
conclui o campo focado e aguarda a confirmação da base; o histórico usa o mesmo
fluxo. Uma fila única atende ao botão e ao salvamento automático, enviando apenas
as posições editadas. Respostas atrasadas só acrescentam identidade e referência,
sem restaurar valores antigos sobre ajustes posteriores.

Registros existentes usam atualização por ID com comparação atômica dos campos
lidos (CAS). Uma aba desatualizada não pode sobrescrever silenciosamente a posição
que mudou em outra aba. Novas posições mantêm chave estável e não sobrescrevem
uma chave já existente. Retorno vazio, divergente ou erro de rateio não é anunciado
como sucesso. Custos totais antigos não são arredondados novamente ao editar texto.

Recarregar não descarta ajustes pendentes. Em caso de conflito, é possível **Rever
versão da base sem aplicar esta edição**, mediante confirmação: uma cópia privada
dos ajustes fica no armazenamento do navegador, com data, para conferência.
A abertura nunca importa automaticamente o cache antigo para uma base vazia.
Posições legadas gerenciadas pelo portfólio continuam consultáveis após encerradas.

Limites: o CAS protege as gravações feitas por esta versão. Uma aba ainda executando
uma versão antiga não passa por essa proteção; precisa ser recarregada. Não há
migração, alteração de RLS ou reparo automático de posições históricas neste ciclo.
Uma falha entre a posição e seu rateio é sinalizada e preserva a edição para
conferência/repetição idempotente; não se afirma transação única entre tabelas.

## Testes obrigatórios antes da publicação

```sh
npm ci
CI=true npm test -- --watchAll=false --runInBand
CI=true REACT_APP_BUILD_SHA=local npm run build
npx playwright install chromium webkit
npm run test:navegador
git diff --check
```

Os testes de navegador executam o build real em Chromium desktop e WebKit com
perfil de iPhone (não equivalem a um iPhone físico). Cobrem clique em Salvar com
foco na saída, três encerramentos seguidos, recarga/nova aba e conflito entre abas.
O cliente real do Supabase conversa somente com um simulador PostgREST em memória;
todas as requisições externas são interceptadas. Não utilizam credenciais reais,
não gravam dados de teste no Supabase e não alteram posições reais.

Testes unitários adicionais cobrem falha parcial, confirmação atrasada, erro de
rede, chave repetida, preservação dos custos e base vazia. O workflow executa testes,
build e navegadores antes do deploy. Pull requests apenas validam, sem publicar.
A meta `confinex-build` permite conferir o SHA servido após o deploy.

Reversão de código: reverta o commit da correção pelo Git, valide e publique o
revert. Isso não desfaz encerramentos legítimos gravados depois da publicação e
reintroduz a vulnerabilidade das abas antigas; não reverta dados junto com código.
