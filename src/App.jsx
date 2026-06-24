import { useEffect, useMemo, useState } from "react";

const LOTE = 330;
const STORAGE_KEY = "bgi-portfolio-positions-v1";

const BGI_INDICES = [
  { vencimento: "M26", mes: "Junho/26", contrato: "BGIM26", fechamento: 343.5 },
  { vencimento: "N26", mes: "Julho/26", contrato: "BGIN26", fechamento: 334.5 },
  { vencimento: "U26", mes: "Setembro/26", contrato: "BGIU26", fechamento: 337.85 },
  { vencimento: "V26", mes: "Outubro/26", contrato: "BGIV26", fechamento: 345.8 },
];

const DEFAULT_POSITIONS = [
  { id: "m26-1", contrato: "BGIM26", mes: "Junho/26", lado: "Vendido", contratos: 6, entrada: 348.25, saida: "", dataEntrada: "", dataSaida: "", corretora: 0, finpec: 0, status: "Aberta", detalhes: "" },
  { id: "n26-1", contrato: "BGIN26", mes: "Julho/26", lado: "Vendido", contratos: 15, entrada: 346.04, saida: "", dataEntrada: "", dataSaida: "", corretora: 0, finpec: 0, status: "Aberta", detalhes: "" },
  { id: "u26-1", contrato: "BGIU26", mes: "Setembro/26", lado: "Comprado", contratos: 10, entrada: 347.26, saida: "", dataEntrada: "", dataSaida: "", corretora: 0, finpec: 0, status: "Aberta", detalhes: "" },
  { id: "u26-2", contrato: "BGIU26", mes: "Setembro/26", lado: "Vendido", contratos: 8, entrada: 346.95, saida: "", dataEntrada: "", dataSaida: "", corretora: 0, finpec: 0, status: "Aberta", detalhes: "" },
  { id: "v26-1", contrato: "BGIV26", mes: "Outubro/26", lado: "Vendido", contratos: 10, entrada: 353.3, saida: "", dataEntrada: "", dataSaida: "", corretora: 0, finpec: 0, status: "Aberta", detalhes: "" },
  { id: "v26-2", contrato: "BGIV26", mes: "Outubro/26", lado: "Vendido", contratos: 5, entrada: 355, saida: "", dataEntrada: "", dataSaida: "", corretora: 0, finpec: 0, status: "Aberta", detalhes: "" },
];

const emptyDraft = {
  contrato: "BGIM26",
  mes: "Junho/26",
  lado: "Vendido",
  contratos: 1,
  entrada: "",
  saida: "",
  dataEntrada: "",
  dataSaida: "",
  corretora: 0,
  finpec: 0,
  status: "Aberta",
  detalhes: "",
};

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function closingByContract() {
  return BGI_INDICES.reduce((acc, item) => ({ ...acc, [item.contrato]: item.fechamento }), {});
}

function indexByVencimento(vencimento) {
  return BGI_INDICES.find((item) => item.vencimento === vencimento || item.contrato === vencimento || item.contrato.endsWith(vencimento));
}

function fmtCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

function fmtPrice(value) {
  if (value === "" || value === null || value === undefined) return "-";
  return Number(value).toFixed(2).replace(".", ",");
}

function resultForPosition(position, prices) {
  const qty = toNumber(position.contratos);
  const entry = toNumber(position.entrada);
  const explicitExit = position.saida !== "" && position.saida !== null && position.saida !== undefined;
  const exit = explicitExit ? toNumber(position.saida) : prices[position.contrato] || 0;
  const gross = position.lado === "Vendido" ? (entry - exit) * qty * LOTE : (exit - entry) * qty * LOTE;
  const brokerCost = toNumber(position.corretora) * qty * LOTE;
  const finpecCost = toNumber(position.finpec) * qty * LOTE;
  const costs = brokerCost + finpecCost;
  return { exit, gross, costs, brokerCost, finpecCost, net: gross - costs, source: explicitExit ? "Saída" : "Fechamento B3" };
}

function normalizePosition(position) {
  const hasExit = position.saida !== "" && position.saida !== null && position.saida !== undefined;
  return { dataEntrada: "", dataSaida: "", detalhes: "", ...position, status: position.status || (hasExit ? "Fechada" : "Aberta") };
}

function isClosed(position) {
  return position.status === "Fechada" || (position.saida !== "" && position.saida !== null && position.saida !== undefined);
}

function outcomeLabel(value) {
  if (value > 0) return "Ganho";
  if (value < 0) return "Perda";
  return "Zero";
}

function parsePortfolioImport(text) {
  const imported = [];
  let currentIndex = null;
  const lines = text.split(/\r?\n/);

  lines.forEach((line, lineIndex) => {
    const upper = line.toUpperCase();
    if (!line.trim() || upper.includes("SAIDA") || upper.includes("SAÍDA")) return;

    const contractMatch = upper.match(/\bBGI([A-Z]\d{2})\b/);
    const expiryMatch = upper.match(/\b([FGHJKMNQUVXZ]\d{2})\b/);
    const foundIndex = indexByVencimento(contractMatch ? contractMatch[1] : expiryMatch?.[1]);
    if (foundIndex) currentIndex = foundIndex;

    const numberMatches = line.match(/-?\d+(?:[.,]\d+)?/g) || [];
    const parsedNumbers = numberMatches.map(toNumber).filter((value) => Number.isFinite(value));
    if (!currentIndex || parsedNumbers.length < 2 || !upper.includes("FUTURO")) return;

    const entry = parsedNumbers[0];
    const signedContracts = parsedNumbers[parsedNumbers.length - 1];
    const contracts = Math.abs(signedContracts);
    if (!entry || !contracts) return;

    imported.push({
      id: `import-${Date.now()}-${lineIndex}`,
      contrato: currentIndex.contrato,
      mes: currentIndex.mes,
      lado: signedContracts < 0 ? "Vendido" : "Comprado",
      contratos,
      entrada: entry,
      saida: "",
      dataEntrada: "",
      dataSaida: "",
      corretora: 0,
      finpec: 0,
      status: "Aberta",
      detalhes: "Importado",
    });
  });

  return imported;
}

function loadStoredPositions() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_POSITIONS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed.map(normalizePosition) : DEFAULT_POSITIONS;
  } catch {
    return DEFAULT_POSITIONS;
  }
}

export default function Dashboard() {
  const [positions, setPositions] = useState(loadStoredPositions);
  const [draft, setDraft] = useState(emptyDraft);
  const [importText, setImportText] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const prices = useMemo(closingByContract, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  }, [positions]);

  const enriched = positions.map((position) => ({ ...normalizePosition(position), ...resultForPosition(position, prices) }));
  const openPositions = enriched.filter((position) => !isClosed(position));
  const closedPositions = enriched.filter(isClosed);
  const openCount = openPositions.length;
  const openNet = openPositions.reduce((sum, position) => sum + position.net, 0);
  const totalNet = closedPositions.reduce((sum, position) => sum + position.net, 0);
  const closedNet = closedPositions.reduce((sum, position) => sum + position.net, 0);
  const closedBrokerCosts = closedPositions.reduce((sum, position) => sum + position.brokerCost, 0);
  const closedFinpecCosts = closedPositions.reduce((sum, position) => sum + position.finpecCost, 0);

  function updateDraft(field, value) {
    const selected = field === "contrato" ? BGI_INDICES.find((item) => item.contrato === value) : null;
    setDraft((current) => ({ ...current, [field]: value, ...(selected ? { mes: selected.mes } : {}) }));
  }

  function addPosition() {
    if (!draft.contrato || !toNumber(draft.contratos) || !toNumber(draft.entrada)) return;
    setPositions((current) => [...current, { ...draft, id: `${Date.now()}` }]);
    setDraft(emptyDraft);
  }

  function importOpenPositions() {
    const imported = parsePortfolioImport(importText);
    if (!imported.length) {
      setImportMessage("Nenhuma posição aberta encontrada no texto colado.");
      return;
    }
    setPositions((current) => [...current.filter(isClosed), ...imported]);
    setImportMessage(`${imported.length} posições abertas importadas. O histórico fechado foi preservado.`);
  }

  function updatePosition(id, field, value) {
    setPositions((current) => current.map((position) => {
      if (position.id !== id) return position;
      const selected = field === "contrato" ? BGI_INDICES.find((item) => item.contrato === value) : null;
      const updated = { ...normalizePosition(position), [field]: value, ...(selected ? { mes: selected.mes } : {}) };
      if (field === "saida" && value !== "") updated.status = "Fechada";
      if (field === "status" && value === "Aberta") updated.dataSaida = "";
      return updated;
    }));
  }

  function deletePosition(id) {
    setPositions((current) => current.filter((position) => position.id !== id));
  }

  function resetPositions() {
    const confirmed = window.confirm("Isso apaga as posições gravadas neste navegador e restaura a amostra. Deseja continuar?");
    if (!confirmed) return;
    setPositions(DEFAULT_POSITIONS);
  }

  const pnlColor = (value) => (value >= 0 ? "#15803d" : "#b91c1c");
  const inputStyle = { width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "7px 8px", font: "inherit", fontSize: 12, background: "#fff" };
  const cellInputStyle = { ...inputStyle, padding: "5px 6px" };
  const notesStyle = { ...inputStyle, minHeight: 38, resize: "vertical" };

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", background: "#f8fafc", minHeight: "100vh", padding: 16, color: "#111827" }}>
      <style>{`
        * { box-sizing: border-box; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: right; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .3px; padding: 8px; border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
        td { text-align: right; font-size: 12px; padding: 7px 8px; border-bottom: 1px solid #eef2f7; vertical-align: middle; }
        th.L, td.L { text-align: left; }
        button { font: inherit; }
      `}</style>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1.8, color: "#94a3b8", textTransform: "uppercase", marginBottom: 4 }}>B3 · BGI · Posições gravadas</div>
            <h1 style={{ fontSize: 22, margin: 0 }}>Boi Gordo — Portfólio</h1>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
          {[
            ["Resultado parcial em aberto", fmtCurrency(openNet), pnlColor(openNet)],
            ["Posição em aberto", `${openCount}`, "#475569"],
            ["Resultado líquido", fmtCurrency(totalNet), pnlColor(totalNet)],
          ].map(([label, value, color]) => (
            <div key={label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
            </div>
          ))}
        </div>

        <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14, marginBottom: 16 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Posição em aberto</h2>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th className="L">Contrato</th><th className="L">Lado</th><th>Contr.</th><th>Entrada</th><th>Atual</th><th>Custos</th><th>Resultado</th><th className="L">Detalhes</th></tr></thead>
              <tbody>
                {openPositions.length ? openPositions.map((position) => (
                  <tr key={`open-${position.id}`}>
                    <td className="L" style={{ fontWeight: 700 }}>{position.contrato}</td>
                    <td className="L">{position.lado}</td>
                    <td>{position.contratos}</td>
                    <td>R$ {fmtPrice(position.entrada)}</td>
                    <td>R$ {fmtPrice(position.exit)}</td>
                    <td>{fmtCurrency(position.costs)}</td>
                    <td style={{ color: pnlColor(position.net), fontWeight: 700 }}>{fmtCurrency(position.net)}</td>
                    <td className="L">{position.detalhes || "-"}</td>
                  </tr>
                )) : (
                  <tr><td className="L" colSpan="8" style={{ color: "#64748b" }}>Nenhuma posição em aberto.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14, marginBottom: 16 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Importar posições em aberto</h2>
          <textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            style={{ ...notesStyle, minHeight: 86, marginBottom: 8 }}
            placeholder={"Cole aqui a lista com vencimento, preço médio e contratos. Ex.: M26 / FUTURO R$ 348,25 -6,00"}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={importOpenPositions} style={{ border: 0, background: "#0f766e", color: "#fff", borderRadius: 6, padding: "8px 10px", cursor: "pointer" }}>Atualizar abertas</button>
            {importMessage ? <span style={{ color: "#64748b", fontSize: 12 }}>{importMessage}</span> : null}
          </div>
        </section>

        <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14, marginBottom: 16 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Nova posição</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
            <select value={draft.contrato} onChange={(event) => updateDraft("contrato", event.target.value)} style={inputStyle}>{BGI_INDICES.map((item) => <option key={item.contrato}>{item.contrato}</option>)}</select>
            <select value={draft.lado} onChange={(event) => updateDraft("lado", event.target.value)} style={inputStyle}><option>Vendido</option><option>Comprado</option></select>
            <input value={draft.contratos} onChange={(event) => updateDraft("contratos", event.target.value)} style={inputStyle} type="number" min="1" placeholder="Contratos" />
            <input value={draft.dataEntrada} onChange={(event) => updateDraft("dataEntrada", event.target.value)} style={inputStyle} type="date" title="Data da entrada" />
            <input value={draft.entrada} onChange={(event) => updateDraft("entrada", event.target.value)} style={inputStyle} type="number" step="0.01" placeholder="Entrada" />
            <input value={draft.dataSaida} onChange={(event) => updateDraft("dataSaida", event.target.value)} style={inputStyle} type="date" title="Data da saída" />
            <input value={draft.saida} onChange={(event) => updateDraft("saida", event.target.value)} style={inputStyle} type="number" step="0.01" placeholder="Saída" />
            <input value={draft.corretora} onChange={(event) => updateDraft("corretora", event.target.value)} style={inputStyle} type="number" step="0.01" placeholder="Corretora/arroba" />
            <input value={draft.finpec} onChange={(event) => updateDraft("finpec", event.target.value)} style={inputStyle} type="number" step="0.01" placeholder="Finpec/arroba" />
            <select value={draft.status} onChange={(event) => updateDraft("status", event.target.value)} style={inputStyle}><option>Aberta</option><option>Fechada</option></select>
            <textarea value={draft.detalhes} onChange={(event) => updateDraft("detalhes", event.target.value)} style={{ ...notesStyle, gridColumn: "1 / -2" }} placeholder="Detalhes da operação" />
            <button onClick={addPosition} style={{ border: 0, background: "#2563eb", color: "#fff", borderRadius: 6, padding: "8px 10px", cursor: "pointer" }}>Gravar</button>
          </div>
        </section>

        <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Posições gravadas</h2>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th className="L">Contrato</th><th className="L">Lado</th><th>Contr.</th><th>Data entrada</th><th>Entrada</th><th>Data saída</th><th>Saída</th><th>Atual</th><th>Corretora/@</th><th>Finpec/@</th><th>Status</th><th className="L">Detalhes</th><th>Resultado</th><th></th></tr></thead>
              <tbody>
                {enriched.map((position) => (
                  <tr key={position.id}>
                    <td className="L"><select value={position.contrato} onChange={(event) => updatePosition(position.id, "contrato", event.target.value)} style={cellInputStyle}>{BGI_INDICES.map((item) => <option key={item.contrato}>{item.contrato}</option>)}</select></td>
                    <td className="L"><select value={position.lado} onChange={(event) => updatePosition(position.id, "lado", event.target.value)} style={cellInputStyle}><option>Vendido</option><option>Comprado</option></select></td>
                    <td><input value={position.contratos} onChange={(event) => updatePosition(position.id, "contratos", event.target.value)} style={cellInputStyle} type="number" /></td>
                    <td><input value={position.dataEntrada} onChange={(event) => updatePosition(position.id, "dataEntrada", event.target.value)} style={cellInputStyle} type="date" /></td>
                    <td><input value={position.entrada} onChange={(event) => updatePosition(position.id, "entrada", event.target.value)} style={cellInputStyle} type="number" step="0.01" /></td>
                    <td><input value={position.dataSaida} onChange={(event) => updatePosition(position.id, "dataSaida", event.target.value)} style={cellInputStyle} type="date" /></td>
                    <td><input value={position.saida} onChange={(event) => updatePosition(position.id, "saida", event.target.value)} style={cellInputStyle} type="number" step="0.01" placeholder={fmtPrice(position.exit)} /></td>
                    <td>{fmtPrice(position.exit)}<div style={{ color: "#94a3b8", fontSize: 10 }}>{position.source}</div></td>
                    <td><input value={position.corretora} onChange={(event) => updatePosition(position.id, "corretora", event.target.value)} style={cellInputStyle} type="number" step="0.01" /></td>
                    <td><input value={position.finpec} onChange={(event) => updatePosition(position.id, "finpec", event.target.value)} style={cellInputStyle} type="number" step="0.01" /></td>
                    <td><select value={position.status} onChange={(event) => updatePosition(position.id, "status", event.target.value)} style={cellInputStyle}><option>Aberta</option><option>Fechada</option></select></td>
                    <td className="L" style={{ minWidth: 180 }}><textarea value={position.detalhes} onChange={(event) => updatePosition(position.id, "detalhes", event.target.value)} style={notesStyle} placeholder="Detalhes" /></td>
                    <td style={{ color: pnlColor(position.net), fontWeight: 700 }}>{fmtCurrency(position.net)}</td>
                    <td><button onClick={() => deletePosition(position.id)} style={{ border: "1px solid #fecaca", background: "#fff", color: "#b91c1c", borderRadius: 6, padding: "5px 8px", cursor: "pointer" }}>Excluir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14, marginTop: 16 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Histórico de posições encerradas</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
            {[
              ["Resultado consolidado", fmtCurrency(closedNet), pnlColor(closedNet)],
              ["Pago corretora", fmtCurrency(closedBrokerCosts), "#475569"],
              ["Pago Finpec", fmtCurrency(closedFinpecCosts), "#475569"],
            ].map(([label, value, color]) => (
              <div key={label} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th className="L">Contrato</th><th className="L">Lado</th><th>Contr.</th><th>Entrada</th><th>Saída</th><th>Data saída</th><th>Corretora</th><th>Finpec</th><th>Resultado</th><th>Ganho/Perda</th><th className="L">Detalhes</th></tr></thead>
              <tbody>
                {closedPositions.length ? closedPositions.map((position) => (
                  <tr key={`history-${position.id}`}>
                    <td className="L" style={{ fontWeight: 700 }}>{position.contrato}</td>
                    <td className="L">{position.lado}</td>
                    <td>{position.contratos}</td>
                    <td>R$ {fmtPrice(position.entrada)}</td>
                    <td>R$ {fmtPrice(position.saida)}</td>
                    <td>{position.dataSaida || "-"}</td>
                    <td>{fmtCurrency(position.brokerCost)}</td>
                    <td>{fmtCurrency(position.finpecCost)}</td>
                    <td style={{ color: pnlColor(position.net), fontWeight: 700 }}>{fmtCurrency(position.net)}</td>
                    <td style={{ color: pnlColor(position.net), fontWeight: 700 }}>{outcomeLabel(position.net)}</td>
                    <td className="L">{position.detalhes || "-"}</td>
                  </tr>
                )) : (
                  <tr><td className="L" colSpan="11" style={{ color: "#64748b" }}>Preencha a saída ou marque a posição como fechada para aparecer no histórico.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={resetPositions} style={{ border: "1px solid #e2e8f0", background: "transparent", color: "#94a3b8", borderRadius: 6, padding: "4px 7px", cursor: "pointer", fontSize: 10 }}>
            Restaurar amostra
          </button>
        </div>
      </div>
    </div>
  );
}
