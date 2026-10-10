import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/sse.dart';
import '../../theme.dart';
import '../../widgets/site.dart';
import '../../widgets/ui.dart';
import 'give_sheet.dart';

class FundPage extends StatefulWidget {
  const FundPage({super.key, required this.slug, this.giftState});
  final String slug;
  final String? giftState;

  @override
  State<FundPage> createState() => _FundPageState();
}

class _FundPageState extends State<FundPage> {
  Fund? _fund;
  Object? _error;
  SseConnection? _sse;
  bool _live = false;
  Timer? _debounce;
  final Set<String> _fresh = {};

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_fund == null && _error == null) {
      _load();
      _sse = openSse(
        AppScope.of(context).api.uri('/api/funds/${widget.slug}/events'),
        (e) {
          _debounce?.cancel();
          _debounce = Timer(const Duration(milliseconds: 350), () => _load(markFresh: true));
        },
        onStatus: (ok) => mounted ? setState(() => _live = ok) : null,
      );
      if (widget.giftState == 'cancelled' || widget.giftState == 'failed') {
        WidgetsBinding.instance.addPostFrameCallback((_) => showSnack(
              context,
              widget.giftState == 'failed' ? 'PayPal didn\'t complete the payment. No money was taken.' : 'Gift cancelled. No money was taken.',
            ));
      }
    }
  }

  @override
  void dispose() {
    _sse?.close();
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load({bool markFresh = false}) async {
    try {
      final previous = _fund?.feed.map((f) => f.id).toSet() ?? {};
      final json = await AppScope.of(context).api.get('/api/funds/${widget.slug}') as Map<String, dynamic>;
      final fund = Fund(json);
      if (!mounted) return;
      setState(() {
        if (markFresh) {
          _fresh.addAll(fund.feed.map((f) => f.id).where((id) => !previous.contains(id)));
        }
        _fund = fund;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _give({Need? need}) {
    final fund = _fund;
    if (fund == null) return;
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => GiveSheet(fund: fund, need: need),
    );
  }

  @override
  Widget build(BuildContext context) {
    final fund = _fund;
    return Scaffold(
      appBar: const SiteHeader(),
      body: _error != null && fund == null
          ? ErrorView(error: _error!, onRetry: _load)
          : fund == null
              ? const LoadingView()
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(children: [
                    _Header(fund: fund, onGive: () => _give()),
                    const SizedBox(height: 24),
                    MaxWidth(child: _Stats(fund: fund)),
                    const SizedBox(height: 24),
                    MaxWidth(
                      child: LayoutBuilder(builder: (context, c) {
                        final wide = c.maxWidth > 900;
                        final left = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          if (fund.needs.isNotEmpty) ...[
                            _Needs(fund: fund, onFund: (n) => _give(need: n)),
                            const SizedBox(height: 16),
                          ],
                          _Feed(fund: fund, live: _live, fresh: _fresh),
                        ]);
                        final right = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          _HowDecisions(fund: fund),
                          const SizedBox(height: 16),
                          _Share(fund: fund),
                        ]);
                        return wide
                            ? Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Expanded(flex: 3, child: left),
                                const SizedBox(width: 16),
                                Expanded(flex: 2, child: right),
                              ])
                            : Column(children: [left, const SizedBox(height: 16), right]);
                      }),
                    ),
                    const SizedBox(height: 48),
                    const SiteFooter(),
                  ]),
                ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.fund, required this.onGive});
  final Fund fund;
  final VoidCallback onGive;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final accent = T.parseHex(fund.accentColor);
    final wide = MediaQuery.sizeOf(context).width > 760;
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [accent, Color.lerp(accent, T.ink, 0.35)!],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      padding: EdgeInsets.symmetric(vertical: wide ? 48 : 32),
      child: MaxWidth(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Icon(Icons.place_outlined, color: Colors.white70, size: 16),
            const SizedBox(width: 4),
            Text(fund.region, style: t.labelLarge?.copyWith(color: Colors.white70)),
            const SizedBox(width: 10),
            if (fund.status != 'open') const Pill('Paused', color: Colors.white, background: Colors.white24),
          ]),
          const SizedBox(height: 10),
          Text(fund.name, style: (wide ? t.displaySmall : t.headlineMedium)?.copyWith(color: Colors.white)),
          const SizedBox(height: 10),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: Text(fund.tagline, style: t.titleMedium?.copyWith(color: Colors.white.withValues(alpha: 0.92), fontWeight: FontWeight.w500)),
          ),
          const SizedBox(height: 24),
          Wrap(spacing: 12, runSpacing: 12, children: [
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: T.ink),
              onPressed: fund.status == 'open' ? () => context.go('/f/${fund.slug}/apply') : null,
              icon: const Icon(Icons.chat_bubble_outline_rounded),
              label: const Text('I need help'),
            ),
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: T.sun, foregroundColor: T.ink),
              onPressed: onGive,
              icon: const Icon(Icons.favorite_rounded),
              label: const Text('Give'),
            ),
          ]),
        ]),
      ),
    );
  }
}

class _Stats extends StatelessWidget {
  const _Stats({required this.fund});
  final Fund fund;

  @override
  Widget build(BuildContext context) {
    final s = fund.stats;
    final tiles = [
      StatTile(
        label: 'Time to cash',
        value: minutesLabel(s.medianMinutesToCash),
        caption: 'median, request → money sent',
        icon: Icons.timer_outlined,
        highlight: true,
        accent: T.parseHex(fund.accentColor),
      ),
      StatTile(label: 'Granted', value: money(s.grantedCents, whole: true), caption: '${s.peopleHelped} people helped', icon: Icons.send_rounded),
      StatTile(label: 'Raised', value: money(s.raisedCents, whole: true), caption: '${s.donationsCount} gifts', icon: Icons.favorite_border_rounded),
      StatTile(
        label: 'Available now',
        value: money(s.availableCents, whole: true),
        caption: s.awaitingCount > 0 ? '${s.awaitingCount} approved need${s.awaitingCount == 1 ? '' : 's'} waiting' : 'in the fund\'s PayPal balance',
        icon: Icons.account_balance_wallet_outlined,
      ),
    ];
    return LayoutBuilder(builder: (context, c) {
      final cols = c.maxWidth > 860 ? 4 : 2;
      return Wrap(spacing: 12, runSpacing: 12, children: [
        for (final tile in tiles) SizedBox(width: (c.maxWidth - 12 * (cols - 1)) / cols, child: tile),
      ]);
    });
  }
}

class _Needs extends StatelessWidget {
  const _Needs({required this.fund, required this.onFund});
  final Fund fund;
  final void Function(Need) onFund;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return SectionCard(
      title: 'Approved and waiting for funds',
      subtitle: 'A volunteer approved these requests. Fund one and it\'s paid out the moment your gift lands.',
      color: T.sunSoft,
      child: Column(children: [
        for (final n in fund.needs)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: T.surface, borderRadius: T.r16, border: Border.all(color: T.line)),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Text(moneySmart(n.amountCents), style: t.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
                    const SizedBox(width: 8),
                    Pill(n.categoryLabel, color: T.tealDark, dense: true),
                  ]),
                  const SizedBox(height: 6),
                  Text(n.story ?? 'Approved ${timeAgo(n.approvedAt)}. Details kept private.', style: t.bodyMedium?.copyWith(color: T.inkSoft)),
                  if (n.location != null) Text(n.location!, style: t.bodySmall),
                ]),
              ),
              const SizedBox(width: 12),
              FilledButton(onPressed: () => onFund(n), child: const Text('Fund this')),
            ]),
          ),
      ]),
    );
  }
}

class _Feed extends StatelessWidget {
  const _Feed({required this.fund, required this.live, required this.fresh});
  final Fund fund;
  final bool live;
  final Set<String> fresh;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return SectionCard(
      title: 'Live ledger',
      subtitle: 'Every grant and gift, anonymized. Updates in real time.',
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        AnimatedContainer(
          duration: const Duration(milliseconds: 300),
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: live ? const Color(0xFF12B76A) : T.faint, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(live ? 'Live' : 'Connecting', style: t.labelMedium?.copyWith(color: T.muted)),
      ]),
      child: fund.feed.isEmpty
          ? const EmptyState(icon: Icons.receipt_long_outlined, title: 'No activity yet')
          : Column(children: [
              for (final item in fund.feed)
                AnimatedContainer(
                  duration: const Duration(milliseconds: 600),
                  margin: const EdgeInsets.only(bottom: 4),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                  decoration: BoxDecoration(
                    color: fresh.contains(item.id) ? T.sunSoft : Colors.transparent,
                    borderRadius: T.r12,
                  ),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Container(
                      width: 34,
                      height: 34,
                      decoration: BoxDecoration(
                        color: item.kind == 'grant' ? T.tealSoft : T.coralSoft,
                        borderRadius: T.r12,
                      ),
                      child: Icon(
                        item.kind == 'grant' ? Icons.send_rounded : (item.viaAgent ? Icons.smart_toy_outlined : Icons.favorite_rounded),
                        size: 17,
                        color: item.kind == 'grant' ? T.tealDark : T.coral,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(item.text, style: t.bodyMedium),
                        const SizedBox(height: 3),
                        Wrap(spacing: 8, children: [
                          Text(timeAgo(item.at), style: t.bodySmall),
                          if (item.kind == 'grant' && item.minutesToCash != null)
                            Text('· paid ${minutesLabel(item.minutesToCash)} after asking', style: t.bodySmall),
                        ]),
                      ]),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '${item.kind == 'grant' ? '−' : '+'}${moneySmart(item.amountCents)}',
                      style: t.titleSmall?.copyWith(color: item.kind == 'grant' ? T.ink : T.teal, fontWeight: FontWeight.w700),
                    ),
                  ]),
                ),
            ]),
    );
  }
}

class _HowDecisions extends StatelessWidget {
  const _HowDecisions({required this.fund});
  final Fund fund;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return SectionCard(
      title: 'What this fund covers',
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(fund.summary, style: t.bodyMedium?.copyWith(color: T.inkSoft)),
        const SizedBox(height: 14),
        for (final c in fund.categories)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(children: [
              const Icon(Icons.check_rounded, size: 18, color: T.teal),
              const SizedBox(width: 8),
              Expanded(child: Text(c.label, style: t.bodyMedium)),
              Text('up to ${money(c.maxCents, whole: true)}', style: t.bodySmall),
            ]),
          ),
        const Divider(height: 28),
        Text('How decisions are made', style: t.titleSmall),
        const SizedBox(height: 8),
        _line(t, Icons.auto_awesome_rounded, 'An AI caseworker reads each request and its documents against this policy and explains its recommendation.'),
        _line(t, Icons.how_to_reg_rounded, 'A volunteer makes the decision. Grants over \$500 need two reviewers.'),
        if (fund.autoApproveLimitCents > 0)
          _line(t, Icons.bolt_rounded,
              'Requests up to ${money(fund.autoApproveLimitCents, whole: true)} can be approved automatically when every check passes and the PayPal account is verified.'),
        _line(t, Icons.lock_outline_rounded, 'Names and details are never shown publicly. Money is sent with PayPal Payouts.'),
        if (fund.policyText != null) ...[
          const SizedBox(height: 4),
          TextButton(
            onPressed: () => showDialog<void>(
              context: context,
              builder: (_) => AlertDialog(
                title: const Text('Fund policy'),
                content: SingleChildScrollView(child: Text(fund.policyText!)),
                actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close'))],
              ),
            ),
            child: const Text('Read the full policy'),
          ),
        ],
      ]),
    );
  }

  Widget _line(TextTheme t, IconData icon, String text) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, size: 17, color: T.tealDark),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: t.bodySmall?.copyWith(color: T.inkSoft, fontSize: 13))),
        ]),
      );
}

class _Share extends StatelessWidget {
  const _Share({required this.fund});
  final Fund fund;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final base = AppScope.of(context).info.publicUrl.isNotEmpty ? AppScope.of(context).info.publicUrl : Uri.base.origin;
    final url = '$base/f/${fund.slug}';
    return SectionCard(
      title: 'Share this fund',
      subtitle: 'Print the code for a community board, clinic or food pantry.',
      child: Row(children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(color: T.surface, borderRadius: T.r12, border: Border.all(color: T.line)),
          child: QrImageView(data: url, size: 112, eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: T.ink)),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SelectableText(url, style: t.bodySmall?.copyWith(color: T.inkSoft)),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: url));
                showSnack(context, 'Link copied');
              },
              icon: const Icon(Icons.link_rounded, size: 18),
              label: const Text('Copy link'),
            ),
          ]),
        ),
      ]),
    );
  }
}
