import { aplicarReferenciasPersistidas } from "./referenciaBolsa";

describe("referência humana da operação de bolsa", () => {
  test("associa a referência devolvida pelo banco à posição recém-criada", () => {
    const posicoes = [{ id: "local-1", termoPersistido: null, referenciaBolsa: "" }];
    const atualizadas = aplicarReferenciasPersistidas(posicoes, [{
      id: "db-1",
      termo: "bgp:local-1",
      referencia_bolsa: "B3-26-001",
    }]);

    expect(atualizadas[0].referenciaBolsa).toBe("B3-26-001");
  });

  test("não altera a identidade quando o banco não devolve referência", () => {
    const posicoes = [{ id: "local-1", referenciaBolsa: "" }];
    expect(aplicarReferenciasPersistidas(posicoes, [{ termo: "bgp:local-1" }])).toBe(posicoes);
  });
});
