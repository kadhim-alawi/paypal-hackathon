import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../theme.dart';
import '../../widgets/site.dart';
import '../../widgets/ui.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  Future<List<Fund>>? _funds;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _funds ??= AppScope.of(context)
        .api
        .get('/api/funds')
        .then((v) => (v as List).cast<Map<String, dynamic>>().map(Fund.new).toList());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const SiteHeader(),
      body: ListView(children: [
        const _Hero(),
        const _Problem(),
        const _HowItWorks(),
        _FundsDirectory(funds: _funds),
        const _AgenticGiving(),
        const _Safety(),
        const _BuiltOn(),
        const SizedBox(height: 56),
        const SiteFooter(),
      ]),
    );
  }
}

class _Hero extends StatelessWidget {
  const _Hero();

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final wide = MediaQuery.sizeOf(context).width > 920;
    final copy = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Pill('PayPal + AI for community emergency funds', color: T.tealDark, icon: Icons.bolt_rounded),
      const SizedBox(height: 18),
      Text('Emergency cash in minutes, not months.', style: wide ? t.displayLarge : t.displayMedium),
      const SizedBox(height: 18),
      Text(
        'Tideover gives mutual aid groups, campus emergency funds and relief funds an AI caseworker and PayPal rails, '
        'so a neighbor with a shut-off notice gets paid before the lights go out, and every donor can see where the money went.',
        style: t.bodyLarge?.copyWith(color: T.inkSoft, fontSize: 18),
      ),
      const SizedBox(height: 26),
      Wrap(spacing: 12, runSpacing: 12, children: [
        FilledButton.icon(
          onPressed: () => context.go('/f/eastside'),
          icon: const Icon(Icons.volunteer_activism_rounded),
          label: const Text('See a live fund'),
        ),
        OutlinedButton.icon(
          onPressed: () => context.go('/f/eastside/apply'),
          icon: const Icon(Icons.chat_bubble_outline_rounded),
          label: const Text('I need help'),
        ),
      ]),
      const SizedBox(height: 28),
      Wrap(spacing: 22, runSpacing: 10, children: const [
        _Fact(value: '37%', label: 'of US adults can\'t cover a \$400\nemergency with cash (Fed SHED 2025)'),
        _Fact(value: '7 mo → 1 day', label: 'how much faster cash reached hurricane\nsurvivors once aid went digital (GiveDirectly)'),
      ]),
    ]);
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [T.paper, T.paperDeep]),
      ),
      padding: EdgeInsets.symmetric(vertical: wide ? 72 : 36),
      child: MaxWidth(
        child: wide
            ? Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
                Expanded(flex: 11, child: copy),
                const SizedBox(width: 56),
                const Expanded(flex: 9, child: _LiveCaseMock()),
              ])
            : Column(children: [copy, const SizedBox(height: 32), const _LiveCaseMock()]),
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.value, required this.label});
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Text(value, style: t.headlineSmall?.copyWith(color: T.tealDark, fontWeight: FontWeight.w800)),
      const SizedBox(width: 10),
      Text(label, style: t.bodySmall),
    ]);
  }
}

/// A miniature, animated case timeline that shows the product's promise.
class _LiveCaseMock extends StatefulWidget {
  const _LiveCaseMock();

  @override
  State<_LiveCaseMock> createState() => _LiveCaseMockState();
}

class _LiveCaseMockState extends State<_LiveCaseMock> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 3200))..forward();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    const steps = [
      (Icons.chat_rounded, 'Maria asks for help, in Spanish', '“Se descompuso mi carro y lo necesito para trabajar…”', '9:41'),
      (Icons.document_scanner_rounded, 'AI reads her repair estimate', 'Eastside Auto Care · \$380.00 · matches request', '9:42'),
      (Icons.fact_check_rounded, 'Case file ready for a volunteer', 'Policy ✓  Verified PayPal ✓  No duplicates ✓', '9:42'),
      (Icons.how_to_reg_rounded, 'Sam approves with one tap', 'AI recommended approve · 93% confidence', '9:46'),
      (Icons.send_rounded, '\$380 sent with PayPal Payouts', 'Delivered to her PayPal account', '9:47'),
    ];
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(color: T.surface, borderRadius: T.r28, boxShadow: T.shadow, border: Border.all(color: T.line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Row(children: [
          Text('Request TDO-7KQ4M', style: t.labelLarge),
          const Spacer(),
          AnimatedBuilder(
            animation: _c,
            builder: (_, _) => _c.value > 0.92
                ? const Pill('Paid in 6 min', color: T.teal, icon: Icons.timer_outlined)
                : const Pill('In progress', color: T.info, icon: Icons.sync_rounded),
          ),
        ]),
        const SizedBox(height: 16),
        for (var i = 0; i < steps.length; i++)
          AnimatedBuilder(
            animation: _c,
            builder: (_, child) {
              final start = i / steps.length * 0.9;
              final v = ((_c.value - start) / 0.18).clamp(0.0, 1.0);
              return Opacity(opacity: 0.25 + 0.75 * v, child: Transform.translate(offset: Offset(0, 8 * (1 - v)), child: child));
            },
            child: Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(color: i == steps.length - 1 ? T.teal : T.tealSoft, borderRadius: T.r12),
                  child: Icon(steps[i].$1, size: 19, color: i == steps.length - 1 ? Colors.white : T.tealDark),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(steps[i].$2, style: t.titleSmall),
                    const SizedBox(height: 2),
                    Text(steps[i].$3, style: t.bodySmall),
                  ]),
                ),
                Text(steps[i].$4, style: t.bodySmall),
              ]),
            ),
          ),
      ]),
    );
  }
}

class _Problem extends StatelessWidget {
  const _Problem();

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    const items = [
      (Icons.table_chart_outlined, 'Requests rot in spreadsheets',
          'Volunteer-run funds review applications by hand. A \$300 car repair can take two weeks to approve, and by then the job is gone.'),
      (Icons.gpp_maybe_outlined, 'Fraud and burnout',
          'Duplicate requests, recycled bills and copy-paste stories wear reviewers down, so funds add paperwork that keeps out the people they exist for.'),
      (Icons.account_balance_wallet_outlined, 'Money moves through personal apps',
          'Many groups pay through one organizer\'s personal account, which can be frozen or limited, and donors never see what their gift did.'),
    ];
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 56),
      child: MaxWidth(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('The problem', style: t.labelLarge?.copyWith(color: T.teal)),
          const SizedBox(height: 8),
          Text('Small emergencies become disasters while help waits in a queue.', style: t.headlineMedium),
          const SizedBox(height: 24),
          LayoutBuilder(builder: (context, c) {
            final cols = c.maxWidth > 860 ? 3 : 1;
            return Wrap(
              spacing: 16,
              runSpacing: 16,
              children: [
                for (final i in items)
                  SizedBox(
                    width: (c.maxWidth - 16 * (cols - 1)) / cols,
                    child: SectionCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Icon(i.$1, color: T.coral),
                        const SizedBox(height: 12),
                        Text(i.$2, style: t.titleMedium),
                        const SizedBox(height: 6),
                        Text(i.$3, style: t.bodyMedium?.copyWith(color: T.muted)),
                      ]),
                    ),
                  ),
              ],
            );
          }),
        ]),
      ),
    );
  }
}

class _HowItWorks extends StatelessWidget {
  const _HowItWorks();

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    const steps = [
      ('1', 'Ask in your own words', Icons.mic_rounded,
          'Chat or talk in any language. Snap a photo of the bill. No forms, no account. Connect PayPal (or give a PayPal email or Venmo number) so money can land in minutes.'),
      ('2', 'AI prepares, people decide', Icons.auto_awesome_rounded,
          'Tideover\'s AI caseworker reads documents, checks the fund\'s own written policy and fraud signals, and hands a volunteer a one-minute case file. Small, verified requests can be auto-approved by rules the organizers set.'),
      ('3', 'PayPal delivers, everyone sees it', Icons.send_rounded,
          'Approved grants go out through PayPal Payouts to PayPal or Venmo. Donors give with PayPal, Venmo or Pay Later, can fund a specific approved need, and watch it get paid on a live public ledger.'),
    ];
    return Container(
      color: T.surface,
      padding: const EdgeInsets.symmetric(vertical: 56),
      child: MaxWidth(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('How it works', style: t.labelLarge?.copyWith(color: T.teal)),
          const SizedBox(height: 8),
          Text('From “I need help” to cash in hand, usually within the hour.', style: t.headlineMedium),
          const SizedBox(height: 28),
          LayoutBuilder(builder: (context, c) {
            final cols = c.maxWidth > 860 ? 3 : 1;
            return Wrap(spacing: 24, runSpacing: 24, children: [
              for (final s in steps)
                SizedBox(
                  width: (c.maxWidth - 24 * (cols - 1)) / cols,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      CircleAvatar(
                        radius: 18,
                        backgroundColor: T.teal,
                        child: Text(s.$1, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
                      ),
                      const SizedBox(width: 10),
                      Icon(s.$3, color: T.tealDark),
                    ]),
                    const SizedBox(height: 14),
                    Text(s.$2, style: t.titleLarge),
                    const SizedBox(height: 8),
                    Text(s.$4, style: t.bodyMedium?.copyWith(color: T.muted)),
                  ]),
                ),
            ]);
          }),
        ]),
      ),
    );
  }
}

class _FundsDirectory extends StatelessWidget {
  const _FundsDirectory({required this.funds});
  final Future<List<Fund>>? funds;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 56),
      child: MaxWidth(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Live funds', style: t.labelLarge?.copyWith(color: T.teal)),
          const SizedBox(height: 8),
          Text('Every dollar in and out, in public.', style: t.headlineMedium),
          const SizedBox(height: 24),
          FutureBuilder<List<Fund>>(
            future: funds,
            builder: (context, snap) {
              if (snap.hasError) return ErrorView(error: snap.error!);
              if (!snap.hasData) return const LoadingView();
              return LayoutBuilder(builder: (context, c) {
                final cols = c.maxWidth > 760 ? 2 : 1;
                return Wrap(spacing: 16, runSpacing: 16, children: [
                  for (final f in snap.data!)
                    SizedBox(width: (c.maxWidth - 16 * (cols - 1)) / cols, child: _FundCard(fund: f)),
                ]);
              });
            },
          ),
        ]),
      ),
    );
  }
}

class _FundCard extends StatelessWidget {
  const _FundCard({required this.fund});
  final Fund fund;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final accent = T.parseHex(fund.accentColor);
    return InkWell(
      borderRadius: T.r20,
      onTap: () => context.go('/f/${fund.slug}'),
      child: SectionCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Container(width: 10, height: 10, decoration: BoxDecoration(color: accent, shape: BoxShape.circle)),
            const SizedBox(width: 8),
            Expanded(child: Text(fund.region, style: t.labelMedium?.copyWith(color: T.muted))),
            const Icon(Icons.arrow_forward_rounded, size: 18, color: T.muted),
          ]),
          const SizedBox(height: 10),
          Text(fund.name, style: t.titleLarge),
          const SizedBox(height: 4),
          Text(fund.tagline, style: t.bodyMedium?.copyWith(color: T.muted)),
          const SizedBox(height: 16),
          Wrap(spacing: 18, runSpacing: 8, children: [
            _mini(t, money(fund.stats.grantedCents, whole: true), 'granted'),
            _mini(t, '${fund.stats.peopleHelped}', 'people helped'),
            _mini(t, minutesLabel(fund.stats.medianMinutesToCash), 'median time to cash'),
          ]),
        ]),
      ),
    );
  }

  Widget _mini(TextTheme t, String v, String l) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(v, style: t.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
        Text(l, style: t.bodySmall),
      ]);
}

class _AgenticGiving extends StatelessWidget {
  const _AgenticGiving();

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final info = AppScope.of(context).info;
    final mcp = info.mcpUrl.isEmpty ? '${Uri.base.origin}/mcp' : info.mcpUrl;
    return Container(
      color: T.ink,
      padding: const EdgeInsets.symmetric(vertical: 56),
      child: MaxWidth(
        child: LayoutBuilder(builder: (context, c) {
          final wide = c.maxWidth > 860;
          final left = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Agentic giving', style: t.labelLarge?.copyWith(color: T.sun)),
            const SizedBox(height: 8),
            Text('Your AI assistant can find a verified need and fund it.',
                style: t.headlineMedium?.copyWith(color: Colors.white)),
            const SizedBox(height: 12),
            Text(
              'Tideover is an MCP server. Ask Claude, or any MCP-capable assistant, to find an approved need under your budget. '
              'It returns a PayPal checkout link; you approve the payment, and the grant is paid out the moment your gift lands. '
              'Agents can discover and propose, but only a person can pay.',
              style: t.bodyLarge?.copyWith(color: Colors.white70),
            ),
            const SizedBox(height: 18),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.08), borderRadius: T.r12),
              child: Row(children: [
                Expanded(
                  child: SelectableText('claude mcp add --transport http tideover $mcp',
                      style: const TextStyle(fontFamily: 'monospace', color: Colors.white, fontSize: 13)),
                ),
                IconButton(
                  tooltip: 'Copy',
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: 'claude mcp add --transport http tideover $mcp'));
                    showSnack(context, 'Copied');
                  },
                  icon: const Icon(Icons.copy_rounded, color: Colors.white70, size: 18),
                ),
              ]),
            ),
          ]);
          final chat = Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.06), borderRadius: T.r20, border: Border.all(color: Colors.white12)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _bubble('You', 'Find someone near Riverside who needs help under \$500 and set up a gift.', mine: true),
              _bubble('Assistant', 'Using Tideover · find_needs → 1 approved need: rent gap for a nursing student, \$420, approved yesterday by a person. Want me to create a PayPal checkout for \$420?'),
              _bubble('You', 'Yes, from Alex.', mine: true),
              _bubble('Assistant', 'create_donation → here\'s your PayPal link. Once you approve, the grant goes out immediately and I\'ll confirm when it lands.'),
            ]),
          );
          return wide
              ? Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(child: left),
                  const SizedBox(width: 40),
                  Expanded(child: chat),
                ])
              : Column(children: [left, const SizedBox(height: 24), chat]);
        }),
      ),
    );
  }

  Widget _bubble(String who, String text, {bool mine = false}) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Column(crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start, children: [
          Text(who, style: const TextStyle(color: Colors.white54, fontSize: 11.5, fontWeight: FontWeight.w600)),
          const SizedBox(height: 3),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            decoration: BoxDecoration(color: mine ? T.teal : Colors.white.withValues(alpha: 0.10), borderRadius: T.r12),
            child: Text(text, style: const TextStyle(color: Colors.white, fontSize: 13.5, height: 1.4)),
          ),
        ]),
      );
}

class _Safety extends StatelessWidget {
  const _Safety();

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    const points = [
      (Icons.how_to_reg_outlined, 'People decide', 'AI writes the case file and a recommendation. Volunteers approve. Large grants need two different reviewers.'),
      (Icons.rule_rounded, 'Rules enforce', 'Category caps, fund balance, cooldowns and idempotent payouts are checked in code. The AI cannot move money.'),
      (Icons.balance_rounded, 'Fair by design', 'The AI evaluates only the fund\'s written policy and is told never to use protected characteristics. Every recommendation is explained.'),
      (Icons.receipt_long_outlined, 'Everything is on the record', 'Every decision, AI output and PayPal event lands in an append-only audit log. The public feed shows every grant, anonymized.'),
    ];
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 56),
      child: MaxWidth(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Responsible by default', style: t.labelLarge?.copyWith(color: T.teal)),
          const SizedBox(height: 8),
          Text('AI proposes. People decide. Rules enforce.', style: t.headlineMedium),
          const SizedBox(height: 24),
          LayoutBuilder(builder: (context, c) {
            final cols = c.maxWidth > 860 ? 4 : (c.maxWidth > 520 ? 2 : 1);
            return Wrap(spacing: 16, runSpacing: 16, children: [
              for (final p in points)
                SizedBox(
                  width: (c.maxWidth - 16 * (cols - 1)) / cols,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Icon(p.$1, color: T.teal),
                    const SizedBox(height: 10),
                    Text(p.$2, style: t.titleMedium),
                    const SizedBox(height: 6),
                    Text(p.$3, style: t.bodyMedium?.copyWith(color: T.muted)),
                  ]),
                ),
            ]);
          }),
        ]),
      ),
    );
  }
}

class _BuiltOn extends StatelessWidget {
  const _BuiltOn();

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    const items = [
      ('PayPal Payouts', 'Grants to PayPal & Venmo in minutes'),
      ('Orders v2 + JS SDK', 'Donations via PayPal, Venmo, Pay Later, cards'),
      ('Log in with PayPal', 'Verified payout identity, fewer duplicates'),
      ('Webhooks', 'Signature-verified real-time money events'),
      ('Transaction Search', 'Automatic reconciliation'),
      ('PayPal Agent Toolkit', 'Treasurer copilot reads live PayPal data'),
    ];
    return MaxWidth(
      child: SectionCard(
        title: 'Built on PayPal',
        subtitle: 'Every money movement runs through PayPal\'s APIs, sandbox-tested end to end.',
        child: LayoutBuilder(builder: (context, c) {
          final cols = c.maxWidth > 860 ? 3 : (c.maxWidth > 520 ? 2 : 1);
          return Wrap(spacing: 12, runSpacing: 12, children: [
            for (final i in items)
              SizedBox(
                width: (c.maxWidth - 12 * (cols - 1)) / cols,
                child: Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(color: T.paper, borderRadius: T.r16),
                  child: Row(children: [
                    const Icon(Icons.check_circle_rounded, color: T.paypalLight, size: 20),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(i.$1, style: t.titleSmall),
                        Text(i.$2, style: t.bodySmall),
                      ]),
                    ),
                  ]),
                ),
              ),
          ]);
        }),
      ),
    );
  }
}
