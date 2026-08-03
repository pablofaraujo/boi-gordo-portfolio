const CODIGOS_POR_MES = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"];
const NOMES_POR_MES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

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
