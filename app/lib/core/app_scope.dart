import 'package:flutter/widgets.dart';

import 'api.dart';
import 'models.dart';
import 'storage.dart';

/// Staff session (console). Persists the token so a refresh keeps you signed in.
class StaffSession extends ChangeNotifier {
  StaffSession(this._api, this._storage) {
    final saved = _storage.staffSession;
    if (saved != null && saved['token'] is String && saved['user'] is Map<String, dynamic>) {
      _token = saved['token'] as String;
      _user = StaffUser(saved['user'] as Map<String, dynamic>);
      _api.staffToken = _token;
    }
  }

  final ApiClient _api;
  final Storage _storage;
  String? _token;
  StaffUser? _user;

  StaffUser? get user => _user;
  String? get token => _token;
  bool get signedIn => _token != null;

  Future<void> signIn(String email, String password) async {
    final res = await _api.post('/api/auth/login', body: {'email': email, 'password': password}) as Map<String, dynamic>;
    _token = res['token'] as String;
    _user = StaffUser(res['user'] as Map<String, dynamic>);
    _api.staffToken = _token;
    await _storage.saveStaffSession({'token': _token, 'user': _user!.toJson()});
    notifyListeners();
  }

  Future<void> signOut() async {
    _token = null;
    _user = null;
    _api.staffToken = null;
    await _storage.saveStaffSession(null);
    notifyListeners();
  }

  /// Called when the API says the session expired.
  void expire() {
    if (_token == null) return;
    signOut();
  }
}

class AppServices {
  AppServices({required this.api, required this.storage, required this.info, required this.session});
  final ApiClient api;
  final Storage storage;
  final AppInfo info;
  final StaffSession session;
}

class AppScope extends InheritedWidget {
  const AppScope({super.key, required this.services, required super.child});
  final AppServices services;

  static AppServices of(BuildContext context) =>
      context.getInheritedWidgetOfExactType<AppScope>()!.services;

  @override
  bool updateShouldNotify(AppScope oldWidget) => services != oldWidget.services;
}
