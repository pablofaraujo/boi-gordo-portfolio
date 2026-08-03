const LOTE_ARROBAS = 330;

function numero(valor) {
  const convertido = Number(String(valor ?? "").replace(",", "."));
  return Number.isFinite(convertido) ? convertido : 0;
}

function ehEspeculacao(posicao) {
  return String(posicao?.categoria || "").toLowerCase() === "especulacao"
    || /espec/i.test(String(posicao?.negocio || ""));
}

export function calcularResumoCobertura(posicoesAbertas, contratosNecessarios) {
  let vendidosHedge = 0;
  let compradosHedge = 0;
  let termosHedge = 0;
  let contratosB3Brutos = 0;

  for (const posicao of posicoesAbertas || []) {
    const quantidade = Math.abs(numero(posicao?.contratos));
    if (!quantidade) continue;
    const lado = String(posicao?.lado || "").toLowerCase();
    const termo = lado === "termo";
    if (!termo) contratosB3Brutos += quantidade;
    if (ehEspeculacao(posicao)) continue;
    if (termo) termosHedge += quantidade;
    else if (lado === "comprado") compradosHedge += quantidade;
    else if (lado === "vendido") vendidosHedge += quantidade;
  }

  const coberturaLiquida = vendidosHedge + termosHedge - compradosHedge;
  const necessarios = Math.max(numero(contratosNecessarios), 0);
  const descobertos = Math.max(necessarios - coberturaLiquida, 0);
  return {
    necessarios,
    vendidosHedge,
    compradosHedge,
    termosHedge,
    coberturaLiquida,
    descobertos,
    arrobasDescobertas: descobertos * LOTE_ARROBAS,
    contratosB3Brutos,
    arrobasB3Brutas: contratosB3Brutos * LOTE_ARROBAS,
  };
}
