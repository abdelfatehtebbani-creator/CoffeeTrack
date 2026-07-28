# Database (Google Sheets Structure)

قاعدة البيانات هي Google Sheet واحد، وكل جدول = ورقة (Sheet) منفصلة. أسماء الشيتات ثابتة في `Setup.gs` ضمن الكائن `SHEETS` — لا تُعدَّل الأسماء يدوياً من واجهة Google Sheets دون تحديث `Setup.gs` بالمقابل.

## 1) `Config`
إعدادات عامة قابلة للتعديل بدون تعديل الكود.

| العمود | النوع | الوصف |
|---|---|---|
| `Key` | نص | معرّف الإعداد (مثال: `BagSizeKg`) |
| `Value` | نص/رقم | القيمة |
| `Notes` | نص | شرح ثنائي اللغة |

**القيم الافتراضية المزروعة عند `initializeSpreadsheet()`:**
| Key | Value الافتراضية | الاستخدام |
|---|---|---|
| `BagSizeKg` | `0.2` | حجم الكيس الواحد بالكغ — يُستخدم في `submitPackingProcess` لحساب `ExpectedOutputKg` |
| `CoffeeType1` | `Arabica` | الصنف الأول |
| `CoffeeType2` | `Robusta` | الصنف الثاني |
| `MaxRoastingWastePercent` | `20` | حد تحذيري (غير مُفعَّل حالياً في الواجهة كتنبيه صريح — انظر TODO) |
| `MaxPackingWastePercent` | `5` | نفس الغرض لمرحلة التعبئة |

## 2) `Users`
| العمود | النوع | الوصف |
|---|---|---|
| `Username` | نص | فريد، غير حساس لحالة الأحرف عند تسجيل الدخول |
| `Password` | نص | **نص عادي حالياً — غير مشفّر** (انظر قيود الأمان في TODO) |
| `FullName` | نص | يُعرض في الواجهة (`userPill`) |
| `Role` | نص | أحد قيم `ROLES`: `Admin` / `DataEntry` / `Accountant` |
| `Active` | Boolean | `TRUE`/`FALSE` — المستخدمون غير النشطين لا يمكنهم الدخول |

## 3) `RawMaterial_Received` — استلام من المورد
| العمود | الوصف |
|---|---|
| `ID` | معرّف تلقائي `RAW-000001` |
| `Date` | تاريخ الاستلام |
| `CoffeeType` | يجب أن يطابق `CoffeeType1` أو `CoffeeType2` من `Config` |
| `QuantityKg` | > 0 |
| `Supplier` | اختياري |
| `Notes` | اختياري |
| `EnteredBy` | Username من الجلسة |
| `Timestamp` | تلقائي |

## 4) `Sent_to_Roastery` — إرسال للتحميص
| العمود | الوصف |
|---|---|
| `ID` | `SEN-000001` |
| `Date`, `CoffeeType`, `QuantityKg`, `BatchRef`, `Notes`, `EnteredBy`, `Timestamp` | — |

**قاعدة تحقق:** `QuantityKg ≤ getRawStockBalance_(CoffeeType)` وإلا يُرفض الإدخال بالكامل.

## 5) `Received_from_Roastery` — استلام بعد التحميص
| العمود | الوصف |
|---|---|
| `ID` | `REC-000001` |
| `SentQuantityKg` | الكمية المرسلة (تُدخَل يدوياً لكل دفعة، وليست مشتقة تلقائياً من `Sent_to_Roastery`) |
| `ReceivedQuantityKg` | الكمية الفعلية المستلمة، يجب ≤ `SentQuantityKg` |
| `WasteKg` | = `SentQuantityKg - ReceivedQuantityKg` (محسوب تلقائياً، **مخزَّن** لتسريع التقارير) |
| `WastePercent` | = `WasteKg / SentQuantityKg * 100` (محسوب تلقائياً، مخزَّن) |

## 6) `Packing_Process` — التعبئة والتغليف
| العمود | الوصف |
|---|---|
| `ID` | `PAC-000001` |
| `InputQuantityKg` | كمية القهوة المحمصة المدخلة للتعبئة، يجب ≤ `getRoastedStockBalance_()` |
| `BagsProduced` | عدد أكياس 200غ الناتجة |
| `ExpectedOutputKg` | = `BagsProduced × BagSizeKg` (من `Config`) |
| `WasteKg` | = `InputQuantityKg - ExpectedOutputKg` |
| `WastePercent` | = `WasteKg / InputQuantityKg * 100` |

## 7) `Finished_Products` — منتج نهائي جاهز
| العمود | الوصف |
|---|---|
| `ID` | `FIN-000001` |
| `BagsAdded` | يجب ≤ `getPackingInProgressBags_()` (الأكياس المنتجة في `Packing_Process` والتي لم تُسجَّل بعد كمنتج نهائي) |
| `ProductName` | افتراضي: "Ready-Made Packed Coffee" |

## 8) `AuditLog`
سجل تدقيق بسيط لكل عملية دخول/إدخال بيانات (`Timestamp`, `Username`, `Action`, `Details`). للقراءة اليدوية فقط حالياً — لا توجد واجهة لعرضه (انظر TODO).

---

## علاقات البيانات (Data Relationships)
لا توجد مفاتيح خارجية حقيقية (Google Sheets لا يدعمها). العلاقة بين المراحل **محسوبة منطقياً** عبر الجمع/الطرح في `SheetService.gs`، وليست عبر أعمدة ربط صريحة:

```
getRawStockBalance_(type)     = Σ RawMaterial_Received.QuantityKg(type) − Σ Sent_to_Roastery.QuantityKg(type)
getAtRoasteryBalance_()       = Σ Sent_to_Roastery.QuantityKg − Σ Received_from_Roastery.SentQuantityKg
getRoastedStockBalance_()     = Σ Received_from_Roastery.ReceivedQuantityKg − Σ Packing_Process.InputQuantityKg
getPackingInProgressBags_()   = Σ Packing_Process.BagsProduced − Σ Finished_Products.BagsAdded
```

`BatchRef` هو حقل نصي حر (وليس مفتاح صارم) يُستخدم لربط الدفعات يدوياً بين المراحل عند الحاجة للتتبع — لا يُفرض تفرّده حالياً برمجياً.

### ⚠️ مفهوم "عند المحمصة الآن" (`getAtRoasteryBalance_`) — مهم لفهم `Received_from_Roastery.SentQuantityKg`
عمود `SentQuantityKg` في شيت `Received_from_Roastery` **يُدخَل يدوياً** لكل صف استلام، ولا يُقرأ تلقائياً من شيت `Sent_to_Roastery`. السبب: المحمصة لا تُلزَم بإرجاع كل دفعة مرسلة دفعة واحدة — قد تُجزّئها على عدة استلامات، أو تخلط عدة إرسالات وترجعها كدفعة محمصة واحدة. لذلك النظام يتحقق من قاعدة أعم وأدق:

> **مجموع كل `SentQuantityKg` المُدخلة تراكمياً في `Received_from_Roastery` لا يمكن أن يتجاوز مجموع `QuantityKg` في `Sent_to_Roastery`.**

هذا الفرق (`Sent_to_Roastery` الإجمالي ناقص `Received_from_Roastery.SentQuantityKg` الإجمالي) هو **"الرصيد المتبقي عند المحمصة"**، ويُعرَض كمؤشر KPI حي في صفحة الإدخال وفي تقرير "الكميات المرسلة للتحميص"، ويُستخدم كحد أقصى صارم عند كل عملية استلام جديدة (`submitReceivedFromRoastery` في `EntryOperations.gs`).

**أمثلة سيناريوهات مدعومة بهذا النموذج** (راجع أيضاً شرح تفصيلي في المحادثة مع المستخدم / سجل الدعم):
- إرسال دفعة واحدة → استلام دفعة واحدة (1:1 بسيط).
- إرسال دفعة واحدة → استلام على عدة دفعات (تجزئة) — كل صف استلام يحمل جزءاً من `SentQuantityKg`، والمجموع يجب أن يساوي الكمية المرسلة الأصلية.
- إرسال عدة دفعات (حتى بأصناف مختلفة) → استلام دفعة محمصة واحدة مخلوطة — صف استلام واحد بـ`SentQuantityKg` يساوي مجموع الإرسالات المخلوطة.

## قواعد التحقق (Validation Rules) — ملخص
| العملية | القاعدة |
|---|---|
| كل الكميات | يجب أن تكون رقماً موجباً (`> 0`)، عدا `BagsProduced` الذي يقبل `≥ 0` |
| `Sent_to_Roastery` | `QuantityKg ≤` رصيد الحبوب الخام المتوفر لنفس الصنف |
| `Received_from_Roastery` | `SentQuantityKg ≤` الرصيد المتبقي "عند المحمصة الآن" (`getAtRoasteryBalance_()`) **و** `ReceivedQuantityKg ≤ SentQuantityKg` |
| `Packing_Process` | `InputQuantityKg ≤` رصيد القهوة المحمصة المتوفرة |
| `Finished_Products` | `BagsAdded ≤` عدد الأكياس المتوفرة في طور التعبئة |

كل هذه القواعد **صارمة (Strict)**: أي تجاوز يُرفض بالكامل ولا يُسجَّل، مع رسالة خطأ ثنائية اللغة توضح الرصيد المتاح فعلياً.

## رصيد افتتاحي (Opening Balance) وفلتر التاريخ
عند بدء استخدام النظام بمخزون موجود مسبقاً (حبوب خام، قهوة نصف جاهزة...)، تُدخَل صفوف "رصيد افتتاحي" يدوياً مباشرة في الشيتات (وليس عبر نماذج التطبيق) بحيث تتوازن كل الأرصدة الوسيطة عند صفر وتظهر فقط الكمية النهائية المطلوبة (راجع سجل المحادثة مع المستخدم لمثال كامل مطبَّق فعلياً: 933 كيس). **مشكلة معروفة**: هذه الصفوف تُدخَل بتاريخ "اليوم" عادة، فتختلط لاحقاً مع عمليات الإنتاج الحقيقية في نفس التقارير المجمَّعة، مما يُشوّه نِسَب الهدر (لأن صفوف الرصيد الافتتاحي تُسجَّل بهدر = 0 دائماً، وهي ليست تمثيلاً حقيقياً لأي عملية تحميص/تعبئة فعلية). **الحل المتاح**: فلتر الفترة الزمنية في `Reports.html` (`fromDate`/`toDate`) يسمح باستبعاد تاريخ الرصيد الافتتاحي من الحسابات، وعرض أداء الإنتاج الفعلي فقط ابتداءً من أي تاريخ يختاره المستخدم.

## هيكل الصف العام (يجب اتباعه لأي شيت جديد)
- العمود الأول دائماً `ID`.
- العمود الأخير دائماً `Timestamp`.
- الصف الأول = Headers، مجمّد (`setFrozenRows(1)`) ومنسّق (خلفية بنية، خط أبيض عريض).
