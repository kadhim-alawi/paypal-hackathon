import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_scope.dart';
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

  Future<void> _start() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final services = AppScope.of(context);
    try {
      final locale = Localizations.maybeLocaleOf(context)?.languageCode;
      final res = await services.api.post('/api/funds/${widget.slug}/applications', body: {'language': locale}) as Map<String, dynamic>;
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
    final mine = AppScope.of(context).storage.myRequests();
    return Scaffold(
      appBar: const SiteHeader(),
      body: ListView(padding: const EdgeInsets.symmetric(vertical: 40), children: [
        MaxWidth(
          width: 620,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Let\'s get you help.', style: t.displaySmall),
            const SizedBox(height: 12),
            Text(
              'You\'ll chat with an assistant for a few minutes, in any language. It will ask what happened, how much you need, '
              'and for a photo of a bill if you have one. A volunteer from the fund reviews every request.',
              style: t.bodyLarge?.copyWith(color: T.inkSoft),
            ),
            const SizedBox(height: 22),
            SectionCard(
              color: T.tealSoft,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                _point(t, Icons.lock_outline_rounded, 'Private', 'Only the fund\'s reviewers see your details. Nothing is posted with your name.'),
                _point(t, Icons.translate_rounded, 'Any language', 'Write or speak in the language you\'re most comfortable with.'),
                _point(t, Icons.bolt_rounded, 'Fast', 'If approved, money is sent to your PayPal or Venmo, usually within the hour.'),
                _point(t, Icons.no_accounts_outlined, 'No account needed', 'We\'ll never ask for your Social Security number or bank details.'),
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
              label: const Text('Start my request'),
            ),
            if (mine.isNotEmpty) ...[
              const SizedBox(height: 28),
              Text('Your requests on this device', style: t.titleSmall),
              const SizedBox(height: 8),
              for (final id in mine.take(3))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.history_rounded),
                  title: Text('Open request ${id.substring(id.length - 6).toUpperCase()}'),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => context.go('/r/$id'),
                ),
            ],
            const SizedBox(height: 28),
            Text('In danger or thinking about harming yourself? Call or text 988, or 911 in an emergency.',
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
