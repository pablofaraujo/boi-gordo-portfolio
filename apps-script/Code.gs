const SPREADSHEET_ID = "COLE_AQUI_O_ID_DA_PLANILHA";
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

function doGet(event) {
  const action = event.parameter.action || "list";
  if (action === "quotes") return jsonResponse({ ok: true, quotes: readRows(QUOTES_SHEET, QUOTE_HEADERS) });
  return jsonResponse({ ok: true, positions: readRows(POSITIONS_SHEET, POSITION_HEADERS) });
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
      item[header] = row[index];
      return item;
    }, {});
  });
}

function writeRows(sheetName, headers, rows) {
  const sheet = ensureSheet(sheetName, headers);
  const now = new Date().toISOString();
  const values = rows.map((row) => {
    return headers.map((header) => header === "updatedAt" ? now : row[header] || "");
  });
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (values.length) sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  sheet.setFrozenRows(1);
}

function ensureSheet(sheetName, headers) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
