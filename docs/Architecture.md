# Architecture

## نظرة عامة على النظام
Coffee Track هو تطبيق ويب أحادي الـ Deployment مبني بالكامل على Google Apps Script، بدون أي خادم خارجي أو قاعدة بيانات منفصلة. Google Sheets يلعب دور قاعدة البيانات، وApps Script يلعب دور الـ Backend وHTML Service يلعب دور الـ Frontend — كلهم داخل نفس مشروع Apps Script المرتبط بنفس الـ Spreadsheet.

```
┌─────────────────────────────────────────────────────────────┐
│                     متصفح المستخدم (Browser)                  │
│                                                                 │
│   Login.html  ──────►  Entry.html  ◄──────► Reports.html      │
│        │                    │                     │            │
│        └──────── google.script.run (RPC) ─────────┘            │
└─────────────────────────────┬───────────────────────────────┘
                                │  HTTPS (Web App URL)
┌─────────────────────────────▼───────────────────────────────┐
│                    Google Apps Script (Server)                  │
│                                                                 │
│  Code.gs (doGet/router)                                        │
│      │                                                          │
│      ├── Auth.gs        (login, logout, requireSession_, requireRole_)
│      ├── EntryOperations.gs        (submit* + getCurrentBalances)         │
│      ├── ReportsOperations.gs      (report* + getAllReports)              │
│      │        │                                                 │
│      │        ▼                                                 │
│      └── SheetService.gs (readSheetAsObjects_, appendRow_, sum*_) │
│                 │                                                │
│      Setup.gs ──┘ (constants: SHEETS, ROLES + initializeSpreadsheet)│
└─────────────────────────────┬───────────────────────────────┘
                                │  SpreadsheetApp API
┌─────────────────────────────▼───────────────────────────────┐
│                     Google Sheets (Database)                   │
│  Config | Users | RawMaterial_Received | Sent_to_Roastery |    │
│  Received_from_Roastery | Packing_Process | Finished_Products | │
│  AuditLog                                                       │
└─────────────────────────────────────────────────────────────┘
```

## تدفق التنفيذ (Execution Flow)

### 1. فتح الرابط (أول زيارة)
1. المستخدم يفتح رابط الـ Web App.
2. `doGet(e)` في `Code.gs` يقرأ `e.parameter.page` (افتراضي: `login`).
3. بما أنه لا توجد جلسة بعد، يُعرض `Login.html`.

### 2. تسجيل الدخول (Authentication Flow)
1. المستخدم يدخل اسم المستخدم/كلمة المرور ويضغط "تسجيل الدخول".
2. `Login.html` يستدعي `login(username, password)` في `Auth.gs` عبر `google.script.run`.
3. `login()` يقرأ شيت `Users` (عبر `SheetService.gs`)، يبحث عن تطابق Username+Password+Active=true.
4. عند النجاح: يُنشأ `token` (UUID) ويُخزَّن في `CacheService` لمدة 6 ساعات مع `{username, role, fullName}`.
5. العميل يخزّن `token`, `role`, `fullName`, `username` في `sessionStorage` (وليس `localStorage` — يُفرَّغ تلقائياً عند إغلاق التبويب).
6. التوجيه: `Accountant` → `?page=reports`، غير ذلك (`Admin`/`DataEntry`) → `?page=entry`.

### 3. كل طلب لاحق (Entry أو Reports)
- كل صفحة، عند التحميل (`DOMContentLoaded`)، تتحقق من وجود `token` في `sessionStorage` وتتحقق من الدور محلياً (لتحديد أي واجهة تُعرض)، **لكن التحقق الحقيقي والملزم يحدث دائماً على السيرفر** داخل كل دالة (`requireRole_`) — الفحص في العميل هو تجربة مستخدم فقط (UX)، وليس طبقة أمان.
- كل نداء `google.script.run.someFunction(token, ...)` يمرّ أولاً بـ `requireSession_`/`requireRole_` في `Auth.gs` قبل تنفيذ أي منطق.

## مسؤوليات كل خدمة (Service Responsibilities)

| الملف | المسؤولية |
|---|---|
| `Code.gs` | التوجيه بين الصفحات (`doGet`) + دالة `include()` لتضمين HTML جزئي |
| `Setup.gs` | الثوابت المشتركة (`SHEETS`, `ROLES`, `BAG_SIZE_KG`) + التهيئة الأولى لمرة واحدة |
| `SheetService.gs` | كل قراءة/كتابة على Google Sheets + حساب كل الأرصدة (raw/roasted/packing/finished) |
| `Auth.gs` | تسجيل الدخول/الخروج + إدارة التوكن عبر `CacheService` + دوال حراسة (`requireSession_`, `requireRole_`) |
| `EntryOperations.gs` | منطق الأعمال للعمليات الخمس (تحقق + كتابة) + `getCurrentBalances` للوحة المؤشرات |
| `ReportsOperations.gs` | تجميع بيانات التقارير الستة (قراءة فقط، لا كتابة) |

## تفاعل HTML/UI
- **لا يوجد إطار عمل (framework)** — HTML + Vanilla JS خالص، لتفادي أي تعقيد بناء (build step) غير مدعوم جيداً في Apps Script.
- `Style.html` يُضمَّن في رأس كل صفحة عبر `<?!= include('Style'); ?>` — يشمل CSS فقط (لا JS)، فيُعاد استخدامه بين 3 صفحات دون تكرار.
- `LogoBase64.html` يُضمَّن كنص Base64 خام داخل `src="data:image/jpeg;base64,<?!= include('LogoBase64'); ?>"` — لا استضافة خارجية، الشعار يعمل حتى بدون اتصال بخدمات صور خارجية.
- كل صفحة تحتوي سكربت JS خاص بها (غير مشترك حالياً) يتعامل مع: تبديل اللغة (`setLang`)، تسجيل الخروج، ونداءات `google.script.run` الخاصة بمنطقها.

## تدفق البيانات (Data Flow) بين الخدمات
```
Entry.html --submitRawReceived(token,data)--> EntryOperations.gs
                                                   │ requireRole_(token, [Admin,DataEntry])
                                                   │ validate + appendRow_()
                                                   ▼
                                          SheetService.gs --> Sheet "RawMaterial_Received"

Reports.html --getAllReports(token)--> ReportsOperations.gs
                                            │ requireRole_(token, [Admin,Accountant])
                                            │ يستدعي 6 دوال report* بالتوازي منطقياً (تسلسلياً فعلياً)
                                            ▼
                                    SheetService.gs (readSheetAsObjects_ + sum*_ + get*Balance_)
                                            ▼
                                    كل الشيتات (قراءة فقط)
```

لا يوجد أي مسار بيانات مباشر بين `EntryOperations.gs` و`ReportsOperations.gs` — كلاهما يمر حصراً عبر `SheetService.gs`، مما يضمن أن أي تعديل مستقبلي على منطق الحساب (مثل تغيير طريقة حساب الهدر) يُطبَّق تلقائياً في كل مكان يستخدمه.
