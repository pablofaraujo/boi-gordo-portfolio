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

async function ambiente(context, { semLogin = false } = {}) {
  const estado = { rows: base(), escritas: [], externas: [], erros: [], pageErrors: [], atraso: 0, falhar: false, perderResposta: false, falharRateio: false, proximoId: 1 };
  const session = { access_token: `falso.${Buffer.from(JSON.stringify({ exp: 9999999999, sub: 'usuario-teste' })).toString('base64url')}.falso`, refresh_token: 'somente-teste', expires_at: 9999999999, token_type: 'bearer', user: { id: 'usuario-teste' } };
  await context.addInitScript(({ chave, session, semLogin }) => {
    if (location.hostname === '127.0.0.1' && !semLogin && !localStorage.getItem(chave)) localStorage.setItem(chave, JSON.stringify(session));
  }, { chave: `sb-${projeto}-auth-token`, session, semLogin });
  context.on('page', (page) => {
    page.on('pageerror', (e) => { estado.erros.push(e.message); estado.pageErrors.push(e.message); });
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
        if (tabela === 'alocacoes_hedge' && estado.falharRateio) return json({ message: 'Rateio sintético não confirmado', code: '42501' }, 403);
      }
      if (tabela === 'posicoes_hedge') {
        if (req.method() === 'PATCH') {
          estado.rows = estado.rows.map((row) => {
            if (!filtros(row)) return row;
            const next = { ...row, ...req.postDataJSON() }; rows.push(next); return next;
          });
        } else if (req.method() === 'POST') {
          const corpo = req.postDataJSON();
          for (const enviado of Array.isArray(corpo) ? corpo : [corpo]) {
            // Simula UNIQUE(termo) + ignoreDuplicates; nunca sobrescreve.
            if (estado.rows.some((row) => row.termo === enviado.termo)) continue;
            const id = `novo-teste-${estado.proximoId++}`;
            const next = { ...enviado, id, referencia_bolsa: `B3-${id}`, created_at: '2026-09-14T12:00:00Z' };
            estado.rows.push(next); rows.push(next);
          }
          if (estado.perderResposta) return json({ message: 'Resposta sintética perdida após a gravação' }, 503);
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

function novaPosicao(page) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: 'Nova posição', exact: true }) });
}
async function preencherNova(page, detalhes = 'Cadastro fictício para recuperação') {
  const form = novaPosicao(page);
  await form.getByPlaceholder('Contratos', { exact: true }).fill('2');
  await form.getByPlaceholder('Entrada', { exact: true }).fill('360');
  await form.getByPlaceholder('Detalhes da operação', { exact: true }).fill(detalhes);
  return form;
}
async function reabrir(page) {
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  // A instalação do aviso de saída não deve interferir em diálogos posteriores.
  page.removeAllListeners('dialog');
}
const escritasPosicoes = (estado) => estado.escritas.filter((e) => e.tabela === 'posicoes_hedge');

test('Gravar aguarda confirmação, impede clique repetido e persiste cadastro novo', async ({ context }) => {
  const estado = await ambiente(context);
  estado.atraso = 1500;
  const page = await context.newPage();
  await abrir(page);
  const form = await preencherNova(page);
  const gravar = form.getByRole('button', { name: /Gravar|Gravando/ });
  await gravar.click();
  await expect(gravar).toBeDisabled();
  await expect(form.getByPlaceholder('Entrada', { exact: true })).toHaveValue('360');
  await expect(page.locator('.portfolio-subtitle')).toContainText('Alterações confirmadas');
  await expect(form.getByPlaceholder('Entrada', { exact: true })).toHaveValue('');
  expect(escritasPosicoes(estado)).toHaveLength(1);
  expect(estado.rows).toHaveLength(4);
  await reabrir(page);
  await expect(page.locator('table').first()).toContainText('Cadastro fictício para recuperação');
  expect(escritasPosicoes(estado)).toHaveLength(1);
  expect(estado.erros).toEqual([]);
});

for (const falha of ['antes', 'depois', 'rateio']) {
  test(`falha ${falha}: recuperar após reabrir sem reenvio automático ou duplicidade`, async ({ context }, testInfo) => {
    const estado = await ambiente(context);
    estado.falhar = falha === 'antes';
    estado.perderResposta = falha === 'depois';
    estado.falharRateio = falha === 'rateio';
    const page = await context.newPage();
    await abrir(page);
    const form = await preencherNova(page);
    await form.getByRole('button', { name: 'Gravar', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Não foi possível confirmar');
    await expect(form.getByPlaceholder('Entrada', { exact: true })).toHaveValue('360');
    const termo = escritasPosicoes(estado)[0].corpo[0].termo;
    estado.falhar = false; estado.perderResposta = false; estado.falharRateio = false;
    await reabrir(page);
    await expect(page.getByRole('button', { name: 'Revisar edições recuperadas', exact: true })).toBeVisible();
    const antes = escritasPosicoes(estado).length;
    // Reabrir e revisar apenas recuperam; a janela supera o antigo debounce.
    await page.getByRole('button', { name: 'Revisar edições recuperadas', exact: true }).click();
    await expect(page.locator('table').first()).toContainText('Cadastro fictício para recuperação');
    await page.waitForTimeout(1100);
    expect(escritasPosicoes(estado)).toHaveLength(antes);
    await page.screenshot({ path: testInfo.outputPath('pendencia-recuperada.png'), fullPage: true });
    await page.getByRole('button', { name: 'Salvar edições recuperadas', exact: true }).click();
    await expect(page.locator('.portfolio-subtitle')).toContainText('confirmadas na base');
    expect(estado.rows.filter((row) => row.termo === termo)).toHaveLength(1);
    expect(estado.rows).toHaveLength(4);
    await reabrir(page);
    await expect(page.locator('table').first()).toContainText('Cadastro fictício para recuperação');
    await expect(page.getByRole('button', { name: 'Revisar edições recuperadas', exact: true })).toHaveCount(0);
    expect(estado.pageErrors).toEqual([]);
    expect(estado.escritas.every((e) => ['posicoes_hedge', 'alocacoes_hedge'].includes(e.tabela))).toBe(true);
  });
}

test('fechar antes do envio terminar conserva cadastro para revisão na reabertura', async ({ context }) => {
  const estado = await ambiente(context);
  estado.atraso = 1500; estado.falhar = true;
  const page = await context.newPage();
  await abrir(page);
  const form = await preencherNova(page, 'Saída durante envio fictício');
  await form.getByRole('button', { name: 'Gravar', exact: true }).click();
  await expect.poll(() => escritasPosicoes(estado).length).toBe(1);
  await page.close({ runBeforeUnload: false });
  // A falha atrasada não insere no servidor simulado.
  const outra = await context.newPage();
  await abrir(outra);
  await expect(outra.getByRole('button', { name: 'Revisar edições recuperadas', exact: true })).toBeVisible();
  await outra.getByRole('button', { name: 'Revisar edições recuperadas', exact: true }).click();
  await expect(outra.locator('table').first()).toContainText('Saída durante envio fictício');
  await outra.waitForTimeout(1600);
  expect(estado.rows).toHaveLength(3);
  expect(escritasPosicoes(estado)).toHaveLength(1);
});

test('sem login não libera Gravar nem apaga o formulário preenchido', async ({ context }) => {
  const estado = await ambiente(context, { semLogin: true });
  const page = await context.newPage();
  await page.goto('/boi-gordo-portfolio/');
  await expect(page.locator('.portfolio-subtitle')).toContainText('Sem login');
  const form = await preencherNova(page);
  await expect(form.getByRole('button', { name: 'Gravar', exact: true })).toBeDisabled();
  await expect(form.getByPlaceholder('Entrada', { exact: true })).toHaveValue('360');
  expect(estado.escritas).toEqual([]);
  expect(estado.erros).toEqual([]);
});

test('falha do armazenamento local impede envio e preserva formulário', async ({ context }) => {
  const estado = await ambiente(context);
  const page = await context.newPage();
  await abrir(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (String(key).startsWith('bgi-portfolio-pendencias-v1')) throw new DOMException('Quota sintética', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  const form = await preencherNova(page);
  await form.getByRole('button', { name: 'Gravar', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(form.getByPlaceholder('Entrada', { exact: true })).toHaveValue('360');
  const salvar = page.getByRole('button', { name: 'Salvar alterações', exact: true });
  if (await salvar.count() && await salvar.isEnabled()) await salvar.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.portfolio-subtitle')).not.toContainText('confirmadas');
  expect(estado.escritas).toEqual([]);
  expect(estado.pageErrors).toEqual([]);
});

test('pendência pertence à conta original e não é exibida nem enviada pela outra conta', async ({ context }) => {
  const estado = await ambiente(context);
  estado.falhar = true;
  const page = await context.newPage();
  await abrir(page);
  const form = await preencherNova(page, 'Pendência privada do usuário fictício A');
  await form.getByRole('button', { name: 'Gravar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível confirmar');
  const chave = `sb-${projeto}-auth-token`;
  const sessionA = await page.evaluate((key) => localStorage.getItem(key), chave);
  await page.evaluate((key) => {
    const session = JSON.parse(localStorage.getItem(key));
    session.user = { id: 'outro-usuario-ficticio' };
    session.access_token = `falso.${btoa(JSON.stringify({ exp: 9999999999, sub: session.user.id }))}.falso`;
    localStorage.setItem(key, JSON.stringify(session));
  }, chave);
  estado.falhar = false;
  const antes = escritasPosicoes(estado).length;
  await reabrir(page);
  await expect(page.locator('.portfolio-subtitle')).toContainText('Atualizado');
  await expect(page.getByRole('button', { name: 'Revisar edições recuperadas', exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Pendência privada do usuário fictício A');
  expect(escritasPosicoes(estado)).toHaveLength(antes);
  await page.evaluate(({ chave, sessionA }) => localStorage.setItem(chave, sessionA), { chave, sessionA });
  await reabrir(page);
  await expect(page.getByRole('button', { name: 'Revisar edições recuperadas', exact: true })).toBeVisible();
  expect(escritasPosicoes(estado)).toHaveLength(antes);
  expect(estado.pageErrors).toEqual([]);
});

test('duas versões pendentes da mesma posição continuam distintas e exigem escolha', async ({ context }) => {
  const estado = await ambiente(context);
  estado.falhar = true;
  for (const detalhe of ['Versão fictícia da aba A', 'Versão fictícia da aba B']) {
    const page = await context.newPage();
    await abrir(page);
    const editor = await editar(page, 'a');
    await editor.locator('textarea').last().fill(detalhe);
    await editor.getByRole('button', { name: 'Salvar alteração', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Não foi possível confirmar');
    await page.close({ runBeforeUnload: false });
  }
  estado.falhar = false;
  const page = await context.newPage();
  await abrir(page);
  const opcoes = page.getByRole('button', { name: 'Recuperar esta edição', exact: true });
  await expect(opcoes).toHaveCount(2);
  await expect(page.locator('body')).toContainText('Versão fictícia da aba A');
  await expect(page.locator('body')).toContainText('Versão fictícia da aba B');
  const antes = escritasPosicoes(estado).length;
  await opcoes.first().click();
  const selecionado = await page.locator('table').first().innerText();
  expect(selecionado.includes('Versão fictícia da aba A') !== selecionado.includes('Versão fictícia da aba B')).toBe(true);
  await page.getByRole('button', { name: /Cancelar revisão/ }).click();
  await expect(opcoes).toHaveCount(2);
  expect(escritasPosicoes(estado)).toHaveLength(antes);
  await opcoes.first().click();
  await page.getByRole('button', { name: 'Salvar edições recuperadas', exact: true }).click();
  await expect(page.locator('.portfolio-subtitle')).toContainText('confirmadas na base');
  await expect(page.getByRole('button', { name: 'Revisar edições recuperadas', exact: true })).toBeVisible();
  expect(estado.rows).toHaveLength(3);
  expect(estado.pageErrors).toEqual([]);
});
