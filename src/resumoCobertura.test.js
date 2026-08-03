import { calcularResumoCobertura } from "./resumoCobertura";

describe("resumo de cobertura BGI", () => {
  test("usa as posições abertas deduplicadas em vez da soma repetida da view", () => {
    const resumo = calcularResumoCobertura([
      { lado: "Vendido", contratos: 23.7, categoria: "hedge" },
      { lado: "Vendido", contratos: 4, categoria: "hedge" },
      { lado: "Vendido", contratos: 6, categoria: "hedge" },
    ], 35.47);

    expect(resumo.coberturaLiquida).toBeCloseTo(33.7);
    expect(resumo.descobertos).toBeCloseTo(1.77);
    expect(resumo.arrobasDescobertas).toBeCloseTo(584.1);
    expect(resumo.contratosB3Brutos).toBeCloseTo(33.7);
  });

  test("compra de hedge reduz a cobertura e especulação não cobre lote", () => {
    const resumo = calcularResumoCobertura([
      { lado: "Vendido", contratos: 10, categoria: "hedge" },
      { lado: "Comprado", contratos: 2, categoria: "hedge" },
      { lado: "Vendido", contratos: 5, categoria: "especulacao" },
    ], 12);

    expect(resumo.coberturaLiquida).toBe(8);
    expect(resumo.descobertos).toBe(4);
    expect(resumo.contratosB3Brutos).toBe(17);
  });

  test("termo de hedge cobre exposição sem virar posição aberta B3", () => {
    const resumo = calcularResumoCobertura([
      { lado: "Termo", contratos: 2.4, categoria: "hedge" },
      { lado: "Vendido", contratos: 3, categoria: "hedge" },
    ], 6);

    expect(resumo.coberturaLiquida).toBeCloseTo(5.4);
    expect(resumo.descobertos).toBeCloseTo(0.6);
    expect(resumo.contratosB3Brutos).toBe(3);
  });
});
