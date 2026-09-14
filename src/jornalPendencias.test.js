import { criarJornalPendencias, JOURNAL_KEY, prepararRecuperacao } from "./jornalPendencias";

function storageFake() {
  const dados = new Map();
  return {
    get length() { return dados.size; },
    key: (i) => [...dados.keys()][i] ?? null,
    getItem: (key) => dados.has(key) ? dados.get(key) : null,
    setItem: (key, value) => { dados.set(key, value); },
    removeItem: (key) => { dados.delete(key); },
    dados,
  };
}

function novo(storage, session, ids = ["aba", "v1", "v2"]) {
  return criarJornalPendencias({ storage, sessionStorage: session, gerarId: () => ids.shift(), agora: () => "2026-09-14T00:00:00Z" });
}

describe("jornal durável das posições", () => {
  test("particiona fisicamente por usuário, posição e aba", () => {
    const storage = storageFake(); const session = storageFake();
    novo(storage, session).registrar({ userId: "u1", posicao: { id: "p1" }, assinatura: "a", baseline: { id: "db" } });
    expect([...storage.dados.keys()][0]).toContain(`${JOURNAL_KEY}:u1:p1:aba`);
  });

  test("não expõe pendência de outro usuário", () => {
    const storage = storageFake();
    novo(storage, storageFake(), ["a", "v1"]).registrar({ userId: "u1", posicao: { id: "p" }, assinatura: "a" });
    novo(storage, storageFake(), ["b", "v2"]).registrar({ userId: "u2", posicao: { id: "q" }, assinatura: "b" });
    expect(novo(storage, storageFake(), ["c"]).listar("u1").map((x) => x.positionId)).toEqual(["p"]);
  });

  test("confirma somente a versão exata sem apagar edição posterior", () => {
    const storage = storageFake(); const session = storageFake(); const journal = novo(storage, session);
    const antiga = journal.registrar({ userId: "u", posicao: { id: "p", entrada: 1 }, assinatura: "a" });
    journal.registrar({ userId: "u", posicao: { id: "p", entrada: 2 }, assinatura: "b" });
    journal.confirmarExatas({ userId: "u", confirmadas: [antiga] });
    expect(journal.listar("u")).toHaveLength(1);
    expect(journal.listar("u")[0].assinatura).toBe("b");
  });

  test("preserva baseline original ao atualizar a mesma pendência", () => {
    const storage = storageFake(); const journal = novo(storage, storageFake());
    journal.registrar({ userId: "u", posicao: { id: "p", entrada: 2 }, assinatura: "a", baseline: { entrada: 1 } });
    journal.registrar({ userId: "u", posicao: { id: "p", entrada: 3 }, assinatura: "b", baseline: { entrada: 2 } });
    expect(journal.listar("u")[0].baseline).toEqual({ entrada: 1 });
  });

  test("duas abas na mesma posição não são fundidas silenciosamente", () => {
    const storage = storageFake();
    novo(storage, storageFake(), ["a", "v1"]).registrar({ userId: "u", posicao: { id: "p", entrada: 2 }, assinatura: "a" });
    novo(storage, storageFake(), ["b", "v2"]).registrar({ userId: "u", posicao: { id: "p", entrada: 3 }, assinatura: "b" });
    const entries = novo(storage, storageFake(), ["c"]).listar("u");
    expect(prepararRecuperacao([{ id: "p", entrada: 1 }], entries)).toMatchObject({ conflitos: 1, aplicadas: [] });
  });

  test("quota e corrupção falham sem remover bytes existentes", () => {
    const storage = storageFake(); storage.setItem(`${JOURNAL_KEY}:u:p:a`, "invalido");
    expect(() => novo(storage, storageFake(), ["a"]).listar("u")).toThrow(/corrompid/);
    const cheio = storageFake(); cheio.setItem = () => { throw new Error("quota"); };
    expect(() => novo(cheio, storageFake(), ["a", "v"]).registrar({ userId: "u", posicao: { id: "p" }, assinatura: "x" })).toThrow(/Libere espaço/);
  });

  test("JSON com vínculo divergente da chave falha fechado", () => {
    const storage = storageFake();
    storage.setItem(`${JOURNAL_KEY}:u:p:a`, JSON.stringify({ schema: 1, entrada: {
      userId: "outro", positionId: "p", writerId: "a", versionId: "v", assinatura: "s",
      criadoEm: "t", atualizadoEm: "t", baseline: null, posicao: { id: "p" },
    } }));
    expect(() => novo(storage, storageFake(), ["nova"]).listar("u")).toThrow(/inconsistente/);
  });

  test("falha ao limpar não anuncia confirmação nem apaga a entrada", () => {
    const storage = storageFake(); const journal = novo(storage, storageFake(), ["aba", "versao"]);
    const entrada = journal.registrar({ userId: "u", posicao: { id: "p" }, assinatura: "a" });
    storage.removeItem = () => { throw new DOMException("bloqueado", "SecurityError"); };
    expect(() => journal.confirmarExatas({ userId: "u", confirmadas: [entrada] })).toThrow(/não foi possível limpar/);
    expect(journal.listar("u")).toHaveLength(1);
  });
});
