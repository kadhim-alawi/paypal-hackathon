import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/sse.dart';
import '../../theme.dart';
import '../../widgets/ui.dart';
import 'console_common.dart';

class _MoneyData {
  _MoneyData(this.payouts, this.donations);
  final List<PayoutInfo> payouts;
  final List<DonationInfo> donations;
}

class MoneyPage extends StatefulWidget {
  const MoneyPage({super.key});

  @override
  State<MoneyPage> createState() => _MoneyPageState();
}

class _MoneyPageState extends State<MoneyPage> with LiveLoader<MoneyPage, _MoneyData> {
  int _tab = 0;

  @override
  bool reloadOn(SseEvent event) => event.type.startsWith('payout.') || event.type.startsWith('donation.');

  @override
  Future<_MoneyData> fetch(ApiClient api) async {
    final results = await Future.wait([api.get('/api/staff/payouts'), api.get('/api/staff/donations')]);
    return _MoneyData(
      (results[0] as List).cast<Map<String, dynamic>>().map(PayoutInfo.new).toList(),
      (results[1] as List).cast<Map<String, dynamic>>().map(DonationInfo.new).toList(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return buildLoaded(context, (d) {
      final sent = d.payouts.where((p) => p.status == 'success').fold<int>(0, (s, p) => s + p.amountCents);
      final fees = d.payouts.fold<int>(0, (s, p) => s + (p.feeCents ?? 0)) + d.donations.fold<int>(0, (s, x) => s + (x.feeCents ?? 0));
      final received = d.donations.where((x) => x.status == 'captured').fold<int>(0, (s, x) => s + x.amountCents);
      return ListView(padding: const EdgeInsets.all(20), children: [
        const ConsolePageHeader(
          title: 'Money',
          subtitle: 'Every PayPal payout and capture, reconciled against PayPal.',
        ),
        LayoutBuilder(builder: (context, c) {
          final cols = c.maxWidth > 800 ? 3 : 1;
          final tiles = [
            StatTile(label: 'Received (PayPal captures)', value: money(received, whole: true), icon: Icons.south_west_rounded),
            StatTile(label: 'Sent (PayPal Payouts)', value: money(sent, whole: true), icon: Icons.north_east_rounded),
            StatTile(label: 'PayPal fees', value: money(fees), icon: Icons.receipt_outlined, caption: 'processing + payouts'),
          ];
          return Wrap(spacing: 12, runSpacing: 12, children: [
            for (final x in tiles) SizedBox(width: (c.maxWidth - 12 * (cols - 1)) / cols, child: x),
          ]);
        }),
        const SizedBox(height: 16),
        SegmentedButton<int>(
          segments: [
            ButtonSegment(value: 0, label: Text('Payouts (${d.payouts.length})'), icon: const Icon(Icons.send_rounded)),
            ButtonSegment(value: 1, label: Text('Gifts (${d.donations.length})'), icon: const Icon(Icons.favorite_border_rounded)),
          ],
          selected: {_tab},
          onSelectionChanged: (s) => setState(() => _tab = s.first),
        ),
        const SizedBox(height: 12),
        if (_tab == 0)
          for (final p in d.payouts)
            _row(
              t,
              leading: StatusPill(p.status, dense: true),
              title: '${moneySmart(p.amountCents)} → ${switch (p.method) {
                'paypal_account' => 'PayPal account',
                'venmo_phone' => 'Venmo',
                _ => 'PayPal email',
              }}',
              subtitle: [
                if (p.publicRef != null) p.publicRef!,
                if (p.fundName != null) p.fundName!,
                if (p.paypalBatchId != null) 'batch ${p.paypalBatchId}',
                timeAgo(p.createdAt),
              ].join(' · '),
              trailing: p.completedAt != null && p.sentAt != null
                  ? 'settled in ${p.completedAt!.difference(p.sentAt!).inSeconds}s'
                  : (p.feeCents != null ? 'fee ${money(p.feeCents)}' : ''),
              onTap: () => context.go('/console/cases/${p.applicationId}'),
            )
        else
          for (final x in d.donations)
            _row(
              t,
              leading: StatusPill(x.status, dense: true),
              title: '${moneySmart(x.amountCents)} from ${x.donorName ?? 'Anonymous'}${x.anonymous ? ' (anonymous publicly)' : ''}',
              subtitle: [
                if (x.fundName != null) x.fundName!,
                if (x.source == 'agent') 'via AI agent ${x.agentName ?? ''}'.trim(),
                if (x.applicationId != null) 'earmarked for a need',
                if (x.paypalCaptureId != null) 'capture ${x.paypalCaptureId}',
                timeAgo(x.capturedAt ?? x.createdAt),
              ].join(' · '),
              trailing: x.feeCents != null ? 'fee ${money(x.feeCents)}' : '',
              icon: x.source == 'agent' ? Icons.smart_toy_outlined : null,
            ),
      ]);
    });
  }

  Widget _row(TextTheme t,
          {required Widget leading, required String title, required String subtitle, String trailing = '', VoidCallback? onTap, IconData? icon}) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Material(
          color: T.surface,
          shape: const RoundedRectangleBorder(borderRadius: T.r16, side: BorderSide(color: T.line)),
          child: InkWell(
            borderRadius: T.r16,
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(children: [
                SizedBox(width: 118, child: Align(alignment: Alignment.centerLeft, child: leading)),
                if (icon != null) ...[Icon(icon, size: 18, color: T.info), const SizedBox(width: 6)],
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(title, style: t.titleSmall),
                    Text(subtitle, style: t.bodySmall, maxLines: 2, overflow: TextOverflow.ellipsis),
                  ]),
                ),
                Text(trailing, style: t.bodySmall),
              ]),
            ),
          ),
        ),
      );
}
