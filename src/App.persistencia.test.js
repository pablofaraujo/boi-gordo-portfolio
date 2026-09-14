import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import Dashboard from "./App";

global.IS_REACT_ACT_ENVIRONMENT = true;

var mockSincronizacao;

jest.mock("./supabaseSync", () => {
  mockSincronizacao = {
  appToRow: (p) => ({ termo: `bgp:${p.id}`, contrato: p.contrato, direcao: p.lado === "Comprado" ? "comprado" : "vendido", contratos_qtd: Number(p.contratos), preco_entrada: Number(p.entrada), preco_saida: p.saida === "" ? null : Number(p.saida), status: p.saida === "" ? "aberta" : "encerrada" }),
  getSessionUserId: jest.fn(),
  fetchPositionsFromDb: jest.fn(),
  fetchHedgeExposureFromDb: jest.fn(),
  fetchLatestQuotesFromDb: jest.fn(),
  savePositionsToDb: jest.fn(),
  saveQuotesToDb: jest.fn(),
  deletePositionFromDb: jest.fn(),
  };
  return mockSincronizacao;
});

const POSICOES_ABERTAS = ["a", "b", "c"].map((id, indice) => ({
  id,
  contrato: "BGIQ26",
  mes: "Agosto/26",
  lado: "Vendido",
  contratos: indice + 1,
  entrada: 350 + indice,
  saida: "",
  dataEntrada: "2026-08-01",
  dataSaida: "",
  corretora: 0,
  finpec: 0,
  status: "Aberta",
  negocio: `lote sintético ${id}`,
  detalhes: "fixture sem dados reais",
}));

function defer() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

async function repousar() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function alterarValor(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function montar(posicoes = POSICOES_ABERTAS) {
  if (arguments.length) mockSincronizacao.fetchPositionsFromDb.mockResolvedValue(posicoes);
  global.fetch = jest.fn(() => Promise.reject(new Error("rede desabilitada no teste")));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Dashboard />));
  return { container, root };
}

describe("persistência de posições BGI durante fechamento e recarga", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mockSincronizacao.getSessionUserId.mockResolvedValue("usuario-teste");
    mockSincronizacao.fetchPositionsFromDb.mockResolvedValue(POSICOES_ABERTAS);
    mockSincronizacao.fetchHedgeExposureFromDb.mockResolvedValue({ necessarios: 0, abertos: 0 });
    mockSincronizacao.fetchLatestQuotesFromDb.mockResolvedValue({ prices: {}, updatedAt: "", source: "fixture" });
    mockSincronizacao.savePositionsToDb.mockImplementation(async (rows) => ({
      ok: true,
      registros: rows.map((row) => ({ id: `db-${row.id}`, termo: `bgp:${row.id}`, referencia_bolsa: `REF-${row.id}` })),
    }));
    mockSincronizacao.saveQuotesToDb.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("preencher Saída por blur mantém Salvar alteração disponível", async () => {
    const { container, root } = montar();
    await repousar();
    const editar = [...container.querySelectorAll("button")].find((b) => b.textContent === "Editar");
    act(() => editar.click());
    const saida = container.querySelectorAll('.edit-table input[type="number"]')[2];
    alterarValor(saida, "351.25");
    act(() => Simulate.blur(saida));
    await repousar();
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Salvar alteração")).toBe(true);
    act(() => root.unmount());
  });

  test("Salvar alteração aguarda gravação confirmada antes de encerrar editor", async () => {
    const pendente = defer();
    mockSincronizacao.savePositionsToDb.mockReturnValue(pendente.promise);
    const { container, root } = montar();
    await repousar();
    const editar = [...container.querySelectorAll("button")].find((b) => b.textContent === "Editar");
    act(() => editar.click());
    await repousar();
    const entrada = container.querySelector('.edit-table input[type="number"]');
    alterarValor(entrada, "399");
    const salvar = [...container.querySelectorAll("button")].find((b) => b.textContent === "Salvar alteração");
    act(() => salvar.click());
    await repousar();
    expect(mockSincronizacao.savePositionsToDb).toHaveBeenCalled();
    expect(container.textContent).toContain("Salvando alterações");
    pendente.resolve({ ok: true, registros: [{ id: "db-a", termo: "bgp:a", referencia_bolsa: "REF-a" }] });
    await repousar();
    expect(container.textContent).toContain("Alterações confirmadas");
    act(() => root.unmount());
  });

  test("três fechamentos persistidos continuam fechados após desmontar e montar", async () => {
    let remoto = POSICOES_ABERTAS.map((position) => ({ ...position }));
    mockSincronizacao.fetchPositionsFromDb.mockImplementation(() => Promise.resolve(remoto));
    mockSincronizacao.savePositionsToDb.mockImplementation(async (rows) => {
      rows.forEach((row) => {
        const indice = remoto.findIndex((position) => position.id === row.id);
        if (indice >= 0) remoto[indice] = { ...remoto[indice], ...row };
      });
      return {
        ok: true,
        registros: rows.map((row) => ({ id: `db-${row.id}`, termo: `bgp:${row.id}`, referencia_bolsa: `REF-${row.id}` })),
      };
    });
    const primeira = montar();
    await repousar();
    for (let indice = 0; indice < 3; indice += 1) {
      const editar = [...primeira.container.querySelectorAll("button")].find((b) => b.textContent === "Editar");
      act(() => editar.click());
      await repousar();
      const saida = primeira.container.querySelectorAll('.edit-table input[type="number"]')[2];
      alterarValor(saida, String(351 + indice));
      act(() => Simulate.blur(saida));
      await repousar();
      const salvar = [...primeira.container.querySelectorAll("button")].find((b) => b.textContent === "Salvar alteração");
      act(() => salvar.click());
      await repousar();
      expect(mockSincronizacao.savePositionsToDb).toHaveBeenCalledTimes(indice + 1);
      expect(remoto.filter((position) => position.status === "Fechada")).toHaveLength(indice + 1);
    }
    act(() => primeira.root.unmount());
    const segunda = montar(remoto);
    await repousar();
    expect(segunda.container.textContent).toContain("Histórico de posições encerradas");
    expect(segunda.container.querySelectorAll(".history-table tbody tr")).toHaveLength(3);
    act(() => segunda.root.unmount());
  });

  test("retorno atrasado da recarga não restaura posição antiga durante edição", async () => {
    const recarga = defer();
    let leitura = 0;
    mockSincronizacao.fetchPositionsFromDb.mockImplementation(() => {
      leitura += 1;
      return leitura === 1 ? Promise.resolve(POSICOES_ABERTAS) : recarga.promise;
    });
    const { container, root } = montar();
    await repousar();
    const editar = [...container.querySelectorAll("button")].find((b) => b.textContent === "Editar");
    act(() => editar.click());
    await repousar();
    const entrada = container.querySelector('.edit-table input[type="number"]');
    alterarValor(entrada, "399");
    const recarregar = [...container.querySelectorAll("button")].find((b) => b.textContent === "Recarregar da base");
    act(() => recarregar.click());
    recarga.resolve(POSICOES_ABERTAS);
    await repousar();
    expect(container.querySelector('.edit-table input[type="number"]')?.value).toBe("399");
    act(() => root.unmount());
  });

  test("descarte confirmado não grava enquanto a consulta da base está lenta", async () => {
    jest.useFakeTimers();
    const leitura = defer();
    const { container, root } = montar();
    await repousar();
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Editar").click());
    alterarValor(container.querySelector('.edit-table input[type="number"]'), "12");
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Recarregar da base").click());
    mockSincronizacao.fetchPositionsFromDb.mockReturnValueOnce(leitura.promise);
    jest.spyOn(window, "confirm").mockReturnValue(true);
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Rever versão da base sem aplicar esta edição").click());
    await act(async () => { jest.advanceTimersByTime(2000); await Promise.resolve(); });
    expect(mockSincronizacao.savePositionsToDb).not.toHaveBeenCalled();
    leitura.resolve(POSICOES_ABERTAS);
    await repousar();
    expect(container.querySelector('.edit-table input[type="number"]').value).toBe("1");
    expect(JSON.parse(localStorage.getItem("bgi-portfolio-positions-v1-edicao-nao-confirmada")).posicoes[0].contratos).toBe("12");
    act(() => root.unmount());
  });

  test("base vazia não grava zero e falha mantém edição e bloqueia recarga", async () => {
    mockSincronizacao.fetchPositionsFromDb.mockResolvedValue([]);
    const vazio = montar([]);
    await repousar();
    expect(mockSincronizacao.savePositionsToDb).not.toHaveBeenCalled();
    act(() => vazio.root.unmount());

    mockSincronizacao.fetchPositionsFromDb.mockResolvedValue(POSICOES_ABERTAS);
    mockSincronizacao.savePositionsToDb.mockRejectedValue(new Error("falha sintética"));
    const { container, root } = montar();
    await repousar();
    const editar = [...container.querySelectorAll("button")].find((b) => b.textContent === "Editar");
    act(() => editar.click());
    await repousar();
    const entrada = container.querySelector('.edit-table input[type="number"]');
    alterarValor(entrada, "399");
    const salvar = [...container.querySelectorAll("button")].find((b) => b.textContent === "Salvar alteração");
    act(() => salvar.click());
    await repousar();
    expect(container.textContent).toContain("Não foi possível confirmar");
    expect(container.textContent).toContain("A edição foi preservada");
    const leiturasAntes = mockSincronizacao.fetchPositionsFromDb.mock.calls.length;
    const recarregar = [...container.querySelectorAll("button")].find((b) => b.textContent === "Recarregar da base");
    act(() => recarregar.click());
    await repousar();
    expect(mockSincronizacao.fetchPositionsFromDb).toHaveBeenCalledTimes(leiturasAntes);
    expect(container.querySelector('.edit-table input[type="number"]')?.value).toBe("399");
    act(() => root.unmount());
  });

  test("Gravar nova posição aguarda confirmação e só então limpa o formulário", async () => {
    const { container, root } = montar();
    await repousar();
    alterarValor(container.querySelector('input[placeholder="Entrada"]'), "360");
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Gravar").click());
    await repousar();
    expect(mockSincronizacao.savePositionsToDb).toHaveBeenCalledTimes(1);
    expect(container.querySelector('input[placeholder="Entrada"]').value).toBe("");
    expect(container.textContent).toContain("Alterações confirmadas");
    expect([...Array(localStorage.length)].map((_, i) => localStorage.key(i)).some((key) => key.startsWith("bgi-portfolio-pendencias-v1:"))).toBe(false);
    act(() => root.unmount());
  });

  test("falha no cadastro conserva formulário e jornal após remontar sem replay", async () => {
    mockSincronizacao.savePositionsToDb.mockRejectedValue(new Error("falha sintética"));
    const primeira = montar();
    await repousar();
    alterarValor(primeira.container.querySelector('input[placeholder="Entrada"]'), "360");
    act(() => [...primeira.container.querySelectorAll("button")].find((b) => b.textContent === "Gravar").click());
    await repousar();
    expect(primeira.container.querySelector('input[placeholder="Entrada"]').value).toBe("360");
    expect([...Array(localStorage.length)].map((_, i) => localStorage.key(i)).some((key) => key.startsWith("bgi-portfolio-pendencias-v1:"))).toBe(true);
    act(() => primeira.root.unmount());

    mockSincronizacao.savePositionsToDb.mockClear();
    const segunda = montar();
    await repousar();
    expect(segunda.container.textContent).toContain("edição(ões) não confirmada(s)");
    expect(mockSincronizacao.savePositionsToDb).not.toHaveBeenCalled();
    act(() => [...segunda.container.querySelectorAll("button")].find((b) => b.textContent === "Revisar edições recuperadas").click());
    await repousar();
    expect(segunda.container.textContent).toContain("Salvar edições recuperadas");
    expect(mockSincronizacao.savePositionsToDb).not.toHaveBeenCalled();
    act(() => segunda.root.unmount());
  });

  test("sem sessão o cadastro fica bloqueado e não apaga o formulário", async () => {
    mockSincronizacao.getSessionUserId.mockResolvedValue(null);
    const { container, root } = montar();
    await repousar();
    const entrada = container.querySelector('input[placeholder="Entrada"]');
    alterarValor(entrada, "360");
    const gravar = [...container.querySelectorAll("button")].find((b) => b.textContent === "Gravar");
    expect(gravar.disabled).toBe(true);
    expect(entrada.value).toBe("360");
    expect(mockSincronizacao.savePositionsToDb).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  test("armazenamento bloqueado não derruba a tela nem permite falsa gravação", async () => {
    jest.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("bloqueado", "SecurityError"); });
    const { container, root } = montar();
    await repousar();
    expect(container.textContent).toContain("Portfólio B3");
    alterarValor(container.querySelector('input[placeholder="Entrada"]'), "360");
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Gravar").click());
    await repousar();
    expect(mockSincronizacao.savePositionsToDb).not.toHaveBeenCalled();
    expect(container.textContent).toContain("cópia de segurança das edições não está disponível");
    const salvar = [...container.querySelectorAll("button")].find((b) => b.textContent === "Salvar alterações");
    act(() => salvar.click());
    await repousar();
    expect(mockSincronizacao.savePositionsToDb).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Alterações confirmadas");
    act(() => root.unmount());
  });
});
