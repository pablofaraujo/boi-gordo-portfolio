const SPREADSHEET_ID = "13LsUgNLBRlhGjx65Va0523bhyVC287bi1XCQOImdS-o";
const POSITIONS_SHEET = "positions";
const QUOTES_SHEET = "quotes";

const POSITION_HEADERS = [
  "id",
  "contrato",
  "mes",
  "lado",
  "contratos",
  "entrada",
  "saida",
  "dataEntrada",
  "dataSaida",
  "corretora",
  "finpec",
  "status",
  "negocio",
  "detalhes",
  "updatedAt",
];

const QUOTE_HEADERS = ["contrato", "vencimento", "mes", "fechamento", "updatedAt", "source"];
const TEXT_HEADERS = new Set(["id", "contrato", "mes", "lado", "dataEntrada", "dataSaida", "status", "negocio", "detalhes", "updatedAt", "vencimento", "source"]);
const MES_BY_CONTRACT = {
  BGIM26: "Junho/26",
  BGIN26: "Julho/26",
  BGIU26: "Setembro/26",
  BGIV26: "Outubro/26",
};

function doGet(event) {
  const action = (event && event.parameter && event.parameter.action) || "list";
  const callback = event && event.parameter && event.parameter.callback;
  if (action === "quotes") return jsonResponse({ ok: true, quotes: readRows(QUOTES_SHEET, QUOTE_HEADERS) }, callback);
  return jsonResponse({ ok: true, positions: readRows(POSITIONS_SHEET, POSITION_HEADERS) }, callback);
}

function doPost(event) {
  const payload = JSON.parse((event.postData && event.postData.contents) || "{}");
  if (payload.action === "savePositions") {
    const positions = Array.isArray(payload.positions) ? payload.positions : [];
    writeRows(POSITIONS_SHEET, POSITION_HEADERS, positions);
    return jsonResponse({ ok: true, count: positions.length });
  }
  if (payload.action === "saveQuotes") {
    const quotes = Array.isArray(payload.quotes) ? payload.quotes : [];
    writeRows(QUOTES_SHEET, QUOTE_HEADERS, quotes);
    return jsonResponse({ ok: true, count: quotes.length });
  }
  return jsonResponse({ ok: false, error: "Acao desconhecida" });
}

function readRows(sheetName, headers) {
  const sheet = ensureSheet(sheetName, headers);
  const values = sheet.getDataRange().getValues();
  return values.slice(1).filter((row) => row.some((value) => value !== "")).map((row) => {
    return headers.reduce((item, header, index) => {
      item[header] = valueToJson(row[index], header, row);
      return item;
    }, {});
  });
}

function writeRows(sheetName, headers, rows) {
  const sheet = ensureSheet(sheetName, headers);
  const now = new Date().toISOString();
  formatTextColumns(sheet, headers);
  const values = rows.map((row) => {
    return headers.map((header) => {
      const value = header === "updatedAt" ? now : row[header];
      if (value === undefined || value === null) return "";
      return TEXT_HEADERS.has(header) ? String(value) : value;
    });
  });
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (values.length) sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  sheet.setFrozenRows(1);
}

function ensureSheet(sheetName, headers) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
  formatTextColumns(sheet, headers);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}

function formatTextColumns(sheet, headers) {
  headers.forEach((header, index) => {
    if (TEXT_HEADERS.has(header)) sheet.getRange(1, index + 1, sheet.getMaxRows(), 1).setNumberFormat("@");
  });
}

function valueToJson(value, header, row) {
  if (header === "mes") return MES_BY_CONTRACT[String(row[1] || "").toUpperCase()] || value;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value;
}

function jsonResponse(payload, callback) {
  const body = callback ? `${callback}(${JSON.stringify(payload)});` : JSON.stringify(payload);
  return ContentService
    .createTextOutput(body)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}
