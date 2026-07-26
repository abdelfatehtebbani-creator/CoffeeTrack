/**
 * Code.gs
 * -------------------------------------------------------------
 * Main entry point. Handles routing between:
 *  - Login page (?page=login, or default when not logged in)
 *  - Entry page (?page=entry)   -> Admin, DataEntry
 *  - Reports page (?page=reports) -> Admin, Accountant
 *
 * NOTE: Apps Script HTML Service is stateless per request, so the
 * actual access check happens again in Auth.gs/EntryOperations.gs/ReportsOperations.gs
 * on every google.script.run call. The routing here only decides
 * which HTML shell to serve; it does not by itself secure data.
 * -------------------------------------------------------------
 */

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) || 'login';
  let template;

  switch (page) {
    case 'entry':
      template = HtmlService.createTemplateFromFile('Entry');
      break;
    case 'reports':
      template = HtmlService.createTemplateFromFile('Reports');
      break;
    default:
      template = HtmlService.createTemplateFromFile('Login');
  }

  // مهم جداً: لا يمكن الاعتماد على window.location من طرف العميل للحصول على
  // رابط /exec الحقيقي، لأن الواجهة تُعرض داخل إطار معزول (sandboxed iframe)
  // على نطاق مختلف (googleusercontent.com). لذلك نحقن الرابط الصحيح من
  // الخادم مباشرة عبر ScriptApp.getService().getUrl() ليستخدمه كل عميل.
  template.baseUrl = ScriptApp.getService().getUrl();

  return template.evaluate()
    .setTitle('AL AKER | Coffee Track')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Used inside HTML templates: <?!= include('Style'); ?> */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
