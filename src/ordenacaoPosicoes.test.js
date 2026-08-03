import { chaveVencimentoContrato, ordenarPosicoesPorVencimento } from "./ordenacaoPosicoes";

describe("ordenação das posições abertas", () => {
  test("coloca os vencimentos do mais próximo para o mais distante", () => {
    const posicoes = [
      { id: "nov", contrato: "BGIX26" },
      { id: "ago", contrato: "BGIQ26" },
      { id: "out", contrato: "BGIV26" },
      { id: "set", contrato: "BGIU26" },
    ];

    expect(ordenarPosicoesPorVencimento(posicoes).map((posicao) => posicao.id)).toEqual([
      "ago",
      "set",
      "out",
      "nov",
    ]);
  });

  test("respeita a virada do ano", () => {
    const posicoes = [
      { id: "jan", contrato: "BGIF27" },
      { id: "dez", contrato: "BGIZ26" },
    ];

    expect(ordenarPosicoesPorVencimento(posicoes).map((posicao) => posicao.id)).toEqual(["dez", "jan"]);
  });

  test("mantém contratos desconhecidos no fim e preserva empates", () => {
    const posicoes = [
      { id: "desconhecido", contrato: "OUTRO" },
      { id: "primeiro", contrato: "BGIV26" },
      { id: "segundo", contrato: "BGIV26" },
    ];

    expect(ordenarPosicoesPorVencimento(posicoes).map((posicao) => posicao.id)).toEqual([
      "primeiro",
      "segundo",
      "desconhecido",
    ]);
    expect(chaveVencimentoContrato("OUTRO")).toBe(Number.POSITIVE_INFINITY);
  });
});
