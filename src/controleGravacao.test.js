import { criarControleGravacao } from "./controleGravacao";

describe("controle de gravação das posições", () => {
  test("alterações feitas pelo usuário continuam liberadas para salvar", () => {
    const controle = criarControleGravacao();

    expect(controle.consumirBloqueioDeGravacao()).toBe(false);
  });

  test("uma recarga da base bloqueia exatamente o próximo salvamento automático", () => {
    const controle = criarControleGravacao();

    controle.marcarRecargaSomenteLeitura();

    expect(controle.consumirBloqueioDeGravacao()).toBe(true);
    expect(controle.consumirBloqueioDeGravacao()).toBe(false);
  });

  test("recargas sucessivas não liberam uma gravação involuntária", () => {
    const controle = criarControleGravacao();

    controle.marcarRecargaSomenteLeitura();
    controle.marcarRecargaSomenteLeitura();

    expect(controle.consumirBloqueioDeGravacao()).toBe(true);
    expect(controle.consumirBloqueioDeGravacao()).toBe(false);
  });
});
