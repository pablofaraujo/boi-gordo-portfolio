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

function codigoLote(texto) {
const partes = String(texto || "").match(/CF\s*-\s*(\d{2})\s*-\s*(\d{3})/i);
return partes ? `CF-${partes[1]}-${partes[2]}` : "";
}

export function extrairRateiosNegocio(texto, contratosTotal) {
const fonte = String(texto || "");
const regex = /(CF\s*-\s*\d{2}\s*-\s*\d{3})([\s\S]*?)(?=CF\s*-\s*\d{2}\s*-\s*\d{3}|$)/gi;
const rateios = [];
let trecho;

while ((trecho = regex.exec(fonte)) !== null) {
const quantidade = trecho[2].match(/^\s*(?::|[-–—])?\s*(\d+(?:[.,]\d+)?)\s*(?:cts?|contratos?)?\b/i);
rateios.push({
codigo: codigoLote(trecho[1]),
cts: quantidade ? toNumber(quantidade[1]) : null,
});
}

if (rateios.length === 1 && rateios[0].cts === null) {
rateios[0].cts = toNumber(contratosTotal);
}

return rateios.filter((item) => item.codigo && item.cts !== null && item.cts >= 0);
}

// ---------- mapeamento formato do app <-> posicoes_hedge ----------
const MES_POR_LETRA = { F: "Janeiro", G: "Fevereiro", H: "Março", J: "Abril", K: "Maio", M: "Junho", N: "Julho", Q: "Agosto", U: "Setembro", V: "Outubro", X: "Novembro", Z: "Dezembro" };

export function mesDoContrato(contrato) {
const m = /^BGI([FGHJKMNQUVXZ])(\d{2})$/.exec(String(contrato || "").toUpperCase());
return m ? `${MES_POR_LETRA[m[1]]}/${m[2]}` : "";
}

export function appToRow(p) {
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
termo: Object.prototype.hasOwnProperty.call(p, "termoPersistido")
? p.termoPersistido
: `bgp:${p.id}`,
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

export function rowToApp(r) {
const isBgp = String(r.termo || "").startsWith("bgp:");
const cts = Number(r.contratos_qtd) || 0;
const perArroba = (total) => (cts ? Math.round(((Number(total) || 0) / (cts * LOTE)) * 100) / 100 : 0);
return {
id: isBgp ? r.termo.slice(4) : `db-${r.id}`,
registroPersistidoId: r.id || null,
termoPersistido: r.termo ?? null,
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

export function separarPosicoesParaPersistencia(positions) {
const atualizacoesPorId = new Map();
const gravacoesPorTermo = new Map();

positions.forEach((position) => {
const row = appToRow(position);
if (position.registroPersistidoId && !row.termo) {
atualizacoesPorId.set(position.registroPersistidoId, {
id: position.registroPersistidoId,
row,
});
return;
}
gravacoesPorTermo.set(row.termo, row);
});

return {
atualizacoesPorId: [...atualizacoesPorId.values()],
gravacoesPorTermo: [...gravacoesPorTermo.values()],
};
}

function chavePosicaoOperacional(r) {
return [
String(r.contrato || "").toUpperCase(),
String(r.direcao || "").toLowerCase(),
toNumber(r.contratos_qtd),
toNumber(r.preco_entrada),
String(r.status || "").toLowerCase(),
].join("|");
}

function deduplicarPosicoesLidas(rows) {
// Durante a migração, a mesma posição pode existir como registro legado
// do Confinex e como registro gerenciado pelo portfólio (termo "bgp:").
// Quando os dados operacionais coincidem, o registro bgp é a fonte editável
// e deve aparecer uma única vez. Registros distintos do mesmo contrato são
// preservados porque quantidade, entrada, direção ou status diferem.
const gerenciadas = rows.filter((row) => String(row.termo || "").startsWith("bgp:"));
const chavesGerenciadas = new Set(gerenciadas.map(chavePosicaoOperacional));
return rows.filter((row) => (
String(row.termo || "").startsWith("bgp:")
|| !chavesGerenciadas.has(chavePosicaoOperacional(row))
));
}

// ---------- leitura ----------
export async function fetchPositionsFromDb() {
const { data, error } = await db
.from("posicoes_hedge")
.select("*")
.or("termo.like.bgp:%,and(status.in.(aberta,rolada),origem.is.null)")
.order("created_at", { ascending: true });
if (error) throw new Error(error.message);
return deduplicarPosicoesLidas(data || []).map(rowToApp);
}

export async function fetchLatestQuotesFromDb() {
const { data, error } = await db
.from("cotacoes_bgi")
.select("contrato, data, hora, preco, fonte, created_at")
.eq("referencia_fisica", false)
.order("data", { ascending: false })
.order("created_at", { ascending: false })
.limit(200);
if (error) throw new Error(error.message);

const prices = {};
let updatedAt = "";
let source = "Base Confinex";
for (const row of data || []) {
const contrato = String(row.contrato || "").toUpperCase();
if (!contrato || prices[contrato] || toNumber(row.preco) <= 0) continue;
prices[contrato] = toNumber(row.preco);
if (!updatedAt) {
updatedAt = row.created_at || `${row.data}T${row.hora || "00:00:00"}`;
source = row.fonte || source;
}
}
return { prices, updatedAt, source };
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
// O estado local pode conter a mesma posição duas vezes após importar ou
// recuperar uma aba antiga. O Postgres rejeita chaves repetidas dentro do
// mesmo UPSERT; a versão mais recente da posição deve prevalecer.
const { atualizacoesPorId, gravacoesPorTermo } = separarPosicoesParaPersistencia(positions);
const saved = [];

if (gravacoesPorTermo.length) {
const { data, error } = await db
.from("posicoes_hedge")
.upsert(gravacoesPorTermo, { onConflict: "termo" })
.select("id, termo, status, resultado_realizado, negocio_rateio, contratos_qtd");
if (error) throw new Error(error.message);
saved.push(...(data || []));
}

// Registros antigos sem termo não podem passar por UPSERT: NULL não entra no
// conflito único e produziria uma nova linha. A identidade original do banco
// é preservada e a alteração ocorre pelo ID já existente.
for (const atualizacao of atualizacoesPorId) {
const { data, error } = await db
.from("posicoes_hedge")
.update(atualizacao.row)
.eq("id", atualizacao.id)
.select("id, termo, status, resultado_realizado, negocio_rateio, contratos_qtd")
.maybeSingle();
if (error) throw new Error(error.message);
if (data) saved.push(data);
}

// alocações a partir do campo "Negócio / Rateio" (ex.: "CF-26-009: 3; CF-26-010: 2")
for (const row of saved || []) {
await db.from("alocacoes_hedge").delete().eq("posicao_id", row.id);
const texto = row.negocio_rateio || "";
const rateios = extrairRateiosNegocio(texto, row.contratos_qtd);
if (!rateios.length) continue;
const { data: ops } = await db.from("operacoes").select("id, codigo").in("codigo", rateios.map((item) => item.codigo));
const opPorCodigo = Object.fromEntries((ops || []).map((o) => [o.codigo, o.id]));
const partes = rateios
.filter((p) => opPorCodigo[p.codigo]);
if (!partes.length) continue;
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
export async function deletePositionFromDb(referencia) {
let consulta = db.from("posicoes_hedge").select("id");
consulta = referencia?.id
? consulta.eq("id", referencia.id)
: consulta.eq("termo", referencia?.termo || referencia);
const { data: existing } = await consulta.maybeSingle();
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
.map(([contrato, preco]) => ({
contrato,
data: hoje,
preco: toNumber(preco),
fonte: source === "B3" || String(source || "").includes("TradingView") ? "b3" : "manual",
referencia_fisica: false,
}));
if (!rows.length) return;
const { error } = await db.from("cotacoes_bgi").insert(rows);
if (error) throw new Error(error.message);
}
