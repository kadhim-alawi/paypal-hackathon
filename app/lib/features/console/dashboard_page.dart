import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/api.dart';
import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../theme.dart';
import '../../widgets/ui.dart';
import 'console_common.dart';

class DashboardPage extends StatefulWidget {
  const DashboardPage({super.key});

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> with LiveLoader<DashboardPage, DashboardData> {
  @override
  Future<DashboardData> fetch(ApiClient api) async => DashboardData(await api.get('/api/staff/dashboard') as Map<String, dynamic>);

  @override
  Widget build(BuildContext context) {
    final user = AppScope.of(context).session.user;
    return buildLoaded(context, (d) {
      final review = d.count(['submitted', 'in_review', 'needs_info']);
      return RefreshIndicator(
        onRefresh: load,
        child: ListView(padding: const EdgeInsets.all(20), children: [
          ConsolePageHeader(
            title: 'Good ${_greeting()}, ${user?.name.split(' ').first ?? ''}',
            subtitle: review == 0 ? 'The queue is clear.' : '$review request${review == 1 ? '' : 's'} need a decision.',
            actions: [
              FilledButton.icon(
                onPressed: () => context.go('/console/cases'),
                icon: const Icon(Icons.inbox_rounded),
                label: Text(review == 0 ? 'Open cases' : 'Review $review'),
              ),
            ],
          ),
          _Kpis(d: d),
          const SizedBox(height: 16),
          LayoutBuilder(builder: (context, c) {
            final wide = c.maxWidth > 980;
            final chart = SectionCard(
              title: 'Last 14 days',
              subtitle: 'Money in (gifts) and out (grants) per day',
              child: SizedBox(height: 240, child: _MoneyChart(series: d.series)),
            );
            final funds = _FundBalances(funds: d.funds);
            return wide
                ? Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Expanded(flex: 3, child: chart),
                    const SizedBox(width: 16),
                    Expanded(flex: 2, child: funds),
                  ])
                : Column(children: [chart, const SizedBox(height: 16), funds]);
          }),
          const SizedBox(height: 16),
          LayoutBuilder(builder: (context, c) {
            final wide = c.maxWidth > 980;
            final pipeline = _Pipeline(d: d);
            final activity = _Activity(items: d.recent);
            return wide
                ? Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Expanded(flex: 2, child: pipeline),
                    const SizedBox(width: 16),
                    Expanded(flex: 3, child: activity),
                  ])
                : Column(children: [pipeline, const SizedBox(height: 16), activity]);
          }),
        ]),
      );
    });
  }

  String _greeting() {
    final h = DateTime.now().hour;
    return h < 12 ? 'morning' : (h < 18 ? 'afternoon' : 'evening');
  }
}

class _Kpis extends StatelessWidget {
  const _Kpis({required this.d});
  final DashboardData d;

  @override
  Widget build(BuildContext context) {
    final available = d.funds.fold<int>(0, (s, f) => s + f.stats.availableCents);
    final granted = d.funds.fold<int>(0, (s, f) => s + f.stats.grantedCents);
    final helped = d.funds.fold<int>(0, (s, f) => s + f.stats.peopleHelped);
    final tiles = [
      StatTile(
        label: 'Median time to cash',
        value: minutesLabel(d.medianMinutesToCash),
        caption: 'request → PayPal payout',
        icon: Icons.timer_outlined,
        highlight: true,
      ),
      StatTile(label: 'Granted', value: money(granted, whole: true), caption: '$helped people helped', icon: Icons.send_rounded),
      StatTile(label: 'Available', value: money(available, whole: true), caption: 'across all funds', icon: Icons.account_balance_wallet_outlined),
      StatTile(
        label: 'AI ↔ reviewer agreement',
        value: d.aiAgreement == null ? '—' : '${(d.aiAgreement! * 100).round()}%',
        caption: '${d.aiDecisions} decided cases · ${d.aiModel}',
        icon: Icons.auto_awesome_outlined,
      ),
    ];
    return LayoutBuilder(builder: (context, c) {
      final cols = c.maxWidth > 980 ? 4 : 2;
      return Wrap(spacing: 12, runSpacing: 12, children: [
        for (final tile in tiles) SizedBox(width: (c.maxWidth - 12 * (cols - 1)) / cols, child: tile),
      ]);
    });
  }
}

class _MoneyChart extends StatelessWidget {
  const _MoneyChart({required this.series});
  final List<Map<String, dynamic>> series;

  @override
  Widget build(BuildContext context) {
    double maxY = 100;
    for (final s in series) {
      final g = ((s['grantsCents'] as num?) ?? 0) / 100;
      final d = ((s['donationsCents'] as num?) ?? 0) / 100;
      maxY = [maxY, g, d].reduce((a, b) => a > b ? a : b);
    }
    maxY = (maxY * 1.15 / 100).ceil() * 100;
    return Column(children: [
      Row(children: const [
        _Legend(color: T.teal, label: 'Grants sent'),
        SizedBox(width: 16),
        _Legend(color: T.sun, label: 'Gifts received'),
      ]),
      const SizedBox(height: 12),
      Expanded(
        child: BarChart(
          BarChartData(
            maxY: maxY,
            alignment: BarChartAlignment.spaceAround,
            gridData: FlGridData(
              drawVerticalLine: false,
              horizontalInterval: maxY / 4,
              getDrawingHorizontalLine: (_) => const FlLine(color: T.line, strokeWidth: 1),
            ),
            borderData: FlBorderData(show: false),
            barTouchData: BarTouchData(
              touchTooltipData: BarTouchTooltipData(
                getTooltipColor: (_) => T.ink,
                getTooltipItem: (group, _, rod, rodIndex) => BarTooltipItem(
                  '${rodIndex == 0 ? 'Grants' : 'Gifts'}: \$${rod.toY.toStringAsFixed(0)}',
                  const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 12),
                ),
              ),
            ),
            titlesData: FlTitlesData(
              topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              leftTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 44,
                  interval: maxY / 4,
                  getTitlesWidget: (v, meta) => SideTitleWidget(
                    meta: meta,
                    child: Text('\$${NumberFormat.compact(locale: 'en_US').format(v)}', style: const TextStyle(fontSize: 11, color: T.muted)),
                  ),
                ),
              ),
              bottomTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 24,
                  getTitlesWidget: (v, meta) {
                    final i = v.toInt();
                    if (i < 0 || i >= series.length || i % 2 == 1) return const SizedBox.shrink();
                    final date = DateTime.tryParse(series[i]['date'] as String? ?? '');
                    return SideTitleWidget(
                      meta: meta,
                      child: Text(date == null ? '' : DateFormat.Md('en_US').format(date), style: const TextStyle(fontSize: 10.5, color: T.muted)),
                    );
                  },
                ),
              ),
            ),
            barGroups: [
              for (var i = 0; i < series.length; i++)
                BarChartGroupData(x: i, barsSpace: 3, barRods: [
                  BarChartRodData(
                    toY: ((series[i]['grantsCents'] as num?) ?? 0) / 100,
                    color: T.teal,
                    width: 7,
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(3)),
                  ),
                  BarChartRodData(
                    toY: ((series[i]['donationsCents'] as num?) ?? 0) / 100,
                    color: T.sun,
                    width: 7,
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(3)),
                  ),
                ]),
            ],
          ),
        ),
      ),
    ]);
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});
  final Color color;
  final String label;
  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3))),
        const SizedBox(width: 6),
        Text(label, style: const TextStyle(fontSize: 12, color: T.muted, fontWeight: FontWeight.w600)),
      ]);
}

class _FundBalances extends StatelessWidget {
  const _FundBalances({required this.funds});
  final List<Fund> funds;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return SectionCard(
      title: 'Funds',
      subtitle: 'PayPal balance available for grants',
      child: Column(children: [
        for (final f in funds)
          InkWell(
            borderRadius: T.r12,
            onTap: () => context.go('/f/${f.slug}'),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: Row(children: [
                Container(width: 10, height: 36, decoration: BoxDecoration(color: T.parseHex(f.accentColor), borderRadius: T.r8)),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(f.name, style: t.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                    Text(
                      '${f.stats.inReviewCount} in review'
                      '${f.stats.awaitingCount > 0 ? ' · ${f.stats.awaitingCount} awaiting ${money(f.stats.awaitingCents, whole: true)}' : ''}'
                      '${f.autoApproveLimitCents > 0 ? ' · auto ≤ ${money(f.autoApproveLimitCents, whole: true)}' : ''}',
                      style: t.bodySmall,
                    ),
                  ]),
                ),
                Text(money(f.stats.availableCents), style: t.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
              ]),
            ),
          ),
      ]),
    );
  }
}

class _Pipeline extends StatelessWidget {
  const _Pipeline({required this.d});
  final DashboardData d;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final rows = [
      ('review', 'Waiting for a decision', d.count(['submitted', 'in_review']), T.info),
      ('review', 'Waiting on the applicant', d.count(['needs_info']), T.warn),
      ('funds', 'Approved, awaiting funds', d.count(['awaiting_funds']), T.warn),
      ('paying', 'Payout in flight', d.count(['approved', 'paying']), T.teal),
      ('problems', 'Needs attention', d.count(['payout_failed', 'unclaimed']), T.danger),
      ('paid', 'Paid', d.count(['paid']), T.teal),
    ];
    return SectionCard(
      title: 'Pipeline',
      child: Column(children: [
        for (final r in rows)
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            onTap: () => context.go('/console/cases?filter=${r.$1}'),
            leading: Container(width: 8, height: 8, decoration: BoxDecoration(color: r.$4, shape: BoxShape.circle)),
            title: Text(r.$2, style: t.bodyMedium),
            trailing: Text('${r.$3}', style: t.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
          ),
      ]),
    );
  }
}

class _Activity extends StatelessWidget {
  const _Activity({required this.items});
  final List<AuditItem> items;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final live = StaffEventsScope.of(context).connected;
    return SectionCard(
      title: 'Activity',
      trailing: Pill(live ? 'Live' : 'Offline', color: live ? T.teal : T.muted, icon: live ? Icons.wifi_tethering_rounded : Icons.wifi_off_rounded, dense: true),
      child: Column(children: [
        for (final a in items)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 7),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              ActorIcon(actorType: a.actorType),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(a.summary, style: t.bodyMedium),
                  Text('${a.actorName ?? titleCase(a.actorType)} · ${timeAgo(a.createdAt)}', style: t.bodySmall),
                ]),
              ),
            ]),
          ),
      ]),
    );
  }
}

class ActorIcon extends StatelessWidget {
  const ActorIcon({super.key, required this.actorType});
  final String actorType;

  @override
  Widget build(BuildContext context) {
    final (icon, color) = switch (actorType) {
      'ai' => (Icons.auto_awesome_rounded, T.info),
      'staff' => (Icons.person_rounded, T.tealDark),
      'paypal' => (Icons.account_balance_wallet_rounded, T.paypalLight),
      'applicant' => (Icons.chat_bubble_rounded, T.coral),
      'donor' => (Icons.favorite_rounded, T.coral),
      'agent' => (Icons.smart_toy_rounded, T.info),
      _ => (Icons.settings_rounded, T.muted),
    };
    return Container(
      width: 28,
      height: 28,
      decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: T.r8),
      child: Icon(icon, size: 15, color: color),
    );
  }
}
