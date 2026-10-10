import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../theme.dart';
import '../../widgets/site.dart';
import '../../widgets/ui.dart';

/// Shown after PayPal checkout. Follows the gift until the grant it funded lands.
class ThanksPage extends StatefulWidget {
  const ThanksPage({super.key, required this.slug, required this.donationId});
  final String slug;
  final String donationId;

  @override
  State<ThanksPage> createState() => _ThanksPageState();
}

class _ThanksPageState extends State<ThanksPage> {
  DonationStatus? _status;
  Timer? _timer;
  int _polls = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_timer == null) {
      _poll();
      _timer = Timer.periodic(const Duration(seconds: 2), (_) => _poll());
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _poll() async {
    try {
      final s = DonationStatus(await AppScope.of(context).api.get('/api/donations/${widget.donationId}') as Map<String, dynamic>);
      if (!mounted) return;
      setState(() => _status = s);
      _polls++;
      final settled = s.status == 'captured' && (!s.hasNeed || const ['paid', 'unclaimed', 'payout_failed'].contains(s.needStatus));
      if (settled || _polls > 90) _timer?.cancel();
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final s = _status;
    return Scaffold(
      appBar: const SiteHeader(),
      body: s == null
          ? const LoadingView()
          : ListView(padding: const EdgeInsets.symmetric(vertical: 40), children: [
              MaxWidth(
                width: 560,
                child: Column(children: [
                  Container(
                    width: 84,
                    height: 84,
                    decoration: BoxDecoration(color: T.parseHex(s.accentColor), shape: BoxShape.circle, boxShadow: T.shadow),
                    child: const Icon(Icons.favorite_rounded, color: Colors.white, size: 40),
                  ),
                  const SizedBox(height: 20),
                  Text('Thank you.', style: t.displaySmall, textAlign: TextAlign.center),
                  const SizedBox(height: 8),
                  Text('Your ${moneySmart(s.amountCents)} gift to ${s.fundName}.',
                      style: t.titleMedium?.copyWith(color: T.muted), textAlign: TextAlign.center),
                  const SizedBox(height: 28),
                  SectionCard(
                    child: Column(children: [
                      _step(t, done: s.status == 'captured', active: s.status != 'captured', title: 'Payment received by PayPal',
                          detail: s.status == 'captured' ? 'Captured and added to the fund\'s balance.' : 'Waiting for PayPal to confirm…'),
                      if (s.hasNeed) ...[
                        _step(t,
                            done: const ['paying', 'paid', 'unclaimed'].contains(s.needStatus),
                            active: s.status == 'captured' && s.needStatus == 'awaiting_funds',
                            title: 'Grant released',
                            detail: 'The approved ${s.needCategory?.toLowerCase() ?? 'grant'} of ${moneySmart(s.needAmountCents)} is sent with PayPal Payouts.'),
                        _step(t,
                            done: s.needStatus == 'paid',
                            active: s.needStatus == 'paying',
                            title: 'Delivered to your neighbor',
                            detail: s.needStatus == 'paid'
                                ? 'PayPal confirmed delivery ${clock(s.needPaidAt)}. You helped someone today.'
                                : 'Usually within a minute.'),
                      ] else
                        _step(t,
                            done: s.status == 'captured',
                            active: false,
                            title: 'Ready for the next approved request',
                            detail: 'You\'ll see it go out on the fund\'s live ledger.'),
                    ]),
                  ),
                  const SizedBox(height: 20),
                  FilledButton.icon(
                    onPressed: () => context.go('/f/${widget.slug}'),
                    icon: const Icon(Icons.receipt_long_outlined),
                    label: const Text('See the live ledger'),
                  ),
                ]),
              ),
            ]),
    );
  }

  Widget _step(TextTheme t, {required bool done, required bool active, required String title, required String detail}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(
            width: 28,
            height: 28,
            child: done
                ? const CircleAvatar(backgroundColor: T.teal, child: Icon(Icons.check_rounded, color: Colors.white, size: 18))
                : active
                    ? const Padding(padding: EdgeInsets.all(4), child: CircularProgressIndicator(strokeWidth: 2.4))
                    : const CircleAvatar(backgroundColor: T.paperDeep, child: Icon(Icons.more_horiz_rounded, color: T.muted, size: 18)),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: t.titleSmall?.copyWith(color: done || active ? T.ink : T.muted)),
              const SizedBox(height: 2),
              Text(detail, style: t.bodySmall),
            ]),
          ),
        ]),
      );
}
