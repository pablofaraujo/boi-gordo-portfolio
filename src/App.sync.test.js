import fs from "fs";
import path from "path";

describe("contrato de recarga das posições", () => {
  const fonte = fs.readFileSync(path.join(__dirname, "App.jsx"), "utf8");

  test("a abertura e o botão registram a base confirmada antes de trocar as posições", () => {
    const trechosProtegidos = fonte.match(
      /carregar\(remotePositions(?:, \{ descartarEdicao \})?\);\s*positionsRef.current = remotePositions;\s*setPositions\(remotePositions\)/g,
    ) || [];

    expect(trechosProtegidos).toHaveLength(2);
  });

  test("salvamentos usam a fila e nunca enviam o array inteiro nem semeiam a base vazia", () => {
    expect(fonte).toContain("await controleGravacaoRef.current.salvar()");
    expect(fonte).not.toContain("await saveDbPositions(positions)");
    expect(fonte).not.toContain("Base inicial salva");
  });

  test("a interface descreve a ação como recarga da base", () => {
    expect(fonte).toContain("Recarregar da base");
    expect(fonte).not.toContain("Sincronizar posições");
    expect(fonte).not.toContain("refreshPositionsFromSheets");
  });

  test("a atualização preserva fechamentos antigos e grava somente os contratos consultados", () => {
    expect(fonte).toContain("prices: { ...previousPrices, ...updatedPrices }");
    expect(fonte).toContain("await saveQuotesToDb(updatedPrices, normalized.source)");
    expect(fonte).not.toContain("await saveQuotesToDb(normalized.prices, normalized.source)");
  });
});
