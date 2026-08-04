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
 * يحوّل قيمة تاريخ إلى صيغة 'yyyy-MM-dd' لمقارنة نطاقات التاريخ.
 * (الدالة نفسها تعيش الآن في SheetService.gs كطبقة مشتركة، لأن
 * getTodayActivity() تحتاجها أيضاً - راجع CLAUDE.md §3.)
 */

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
  const cfg = getConfigMap_();
  const type1 = cfg.CoffeeType1, type2 = cfg.CoffeeType2;
  const stock1 = Math.round(getRawStockBalance_(type1) * 1000) / 1000;
  const stock2 = Math.round(getRawStockBalance_(type2) * 1000) / 1000;
  return {
    rows: rows.map(r => ({ date: r.Date, coffeeType: r.CoffeeType, quantityKg: r.QuantityKg, supplier: r.Supplier, enteredBy: r.EnteredBy })),
    totalsByType: groupSum_(rows, 'CoffeeType', 'QuantityKg'),
    grandTotalKg: sumField_(rows, 'QuantityKg'),
    // المتوفر حالياً بالمخزن لكل صنف - رصيد لحظي حقيقي (غير مفلتَر بالتاريخ عمداً،
    // كبقية الأرصدة اللحظية في المشروع: atRoasteryKg, roastedAvailable, إلخ).
    currentStockByType: { [type1]: stock1, [type2]: stock2 },
    currentStockGrandTotal: Math.round((stock1 + stock2) * 1000) / 1000
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

/** 3) تفصيل الكميات المستلمة بعد التحميص + نسبة الهدر الإجمالية (وليست لكل صف) */
function reportReceivedFromRoastery(token, fromDate, toDate) {
  requireRole_(token, reportRoles_());
  const receivedRows = filterByDateRange_(readSheetAsObjects_(SHEETS.RECEIVED_ROASTERY), fromDate, toDate);
  const totalReceived = sumField_(receivedRows, 'ReceivedQuantityKg');

  // نسبة الهدر الإجمالية تُحسب بمقارنة إجمالي شيت "الإرسال" بإجمالي شيت
  // "الاستلام" مباشرة (ضمن نفس الفترة المفلترة إن وُجدت) - وليس من عمود
  // SentQuantityKg اليدوي القديم (أصبح تاريخياً فقط لصفوف قديمة قبل هذا
  // التغيير). هذا أدق ولا يحتاج أي تخمين يدوي لكل صف. راجع CLAUDE.md §4.2.
  const sentRows = filterByDateRange_(readSheetAsObjects_(SHEETS.SENT_ROASTERY), fromDate, toDate);
  const totalSent = sumField_(sentRows, 'QuantityKg');
  const totalWaste = totalSent - totalReceived;

  return {
    rows: receivedRows.map(r => ({
      date: r.Date, batchRef: r.BatchRef, receivedKg: r.ReceivedQuantityKg,
      estimatedSentKg: r.SentQuantityKg, estimatedWastePercent: r.WastePercent,
      notes: r.Notes, enteredBy: r.EnteredBy
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
    totalBags: sumField_(rows, 'BagsAdded'),
    // "متاح للتسليم الآن" رصيد لحظي حقيقي (غير مفلتَر بالتاريخ عمداً)
    availableForDelivery: getFinishedStockBalance_()
  };
}

/** 7) تفصيل عمليات التسليم للعملاء */
function reportDeliveries(token, fromDate, toDate) {
  requireRole_(token, reportRoles_());
  const rows = filterByDateRange_(readSheetAsObjects_(SHEETS.DELIVERIES), fromDate, toDate);
  return {
    rows: rows.map(r => ({ date: r.Date, batchRef: r.BatchRef, bagsDelivered: r.BagsDelivered, customer: r.Customer, enteredBy: r.EnteredBy })),
    totalBags: sumField_(rows, 'BagsDelivered')
  };
}

/**
 * Convenience: loads all 7 reports in a single call (used on Reports.html page load).
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
      finishedProducts: reportFinishedProducts(token, fromDate, toDate),
      deliveries: reportDeliveries(token, fromDate, toDate)
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

// ===================================================================
// التنبؤات (Forecast) — يحوّل المخزون الحالي عبر خطوط الأنابيب
// (خام → عند المحمصة → محمص → معبّأ) باستخدام متوسطات الهدر المُعتمَدة
// في Config، لتقدير الإنتاج المستقبلي والاحتياج الفعلي للشراء.
// ===================================================================

/**
 * محرك التنبؤات الكامل - يُستدعى من Reports.html (قسم "🔮 التنبؤات").
 * @param {number} [targetOrderBags] - اختياري: حجم طلبية بالأكياس لحساب
 *   الاحتياج الصافي من الشراء لكل صنف (السؤال 3). بدونه، تُرجَع فقط
 *   تنبؤات الإنتاج العامة (السؤالان 1 و2).
 */
function reportForecast(token, targetOrderBags) {
  requireRole_(token, reportRoles_());

  const cfg = getConfigMap_();
  const type1 = cfg.CoffeeType1, type2 = cfg.CoffeeType2;
  const bagSizeKg = (Number(cfg.BagSizeKg) || 0.2);
  const avgRoastWaste = (Number(cfg.AverageRoastingWastePercent) || 12) / 100;
  const avgPackWaste = (Number(cfg.AveragePackingWastePercent) || 2) / 100;

  // الأرصدة الحالية بكل مرحلة (نفس دوال الأرصدة المستخدمة في بقية المشروع)
  const rawKgByType = { [type1]: getRawStockBalance_(type1), [type2]: getRawStockBalance_(type2) };
  const rawKgTotal = rawKgByType[type1] + rawKgByType[type2];
  const atRoasteryKg = getAtRoasteryBalance_();
  const roastedAvailableKg = getRoastedStockBalance_();
  const packingInProgressBags = getPackingInProgressBags_();
  const finishedAvailableBags = getFinishedStockBalance_();

  // ===== سؤال 1: القهوة المحمصة المتوفرة الآن (جاهزة للتعبئة) → كم كيس ستنتج؟ =====
  const bagsFromRoastedAvailable = Math.floor((roastedAvailableKg * (1 - avgPackWaste)) / bagSizeKg);

  // ===== سؤال 2: عند استنفاذ كامل المخزون (خام + عند المحمصة + محمص متوفر) =====
  // نحوّل الخام (المتوفر بالمخزن + الموجود حالياً عند المحمصة) إلى مكافئ محمص عبر
  // متوسط هدر التحميص، نجمعه مع المحمص المتوفر فعلاً، ثم نحوّل المجموع لأكياس عبر
  // متوسط هدر التعبئة. الأكياس قيد التعبئة والجاهزة فعلاً تُضاف مباشرة (أرقام حقيقية
  // وليست تقديرية، لا تحتاج تحويلاً).
  const projectedRoastedFromRawKg = (rawKgTotal + atRoasteryKg) * (1 - avgRoastWaste);
  const totalRoastedEquivalentKg = projectedRoastedFromRawKg + roastedAvailableKg;
  const futureProducedBags = Math.floor((totalRoastedEquivalentKg * (1 - avgPackWaste)) / bagSizeKg) + packingInProgressBags;
  const grandTotalWithCurrentFinished = futureProducedBags + finishedAvailableBags;

  // نسبة الخلط التاريخية بين الصنفين (من إجمالي ما أُرسل للتحميص فعلياً على مرّ الوقت)
  const sentType1 = sumSentToRoastery_(type1);
  const sentType2 = sumSentToRoastery_(type2);
  const sentTotal = sentType1 + sentType2;
  const blendRatioPercent = sentTotal > 0
    ? { [type1]: Math.round((sentType1 / sentTotal) * 10000) / 100, [type2]: Math.round((sentType2 / sentTotal) * 10000) / 100 }
    : { [type1]: 50, [type2]: 50 };

  const result = {
    config: {
      avgRoastingWastePercent: Math.round(avgRoastWaste * 10000) / 100,
      avgPackingWastePercent: Math.round(avgPackWaste * 10000) / 100,
      bagSizeKg: bagSizeKg
    },
    currentStock: {
      rawKgByType: { [type1]: Math.round(rawKgByType[type1] * 1000) / 1000, [type2]: Math.round(rawKgByType[type2] * 1000) / 1000 },
      atRoasteryKg: Math.round(atRoasteryKg * 1000) / 1000,
      roastedAvailableKg: Math.round(roastedAvailableKg * 1000) / 1000,
      packingInProgressBags: packingInProgressBags,
      finishedAvailableBags: finishedAvailableBags
    },
    prediction1_bagsFromRoastedAvailable: bagsFromRoastedAvailable,
    prediction2_fullPipeline: {
      futureProducedBags: futureProducedBags,
      currentFinishedBags: finishedAvailableBags,
      grandTotalBags: grandTotalWithCurrentFinished
    },
    blendRatioPercent: blendRatioPercent
  };

  // ===== سؤال 3 (اختياري): طلبية بحجم X كيس - كم أشتري من كل صنف؟ =====
  if (targetOrderBags && Number(targetOrderBags) > 0) {
    const orderBags = Number(targetOrderBags);
    const requiredFinishedKg = orderBags * bagSizeKg;
    const requiredRoastedKg = requiredFinishedKg / (1 - avgPackWaste);
    const requiredRawKgTotal = requiredRoastedKg / (1 - avgRoastWaste);

    // نحوّل كل ما هو متوفر حالياً بأي مرحلة إلى "مكافئ خام" (عكس معادلات الهدر)
    // للمقارنة العادلة مع الاحتياج الكلي المحسوب أعلاه من نفس نقطة البداية.
    const roastedAsRawEquivalent = roastedAvailableKg / (1 - avgRoastWaste);
    const packingBagsAsRawEquivalent = (packingInProgressBags * bagSizeKg / (1 - avgPackWaste)) / (1 - avgRoastWaste);
    const finishedBagsAsRawEquivalent = (finishedAvailableBags * bagSizeKg / (1 - avgPackWaste)) / (1 - avgRoastWaste);
    const totalRawEquivalentAvailable = rawKgTotal + atRoasteryKg + roastedAsRawEquivalent + packingBagsAsRawEquivalent + finishedBagsAsRawEquivalent;

    const netAdditionalRawKg = Math.max(0, requiredRawKgTotal - totalRawEquivalentAvailable);

    result.orderCalculation = {
      orderBags: orderBags,
      requiredRawKgTotal: Math.round(requiredRawKgTotal * 1000) / 1000,
      bagsAlreadyCoveredByCurrentStock: Math.min(orderBags, grandTotalWithCurrentFinished),
      netAdditionalRawKg: Math.round(netAdditionalRawKg * 1000) / 1000,
      netAdditionalByType: {
        [type1]: Math.round(netAdditionalRawKg * (blendRatioPercent[type1] / 100) * 1000) / 1000,
        [type2]: Math.round(netAdditionalRawKg * (blendRatioPercent[type2] / 100) * 1000) / 1000
      }
    };
  }

  // فحص دفاعي (نفس نمط getAllReports/getCurrentBalances) يمنع فشلاً صامتاً
  // لو تسرّبت NaN/Infinity بالخطأ في أي من الحسابات أعلاه.
  const badPath = findUnserializableValue_(result, 'forecast result');
  if (badPath) {
    throw new Error('قيمة غير صالحة في التنبؤ عند: ' + badPath + ' — تحقق من قيم Config الرقمية. / Invalid forecast value at: ' + badPath + ' — check Config numeric values.');
  }

  return result;
}
