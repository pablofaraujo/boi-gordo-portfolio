import { writeFile } from "node:fs/promises";

const contracts = ["BGIM26", "BGIN26", "BGIU26", "BGIV26"];
const quoteSourceUrl = process.env.QUOTE_SOURCE_URL;
const quoteJson = process.env.QUOTE_JSON;

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeQuotes(payload) {
  const rows = Array.isArray(payload?.quotes)
    ? payload.quotes
    : Array.isArray(payload?.results)
      ? payload.results
      : Object.entries(payload?.prices || payload || {}).map(([contrato, fechamento]) => ({ contrato, fechamento }));

  const prices = rows.reduce((acc, row) => {
    const contrato = String(row.contrato || row.symbol || row.codigo || row.code || "").toUpperCase();
    const price = toNumber(row.fechamento ?? row.preco ?? row.price ?? row.regularMarketPrice ?? row.last ?? row.value);
    if (!contracts.includes(contrato) || !price) return acc;
    return { ...acc, [contrato]: price };
  }, {});

  return {
    source: payload?.source || payload?.fonte || "Fonte automatica",
    updatedAt: payload?.updatedAt || payload?.updated_at || payload?.data || new Date().toISOString(),
    prices,
  };
}

async function loadPayload() {
  if (quoteJson) return JSON.parse(quoteJson);
  if (!quoteSourceUrl) {
    throw new Error("Configure QUOTE_SOURCE_URL ou QUOTE_JSON nos secrets do GitHub.");
  }

  const response = await fetch(quoteSourceUrl, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Fonte respondeu HTTP ${response.status}`);
  return response.json();
}

const payload = await loadPayload();
const normalized = normalizeQuotes(payload);
const missing = contracts.filter((contract) => !normalized.prices[contract]);

if (missing.length) {
  throw new Error(`Cotacoes ausentes: ${missing.join(", ")}`);
}

await writeFile("public/quotes.json", `${JSON.stringify(normalized, null, 2)}\n`);
console.log(`quotes.json atualizado: ${Object.keys(normalized.prices).join(", ")}`);
