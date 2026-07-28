/**
 * ReportsOperations.gs
 * -------------------------------------------------------------
 * Read-only aggregation functions for Reports.html.
 * Accessible by Admin + Accountant.
 *
 * كل تقرير "قائم على صفوف" (1, 2, 3, 5, 6) يدعم فلترة اختيارية بنطاق تاريخ
 * (fromDate/toDate، صيغة 'yyyy-MM-dd') لعزل "الدفعة الحديثة" عن أي رصيد
 * افتتاحي/قديم مُدخَل يدوياً بتاريخ سابق. مرّر '' أو null لعدم الفلترة.
 * تقرير 4 (roastedAvailable) استثناء متعمَّد: يعرض الرصيد الفعلي الحالي
 * دائماً (حقيقة مادية لحظية)، وليس مجموعاً على فترة، فلا يُفلتَر بالتاريخ.
 * -------------------------------------------------------------
 */

// NOTE: defined as a function (not a top-level const) - see the identical
// comment in EntryOperations.gs. "ReportsOperations.gs" also loads before
// "Setup.gs" alphabetically, so ROLES must be read lazily, not at load time.
function reportRoles_() {
  return [ROLES.ADMIN, ROLES.ACCOUNTANT];
}

/**
 * يحوّل قيمة تاريخ (نص ISO أو كائن Date) إلى صيغة 'yyyy-MM-dd' بتوقيت
 * المشروع (Asia/Qatar)، لمقارنة نطاقات التاريخ بشكل صحيح ومتّسق.
 */
function dateOnly_(dateVal) {
  if (!dateVal) return '';
  const d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal).slice(0, 10);
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Qatar', 'yyyy-MM-dd');
}

/** يفلتر صفوفاً حسب عمود Date ضمن [fromDate, toDate] شاملاً الطرفين. فارغ = بدون فلترة. */
function filterByDateRange_(rows, fromDate, toDate) {
  if (!fromDate && !toDate) return rows;
  return rows.filter(r => {
    const d = dateOnly_(r.Date);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });
}

/** 1) تفصيل الكميات المستلمة من المورد حسب الصنف */
function reportRawReceivedByType(token, fromDate, toDate) {
  requireRole_(token, reportRoles_());
  const rows = filterByDateRange_(readSheetAsObjects_(SHEETS.RAW_RECEIVED), fromDate, toDate);
  return {
    rows: rows.map(r => ({ date: r.Date, coffeeType: r.CoffeeType, quantityKg: r.QuantityKg, supplier: r.Supplier, enteredBy: r.EnteredBy })),
    totalsByType: groupSum_(rows, 'CoffeeType', 'QuantityKg'),
    grandTotalKg: sumField_(rows, 'QuantityKg')
  };
}

/** 2) تفصيل الكميات المرسلة للتحميص */
function reportSentToRoastery(token, fromDate, toDate) {
  requireRole_(token, reportRoles_());
  const rows = filterByDateRange_(readSheetAsObjects_(SHEETS.SENT_ROASTERY), fromDate, toDate);
  return {
    rows: rows.map(r => ({ date: r.Date, coffeeType: r.CoffeeType, quantityKg: r.QuantityKg, batchRef: r.BatchRef, enteredBy: r.EnteredBy })),
    totalsByType: groupSum_(rows, 'CoffeeType', 'QuantityKg'),
    grandTotalKg: sumField_(rows, 'QuantityKg'),
    // "عند المحمصة الآن" رصيد فعلي لحظي (غير مفلتَر بالتاريخ عمداً - راجع التعليق أعلى الملف)
    atRoasteryKg: Math.round(getAtRoasteryBalance_() * 1000) / 1000
  };
}

/** 3) تفصيل الكميات المستلمة بعد التحميص مع حساب نسبة الهدر */
function reportReceivedFromRoastery(token, fromDate, toDate) {
  requireRole_(token, reportRoles_());
  const rows = filterByDateRange_(readSheetAsObjects_(SHEETS.RECEIVED_ROASTERY), fromDate, toDate);
  const totalSent = sumField_(rows, 'SentQuantityKg');
  const totalReceived = sumField_(rows, 'ReceivedQuantityKg');
  const totalWaste = totalSent - totalReceived;
  return {
    rows: rows.map(r => ({
      date: r.Date, batchRef: r.BatchRef, sentKg: r.SentQuantityKg, receivedKg: r.ReceivedQuantityKg,
      wasteKg: r.WasteKg, wastePercent: r.WastePercent, enteredBy: r.EnteredBy
    })),
    totals: {
      sentKg: totalSent,
      receivedKg: totalReceived,
      wasteKg: Math.round(totalWaste * 1000) / 1000,
      wastePercent: totalSent > 0 ? Math.round((totalWaste / totalSent) * 10000) / 100 : 0
    }
  };
}

/** 4) تفصيل الكمية المحمصة المتوفرة (رصيد لحظي حقيقي - غير مفلتَر بالتاريخ عمداً) */
function reportRoastedAvailable(token) {
  requireRole_(token, reportRoles_());
  return {
    totalReceivedFromRoastery: Math.round(sumReceivedFromRoastery_() * 1000) / 1000,
    totalSentToPacking: Math.round(sumPackingInput_() * 1000) / 1000,
    availableKg: Math.round(getRoastedStockBalance_() * 1000) / 1000
  };
}

/** 5) تفصيل الكمية في طور التعبئة (نصف جاهزة) مع حساب الهدر */
function reportPackingInProgress(token, fromDate, toDate) {
  requireRole_(token, reportRoles_());
  const rows = filterByDateRange_(readSheetAsObjects_(SHEETS.PACKING), fromDate, toDate);
  const totalInput = sumField_(rows, 'InputQuantityKg');
  const totalBags = sumField_(rows, 'BagsProduced');
  const totalExpected = sumField_(rows, 'ExpectedOutputKg');
  const totalWaste = sumField_(rows, 'WasteKg');
  return {
    rows: rows.map(r => ({
      date: r.Date, batchRef: r.BatchRef, inputKg: r.InputQuantityKg, bagsProduced: r.BagsProduced,
      expectedOutputKg: r.ExpectedOutputKg, wasteKg: r.WasteKg, wastePercent: r.WastePercent, enteredBy: r.EnteredBy
    })),
    totals: {
      inputKg: totalInput,
      bagsProduced: totalBags,
      expectedOutputKg: Math.round(totalExpected * 1000) / 1000,
      wasteKg: Math.round(totalWaste * 1000) / 1000,
      wastePercent: totalInput > 0 ? Math.round((totalWaste / totalInput) * 10000) / 100 : 0,
      // "أكياس لا تزال قيد التعبئة" رصيد فعلي لحظي (غير مفلتَر بالتاريخ عمداً)
      bagsStillInProgress: getPackingInProgressBags_()
    }
  };
}

/** 6) تفصيل الكمية الجاهزة (منتج نهائي) */
function reportFinishedProducts(token, fromDate, toDate) {
  requireRole_(token, reportRoles_());
  const rows = filterByDateRange_(readSheetAsObjects_(SHEETS.FINISHED), fromDate, toDate);
  return {
    rows: rows.map(r => ({ date: r.Date, batchRef: r.BatchRef, bagsAdded: r.BagsAdded, productName: r.ProductName, enteredBy: r.EnteredBy })),
    totalBags: sumField_(rows, 'BagsAdded')
  };
}

/**
 * Convenience: loads all 6 reports in a single call (used on Reports.html page load).
 * @param {string} fromDate - 'yyyy-MM-dd' أو '' لعدم الفلترة من البداية.
 * @param {string} toDate - 'yyyy-MM-dd' أو '' لعدم الفلترة حتى اليوم.
 */
function getAllReports(token, fromDate, toDate) {
  requireRole_(token, reportRoles_());
  try {
    const result = {
      rawReceived: reportRawReceivedByType(token, fromDate, toDate),
      sentToRoastery: reportSentToRoastery(token, fromDate, toDate),
      receivedFromRoastery: reportReceivedFromRoastery(token, fromDate, toDate),
      roastedAvailable: reportRoastedAvailable(token),
      packingInProgress: reportPackingInProgress(token, fromDate, toDate),
      finishedProducts: reportFinishedProducts(token, fromDate, toDate)
    };

    // فحص دفاعي حاسم: جسر google.script.run يحوّل الاستجابة بالكامل إلى `null`
    // بصمت تام (بدون أي رسالة خطأ) إن وُجدت قيمة واحدة فقط غير قابلة للتمثيل في
    // JSON في أي مكان بالكائن (NaN, Infinity, -Infinity, undefined) - بغض النظر
    // عن عمقها. بدل ترك المستخدم يخمّن مكان الخلل، نفحص الكائن بالكامل هنا
    // ونرمي خطأ صريحاً يحدد المكان بالضبط (اسم الحقل ورقم الصف).
    const badPath = findUnserializableValue_(result, 'result');
    if (badPath) {
      throw new Error(
        'قيمة غير صالحة في البيانات عند: ' + badPath + ' — افتح الشيت المعني وتحقق من هذه الخلية تحديداً (قد تكون فارغة أو تحتوي رمزاً غير متوقع). / ' +
        'Invalid value found at: ' + badPath + ' — open the relevant sheet and check that exact cell (it may be blank or contain an unexpected character).'
      );
    }

    return result;
  } catch (err) {
    throw new Error('فشل تحميل التقارير: ' + err.message + ' / Failed to load reports: ' + err.message);
  }
}

/**
 * يفحص كائناً بالكامل (بعمق) بحثاً عن أول قيمة غير قابلة للتمثيل في JSON.
 * يُرجع مساراً نصياً يصف مكانها بالضبط (مثال: "result.receivedFromRoastery.rows[2].wasteKg")
 * أو null إن كان الكائن سليماً بالكامل.
 */
function findUnserializableValue_(value, path) {
  if (typeof value === 'number' && !isFinite(value)) return path + ' (= ' + value + ')';
  if (value === undefined) return path + ' (= undefined)';
  if (typeof value === 'function') return path + ' (= function)';
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const bad = findUnserializableValue_(value[i], path + '[' + i + ']');
      if (bad) return bad;
    }
    return null;
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
      const bad = findUnserializableValue_(value[keys[i]], path + '.' + keys[i]);
      if (bad) return bad;
    }
    return null;
  }
  return null;
}

// ===== small aggregation helpers =====
function sumField_(rows, field) {
  return Math.round(rows.reduce((s, r) => s + (Number(r[field]) || 0), 0) * 1000) / 1000;
}
function groupSum_(rows, groupField, sumFieldName) {
  const map = {};
  rows.forEach(r => {
    const key = r[groupField] || 'Unknown';
    map[key] = (map[key] || 0) + (Number(r[sumFieldName]) || 0);
  });
  Object.keys(map).forEach(k => map[k] = Math.round(map[k] * 1000) / 1000);
  return map;
}
