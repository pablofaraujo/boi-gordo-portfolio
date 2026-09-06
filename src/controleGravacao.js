// Uma única fila atende o salvamento automático e o botão Salvar.
// A base confirmada é separada da edição: respostas antigas nunca restauram
// campos de negócio, e só a versão efetivamente enviada recebe confirmação.
export function mesclarIdentidadeConfirmada(posicoes, registros) {
  return posicoes.map((posicao) => {
    const registro = (registros || []).find((item) =>
      (posicao.registroPersistidoId && item.id === posicao.registroPersistidoId)
      || (item.termo && item.termo === (posicao.termoPersistido || `bgp:${posicao.id}`)));
    if (!registro) return posicao;
    return {
      ...posicao,
      registroPersistidoId: registro.id,
      termoPersistido: registro.termo ?? null,
      referenciaBolsa: registro.referencia_bolsa || posicao.referenciaBolsa || "",
      origem: registro.origem ?? null,
      registroOriginal: registro,
    };
  });
}

export function criarControleGravacao({ gravar, assinatura, aoConfirmar = () => {} }) {
  let atuais = [];
  let confirmadas = new Map();
  let emCurso = null;
  let carregado = false;
  const alteradas = () => atuais.filter((posicao) =>
    !confirmadas.has(posicao.id) || assinatura(posicao) !== assinatura(confirmadas.get(posicao.id)));

  const controle = {
    carregar(posicoes, { descartarEdicao = false } = {}) {
      if (emCurso || (carregado && alteradas().length && !descartarEdicao)) {
        throw new Error("Há alterações ainda não confirmadas. Salve antes de recarregar.");
      }
      atuais = posicoes;
      confirmadas = new Map(posicoes.map((posicao) => [posicao.id, posicao]));
      carregado = true;
    },
    atualizar(posicoes) {
      if (!carregado) throw new Error("Aguarde a leitura da base antes de editar.");
      atuais = posicoes;
    },
    posicoes: () => atuais,
    temPendencias: () => Boolean(emCurso || alteradas().length),
    salvar() {
      if (emCurso) return emCurso;
      if (!carregado) return Promise.reject(new Error("A base ainda não foi carregada."));
      emCurso = (async () => {
        // Atribui emCurso antes da primeira confirmação, mesmo com mock síncrono.
        await Promise.resolve();
        while (alteradas().length) {
          const enviadas = alteradas();
          const resultado = await gravar(enviadas);
          const confirmacao = mesclarIdentidadeConfirmada(enviadas, resultado?.registros);
          if (!resultado?.ok || confirmacao.some((posicao, i) => posicao === enviadas[i])) {
            throw new Error("A base não confirmou todas as alterações. A edição foi preservada.");
          }
          confirmacao.forEach((posicao) => confirmadas.set(posicao.id, posicao));
          atuais = mesclarIdentidadeConfirmada(atuais, resultado.registros);
          aoConfirmar(atuais);
        }
      })().finally(() => { emCurso = null; });
      return emCurso;
    },
  };
  return controle;
}
