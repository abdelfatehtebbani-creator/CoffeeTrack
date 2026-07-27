# Changelog

كل التغييرات المهمة على المشروع تُوثَّق هنا. التنسيق مستوحى من [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] — الإصدار الأول

### Added
- بنية مشروع Google Apps Script كاملة: `Code.gs`, `Setup.gs`, `SheetService.gs`, `Auth.gs`, `EntryOperations.gs`, `ReportsOperations.gs`.
- 3 صفحات HTML: `Login.html`, `Entry.html`, `Reports.html`، بتصميم عصري موحّد عبر `Style.html`.
- دعم ثنائي اللغة (عربي RTL / إنجليزي LTR) بنمط `data-ar`/`data-en` + زر تبديل لغة في كل صفحة.
- شعار AL AKER SWEETS مضمّن كـ Base64 داخل `LogoBase64.html` (بدون الحاجة لاستضافة خارجية).
- نظام مصادقة بسيط (username/password) مخزَّن في شيت `Users`، مع جلسات مؤقتة عبر `CacheService` (٦ ساعات).
- 3 أدوار مستخدمين: `Admin` (كل الصلاحيات)، `DataEntry` (صفحة الإدخال فقط)، `Accountant` (صفحة التقارير فقط).
- 5 نماذج إدخال بيانات تغطي دورة القهوة الكاملة:
  1. استلام حبوب من المورد (Coffee Beans Received from the Supplier)
  2. إرسال حبوب للتحميص (Coffee Beans Sent to the Roastery)
  3. استلام مطحون بعد التحميص (Ground Coffee Received from the Roastery) — مع حساب تلقائي لنسبة الهدر
  4. تعبئة القهوة (Coffee Under Processing / Packing) — تحويل كغ إلى أكياس 200غ مع حساب هدر التعبئة
  5. تسجيل منتج نهائي جاهز (Ready-Made Packed Coffee)
- تحقق صارم (Strict validation): كل عملية تُرفض إذا تجاوزت الرصيد المتوفر فعلياً في المرحلة السابقة.
- لوحة مؤشرات (KPI dashboard) في صفحة الإدخال تعرض الأرصدة الحالية لحظياً.
- 6 تقارير في صفحة التقارير:
  1. الكميات المستلمة من المورد حسب الصنف
  2. الكميات المرسلة للتحميص
  3. الكميات المستلمة بعد التحميص + نسبة الهدر
  4. الكمية المحمصة المتوفرة حالياً
  5. الكمية قيد التعبئة (نصف جاهزة) + نسبة هدر التعبئة
  6. الكمية الجاهزة (منتج نهائي)
- دالة `initializeSpreadsheet()` لإنشاء كل الشيتات + مستخدم Admin افتراضي بضغطة واحدة.
- سجل تدقيق (`AuditLog`) يسجّل كل عملية تسجيل دخول أو إدخال بيانات.
- توثيق كامل للمشروع: `README.md`, `CLAUDE.md`, `docs/Architecture.md`, `docs/Database.md`, `docs/API.md`, `docs/TODO.md`.

### Changed
- لا يوجد (إصدار أول).

### Added
- **تحقق جديد: "الرصيد عند المحمصة"** (`getAtRoasteryBalance_` في `SheetService.gs`) — يمنع الآن إدخال `Sent Quantity (kg)` في نموذج "استلام من التحميص" بقيمة أكبر من الكمية المتبقية فعلياً عند المحمصة (المرسلة ولم تُسوَّ بعد عبر أي استلام سابق). يدعم هذا بشكل صحيح حالات تجزئة الدفعة العائدة على عدة استلامات، أو دمج عدة إرسالات في استلام واحد مخلوط. يظهر هذا الرصيد كمؤشر KPI حي في صفحة الإدخال ("عند المحمصة الآن") وفي تقرير "الكميات المرسلة للتحميص". راجع `docs/Database.md` (قسم "مفهوم عند المحمصة الآن") للشرح الكامل مع الأمثلة.

### Fixed
- **صفحة بيضاء فارغة بعد تسجيل الدخول (blank white page)**: كانت كل الصفحات تبني رابط التنقّل بين الصفحات (`getBaseUrl_()`) من `window.location.href` في طرف العميل. لكن Apps Script HTML Service يعرض المحتوى داخل إطار معزول (iframe) على نطاق `googleusercontent.com` مختلف عن رابط `/exec` الحقيقي، فكان `window.location.href` يعطي رابط الإطار الداخلي، والتنقّل إليه مباشرة (`window.top.location.href = ...`) يفتح صفحة فارغة بدون سياق تنفيذ صحيح. **الحل**: `Code.gs` يحقن الرابط الحقيقي عبر `ScriptApp.getService().getUrl()` في متغيّر `baseUrl` يُقرأ داخل كل صفحة كـ `const BASE_URL = '<?!= baseUrl ?>';`. طُبِّق على `Login.html`, `Entry.html`, `Reports.html`. راجع `CLAUDE.md` §8.2 للتفاصيل الكاملة وقاعدة عدم تكرار هذا الخطأ مستقبلاً.
- **`SPREADSHEET_ID` مفقود لمشاريع clasp المستقلة**: أُضيف ثابت `SPREADSHEET_ID` في `Setup.gs` + منطق في `getSS_()` (`SheetService.gs`) يستخدم `SpreadsheetApp.openById(SPREADSHEET_ID)` إن كان محدَّداً، ويعود تلقائياً لـ `getActiveSpreadsheet()` فقط إذا كان المشروع Container-bound. السبب: `SpreadsheetApp.getActiveSpreadsheet()` يعمل فقط إن كان المشروع مرتبطاً مباشرة بشيت من داخله؛ مشاريع `clasp create` المستقلة تحتاج تحديد الـ ID صراحة، وإلا يفشل الكود بصمت أو بخطأ غامض. راجع README (قسم "ربط المشروع") لخطوات إيجاد الـ ID ووضعه.
- **`ReferenceError: ROLES is not defined`**: استُبدلت الثوابت `ENTRY_ROLES` (في `EntryOperations.gs`) و`REPORT_ROLES` (في `ReportsOperations.gs`) — وكانتا `const` على المستوى الأعلى تعتمدان على `ROLES` المعرَّف في `Setup.gs` — بدالتين محسوبتين وقت التنفيذ (`entryRoles_()`, `reportRoles_()`). السبب: Apps Script يحمّل الملفات أبجدياً، و`EntryOperations.gs`/`ReportsOperations.gs` (E/R) تُحمَّل قبل `Setup.gs` (S)، فكان `ROLES` غير معرَّف بعد عند وصول المحمل إليها. راجع `CLAUDE.md` §8 للتفاصيل والقاعدة العامة لتفادي هذا مستقبلاً.

### Planned
راجع [docs/TODO.md](docs/TODO.md) للخارطة الكاملة. أبرز النقاط:
- تشفير كلمات المرور (حالياً نص عادي في شيت `Users` — مقبول للنسخة الداخلية الأولى فقط).
- توحيد كود `setLang()`/i18n المكرر بين الصفحات الثلاث في ملف مشترك.
- دعم عدد ديناميكي من أصناف القهوة (حالياً صنفان ثابتان في `Config`).
- تصدير التقارير إلى PDF/Excel.
