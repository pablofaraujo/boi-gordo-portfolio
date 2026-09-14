export const JOURNAL_KEY = "bgi-portfolio-pendencias-v1";
const SCHEMA = 1;

function texto(value, nome) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Jornal inválido: ${nome} ausente.`);
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function chave(userId, positionId, writerId) {
  return `${JOURNAL_KEY}:${encodeURIComponent(userId)}:${encodeURIComponent(positionId)}:${encodeURIComponent(writerId)}`;
}

function gravarEntrada(storage, key, entrada) {
  try { storage.setItem(key, JSON.stringify({ schema: SCHEMA, entrada })); }
  catch { throw new Error("Não foi possível guardar a edição neste navegador. Libere espaço e tente novamente."); }
}

function lerEntrada(storage, key) {
  let doc;
  try { doc = JSON.parse(storage.getItem(key)); } catch { throw new Error("A cópia de segurança das edições está corrompida. Nenhuma edição foi descartada."); }
  const entrada = doc?.entrada;
  const posicaoValida = entrada?.posicao && typeof entrada.posicao === "object" && !Array.isArray(entrada.posicao)
    && String(entrada.posicao.id || "") === entrada?.positionId;
  const baselineValido = entrada?.baseline === null
    || (entrada?.baseline && typeof entrada.baseline === "object" && !Array.isArray(entrada.baseline));
  if (doc?.schema !== SCHEMA || !entrada
    || ![entrada.userId, entrada.positionId, entrada.writerId, entrada.versionId, entrada.assinatura, entrada.criadoEm, entrada.atualizadoEm].every((item) => typeof item === "string" && item)
    || !posicaoValida || !baselineValido) {
    throw new Error("A cópia de segurança das edições tem formato desconhecido. Nenhuma edição foi descartada.");
  }
  return entrada;
}

function chavesDoUsuario(storage, userId) {
  const prefixo = `${JOURNAL_KEY}:${encodeURIComponent(userId)}:`;
  const keys = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(prefixo)) keys.push(key);
    }
  } catch { throw new Error("Não foi possível consultar as edições guardadas. Nenhuma edição foi descartada."); }
  return keys;
}

export function criarJornalPendencias({ storage, sessionStorage, gerarId, agora = () => new Date().toISOString() }) {
  if (!storage || !sessionStorage || typeof gerarId !== "function") throw new Error("Armazenamento do jornal indisponível.");
  // Um identificador novo por instância evita que “Duplicar aba”, que pode
  // clonar sessionStorage, faça duas páginas sobrescreverem a mesma entrada.
  const writerId = texto(gerarId(), "identificador da aba");
  return {
    registrar({ userId, posicao, assinatura, baseline = null }) {
      texto(userId, "usuário");
      texto(String(posicao?.id || ""), "posição");
      texto(assinatura, "assinatura");
      const storageKey = chave(userId, String(posicao.id), writerId);
      const anterior = storage.getItem(storageKey) ? lerEntrada(storage, storageKey) : null;
      const entrada = {
        userId,
        positionId: String(posicao.id),
        writerId,
        versionId: texto(gerarId(), "versão"),
        assinatura,
        criadoEm: anterior?.criadoEm || agora(),
        atualizadoEm: agora(),
        baseline: clone(anterior?.baseline ?? baseline),
        posicao: clone(posicao),
      };
      gravarEntrada(storage, storageKey, entrada);
      return clone(entrada);
    },
    listar(userId) {
      texto(userId, "usuário");
      return chavesDoUsuario(storage, userId).map((key) => {
        const entrada = lerEntrada(storage, key);
        if (entrada.userId !== userId || chave(entrada.userId, entrada.positionId, entrada.writerId) !== key) {
          throw new Error("A cópia de segurança das edições está inconsistente. Nenhuma edição foi descartada.");
        }
        return clone(entrada);
      });
    },
    confirmarExatas({ userId, confirmadas }) {
      texto(userId, "usuário");
      (confirmadas || []).forEach((esperada) => {
        const storageKey = chave(userId, esperada.positionId, esperada.writerId);
        const raw = storage.getItem(storageKey);
        if (!raw) return;
        const atual = lerEntrada(storage, storageKey);
        if (atual.versionId === esperada.versionId && atual.assinatura === esperada.assinatura) {
          try {
            storage.removeItem(storageKey);
            if (storage.getItem(storageKey) !== null) throw new Error("remoção não confirmada");
          } catch {
            throw new Error("A confirmação chegou à base, mas não foi possível limpar a edição guardada. Ela continuará disponível para conferência.");
          }
        }
      });
    },
  };
}

export function prepararRecuperacao(posicoesRemotas, entradas) {
  const porPosicao = new Map();
  (entradas || []).forEach((entrada) => {
    const lista = porPosicao.get(entrada.positionId) || [];
    lista.push(entrada); porPosicao.set(entrada.positionId, lista);
  });
  const conflitos = [...porPosicao.values()].filter((lista) => new Set(lista.map((item) => item.writerId)).size > 1);
  if (conflitos.length) return { posicoes: posicoesRemotas, conflitos: conflitos.length, aplicadas: [] };
  const aplicadas = [...porPosicao.values()].map(([entrada]) => entrada);
  const ids = new Set(aplicadas.map((item) => item.positionId));
  const termos = new Set(aplicadas.map((item) => item.posicao?.termoPersistido || `bgp:${item.positionId}`));
  const mantidas = posicoesRemotas.filter((posicao) => !ids.has(String(posicao.id))
    && !termos.has(posicao.termoPersistido || `bgp:${posicao.id}`));
  return { posicoes: [...mantidas, ...aplicadas.map((item) => ({
    ...clone(item.posicao),
    ...(item.baseline ? { registroOriginal: clone(item.baseline) } : {}),
  }))], conflitos: 0, aplicadas: clone(aplicadas) };
}
