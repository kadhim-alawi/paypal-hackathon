import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tideover/widgets/rich_message.dart';

void main() {
  const style = TextStyle(fontSize: 15);

  List<(String, TextStyle?)> spans(String text) =>
      RichMessage.inlineSpans(text, style).cast<TextSpan>().map((s) => (s.text!, s.style)).toList();

  test('bold, italic and code become styled spans', () {
    final out = spans('Send **\$380** to _Maria_ via `PAYPAL_ID` now');
    expect(out.map((s) => s.$1).toList(), ['Send ', r'$380', ' to ', 'Maria', ' via ', 'PAYPAL_ID', ' now']);
    expect(out[1].$2?.fontWeight, FontWeight.w700);
    expect(out[3].$2?.fontStyle, FontStyle.italic);
    expect(out[5].$2?.fontFamily, 'monospace');
  });

  test('snake_case words and lone asterisks stay as typed', () {
    final out = spans('Use record_details and a 2 * 3 grid');
    expect(out.map((s) => s.$1).join(), 'Use record_details and a 2 * 3 grid');
    expect(out, hasLength(1));
  });

  testWidgets('renders headings, bullets and numbered lists', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: RichMessage('## Summary\nTwo funds:\n- **Eastside**: \$992 available\n- Riverside: \$68\n\n1. First\n2. Second', style: style),
      ),
    ));
    expect(find.text('•'), findsNWidgets(2));
    expect(find.text('1.'), findsOneWidget);
    expect(find.text('2.'), findsOneWidget);
    expect(find.text('Summary'), findsOneWidget);
  });
}
