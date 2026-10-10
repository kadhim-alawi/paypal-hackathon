import 'package:flutter/material.dart';

import '../theme.dart';

/// Renders the small Markdown subset assistants use in chat: paragraphs,
/// headings, bullet and numbered lists, **bold**, *italic*, _italic_ and `code`.
/// Anything else is shown as typed.
class RichMessage extends StatelessWidget {
  const RichMessage(this.text, {super.key, required this.style});
  final String text;
  final TextStyle style;

  static final _bullet = RegExp(r'^\s*[-*•]\s+');
  static final _numbered = RegExp(r'^\s*(\d+)[.)]\s+');
  static final _heading = RegExp(r'^\s*#{1,6}\s+');

  @override
  Widget build(BuildContext context) {
    final blocks = <Widget>[];
    final paragraph = <String>[];

    void flush() {
      if (paragraph.isEmpty) return;
      blocks.add(SelectableText.rich(TextSpan(children: inlineSpans(paragraph.join('\n'), style)), style: style));
      paragraph.clear();
    }

    for (final raw in text.split('\n')) {
      final line = raw.trimRight();
      if (line.trim().isEmpty) {
        flush();
        continue;
      }
      final bullet = _bullet.firstMatch(line);
      final numbered = _numbered.firstMatch(line);
      if (bullet != null || numbered != null) {
        flush();
        final marker = numbered != null ? '${numbered.group(1)}.' : '•';
        final body = line.substring((bullet ?? numbered)!.end);
        final indent = line.length - line.trimLeft().length > 1 ? 14.0 : 0.0;
        blocks.add(Padding(
          padding: EdgeInsets.only(left: indent, top: 2, bottom: 2),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: numbered != null ? 22 : 16, child: Text(marker, style: style.copyWith(color: T.muted))),
            Expanded(child: SelectableText.rich(TextSpan(children: inlineSpans(body, style)), style: style)),
          ]),
        ));
        continue;
      }
      if (_heading.hasMatch(line)) {
        flush();
        blocks.add(Padding(
          padding: const EdgeInsets.only(top: 4),
          child: SelectableText(line.replaceFirst(_heading, '').replaceAll('**', ''), style: style.copyWith(fontWeight: FontWeight.w700)),
        ));
        continue;
      }
      paragraph.add(line);
    }
    flush();

    if (blocks.length == 1) return blocks.single;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      for (var i = 0; i < blocks.length; i++) ...[
        if (i > 0) SizedBox(height: blocks[i] is Padding && blocks[i - 1] is Padding ? 0 : 8),
        blocks[i],
      ],
    ]);
  }

  static final _inline = RegExp(r'\*\*(.+?)\*\*|`([^`]+)`|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])');

  /// Splits [text] into spans for **bold**, *italic* and `code`.
  static List<InlineSpan> inlineSpans(String text, TextStyle style) {
    final spans = <InlineSpan>[];
    var last = 0;
    for (final m in _inline.allMatches(text)) {
      if (m.start > last) spans.add(TextSpan(text: text.substring(last, m.start)));
      if (m.group(1) != null) {
        spans.add(TextSpan(text: m.group(1), style: const TextStyle(fontWeight: FontWeight.w700)));
      } else if (m.group(2) != null) {
        spans.add(TextSpan(
          text: m.group(2),
          style: TextStyle(fontFamily: 'monospace', fontSize: (style.fontSize ?? 15) * 0.9, backgroundColor: T.paperDeep),
        ));
      } else {
        spans.add(TextSpan(text: m.group(3) ?? m.group(4), style: const TextStyle(fontStyle: FontStyle.italic)));
      }
      last = m.end;
    }
    if (last < text.length) spans.add(TextSpan(text: text.substring(last)));
    return spans;
  }
}
