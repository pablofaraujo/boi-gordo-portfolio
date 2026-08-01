export function criarControleGravacao() {
  let recargaSomenteLeituraPendente = false;

  return {
    marcarRecargaSomenteLeitura() {
      recargaSomenteLeituraPendente = true;
    },

    consumirBloqueioDeGravacao() {
      if (!recargaSomenteLeituraPendente) return false;
      recargaSomenteLeituraPendente = false;
      return true;
    },
  };
}
