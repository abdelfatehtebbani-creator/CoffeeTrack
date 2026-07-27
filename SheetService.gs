/**
 * SheetService.gs
 * -------------------------------------------------------------
 * Generic data-access layer. Every function that touches a Sheet
 * goes through here so the rest of the code never calls
 * SpreadsheetApp directly. Keeps read/write logic in one place.
 * -------------------------------------------------------------
 */

function getSS_() {
  // إذا كان SPREADSHEET_ID محدَّداً (وليس القيمة الافتراضية)، افتح ذلك الشيت تحديداً.
  // هذا مطلوب لمشاريع clasp المستقلة (standalone) التي لا ترتبط تلقائياً بأي شيت.
  if (SPREADSHEET_ID && SPREADSHEET_ID !== 'PASTE_YOUR_SPREADSHEET_ID_HERE') {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  // وإلا، حاول استخدام الشيت المرتبط بالمشروع (Container-bound script فقط).
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error(
      'لم يتم تحديد SPREADSHEET_ID في Setup.gs، والمشروع غير مرتبط بأي شيت. ' +
      'الرجاء وضع معرّف الشيت في متغيّر SPREADSHEET_ID أعلى ملف Setup.gs. / ' +
      'SPREADSHEET_ID is not set in Setup.gs, and this is not a container-bound script. ' +
      'Please set SPREADSHEET_ID at the top of Setup.gs.'
    );
  }
  return active;
}

function getSheet_(name) {
  const sheet = getSS_().getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

/** Reads a sheet fully and returns an array of plain objects keyed by header row. */
function readSheetAsObjects_(sheetName) {
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  return values.map((row, idx) => {
    const obj = { _row: idx + 2 }; // actual sheet row number, useful for updates
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

/** Appends a row built from an object + header order, returns the generated ID. */
function appendRow_(sheetName, dataObj) {
  const sheet = getSheet_(sheetName);
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  const newId = generateId_(sheetName);
  dataObj.ID = newId;
  dataObj.Timestamp = new Date();

  const row = headers.map(h => (dataObj[h] !== undefined ? dataObj[h] : ''));
  sheet.appendRow(row);
  return newId;
}

/** Simple incrementing ID per sheet: PREFIX-000123 */
function generateId_(sheetName) {
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  const prefix = sheetName.substring(0, 3).toUpperCase();
  return prefix + '-' + Utilities.formatString('%06d', lastRow); // lastRow before append = next seq
}

function writeAudit_(username, action, details) {
  const sheet = getSheet_(SHEETS.AUDIT);
  sheet.appendRow([new Date(), username, action, details]);
}

/** Reads Config sheet into a simple {key: value} map. */
function getConfigMap_() {
  const rows = readSheetAsObjects_(SHEETS.CONFIG);
  const map = {};
  rows.forEach(r => map[r.Key] = r.Value);
  return map;
}

// ===================================================================
// BALANCE CALCULATIONS
// Each stage's available balance = sum(inputs to that stage)
//                                 - sum(outputs already consumed from it)
// This is what powers both the strict validation on entry
// and the "available stock" report figures.
// ===================================================================

/** Total kg received from supplier, optionally filtered by CoffeeType. */
function sumRawReceived_(coffeeType) {
  return readSheetAsObjects_(SHEETS.RAW_RECEIVED)
    .filter(r => !coffeeType || r.CoffeeType === coffeeType)
    .reduce((s, r) => s + Number(r.QuantityKg || 0), 0);
}

/** Total kg already sent to the roastery, optionally filtered by CoffeeType. */
function sumSentToRoastery_(coffeeType) {
  return readSheetAsObjects_(SHEETS.SENT_ROASTERY)
    .filter(r => !coffeeType || r.CoffeeType === coffeeType)
    .reduce((s, r) => s + Number(r.QuantityKg || 0), 0);
}

/** Raw beans available in warehouse, not yet sent to roastery (per type). */
function getRawStockBalance_(coffeeType) {
  return sumRawReceived_(coffeeType) - sumSentToRoastery_(coffeeType);
}

/** Total kg received back from roastery (ground/roasted). */
function sumReceivedFromRoastery_() {
  return readSheetAsObjects_(SHEETS.RECEIVED_ROASTERY)
    .reduce((s, r) => s + Number(r.ReceivedQuantityKg || 0), 0);
}

/** Total kg already "reconciled" (accounted for) via Received rows' SentQuantityKg field. */
function sumReceivedFromRoasterySentField_() {
  return readSheetAsObjects_(SHEETS.RECEIVED_ROASTERY)
    .reduce((s, r) => s + Number(r.SentQuantityKg || 0), 0);
}

/**
 * الكمية الخام التي أُرسلت للتحميص ولم يُسجَّل استلامها بعد ("عند المحمصة حالياً").
 * = إجمالي ما أُرسل - إجمالي ما تمّت مطابقته (تسويته) عبر صفوف الاستلام حتى الآن.
 * هذا هو الرصيد الذي يجب أن يُقارَن به SentQuantityKg عند كل عملية استلام جديدة،
 * بغض النظر عن كون المحمصة تُرجع الكمية دفعة واحدة، مجزّأة، أو مخلوطة من عدة إرسالات.
 */
function getAtRoasteryBalance_() {
  return sumSentToRoastery_() - sumReceivedFromRoasterySentField_();
}

/** Total kg sent into packing (input side). */
function sumPackingInput_() {
  return readSheetAsObjects_(SHEETS.PACKING)
    .reduce((s, r) => s + Number(r.InputQuantityKg || 0), 0);
}

/** Roasted & ground coffee available in stock (not yet sent to packing). */
function getRoastedStockBalance_() {
  return sumReceivedFromRoastery_() - sumPackingInput_();
}

/** Total bags produced by the packing stage (moved to finished-goods stock). */
function sumBagsProduced_() {
  return readSheetAsObjects_(SHEETS.PACKING)
    .reduce((s, r) => s + Number(r.BagsProduced || 0), 0);
}

/** Total bags already registered as finished product. */
function sumBagsFinished_() {
  return readSheetAsObjects_(SHEETS.FINISHED)
    .reduce((s, r) => s + Number(r.BagsAdded || 0), 0);
}

/** Bags produced by packing but not yet confirmed as finished product ("نصف جاهزة"). */
function getPackingInProgressBags_() {
  return sumBagsProduced_() - sumBagsFinished_();
}
