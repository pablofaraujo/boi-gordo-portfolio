import fs from "fs";
import path from "path";

describe("contrato de recarga das posições", () => {
  const fonte = fs.readFileSync(path.join(__dirname, "App.jsx"), "utf8");

  test("a abertura e o botão marcam a leitura antes de trocar as posições", () => {
    const trechosProtegidos = fonte.match(
      /marcarRecargaSomenteLeitura\(\);\s*setPositions\(remotePositions\)/g,
    ) || [];

    expect(trechosProtegidos).toHaveLength(2);
  });

  test("o salvamento automático consome o bloqueio antes de gravar", () => {
    const bloqueio = fonte.indexOf("consumirBloqueioDeGravacao()");
    const gravacao = fonte.indexOf("await saveDbPositions(positions)");

    expect(bloqueio).toBeGreaterThan(-1);
    expect(gravacao).toBeGreaterThan(bloqueio);
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
