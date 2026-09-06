const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// O cliente real roda no build. Toda requisição externa é interceptada;
// credencial e registros abaixo são fictícios e nunca deixam o navegador.
const fonte = fs.readFileSync(path.join(__dirname, '../src/supabaseSync.js'), 'utf8');
const projeto = /https:\/\/([a-z]+)\.supabase\.co/.exec(fonte)[1];
const base = () => ['a', 'b', 'c'].map((id, i) => ({
  id: `teste-${id}`, termo: `bgp:${id}`, referencia_bolsa: `B3-teste-${id}`,
  contrato: 'BGIQ26', direcao: 'vendido', categoria: 'hedge', contratos_qtd: i + 1,
  preco_entrada: 350, preco_saida: null, data_entrada: '2026-08-01', data_saida: null,
  status: 'aberta', custo_corretagem: null, custo_finpec: null, resultado_realizado: null,
  mes: 'Agosto/26', detalhes: 'Dados fictícios de regressão', negocio_rateio: null,
  obs: null, origem: 'bgi-portfolio', created_at: '2026-08-01T00:00:00Z',
}));

async function ambiente(context) {
  const estado = { rows: base(), escritas: [], externas: [], erros: [], atraso: 0, falhar: false };
  const session = { access_token: `falso.${Buffer.from(JSON.stringify({ exp: 9999999999, sub: 'usuario-teste' })).toString('base64url')}.falso`, refresh_token: 'somente-teste', expires_at: 9999999999, token_type: 'bearer', user: { id: 'usuario-teste' } };
  await context.addInitScript(({ chave, session }) => {
    if (location.hostname === '127.0.0.1') localStorage.setItem(chave, JSON.stringify(session));
  }, { chave: `sb-${projeto}-auth-token`, session });
  context.on('page', (page) => {
    page.on('pageerror', (e) => estado.erros.push(e.message));
    page.on('console', (msg) => { if (msg.type() === 'error') estado.erros.push(msg.text()); });
  });
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === '127.0.0.1') return route.continue();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.hostname === `${projeto}.supabase.co`) {
      const tabela = url.pathname.split('/').pop();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
      if (!url.pathname.startsWith('/rest/v1/')) return json({ user: session.user });
      const filtros = (row) => [...url.searchParams.entries()].every(([key, value]) => {
        if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
        if (value === 'is.null') return row[key] == null;
        return true;
      });
      let rows = [];
      if (req.method() !== 'GET') {
        estado.escritas.push({ tabela, metodo: req.method(), corpo: req.postDataJSON(), filtros: [...url.searchParams] });
        if (tabela === 'posicoes_hedge' && estado.atraso) await new Promise((r) => setTimeout(r, estado.atraso));
        if (tabela === 'posicoes_hedge' && estado.falhar) return json({ message: 'Falha sintética de permissão', code: '42501' }, 403);
      }
      if (tabela === 'posicoes_hedge') {
        if (req.method() === 'PATCH') {
          estado.rows = estado.rows.map((row) => {
            if (!filtros(row)) return row;
            const next = { ...row, ...req.postDataJSON() }; rows.push(next); return next;
          });
        } else if (req.method() === 'GET') rows = estado.rows.filter(filtros);
        else throw new Error(`Gravação inesperada de posição: ${req.method()}`);
      }
      if (tabela === 'cotacoes_bgi' && req.method() === 'GET') rows = [{ contrato: 'BGIQ26', preco: 345, data: '2026-08-31', fonte: 'manual' }];
      if (req.headers().accept?.includes('application/vnd.pgrst.object+json')) return json(rows[0] || null);
      return json(rows);
    }
    estado.externas.push(url.hostname);
    if (url.hostname.includes('tradingview') || url.hostname.includes('cotacao.b3')) return json({ data: [] });
    // Shell externo e fontes não fazem parte do teste de persistência.
    if (req.resourceType() === 'script') return route.fulfill({ contentType: 'application/javascript', body: '' });
    if (req.resourceType() === 'stylesheet') return route.fulfill({ contentType: 'text/css', body: '' });
    return json({});
  });
  return estado;
}

async function abrir(page) {
  await page.goto('/boi-gordo-portfolio/');
  await expect(page.locator('.portfolio-subtitle')).toContainText('Atualizado');
}
async function editar(page, id) {
  const row = page.locator('table').first().locator('tbody tr').filter({ hasText: `B3-teste-${id}` });
  await row.getByRole('button', { name: 'Editar', exact: true }).click();
  return page.locator('.edit-table tbody tr').filter({ hasText: `B3-teste-${id}` });
}

test('três encerramentos pelo clique real em Salvar sobrevivem a recarga e nova aba', async ({ context }) => {
  const estado = await ambiente(context);
  const page = await context.newPage();
  await abrir(page);
  expect(estado.escritas.filter((e) => e.tabela === 'posicoes_hedge')).toHaveLength(0);
  for (const [i, id] of ['a', 'b', 'c'].entries()) {
    const editor = await editar(page, id);
    await editor.locator('input[type=number]').nth(2).fill(String(345 + i));
    // Sem blur artificial: o clique precisa sobreviver ao commit do campo.
    await editor.getByRole('button', { name: 'Salvar alteração', exact: true }).click();
    await expect(page.locator('.portfolio-subtitle')).toContainText('Alterações confirmadas');
    await expect(editor).toHaveCount(0);
    expect(estado.rows.filter((p) => p.status === 'encerrada')).toHaveLength(i + 1);
    const escritas = estado.escritas.filter((e) => e.tabela === 'posicoes_hedge');
    expect(escritas).toHaveLength(i + 1);
    expect(escritas.at(-1).filtros).toContainEqual(['id', `eq.teste-${id}`]);
  }
  await page.reload();
  await expect(page.locator('.history-table tbody tr')).toHaveCount(3);
  const outra = await context.newPage();
  await abrir(outra);
  await expect(outra.locator('.history-table tbody tr')).toHaveCount(3);
  expect(estado.rows.map((r) => r.preco_saida)).toEqual([345, 346, 347]);
  expect(estado.escritas.filter((e) => e.tabela === 'posicoes_hedge')).toHaveLength(3);
  expect(estado.erros).toEqual([]);
});

test('aba antiga não reabre outra posição e conflito na mesma posição é bloqueado', async ({ context }) => {
  const estado = await ambiente(context);
  const primeira = await context.newPage();
  const antiga = await context.newPage();
  await abrir(primeira); await abrir(antiga);
  const a = await editar(primeira, 'a');
  await a.locator('input[type=number]').nth(2).fill('345');
  await a.getByRole('button', { name: 'Salvar alteração', exact: true }).click();
  await expect(primeira.locator('.portfolio-subtitle')).toContainText('Alterações confirmadas');
  const b = await editar(antiga, 'b');
  await b.locator('textarea').last().fill('Conferência sintética');
  await b.getByRole('button', { name: 'Salvar alteração', exact: true }).click();
  await expect(antiga.locator('.portfolio-subtitle')).toContainText('Alterações confirmadas');
  expect(estado.rows[0].status).toBe('encerrada');
  const aAntiga = await editar(antiga, 'a');
  await aAntiga.locator('textarea').last().fill('Edição desatualizada');
  await aAntiga.getByRole('button', { name: 'Salvar alteração', exact: true }).click();
  await expect(antiga.getByRole('alert')).toContainText('Não foi possível confirmar');
  expect(estado.rows[0].status).toBe('encerrada');
  expect(estado.rows[0].preco_saida).toBe(345);
  antiga.once('dialog', (dialog) => dialog.accept());
  await antiga.getByRole('button', { name: 'Rever versão da base sem aplicar esta edição' }).click();
  await expect(antiga.locator('.portfolio-subtitle')).toContainText('Posições recarregadas');
  expect(await antiga.evaluate(() => Boolean(localStorage.getItem('bgi-portfolio-positions-v1-edicao-nao-confirmada')))).toBe(true);
  expect(estado.erros).toEqual([]);
});
