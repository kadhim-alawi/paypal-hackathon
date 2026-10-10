import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/links.dart';
import '../../core/models.dart';
import '../../theme.dart';
import '../../widgets/ui.dart';

/// Amount picker that hands off to PayPal checkout (PayPal, Venmo, Pay Later, cards).
class GiveSheet extends StatefulWidget {
  const GiveSheet({super.key, required this.fund, this.need});
  final Fund fund;
  final Need? need;

  @override
  State<GiveSheet> createState() => _GiveSheetState();
}

class _GiveSheetState extends State<GiveSheet> {
  static const presets = [1000, 2500, 5000, 10000, 25000];
  late int _amount = widget.need?.amountCents ?? 5000;
  bool _coverFees = true;
  bool _anonymous = false;
  bool _busy = false;
  final _name = TextEditingController();
  final _note = TextEditingController();
  final _custom = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    _note.dispose();
    _custom.dispose();
    super.dispose();
  }

  /// Gross-up so PayPal's charity checkout fee (1.99% + $0.49) and the payout
  /// fee (2%, max $20) don't shrink the grant.
  int get _feeTopUp {
    final payoutFee = (_amount * 0.02).round().clamp(25, 2000);
    final gross = ((_amount + payoutFee + 49) / (1 - 0.0199)).ceil();
    return gross - _amount;
  }

  int get _total => _amount + (_coverFees ? _feeTopUp : 0);

  Future<void> _continue() async {
    setState(() => _busy = true);
    try {
      final res = await AppScope.of(context).api.post('/api/funds/${widget.fund.slug}/donations', body: {
        'amountCents': _total,
        'applicationId': widget.need?.id,
        'donorName': _name.text.trim().isEmpty ? null : _name.text.trim(),
        'donorMessage': _note.text.trim().isEmpty ? null : _note.text.trim(),
        'anonymous': _anonymous,
      }) as Map<String, dynamic>;
      await openUrl(res['checkoutUrl'] as String);
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final need = widget.need;
    return Padding(
      padding: EdgeInsets.only(left: 20, right: 20, bottom: MediaQuery.viewInsetsOf(context).bottom + 20),
      child: SingleChildScrollView(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
          Text(need == null ? 'Give to ${widget.fund.name}' : 'Fund this ${need.categoryLabel.toLowerCase()} grant', style: t.headlineSmall),
          const SizedBox(height: 6),
          Text(
            need == null
                ? 'Your gift goes into the fund\'s PayPal balance and is paid out to the next approved neighbor.'
                : 'A volunteer already approved this request. When your payment completes, ${moneySmart(need.amountCents)} goes straight to the recipient.',
            style: t.bodyMedium?.copyWith(color: T.muted),
          ),
          const SizedBox(height: 18),
          if (need == null) ...[
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final p in presets)
                ChoiceChip(
                  label: Text(money(p, whole: true)),
                  selected: _amount == p && _custom.text.isEmpty,
                  onSelected: (_) => setState(() {
                    _custom.clear();
                    _amount = p;
                  }),
                ),
            ]),
            const SizedBox(height: 12),
            TextField(
              controller: _custom,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(prefixText: '\$ ', labelText: 'Other amount'),
              onChanged: (v) {
                final d = double.tryParse(v);
                if (d != null && d >= 1) setState(() => _amount = (d * 100).round());
              },
            ),
          ] else
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: T.tealSoft, borderRadius: T.r16),
              child: Row(children: [
                const Icon(Icons.verified_rounded, color: T.tealDark),
                const SizedBox(width: 10),
                Expanded(child: Text(need.story ?? need.categoryLabel, style: t.bodyMedium)),
                Text(moneySmart(need.amountCents), style: t.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
              ]),
            ),
          const SizedBox(height: 8),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _coverFees,
            onChanged: (v) => setState(() => _coverFees = v),
            title: Text('Add ${money(_feeTopUp)} to cover fees', style: t.titleSmall),
            subtitle: const Text('So PayPal processing and payout fees don\'t reduce the grant.'),
          ),
          const SizedBox(height: 6),
          TextField(controller: _name, decoration: const InputDecoration(labelText: 'Your name (optional)')),
          const SizedBox(height: 10),
          TextField(controller: _note, decoration: const InputDecoration(labelText: 'A note of encouragement (optional)')),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _anonymous,
            onChanged: (v) => setState(() => _anonymous = v ?? false),
            title: const Text('Keep my name off the public ledger'),
          ),
          const SizedBox(height: 8),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFFFFC439), foregroundColor: T.ink),
            onPressed: _busy ? null : _continue,
            child: _busy
                ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4))
                : Text('Continue to PayPal · ${money(_total)}'),
          ),
          const SizedBox(height: 10),
          Text('Pay with PayPal, Venmo, Pay Later or card. Tideover never sees your payment details.',
              textAlign: TextAlign.center, style: t.bodySmall),
        ]),
      ),
    );
  }
}
