import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../theme.dart';
import '../../widgets/ui.dart';
import 'request_controller.dart';

/// How the applicant wants to receive money. Log in with PayPal is the
/// recommended path: it verifies the account and lets small requests be
/// auto-approved.
class PayoutPicker extends StatefulWidget {
  const PayoutPicker({super.key, required this.controller});
  final RequestController controller;

  @override
  State<PayoutPicker> createState() => _PayoutPickerState();
}

class _PayoutPickerState extends State<PayoutPicker> {
  bool _editing = false;
  String _alt = 'paypal_email';
  final _value = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _value.dispose();
    super.dispose();
  }

  Future<void> _saveAlt() async {
    setState(() => _busy = true);
    try {
      await widget.controller.setPayout(_alt, _value.text.trim());
      setState(() => _editing = false);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _connect() async {
    setState(() => _busy = true);
    try {
      await widget.controller.connectPayPal();
    } catch (e) {
      if (mounted) showSnack(context, '$e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final v = widget.controller.view!;
    final tr = widget.controller.tr;
    final has = v.payoutMethod != null;
    if (has && !_editing) {
      return Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: T.paper, borderRadius: T.r16),
        child: Row(children: [
          Icon(v.payoutMethod == 'venmo_phone' ? Icons.phone_iphone_rounded : Icons.account_balance_wallet_rounded,
              color: v.payoutMethod == 'venmo_phone' ? T.venmo : T.paypalLight),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                switch (v.payoutMethod) {
                  'paypal_account' => v.paypalName != null ? 'PayPal · ${v.paypalName}' : tr('PayPal account', 'Cuenta de PayPal'),
                  'venmo_phone' => 'Venmo',
                  _ => tr('PayPal email', 'Correo de PayPal'),
                },
                style: t.titleSmall,
              ),
              Text(v.payoutDisplay ?? '', style: t.bodySmall),
              if (v.payoutMethod == 'paypal_account' && v.payoutVerified) ...[
                const SizedBox(height: 6),
                VerifiedBadge(label: tr('Verified with PayPal', 'Verificada con PayPal')),
              ],
            ]),
          ),
          if (v.canChangePayout) TextButton(onPressed: () => setState(() => _editing = true), child: Text(tr('Change', 'Cambiar'))),
        ]),
      );
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      FilledButton.icon(
        style: FilledButton.styleFrom(backgroundColor: T.paypalLight),
        onPressed: _busy ? null : _connect,
        icon: const Icon(Icons.account_balance_wallet_rounded),
        label: Text(tr('Connect PayPal', 'Conectar PayPal')),
      ),
      const SizedBox(height: 6),
      Text(tr('Fastest. Verifies your account so small requests can be approved right away.', 'Lo más rápido. Verifica su cuenta para que las solicitudes pequeñas se aprueben enseguida.'),
          style: t.bodySmall, textAlign: TextAlign.center),
      const SizedBox(height: 14),
      Row(children: [
        const Expanded(child: Divider()),
        Padding(padding: const EdgeInsets.symmetric(horizontal: 10), child: Text(tr('or send it to', 'o envíelo a'), style: t.bodySmall)),
        const Expanded(child: Divider()),
      ]),
      const SizedBox(height: 12),
      SegmentedButton<String>(
        segments: [
          ButtonSegment(value: 'paypal_email', label: Text(tr('PayPal email', 'Correo de PayPal')), icon: const Icon(Icons.alternate_email_rounded)),
          const ButtonSegment(value: 'venmo_phone', label: Text('Venmo'), icon: Icon(Icons.phone_iphone_rounded)),
        ],
        selected: {_alt},
        onSelectionChanged: (s) => setState(() {
          _alt = s.first;
          _value.clear();
        }),
      ),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(
          child: TextField(
            controller: _value,
            keyboardType: _alt == 'venmo_phone' ? TextInputType.phone : TextInputType.emailAddress,
            decoration: InputDecoration(
              hintText: _alt == 'venmo_phone'
                  ? tr('US mobile number on your Venmo', 'Su número de celular de EE. UU. en Venmo')
                  : tr('Email for your PayPal account', 'Correo de su cuenta de PayPal'),
            ),
          ),
        ),
        const SizedBox(width: 8),
        FilledButton.tonal(onPressed: _busy ? null : _saveAlt, child: Text(tr('Save', 'Guardar'))),
      ]),
      const SizedBox(height: 6),
      Text(
        _alt == 'venmo_phone'
            ? tr('Venmo sends a text if you don\'t have an account yet.', 'Venmo le envía un mensaje de texto si aún no tiene cuenta.')
            : tr('No PayPal account? PayPal emails you a link to claim it for free.', '¿No tiene PayPal? PayPal le envía un enlace por correo para reclamarlo gratis.'),
        style: t.bodySmall,
      ),
      if (has) TextButton(onPressed: () => setState(() => _editing = false), child: Text(tr('Cancel', 'Cancelar'))),
    ]);
  }
}

class ReviewSheet extends StatefulWidget {
  const ReviewSheet({super.key, required this.controller});
  final RequestController controller;

  static Future<void> show(BuildContext context, RequestController controller) => showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (_) => FractionallySizedBox(heightFactor: 0.92, child: ReviewSheet(controller: controller)),
      );

  @override
  State<ReviewSheet> createState() => _ReviewSheetState();
}

class _ReviewSheetState extends State<ReviewSheet> {
  late final RequestView _v = widget.controller.view!;
  late String? _category = _v.category;
  late final _amount = TextEditingController(
    text: _v.amountRequestedCents == null ? '' : (_v.amountRequestedCents! / 100).toStringAsFixed(_v.amountRequestedCents! % 100 == 0 ? 0 : 2),
  );
  final _email = TextEditingController();
  bool _consent = true;

  @override
  void dispose() {
    _amount.dispose();
    _email.dispose();
    super.dispose();
  }

  String? get _recap {
    final ready = widget.controller.messages.lastWhere((m) => m.ui == 'ready', orElse: () => ChatMessage(id: '', role: 'event', content: ''));
    final s = ready.meta['summary'];
    return s is String && s.isNotEmpty ? s : _v.needSummary;
  }

  Future<void> _submit() async {
    final amount = double.tryParse(_amount.text.replaceAll(',', '').replaceAll('\$', ''));
    try {
      await widget.controller.submit(
        consent: _consent,
        category: _category,
        amountCents: amount == null ? null : (amount * 100).round(),
        email: _email.text.trim().isEmpty ? null : _email.text.trim(),
      );
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return ListenableBuilder(
      listenable: widget.controller,
      builder: (context, _) {
        final v = widget.controller.view!;
        final tr = widget.controller.tr;
        final cat = v.categories.where((c) => c.key == _category).firstOrNull;
        return ListView(
          padding: EdgeInsets.fromLTRB(20, 0, 20, MediaQuery.viewInsetsOf(context).bottom + 24),
          children: [
            Text(tr('Review your request', 'Revise su solicitud'), style: t.headlineSmall),
            const SizedBox(height: 6),
            Text(
                tr('A volunteer from ${v.fundName} will review it. You can still add messages afterwards.',
                    'Una persona voluntaria de ${v.fundName} la revisará. Después puede seguir enviando mensajes.'),
                style: t.bodyMedium?.copyWith(color: T.muted)),
            const SizedBox(height: 18),
            if (_recap != null)
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: T.tealSoft, borderRadius: T.r16),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Icon(Icons.format_quote_rounded, color: T.tealDark),
                  const SizedBox(width: 8),
                  Expanded(child: Text(_recap!, style: t.bodyMedium)),
                ]),
              ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              initialValue: v.categories.any((c) => c.key == _category) ? _category : null,
              isExpanded: true,
              decoration: InputDecoration(labelText: tr('What is the money for?', '¿Para qué es el dinero?')),
              items: [
                for (final c in v.categories) DropdownMenuItem(value: c.key, child: Text(c.label, overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (k) => setState(() => _category = k),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(
                labelText: tr('How much do you need?', '¿Cuánto necesita?'),
                prefixText: '\$ ',
                helperText: cat == null
                    ? null
                    : tr('This fund gives up to ${money(cat.maxCents, whole: true)} for ${cat.label.toLowerCase()}.',
                        'Este fondo da hasta ${money(cat.maxCents, whole: true)} para esta categoría.'),
              ),
            ),
            const SizedBox(height: 20),
            Text(tr('Where should we send the money?', '¿Adónde enviamos el dinero?'), style: t.titleMedium),
            const SizedBox(height: 10),
            PayoutPicker(controller: widget.controller),
            const SizedBox(height: 18),
            TextField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: InputDecoration(labelText: tr('Email for updates (optional)', 'Correo para recibir novedades (opcional)')),
            ),
            const SizedBox(height: 8),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _consent,
              onChanged: (x) => setState(() => _consent = x),
              title: Text(tr('Share an anonymous one-line story', 'Compartir una frase anónima')),
              subtitle: Text(tr('Shown on the fund\'s page without your name. It helps donors give faster.',
                  'Se muestra en la página del fondo sin su nombre. Ayuda a que la gente done más rápido.')),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: v.payoutMethod == null || widget.controller.submitting ? null : _submit,
              child: widget.controller.submitting
                  ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                  : Text(tr('Submit request', 'Enviar solicitud')),
            ),
            if (v.payoutMethod == null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(tr('Choose how to receive the money to submit.', 'Elija cómo recibir el dinero para poder enviar.'),
                    style: t.bodySmall, textAlign: TextAlign.center),
              ),
          ],
        );
      },
    );
  }
}
