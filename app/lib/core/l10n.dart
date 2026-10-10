import 'dart:ui' show PlatformDispatcher;

/// Applicant-facing copy in English and Spanish: `tr('Paid', 'Pagado')`.
///
/// The caseworker itself chats in any language; this covers the app's own
/// labels around the conversation. The staff console stays in English.
class Tr {
  const Tr(this.language);

  /// ISO 639-1 code, usually the request's detected language.
  final String language;

  bool get es => language == 'es';

  String call(String en, String es) => this.es ? es : en;

  static const en = Tr('en');

  /// The browser's or phone's language, for screens shown before we know the person's.
  static String deviceLanguage() => PlatformDispatcher.instance.locale.languageCode == 'es' ? 'es' : 'en';
}
