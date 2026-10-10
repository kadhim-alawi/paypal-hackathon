import 'dart:js_interop';

import 'package:web/web.dart' as web;

import 'sse_types.dart';

class _WebSse implements SseConnection {
  _WebSse(this._source);
  final web.EventSource _source;

  @override
  void close() => _source.close();
}

SseConnection openSse(Uri url, void Function(String raw) onRaw, {void Function(bool connected)? onStatus}) {
  final source = web.EventSource(url.toString());
  source.onmessage = ((web.MessageEvent e) {
    final data = e.data;
    if (data != null && data.isA<JSString>()) onRaw((data as JSString).toDart);
  }).toJS;
  source.onopen = ((web.Event _) => onStatus?.call(true)).toJS;
  source.onerror = ((web.Event _) => onStatus?.call(false)).toJS; // EventSource retries by itself
  return _WebSse(source);
}
