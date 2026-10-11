import 'package:flutter/widgets.dart';

import 'ledger_bridge.dart';

class _Unsupported implements LedgerBridge {
  @override
  bool get supported => false;

  @override
  Widget view({required void Function(int rows) onReady, required void Function(Object error) onError}) => const SizedBox.shrink();

  @override
  Future<LedgerAnswer> ask(String question) async => const LedgerAnswer('', '');

  @override
  void reset() {}

  @override
  void quickFilter(String text) {}

  @override
  void exportCsv() {}

  @override
  void exportExcel() {}

  @override
  void dispose() {}
}

LedgerBridge createLedgerBridge({required String apiBase, required String token, String? licenseKey}) => _Unsupported();
