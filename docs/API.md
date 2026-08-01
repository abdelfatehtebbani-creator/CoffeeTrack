# API — الدوال العامة المتاحة للواجهة الأمامية

جميع الدوال تُستدعى من HTML عبر `google.script.run.withSuccessHandler(...).withFailureHandler(...).functionName(...)`. لا يوجد REST endpoints — هذا هو بروتوكول Apps Script القياسي.

كل دالة (عدا `login`) تتطلب `token` كأول باراميتر، وتفشل (`withFailureHandler`) برسالة `Error` ثنائية اللغة إذا كانت الجلسة منتهية أو الدور غير مصرَّح له.

---

## SheetService.gs (دالة عامة مشتركة، متاحة لكل الأدوار)

### `getTodayActivity(token)`
- **الغرض**: ملخص "نشاط اليوم" — عدد وكمية كل عملية إدخال يدوية بتاريخ اليوم عبر المراحل الخمس، تُعرض كبطاقة أعلى صفحتي الإدخال والتقارير.
- **Parameters**: `token` فقط.
- **Return**: `{date, rawReceived:{count,quantityKg}, sentToRoastery:{count,quantityKg}, receivedFromRoastery:{count,quantityKg}, packing:{count,bagsProduced}, finished:{count,bagsAdded}, delivery:{count,bagsDelivered}, totalOperations}`.
- **الأخطاء**: جلسة غير صالحة فقط — **متاحة لأي دور مسجَّل دخول** (`requireSession_` فقط، بدون تقييد دور محدَّد)، بخلاف بقية دوال `EntryOperations.gs`/`ReportsOperations.gs`.
- **يُستدعى من**: `Entry.html` (`loadTodayActivity()` عند التحميل وبعد كل عملية حفظ ناجحة) و`Reports.html` (`loadTodayActivity()` عند التحميل).
- **ملاحظة**: مستقلة تماماً عن فلتر الفترة الزمنية في صفحة التقارير — تعرض دائماً تاريخ اليوم الفعلي بغض النظر عن أي فلتر مُطبَّق على التقارير الستة.

---

## Auth.gs

### `login(username, password)`
- **الغرض**: مصادقة المستخدم وإنشاء جلسة.
- **Parameters**: `username` (string), `password` (string).
- **Return**: `{success: true, token, role, fullName, username}` أو `{success: false, error: string}`.
- **الأخطاء المحتملة**: لا يرمي استثناء أبداً؛ يعيد `success:false` مع رسالة ثنائية اللغة عند فشل المطابقة.
- **يُستدعى من**: `Login.html` → `doLogin()`.

### `logout(token)`
- **الغرض**: إنهاء الجلسة الحالية (حذف التوكن من `CacheService`).
- **Parameters**: `token` (string).
- **Return**: `{success: true}`.
- **الأخطاء**: لا شيء (idempotent — استدعاؤها بتوكن غير موجود لا يفشل).
- **يُستدعى من**: `Entry.html` و`Reports.html` → `doLogout()`.

---

## EntryOperations.gs
كل الدوال هنا تتطلب دور `Admin` أو `DataEntry` (`ENTRY_ROLES`). كل دالة تُنفَّذ (من التحقق من الرصيد وحتى الكتابة) داخل قفل حصري ذرّي (`withLock_()`) لمنع تجاوز التحقق الصارم عبر طلبات متزامنة (مثال: نقرة مزدوجة على الهاتف) — راجع `CLAUDE.md` §4.1.

### `submitRawReceived(token, data)`
- **الغرض**: تسجيل استلام حبوب قهوة من المورد.
- **Parameters**: `data = {date, coffeeType, quantityKg, supplier?, notes?}`.
- **Return**: `{success: true, id, message}`.
- **الأخطاء**: حقل مفقود، كمية ≤ 0، جلسة غير صالحة/دور غير مصرَّح.
- **يُستدعى من**: `Entry.html` → تبويب "استلام من المورد" → `submitForm('raw')`.

### `submitSentToRoastery(token, data)`
- **الغرض**: تسجيل إرسال حبوب لقسم التحميص/الطحن.
- **Parameters**: `data = {date, coffeeType, quantityKg, batchRef?, notes?}`.
- **Return**: `{success: true, id, message}`.
- **الأخطاء**: نفس أخطاء `submitRawReceived` + **"الكمية أكبر من الرصيد المتوفر"** إذا `quantityKg` > رصيد الصنف المتوفر (`getRawStockBalance_`).
- **يُستدعى من**: `Entry.html` → تبويب "إرسال للتحميص".

### `submitReceivedFromRoastery(token, data)`
- **الغرض**: تسجيل استلام القهوة المطحونة/المحمصة من التحميص (كلياً أو جزئياً).
- **Parameters**: `data = {date, batchRef?, receivedQuantityKg, notes?}`. ⚠️ لا يوجد `sentQuantityKg` — حُذف عمداً (راجع `CLAUDE.md` §4.2).
- **Return**: `{success: true, id, cumulativeWastePercent, message}` — `cumulativeWastePercent` نسبة الهدر **الإجمالية** حتى الآن (وليست لهذا الصف تحديداً)، تُحسب لحظياً من مقارنة إجمالي شيتي `Sent_to_Roastery` و`Received_from_Roastery`.
- **الأخطاء**: حقول مفقودة، `receivedQuantityKg` ≤ 0، **"الكمية المستلمة أكبر من إجمالي المتبقي فعلياً عند المحمصة"** (`receivedQuantityKg` يُقارَن مباشرة بـ `getAtRoasteryBalance_()`).
- **يُستدعى من**: `Entry.html` → تبويب "استلام من التحميص".
- **ملاحظة مهمة (قرار تصميمي)**: لا يُطلَب من المستخدم تقدير "الكمية المرسلة" لكل صف، لأن المحمصة قد تُجزّئ أو تخلط الدفعات فلا يمكن معرفة ذلك بدقة. الحماية من الإدخال الخاطئ تتم على المستوى التراكمي فقط: إجمالي كل الاستلامات لا يمكن أن يتجاوز إجمالي كل الإرسالات. راجع `docs/Database.md` (قسم "قرار تصميمي" في شيت `Received_from_Roastery`) للتفاصيل الكاملة.

### `submitPackingProcess(token, data)`
- **الغرض**: تسجيل تحويل قهوة محمصة (كغ) إلى أكياس 200غ، مع حساب هدر التعبئة.
- **Parameters**: `data = {date, batchRef?, inputQuantityKg, bagsProduced, notes?}`.
- **Return**: `{success: true, id, wasteKg, wastePercent, message}`.
- **الأخطاء**: حقول مفقودة، `inputQuantityKg` ≤ 0، `bagsProduced` < 0، **"الكمية أكبر من رصيد القهوة المحمصة المتوفرة"**.
- **يُستدعى من**: `Entry.html` → تبويب "التعبئة والتغليف".
- **ملاحظة**: يقرأ `BagSizeKg` من `Config` عبر `getConfigMap_()` — لا قيمة ثابتة بالكود.

### `submitFinishedProduct(token, data)`
- **الغرض**: تأكيد أكياس مُعبَّأة كمنتج نهائي جاهز للبيع.
- **Parameters**: `data = {date, batchRef?, bagsAdded, productName?, notes?}`.
- **Return**: `{success: true, id, message}`.
- **الأخطاء**: حقول مفقودة، `bagsAdded` ≤ 0، **"عدد الأكياس أكبر من المتوفر في طور التعبئة"**.
- **يُستدعى من**: `Entry.html` → تبويب "منتج نهائي جاهز".

### `submitDelivery(token, data)`
- **الغرض**: تسجيل تسليم أكياس من المخزون الجاهز لعميل/وجهة، يخصم من `getFinishedStockBalance_()`.
- **Parameters**: `data = {date, batchRef?, bagsDelivered, customer?, notes?}`.
- **Return**: `{success: true, id, message}`.
- **الأخطاء**: حقول مفقودة، `bagsDelivered` ≤ 0، **"عدد الأكياس أكبر من المتوفر في المخزون الجاهز للتسليم"**.
- **يُستدعى من**: `Entry.html` → تبويب "تسليم" (السادس والأخير).

### `getCurrentBalances(token)`
- **الغرض**: تزويد لوحة المؤشرات (KPI) في صفحة الإدخال بالأرصدة اللحظية.
- **Parameters**: `token` فقط.
- **Return**: `{rawStock: {type1: n, type2: n}, atRoasteryKg: n, roastedStock: n, packingInProgressBags: n, finishedStockAvailable: n, finishedBags: n, coffeeTypes: [type1, type2]}`.
  - `finishedStockAvailable`: المخزون الجاهز **المتاح فعلياً للتسليم الآن** (= `finishedBags` − إجمالي المُسلَّم عبر `Deliveries`).
  - `finishedBags`: إجمالي كل ما سُجِّل كمنتج نهائي **تراكمياً منذ البداية** (لا يُخصَم منه التسليم — رقم تاريخي وليس رصيداً حالياً).
- **الأخطاء**: جلسة غير صالحة فقط (أي دور مسجَّل دخول يمكنه قراءتها، تُستخدم أيضاً لملء قوائم الأصناف المنسدلة).
- **يُستدعى من**: `Entry.html` → `loadBalances()` عند تحميل الصفحة وبعد كل عملية حفظ ناجحة.

---

## ReportsOperations.gs
كل الدوال هنا تتطلب دور `Admin` أو `Accountant` (`REPORT_ROLES`) — قراءة فقط، لا تعديل بيانات.

**فلترة بنطاق تاريخ (`fromDate`/`toDate`)**: التقارير 1, 2, 3, 5, 6, 7 تقبل باراميترين اختياريين إضافيين، نص بصيغة `'yyyy-MM-dd'` أو `''` لعدم الفلترة — تُستخدم لعزل فترة زمنية محددة (مثلاً الدفعة الحديثة فقط، مستبعدةً رصيداً افتتاحياً قديماً). التقرير 4 استثناء متعمَّد (لا يقبلهما) لأنه يعرض رصيداً فعلياً لحظياً وليس مجموعاً على فترة.

### `reportRawReceivedByType(token, fromDate?, toDate?)`
- **الغرض**: تفصيل الكميات المستلمة من المورد حسب الصنف + الرصيد الفعلي المتوفر حالياً.
- **Return**: `{rows: [...], totalsByType: {type: kg}, grandTotalKg, currentStockByType: {type: kg}, currentStockGrandTotal}` — `currentStockByType`/`currentStockGrandTotal` رصيد لحظي حقيقي (غير مفلتَر بالتاريخ عمداً، كبقية الأرصدة اللحظية في المشروع).
- **يُستدعى من**: `Reports.html` (ضمن `getAllReports`).

### `reportSentToRoastery(token, fromDate?, toDate?)`
- **الغرض**: تفصيل الكميات المرسلة للتحميص.
- **Return**: `{rows: [...], totalsByType: {type: kg}, grandTotalKg, atRoasteryKg}` — `atRoasteryKg` غير مفلتَر بالتاريخ (رصيد لحظي).

### `reportReceivedFromRoastery(token, fromDate?, toDate?)`
- **الغرض**: تفصيل الكميات المستلمة بعد التحميص + نسبة الهدر **الإجمالية** لكامل الفترة (وليست لكل صف — راجع `CLAUDE.md` §4.2).
- **Return**: `{rows: [{date, batchRef, receivedKg, notes, enteredBy}, ...], totals: {sentKg, receivedKg, wasteKg, wastePercent}}` — `totals.sentKg` يأتي من مقارنة مستقلة بإجمالي شيت `Sent_to_Roastery` ضمن نفس الفترة، وليس من عمود داخل `Received_from_Roastery`.

### `reportRoastedAvailable(token)`
- **الغرض**: الكمية المحمصة المتوفرة حالياً في المخزون (رصيد فعلي لحظي — لا يقبل فلتر تاريخ عمداً).
- **Return**: `{totalReceivedFromRoastery, totalSentToPacking, availableKg}`.

### `reportPackingInProgress(token, fromDate?, toDate?)`
- **الغرض**: الكمية قيد التعبئة (نصف جاهزة) + نسبة هدر التعبئة.
- **Return**: `{rows: [...], totals: {inputKg, bagsProduced, expectedOutputKg, wasteKg, wastePercent, bagsStillInProgress}}` — `bagsStillInProgress` غير مفلتَر بالتاريخ (رصيد لحظي).

### `reportFinishedProducts(token, fromDate?, toDate?)`
- **الغرض**: تفصيل الكمية الجاهزة (منتج نهائي).
- **Return**: `{rows: [...], totalBags, availableForDelivery}` — `availableForDelivery` رصيد لحظي حقيقي (غير مفلتَر بالتاريخ)، يساوي `getFinishedStockBalance_()`.

### `reportDeliveries(token, fromDate?, toDate?)`
- **الغرض**: تفصيل عمليات تسليم المنتج للعملاء (التقرير السابع).
- **Return**: `{rows: [...], totalBags}`.

### `getAllReports(token, fromDate?, toDate?)`
- **الغرض**: دالة تجميعية تستدعي التقارير السبعة أعلاه بنداء واحد — تُستخدم لتقليل عدد رحلات `google.script.run` عند تحميل الصفحة.
- **Return**: `{rawReceived, sentToRoastery, receivedFromRoastery, roastedAvailable, packingInProgress, finishedProducts, deliveries}` (كل مفتاح هو نفس مخرج الدالة المقابلة أعلاه).
- **الأخطاء**: أي خطأ صلاحية يوقف الاستدعاء بالكامل (لا نتائج جزئية).
- **يُستدعى من**: `Reports.html` → `refreshAll()` عند تحميل الصفحة، عند الضغط على "تحديث"، وعند تطبيق/مسح فلتر التاريخ (`applyFilter_`, `clearFilter_`).

---

## Code.gs (دوال بنية الصفحة — ليست RPC)

### `doGet(e)`
- ليست دالة RPC، بل نقطة الدخول الوحيدة للـ Web App. تُستدعى تلقائياً من Google عند فتح الرابط.
- **Parameters**: `e.parameter.page` = `'login'` (افتراضي) | `'entry'` | `'reports'`.

### `include(filename)`
- تُستخدم فقط داخل قوالب HTML (`<?!= include('Style'); ?>`)، وليست متاحة لـ `google.script.run`.

---

## Setup.gs (دالة إدارية — تُشغَّل يدوياً من المحرر فقط)

### `initializeSpreadsheet()`
- **الغرض**: تهيئة كل الشيتات لأول مرة (لا تُستدعى من أي واجهة HTML عمداً، لتفادي إعادة التهيئة العرضية من مستخدم عادي).
- **طريقة التشغيل**: من محرر Apps Script فقط (`clasp open` → اختيار الدالة → Run).
- **Return**: نص تأكيد ثنائي اللغة.
- آمنة لإعادة التشغيل (idempotent) — لا تكرر الشيتات أو تعيد كتابة بيانات `Config`/`Users` إن كانت موجودة.
