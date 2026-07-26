/**
 * ReportsOperations.gs
 * -------------------------------------------------------------
 * Read-only aggregation functions for Reports.html.
 * Accessible by Admin + Accountant.
 * -------------------------------------------------------------
 */

// NOTE: defined as a function (not a top-level const) - see the identical
// comment in EntryOperations.gs. "ReportsOperations.gs" also loads before
// "Setup.gs" alphabetically, so ROLES must be read lazily, not at load time.
function reportRoles_() {
  return [ROLES.ADMIN, ROLES.ACCOUNTANT];
}

/** 1) تفصيل الكميات المستلمة من المورد حسب الصنف */
function reportRawReceivedByType(token) {
  requireRole_(token, reportRoles_());
  const rows = readSheetAsObjects_(SHEETS.RAW_RECEIVED);
  return {
    rows: rows.map(r => ({ date: r.Date, coffeeType: r.CoffeeType, quantityKg: r.QuantityKg, supplier: r.Supplier, enteredBy: r.EnteredBy })),
    totalsByType: groupSum_(rows, 'CoffeeType', 'QuantityKg'),
    grandTotalKg: sumField_(rows, 'QuantityKg')
  };
}

/** 2) تفصيل الكميات المرسلة للتحميص */
function reportSentToRoastery(token) {
  requireRole_(token, reportRoles_());
  const rows = readSheetAsObjects_(SHEETS.SENT_ROASTERY);
  return {
    rows: rows.map(r => ({ date: r.Date, coffeeType: r.CoffeeType, quantityKg: r.QuantityKg, batchRef: r.BatchRef, enteredBy: r.EnteredBy })),
    totalsByType: groupSum_(rows, 'CoffeeType', 'QuantityKg'),
    grandTotalKg: sumField_(rows, 'QuantityKg')
  };
}

/** 3) تفصيل الكميات المستلمة بعد التحميص مع حساب نسبة الهدر */
function reportReceivedFromRoastery(token) {
  requireRole_(token, reportRoles_());
  const rows = readSheetAsObjects_(SHEETS.RECEIVED_ROASTERY);
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

/** 4) تفصيل الكمية المحمصة المتوفرة */
function reportRoastedAvailable(token) {
  requireRole_(token, reportRoles_());
  return {
    totalReceivedFromRoastery: Math.round(sumReceivedFromRoastery_() * 1000) / 1000,
    totalSentToPacking: Math.round(sumPackingInput_() * 1000) / 1000,
    availableKg: Math.round(getRoastedStockBalance_() * 1000) / 1000
  };
}

/** 5) تفصيل الكمية في طور التعبئة (نصف جاهزة) مع حساب الهدر */
function reportPackingInProgress(token) {
  requireRole_(token, reportRoles_());
  const rows = readSheetAsObjects_(SHEETS.PACKING);
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
      bagsStillInProgress: getPackingInProgressBags_()
    }
  };
}

/** 6) تفصيل الكمية الجاهزة (منتج نهائي) */
function reportFinishedProducts(token) {
  requireRole_(token, reportRoles_());
  const rows = readSheetAsObjects_(SHEETS.FINISHED);
  return {
    rows: rows.map(r => ({ date: r.Date, batchRef: r.BatchRef, bagsAdded: r.BagsAdded, productName: r.ProductName, enteredBy: r.EnteredBy })),
    totalBags: sumField_(rows, 'BagsAdded')
  };
}

/** Convenience: loads all 6 reports in a single call (used on Reports.html page load). */
function getAllReports(token) {
  requireRole_(token, reportRoles_());
  return {
    rawReceived: reportRawReceivedByType(token),
    sentToRoastery: reportSentToRoastery(token),
    receivedFromRoastery: reportReceivedFromRoastery(token),
    roastedAvailable: reportRoastedAvailable(token),
    packingInProgress: reportPackingInProgress(token),
    finishedProducts: reportFinishedProducts(token)
  };
}

// ===== small aggregation helpers =====
function sumField_(rows, field) {
  return Math.round(rows.reduce((s, r) => s + Number(r[field] || 0), 0) * 1000) / 1000;
}
function groupSum_(rows, groupField, sumFieldName) {
  const map = {};
  rows.forEach(r => {
    const key = r[groupField] || 'Unknown';
    map[key] = (map[key] || 0) + Number(r[sumFieldName] || 0);
  });
  Object.keys(map).forEach(k => map[k] = Math.round(map[k] * 1000) / 1000);
  return map;
}
