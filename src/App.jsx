import { useCallback, useEffect, useMemo, useState } from "react";

const POSITIONS = [
  { vencimento: "M26", mes: "Junho", contrato: "BGIM26", contratos: -6, precoMedio: 348.25 },
  { vencimento: "N26", mes: "Julho", contrato: "BGIN26", contratos: -15, precoMedio: 346.04 },
  { vencimento: "U26", mes: "Setembro", contrato: "BGIU26", contratos: 10, precoMedio: 347.26 },
  { vencimento: "U26", mes: "Setembro", contrato: "BGIU26", contratos: -8, precoMedio: 346.95 },
  { vencimento: "V26", mes: "Outubro", contrato: "BGIV26", contratos: -10, precoMedio: 353.30 },
  { vencimento: "V26", mes: "Outubro", contrato: "BGIV26", contratos: -5, precoMedio: 355.00 },
];

const CONTRACTS = [
  { vencimento: "M26", mes: "Junho", contrato: "BGIM26" },
  { vencimento: "N26", mes: "Julho", contrato: "BGIN26" },
  { vencimento: "U26", mes: "Setembro", contrato: "BGIU26" },
  { vencimento: "V26", mes: "Outubro", contrato: "BGIV26" },
];

const LOTE = 330;
const REFRESH_MS = 60_000;
const PNL_GREEN = "#16a34a";
const PNL_RED = "#dc2626";
const B3_QUOTE_URL = "https://cotacao.b3.com.br/mds/api/v1/InstrumentQuotation";
const PRICE_KEYS = new Set([
  "curPrc",
  "lastPx",
  "lastPrice",
  "regularMarketPrice",
  "price",
  "px",
  "vlUlt",
  "ult",
  "last",
]);

function referencePrices() {
  return CONTRACTS.reduce((acc, contract) => {
    const rows = POSITIONS.filter((pos) => pos.vencimento === contract.vencimento);
    const totalContracts = rows.reduce((sum, pos) => sum + Math.abs(pos.contratos), 0);
    const weightedPrice = rows.reduce((sum, pos) => sum + Math.abs(pos.contratos) * pos.precoMedio, 0);
    acc[contract.vencimento] = totalContracts ? weightedPrice / totalContracts : null;
    return acc;
  }, {});
}

function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractQuotePrice(payload) {
  const stack = [payload];
  const candidates = [];

  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;

    if (Array.isArray(current)) {
      current.forEach((item) => stack.push(item));
      continue;
    }

    Object.entries(current).forEach(([key, value]) => {
      if (PRICE_KEYS.has(key)) {
        const price = parseNumber(value);
        if (price && price > 0) candidates.push(price);
      }
      if (value && typeof value === "object") stack.push(value);
    });
  }

  return candidates[0] ?? null;
}

async function fetchB3Price(contract) {
  const response = await fetch(`${B3_QUOTE_URL}/${contract}`, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) throw new Error(`B3 HTTP ${response.status}`);

  const payload = await response.json();
  const price = extractQuotePrice(payload);
  if (!price) throw new Error("preço não encontrado na B3");
  return price;
}

async function fetchLivePrices(reference) {
  const results = await Promise.allSettled(
    CONTRACTS.map(async ({ vencimento, contrato }) => ({
      vencimento,
      contrato,
      price: await fetchB3Price(contrato),
    }))
  );

  const prices = { ...reference };
  const liveContracts = new Set();
  const errors = [];

  results.forEach((result, index) => {
    const contract = CONTRACTS[index];
    if (result.status === "fulfilled") {
      prices[result.value.vencimento] = result.value.price;
      liveContracts.add(result.value.vencimento);
    } else {
      errors.push(`${contract.contrato}: ${result.reason?.message ?? "falha ao buscar cotação"}`);
    }
  });

  return { prices, liveContracts, errors };
}

function pnlForPosition(pos, price) {
  if (price === null || price === undefined) return null;
  return pos.contratos < 0
    ? (pos.precoMedio - price) * Math.abs(pos.contratos) * LOTE
    : (price - pos.precoMedio) * pos.contratos * LOTE;
}

function fmtCurrency(value) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function fmtPrice(value) {
  if (value === null || value === undefined) return "-";
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

function fmtVariation(value) {
  if (value === null || value === undefined) return "-";
  const sign = value >= 0 ? "+" : "-";
  return `${sign}R$ ${Math.abs(value).toFixed(2).replace(".", ",")}`;
}

export default function Dashboard() {
  const reference = useMemo(referencePrices, []);
  const [prices, setPrices] = useState(reference);
  const [liveContracts, setLiveContracts] = useState(new Set());
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  const loadPrices = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchLivePrices(reference);
      setPrices(result.prices);
      setLiveContracts(result.liveContracts);
      setErrors(result.errors);
      setLastUpdate(new Date());
    } catch (error) {
      setErrors([error.message]);
      setLastUpdate(new Date());
    } finally {
      setLoading(false);
    }
  }, [reference]);

  useEffect(() => {
    loadPrices();
    const timer = setInterval(loadPrices, REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadPrices]);

  const positionsWithPnL = POSITIONS.map((pos) => {
    const currentPrice = prices[pos.vencimento];
    const pnl = pnlForPosition(pos, currentPrice);
    const variation = currentPrice !== null && currentPrice !== undefined ? currentPrice - pos.precoMedio : null;
    return { ...pos, precoAtual: currentPrice, pnl, variation };
  });

  const consolidated = CONTRACTS.map((contract) => {
    const rows = positionsWithPnL.filter((pos) => pos.vencimento === contract.vencimento);
    const netContracts = rows.reduce((sum, pos) => sum + pos.contratos, 0);
    const totalPnL = rows.reduce((sum, pos) => sum + (pos.pnl ?? 0), 0);
    return { ...contract, netContracts, totalPnL, precoAtual: prices[contract.vencimento], live: liveContracts.has(contract.vencimento) };
  });

  const totalPnL = consolidated.reduce((sum, row) => sum + row.totalPnL, 0);
  const totalNetContracts = consolidated.reduce((sum, row) => sum + row.netContracts, 0);
  const liveCount = liveContracts.size;

  const pnlStyle = (value) => ({
    color: value >= 0 ? PNL_GREEN : PNL_RED,
    fontWeight: 600,
  });

  const tagStyle = (contracts) => ({
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.4px",
    background: contracts < 0 ? "#fef2f2" : "#f0fdf4",
    color: contracts < 0 ? "#b91c1c" : "#15803d",
    border: `1px solid ${contracts < 0 ? "#fca5a5" : "#86efac"}`,
  });

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#f9fafb", minHeight: "100vh", padding: "20px 16px" }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.45} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        table { border-collapse: collapse; width: 100%; }
        th { font-size: 11px; font-weight: 600; letter-spacing: .4px; text-transform: uppercase; color: #6b7280; padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; white-space: nowrap; }
        th.L { text-align: left; }
        td { font-size: 13px; padding: 10px 12px; border-bottom: 1px solid #f3f4f6; color: #374151; text-align: right; }
        td.L { text-align: left; }
        tr:last-child td { border-bottom: none; }
        tbody tr:hover td { background: #fafafa; }
      `}</style>

      <div style={{ maxWidth: "860px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
          <div>
            <div style={{ fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "#9ca3af", marginBottom: "4px" }}>
              B3 · Mercado Futuro · Cotações Online
            </div>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#111827", letterSpacing: "-0.3px" }}>
              Boi Gordo — Portfólio
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: loading ? "#f59e0b" : liveCount ? "#22c55e" : "#9ca3af", animation: loading ? "pulse 1s infinite" : "none" }} />
              <span style={{ fontSize: "12px", color: "#6b7280" }}>
                {loading ? "Atualizando..." : `Atualizado ${lastUpdate.toLocaleTimeString("pt-BR")}`}
              </span>
              <button onClick={loadPrices} disabled={loading} style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", padding: "4px 10px", fontSize: "12px", color: "#374151", cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: loading ? 0.6 : 1 }}>
                Atualizar
              </button>
            </div>
          </div>
        </div>

        <div style={{ background: liveCount ? "#f0fdf4" : "#eff6ff", border: `1px solid ${liveCount ? "#bbf7d0" : "#bfdbfe"}`, borderRadius: "8px", padding: "10px 14px", color: liveCount ? "#166534" : "#1d4ed8", fontSize: "12px", marginBottom: "16px" }}>
          {liveCount === CONTRACTS.length
            ? "Cotações atualizadas pela B3."
            : liveCount > 0
              ? `Cotações atualizadas pela B3 para ${liveCount} de ${CONTRACTS.length} vencimentos. Os demais usam preço médio ponderado como referência.`
              : "Tentando atualizar pela B3. Enquanto a fonte online não responde, o painel usa preços médios ponderados como referência."}
        </div>

        {errors.length > 0 && (
          <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", padding: "10px 14px", color: "#92400e", fontSize: "12px", marginBottom: "16px" }}>
            Fonte B3 indisponível para: {errors.join(" | ")}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "10px", marginBottom: "20px" }}>
          {CONTRACTS.map(({ vencimento, mes, contrato }) => {
            const price = prices[vencimento];
            const row = consolidated.find((item) => item.vencimento === vencimento);
            return (
              <div key={vencimento} style={{ background: "#fff", borderRadius: "8px", padding: "14px 16px", border: "1px solid #e5e7eb", boxShadow: "0 1px 2px rgba(0,0,0,.05)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "#374151" }}>{contrato}</span>
                  <span style={tagStyle(row?.netContracts ?? 0)}>{(row?.netContracts ?? 0) < 0 ? `V ${Math.abs(row.netContracts)}` : `C ${row?.netContracts ?? 0}`}</span>
                </div>
                <div style={{ fontSize: "21px", fontWeight: 700, color: "#111827", letterSpacing: "-0.5px" }}>{fmtPrice(price).replace("R$ ", "")}</div>
                <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "3px" }}>{mes} 2026 · {row?.live ? "B3 online" : "referência"}</div>
              </div>
            );
          })}
        </div>

        <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e5e7eb", boxShadow: "0 1px 2px rgba(0,0,0,.05)", marginBottom: "16px", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}><span style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>Posições Abertas</span></div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th className="L">Vencimento</th><th>Direção</th><th>Contr.</th><th>Px Médio</th><th>Px Atual</th><th>Var/@</th><th>Resultado</th></tr></thead>
              <tbody>
                {positionsWithPnL.map((pos, index) => {
                  const favorableVariation = pos.contratos < 0 ? -pos.variation : pos.variation;
                  return (
                    <tr key={`${pos.vencimento}-${index}`}>
                      <td className="L"><span style={{ fontWeight: 600, color: "#111827" }}>{pos.vencimento}</span><span style={{ color: "#9ca3af", fontSize: "11px", marginLeft: "5px" }}>{pos.mes}</span></td>
                      <td><span style={tagStyle(pos.contratos)}>{pos.contratos < 0 ? "Vendido" : "Comprado"}</span></td>
                      <td>{Math.abs(pos.contratos)}</td>
                      <td style={{ color: "#6b7280" }}>{fmtPrice(pos.precoMedio)}</td>
                      <td style={{ fontWeight: 500 }}>{fmtPrice(pos.precoAtual)}</td>
                      <td style={pnlStyle(favorableVariation)}>{fmtVariation(favorableVariation)}</td>
                      <td style={pnlStyle(pos.pnl)}>{fmtCurrency(pos.pnl)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e5e7eb", boxShadow: "0 1px 2px rgba(0,0,0,.05)", marginBottom: "16px", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}><span style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>Consolidado por Vencimento</span></div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th className="L">Vencimento</th><th>Posição Líq.</th><th>Preço Atual</th><th>Fonte</th><th>Resultado</th></tr></thead>
              <tbody>
                {consolidated.map((row) => (
                  <tr key={row.vencimento}>
                    <td className="L"><span style={{ fontWeight: 600, color: "#111827" }}>{row.vencimento}</span><span style={{ color: "#9ca3af", fontSize: "11px", marginLeft: "5px" }}>{row.mes}</span></td>
                    <td><span style={tagStyle(row.netContracts)}>{row.netContracts < 0 ? `V ${Math.abs(row.netContracts)}` : `C ${row.netContracts}`}</span></td>
                    <td style={{ fontWeight: 500 }}>{fmtPrice(row.precoAtual)}</td>
                    <td style={{ color: row.live ? "#15803d" : "#6b7280", fontSize: "12px" }}>{row.live ? "B3" : "Referência"}</td>
                    <td style={pnlStyle(row.totalPnL)}>{fmtCurrency(row.totalPnL)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ background: totalPnL >= 0 ? "#f0fdf4" : "#fef2f2", border: `1px solid ${totalPnL >= 0 ? "#86efac" : "#fca5a5"}`, borderRadius: "8px", padding: "18px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", boxShadow: "0 1px 2px rgba(0,0,0,.05)" }}>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>Resultado Total do Portfólio</div>
            <div style={{ fontSize: "12px", color: "#9ca3af" }}>{totalNetContracts < 0 ? `Vendido ${Math.abs(totalNetContracts)}` : `Comprado ${totalNetContracts}`} contratos · {Math.abs(totalNetContracts) * LOTE} arrobas</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "28px", fontWeight: 700, letterSpacing: "-1px", color: totalPnL >= 0 ? PNL_GREEN : PNL_RED }}>{fmtCurrency(totalPnL)}</div>
            <div style={{ fontSize: "12px", fontWeight: 600, marginTop: "2px", color: totalPnL >= 0 ? PNL_GREEN : PNL_RED }}>{totalPnL >= 0 ? "▲ Lucro" : "▼ Prejuízo"}</div>
          </div>
        </div>

        <div style={{ marginTop: "14px", fontSize: "11px", color: "#9ca3af", textAlign: "center" }}>
          Fonte online: B3 InstrumentQuotation · fallback: preço médio ponderado das posições · 330 arrobas/contrato
        </div>
      </div>
    </div>
  );
}
