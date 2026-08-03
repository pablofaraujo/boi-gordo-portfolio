const MESES_BGI = {
  F: 1,
  G: 2,
  H: 3,
  J: 4,
  K: 5,
  M: 6,
  N: 7,
  Q: 8,
  U: 9,
  V: 10,
  X: 11,
  Z: 12,
};

export function chaveVencimentoContrato(contrato) {
  const encontrado = /^BGI([FGHJKMNQUVXZ])(\d{2})$/.exec(String(contrato || "").trim().toUpperCase());
  if (!encontrado) return Number.POSITIVE_INFINITY;

  const ano = 2000 + Number(encontrado[2]);
  return ano * 100 + MESES_BGI[encontrado[1]];
}

export function ordenarPosicoesPorVencimento(posicoes) {
  return posicoes
    .map((posicao, indiceOriginal) => ({ posicao, indiceOriginal }))
    .sort((a, b) => {
      const diferenca = chaveVencimentoContrato(a.posicao.contrato) - chaveVencimentoContrato(b.posicao.contrato);
      return Number.isNaN(diferenca) || diferenca === 0 ? a.indiceOriginal - b.indiceOriginal : diferenca;
    })
    .map(({ posicao }) => posicao);
}
