const CODIGOS_POR_MES = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"];
const NOMES_POR_MES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// Preços de fechamento oficiais publicados no Boletim Diário do Mercado da
// B3 na data de vencimento de cada contrato. Estes valores históricos são
// imutáveis e servem apenas para exibir os meses já encerrados no calendário;
// não substituem a marcação a mercado das posições em aberto nem são gravados
// automaticamente no Supabase.
// Fonte: https://arquivos.b3.com.br/bdi/download/bdi/AAAA-MM-DD/BDI_03-4_AAAAMMDD.pdf
export const FECHAMENTOS_OFICIAIS_BGI_2026 = Object.freeze({
  BGIF26: 325.40, // 30/01/2026
  BGIG26: 350.65, // 27/02/2026
  BGIH26: 355.50, // 31/03/2026
  BGIJ26: 356.25, // 30/04/2026
  BGIK26: 348.10, // 29/05/2026
  BGIM26: 337.25, // 30/06/2026
  BGIN26: 346.15, // 31/07/2026
});

export function montarCalendarioCotacoes(anoInicial, quantidadeAnos = 2) {
  return Array.from({ length: quantidadeAnos * 12 }, (_, indice) => {
    const ano = anoInicial + Math.floor(indice / 12);
    const mes = indice % 12;
    const anoCurto = String(ano % 100).padStart(2, "0");
    return {
      ano,
      mes,
      contrato: `BGI${CODIGOS_POR_MES[mes]}${anoCurto}`,
      periodo: `${NOMES_POR_MES[mes]}/${anoCurto}`,
    };
  });
}

export function cotacaoEncerrada(item, referencia = new Date()) {
  if (!item || !Number.isInteger(item.ano) || !Number.isInteger(item.mes)) return false;
  return item.ano < referencia.getFullYear()
    || (item.ano === referencia.getFullYear() && item.mes < referencia.getMonth());
}

export function precoCotacaoCalendario(contrato, cotacoes = {}) {
  const fechamentoOficial = FECHAMENTOS_OFICIAIS_BGI_2026[contrato];
  if (fechamentoOficial) return fechamentoOficial;
  const cotacaoSalva = Number(cotacoes?.[contrato]);
  if (Number.isFinite(cotacaoSalva) && cotacaoSalva > 0) return cotacaoSalva;
  return null;
}
