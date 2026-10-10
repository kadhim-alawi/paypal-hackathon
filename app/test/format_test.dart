import 'package:flutter_test/flutter_test.dart';
import 'package:tideover/core/format.dart';

void main() {
  group('money', () {
    test('formats cents as dollars', () {
      expect(money(28640), r'$286.40');
      expect(money(null), '—');
      expect(money(38000, whole: true), r'$380');
    });

    test('moneySmart drops cents only for whole dollars', () {
      expect(moneySmart(38000), r'$380');
      expect(moneySmart(28640), r'$286.40');
    });

    test('large whole amounts read without cents', () {
      expect(money(175000), r'$1,750');
    });
  });

  group('time labels', () {
    final now = DateTime(2026, 10, 10, 12);

    test('timeAgo', () {
      expect(timeAgo(now.subtract(const Duration(seconds: 10)), now: now), 'just now');
      expect(timeAgo(now.subtract(const Duration(minutes: 25)), now: now), '25 min ago');
      expect(timeAgo(now.subtract(const Duration(hours: 3)), now: now), '3 h ago');
      expect(timeAgo(now.subtract(const Duration(days: 2)), now: now), '2 d ago');
    });

    test('minutesLabel', () {
      expect(minutesLabel(0.4), '< 1 min');
      expect(minutesLabel(11), '11 min');
      expect(minutesLabel(150), '2.5 h');
      expect(minutesLabel(60 * 72), '3.0 days');
    });
  });

  test('titleCase', () {
    expect(titleCase('car_repair'), 'Car repair');
    expect(titleCase(''), '');
  });
}
