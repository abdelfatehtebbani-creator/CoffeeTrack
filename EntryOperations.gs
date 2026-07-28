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

/** 3) Ground Coffee Received from the Roastery (waste is auto-calculated) */
function submitReceivedFromRoastery(token, data) {
  const session = requireRole_(token, entryRoles_());
  validateRequired_(data, ['date', 'sentQuantityKg', 'receivedQuantityKg']);
  validatePositive_(data.sentQuantityKg, 'sentQuantityKg');
  validatePositive_(data.receivedQuantityKg, 'receivedQuantityKg');

  return withLock_(function() {
    const sent = Number(data.sentQuantityKg);
    const received = Number(data.receivedQuantityKg);

    // تحقق صارم: لا يمكن "تسوية" (مطابقة) كمية أكبر من المتبقي فعلياً عند
    // المحمصة - هذا يمنع الخطأ الشائع عند تجزيء/دمج الدفعات (راجع docs/Database.md).
    const atRoastery = getAtRoasteryBalance_();
    if (sent > atRoastery) {
      throw new Error(
        'الكمية المرسلة المُدخلة أكبر من الكمية المتبقية فعلياً عند المحمصة (' + atRoastery.toFixed(2) + ' كغ). ' +
        'إذا كانت المحمصة أرجعت هذه الدفعة على أجزاء، أدخل فقط الجزء الذي يخص هذا الاستلام. / ' +
        'Entered sent quantity exceeds what is actually outstanding at the roastery (' + atRoastery.toFixed(2) + ' kg). ' +
        'If the roastery is returning this in installments, enter only the portion for this receipt.'
      );
    }

    if (received > sent) {
      throw new Error('الكمية المستلمة لا يمكن أن تكون أكبر من الكمية المرسلة / Received quantity cannot exceed sent quantity');
    }

    const waste = sent - received;
    const wastePercent = sent > 0 ? (waste / sent) * 100 : 0;

    const id = appendRow_(SHEETS.RECEIVED_ROASTERY, {
      Date: data.date,
      BatchRef: data.batchRef || '',
      SentQuantityKg: sent,
      ReceivedQuantityKg: received,
      WasteKg: waste,
      WastePercent: Math.round(wastePercent * 100) / 100,
      Notes: data.notes || '',
      EnteredBy: session.username
    });

    writeAudit_(session.username, 'RECEIVED_ROASTERY', id + ' / waste ' + wastePercent.toFixed(2) + '%');
    return {
      success: true, id: id, wasteKg: waste, wastePercent: Math.round(wastePercent * 100) / 100,
      message: 'تم تسجيل الاستلام. نسبة الهدر: ' + wastePercent.toFixed(2) + '% / Recorded. Waste: ' + wastePercent.toFixed(2) + '%'
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

    const bagSizeKg = Number(getConfigMap_().BagSizeKg || BAG_SIZE_KG);
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
  return {
    rawStock: {
      [type1]: Math.round(getRawStockBalance_(type1) * 1000) / 1000,
      [type2]: Math.round(getRawStockBalance_(type2) * 1000) / 1000
    },
    atRoasteryKg: Math.round(getAtRoasteryBalance_() * 1000) / 1000,
    roastedStock: Math.round(getRoastedStockBalance_() * 1000) / 1000,
    packingInProgressBags: getPackingInProgressBags_(),
    finishedBags: sumBagsFinished_(),
    coffeeTypes: [type1, type2]
  };
}
