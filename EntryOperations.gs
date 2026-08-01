/**
 * EntryOperations.gs
 * -------------------------------------------------------------
 * The 5 data-entry operations called from Entry.html.
 * Every function:
 *  1. Validates the session/role (DataEntry or Admin only).
 *  2. Validates input shape (required fields, positive numbers).
 *  3. Runs the balance-check + write atomically inside withLock_()
 *     (STRICT MODE - rejects if insufficient, per project decision).
 *     The lock prevents a real race condition that was found in
 *     production: two near-simultaneous submissions (e.g. a double
 *     tap on mobile) could both read the same "available" balance
 *     before either had written, so one could bypass the check even
 *     though the combined total exceeded what was actually available.
 * -------------------------------------------------------------
 */

// NOTE: defined as a function (not a top-level const) because Apps Script
// loads .gs files alphabetically, and "EntryOperations.gs" loads BEFORE
// "Setup.gs" (where ROLES is defined). A top-level const evaluated at load
// time would read ROLES before it exists -> "ROLES is not defined".
// Calling this function at call-time (inside requireRole_) is always safe.
function entryRoles_() {
  return [ROLES.ADMIN, ROLES.DATA_ENTRY];
}

/** 1) Coffee Beans Received from the Supplier */
function submitRawReceived(token, data) {
  const session = requireRole_(token, entryRoles_());
  validateRequired_(data, ['date', 'coffeeType', 'quantityKg']);
  validatePositive_(data.quantityKg, 'quantityKg');

  return withLock_(function() {
    const id = appendRow_(SHEETS.RAW_RECEIVED, {
      Date: data.date,
      CoffeeType: data.coffeeType,
      QuantityKg: Number(data.quantityKg),
      Supplier: data.supplier || '',
      Notes: data.notes || '',
      EnteredBy: session.username
    });

    writeAudit_(session.username, 'RAW_RECEIVED', id + ' / ' + data.quantityKg + 'kg ' + data.coffeeType);
    return { success: true, id: id, message: 'تم تسجيل الاستلام بنجاح / Receipt recorded successfully' };
  });
}

/** 2) Coffee Beans Sent to the Roastery */
function submitSentToRoastery(token, data) {
  const session = requireRole_(token, entryRoles_());
  validateRequired_(data, ['date', 'coffeeType', 'quantityKg']);
  validatePositive_(data.quantityKg, 'quantityKg');

  return withLock_(function() {
    // مهم: التحقق من الرصيد يحدث هنا داخل القفل، وليس قبله - وإلا يبقى
    // الخلل الأصلي قائماً (قراءة الرصيد قبل أن يحصل أي طلب متزامن على دوره).
    const available = getRawStockBalance_(data.coffeeType);
    if (Number(data.quantityKg) > available) {
      throw new Error(
        'الكمية المدخلة أكبر من الرصيد المتوفر في المخزن (' + available.toFixed(2) + ' كغ) / ' +
        'Quantity exceeds available warehouse stock (' + available.toFixed(2) + ' kg)'
      );
    }

    const id = appendRow_(SHEETS.SENT_ROASTERY, {
      Date: data.date,
      CoffeeType: data.coffeeType,
      QuantityKg: Number(data.quantityKg),
      BatchRef: data.batchRef || id_placeholder_(),
      Notes: data.notes || '',
      EnteredBy: session.username
    });

    writeAudit_(session.username, 'SENT_ROASTERY', id + ' / ' + data.quantityKg + 'kg ' + data.coffeeType);
    return { success: true, id: id, message: 'تم إرسال الكمية للتحميص / Quantity sent to roastery' };
  });
}

/** 3) Ground Coffee Received from the Roastery - "الكمية المرسلة" تُقدَّر تلقائياً من متوسط الهدر */
function submitReceivedFromRoastery(token, data) {
  const session = requireRole_(token, entryRoles_());
  validateRequired_(data, ['date', 'receivedQuantityKg']);
  validatePositive_(data.receivedQuantityKg, 'receivedQuantityKg');

  return withLock_(function() {
    const received = Number(data.receivedQuantityKg);

    // نقدّر "الكمية المرسلة" التي تقابل هذا الاستلام تلقائياً، بدل تخمين
    // المستخدم لها يدوياً - عبر متوسط نسبة الهدر العام المُعتمَد في Config
    // (يُحدَّث دورياً من طرف المستخدم ليطابق الواقع، راجع docs/Database.md).
    // مثال: استُلم 88كغ ومتوسط الهدر 12% → الكمية المرسلة المقدَّرة = 88/0.88 = 100كغ.
    const avgWastePercent = (Number(getConfigMap_().AverageRoastingWastePercent) || 12);
    const safeAvgWastePercent = (avgWastePercent >= 0 && avgWastePercent < 100) ? avgWastePercent : 12;
    const estimatedSent = received / (1 - safeAvgWastePercent / 100);

    // تحقق صارم: الكمية المرسلة المقدَّرة لا يمكن أن تتجاوز الرصيد المتبقي
    // فعلياً عند المحمصة. بما أن التقدير يعتمد على متوسط واقعي، يُصفّر هذا
    // الرصيد تلقائياً وبشكل صحيح مع اكتمال كل دفعة - بخلاف محاولة سابقة
    // (مقارنة إجمالي الشيتين مباشرة) ثبت أنها تُبقي "هدراً وهمياً" عالقاً
    // للأبد حتى بعد اكتمال الاستلام فعلياً. راجع CLAUDE.md §4.2 (نسخته المحدَّثة).
    const atRoastery = getAtRoasteryBalance_();
    if (estimatedSent > atRoastery) {
      throw new Error(
        'الكمية المستلمة (بعد تقدير مقابلها المرسل بمتوسط هدر ' + safeAvgWastePercent + '%) ' +
        'تتجاوز الرصيد المتبقي فعلياً عند المحمصة (' + atRoastery.toFixed(2) + ' كغ). ' +
        'إن كان الهدر الفعلي لهذه الدفعة أعلى من المتوسط المُعتمَد، حدّث النسبة في شيت Config. / ' +
        'The received quantity (after estimating its sent-equivalent at ' + safeAvgWastePercent + '% average waste) ' +
        'exceeds what is actually outstanding at the roastery (' + atRoastery.toFixed(2) + ' kg). ' +
        'If this batch\'s actual waste is higher than the configured average, update the percentage in the Config sheet.'
      );
    }

    const wasteKgEstimate = estimatedSent - received;

    const id = appendRow_(SHEETS.RECEIVED_ROASTERY, {
      Date: data.date,
      BatchRef: data.batchRef || '',
      SentQuantityKg: Math.round(estimatedSent * 1000) / 1000,
      ReceivedQuantityKg: received,
      WasteKg: Math.round(wasteKgEstimate * 1000) / 1000,
      WastePercent: safeAvgWastePercent,
      Notes: data.notes || '',
      EnteredBy: session.username
    });

    // نسبة الهدر الإجمالية **الحقيقية** (وليست التقديرية) - تُحسب من مقارنة
    // مباشرة بين إجمالي الشيتين الفعليين، بمعزل تام عن أي تقدير. هذه تبقى
    // دقيقة 100% دائماً بغض النظر عن دقة متوسط الهدر المُعتمَد أعلاه.
    const totalSentNow = sumSentToRoastery_();
    const totalReceivedNow = sumReceivedFromRoastery_();
    const actualCumulativeWastePercent = totalSentNow > 0
      ? Math.round(((totalSentNow - totalReceivedNow) / totalSentNow) * 10000) / 100
      : 0;

    writeAudit_(session.username, 'RECEIVED_ROASTERY', id + ' / received ' + received + 'kg / estimated sent ' + estimatedSent.toFixed(2) + 'kg');
    return {
      success: true, id: id,
      estimatedSentKg: Math.round(estimatedSent * 1000) / 1000,
      actualCumulativeWastePercent: actualCumulativeWastePercent,
      message: 'تم تسجيل الاستلام. الكمية المرسلة المقابلة (تقديرية): ' + estimatedSent.toFixed(2) + ' كغ. ' +
        'نسبة الهدر الإجمالية الحقيقية حتى الآن: ' + actualCumulativeWastePercent.toFixed(2) + '% / ' +
        'Recorded. Estimated corresponding sent quantity: ' + estimatedSent.toFixed(2) + ' kg. ' +
        'Actual cumulative waste so far: ' + actualCumulativeWastePercent.toFixed(2) + '%'
    };
  });
}

/** 4) Coffee Under Processing (Packing) - input kg -> output bags, waste auto-calculated */
function submitPackingProcess(token, data) {
  const session = requireRole_(token, entryRoles_());
  validateRequired_(data, ['date', 'inputQuantityKg', 'bagsProduced']);
  validatePositive_(data.inputQuantityKg, 'inputQuantityKg');
  validateNonNegative_(data.bagsProduced, 'bagsProduced');

  return withLock_(function() {
    const input = Number(data.inputQuantityKg);
    const available = getRoastedStockBalance_();
    if (input > available) {
      throw new Error(
        'الكمية المدخلة أكبر من رصيد القهوة المحمصة المتوفرة (' + available.toFixed(2) + ' كغ) / ' +
        'Quantity exceeds available roasted coffee stock (' + available.toFixed(2) + ' kg)'
      );
    }

    const bagSizeKg = (Number(getConfigMap_().BagSizeKg) || BAG_SIZE_KG);
    const bags = Number(data.bagsProduced);
    const expectedOutputKg = bags * bagSizeKg;
    const waste = input - expectedOutputKg;
    const wastePercent = input > 0 ? (waste / input) * 100 : 0;

    const id = appendRow_(SHEETS.PACKING, {
      Date: data.date,
      BatchRef: data.batchRef || '',
      InputQuantityKg: input,
      BagsProduced: bags,
      ExpectedOutputKg: Math.round(expectedOutputKg * 1000) / 1000,
      WasteKg: Math.round(waste * 1000) / 1000,
      WastePercent: Math.round(wastePercent * 100) / 100,
      Notes: data.notes || '',
      EnteredBy: session.username
    });

    writeAudit_(session.username, 'PACKING', id + ' / ' + bags + ' bags / waste ' + wastePercent.toFixed(2) + '%');
    return {
      success: true, id: id, wasteKg: Math.round(waste * 1000) / 1000, wastePercent: Math.round(wastePercent * 100) / 100,
      message: 'تم تسجيل التعبئة. نسبة الهدر: ' + wastePercent.toFixed(2) + '% / Recorded. Waste: ' + wastePercent.toFixed(2) + '%'
    };
  });
}

/** 5) Ready-Made Packed Coffee - confirms bags as finished product */
function submitFinishedProduct(token, data) {
  const session = requireRole_(token, entryRoles_());
  validateRequired_(data, ['date', 'bagsAdded']);
  validatePositive_(data.bagsAdded, 'bagsAdded');

  return withLock_(function() {
    const bags = Number(data.bagsAdded);
    const available = getPackingInProgressBags_();
    if (bags > available) {
      throw new Error(
        'عدد الأكياس أكبر من الكمية المتوفرة في طور التعبئة (' + available + ' كيس) / ' +
        'Bags exceed the quantity currently in packing stage (' + available + ' bags)'
      );
    }

    const id = appendRow_(SHEETS.FINISHED, {
      Date: data.date,
      BatchRef: data.batchRef || '',
      BagsAdded: bags,
      ProductName: data.productName || 'Ready-Made Packed Coffee',
      Notes: data.notes || '',
      EnteredBy: session.username
    });

    writeAudit_(session.username, 'FINISHED', id + ' / ' + bags + ' bags');
    return { success: true, id: id, message: 'تم تسجيل المنتج النهائي بنجاح / Finished product recorded successfully' };
  });
}

/** 6) Delivery - يسجّل تسليم أكياس من المخزون الجاهز للعملاء، يخصم من الرصيد الجاهز للتسليم */
function submitDelivery(token, data) {
  const session = requireRole_(token, entryRoles_());
  validateRequired_(data, ['date', 'bagsDelivered']);
  validatePositive_(data.bagsDelivered, 'bagsDelivered');

  return withLock_(function() {
    const bags = Number(data.bagsDelivered);
    const available = getFinishedStockBalance_();
    if (bags > available) {
      throw new Error(
        'عدد الأكياس أكبر من المتوفر في المخزون الجاهز للتسليم (' + available + ' كيس) / ' +
        'Bags exceed the available finished stock ready for delivery (' + available + ' bags)'
      );
    }

    const id = appendRow_(SHEETS.DELIVERIES, {
      Date: data.date,
      BatchRef: data.batchRef || '',
      BagsDelivered: bags,
      Customer: data.customer || '',
      Notes: data.notes || '',
      EnteredBy: session.username
    });

    writeAudit_(session.username, 'DELIVERY', id + ' / ' + bags + ' bags');
    return { success: true, id: id, message: 'تم تسجيل التسليم بنجاح / Delivery recorded successfully' };
  });
}

// ===== small validators =====
function validateRequired_(data, fields) {
  fields.forEach(f => {
    if (data[f] === undefined || data[f] === null || data[f] === '') {
      throw new Error('الحقل مطلوب / Required field missing: ' + f);
    }
  });
}
function validatePositive_(value, fieldName) {
  if (isNaN(Number(value)) || Number(value) <= 0) {
    throw new Error('يجب أن تكون القيمة رقماً أكبر من صفر / Must be a positive number: ' + fieldName);
  }
}
function validateNonNegative_(value, fieldName) {
  if (isNaN(Number(value)) || Number(value) < 0) {
    throw new Error('يجب أن تكون القيمة رقماً غير سالب / Must be a non-negative number: ' + fieldName);
  }
}
function id_placeholder_() { return 'BATCH-' + new Date().getTime(); }

/** Returns current balances for the Entry.html dashboard widgets. */
function getCurrentBalances(token) {
  requireSession_(token);
  const cfg = getConfigMap_();
  const type1 = cfg.CoffeeType1, type2 = cfg.CoffeeType2;
  const result = {
    rawStock: {
      [type1]: Math.round(getRawStockBalance_(type1) * 1000) / 1000,
      [type2]: Math.round(getRawStockBalance_(type2) * 1000) / 1000
    },
    atRoasteryKg: Math.round(getAtRoasteryBalance_() * 1000) / 1000,
    roastedStock: Math.round(getRoastedStockBalance_() * 1000) / 1000,
    packingInProgressBags: getPackingInProgressBags_(),
    finishedBags: sumBagsFinished_(),
    finishedStockAvailable: getFinishedStockBalance_(),
    avgRoastingWastePercent: (Number(cfg.AverageRoastingWastePercent) || 12),
    coffeeTypes: [type1, type2]
  };

  // نفس الفحص الدفاعي المستخدم في getAllReports() (ReportsOperations.gs):
  // يمنع فشلاً صامتاً (null بلا أي خطأ) لو تسرّبت NaN/Infinity/undefined هنا
  // مستقبلاً بالخطأ - يرمي خطأ صريحاً يحدد المكان بدل تركه لغزاً. راجع
  // CLAUDE.md (قسم أسلوب الكود) لمثال حقيقي حدث فعلاً بسبب هذا بالضبط.
  const badPath = findUnserializableValue_(result, 'getCurrentBalances result');
  if (badPath) {
    throw new Error(
      'قيمة غير صالحة في الأرصدة عند: ' + badPath + ' — راجع شيت Config (قد تحتوي قيمة غير رقمية بالخطأ). / ' +
      'Invalid value in balances at: ' + badPath + ' — check the Config sheet (may contain a non-numeric value by mistake).'
    );
  }

  return result;
}
