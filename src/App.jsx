import { useEffect, useMemo, useRef, useState } from "react";
import { hasSession, fetchPositionsFromDb, savePositionsToDb, saveQuotesToDb, deletePositionFromDb } from "./supabaseSync";

const LOTE = 330;
const STORAGE_KEY = "bgi-portfolio-positions-v1";
const QUOTES_STORAGE_KEY = "bgi-portfolio-quotes-v1";
const PAINEL_URL = "https://pablofaraujo.github.io/Confinex/painel.html";
const B3_QUOTE_URL = "https://cotacao.b3.com.br/mds/api/v1/DailyFluctuationHistory";

const BGI_INDICES = [
  { vencimento: "K26", mes: "Maio/26", contrato: "BGIK26", fechamento: 340 },
  { vencimento: "M26", mes: "Junho/26", contrato: "BGIM26", fechamento: 343.5 },
  { vencimento: "N26", mes: "Julho/26", contrato: "BGIN26", fechamento: 334.5 },
  { vencimento: "U26", mes: "Setembro/26", contrato: "BGIU26", fechamento: 337.85 },
  { vencimento: "V26", mes: "Outubro/26", contrato: "BGIV26", fechamento: 345.8 },
];

const DEFAULT_POSITIONS = [
{ id: "m26-1", contrato: "BGIM26", mes: "Junho/26", lado: "Vendido", contratos: 6, entrada: 348.25, saida: "", dataEntrada: "", dataSaida: "", corretora: 0, finpec: 0, status: "Aberta", negocio: "", detalhes: "" },
{ id: "n26-1", contrato: "BGIN26", mes: "Julho/26", lado: "Vendido", contratos: 15, entrada: 346.04, saida: "", dataEntrada: "", dataSaida: "", corretora: 0, finpec: 0, status: "Aberta", negocio: "", detalhes: "" },
{ id: "u26-1", contrato: "BGIU26", mes: "Setembro/26", lado: "Comprado", contratos: 10, entrada: 347.26, saida: "", dataEntrada: "", dataSaida: "", corretora: 0, finpec: 0, status: "Aberta", negocio: "", detalhes: "" },
{ id: "u26-2", contrato: "BGIU26", mes: "Setembro/26", lado: "Vendido", contratos: 8, entrada: 346.95, saida: "", dataEntrada: "", dataSaida: "", corretora: 0, finpec: 0, status: "Aberta", negocio: "", detalhes: "" },
{ id: "v26-1", contrato: "BGIV26", mes: "Outubro/26", lado: "Vendido", contratos: 10, entrada: 353.3, saida: "", dataEntrada: "", dataSaida: "", corretora: 0, finpec: 0, status: "Aberta", negocio: "", detalhes: "" },
{ id: "v26-2", contrato: "BGIV26", mes: "Outubro/26", lado: "Vendido", contratos: 5, entrada: 355, saida: "", dataEntrada: "", dataSaida: "", corretora: 0, finpec: 0, status: "Aberta", negocio: "", detalhes: "" },
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
  negocio: "",
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

function fmtResult(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value || 0);
}

function fmtPrice(value) {
  if (value === "" || value === null || value === undefined) return "-";
  return Number(value).toFixed(2).replace(".", ",");
}

function fmtDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function fmtShortDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-");
  if (year && month && day) return `${day}/${month}/${year.slice(-2)}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(date);
}

function resultForPosition(position, prices) {
  const qty = toNumber(position.contratos);
  const entry = toNumber(position.entrada);
  const isTermo = position.lado === "Termo";
  const explicitExit = position.saida !== "" && position.saida !== null && position.saida !== undefined;
  // Termo = preço fixado com contraparte fora da B3. Não é marcado a mercado
  // contra o índice: sem cotação de "atual" nem ganho/perda flutuante — só
  // os custos (se houver) entram no resultado.
  const exit = explicitExit ? toNumber(position.saida) : isTermo ? entry : prices[position.contrato] || 0;
  const gross = isTermo ? 0 : position.lado === "Vendido" ? (entry - exit) * qty * LOTE : (exit - entry) * qty * LOTE;
  const brokerCost = toNumber(position.corretora) * qty * LOTE;
  const finpecCost = toNumber(position.finpec) * qty * LOTE;
  const costs = brokerCost + finpecCost;
  return { exit, gross, costs, brokerCost, finpecCost, net: gross - costs, source: isTermo ? "Termo (fixo)" : explicitExit ? "Saída" : "Fechamento B3" };
}

function normalizePosition(position) {
  const hasExit = position.saida !== "" && position.saida !== null && position.saida !== undefined;
  return { dataEntrada: "", dataSaida: "", negocio: "", detalhes: "", ...position, status: position.status || (hasExit ? "Fechada" : "Aberta") };
}

function isClosed(position) {
  return position.status === "Fechada" || (position.saida !== "" && position.saida !== null && position.saida !== undefined);
}

function outcomeLabel(value) {
  if (value > 0) return "Ganho";
  if (value < 0) return "Perda";
  return "Zero";
}

function positionTone(lado) {
  if (lado === "Comprado") return { bg: "#e0f2fe", border: "#0284c7", color: "#075985", row: "#f7fbff" };
  if (lado === "Termo") return { bg: "#fef3c7", border: "#d97706", color: "#92400e", row: "#fffbeb" };
  return { bg: "#fee2e2", border: "#dc2626", color: "#991b1b", row: "#fff8f8" };
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
      negocio: "",
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

function normalizeQuotes(payload) {
  const quoteList = Array.isArray(payload?.quotes)
    ? payload.quotes
    : Object.entries(payload?.prices || {}).map(([contrato, fechamento]) => ({ contrato, fechamento }));

  const prices = quoteList.reduce((acc, quote) => {
    const contrato = String(quote.contrato || "").toUpperCase();
    const price = toNumber(quote.fechamento ?? quote.preco ?? quote.price ?? quote.last);
    if (!contrato || !price) return acc;
    return { ...acc, [contrato]: price };
  }, {});

  return {
    prices,
    updatedAt: payload?.updatedAt || payload?.updated_at || payload?.data || "",
    source: payload?.source || payload?.fonte || "Arquivo de cotações",
  };
}

function loadStoredQuotes() {
  try {
    const raw = window.localStorage.getItem(QUOTES_STORAGE_KEY);
    if (!raw) return { prices: {}, updatedAt: "", source: "" };
    return normalizeQuotes(JSON.parse(raw));
  } catch {
    return { prices: {}, updatedAt: "", source: "" };
  }
}

async function fetchDbPositions() {
  const rows = await fetchPositionsFromDb();
  return rows.map(normalizePosition);
}

async function saveDbPositions(positionsToSave) {
  return savePositionsToDb(positionsToSave.map(normalizePosition));
}

export default function Dashboard() {
  const [positions, setPositions] = useState(loadStoredPositions);
  const [draft, setDraft] = useState(emptyDraft);
  const [importText, setImportText] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [marketQuotes, setMarketQuotes] = useState(loadStoredQuotes);
  const [quoteStatus, setQuoteStatus] = useState("Clique para atualizar quando quiser buscar o último arquivo de cotações.");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [dbConnected, setDbConnected] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Conectando à base Confinex...");
  const [syncLoading, setSyncLoading] = useState(false);
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef(null);
  const fallbackPrices = useMemo(closingByContract, []);
  const prices = useMemo(() => ({ ...fallbackPrices, ...marketQuotes.prices }), [fallbackPrices, marketQuotes]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
    if (!hydratedRef.current || !dbConnected) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setSyncStatus("Salvando na base Confinex...");
    saveTimerRef.current = window.setTimeout(async () => {
      try {
        await saveDbPositions(positions);
        setSyncStatus(`Sincronizado com a base Confinex em ${fmtDateTime(new Date().toISOString())}`);
      } catch (err) {
        setSyncStatus(`Não consegui salvar na base agora (${err?.message || "erro"}). Mantive uma cópia neste aparelho.`);
      }
    }, 900);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [positions, dbConnected]);

  useEffect(() => {
    let cancelled = false;
    async function hydrateFromDb() {
      const logged = await hasSession();
      if (cancelled) return;
      setDbConnected(logged);
      if (!logged) {
        hydratedRef.current = true;
        setSyncStatus("Sem login na base. Abra o Painel, faça login e recarregue esta página.");
        return;
      }
      setSyncLoading(true);
      try {
        const remotePositions = await fetchDbPositions();
        if (cancelled) return;
        if (remotePositions.length) {
          setPositions(remotePositions);
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(remotePositions));
          setSyncStatus(`Carregado da base Confinex em ${fmtDateTime(new Date().toISOString())}`);
        } else {
          setSyncStatus("Base vazia. Salvando as posições deste aparelho como base inicial...");
          await saveDbPositions(positions);
          setSyncStatus(`Base inicial salva no Confinex em ${fmtDateTime(new Date().toISOString())}`);
        }
      } catch (err) {
        if (!cancelled) setSyncStatus(`Não consegui consultar a base agora (${err?.message || "erro"}). Usando a cópia deste aparelho.`);
      } finally {
        hydratedRef.current = true;
        if (!cancelled) setSyncLoading(false);
      }
    }
    hydrateFromDb();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshPositionsFromSheets() {
    if (!dbConnected) {
      window.open(PAINEL_URL, "_blank");
      setSyncStatus("Faça login no Painel e recarregue esta página.");
      return;
    }
    setSyncLoading(true);
    setSyncStatus("Buscando posições na base Confinex...");
    try {
      const remotePositions = await fetchDbPositions();
      if (remotePositions.length) {
        setPositions(remotePositions);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(remotePositions));
        setSyncStatus(`Posições recarregadas da base em ${fmtDateTime(new Date().toISOString())}`);
      } else {
        setSyncStatus("Base vazia. Nada foi alterado.");
      }
    } catch (err) {
      setSyncStatus(`Não consegui buscar na base agora (${err?.message || "erro"}).`);
    } finally {
      setSyncLoading(false);
    }
  }

  useEffect(() => {
    if (marketQuotes.updatedAt) {
      setQuoteStatus(`Última cotação salva: ${fmtDateTime(marketQuotes.updatedAt)}`);
    }
  }, [marketQuotes.updatedAt]);

  async function refreshQuotes() {
    setQuoteLoading(true);
    setQuoteStatus("Buscando cotações na B3...");
    const previousPrices = { ...fallbackPrices, ...marketQuotes.prices };

    const quoteResponses = await Promise.all(BGI_INDICES.map(async (item) => {
      try {
        const response = await fetch(`${B3_QUOTE_URL}/${item.contrato}?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`B3 indisponível para ${item.contrato}`);
        const payload = await response.json();
        const quotes = payload?.TradgFlr?.scty?.lstQtn || [];
        const lastQuote = quotes[quotes.length - 1];
        const price = toNumber(lastQuote?.closPric);
        if (!price) throw new Error(`Sem cotação para ${item.contrato}`);
        return {
          contrato: item.contrato,
          fechamento: price,
          horario: lastQuote?.dtTm || "",
          data: payload?.TradgFlr?.date || "",
        };
      } catch {
        return {
          contrato: item.contrato,
          fechamento: previousPrices[item.contrato],
          fallback: true,
        };
      }
    }));

    try {
      const updatedQuotes = quoteResponses.filter((quote) => !quote.fallback && quote.fechamento);
      if (!updatedQuotes.length) throw new Error("Sem cotação atualizada na B3");
      const normalized = {
        prices: quoteResponses.reduce((acc, quote) => ({ ...acc, [quote.contrato]: quote.fechamento }), {}),
        updatedAt: new Date().toISOString(),
        source: "B3",
      };
      setMarketQuotes(normalized);
      window.localStorage.setItem(QUOTES_STORAGE_KEY, JSON.stringify(normalized));
      if (dbConnected) saveQuotesToDb(normalized.prices, normalized.source).catch(() => {});
      const fallbackContracts = quoteResponses.filter((quote) => quote.fallback).map((quote) => quote.contrato);
      setQuoteStatus(fallbackContracts.length
        ? `B3 atualizou ${updatedQuotes.length} contrato(s). Mantive último valor em ${fallbackContracts.join(", ")}.`
        : `Cotações B3 atualizadas em ${fmtDateTime(normalized.updatedAt)}`);
    } catch {
      setQuoteStatus(marketQuotes.updatedAt
        ? `Não consegui buscar na B3 agora. Mantive a última cotação salva de ${fmtDateTime(marketQuotes.updatedAt)}.`
        : "Não consegui buscar na B3 agora. Mantive as cotações base.");
    } finally {
      setQuoteLoading(false);
    }
  }

  const enriched = positions.map((position) => ({ ...normalizePosition(position), ...resultForPosition(position, prices) }));
  const openPositions = enriched.filter((position) => !isClosed(position));
  const closedPositions = enriched.filter(isClosed);
  const [editingClosedIds, setEditingClosedIds] = useState([]);
  const editingClosedIdSet = useMemo(() => new Set(editingClosedIds), [editingClosedIds]);
  // A edição de uma posição encerrada agora acontece na própria linha da
  // tabela de Histórico (não move mais a posição para outra seção da tela —
  // isso era confuso: parecia que a posição tinha "sumido").
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
      if (field === "status" && value === "Aberta") {
        updated.saida = "";
        updated.dataSaida = "";
      }
      return updated;
    }));
  }

  function editClosedPosition(id) {
    setEditingClosedIds((current) => (current.includes(id) ? current : [...current, id]));
  }

  function finishEditingPosition(id) {
    setEditingClosedIds((current) => current.filter((editingId) => editingId !== id));
  }

  function deletePosition(id) {
    setPositions((current) => current.filter((position) => position.id !== id));
    setEditingClosedIds((current) => current.filter((editingId) => editingId !== id));
    // Exclusão explícita e imediata no banco — não depende do auto-save nem
    // de diffing do array local (isso é o que causava perda de dados quando
    // o estado local estava desatualizado). Se a posição nunca chegou a ser
    // sincronizada, deletePositionFromDb simplesmente não encontra nada.
    if (dbConnected) {
      deletePositionFromDb(`bgp:${id}`).catch((err) => {
        setSyncStatus(`Não consegui excluir na base agora (${err?.message || "erro"}). Ao recarregar a posição pode voltar.`);
      });
    }
  }

  const pnlColor = (value) => (value >= 0 ? "#15803d" : "#b91c1c");
  const inputStyle = { width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "7px 8px", font: "inherit", fontSize: 12, background: "#fff" };
  const cellInputStyle = { ...inputStyle, padding: "5px 6px" };
  const compactCellInputStyle = { ...cellInputStyle, padding: "5px 4px", fontSize: 11 };
  const notesStyle = { ...inputStyle, minHeight: 38, resize: "vertical" };
  const smallNotesStyle = { ...notesStyle, minHeight: 34, fontSize: 11 };
  const positionBadge = (lado) => {
    const tone = positionTone(lado);
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: 76,
      border: `1px solid ${tone.border}`,
      background: tone.bg,
      color: tone.color,
      borderRadius: 999,
      padding: "4px 8px",
      fontSize: 11,
      fontWeight: 700,
    };
  };
  const positionRowStyle = (lado) => {
    const tone = positionTone(lado);
    return { borderLeft: `4px solid ${tone.border}`, background: tone.row };
  };

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", background: "#f8fafc", minHeight: "100vh", padding: 16, color: "#111827" }}>
      <style>{`
        * { box-sizing: border-box; }
        table { width: 100%; border-collapse: collapse; }
        .data-table { table-layout: fixed; min-width: 865px; }
        .edit-table { table-layout: fixed; min-width: 1150px; }
        .history-table { table-layout: fixed; min-width: 1010px; }
        th { text-align: right; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .3px; padding: 8px; border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
        td { text-align: right; font-size: 12px; padding: 7px 8px; border-bottom: 1px solid #eef2f7; vertical-align: middle; }
        .history-table th { padding: 6px 5px; }
        .history-table td { padding: 6px 5px; }
        th.L, td.L { text-align: left; }
        td.price-cell input { font-variant-numeric: tabular-nums; }
        .row-position-select { font-weight: 700; }
        .brand-mark {
          width: 58px;
          height: 58px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
          border: 1px solid #e5e7eb;
          box-shadow: 0 1px 4px rgba(15, 23, 42, .12);
        }
        .stacked-cell { display: grid; gap: 5px; }
        .stacked-field { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 5px; align-items: center; }
        .stacked-label { color: #94a3b8; font-size: 9px; font-weight: 700; text-align: left; text-transform: uppercase; }
        .new-position-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
        @media (max-width: 720px) {
          .brand-mark { width: 52px; height: 52px; }
          .new-position-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        button { font: inherit; }
      `}</style>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 280 }}>
            <img className="brand-mark" src={`${process.env.PUBLIC_URL || ""}/confinex-logo.jpg`} alt="Confinex" />
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1.8, color: "#94a3b8", textTransform: "uppercase", marginBottom: 4 }}>B3 · BGI · Posições gravadas</div>
              <h1 style={{ fontSize: 22, margin: 0 }}>Boi Gordo — Portfólio</h1>
              <div style={{ fontSize: 11, color: dbConnected ? "#0f766e" : "#94a3b8", marginTop: 5 }}>{syncStatus}</div>
            </div>
          </div>
          <button onClick={refreshPositionsFromSheets} disabled={syncLoading} style={{ border: "1px solid #cbd5e1", background: "#fff", color: dbConnected ? "#334155" : "#94a3b8", borderRadius: 6, padding: "7px 9px", cursor: syncLoading ? "not-allowed" : "pointer", fontSize: 12 }}>
            {syncLoading ? "Sincronizando..." : "Sincronizar posições"}
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
          {[
            ["Resultado parcial em aberto", fmtResult(openNet), pnlColor(openNet)],
            ["Posição em aberto", `${openCount}`, "#475569"],
            ["Resultado líquido", fmtResult(totalNet), pnlColor(totalNet)],
          ].map(([label, value, color]) => (
            <div key={label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
            </div>
          ))}
        </div>

        <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <h2 style={{ fontSize: 14, margin: "0 0 4px" }}>Cotações</h2>
              <div style={{ fontSize: 12, color: "#64748b" }}>{quoteStatus}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>Fonte: {marketQuotes.source || "cotações base"}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
              <button onClick={refreshQuotes} disabled={quoteLoading} style={{ border: 0, background: quoteLoading ? "#94a3b8" : "#2563eb", color: "#fff", borderRadius: 6, padding: "8px 10px", cursor: quoteLoading ? "wait" : "pointer", fontSize: 12 }}>
                {quoteLoading ? "Atualizando..." : "Atualizar cotações"}
              </button>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {BGI_INDICES.map((item) => (
                  <div key={item.contrato} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 8px", minWidth: 88 }}>
                    <div style={{ fontSize: 10, color: "#64748b" }}>{item.contrato}</div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>R$ {fmtPrice(prices[item.contrato])}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14, marginBottom: 16 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Posição em aberto</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <colgroup>
                <col style={{ width: 96 }} />
                <col style={{ width: 104 }} />
                <col style={{ width: 52 }} />
                <col style={{ width: 112 }} />
                <col style={{ width: 86 }} />
                <col style={{ width: 98 }} />
                <col style={{ width: 132 }} />
                <col style={{ width: 146 }} />
                <col style={{ width: 120 }} />
              </colgroup>
              <thead><tr><th className="L">Contrato</th><th className="L">Posição</th><th>Contr.</th><th>Entrada</th><th>Atual</th><th>Custos</th><th>Resultado</th><th className="L">Negócio / Rateio</th><th className="L">Detalhes</th></tr></thead>
              <tbody>
                {openPositions.length ? openPositions.map((position) => (
                  <tr key={`open-${position.id}`} style={positionRowStyle(position.lado)}>
                    <td className="L" style={{ fontWeight: 700 }}>{position.contrato}</td>
                    <td className="L"><span style={positionBadge(position.lado)}>{position.lado}</span></td>
                    <td>{position.contratos}</td>
                    <td>R$ {fmtPrice(position.entrada)}</td>
                    <td>R$ {fmtPrice(position.exit)}</td>
                    <td>{fmtCurrency(position.costs)}</td>
                    <td style={{ color: pnlColor(position.net), fontWeight: 700 }}>{fmtResult(position.net)}</td>
                    <td className="L">{position.negocio || "-"}</td>
                    <td className="L">{position.detalhes || "-"}</td>
                  </tr>
                )) : (
                  <tr><td className="L" colSpan="9" style={{ color: "#64748b" }}>Nenhuma posição em aberto.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Posições gravadas</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="edit-table">
              <colgroup>
                <col style={{ width: 96 }} />
                <col style={{ width: 106 }} />
                <col style={{ width: 52 }} />
                <col style={{ width: 132 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 72 }} />
                <col style={{ width: 86 }} />
                <col style={{ width: 84 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 126 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 72 }} />
              </colgroup>
              <thead><tr><th className="L">Contrato</th><th className="L">Posição</th><th>Contr.</th><th className="L">Datas</th><th className="L">Preços</th><th>Atual</th><th>Custos/@</th><th>Status</th><th className="L">Negócio / Rateio</th><th className="L">Detalhes</th><th>Resultado</th><th></th></tr></thead>
              <tbody>
                {openPositions.length ? openPositions.map((position) => (
                  <tr key={position.id} style={positionRowStyle(position.lado)}>
                    <td className="L"><select value={position.contrato} onChange={(event) => updatePosition(position.id, "contrato", event.target.value)} style={cellInputStyle}>{BGI_INDICES.map((item) => <option key={item.contrato}>{item.contrato}</option>)}</select></td>
                    <td className="L"><select className="row-position-select" value={position.lado} onChange={(event) => updatePosition(position.id, "lado", event.target.value)} style={{ ...cellInputStyle, ...positionBadge(position.lado), minWidth: "100%", borderRadius: 6, textAlign: "left" }}><option>Vendido</option><option>Comprado</option><option>Termo</option></select></td>
                    <td><input value={position.contratos} onChange={(event) => updatePosition(position.id, "contratos", event.target.value)} style={compactCellInputStyle} type="number" /></td>
                    <td>
                      <div className="stacked-cell">
                        <label className="stacked-field"><span className="stacked-label">Ent.</span><input value={position.dataEntrada} onChange={(event) => updatePosition(position.id, "dataEntrada", event.target.value)} style={compactCellInputStyle} type="date" /></label>
                        <label className="stacked-field"><span className="stacked-label">Saída</span><input value={position.dataSaida} onChange={(event) => updatePosition(position.id, "dataSaida", event.target.value)} style={compactCellInputStyle} type="date" /></label>
                      </div>
                    </td>
                    <td className="price-cell">
                      <div className="stacked-cell">
                        <label className="stacked-field"><span className="stacked-label">Ent.</span><input value={position.entrada} onChange={(event) => updatePosition(position.id, "entrada", event.target.value)} style={cellInputStyle} type="number" step="0.01" /></label>
                        <label className="stacked-field"><span className="stacked-label">Saída</span><input value={position.saida} onChange={(event) => updatePosition(position.id, "saida", event.target.value)} style={cellInputStyle} type="number" step="0.01" placeholder={fmtPrice(position.exit)} /></label>
                      </div>
                    </td>
                    <td>{fmtPrice(position.exit)}<div style={{ color: "#94a3b8", fontSize: 10 }}>{position.source}</div></td>
                    <td>
                      <div className="stacked-cell">
                        <label className="stacked-field"><span className="stacked-label">Cor.</span><input value={position.corretora} onChange={(event) => updatePosition(position.id, "corretora", event.target.value)} style={compactCellInputStyle} type="number" step="0.01" /></label>
                        <label className="stacked-field"><span className="stacked-label">Fin.</span><input value={position.finpec} onChange={(event) => updatePosition(position.id, "finpec", event.target.value)} style={compactCellInputStyle} type="number" step="0.01" /></label>
                      </div>
                    </td>
                    <td><select value={position.status} onChange={(event) => updatePosition(position.id, "status", event.target.value)} style={cellInputStyle}><option>Aberta</option><option>Fechada</option></select></td>
                    <td className="L"><textarea value={position.negocio} onChange={(event) => updatePosition(position.id, "negocio", event.target.value)} style={smallNotesStyle} placeholder="CF-26-009: 3 contratos" /></td>
                    <td className="L"><textarea value={position.detalhes} onChange={(event) => updatePosition(position.id, "detalhes", event.target.value)} style={smallNotesStyle} placeholder="Detalhes" /></td>
                    <td style={{ color: pnlColor(position.net), fontWeight: 700 }}>{fmtResult(position.net)}</td>
                    <td>
                      <button onClick={() => deletePosition(position.id)} style={{ border: "1px solid #fecaca", background: "#fff", color: "#b91c1c", borderRadius: 6, padding: "5px 8px", cursor: "pointer" }}>Excluir</button>
                    </td>
                  </tr>
                )) : (
                  <tr><td className="L" colSpan="12" style={{ color: "#64748b" }}>Nenhuma posição em aberto no momento.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14, marginTop: 16 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Histórico de posições encerradas</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
            {[
              ["Resultado consolidado", fmtResult(closedNet), pnlColor(closedNet)],
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
            <table className="history-table">
              <colgroup>
                <col style={{ width: 88 }} />
                <col style={{ width: 98 }} />
                <col style={{ width: 52 }} />
                <col style={{ width: 92 }} />
                <col style={{ width: 92 }} />
                <col style={{ width: 78 }} />
                <col style={{ width: 82 }} />
                <col style={{ width: 78 }} />
                <col style={{ width: 118 }} />
                <col style={{ width: 88 }} />
                <col style={{ width: 132 }} />
                <col style={{ width: 104 }} />
                <col style={{ width: 68 }} />
              </colgroup>
              <thead><tr><th className="L">Contrato</th><th className="L">Posição</th><th>Contr.</th><th>Entrada</th><th>Saída</th><th>Data saída</th><th>Corretora</th><th>Finpec</th><th>Resultado</th><th>Ganho/Perda</th><th className="L">Negócio / Rateio</th><th className="L">Detalhes</th><th></th></tr></thead>
              <tbody>
                {closedPositions.length ? closedPositions.map((position) => {
                  const editing = editingClosedIdSet.has(position.id);
                  return (
                    <tr key={`history-${position.id}`} style={positionRowStyle(position.lado)}>
                      <td className="L" style={{ fontWeight: 700 }}>
                        {editing ? (
                          <select value={position.contrato} onChange={(event) => updatePosition(position.id, "contrato", event.target.value)} style={cellInputStyle}>
                            {BGI_INDICES.map((item) => <option key={item.contrato}>{item.contrato}</option>)}
                          </select>
                        ) : position.contrato}
                      </td>
                      <td className="L">
                        {editing ? (
                          <select value={position.lado} onChange={(event) => updatePosition(position.id, "lado", event.target.value)} style={{ ...cellInputStyle, ...positionBadge(position.lado), minWidth: "100%", borderRadius: 6, textAlign: "left" }}>
                            <option>Vendido</option><option>Comprado</option><option>Termo</option>
                          </select>
                        ) : <span style={positionBadge(position.lado)}>{position.lado}</span>}
                      </td>
                      <td>{editing ? <input value={position.contratos} onChange={(event) => updatePosition(position.id, "contratos", event.target.value)} style={compactCellInputStyle} type="number" /> : position.contratos}</td>
                      <td>{editing ? <input value={position.entrada} onChange={(event) => updatePosition(position.id, "entrada", event.target.value)} style={cellInputStyle} type="number" step="0.01" /> : `R$ ${fmtPrice(position.entrada)}`}</td>
                      <td>{editing ? <input value={position.saida} onChange={(event) => updatePosition(position.id, "saida", event.target.value)} style={cellInputStyle} type="number" step="0.01" /> : `R$ ${fmtPrice(position.saida)}`}</td>
                      <td>{editing ? <input value={position.dataSaida} onChange={(event) => updatePosition(position.id, "dataSaida", event.target.value)} style={compactCellInputStyle} type="date" /> : fmtShortDate(position.dataSaida)}</td>
                      <td>{editing ? <input value={position.corretora} onChange={(event) => updatePosition(position.id, "corretora", event.target.value)} style={compactCellInputStyle} type="number" step="0.01" placeholder="R$/@" /> : fmtCurrency(position.brokerCost)}</td>
                      <td>{editing ? <input value={position.finpec} onChange={(event) => updatePosition(position.id, "finpec", event.target.value)} style={compactCellInputStyle} type="number" step="0.01" placeholder="R$/@" /> : fmtCurrency(position.finpecCost)}</td>
                      <td style={{ color: pnlColor(position.net), fontWeight: 700 }}>{fmtResult(position.net)}</td>
                      <td style={{ color: pnlColor(position.net), fontWeight: 700 }}>{outcomeLabel(position.net)}</td>
                      <td className="L">{editing ? <textarea value={position.negocio} onChange={(event) => updatePosition(position.id, "negocio", event.target.value)} style={smallNotesStyle} placeholder="CF-26-009: 3 contratos" /> : (position.negocio || "-")}</td>
                      <td className="L">{editing ? <textarea value={position.detalhes} onChange={(event) => updatePosition(position.id, "detalhes", event.target.value)} style={smallNotesStyle} placeholder="Detalhes" /> : (position.detalhes || "-")}</td>
                      <td>
                        {editing ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <button onClick={() => finishEditingPosition(position.id)} style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#15803d", borderRadius: 6, padding: "5px 7px", cursor: "pointer", fontSize: 11 }}>Concluir</button>
                            <button onClick={() => deletePosition(position.id)} style={{ border: "1px solid #fecaca", background: "#fff", color: "#b91c1c", borderRadius: 6, padding: "5px 7px", cursor: "pointer", fontSize: 11 }}>Excluir</button>
                          </div>
                        ) : (
                          <button onClick={() => editClosedPosition(position.id)} style={{ border: "1px solid #cbd5e1", background: "#fff", color: "#334155", borderRadius: 6, padding: "5px 7px", cursor: "pointer", fontSize: 11 }}>Editar</button>
                        )}
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td className="L" colSpan="13" style={{ color: "#64748b" }}>Preencha a saída ou marque a posição como fechada para aparecer no histórico.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14, marginTop: 16 }}>
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

        <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14, marginTop: 16 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Nova posição</h2>
          <div className="new-position-grid">
            <select value={draft.contrato} onChange={(event) => updateDraft("contrato", event.target.value)} style={inputStyle}>{BGI_INDICES.map((item) => <option key={item.contrato}>{item.contrato}</option>)}</select>
            <select value={draft.lado} onChange={(event) => updateDraft("lado", event.target.value)} style={inputStyle}><option>Vendido</option><option>Comprado</option><option>Termo</option></select>
            <input value={draft.contratos} onChange={(event) => updateDraft("contratos", event.target.value)} style={inputStyle} type="number" min="1" placeholder="Contratos" />
            <input value={draft.dataEntrada} onChange={(event) => updateDraft("dataEntrada", event.target.value)} style={inputStyle} type="date" title="Data da entrada" />
            <input value={draft.entrada} onChange={(event) => updateDraft("entrada", event.target.value)} style={inputStyle} type="number" step="0.01" placeholder="Entrada" />
            <input value={draft.dataSaida} onChange={(event) => updateDraft("dataSaida", event.target.value)} style={inputStyle} type="date" title="Data da saída" />
            <input value={draft.saida} onChange={(event) => updateDraft("saida", event.target.value)} style={inputStyle} type="number" step="0.01" placeholder="Saída" />
            <input value={draft.corretora} onChange={(event) => updateDraft("corretora", event.target.value)} style={inputStyle} type="number" step="0.01" placeholder="Corretora/arroba" />
            <input value={draft.finpec} onChange={(event) => updateDraft("finpec", event.target.value)} style={inputStyle} type="number" step="0.01" placeholder="Finpec/arroba" />
            <select value={draft.status} onChange={(event) => updateDraft("status", event.target.value)} style={inputStyle}><option>Aberta</option><option>Fechada</option></select>
            <textarea value={draft.negocio} onChange={(event) => updateDraft("negocio", event.target.value)} style={notesStyle} placeholder="Negócio / rateio. Ex.: CF-26-009: 3 contratos; CF-26-010: 2 contratos" />
            <textarea value={draft.detalhes} onChange={(event) => updateDraft("detalhes", event.target.value)} style={{ ...notesStyle, gridColumn: "1 / -1" }} placeholder="Detalhes da operação" />
            <button onClick={addPosition} style={{ border: 0, background: "#2563eb", color: "#fff", borderRadius: 6, padding: "8px 10px", cursor: "pointer", gridColumn: "1 / -1", justifySelf: "end", minWidth: 128 }}>Gravar</button>
          </div>
        </section>
      </div>
    </div>
  );
}
