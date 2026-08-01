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
    headers.forEach((h, i) => {
      let v = row[i];
      // مهم جداً (نقطتان معاً هنا):
      // 1) جسر google.script.run الداخلي يفشل بصمت (يُرجع null للعميل بلا أي
      //    خطأ) عند إرجاع كائنات Date حقيقية متداخلة داخل مصفوفات كبيرة عبر
      //    return عادي - لذا يجب تحويلها لنص دائماً قبل إرجاعها. راجع CLAUDE.md §8.4.
      // 2) لا تستخدم v.toISOString() لهذا التحويل! هذه الدالة تحوّل إلى UTC،
      //    بينما تاريخ الشيت مخزَّن كمنتصف ليل بتوقيت المشروع (Asia/Qatar,
      //    UTC+3) - فيُرجع toISOString() اليوم السابق (مثال: تاريخ الشيت
      //    2026-06-29 يصبح "2026-06-28T21:00:00.000Z"). هذا خلل حقيقي ظهر في
      //    الإنتاج (كل التواريخ تأخرت يوماً كاملاً). الحل: تنسيق التاريخ محلياً
      //    بتوقيت المشروع مباشرة كنص 'yyyy-MM-dd' (تاريخ تقويمي فقط، بلا وقت -
      //    وهو كل ما تحتاجه أعمدة Date في هذا المشروع أصلاً).
      if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Qatar', 'yyyy-MM-dd');
      obj[h] = v;
    });
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

/**
 * يحوّل قيمة تاريخ (نص ISO أو كائن Date) إلى صيغة 'yyyy-MM-dd' بتوقيت
 * المشروع (Asia/Qatar)، لمقارنة التواريخ بشكل صحيح ومتّسق. مشتركة بين
 * ReportsOperations.gs (فلترة نطاق زمني) وgetTodayActivity() هنا.
 */
function dateOnly_(dateVal) {
  if (!dateVal) return '';
  const d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal).slice(0, 10);
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Qatar', 'yyyy-MM-dd');
}

/**
 * ملخص "نشاط اليوم" (العمليات اليدوية المُدخَلة بتاريخ اليوم) عبر كل
 * المراحل الخمس - يُستخدم في بطاقة أعلى صفحتي الإدخال والتقارير.
 * متاح لأي مستخدم مسجّل دخول (كل الأدوار الثلاثة)، لذا يعيش هنا في
 * SheetService.gs (الطبقة المشتركة) وليس في EntryOperations.gs أو
 * ReportsOperations.gs تحديداً - تفادياً لأي استدعاء مباشر بين الملفين
 * (راجع قاعدة الاتصال بين الخدمات في CLAUDE.md §3).
 */
function getTodayActivity(token) {
  requireSession_(token);
  const today = dateOnly_(new Date());

  const todayRows_ = (sheetName) => readSheetAsObjects_(sheetName).filter(r => dateOnly_(r.Date) === today);
  const sumOf_ = (rows, field) => Math.round(rows.reduce((s, r) => s + (Number(r[field]) || 0), 0) * 1000) / 1000;

  const raw = todayRows_(SHEETS.RAW_RECEIVED);
  const sent = todayRows_(SHEETS.SENT_ROASTERY);
  const received = todayRows_(SHEETS.RECEIVED_ROASTERY);
  const packing = todayRows_(SHEETS.PACKING);
  const finished = todayRows_(SHEETS.FINISHED);
  const delivery = todayRows_(SHEETS.DELIVERIES);

  return {
    date: today,
    rawReceived: { count: raw.length, quantityKg: sumOf_(raw, 'QuantityKg') },
    sentToRoastery: { count: sent.length, quantityKg: sumOf_(sent, 'QuantityKg') },
    receivedFromRoastery: { count: received.length, quantityKg: sumOf_(received, 'ReceivedQuantityKg') },
    packing: { count: packing.length, bagsProduced: sumOf_(packing, 'BagsProduced') },
    finished: { count: finished.length, bagsAdded: sumOf_(finished, 'BagsAdded') },
    delivery: { count: delivery.length, bagsDelivered: sumOf_(delivery, 'BagsDelivered') },
    totalOperations: raw.length + sent.length + received.length + packing.length + finished.length + delivery.length
  };
}

function writeAudit_(username, action, details) {
  const sheet = getSheet_(SHEETS.AUDIT);
  sheet.appendRow([new Date(), username, action, details]);
}

/**
 * ينفّذ دالة (fn) داخل قفل حصري على مستوى المشروع كاملاً (LockService).
 * ضروري لأي عملية من نوع "تحقق من الرصيد ثم اكتب" (check-then-write) —
 * بدونه، طلبان متزامنان (مثال حقيقي: نقرة مزدوجة على زر الحفظ من الهاتف)
 * قد يقرآن نفس الرصيد قبل أن يكتب أيّ منهما، فيتجاوز أحدهما التحقق رغم أن
 * المجموع الفعلي يتجاوز المتاح. تم اكتشاف هذا الخلل فعلياً وإصلاحه هنا.
 * إن لم يُحرَّر القفل خلال 10 ثوانٍ (ازدحام حقيقي غير متوقع)، يُرمى خطأ
 * واضح للمستخدم بدل تعليق الطلب إلى ما لا نهاية.
 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error('الخادم مشغول حالياً، الرجاء المحاولة مرة أخرى بعد لحظات / Server is busy, please try again in a moment');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
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
    .reduce((s, r) => s + (Number(r.QuantityKg) || 0), 0);
}

/** Total kg already sent to the roastery, optionally filtered by CoffeeType. */
function sumSentToRoastery_(coffeeType) {
  return readSheetAsObjects_(SHEETS.SENT_ROASTERY)
    .filter(r => !coffeeType || r.CoffeeType === coffeeType)
    .reduce((s, r) => s + (Number(r.QuantityKg) || 0), 0);
}

/** Raw beans available in warehouse, not yet sent to roastery (per type). */
function getRawStockBalance_(coffeeType) {
  return sumRawReceived_(coffeeType) - sumSentToRoastery_(coffeeType);
}

/** Total kg received back from roastery (ground/roasted). */
function sumReceivedFromRoastery_() {
  return readSheetAsObjects_(SHEETS.RECEIVED_ROASTERY)
    .reduce((s, r) => s + (Number(r.ReceivedQuantityKg) || 0), 0);
}

/** Total kg "reconciled" via the auto-estimated SentQuantityKg field (see getAtRoasteryBalance_). */
function sumReceivedFromRoasterySentField_() {
  return readSheetAsObjects_(SHEETS.RECEIVED_ROASTERY)
    .reduce((s, r) => s + (Number(r.SentQuantityKg) || 0), 0);
}

/**
 * الكمية الخام المرسلة للتحميص ولم تُرجَع بعد كمنتج محمص ("عند المحمصة حالياً").
 * = إجمالي ما أُرسل على الإطلاق - إجمالي ما "تمّت تسويته" عبر التقدير التلقائي
 * لعمود SentQuantityKg (راجع submitReceivedFromRoastery في EntryOperations.gs).
 *
 * ⚠️ ملاحظة تصميمية مهمة (تاريخ القرارات، حتى لا يتكرر نفس الخطأ):
 * جُرِّب سابقاً حساب هذا الرصيد بمقارنة إجمالي الشيتين مباشرة
 * (Σ Sent - Σ Received.ReceivedQuantityKg) بهدف تبسيط النموذج وتفادي تخمين
 * المستخدم اليدوي لـ"الكمية المرسلة". لكن تبيّن أن هذا **خطأ فعلي** ظهر في
 * الإنتاج: الفرق (Σ Sent - Σ Received) يخلط بين "خام لا يزال فعلياً عند
 * المحمصة" و"هدر تراكمي من دفعات اكتملت بالفعل" - فمثلاً إرسال 100كغ
 * واستلامها بالكامل 88كغ (هدر طبيعي 12%) يجب أن يُصفّر الرصيد (لا شيء متبقٍ
 * فعلياً)، لكن تلك الصيغة كانت تُبقيه عالقاً عند 12كغ وهمية للأبد.
 * الحل الحالي: SentQuantityKg يُقدَّر تلقائياً عند كل استلام عبر متوسط نسبة
 * الهدر (Config.AverageRoastingWastePercent) بدل تخمين المستخدم اليدوي -
 * هذا يُصفّر الرصيد بشكل صحيح تلقائياً مع بقاء العملية بسيطة (المستخدم يُدخل
 * الكمية المستلمة فقط). لا تُعِد الصيغة المبسّطة القديمة (Sent - Received)
 * دون نقاش صريح، فقد ثبت خطؤها فعلياً.
 */
function getAtRoasteryBalance_() {
  return sumSentToRoastery_() - sumReceivedFromRoasterySentField_();
}

/** Total kg sent into packing (input side). */
function sumPackingInput_() {
  return readSheetAsObjects_(SHEETS.PACKING)
    .reduce((s, r) => s + (Number(r.InputQuantityKg) || 0), 0);
}

/** Roasted & ground coffee available in stock (not yet sent to packing). */
function getRoastedStockBalance_() {
  return sumReceivedFromRoastery_() - sumPackingInput_();
}

/** Total bags produced by the packing stage (moved to finished-goods stock). */
function sumBagsProduced_() {
  return readSheetAsObjects_(SHEETS.PACKING)
    .reduce((s, r) => s + (Number(r.BagsProduced) || 0), 0);
}

/** Total bags already registered as finished product. */
function sumBagsFinished_() {
  return readSheetAsObjects_(SHEETS.FINISHED)
    .reduce((s, r) => s + (Number(r.BagsAdded) || 0), 0);
}

/** Bags produced by packing but not yet confirmed as finished product ("نصف جاهزة"). */
function getPackingInProgressBags_() {
  return sumBagsProduced_() - sumBagsFinished_();
}

/** Total bags already registered as delivered to customers. */
function sumBagsDelivered_() {
  return readSheetAsObjects_(SHEETS.DELIVERIES)
    .reduce((s, r) => s + (Number(r.BagsDelivered) || 0), 0);
}

/** المخزون الجاهز المتاح فعلياً للتسليم الآن (منتج نهائي مُسجَّل - ما تم تسليمه بالفعل). */
function getFinishedStockBalance_() {
  return sumBagsFinished_() - sumBagsDelivered_();
}
