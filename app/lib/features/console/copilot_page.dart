import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/app_scope.dart';
import '../../core/models.dart';
import '../../core/sse.dart';
import '../../theme.dart';
import '../../widgets/ui.dart';
import '../apply/chat_widgets.dart';

/// Treasurer copilot: Claude with Tideover tools plus the official PayPal
/// Agent Toolkit for live PayPal data.
class CopilotPage extends StatefulWidget {
  const CopilotPage({super.key});

  @override
  State<CopilotPage> createState() => _CopilotPageState();
}

class _CopilotPageState extends State<CopilotPage> {
  final List<ChatMessage> _messages = [];
  final _scroll = ScrollController();
  SseConnection? _sse;
  String? _draftId;
  String _draft = '';
  final List<String> _tools = [];
  bool _loading = true;
  bool _busy = false;

  static const _suggestions = [
    'How much can we still grant this week, fund by fund?',
    'Which cases have been waiting longest for a decision?',
    'Reconcile our records with PayPal for the last 7 days.',
    'Who were our biggest donors this month, and did any come through AI agents?',
  ];

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_sse != null) return;
    final services = AppScope.of(context);
    _load(services.api);
    _sse = openSse(services.api.uri('/api/staff/copilot/events', {'token': services.session.token ?? ''}), _onEvent);
  }

  Future<void> _load(ApiClient api) async {
    try {
      final rows = await api.get('/api/staff/copilot') as List;
      setState(() {
        _messages
          ..clear()
          ..addAll(rows.cast<Map<String, dynamic>>().map(ChatMessage.fromJson));
        _loading = false;
      });
      _toBottom();
    } catch (_) {
      setState(() => _loading = false);
    }
  }

  void _onEvent(SseEvent e) {
    setState(() {
      switch (e.type) {
        case 'copilot.start':
          _draftId = e.data['turnId'] as String?;
          _draft = '';
          _tools.clear();
        case 'copilot.delta':
          _draft += e.data['text'] as String? ?? '';
        case 'copilot.tool':
          _tools.add(e.data['name'] as String? ?? 'tool');
        case 'copilot.done':
          _messages.add(ChatMessage(
            id: e.data['turnId'] as String? ?? '',
            role: 'assistant',
            content: e.data['content'] as String? ?? '',
            meta: {'tools': e.data['tools']},
          ));
          _draftId = null;
          _draft = '';
          _busy = false;
      }
    });
    _toBottom();
  }

  void _toBottom() => WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent + 120, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
      });

  Future<void> _send(String text) async {
    setState(() {
      _busy = true;
      _messages.add(ChatMessage(id: 'u${DateTime.now().millisecondsSinceEpoch}', role: 'user', content: text));
    });
    _toBottom();
    try {
      await AppScope.of(context).api.post('/api/staff/copilot', body: {'content': text});
    } on ApiException catch (e) {
      setState(() => _busy = false);
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  @override
  void dispose() {
    _sse?.close();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final info = AppScope.of(context).info;
    return Column(children: [
      Expanded(
        child: _loading
            ? const LoadingView()
            : ListView(controller: _scroll, padding: const EdgeInsets.all(20), children: [
                Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 820),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Text('Treasurer copilot', style: t.headlineMedium),
                      const SizedBox(height: 4),
                      Text(
                        'Ask about cases, balances and donors. It reads live PayPal data through the official PayPal Agent Toolkit'
                        '${info.simulated ? ' (simulator data in this demo)' : ''}. Refunds always need your explicit confirmation.',
                        style: t.bodyMedium?.copyWith(color: T.muted),
                      ),
                      const SizedBox(height: 16),
                      if (_messages.isEmpty)
                        Wrap(spacing: 8, runSpacing: 8, children: [
                          for (final s in _suggestions)
                            ActionChip(
                              avatar: const Icon(Icons.auto_awesome_outlined, size: 16),
                              label: Text(s),
                              onPressed: _busy ? null : () => _send(s),
                            ),
                        ]),
                      for (final m in _messages) ...[
                        ChatBubble(message: m),
                        if (m.role == 'assistant' && m.meta['tools'] is List && (m.meta['tools'] as List).isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(left: 36, bottom: 6),
                            child: Wrap(spacing: 6, runSpacing: 6, children: [
                              for (final tool in (m.meta['tools'] as List).whereType<Map>())
                                _ToolChip(name: '${tool['name']}', ok: tool['ok'] != false),
                            ]),
                          ),
                      ],
                      if (_draftId != null) ...[
                        if (_tools.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(left: 36, bottom: 6),
                            child: Wrap(spacing: 6, runSpacing: 6, children: [for (final n in _tools) _ToolChip(name: n, ok: true)]),
                          ),
                        ChatBubble(message: ChatMessage(id: 'draft', role: 'assistant', content: _draft), streaming: true),
                      ],
                    ]),
                  ),
                ),
              ]),
      ),
      Composer(enabled: !_busy, busy: _busy, onSend: _send, hint: 'Ask about funds, cases, donors or PayPal activity…'),
    ]);
  }
}

class _ToolChip extends StatelessWidget {
  const _ToolChip({required this.name, required this.ok});
  final String name;
  final bool ok;

  @override
  Widget build(BuildContext context) {
    final paypal = name.startsWith('paypal_');
    return Pill(
      paypal ? 'PayPal Agent Toolkit · ${name.substring(7)}' : name,
      color: ok ? (paypal ? T.paypalLight : T.muted) : T.danger,
      icon: paypal ? Icons.account_balance_wallet_outlined : Icons.build_circle_outlined,
      dense: true,
    );
  }
}
