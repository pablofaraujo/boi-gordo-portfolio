import {
  cotacaoEncerrada,
  FECHAMENTOS_OFICIAIS_BGI_2026,
  montarCalendarioCotacoes,
  precoCotacaoCalendario,
} from "./calendarioCotacoes";

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

  test("preserva os fechamentos oficiais de janeiro a julho de 2026", () => {
    expect(FECHAMENTOS_OFICIAIS_BGI_2026).toEqual({
      BGIF26: 325.40,
      BGIG26: 350.65,
      BGIH26: 355.50,
      BGIJ26: 356.25,
      BGIK26: 348.10,
      BGIM26: 337.25,
      BGIN26: 346.15,
    });
  });

  test("preserva o fechamento oficial e usa a cotação salva nos demais meses", () => {
    expect(precoCotacaoCalendario("BGIF26", {})).toBe(325.40);
    expect(precoCotacaoCalendario("BGIF26", { BGIF26: 326.75 })).toBe(325.40);
    expect(precoCotacaoCalendario("BGIQ26", { BGIQ26: 342 })).toBe(342);
    expect(precoCotacaoCalendario("BGIQ26", {})).toBeNull();
    expect(precoCotacaoCalendario("BGIF26", { BGIF26: 0 })).toBe(325.40);
  });
});
