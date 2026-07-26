/**
 * Auth.gs
 * -------------------------------------------------------------
 * Simple username/password authentication stored in the Users
 * sheet, with a session token kept in CacheService (valid 6h).
 * This is intentionally lightweight - Apps Script has no real
 * server session, so we simulate one with a random token that
 * the client re-sends on every call.
 * -------------------------------------------------------------
 */

const SESSION_DURATION_SEC = 6 * 60 * 60; // 6 hours

/**
 * Called from Login.html.
 * @param {string} username
 * @param {string} password
 * @returns {{success:boolean, token?:string, role?:string, fullName?:string, error?:string}}
 */
function login(username, password) {
  const users = readSheetAsObjects_(SHEETS.USERS);
  const user = users.find(u =>
    String(u.Username).toLowerCase() === String(username).toLowerCase() &&
    String(u.Password) === String(password) &&
    (u.Active === true || u.Active === 'TRUE' || u.Active === 'true')
  );

  if (!user) {
    return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة / Invalid username or password' };
  }

  const token = Utilities.getUuid();
  const cache = CacheService.getScriptCache();
  cache.put('session_' + token, JSON.stringify({
    username: user.Username,
    role: user.Role,
    fullName: user.FullName
  }), SESSION_DURATION_SEC);

  writeAudit_(user.Username, 'LOGIN', 'User logged in');

  return { success: true, token: token, role: user.Role, fullName: user.FullName, username: user.Username };
}

function logout(token) {
  const cache = CacheService.getScriptCache();
  cache.remove('session_' + token);
  return { success: true };
}

/**
 * Validates a token and returns the session object, or throws.
 * Every protected server function MUST call this first.
 */
function requireSession_(token) {
  if (!token) throw new Error('لا توجد جلسة نشطة / No active session. Please login again.');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('session_' + token);
  if (!raw) throw new Error('انتهت صلاحية الجلسة / Session expired. Please login again.');
  return JSON.parse(raw);
}

function requireRole_(token, allowedRoles) {
  const session = requireSession_(token);
  if (allowedRoles.indexOf(session.role) === -1) {
    throw new Error('ليست لديك صلاحية لهذا الإجراء / You do not have permission for this action.');
  }
  return session;
}
