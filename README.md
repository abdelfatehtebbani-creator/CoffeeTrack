# ☕ Coffee Track — AL AKER SWEETS

نظام متابعة تغليف القهوة (استلام → تحميص/طحن → تعبئة → منتج نهائي → تسليم للعميل)، مبني بالكامل على **Google Apps Script + Google Sheets**، بواجهة عصرية ثنائية اللغة (عربي RTL / إنجليزي).

## الغرض من المشروع
تتبّع دورة القهوة الكاملة داخل المصنع، من الاستلام حتى خروجها للعميل:

```
مورد → استلام حبوب (كغ) → مخزن
     → إرسال للتحميص (كغ)
     → استلام مطحون بعد التحميص (كغ) + حساب % الهدر
     → قهوة محمصة متوفرة (كغ)
     → تعبئة (كيس 200غ) + حساب % هدر التعبئة
     → منتج نهائي جاهز (كيس)
     → تسليم للعميل (كيس)
```

كل مرحلة تتحقق تلقائياً من رصيد المرحلة السابقة، فلا يمكن تسجيل كمية أكبر مما هو متوفر فعلياً (تحقق صارم / strict validation) — بما في ذلك التسليم، الذي لا يمكن أن يتجاوز المخزون الجاهز المتاح فعلياً بعد خصم كل التسليمات السابقة.

## البنية العامة (Architecture)
- **Database**: Google Sheets — كل جدول بيانات = Sheet مستقل (انظر [docs/Database.md](docs/Database.md)).
- **Backend**: Google Apps Script (`.gs`) — طبقة وصول بيانات موحّدة (`SheetService.gs`) + طبقة عمليات (`EntryOperations.gs`, `ReportsOperations.gs`) + مصادقة (`Auth.gs`).
- **Frontend**: HTML Service — صفحتان (`Entry.html`, `Reports.html`) + صفحة دخول (`Login.html`) + CSS مشترك (`Style.html`).
- **Auth**: اسم مستخدم/كلمة مرور مخزّنة في شيت `Users`، مع جلسة مؤقتة عبر `CacheService` (٦ ساعات).
- **Deployment**: Web App واحد، التوجيه بين الصفحات عبر `?page=login|entry|reports`.

تفاصيل أعمق في [docs/Architecture.md](docs/Architecture.md).

## هيكل الملفات

```
CoffeeTrack/
├── appsscript.json         # Manifest المشروع (صلاحيات، إعدادات Web App)
├── Code.gs                 # doGet() + التوجيه + include()
├── Setup.gs                # الثوابت + تهيئة الشيتات (initializeSpreadsheet)
├── SheetService.gs         # طبقة الوصول للبيانات + حساب الأرصدة
├── Auth.gs                 # تسجيل الدخول/الخروج + إدارة الجلسات
├── EntryOperations.gs                # الدوال الست لإدخال البيانات + التحقق من الأرصدة
├── ReportsOperations.gs               # دوال التقارير السبعة
├── Login.html               # صفحة تسجيل الدخول
├── Entry.html                # صفحة إدخال البيانات (Admin / DataEntry)
├── Reports.html              # صفحة التقارير (Admin / Accountant)
├── Style.html                 # CSS مشترك (يُضمَّن بـ include())
├── LogoBase64.html            # شعار AL AKER كنص Base64 (مضمّن بدون استضافة خارجية)
├── docs/
│   ├── Architecture.md
│   ├── Database.md
│   ├── API.md
│   └── TODO.md
├── README.md
├── CLAUDE.md
└── CHANGELOG.md
```

## التبعيات بين الملفات (Dependencies)
- `Code.gs` يعتمد على كل ملفات `.html` (عبر `HtmlService`) ولا يعتمد على أي `.gs` آخر.
- `Auth.gs` يعتمد على `SheetService.gs` (لقراءة شيت `Users`) و`Setup.gs` (للثوابت `SHEETS`, `ROLES`).
- `EntryOperations.gs` و`ReportsOperations.gs` يعتمدان على `SheetService.gs` (القراءة/الكتابة وحساب الأرصدة) و`Auth.gs` (`requireRole_`).
- **لا يوجد ملف `.gs` يستدعي `SpreadsheetApp` مباشرة إلا `SheetService.gs` و`Setup.gs`** — هذه قاعدة معمارية يجب الحفاظ عليها (انظر `CLAUDE.md`).
- كل صفحة `.html` تستدعي فقط الدوال العامة (بدون `_` في النهاية) عبر `google.script.run`.

## التطوير محلياً (VS Code + clasp)

### 1) التثبيت
```bash
npm install -g @google/clasp
clasp login
```

### 2) ربط المشروع

**أ) اربط clasp بمشروع Apps Script (Script ID):**
- أنشئ Google Sheet جديد → Extensions → Apps Script → من إعدادات المشروع (⚙️ Project Settings) انسخ **Script ID**.
- انسخ `.clasp.json.example` إلى `.clasp.json` وضع الـ Script ID:
```bash
cp .clasp.json.example .clasp.json
# عدّل scriptId داخل الملف
```

**ب) حدّد Spreadsheet ID (مهم جداً — هذا الجزء الذي غالباً يُنسى):**
لأن المشروع الذي أنشأته `clasp` هو مشروع **مستقل (standalone)** غير مرتبط تلقائياً بأي شيت، يجب إخبار الكود صراحة بأي شيت يعمل عليه:
1. افتح الـ Google Sheet نفسه الذي أنشأته في الخطوة (أ) في المتصفح.
2. انسخ الجزء من الرابط بين `/d/` و`/edit`:
   ```
   https://docs.google.com/spreadsheets/d/  1AbCDeFGhiJKLmnoPQRstuVWXyz1234567890AbC  /edit
                                             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ هذا هو SPREADSHEET_ID
   ```
3. افتح ملف `Setup.gs` وضع هذا المعرّف في أول سطر:
   ```js
   const SPREADSHEET_ID = 'الصق_المعرف_هنا';
   ```
4. احفظ ثم `clasp push`.

> إن كنت أنشأت المشروع من داخل الشيت مباشرة (Extensions → Apps Script) بدلاً من `clasp create` منفصل، فالمشروع يكون Container-bound تلقائياً ويمكنك ترك `SPREADSHEET_ID` بقيمته الافتراضية `'PASTE_YOUR_SPREADSHEET_ID_HERE'` — الكود سيكتشف ذلك ويستخدم الشيت المرتبط تلقائياً.

### 3) سحب/دفع الكود
```bash
clasp pull     # لجلب الكود الحالي من Apps Script (أول مرة فقط إذا كان هناك كود موجود)
clasp push     # لرفع الكود من VS Code إلى Apps Script
clasp open     # لفتح المحرر في المتصفح
```

### 4) التهيئة الأولى (مرة واحدة)
من محرر Apps Script (`clasp open`)، اختر الدالة `initializeSpreadsheet` من القائمة المنسدلة واضغط Run. هذا سينشئ كل الشيتات + مستخدم Admin افتراضي:
- **Username**: `admin`
- **Password**: `admin123`
- ⚠️ **غيّر كلمة المرور فوراً** بتعديل شيت `Users` يدوياً بعد أول دخول.

### 5) النشر (Deploy)
```bash
clasp deploy --description "v1.0"
```
أو من المحرر: Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone (or your domain).

بعد كل تعديل على الكود، استخدم `clasp push` ثم أنشئ **نسخة نشر جديدة (New deployment)** لتظهر التغييرات على الرابط الفعلي (تحديث deployment قائم لا يكفي دائماً لتغييرات HTML الديناميكية — راجع `docs/Architecture.md`).

## إدارة المستخدمين
أضف/عدّل المستخدمين مباشرة في شيت `Users` (Username, Password, FullName, Role, Active):
| العمود | القيم المسموحة |
|---|---|
| Role | `Admin`, `DataEntry`, `Accountant` |
| Active | `TRUE` / `FALSE` |

## التقارير المتوفرة
راجع [docs/API.md](docs/API.md) لتفاصيل كل دالة، و[docs/Database.md](docs/Database.md) لمعرفة من أين تُشتق كل قيمة.
