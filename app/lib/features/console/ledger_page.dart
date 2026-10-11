import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../theme.dart';
import '../../widgets/ui.dart';
import 'console_common.dart';
import 'ledger/ledger_bridge.dart';

/// The treasurer's Ledger: every money movement in an AG Grid spreadsheet, with
/// "ask the ledger" (AG Grid AI Toolkit + Claude) to slice it in plain English.
class LedgerPage extends StatefulWidget {
  const LedgerPage({super.key});

  @override
  State<LedgerPage> createState() => _LedgerPageState();
}

class _LedgerPageState extends State<LedgerPage> {
  LedgerBridge? _bridge;
  Widget? _grid;
  int? _rows;
  Object? _error;
  bool _asking = false;
  String? _explanation;
  String? _mode;
  final _question = TextEditingController();
  final _search = TextEditingController();

  static const _suggestions = [
    'Total grants by category this month',
    'Donations that came through AI agents',
    'Grants over \$200, largest first',
    'Money in and out by month',
    'PayPal fees by fund',
  ];

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_bridge != null) return;
    final services = AppScope.of(context);
    final bridge = createLedgerBridge(
      apiBase: services.api.baseUrl,
      token: services.session.token ?? '',
      licenseKey: services.info.agGridLicenseKey,
    );
    _bridge = bridge;
    _grid = bridge.view(
      onReady: (rows) {
        if (mounted) setState(() => _rows = rows);
      },
      onError: (e) {
        if (mounted) setState(() => _error = e);
      },
    );
  }

  @override
  void dispose() {
    _bridge?.dispose();
    _question.dispose();
    _search.dispose();
    super.dispose();
  }

  Future<void> _ask(String question) async {
    final q = question.trim();
    if (q.isEmpty || _asking || _rows == null) return;
    _question.text = q;
    setState(() => _asking = true);
    try {
      final answer = await _bridge!.ask(q);
      if (mounted) {
        setState(() {
          _explanation = answer.explanation;
          _mode = answer.mode;
        });
      }
    } catch (e) {
      if (mounted) showSnack(context, '$e', error: true);
    } finally {
      if (mounted) setState(() => _asking = false);
    }
  }

  void _reset() {
    _bridge?.reset();
    _search.clear();
    setState(() {
      _explanation = null;
      _question.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final bridge = _bridge!;
    final ready = _rows != null;
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ConsolePageHeader(
          title: 'Ledger',
          subtitle: 'Every dollar in and out, with its PayPal ID. Ask in plain English, or slice it like a spreadsheet.',
          actions: [
            OutlinedButton.icon(
              onPressed: ready ? bridge.exportCsv : null,
              icon: const Icon(Icons.download_rounded, size: 18),
              label: const Text('CSV'),
            ),
            const SizedBox(width: 8),
            FilledButton.tonalIcon(
              onPressed: ready ? bridge.exportExcel : null,
              icon: const Icon(Icons.grid_on_rounded, size: 18),
              label: const Text('Excel'),
            ),
          ],
        ),
        if (!bridge.supported)
          const Expanded(
            child: EmptyState(
              icon: Icons.table_chart_outlined,
              title: 'Open the console in a browser',
              message: 'The Ledger runs on the web version of the staff console.',
            ),
          )
        else ...[
          _AskBar(
            controller: _question,
            busy: _asking,
            enabled: ready,
            suggestions: _suggestions,
            onAsk: _ask,
          ),
          if (_explanation != null) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
              decoration: BoxDecoration(color: T.tealSoft, borderRadius: T.r12),
              child: Row(children: [
                const Icon(Icons.auto_awesome_rounded, size: 18, color: T.tealDark),
                const SizedBox(width: 10),
                Expanded(child: Text(_explanation!, style: t.bodyMedium?.copyWith(color: T.inkSoft))),
                if (_mode == 'claude') const Padding(padding: EdgeInsets.only(right: 6), child: Pill('Claude · AG Grid AI Toolkit', color: T.tealDark, dense: true)),
                TextButton.icon(onPressed: _reset, icon: const Icon(Icons.restart_alt_rounded, size: 18), label: const Text('Show everything')),
              ]),
            ),
          ],
          const SizedBox(height: 12),
          Row(children: [
            SizedBox(
              width: 280,
              child: TextField(
                controller: _search,
                enabled: ready,
                onChanged: bridge.quickFilter,
                decoration: const InputDecoration(
                  isDense: true,
                  prefixIcon: Icon(Icons.search_rounded, size: 20),
                  hintText: 'Search donor, case, PayPal ID…',
                ),
              ),
            ),
            const SizedBox(width: 12),
            if (ready) Text('$_rows movements · drag a column header up to group by it', style: t.bodySmall?.copyWith(color: T.muted)),
          ]),
          const SizedBox(height: 12),
          Expanded(
            child: Stack(children: [
              Positioned.fill(child: _grid!),
              if (_error != null)
                Positioned.fill(
                  child: ColoredBox(color: T.paper, child: ErrorView(error: _error!, onRetry: () => setState(() => _error = null))),
                )
              else if (!ready)
                const Positioned.fill(child: IgnorePointer(child: ColoredBox(color: T.paper, child: LoadingView(label: 'Loading the ledger…')))),
            ]),
          ),
        ],
      ]),
    );
  }
}

class _AskBar extends StatelessWidget {
  const _AskBar({required this.controller, required this.busy, required this.enabled, required this.suggestions, required this.onAsk});
  final TextEditingController controller;
  final bool busy;
  final bool enabled;
  final List<String> suggestions;
  final void Function(String question) onAsk;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: T.surface, borderRadius: T.r16, border: Border.all(color: T.line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Expanded(
            child: TextField(
              controller: controller,
              enabled: enabled && !busy,
              textInputAction: TextInputAction.search,
              onSubmitted: onAsk,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.auto_awesome_outlined, color: T.teal),
                hintText: 'Ask the ledger, e.g. "total grants by category this month"',
              ),
            ),
          ),
          const SizedBox(width: 10),
          FilledButton(
            onPressed: enabled && !busy ? () => onAsk(controller.text) : null,
            child: busy
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white))
                : const Text('Ask'),
          ),
        ]),
        const SizedBox(height: 10),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final s in suggestions)
            ActionChip(
              label: Text(s),
              onPressed: enabled && !busy ? () => onAsk(s) : null,
            ),
        ]),
      ]),
    );
  }
}
