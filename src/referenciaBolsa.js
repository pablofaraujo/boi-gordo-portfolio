export function aplicarReferenciasPersistidas(posicoes, registrosSalvos) {
  const porId = new Map();
  const porTermo = new Map();

  (registrosSalvos || []).forEach((registro) => {
    const referencia = String(registro?.referencia_bolsa || "").trim();
    if (!referencia) return;
    if (registro.id) porId.set(String(registro.id), referencia);
    if (registro.termo) porTermo.set(String(registro.termo), referencia);
  });

  let alterou = false;
  const resultado = (posicoes || []).map((posicao) => {
    const referencia = (
      (posicao.registroPersistidoId && porId.get(String(posicao.registroPersistidoId)))
      || porTermo.get(String(posicao.termoPersistido || `bgp:${posicao.id}`))
      || ""
    );
    if (!referencia || referencia === posicao.referenciaBolsa) return posicao;
    alterou = true;
    return { ...posicao, referenciaBolsa: referencia };
  });

  return alterou ? resultado : posicoes;
}
