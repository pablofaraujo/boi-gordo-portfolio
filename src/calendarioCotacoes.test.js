import { cotacaoEncerrada, montarCalendarioCotacoes } from "./calendarioCotacoes";

describe("calendário anual de cotações BGI", () => {
  test("alinha janeiro a dezembro de dois anos completos", () => {
    const calendario = montarCalendarioCotacoes(2026);

    expect(calendario).toHaveLength(24);
    expect(calendario[0]).toMatchObject({ contrato: "BGIF26", periodo: "Jan/26" });
    expect(calendario[11]).toMatchObject({ contrato: "BGIZ26", periodo: "Dez/26" });
    expect(calendario[12]).toMatchObject({ contrato: "BGIF27", periodo: "Jan/27" });
    expect(calendario[23]).toMatchObject({ contrato: "BGIZ27", periodo: "Dez/27" });
  });

  test("diferencia somente os meses já encerrados", () => {
    const calendario = montarCalendarioCotacoes(2026);
    const referencia = new Date(2026, 7, 3);

    expect(calendario.slice(0, 7).every((item) => cotacaoEncerrada(item, referencia))).toBe(true);
    expect(cotacaoEncerrada(calendario[7], referencia)).toBe(false);
    expect(cotacaoEncerrada(calendario[11], referencia)).toBe(false);
  });
});
