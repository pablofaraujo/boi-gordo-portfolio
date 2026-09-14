# Portfólio B3 — contexto para manutenção

Este repositório publica o aplicativo separado Portfólio B3 usado pelo menu do
Confinex. Leia `README.md` para o contrato de persistência, testes e reversão.

- `src/App.jsx`: interface, edição, confirmação e recuperação explícita.
- `src/controleGravacao.js`: fila serial, versões confirmadas e pendências.
- `src/jornalPendencias.js`: cópias locais por usuário/posição/aba/versão; nunca
  substitui a base, nunca importa cache antigo automaticamente.
- `src/supabaseSync.js`: identidade persistente, gravação por chave estável,
  comparação da versão original e confirmação de posição/rateio.
- `tests/persistencia.spec.cjs`: build real com Supabase inteiramente simulado,
  em Chromium e WebKit; nenhum teste deve depender de conta ou posição real.

Só anuncie salvamento depois da confirmação completa. Preserve identidade,
edições concorrentes, cópias não confirmadas e cálculos existentes. Uma falha
após gravar a posição pode deixar o rateio pendente: não a transforme em sucesso
apenas porque a posição existe. Não executar migração ou reparo histórico junto
com mudanças de interface. Todo o repositório é público: use fixtures fictícias.

Antes de publicar: suíte unitária, build com `CI=true`, testes de navegador e
`git diff --check`; depois conferir CI/deploy e a meta `confinex-build` servida.
