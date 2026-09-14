import { criarControleGravacao } from "./controleGravacao";

const abertas = ["a", "b", "c"].map((id) => ({ id, status: "Aberta", saida: "", detalhes: "" }));
const assinatura = ({ status, saida, detalhes }) => JSON.stringify({ status, saida, detalhes });
const confirmar = (posicoes) => ({ ok: true, registros: posicoes.map((p) => ({
  id: `db-${p.id}`, termo: `bgp:${p.id}`, status: p.status, preco_saida: p.saida,
  referencia_bolsa: `B3-teste-${p.id}`,
})) });
const adiar = () => {
  let resolve;
  let reject;
  const promise = new Promise((ok, falha) => { resolve = ok; reject = falha; });
  return { promise, resolve, reject };
};

describe("fila serial e confirmação das posições", () => {
  test("abrir ou recarregar a base, inclusive vazia, não grava", async () => {
    const gravar = jest.fn();
    const fila = criarControleGravacao({ gravar, assinatura });
    fila.carregar(abertas);
    await fila.salvar();
    fila.carregar([]);
    await fila.salvar();
    expect(gravar).not.toHaveBeenCalled();
  });

  test("somente a posição editada é enviada, sem reabrir outras da aba antiga", async () => {
    const gravar = jest.fn(async (posicoes) => confirmar(posicoes));
    const fila = criarControleGravacao({ gravar, assinatura });
    fila.carregar(abertas);
    fila.atualizar(abertas.map((p) => p.id === "b" ? { ...p, detalhes: "conferido" } : p));
    await fila.salvar();
    expect(gravar.mock.calls[0][0].map((p) => p.id)).toEqual(["b"]);
    expect(fila.temPendencias()).toBe(false);
  });

  test("resposta antiga não reabre fechamento posterior, nem confirma a versão errada", async () => {
    const primeira = adiar();
    const gravar = jest.fn().mockReturnValueOnce(primeira.promise).mockImplementation(async (p) => confirmar(p));
    const fila = criarControleGravacao({ gravar, assinatura });
    fila.carregar(abertas);
    fila.atualizar(abertas.map((p) => p.id === "a" ? { ...p, detalhes: "primeira edição" } : p));
    const salvamento = fila.salvar();
    await Promise.resolve();
    fila.atualizar(fila.posicoes().map((p) => p.id === "a" ? { ...p, status: "Fechada", saida: 345 } : p));
    expect(fila.salvar()).toBe(salvamento);
    expect(gravar).toHaveBeenCalledTimes(1);
    primeira.resolve(confirmar(gravar.mock.calls[0][0]));
    await salvamento;
    expect(gravar).toHaveBeenCalledTimes(2);
    expect(gravar.mock.calls[1][0][0]).toMatchObject({ status: "Fechada", saida: 345, registroPersistidoId: "db-a" });
    expect(fila.posicoes()[0]).toMatchObject({ status: "Fechada", saida: 345 });
    expect(fila.temPendencias()).toBe(false);
  });

  test("três encerramentos aguardam a confirmação sem gravações paralelas", async () => {
    const primeira = adiar();
    const gravar = jest.fn().mockReturnValueOnce(primeira.promise).mockImplementation(async (p) => confirmar(p));
    const fila = criarControleGravacao({ gravar, assinatura });
    fila.carregar(abertas);
    fila.atualizar(abertas.map((p) => p.id === "a" ? { ...p, status: "Fechada", saida: 345 } : p));
    const salvamento = fila.salvar();
    await Promise.resolve();
    fila.atualizar(fila.posicoes().map((p) => ({ ...p, status: "Fechada", saida: 345 })));
    primeira.resolve(confirmar(gravar.mock.calls[0][0]));
    await salvamento;
    expect(gravar.mock.calls.map(([p]) => p.map((item) => item.id))).toEqual([["a"], ["b", "c"]]);
    expect(fila.posicoes().every((p) => p.status === "Fechada")).toBe(true);
  });

  test("sem retorno confirmado, não anuncia sucesso e mantém edição para nova tentativa", async () => {
    const gravar = jest.fn().mockResolvedValueOnce({ ok: true, registros: [] }).mockImplementation(async (p) => confirmar(p));
    const fila = criarControleGravacao({ gravar, assinatura });
    fila.carregar(abertas);
    fila.atualizar(abertas.map((p) => ({ ...p, status: "Fechada", saida: 345 })));
    await expect(fila.salvar()).rejects.toThrow("não confirmou todas");
    expect(fila.temPendencias()).toBe(true);
    expect(() => fila.carregar(abertas)).toThrow("Salve antes");
    await fila.salvar();
    expect(fila.temPendencias()).toBe(false);
  });

  test("falha de rede não executa retry cego e preserva a edição", async () => {
    const gravar = jest.fn().mockRejectedValue(new Error("rede indisponível"));
    const fila = criarControleGravacao({ gravar, assinatura });
    fila.carregar(abertas);
    fila.atualizar(abertas.map((p) => ({ ...p, saida: 345, status: "Fechada" })));
    await expect(fila.salvar()).rejects.toThrow("rede indisponível");
    expect(gravar).toHaveBeenCalledTimes(1);
    expect(fila.temPendencias()).toBe(true);
  });

  test("descarte confirmado limpa marca de recuperação e não envia snapshot remoto", async () => {
    const gravar = jest.fn(async (posicoes) => confirmar(posicoes));
    const fila = criarControleGravacao({ gravar, assinatura });
    fila.carregar(abertas);
    fila.forcarPendencias(["a"]);
    expect(fila.temPendencias()).toBe(true);
    fila.carregar(abertas, { descartarEdicao: true });
    expect(fila.temPendencias()).toBe(false);
    await fila.salvar();
    expect(gravar).not.toHaveBeenCalled();
  });
});
