import { useState, useEffect, useCallback } from "react";

const POSITIONS = [
  { vencimento: "M26", mes: "Junho",    ticker: "BGIM26.SA", contratos: -6,  precoMedio: 348.25 },
  { vencimento: "N26", mes: "Julho",    ticker: "BGIN26.SA", contratos: -15, precoMedio: 346.04 },
  { vencimento: "U26", mes: "Setembro", ticker: "BGIU26.SA", contratos: 10,  precoMedio: 347.26 },
  { vencimento: "U26", mes: "Setembro", ticker: "BGIU26.SA", contratos: -8,  precoMedio: 346.95 },
  { vencimento: "V26", mes: "Outubro",  ticker: "BGIV26.SA", contratos: -10, precoMedio: 353.30 },
  { vencimento: "V26", mes: "Outubro",  ticker: "BGIV26.SA", contratos: -5,  precoMedio: 355.00 },
];

const CONTRATOS_UNICOS = [
  { vencimento: "M26", mes: "Junho",    ticker: "BGIM26.SA", contrato: "BGIM26" },
  { vencimento: "N26", mes: "Julho",    ticker: "BGIN26.SA", contrato: "BGIN26" },
  { vencimento: "U26", mes: "Setembro", ticker: "BGIU26.SA", contrato: "BGIU26" },
  { vencimento: "V26", mes: "Outubro",  ticker: "BGIV26.SA", contrato: "BGIV26" },
];

const LOTE = 330;
const REFRESH_SEC = 60;
const PNL_GREEN = "#16a34a";
const PNL_RED   = "#dc2626";

function pnlForPosition(pos, prices) {
  const px = prices[pos.vencimento];
  if (!px) return null;
  return pos.contratos < 0
    ? (pos.precoMedio - px) * Math.abs(pos.contratos) * LOTE
    : (px - pos.precoMedio) * pos.contratos * LOTE;
}

function fmt(n) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function fmtPreco(n) {
  if (!n && n !== 0) return "—";
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}

function fmtVar(n) {
  if (n === null || n === undefined) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}R$ ${Math.abs(n).toFixed(2).replace(".", ",")}`;
}

async function fetchYahoo(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
  const proxy = `https://corsproxy.io/?${encodeURIComponent(url)}`;
  const res = await fetch(proxy);
  if (!res.ok) throw new Error(`HTTP ${res.status} para ${ticker}`);
  const data = await res.json();
  const price =
    data?.chart?.result?.[0]?.meta?.regularMarketPrice ??
    data?.chart?.result?.[0]?.meta?.previousClose;
  if (!price) throw new Error(`Preço não encontrado para ${ticker}`);
  return price;
}

async function fetchAllPrices() {
  const results = await Promise.allSettled(
    CONTRATOS_UNICOS.map(async ({ vencimento, ticker }) => {
      const price = await fetchYahoo(ticker);
      return { vencimento, price };
    })
  );

  const prices = {};
  const errors = [];

  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      prices[r.value.vencimento] = r.value.price;
    } else {
      errors.push(`${CONTRATOS_UNICOS[i].contrato}: ${r.reason?.message}`);
    }
  });

  if (Object.keys(prices).length === 0) {
    throw new Error("Não foi possível obter nenhum preço. " + errors.join(" | "));
  }

  return { prices, errors, ts: new Date() };
}

export default function Dashboard() {
  const [prices, setPrices] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [countdown, setCountdown] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    try {
      const { prices: p, errors: e, ts } = await fetchAllPrices();
      setPrices(p);
      setErrors(e);
      setLastUpdate(ts);
      setCountdown(REFRESH_SEC);
    } catch (e) {
      setErrors([e.message]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!lastUpdate) return;
    const iv = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { load(); return REFRESH_SEC; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [lastUpdate, load]);

  const positionsWithPnL = POSITIONS.map(pos => {
    const px = prices?.[pos.vencimento] ?? null;
    const pnl = px !== null ? pnlForPosition(pos, prices) : null;
    const varArr = px !== null ? px - pos.precoMedio : null;
    return { ...pos, precoAtual: px, pnl, varArr };
  });

  const consolidado = CONTRATOS_UNICOS.map(({ vencimento, mes, contrato }) => {
    const linhas = positionsWithPnL.filter(p => p.vencimento === vencimento);
    const liquidoContratos = linhas.reduce((s, p) => s + p.contratos, 0);
    const pnlTotal = linhas.every(p => p.pnl !== null)
      ? linhas.reduce((s, p) => s + p.pnl, 0)
      : null;
    return { vencimento, mes, contrato, liquidoContratos, pnlTotal, precoAtual: prices?.[vencimento] ?? null };
  });

  const totalPnL = consolidado.every(c => c.pnlTotal !== null)
    ? consolidado.reduce((s, c) => s + c.pnlTotal, 0)
    : null;
  const totalLiq = consolidado.reduce((s, c) => s + c.liquidoContratos, 0);
  const countPct = (countdown / REFRESH_SEC) * 100;

  const pnlStyle = v => ({
    color: v === null ? "#9ca3af" : v >= 0 ? PNL_GREEN : PNL_RED,
    fontWeight: v !== null ? "600" : "400",
  });

  const tagStyle = c => ({
    display: "inline-block", padding: "2px 8px", borderRadius: "4px",
    fontSize: "11px", fontWeight: "600", letterSpacing: "0.4px",
    background: c < 0 ? "#fef2f2" : "#f0fdf4",
    color: c < 0 ? "#b91c1c" : "#15803d",
    border: `1px solid ${c < 0 ? "#fca5a5" : "#86efac"}`,
  });

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#f9fafb", minHeight: "100vh", padding: "20px 16px" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        table { border-collapse: collapse; width: 100%; }
        th { font-size: 11px; font-weight: 600; letter-spacing: .4px; text-transform: uppercase;
             color: #6b7280; padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; white-space: nowrap; }
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
              B3 · Mercado Futuro · Yahoo Finance
            </div>
            <div style={{ fontSize: "20px", fontWeight: "700", color: "#111827", letterSpacing: "-0.3px" }}>
              Boi Gordo — Portfólio
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <div style={{
                width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0,
                background: loading ? "#f59e0b" : prices ? "#22c55e" : "#d1d5db",
                animation: loading ? "pulse 1s infinite" : "none",
              }} />
              <span style={{ fontSize: "12px", color: "#6b7280" }}>
                {loading ? "Buscando preços…" : lastUpdate ? `Atualizado ${lastUpdate.toLocaleTimeString("pt-BR")}` : "Aguardando"}
              </span>
              <button onClick={load} disabled={loading} style={{
                background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px",
                padding: "4px 10px", fontSize: "12px", color: "#374151",
                cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit",
                opacity: loading ? 0.5 : 1,
              }}>↺ Atualizar</button>
            </div>
            {lastUpdate && !loading && (
              <span style={{ fontSize: "11px", color: "#9ca3af" }}>Próxima atualização em {countdown}s</span>
            )}
          </div>
        </div>

        <div style={{ height: "3px", background: "#e5e7eb", borderRadius: "2px", marginBottom: "20px" }}>
          <div style={{ height: "100%", background: "#3b82f6", width: `${countPct}%`, transition: "width 1s linear", borderRadius: "2px" }} />
        </div>

        {loading && !prices && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#6b7280", fontSize: "13px", padding: "28px 0" }}>
            <div style={{ width: "16px", height: "16px", border: "2px solid #e5e7eb", borderTop: "2px solid #3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
            Buscando preços na B3 via Yahoo Finance…
          </div>
        )}

        {errors.length > 0 && (
          <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", padding: "10px 14px", color: "#92400e", fontSize: "12px", marginBottom: "16px" }}>
            ⚠ {errors.join(" | ")}
          </div>
        )}

        {prices && (<>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "10px", marginBottom: "20px" }}>
            {CONTRATOS_UNICOS.map(({ vencimento, mes, contrato }) => {
              const px = prices[vencimento];
              const posLiq = consolidado.find(c => c.vencimento === vencimento);
              return (
                <div key={vencimento} style={{ background: "#fff", borderRadius: "10px", padding: "14px 16px", border: "1px solid #e5e7eb", boxShadow: "0 1px 2px rgba(0,0,0,.05)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "600", color: "#374151" }}>{contrato}</span>
                    <span style={tagStyle(posLiq?.liquidoContratos ?? -1)}>
                      {(posLiq?.liquidoContratos ?? 0) < 0 ? `V ${Math.abs(posLiq.liquidoContratos)}` : `C ${posLiq?.liquidoContratos ?? 0}`}
                    </span>
                  </div>
                  <div style={{ fontSize: "21px", fontWeight: "700", color: "#111827", letterSpacing: "-0.5px" }}>
                    {px ? px.toFixed(2).replace(".", ",") : "—"}
                  </div>
                  <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "3px" }}>{mes} 2026 · R$/arroba</div>
                </div>
              );
            })}
          </div>

          <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e5e7eb", boxShadow: "0 1px 2px rgba(0,0,0,.05)", marginBottom: "16px", overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
              <span style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>Posições Abertas</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th className="L">Vencimento</th><th>Direção</th><th>Contr.</th><th>Px Médio</th><th>Px Atual</th><th>Var/@</th><th>Resultado</th></tr></thead>
                <tbody>
                  {positionsWithPnL.map((pos, i) => {
                    const varFavor = pos.varArr !== null ? (pos.contratos < 0 ? -pos.varArr : pos.varArr) : null;
                    return (
                      <tr key={i}>
                        <td className="L"><span style={{ fontWeight: "600", color: "#111827" }}>{pos.vencimento}</span><span style={{ color: "#9ca3af", fontSize: "11px", marginLeft: "5px" }}>{pos.mes}</span></td>
                        <td><span style={tagStyle(pos.contratos)}>{pos.contratos < 0 ? "Vendido" : "Comprado"}</span></td>
                        <td>{Math.abs(pos.contratos)}</td>
                        <td style={{ color: "#6b7280" }}>{fmtPreco(pos.precoMedio)}</td>
                        <td style={{ fontWeight: "500" }}>{fmtPreco(pos.precoAtual)}</td>
                        <td style={pnlStyle(varFavor)}>{fmtVar(varFavor)}</td>
                        <td style={pnlStyle(pos.pnl)}>{fmt(pos.pnl)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e5e7eb", boxShadow: "0 1px 2px rgba(0,0,0,.05)", marginBottom: "16px", overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
              <span style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>Consolidado por Vencimento</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th className="L">Vencimento</th><th>Posição Líq.</th><th>Preço Atual</th><th>Resultado</th></tr></thead>
                <tbody>
                  {consolidado.map(c => (
                    <tr key={c.vencimento}>
                      <td className="L"><span style={{ fontWeight: "600", color: "#111827" }}>{c.vencimento}</span><span style={{ color: "#9ca3af", fontSize: "11px", marginLeft: "5px" }}>{c.mes}</span></td>
                      <td><span style={tagStyle(c.liquidoContratos)}>{c.liquidoContratos < 0 ? `V ${Math.abs(c.liquidoContratos)}` : `C ${c.liquidoContratos}`}</span></td>
                      <td style={{ fontWeight: "500" }}>{fmtPreco(c.precoAtual)}</td>
                      <td style={pnlStyle(c.pnlTotal)}>{fmt(c.pnlTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{
            background: totalPnL === null ? "#fff" : totalPnL >= 0 ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${totalPnL === null ? "#e5e7eb" : totalPnL >= 0 ? "#86efac" : "#fca5a5"}`,
            borderRadius: "10px", padding: "18px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", boxShadow: "0 1px 2px rgba(0,0,0,.05)",
          }}>
            <div>
              <div style={{ fontSize: "11px", fontWeight: "600", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>Resultado Total do Portfólio</div>
              <div style={{ fontSize: "12px", color: "#9ca3af" }}>{totalLiq < 0 ? `Vendido ${Math.abs(totalLiq)}` : `Comprado ${totalLiq}`} contratos · {Math.abs(totalLiq) * 330} arrobas</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "28px", fontWeight: "700", letterSpacing: "-1px", color: totalPnL === null ? "#9ca3af" : totalPnL >= 0 ? PNL_GREEN : PNL_RED }}>{fmt(totalPnL)}</div>
              {totalPnL !== null && <div style={{ fontSize: "12px", fontWeight: "600", marginTop: "2px", color: totalPnL >= 0 ? PNL_GREEN : PNL_RED }}>{totalPnL >= 0 ? "▲ Lucro" : "▼ Prejuízo"}</div>}
            </div>
          </div>

          <div style={{ marginTop: "14px", fontSize: "11px", color: "#d1d5db", textAlign: "center" }}>
            Fonte: Yahoo Finance (BGIM26.SA · BGIN26.SA · BGIU26.SA · BGIV26.SA) · 330 arrobas/contrato · Atualiza a cada {REFRESH_SEC}s
          </div>
        </>)}
      </div>
    </div>
  );
}
