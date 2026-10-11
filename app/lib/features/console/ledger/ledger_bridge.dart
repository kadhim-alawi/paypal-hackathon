import 'package:flutter/widgets.dart';

import 'ledger_bridge_stub.dart' if (dart.library.js_interop) 'ledger_bridge_web.dart' as impl;

/// What the AI did to the grid, in the treasurer's words.
class LedgerAnswer {
  const LedgerAnswer(this.explanation, this.mode);
  final String explanation;
  final String mode;
}

/// Connects the Flutter console to the AG Grid ledger (web/ledger/ledger.js).
abstract class LedgerBridge {
  /// False where AG Grid can't run (the native apps); the page explains instead.
  bool get supported;

  /// The grid itself. Calls [onReady] with the row count once data has loaded.
  Widget view({required void Function(int rows) onReady, required void Function(Object error) onError});

  Future<LedgerAnswer> ask(String question);
  void reset();
  void quickFilter(String text);
  void exportCsv();
  void exportExcel();
  void dispose();
}

LedgerBridge createLedgerBridge({required String apiBase, required String token, String? licenseKey}) =>
    impl.createLedgerBridge(apiBase: apiBase, token: token, licenseKey: licenseKey);
