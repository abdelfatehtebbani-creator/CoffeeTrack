/**
 * Setup.gs
 * -------------------------------------------------------------
 * Central constants + one-time spreadsheet initialization.
 * Run initializeSpreadsheet() ONCE (from the Apps Script editor,
 * select the function and press Run) to create every sheet with
 * its headers and seed default Config / Users rows.
 * -------------------------------------------------------------
 */

// ===== Spreadsheet ID =====
// ضع معرّف الـ Google Sheet هنا (مطلوب دائماً مع clasp/standalone script).
// كيف تجده: افتح الـ Google Sheet في المتصفح، انسخ الجزء بين
// /d/  و  /edit  من الرابط:
// https://docs.google.com/spreadsheets/d/  1AbCDeFGhiJKLmnoPQRstuVWXyz1234567890AbC  /edit
//                                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ هذا هو الـ ID
// اترك '' فارغاً فقط إذا كان المشروع مرتبطاً مباشرة بالشيت
// (Container-bound: أنشأته من داخل الشيت عبر Extensions > Apps Script).
const SPREADSHEET_ID = '1mwRfPsZXXEvrkBDCiPafiG7bqfAdKJL6ff4orW-7XSc';

// ===== Sheet names (single source of truth) =====
const SHEETS = {
  CONFIG: 'Config',
  USERS: 'Users',
  RAW_RECEIVED: 'RawMaterial_Received',
  SENT_ROASTERY: 'Sent_to_Roastery',
  RECEIVED_ROASTERY: 'Received_from_Roastery',
  PACKING: 'Packing_Process',
  FINISHED: 'Finished_Products',
  DELIVERIES: 'Deliveries',
  ORDERS: 'Orders',
  AUDIT: 'AuditLog'
};

const ROLES = {
  ADMIN: 'Admin',
  DATA_ENTRY: 'DataEntry',
  ACCOUNTANT: 'Accountant'
};

const ORDER_STATUSES = {
  PENDING: 'قيد الانتظار',
  IN_PRODUCTION: 'قيد الإنتاج',
  READY: 'جاهزة',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغاة'
};

const BAG_SIZE_KG = 0.2; // 200g bag - default, also stored in Config sheet

/**
 * Creates all required sheets (if missing) with headers,
 * and seeds default Config values + a default Admin user.
 * Safe to re-run: it will NOT duplicate sheets or overwrite data.
 */
function initializeSpreadsheet() {
  const ss = getSS_();

  createSheetIfMissing_(ss, SHEETS.CONFIG, ['Key', 'Value', 'Notes']);
  createSheetIfMissing_(ss, SHEETS.USERS, ['Username', 'Password', 'FullName', 'Role', 'Active']);
  createSheetIfMissing_(ss, SHEETS.RAW_RECEIVED,
    ['ID', 'Date', 'CoffeeType', 'QuantityKg', 'Supplier', 'Notes', 'EnteredBy', 'Timestamp']);
  createSheetIfMissing_(ss, SHEETS.SENT_ROASTERY,
    ['ID', 'Date', 'CoffeeType', 'QuantityKg', 'BatchRef', 'Notes', 'EnteredBy', 'Timestamp']);
  createSheetIfMissing_(ss, SHEETS.RECEIVED_ROASTERY,
    ['ID', 'Date', 'BatchRef', 'SentQuantityKg', 'ReceivedQuantityKg', 'WasteKg', 'WastePercent', 'Notes', 'EnteredBy', 'Timestamp']);
  createSheetIfMissing_(ss, SHEETS.PACKING,
    ['ID', 'Date', 'BatchRef', 'InputQuantityKg', 'BagsProduced', 'ExpectedOutputKg', 'WasteKg', 'WastePercent', 'Notes', 'EnteredBy', 'Timestamp']);
  createSheetIfMissing_(ss, SHEETS.FINISHED,
    ['ID', 'Date', 'BatchRef', 'BagsAdded', 'ProductName', 'Notes', 'EnteredBy', 'Timestamp']);
  createSheetIfMissing_(ss, SHEETS.DELIVERIES,
    ['ID', 'Date', 'BatchRef', 'BagsDelivered', 'Customer', 'Notes', 'EnteredBy', 'Timestamp']);
  createSheetIfMissing_(ss, SHEETS.ORDERS,
    ['ID', 'OrderDate', 'CustomerName', 'BagsOrdered', 'ExpectedDeliveryDate', 'Status', 'LinkedDeliveryBatchRef', 'Notes', 'EnteredBy', 'Timestamp']);
  createSheetIfMissing_(ss, SHEETS.AUDIT,
    ['Timestamp', 'Username', 'Action', 'Details']);

  seedConfig_(ss);
  seedAdminUser_(ss);

  SpreadsheetApp.flush();
  return 'تم إعداد الجداول بنجاح / Spreadsheet initialized successfully';
}

function createSheetIfMissing_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#4a2c1d').setFontColor('#ffffff');
    sheet.autoResizeColumns(1, headers.length);
  }
  return sheet;
}

function seedConfig_(ss) {
  const sheet = ss.getSheetByName(SHEETS.CONFIG);
  if (sheet.getLastRow() > 1) return; // already seeded

  const defaults = [
    ['BagSizeKg', '0.2', 'حجم الكيس الواحد بالكيلوغرام / Bag size in kg'],
    ['CoffeeType1', 'Arabica', 'الصنف الأول / Coffee type 1'],
    ['CoffeeType2', 'Robusta', 'الصنف الثاني / Coffee type 2'],
    ['AverageRoastingWastePercent', '12', 'متوسط نسبة هدر التحميص المُعتمَد لتقدير "الكمية المرسلة" تلقائياً عند الاستلام - حدّثه دورياً ليطابق الواقع الفعلي (راجع نسبة الهدر الإجمالية الحقيقية في التقارير) / Average roasting waste % used to auto-estimate "Sent Quantity" on receipt - update periodically to match actual observed waste in reports'],
    ['AveragePackingWastePercent', '2', 'متوسط نسبة هدر التعبئة المُعتمَد لحسابات التنبؤات في التقارير - حدّثه دورياً ليطابق الواقع الفعلي / Average packing waste % used for forecast calculations in Reports - update periodically to match actual observed waste'],
    ['MaxRoastingWastePercent', '20', 'حد تحذير نسبة هدر التحميص / Warning threshold %'],
    ['MaxPackingWastePercent', '5', 'حد تحذير نسبة هدر التعبئة / Warning threshold %']
  ];
  defaults.forEach(row => sheet.appendRow(row));
}

function seedAdminUser_(ss) {
  const sheet = ss.getSheetByName(SHEETS.USERS);
  if (sheet.getLastRow() > 1) return; // already has users

  // Default admin - CHANGE THE PASSWORD IMMEDIATELY AFTER FIRST LOGIN
  sheet.appendRow(['admin', 'admin123', 'System Admin', ROLES.ADMIN, true]);
}
