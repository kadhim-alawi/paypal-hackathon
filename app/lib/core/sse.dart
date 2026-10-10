import 'dart:convert';

import 'sse_types.dart';
import 'sse_io.dart' if (dart.library.js_interop) 'sse_web.dart' as impl;

export 'sse_types.dart';

/// Opens a Server-Sent Events stream that reconnects automatically.
SseConnection openSse(Uri url, SseHandler onEvent, {void Function(bool connected)? onStatus}) =>
    impl.openSse(url, (raw) {
      try {
        final decoded = jsonDecode(raw);
        if (decoded is Map<String, dynamic> && decoded['type'] is String) {
          final data = decoded['data'];
          onEvent(SseEvent(decoded['type'] as String, data is Map<String, dynamic> ? data : <String, dynamic>{}));
        }
      } catch (_) {
        // Ignore malformed frames; the next snapshot repairs state.
      }
    }, onStatus: onStatus);
