// Sincronização do Portfólio BGI com o banco Confinex (Supabase).
// Substitui o sync via Google Sheets. A sessão de login é compartilhada com o
// Painel Vivo (mesma origem pablofaraujo.github.io + mesmo storage padrão).
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = "https://fkmdzwjmjlmxqotznvgq.supabase.co";
const SUPA_KEY = "sb_publishable_mNwlWLAaJOVoXpmlD7ShYg_-Nqyy0bT"; // pública (RLS protege)
const LOTE = 330;

export const db = createClient(SUPA_URL, SUPA_KEY);

export async function hasSession() {
return Boolean(await getSessionUserId());
}

export async function getSessionUserId() {
const { data, error } = await db.auth.getSession();
if (error) throw new Error("Não foi possível validar a sessão da base.");
const userId = data?.session?.user?.id;
return typeof userId === "string" && userId ? userId : null;
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
const categoriaOriginal = String(p.categoria || "").toLowerCase();
const especulacao = categoriaOriginal === "especulacao"
|| (!categoriaOriginal && /espec/i.test(String(p.negocio || "")));
const row = {
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
obs: Object.prototype.hasOwnProperty.call(p, "obs") ? p.obs : (p.registroOriginal?.obs ?? null),
origem: Object.prototype.hasOwnProperty.call(p, "origem") ? p.origem : (p.registroOriginal?.origem ?? "bgi-portfolio"),
};
// O campo só é enviado quando já existe. Assim o gatilho do banco pode criar
// a referência na primeira gravação e a versão continua compatível durante a
// implantação, antes de a migração aditiva chegar ao Supabase.
if (p.referenciaBolsa) row.referencia_bolsa = p.referenciaBolsa;
return row;
}

export function rowToApp(r) {
const isBgp = String(r.termo || "").startsWith("bgp:");
const cts = Number(r.contratos_qtd) || 0;
const perArroba = (total) => (cts ? Math.round(((Number(total) || 0) / (cts * LOTE)) * 100) / 100 : 0);
const registroOriginal = {
termo: r.termo ?? null, contrato: r.contrato ?? null, direcao: r.direcao ?? null,
categoria: r.categoria ?? null, contratos_qtd: r.contratos_qtd ?? null,
preco_entrada: r.preco_entrada ?? null, preco_saida: r.preco_saida ?? null,
data_entrada: r.data_entrada ?? null, data_saida: r.data_saida ?? null,
status: r.status ?? null, custo_corretagem: r.custo_corretagem ?? null,
custo_finpec: r.custo_finpec ?? null, resultado_realizado: r.resultado_realizado ?? null,
mes: r.mes ?? null, detalhes: r.detalhes ?? null, negocio_rateio: r.negocio_rateio ?? null,
obs: r.obs ?? null, origem: r.origem ?? null, referencia_bolsa: r.referencia_bolsa ?? null,
};
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
status: ["aberta", "rolada"].includes(r.status) ? "Aberta" : "Fechada",
categoria: r.categoria || (/espec/i.test(String(r.negocio_rateio || "")) ? "especulacao" : "hedge"),
negocio: r.negocio_rateio || "",
detalhes: r.detalhes || (isBgp ? "" : (r.obs || "")),
referenciaBolsa: r.referencia_bolsa || "",
origem: r.origem ?? null,
registroOriginal,
identidade: { id: r.id || null, termo: r.termo ?? null },
};
}

export function separarPosicoesParaPersistencia(positions) {
const atualizacoesPorId = new Map();
const gravacoesPorTermo = new Map();

positions.forEach((position) => {
const row = appToRow(position);
if (position.registroPersistidoId) {
atualizacoesPorId.set(position.registroPersistidoId, {
id: position.registroPersistidoId,
row,
registroOriginal: position.registroOriginal || {},
position,
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
.or("termo.like.bgp:%,origem.eq.bgi-portfolio,and(status.in.(aberta,rolada),origem.is.null)")
.order("created_at", { ascending: true });
if (error) throw new Error(error.message);
return deduplicarPosicoesLidas(data || []).map(rowToApp);
}

export async function fetchHedgeExposureFromDb() {
const { data, error } = await db
.from("v_exposicao_hedge")
.select("codigo, cts_necessarios, cts_abertos");
if (error) throw new Error(error.message);

// Boi Balança (BB-) já é comprado com a venda definida e não representa
// exposição física que precise ser coberta por uma nova venda de BGI.
const confinamentos = (data || []).filter((row) => !String(row.codigo || "").toUpperCase().startsWith("BB-"));
const necessarios = confinamentos.reduce((sum, row) => sum + toNumber(row.cts_necessarios), 0);
const abertos = confinamentos.reduce((sum, row) => sum + toNumber(row.cts_abertos), 0);
return {
necessarios,
abertos,
descobertos: Math.max(necessarios - abertos, 0),
};
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
// A fila envia somente posições editadas. Existentes usam ID e comparação
// atômica dos valores lidos; novos usam chave estável sem sobrescrever conflito.
// Ausência no array nunca exclui uma posição da base.
export async function savePositionsToDb(positions, clientOverride) {
const client = clientOverride || db;
// O estado local pode conter a mesma posição duas vezes após importar ou
// recuperar uma aba antiga. O Postgres rejeita chaves repetidas dentro do
// mesmo UPSERT; a versão mais recente da posição deve prevalecer.
const { atualizacoesPorId, gravacoesPorTermo } = separarPosicoesParaPersistencia(positions);
const saved = [];

const CAMPOS = ["termo", "contrato", "direcao", "categoria", "contratos_qtd",
"preco_entrada", "preco_saida", "data_entrada", "data_saida", "status",
"custo_corretagem", "custo_finpec", "resultado_realizado", "mes", "detalhes",
"negocio_rateio", "obs", "origem", "referencia_bolsa"];
const ALLOC_FIELDS = new Set(["negocio_rateio", "contratos_qtd", "status", "resultado_realizado"]);
const semUndefined = (row) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
const igual = (a, b) => (a == null && b == null) || String(a) === String(b);
const rowDesejado = (row) => semUndefined(Object.fromEntries(CAMPOS.map((key) => [key, row[key]])));
const rowConfere = (actual, desired) => CAMPOS.every((key) => desired[key] === undefined || igual(actual?.[key], desired[key]));
const originalMatch = (query, original) => {
for (const key of CAMPOS) {
const value = original?.[key];
if (value === undefined) continue;
query = value === null ? query.is(key, null) : query.eq(key, value);
}
return query;
};
const conflito = () => new Error("Conflito: a posição mudou na base; recarregue antes de salvar.");
const confirmarPorTermo = async (row) => {
const { data, error } = await client.from("posicoes_hedge").select("*").eq("termo", row.termo).maybeSingle();
if (error) throw new Error(error.message);
if (!data || !rowConfere(data, row)) throw conflito();
return data;
};

for (const row of gravacoesPorTermo) {
const desejado = rowDesejado(row);
const { data, error } = await client.from("posicoes_hedge")
.upsert([desejado], { onConflict: "termo", ignoreDuplicates: true })
.select("*").maybeSingle();
if (error) throw new Error(error.message);
if (data && (!data.id || !rowConfere(data, desejado))) throw new Error("A base não confirmou a nova posição enviada. Confira antes de tentar novamente.");
saved.push(data || await confirmarPorTermo(desejado));
}

// Registros antigos sem termo não podem passar por UPSERT: NULL não entra no
// conflito único e produziria uma nova linha. A identidade original do banco
// é preservada e a alteração ocorre pelo ID já existente.
for (const atualizacao of atualizacoesPorId) {
const original = atualizacao.registroOriginal || {};
if (!Object.keys(original).length) throw conflito();
const originalApp = rowToApp({ ...original, id: atualizacao.id });
const normalizadoOriginal = appToRow(originalApp);
const desired = rowDesejado(atualizacao.row);
// Compare o que o usuário realmente editou, não conversões de exibição
// (ex.: custo total convertido para R$/@ com duas casas ou mês preenchido).
const changed = Object.fromEntries(Object.entries(desired).filter(([key, value]) => !igual(value, normalizadoOriginal[key])));
// Ao assumir uma edição legada sem origem, mantém o registro consultável
// também depois de encerrado (sem criar uma segunda posição bgp).
if (Object.keys(changed).length && original.termo == null && original.origem == null) changed.origem = "bgi-portfolio";
const entradasFinanceiras = ["direcao", "contratos_qtd", "preco_entrada", "preco_saida", "status", "custo_corretagem", "custo_finpec"];
const recalcular = entradasFinanceiras.some((key) => Object.prototype.hasOwnProperty.call(changed, key));
delete changed.resultado_realizado;
for (const [rowField, appField] of [["custo_corretagem", "corretora"], ["custo_finpec", "finpec"]]) {
  if (igual(atualizacao.position[appField], originalApp[appField])) {
    if (igual(desired.contratos_qtd, original.contratos_qtd)) delete changed[rowField];
    else if (toNumber(original.contratos_qtd)) changed[rowField] = toNumber(original[rowField]) / toNumber(original.contratos_qtd) * desired.contratos_qtd || null;
  }
}
if (recalcular) {
  const final = { ...original, ...changed };
  if (final.status === "encerrada" && final.preco_saida != null) {
    const bruto = final.direcao === "termo" ? 0 : (final.direcao === "vendido" ? 1 : -1)
      * (toNumber(final.preco_entrada) - toNumber(final.preco_saida)) * toNumber(final.contratos_qtd) * LOTE;
    changed.resultado_realizado = Math.round((bruto - toNumber(final.custo_corretagem) - toNumber(final.custo_finpec)) * 100) / 100;
  } else changed.resultado_realizado = null;
}
const esperado = { ...original, ...changed };
if (!Object.keys(changed).length) {
const { data, error } = await client.from("posicoes_hedge").select("*").eq("id", atualizacao.id).maybeSingle();
if (error) throw new Error(error.message);
if (!data || !rowConfere(data, esperado)) throw conflito();
saved.push(data);
continue;
}
let query = client.from("posicoes_hedge").update(changed).eq("id", atualizacao.id);
query = originalMatch(query, original);
const { data, error } = await query.select("*").maybeSingle();
if (error) throw new Error(error.message);
if (data) {
if (data.id !== atualizacao.id || !rowConfere(data, esperado)) throw new Error("A base não confirmou os valores enviados. Confira antes de tentar novamente.");
saved.push(data);
}
else {
const { data: current, error: lookupError } = await client.from("posicoes_hedge").select("*").eq("id", atualizacao.id).maybeSingle();
if (lookupError) throw new Error(lookupError.message);
if (!current || !rowConfere(current, esperado)) throw conflito();
saved.push(current);
}
}

// alocações a partir do campo "Negócio / Rateio" (ex.: "CF-26-009: 3; CF-26-010: 2")
for (const row of saved || []) {
const source = positions.find((position) => (position.registroPersistidoId || null) === row.id || (row.termo && appToRow(position).termo === row.termo));
const original = source?.registroOriginal || null;
const allocationChanged = !original || [...ALLOC_FIELDS].some((key) => !igual(row[key], original[key]));
if (!allocationChanged) continue;
const texto = row.negocio_rateio || "";
const rateios = extrairRateiosNegocio(texto, row.contratos_qtd);
let ops = [];
if (rateios.length) {
const result = await client.from("operacoes").select("id, codigo").in("codigo", rateios.map((item) => item.codigo));
if (result.error) throw new Error(result.error.message);
ops = result.data || [];
const encontrados = new Set(ops.map((o) => o.codigo));
const ausentes = rateios.map((p) => p.codigo).filter((codigo) => !encontrados.has(codigo));
if (ausentes.length) throw new Error(`Rateio não confirmado na base: ${ausentes.join(", ")}. Nenhuma alocação foi alterada.`);
}
const { error: deleteError } = await client.from("alocacoes_hedge").delete().eq("posicao_id", row.id);
if (deleteError) throw new Error(deleteError.message);
if (!rateios.length) continue;
const opPorCodigo = Object.fromEntries((ops || []).map((o) => [o.codigo, o.id]));
const partes = rateios
.filter((p) => opPorCodigo[p.codigo]);
if (!partes.length) continue;
const totalFinal = partes.reduce((s, p) => s + (p.cts || 0), 0) || 1;
const { error: allocationError } = await client.from("alocacoes_hedge").insert(partes.map((p) => ({
posicao_id: row.id,
operacao_id: opPorCodigo[p.codigo],
contratos_qtd: p.cts || 0,
resultado_creditado: row.status === "encerrada" && row.resultado_realizado != null
? Math.round(row.resultado_realizado * ((p.cts || 0) / totalFinal) * 100) / 100
: null,
})));
if (allocationError) throw new Error(allocationError.message);
}
return { ok: true, registros: saved };
}

// ---------- exclusão ----------
// Apaga uma única posição (e suas alocações) pelo termo, de forma explícita.
// Chamada apenas pelo botão "Excluir" — nunca inferida por diffing.
export async function deletePositionFromDb(referencia) {
let consulta = db.from("posicoes_hedge").select("id");
consulta = referencia?.id
? consulta.eq("id", referencia.id)
: consulta.eq("termo", referencia?.termo || referencia);
const { data: existing, error: lookupError } = await consulta.maybeSingle();
if (lookupError) throw new Error(lookupError.message);
if (!existing) return { deleted: false };
const { error: allocationError } = await db.from("alocacoes_hedge").delete().eq("posicao_id", existing.id);
if (allocationError) throw new Error(allocationError.message);
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
