import 'package:intl/intl.dart';

const _locale = 'en_US';
final _money = NumberFormat.simpleCurrency(locale: _locale, name: 'USD');
final _moneyWhole = NumberFormat.simpleCurrency(locale: _locale, name: 'USD', decimalDigits: 0);

String money(num? cents, {String currency = 'USD', bool whole = false}) {
  if (cents == null) return '—';
  final f = currency == 'USD'
      ? (whole ? _moneyWhole : _money)
      : NumberFormat.simpleCurrency(locale: _locale, name: currency, decimalDigits: whole ? 0 : 2);
  final value = cents / 100;
  if (!whole && value == value.roundToDouble() && value.abs() >= 1000) return _moneyWhole.format(value);
  return f.format(value);
}

/// "$380" for whole dollars, "$286.40" otherwise.
String moneySmart(num? cents) {
  if (cents == null) return '—';
  return cents % 100 == 0 ? money(cents, whole: true) : money(cents);
}

DateTime? parseTime(dynamic v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;

String timeAgo(DateTime? t, {DateTime? now}) {
  if (t == null) return '';
  final d = (now ?? DateTime.now()).difference(t);
  if (d.inSeconds < 45) return 'just now';
  if (d.inMinutes < 60) return '${d.inMinutes} min ago';
  if (d.inHours < 24) return '${d.inHours} h ago';
  if (d.inDays < 7) return '${d.inDays} d ago';
  return DateFormat.MMMd(_locale).format(t);
}

String minutesLabel(num? minutes, {bool es = false}) {
  if (minutes == null) return '—';
  if (minutes < 1) return '< 1 min';
  if (minutes < 90) return '${minutes.round()} min';
  final h = minutes / 60;
  if (h < 36) return '${h.toStringAsFixed(h < 10 ? 1 : 0)} h';
  return '${(h / 24).toStringAsFixed(1)} ${es ? 'días' : 'days'}';
}

String clock(DateTime? t) => t == null ? '' : DateFormat.jm(_locale).format(t);

String titleCase(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1).replaceAll('_', ' ');
