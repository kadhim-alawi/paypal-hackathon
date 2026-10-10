/// Where the Tideover API lives.
///
/// On the web the app is served by the API itself, so it uses the page's
/// origin. Mobile builds (and `flutter run -d chrome` against a separate API)
/// pass `--dart-define=API_BASE=https://your-tideover-host`.
class AppConfig {
  static const String _defined = String.fromEnvironment('API_BASE');

  static String get apiBase {
    if (_defined.isNotEmpty) return _defined.replaceAll(RegExp(r'/$'), '');
    final base = Uri.base;
    if (base.scheme == 'http' || base.scheme == 'https') return base.origin;
    return 'http://10.0.2.2:8080'; // Android emulator → host machine
  }

  /// Native apps can't be redirected back from PayPal in the same tab.
  static bool get isWebOrigin {
    final s = Uri.base.scheme;
    return s == 'http' || s == 'https';
  }
}
