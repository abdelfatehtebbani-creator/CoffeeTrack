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

// ===================================================================
// تحديث صف موجود بواسطة ID (يُستخدم لتحديث حالة الطلبيات - Orders)
// ===================================================================

/** يبحث عن رقم الصف (row number) الذي يحمل ID معيّناً في العمود الأول. يُرجع null إن لم يوجد. */
function findRowNumberById_(sheetName, id) {
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return null;
}

/** يحدّث قيمة عمود واحد لصف مُحدَّد بواسطة ID (يبحث عن اسم العمود ضمن رؤوس الشيت). */
function updateCellByRowId_(sheetName, id, columnName, newValue) {
  const sheet = getSheet_(sheetName);
  const rowNum = findRowNumberById_(sheetName, id);
  if (!rowNum) throw new Error('لم يُعثر على السجل / Record not found: ' + id);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colIndex = headers.indexOf(columnName);
  if (colIndex === -1) throw new Error('العمود غير موجود / Column not found: ' + columnName);
  sheet.getRange(rowNum, colIndex + 1).setValue(newValue);
}

// ===================================================================
// النسبة الفعلية التاريخية (وليست تخميناً) — مبنية 100% على بيانات حقيقية
// موجودة فعلاً، بلا أي افتراض. تُعرَض في واجهة "التنبؤات" كقيمة مقترحة
// قابلة للتعديل بدل رقم Config ثابت يدخله المستخدم يدوياً بلا سند فعلي.
// ===================================================================
function getActualHistoricalWasteRates_() {
  const totalSent = sumSentToRoastery_();
  const totalReceived = sumReceivedFromRoastery_();
  const actualRoastWastePercent = totalSent > 0
    ? Math.round(((totalSent - totalReceived) / totalSent) * 10000) / 100
    : null; // null = لا توجد بيانات كافية بعد لحساب متوسط حقيقي

  const packingRows = readSheetAsObjects_(SHEETS.PACKING);
  const totalPackingInput = packingRows.reduce((s, r) => s + (Number(r.InputQuantityKg) || 0), 0);
  const totalBagsProduced = packingRows.reduce((s, r) => s + (Number(r.BagsProduced) || 0), 0);
  const bagSizeKg = (Number(getConfigMap_().BagSizeKg) || 0.2);
  const totalExpectedOutputKg = totalBagsProduced * bagSizeKg;
  const actualPackWastePercent = totalPackingInput > 0
    ? Math.round(((totalPackingInput - totalExpectedOutputKg) / totalPackingInput) * 10000) / 100
    : null;

  return {
    actualRoastWastePercent: actualRoastWastePercent,
    actualPackWastePercent: actualPackWastePercent,
    hasEnoughRoastData: totalSent > 0,
    hasEnoughPackData: totalPackingInput > 0
  };
}

// ===================================================================
// محرك التنبؤ الأساسي (Pipeline Forecast) — دالة حساب داخلية بحتة، بلا أي
// تحقق من الصلاحيات. تُستدعى من كل من reportForecast() (ReportsOperations.gs،
// Admin/Accountant) وgetActiveOrders() (EntryOperations.gs، أي دور)، تفادياً
// لتكرار المنطق ولاتصال مباشر بين الملفين (راجع CLAUDE.md §3).
//
// @param {number|string} [roastWasteOverride] - نسبة هدر تحميص تتجاوز
//   Config.AverageRoastingWastePercent لهذا الحساب فقط (لا تُكتَب في Config).
//   عادة تكون النسبة الفعلية التاريخية المحسوبة (getActualHistoricalWasteRates_)
//   أو رقم يدوي اختاره المستخدم في واجهة التنبؤات.
// @param {number|string} [packWasteOverride] - نفس الفكرة لهدر التعبئة.
// ===================================================================
function computePipelineForecast_(roastWasteOverride, packWasteOverride) {
  const cfg = getConfigMap_();
  const type1 = cfg.CoffeeType1, type2 = cfg.CoffeeType2;
  const bagSizeKg = (Number(cfg.BagSizeKg) || 0.2);

  const hasRoastOverride = roastWasteOverride !== undefined && roastWasteOverride !== null && roastWasteOverride !== '';
  const hasPackOverride = packWasteOverride !== undefined && packWasteOverride !== null && packWasteOverride !== '';
  const avgRoastWaste = (hasRoastOverride ? (Number(roastWasteOverride) || 0) : (Number(cfg.AverageRoastingWastePercent) || 12)) / 100;
  const avgPackWaste = (hasPackOverride ? (Number(packWasteOverride) || 0) : (Number(cfg.AveragePackingWastePercent) || 2)) / 100;

  const rawKgByType = { [type1]: getRawStockBalance_(type1), [type2]: getRawStockBalance_(type2) };
  const rawKgTotal = rawKgByType[type1] + rawKgByType[type2];
  const atRoasteryKg = getAtRoasteryBalance_();
  const roastedAvailableKg = getRoastedStockBalance_();
  const packingInProgressBags = getPackingInProgressBags_();
  const finishedAvailableBags = getFinishedStockBalance_();

  // سؤال 1: القهوة المحمصة المتوفرة الآن (جاهزة للتعبئة) → كم كيس ستنتج؟
  const bagsFromRoastedAvailable = Math.floor((roastedAvailableKg * (1 - avgPackWaste)) / bagSizeKg);

  // سؤال 2: عند استنفاذ كامل المخزون (خام + عند المحمصة + محمص متوفر)
  const projectedRoastedFromRawKg = (rawKgTotal + atRoasteryKg) * (1 - avgRoastWaste);
  const totalRoastedEquivalentKg = projectedRoastedFromRawKg + roastedAvailableKg;
  const futureProducedBags = Math.floor((totalRoastedEquivalentKg * (1 - avgPackWaste)) / bagSizeKg) + packingInProgressBags;
  const grandTotalWithCurrentFinished = futureProducedBags + finishedAvailableBags;

  // نسبة الخلط التاريخية بين الصنفين
  const sentType1 = sumSentToRoastery_(type1);
  const sentType2 = sumSentToRoastery_(type2);
  const sentTotal = sentType1 + sentType2;
  const blendRatioPercent = sentTotal > 0
    ? { [type1]: Math.round((sentType1 / sentTotal) * 10000) / 100, [type2]: Math.round((sentType2 / sentTotal) * 10000) / 100 }
    : { [type1]: 50, [type2]: 50 };

  return {
    type1: type1, type2: type2, bagSizeKg: bagSizeKg,
    avgRoastWaste: avgRoastWaste, avgPackWaste: avgPackWaste,
    rawKgByType: rawKgByType, rawKgTotal: rawKgTotal, atRoasteryKg: atRoasteryKg,
    roastedAvailableKg: roastedAvailableKg, packingInProgressBags: packingInProgressBags,
    finishedAvailableBags: finishedAvailableBags,
    bagsFromRoastedAvailable: bagsFromRoastedAvailable,
    futureProducedBags: futureProducedBags,
    grandTotalWithCurrentFinished: grandTotalWithCurrentFinished,
    blendRatioPercent: blendRatioPercent
  };
}

/**
 * يحسب احتياج الشراء الصافي (بالكغ، ولكل صنف) لتغطية عدد أكياس معيّن، بناءً
 * على نتيجة computePipelineForecast_() (pf) — أي "كم ينقص فعلياً ومن أي صنف"
 * لتغطية هذه الكمية بالكامل من الصفر مع خصم كل ما هو متوفر حالياً بأي مرحلة.
 * مشتركة بين reportForecast() (حاسبة الطلبية اليدوية في صفحة التقارير)
 * وgetActiveOrders() (مؤشر تغطية كل طلبية في صفحة الإدخال) - تفادياً لتكرار
 * هذا المنطق في مكانين (راجع CLAUDE.md §3).
 */
function computeOrderPurchaseNeed_(pf, orderBags) {
  const requiredFinishedKg = orderBags * pf.bagSizeKg;
  const requiredRoastedKg = requiredFinishedKg / (1 - pf.avgPackWaste);
  const requiredRawKgTotal = requiredRoastedKg / (1 - pf.avgRoastWaste);

  // نحوّل كل ما هو متوفر حالياً بأي مرحلة إلى "مكافئ خام" (عكس معادلات الهدر)
  // للمقارنة العادلة مع الاحتياج الكلي المحسوب أعلاه من نفس نقطة البداية.
  const roastedAsRawEquivalent = pf.roastedAvailableKg / (1 - pf.avgRoastWaste);
  const packingBagsAsRawEquivalent = (pf.packingInProgressBags * pf.bagSizeKg / (1 - pf.avgPackWaste)) / (1 - pf.avgRoastWaste);
  const finishedBagsAsRawEquivalent = (pf.finishedAvailableBags * pf.bagSizeKg / (1 - pf.avgPackWaste)) / (1 - pf.avgRoastWaste);
  const totalRawEquivalentAvailable = pf.rawKgTotal + pf.atRoasteryKg + roastedAsRawEquivalent + packingBagsAsRawEquivalent + finishedBagsAsRawEquivalent;

  const netAdditionalRawKg = Math.max(0, requiredRawKgTotal - totalRawEquivalentAvailable);

  return {
    requiredRawKgTotal: Math.round(requiredRawKgTotal * 1000) / 1000,
    netAdditionalRawKg: Math.round(netAdditionalRawKg * 1000) / 1000,
    netAdditionalByType: {
      [pf.type1]: Math.round(netAdditionalRawKg * (pf.blendRatioPercent[pf.type1] / 100) * 1000) / 1000,
      [pf.type2]: Math.round(netAdditionalRawKg * (pf.blendRatioPercent[pf.type2] / 100) * 1000) / 1000
    }
  };
}
