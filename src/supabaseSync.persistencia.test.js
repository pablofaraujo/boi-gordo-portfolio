var mockResponses = [];
function makeMockDb() {
const from = () => {
    const response = mockResponses.shift() || { data: null, error: null };
    const builder = {
      select: jest.fn(() => builder), eq: jest.fn(() => builder), is: jest.fn(() => builder),
      in: jest.fn(() => builder), or: jest.fn(() => builder), order: jest.fn(() => builder),
      limit: jest.fn(() => builder), update: jest.fn(() => builder),
      upsert: jest.fn(() => builder), delete: jest.fn(() => builder), insert: jest.fn(() => builder),
      maybeSingle: jest.fn(async () => response),
      then: (resolve, reject) => Promise.resolve(response).then(resolve, reject),
    };
    return builder;
};
return { from: jest.fn(from) };
}

const { appToRow, rowToApp, savePositionsToDb, separarPosicoesParaPersistencia } = require("./supabaseSync");
var mockDb = makeMockDb();

describe("persistência idempotente das posições", () => {
  beforeEach(() => { mockResponses.length = 0; mockDb.from.mockClear(); mockDb.from.mockImplementation(() => {
    const response = mockResponses.shift() || { data: null, error: null };
    const builder = {
      select: jest.fn(() => builder), eq: jest.fn(() => builder), is: jest.fn(() => builder), in: jest.fn(() => builder), or: jest.fn(() => builder), order: jest.fn(() => builder), limit: jest.fn(() => builder), update: jest.fn(() => builder), upsert: jest.fn(() => builder), delete: jest.fn(() => builder), insert: jest.fn(() => builder), maybeSingle: jest.fn(async () => response), then: (resolve, reject) => Promise.resolve(response).then(resolve, reject),
    }; return builder;
  }); });
  test("guarda os campos brutos e a identidade para CAS", () => {
    const app = rowToApp({
      id: "p-1", termo: null, contrato: "BGIX26", direcao: "vendido",
      contratos_qtd: 2, preco_entrada: 350, preco_saida: 360,
      data_saida: "2026-09-05", status: "encerrada", origem: "legado",
      obs: "observação antiga",
    });
    expect(app.identidade).toEqual({ id: "p-1", termo: null });
    expect(app.registroOriginal).toMatchObject({ preco_saida: 360, origem: "legado" });
    expect(appToRow(app).obs).toBe("observação antiga");
    expect(appToRow(app).origem).toBe("legado");
  });

  test("posição antiga continua sendo atualização por ID", () => {
    const app = rowToApp({ id: "p-2", termo: null, contrato: "BGIZ26", direcao: "comprado", status: "aberta" });
    const plano = separarPosicoesParaPersistencia([app]);
    expect(plano.gravacoesPorTermo).toHaveLength(0);
    expect(plano.atualizacoesPorId[0]).toMatchObject({ id: "p-2", registroOriginal: { contrato: "BGIZ26" } });
  });

  test("fechamento lido do banco permanece fechado", () => {
    const app = rowToApp({ id: "p-3", termo: "bgp:p-3", contrato: "BGIX26", direcao: "vendido", status: "encerrada", preco_saida: 362, data_saida: "2026-09-05" });
    expect(app.status).toBe("Fechada");
    expect(app.saida).toBe(362);
    expect(app.dataSaida).toBe("2026-09-05");
  });

  test("não funde posições distintas só por semelhança", () => {
    const a = rowToApp({ id: "a", termo: "bgp:a", contrato: "BGIX26", direcao: "vendido", contratos_qtd: 1, preco_entrada: 350, status: "aberta" });
    const b = rowToApp({ id: "b", termo: "bgp:b", contrato: "BGIX26", direcao: "vendido", contratos_qtd: 2, preco_entrada: 350, status: "aberta" });
    const plano = separarPosicoesParaPersistencia([a, b]);
    expect(plano.atualizacoesPorId).toHaveLength(2);
  });

  test("posição bgp existente fechada atualiza por ID, não por insert", async () => {
    const banco = { id: "db-1", termo: "bgp:real", contrato: "BGIX26", direcao: "vendido", categoria: "hedge", contratos_qtd: 1, preco_entrada: 350, preco_saida: null, data_entrada: null, data_saida: null, status: "aberta", custo_corretagem: null, custo_finpec: null, resultado_realizado: null, mes: "Novembro/26", detalhes: null, negocio_rateio: null, obs: "x", origem: "bgi-portfolio", referencia_bolsa: null };
    const app = rowToApp({ ...banco });
    app.saida = 360; app.dataSaida = "2026-09-05"; app.status = "Fechada";
    mockResponses.push({ data: { ...banco, preco_saida: 360, data_saida: "2026-09-05", status: "encerrada", resultado_realizado: -3300 }, error: null });
    const result = await savePositionsToDb([app], mockDb);
    expect(result.ok).toBe(true);
    expect(mockDb.from).toHaveBeenCalledWith("posicoes_hedge");
    expect(mockDb.from.mock.calls).toHaveLength(2);
  });

  test("CAS sem linhas e lookup divergente falha como conflito", async () => {
    const app = rowToApp({ id: "db-2", termo: "bgp:stale", contrato: "BGIX26", direcao: "vendido", contratos_qtd: 1, preco_entrada: 350, status: "aberta" });
    app.detalhes = "edição";
    mockResponses.push({ data: null, error: null }, { data: { id: "db-2", termo: "bgp:stale", contrato: "BGIX26", detalhes: "outra aba" }, error: null });
    await expect(savePositionsToDb([app], mockDb)).rejects.toThrow("Conflito");
  });

  test("retry de termo novo confirma o registro existente sem segundo upsert", async () => {
    const app = { id: "novo", contrato: "BGIX26", lado: "Vendido", contratos: 1, entrada: 350, status: "Aberta" };
    const row = appToRow(app);
    mockResponses.push({ data: null, error: null }, { data: { ...row, id: "db-new" }, error: null });
    const result = await savePositionsToDb([app], mockDb);
    expect(result.ok).toBe(true);
    expect(mockDb.from).toHaveBeenCalledTimes(3);
  });

  test("rateio ausente é validado antes de qualquer delete", async () => {
    const banco = rowToApp({ id: "db-3", termo: "bgp:alloc", contrato: "BGIX26", direcao: "vendido", contratos_qtd: 1, preco_entrada: 350, status: "aberta" });
    banco.negocio = "CF-26-999: 1";
    mockResponses.push({ data: { ...banco.registroOriginal, negocio_rateio: banco.negocio, id: "db-3" }, error: null }, { data: [], error: null });
    await expect(savePositionsToDb([banco], mockDb)).rejects.toThrow("Rateio não confirmado");
    expect(mockDb.from).toHaveBeenCalledTimes(2);
    expect(mockDb.from.mock.calls[1][0]).toBe("operacoes");
  });
});
