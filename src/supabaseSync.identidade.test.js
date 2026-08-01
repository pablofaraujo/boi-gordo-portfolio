import {
  appToRow,
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
