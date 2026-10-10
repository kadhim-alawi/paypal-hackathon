import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_scope.dart';
import '../../core/l10n.dart';
import '../../theme.dart';
import '../../widgets/site.dart';
import '../../widgets/ui.dart';

/// Creates a private request and moves the person into the conversation.
class ApplyStartPage extends StatefulWidget {
  const ApplyStartPage({super.key, required this.slug});
  final String slug;

  @override
  State<ApplyStartPage> createState() => _ApplyStartPageState();
}

class _ApplyStartPageState extends State<ApplyStartPage> {
  bool _busy = false;
  String? _error;
  String _lang = Tr.deviceLanguage();

  Future<void> _start() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final services = AppScope.of(context);
    try {
      final res = await services.api.post('/api/funds/${widget.slug}/applications', body: {'language': _lang}) as Map<String, dynamic>;
      final id = res['id'] as String;
      await services.storage.saveApplicantToken(id, res['token'] as String);
      if (mounted) context.go('/r/$id');
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final tr = Tr(_lang);
    final mine = AppScope.of(context).storage.myRequests();
    return Scaffold(
      appBar: const SiteHeader(),
      body: ListView(padding: const EdgeInsets.symmetric(vertical: 40), children: [
        MaxWidth(
          width: 620,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Align(
              alignment: Alignment.centerRight,
              child: SegmentedButton<String>(
                showSelectedIcon: false,
                style: const ButtonStyle(visualDensity: VisualDensity.compact),
                segments: const [
                  ButtonSegment(value: 'en', label: Text('English')),
                  ButtonSegment(value: 'es', label: Text('Español')),
                ],
                selected: {_lang},
                onSelectionChanged: (v) => setState(() => _lang = v.first),
              ),
            ),
            const SizedBox(height: 16),
            Text(tr('Let\'s get you help.', 'Vamos a ayudarle.'), style: t.displaySmall),
            const SizedBox(height: 12),
            Text(
              tr(
                'You\'ll chat with an assistant for a few minutes, in any language. It will ask what happened, how much you need, '
                    'and for a photo of a bill if you have one. A volunteer from the fund reviews every request.',
                'Va a conversar unos minutos con un asistente, en cualquier idioma. Le preguntará qué pasó, cuánto necesita '
                    'y, si la tiene, una foto de la factura. Una persona voluntaria del fondo revisa cada solicitud.',
              ),
              style: t.bodyLarge?.copyWith(color: T.inkSoft),
            ),
            const SizedBox(height: 22),
            SectionCard(
              color: T.tealSoft,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                _point(t, Icons.lock_outline_rounded, tr('Private', 'Privado'),
                    tr('Only the fund\'s reviewers see your details. Nothing is posted with your name.', 'Solo quienes revisan en el fondo ven sus datos. Nada se publica con su nombre.')),
                _point(t, Icons.translate_rounded, tr('Any language', 'Cualquier idioma'),
                    tr('Write or speak in the language you\'re most comfortable with.', 'Escriba o hable en el idioma en que se sienta más cómodo.')),
                _point(t, Icons.bolt_rounded, tr('Fast', 'Rápido'),
                    tr('If approved, money is sent to your PayPal or Venmo, usually within the hour.', 'Si se aprueba, el dinero se envía a su PayPal o Venmo, normalmente en menos de una hora.')),
                _point(t, Icons.no_accounts_outlined, tr('No account needed', 'Sin crear cuenta'),
                    tr('We\'ll never ask for your Social Security number or bank details.', 'Nunca le pediremos su número de Seguro Social ni datos bancarios.')),
              ]),
            ),
            const SizedBox(height: 22),
            if (_error != null) ...[
              Text(_error!, style: t.bodyMedium?.copyWith(color: T.danger)),
              const SizedBox(height: 12),
            ],
            FilledButton.icon(
              onPressed: _busy ? null : _start,
              icon: _busy
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white))
                  : const Icon(Icons.chat_bubble_outline_rounded),
              label: Text(tr('Start my request', 'Comenzar mi solicitud')),
            ),
            if (mine.isNotEmpty) ...[
              const SizedBox(height: 28),
              Text(tr('Your requests on this device', 'Sus solicitudes en este dispositivo'), style: t.titleSmall),
              const SizedBox(height: 8),
              for (final id in mine.take(3))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.history_rounded),
                  title: Text('${tr('Open request', 'Abrir solicitud')} ${id.substring(id.length - 6).toUpperCase()}'),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => context.go('/r/$id'),
                ),
            ],
            const SizedBox(height: 28),
            Text(
                tr('In danger or thinking about harming yourself? Call or text 988, or 911 in an emergency.',
                    '¿Está en peligro o piensa en hacerse daño? Llame o envíe un mensaje al 988, o llame al 911 en una emergencia.'),
                style: t.bodySmall),
          ]),
        ),
      ]),
    );
  }

  Widget _point(TextTheme t, IconData icon, String title, String text) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, color: T.tealDark, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Text.rich(TextSpan(children: [
              TextSpan(text: '$title. ', style: const TextStyle(fontWeight: FontWeight.w700)),
              TextSpan(text: text),
            ]), style: t.bodyMedium),
          ),
        ]),
      );
}
