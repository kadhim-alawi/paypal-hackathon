import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'sse_types.dart';

class _IoSse implements SseConnection {
  _IoSse(this.url, this.onRaw, this.onStatus) {
    _connect();
  }

  final Uri url;
  final void Function(String raw) onRaw;
  final void Function(bool connected)? onStatus;
  http.Client? _client;
  StreamSubscription<String>? _sub;
  bool _closed = false;

  Future<void> _connect() async {
    if (_closed) return;
    _client = http.Client();
    try {
      final req = http.Request('GET', url)..headers['Accept'] = 'text/event-stream';
      final res = await _client!.send(req);
      if (res.statusCode != 200) throw Exception('SSE ${res.statusCode}');
      onStatus?.call(true);
      final buffer = StringBuffer();
      _sub = res.stream.transform(utf8.decoder).transform(const LineSplitter()).listen(
        (line) {
          if (line.isEmpty) {
            if (buffer.isNotEmpty) onRaw(buffer.toString());
            buffer.clear();
          } else if (line.startsWith('data:')) {
            if (buffer.isNotEmpty) buffer.write('\n');
            buffer.write(line.substring(5).trimLeft());
          }
        },
        onDone: _retry,
        onError: (_) => _retry(),
        cancelOnError: true,
      );
    } catch (_) {
      _retry();
    }
  }

  void _retry() {
    onStatus?.call(false);
    _client?.close();
    if (_closed) return;
    Timer(const Duration(seconds: 3), _connect);
  }

  @override
  void close() {
    _closed = true;
    _sub?.cancel();
    _client?.close();
  }
}

SseConnection openSse(Uri url, void Function(String raw) onRaw, {void Function(bool connected)? onStatus}) =>
    _IoSse(url, onRaw, onStatus);
