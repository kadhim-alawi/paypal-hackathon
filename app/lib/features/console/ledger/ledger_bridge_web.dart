import 'dart:async';
import 'dart:js_interop';

import 'package:flutter/widgets.dart';
import 'package:web/web.dart' as web;

import 'ledger_bridge.dart';

@JS('tideoverLedger')
external _LedgerJs? get _ledgerJs;

extension type _LedgerJs._(JSObject _) implements JSObject {
  external JSPromise<JSNumber> mount(web.HTMLElement el, JSAny? options);
  external JSPromise<_AnswerJs> ask(String question);
  external void reset();
  external void quickFilter(String text);
  external void exportCsv();
  external void exportExcel();
  external void destroy();
}

extension type _AnswerJs._(JSObject _) implements JSObject {
  external String? get explanation;
  external String? get mode;
}

class _WebLedger implements LedgerBridge {
  _WebLedger(this.apiBase, this.token, this.licenseKey);
  final String apiBase;
  final String token;
  final String? licenseKey;

  @override
  bool get supported => true;

  /// ledger.js is a deferred script; it is normally there long before staff open the Ledger.
  Future<_LedgerJs> _ready() async {
    for (var i = 0; i < 50; i++) {
      final js = _ledgerJs;
      if (js != null) return js;
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    throw StateError('The ledger script did not load.');
  }

  @override
  Widget view({required void Function(int rows) onReady, required void Function(Object error) onError}) {
    return HtmlElementView.fromTagName(
      tagName: 'div',
      onElementCreated: (Object element) async {
        final div = element as web.HTMLElement;
        div.style
          ..width = '100%'
          ..height = '100%';
        try {
          final js = await _ready();
          final options = {'apiBase': apiBase, 'token': token, 'licenseKey': licenseKey}.jsify();
          final rows = await js.mount(div, options).toDart;
          onReady(rows.toDartInt);
        } catch (e) {
          onError(e);
        }
      },
    );
  }

  @override
  Future<LedgerAnswer> ask(String question) async {
    final js = await _ready();
    try {
      final answer = await js.ask(question).toDart;
      return LedgerAnswer(answer.explanation ?? '', answer.mode ?? '');
    } catch (e) {
      // Rejections from ledger.js arrive as JS Errors; keep just their message.
      throw StateError('$e'.replaceFirst(RegExp(r'^(Error|JavaScriptError|TypeError): '), ''));
    }
  }

  @override
  void reset() => _ledgerJs?.reset();

  @override
  void quickFilter(String text) => _ledgerJs?.quickFilter(text);

  @override
  void exportCsv() => _ledgerJs?.exportCsv();

  @override
  void exportExcel() => _ledgerJs?.exportExcel();

  @override
  void dispose() => _ledgerJs?.destroy();
}

LedgerBridge createLedgerBridge({required String apiBase, required String token, String? licenseKey}) =>
    _WebLedger(apiBase, token, licenseKey);
