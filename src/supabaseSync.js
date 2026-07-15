// Sincronização do Portfólio BGI com o banco Confinex (Supabase).
// Substitui o sync via Google Sheets. A sessão de login é compartilhada com o
// Painel Vivo (mesma origem pablofaraujo.github.io + mesmo storage padrão).
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = "https://fkmdzwjmjlmxqotznvgq.supabase.co";
const SUPA_KEY = "sb_publishable_mNwlWLAaJOVoXpmlD7ShYg_-Nqyy0bT"; // pública (RLS protege)
const LOTE = 330;

export const db = createClient(SUPA_URL, SUPA_KEY);

export async function hasSession() {
const { data } = await db.auth.getSession();
return !!data.session;
}

function toNumber(value) {
if (value === "" || value === null || value === undefined) return 0;
const parsed = Number(String(value).replace(",", "."));
return Number.isFinite(parsed) ? parsed : 0;
}

// ---------- mapeamento formato do app <-> posicoes_hedge ----------
const MES_POR_LETRA = { F: "Janeiro", G: "Fevereiro", H: "Março", J: "Abril", K: "Maio", M: "Junho", N: "Julho", Q: "Agosto", U: "Setembro", V: "Outubro", X: "Novembro", Z: "Dezembro" };

export function mesDoContrato(contrato) {
const m = /^BGI([FGHJKMNQUVXZ])(\d{2})$/.exec(String(contrato || "").toUpperCase());
return m ? `${MES_POR_LETRA[m[1]]}/${m[2]}` : "";
}

function appToRow(p) {
// Termo não fecha por ter um valor em "saída" (não existe preço de saída
// separado num termo, é um preço fixo único) — só o status explícito decide.
const fechada = p.lado === "Termo" ? p.status === "Fechada" : (p.status === "Fechada" || (p.saida !== "" && p.saida !== null && p.saida !== undefined));
const cts = toNumber(p.contratos);
const entrada = toNumber(p.entrada);
const saida = p.saida === "" || p.saida == null ? null : toNumber(p.saida);
const corretoraTotal = toNumber(p.corretora) * cts * LOTE;
const finpecTotal = toNumber(p.finpec) * cts * LOTE;
let resultado = null;
if (fechada && saida != null) {
// Termo = preço fixado fora da B3, sem marcação a mercado: não tem
// ganho/perda contra índice, só os custos (se houver) entram no resultado.
const bruto = p.lado === "Termo" ? 0 : p.lado === "Vendido" ? (entrada - saida) * cts * LOTE : (saida - entrada) * cts * LOTE;
resultado = Math.round((bruto - corretoraTotal - finpecTotal) * 100) / 100;
}
const especulacao = /espec/i.test(String(p.negocio || ""));
return {
termo: `bgp:${p.id}`,
contrato: String(p.contrato || "").toUpperCase(),
direcao: p.lado === "Comprado" ? "comprado" : p.lado === "Termo" ? "termo" : "vendido",
categoria: especulacao ? "especulacao" : "hedge",
contratos_qtd: cts,
preco_entrada: entrada || null,
preco_saida: saida,
data_entrada: p.dataEntrada || null,
data_saida: p.dataSaida || null,
status: fechada ? "encerrada" : "aberta",
custo_corretagem: corretoraTotal || null,
custo_finpec: finpecTotal || null,
resultado_realizado: resultado,
mes: p.mes || mesDoContrato(p.contrato),
detalhes: p.detalhes || null,
negocio_rateio: p.negocio || null,
obs: null,
origem: "bgi-portfolio",
};
}

function rowToApp(r) {
const isBgp = String(r.termo || "").startsWith("bgp:");
const cts = Number(r.contratos_qtd) || 0;
const perArroba = (total) => (cts ? Math.round(((Number(total) || 0) / (cts * LOTE)) * 100) / 100 : 0);
return {
id: isBgp ? r.termo.slice(4) : `db-${r.id}`,
contrato: r.contrato,
mes: r.mes || mesDoContrato(r.contrato),
lado: r.direcao === "comprado" ? "Comprado" : r.direcao === "termo" ? "Termo" : "Vendido",
contratos: cts,
entrada: r.preco_entrada ?? "",
saida: r.preco_saida ?? "",
dataEntrada: r.data_entrada || "",
dataSaida: r.data_saida || "",
corretora: perArroba(r.custo_corretagem),
finpec: perArroba(r.custo_finpec),
status: r.status === "aberta" ? "Aberta" : "Fechada",
negocio: r.negocio_rateio || "",
detalhes: r.detalhes || (isBgp ? "" : (r.obs || "")),
};
}

// ---------- leitura ----------
export async function fetchPositionsFromDb() {
const { data, error } = await db
.from("posicoes_hedge")
.select("*")
.or("termo.like.bgp:%,and(status.in.(aberta,rolada),origem.is.null)")
.order("created_at", { ascending: true });
if (error) throw new Error(error.message);
return (data || []).map(rowToApp);
}

// ---------- gravação ----------
// IMPORTANTE: esta função é chamada em auto-save (debounced) a cada alteração
// de qualquer posição na tela. Ela só faz UPSERT (insere/atualiza) das
// posições atualmente no estado local — nunca apaga nada. Apagar por
// "ausência no array local" é perigoso: se o estado local do navegador
// estiver desatualizado (aba aberta há tempo, sincronização não concluída,
// etc.), qualquer edição de um campo dispara o auto-save e apagaria posições
// reais que só existem no banco. A exclusão de uma posição é feita de forma
// explícita e imediata por deletePositionFromDb(), chamada só quando o
// usuário clica em "Excluir".
export async function savePositionsToDb(positions) {
const rows = positions.map(appToRow);
const { data: saved, error } = await db
.from("posicoes_hedge")
.upsert(rows, { onConflict: "termo" })
.select("id, termo, status, resultado_realizado, negocio_rateio, contratos_qtd");
if (error) throw new Error(error.message);

// alocações a partir do campo "Negócio / Rateio" (ex.: "CF-26-009: 3; CF-26-010: 2")
for (const row of saved || []) {
await db.from("alocacoes_hedge").delete().eq("posicao_id", row.id);
const texto = row.negocio_rateio || "";
const matches = [...texto.matchAll(/(CF-\d{2}-\d{3})\s*:?\s*(\d+(?:[.,]\d+)?)?/gi)];
if (!matches.length) continue;
const { data: ops } = await db.from("operacoes").select("id, codigo").in("codigo", matches.map((m) => m[1].toUpperCase()));
const opPorCodigo = Object.fromEntries((ops || []).map((o) => [o.codigo, o.id]));
const partes = matches
.map((m) => ({ codigo: m[1].toUpperCase(), cts: m[2] ? toNumber(m[2]) : null }))
.filter((p) => opPorCodigo[p.codigo]);
if (!partes.length) continue;
const semQtd = partes.filter((p) => p.cts == null);
const totalDeclarado = partes.reduce((s, p) => s + (p.cts || 0), 0);
const restante = Math.max(Number(row.contratos_qtd) - totalDeclarado, 0);
semQtd.forEach((p) => { p.cts = semQtd.length ? restante / semQtd.length : 0; });
const totalFinal = partes.reduce((s, p) => s + (p.cts || 0), 0) || 1;
await db.from("alocacoes_hedge").insert(partes.map((p) => ({
posicao_id: row.id,
operacao_id: opPorCodigo[p.codigo],
contratos_qtd: p.cts || 0,
resultado_creditado: row.status === "encerrada" && row.resultado_realizado != null
? Math.round(row.resultado_realizado * ((p.cts || 0) / totalFinal) * 100) / 100
: null,
})));
}
return { ok: true };
}

// ---------- exclusão ----------
// Apaga uma única posição (e suas alocações) pelo termo, de forma explícita.
// Chamada apenas pelo botão "Excluir" — nunca inferida por diffing.
export async function deletePositionFromDb(termo) {
const { data: existing } = await db.from("posicoes_hedge").select("id").eq("termo", termo).maybeSingle();
if (!existing) return { deleted: false };
await db.from("alocacoes_hedge").delete().eq("posicao_id", existing.id);
const { error } = await db.from("posicoes_hedge").delete().eq("id", existing.id);
if (error) throw new Error(error.message);
return { deleted: true };
}

// ---------- cotações ----------
export async function saveQuotesToDb(prices, source) {
const hoje = new Date().toISOString().slice(0, 10);
const rows = Object.entries(prices)
.filter(([, preco]) => toNumber(preco) > 0)
.map(([contrato, preco]) => ({ contrato, data: hoje, preco: toNumber(preco), fonte: source === "B3" ? "b3" : "manual", referencia_fisica: false }));
if (!rows.length) return;
await db.from("cotacoes_bgi").insert(rows);
}
