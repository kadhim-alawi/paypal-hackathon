import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Small persistence layer: applicant access tokens and the staff session.
class Storage {
  Storage(this._prefs);
  final SharedPreferences _prefs;

  static Future<Storage> open() async => Storage(await SharedPreferences.getInstance());

  String? applicantToken(String applicationId) => _prefs.getString('app_token_$applicationId');
  Future<void> saveApplicantToken(String applicationId, String token) async {
    await _prefs.setString('app_token_$applicationId', token);
    final ids = myRequests();
    if (!ids.contains(applicationId)) {
      await _prefs.setStringList('my_requests', [applicationId, ...ids].take(20).toList());
    }
  }

  List<String> myRequests() => _prefs.getStringList('my_requests') ?? const [];

  Map<String, dynamic>? get staffSession {
    final raw = _prefs.getString('staff_session');
    if (raw == null) return null;
    try {
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  Future<void> saveStaffSession(Map<String, dynamic>? session) async {
    if (session == null) {
      await _prefs.remove('staff_session');
    } else {
      await _prefs.setString('staff_session', jsonEncode(session));
    }
  }
}
