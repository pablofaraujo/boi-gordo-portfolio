import {
  appToRow,
  extrairRateiosNegocio,
  rowToApp,
  separarPosicoesParaPersistencia,
} from "./supabaseSync";

const LEGADO = {
  id: "registro-legado",
  termo: null,
  contrato: "BGIX26",
  direcao: "vendido",
  contratos_qtd: 2,
  preco_entrada: 350,
  status: "aberta",
};

describe("identidade persistente das posições", () => {
  test("interpreta rateio escrito com espaços, hífens e cts", () => {
    expect(extrairRateiosNegocio(
      "CF-26-009 5,2 cts CF-26-010 - 8,2 cts CF-26- 011 - 10,3",
      24,
    )).toEqual([
      { codigo: "CF-26-009", cts: 5.2 },
      { codigo: "CF-26-010", cts: 8.2 },
      { codigo: "CF-26-011", cts: 10.3 },
    ]);
  });

  test("usa todos os contratos quando há somente um lote sem quantidade", () => {
    expect(extrairRateiosNegocio("CF-26-013", 4)).toEqual([
      { codigo: "CF-26-013", cts: 4 },
    ]);
  });

  test("não inventa divisão quando vários lotes estão sem quantidade", () => {
    expect(extrairRateiosNegocio("CF-26-009; CF-26-010", 24)).toEqual([]);
  });

  test("uma posição antiga conserva o ID e o termo original", () => {
    const position = rowToApp(LEGADO);
    const row = appToRow(position);

    expect(position.registroPersistidoId).toBe("registro-legado");
    expect(position.termoPersistido).toBeNull();
    expect(row.termo).toBeNull();
  });

  test("posição antiga sem termo é atualizada por ID, nunca inserida por UPSERT", () => {
    const plano = separarPosicoesParaPersistencia([rowToApp(LEGADO)]);

    expect(plano.atualizacoesPorId).toHaveLength(1);
    expect(plano.atualizacoesPorId[0].id).toBe("registro-legado");
    expect(plano.gravacoesPorTermo).toHaveLength(0);
  });

  test("posição criada pelo portfólio mantém chave estável para UPSERT", () => {
    const nova = {
      id: "nova-posicao",
      contrato: "BGIX26",
      lado: "Vendido",
      contratos: 2,
      entrada: 350,
      status: "Aberta",
    };
    const plano = separarPosicoesParaPersistencia([nova]);

    expect(plano.atualizacoesPorId).toHaveLength(0);
    expect(plano.gravacoesPorTermo).toHaveLength(1);
    expect(plano.gravacoesPorTermo[0].termo).toBe("bgp:nova-posicao");
  });

  test("repetições da mesma identidade são reduzidas a uma gravação", () => {
    const position = rowToApp(LEGADO);
    const plano = separarPosicoesParaPersistencia([position, { ...position }]);

    expect(plano.atualizacoesPorId).toHaveLength(1);
    expect(plano.gravacoesPorTermo).toHaveLength(0);
  });
});
