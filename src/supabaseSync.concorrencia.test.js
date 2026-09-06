import { savePositionsToDb } from "./supabaseSync";
import { criarControleGravacao } from "./controleGravacao";

const LOTE = 330;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}

function linha(id, overrides = {}) {
  return {
    id,
    termo: `bgp:${id}`,
    contrato: "BGIQ26",
    direcao: "vendido",
    categoria: "hedge",
    contratos_qtd: 2,
    preco_entrada: 350,
    preco_saida: null,
    data_entrada: "2026-08-01",
    data_saida: null,
    status: "aberta",
    custo_corretagem: null,
    custo_finpec: null,
    resultado_realizado: null,
    mes: "Agosto/26",
    detalhes: "detalhe inicial",
    negocio_rateio: null,
    obs: null,
    origem: "bgi-portfolio",
    referencia_bolsa: `BGI-AA-${id}`,
    ...overrides,
  };
}

function app(row, overrides = {}) {
  return {
    id: row.id,
    registroPersistidoId: row.id,
    termoPersistido: row.termo,
    contrato: row.contrato,
    mes: row.mes,
    lado: row.direcao === "comprado" ? "Comprado" : "Vendido",
    contratos: row.contratos_qtd,
    entrada: row.preco_entrada,
    saida: row.preco_saida ?? "",
    dataEntrada: row.data_entrada || "",
    dataSaida: row.data_saida || "",
    corretora: row.custo_corretagem == null ? 0 : row.custo_corretagem / (row.contratos_qtd * LOTE),
    finpec: row.custo_finpec == null ? 0 : row.custo_finpec / (row.contratos_qtd * LOTE),
    status: row.status === "encerrada" ? "Fechada" : "Aberta",
    negocio: row.negocio_rateio || "",
    detalhes: row.detalhes || "",
    referenciaBolsa: row.referencia_bolsa || "",
    registroOriginal: row,
    ...overrides,
  };
}

class PostgrestFake {
  constructor(rows) {
    this.rows = rows;
    this.failUpdateIds = new Set();
    this.effectiveUpdates = [];
    this.selectById = [];
  }

  from(table) {
    return new QueryFake(this, table);
  }
}

class QueryFake {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.filters = [];
    this.action = "select";
    this.payload = null;
    this.ignoreDuplicates = false;
  }

  select() { this.selected = true; return this; }
  eq(field, value) { this.filters.push([field, "eq", value]); return this; }
  is(field, value) { this.filters.push([field, "is", value]); return this; }
  in(field, values) { this.filters.push([field, "in", values]); return this; }
  update(payload) { this.action = "update"; this.payload = payload; return this; }
  upsert(rows, options = {}) { this.action = "upsert"; this.payload = rows; this.ignoreDuplicates = options.ignoreDuplicates; return this; }
  delete() { this.action = "delete"; return this; }
  insert(rows) { this.action = "insert"; this.payload = rows; return Promise.resolve({ data: rows, error: null }); }

  async maybeSingle() {
    if (this.table !== "posicoes_hedge") return { data: null, error: null };
    const matches = () => this.client.rows.filter((row) => this.filters.every(([field, op, value]) => (
      op === "eq" ? String(row[field]) === String(value)
        : op === "is" ? (value === null ? row[field] == null : row[field] === value)
          : value.includes(row[field])
    )));
    if (this.action === "upsert") {
      const incoming = this.payload[0];
      const found = this.client.rows.find((row) => row.termo === incoming.termo);
      if (found) {
        if (this.ignoreDuplicates) return { data: found, error: null };
        Object.assign(found, incoming);
        return { data: found, error: null };
      }
      const created = { id: `db-${incoming.termo}`, ...incoming };
      this.client.rows.push(created);
      return { data: created, error: null };
    }
    if (this.action === "update") {
      const found = matches()[0];
      if (!found) return { data: null, error: null };
      if (this.client.failUpdateIds.has(found.id)) {
        this.client.failUpdateIds.delete(found.id);
        return { data: null, error: { message: `falha sintética em ${found.id}` } };
      }
      Object.assign(found, this.payload);
      this.client.effectiveUpdates.push(found.id);
      return { data: found, error: null };
    }
    if (this.action === "delete") {
      this.client.rows = this.client.rows.filter((row) => !matches().includes(row));
      return { data: null, error: null };
    }
    const idFilter = this.filters.find(([field]) => field === "id");
    if (idFilter) this.client.selectById.push(idFilter[2]);
    return { data: matches()[0] || null, error: null };
  }
}

function assinatura(posicao) {
  return JSON.stringify({
    id: posicao.id,
    status: posicao.status,
    saida: posicao.saida,
    detalhes: posicao.detalhes,
    corretora: posicao.corretora,
  });
}

describe("concorrência e confirmação da persistência BGI", () => {
  test("aba antiga encerrando b não reabre a já encerrada", async () => {
    const client = new PostgrestFake([linha("a"), linha("b")]);
    const a = app(client.rows[0]);
    const b = app(client.rows[1]);
    await savePositionsToDb([{ ...a, saida: 360, status: "Fechada" }], client);
    await savePositionsToDb([{ ...b, detalhes: "edição da aba antiga" }], client);
    expect(client.rows.find((row) => row.id === "a").status).toBe("encerrada");
    expect(client.rows.find((row) => row.id === "b").status).toBe("aberta");
  });

  test("CAS recusa posição stale em vez de sobrescrever mudança concorrente", async () => {
    const client = new PostgrestFake([linha("a")]);
    const original = app({ ...client.rows[0] });
    client.rows[0].detalhes = "alteração de outra aba";
    await expect(savePositionsToDb([{ ...original, detalhes: "edição stale" }], client)).rejects.toThrow(/Conflito/);
    expect(client.rows[0].detalhes).toBe("alteração de outra aba");
  });

  test("ACK atrasado seguido de encerramento conserva origem nova e encerramento", async () => {
    const base = app(linha("a"));
    const primeiro = deferred();
    const chamadas = [];
    const controle = criarControleGravacao({
      gravar: (rows) => {
        chamadas.push(rows.map((row) => ({ ...row })));
        return chamadas.length === 1 ? primeiro.promise : Promise.resolve({ ok: true, registros: [{ id: "a", termo: "bgp:a" }] });
      },
      assinatura,
    });
    controle.carregar([base]);
    controle.atualizar([{ ...base, detalhes: "origem nova" }]);
    const salvar = controle.salvar();
    await Promise.resolve();
    controle.atualizar([{ ...base, detalhes: "origem nova", saida: 361, status: "Fechada" }]);
    primeiro.resolve({ ok: true, registros: [{ id: "a", termo: "bgp:a" }] });
    await salvar;
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1][0]).toMatchObject({ detalhes: "origem nova", saida: 361, status: "Fechada" });
  });

  test("custo total com centavos por arroba é preservado ao editar detalhes", async () => {
    const row = linha("a", { contratos_qtd: 3, custo_corretagem: 10.01 });
    const client = new PostgrestFake([row]);
    await savePositionsToDb([{ ...app(row), detalhes: "detalhe revisado" }], client);
    expect(client.rows[0].custo_corretagem).toBe(10.01);
    expect(client.rows[0].detalhes).toBe("detalhe revisado");
  });

  test("comissão alterada em encerrada recalcula resultado realizado", async () => {
    const row = linha("a", { status: "encerrada", preco_saida: 360, contratos_qtd: 2, custo_corretagem: 0, resultado_realizado: -6600 });
    const client = new PostgrestFake([row]);
    await savePositionsToDb([{ ...app(row), corretora: 0.01 }], client);
    expect(client.rows[0].custo_corretagem).toBeCloseTo(6.6, 10);
    expect(client.rows[0].resultado_realizado).toBeCloseTo(-6606.6, 10);
  });

  test("primeira confirmação ambígua reconcilia a antes do retry, sem duplicar escrita", async () => {
    const client = new PostgrestFake([linha("a"), linha("b")]);
    client.failUpdateIds.add("b");
    const a = app(client.rows[0]);
    const b = app(client.rows[1]);
    const enviados = [];
    const controle = criarControleGravacao({
      gravar: async (rows) => {
        enviados.push(rows.map((row) => row.id));
        return savePositionsToDb(rows, client);
      },
      assinatura,
    });
    controle.carregar([a, b]);
    controle.atualizar([{ ...a, detalhes: "a nova" }, { ...b, detalhes: "b nova" }]);
    await expect(controle.salvar()).rejects.toThrow(/falha sintética/);
    await controle.salvar();
    expect(enviados[0]).toEqual(["a", "b"]);
    expect(enviados[1]).toEqual(["a", "b"]);
    expect(client.effectiveUpdates.filter((id) => id === "a")).toHaveLength(1);
    expect(client.effectiveUpdates.filter((id) => id === "b")).toHaveLength(1);
    expect(client.selectById).toContain("a");
    expect(client.rows.find((row) => row.id === "a").detalhes).toBe("a nova");
    expect(client.rows.find((row) => row.id === "b").detalhes).toBe("b nova");
    expect(client.rows.every((row) => row.status !== "encerrada")).toBe(true);
  });
});
