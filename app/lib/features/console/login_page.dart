import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_scope.dart';
import '../../theme.dart';
import '../../widgets/ui.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, this.next});
  final String? next;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AppScope.of(context).session.signIn(_email.text.trim(), _password.text);
      if (mounted) context.go(widget.next ?? '/console');
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _demo(String email, String password) {
    _email.text = email;
    _password.text = password;
    _signIn();
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Center(child: InkWell(onTap: () => context.go('/'), child: const TideoverLogo(size: 40))),
              const SizedBox(height: 28),
              SectionCard(
                padding: const EdgeInsets.all(24),
                child: AutofillGroup(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Text('Staff console', style: t.headlineSmall),
                    const SizedBox(height: 4),
                    Text('Review requests, send grants, follow the money.', style: t.bodyMedium?.copyWith(color: T.muted)),
                    const SizedBox(height: 20),
                    TextField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      decoration: const InputDecoration(labelText: 'Email'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _password,
                      obscureText: true,
                      autofillHints: const [AutofillHints.password],
                      onSubmitted: (_) => _signIn(),
                      decoration: const InputDecoration(labelText: 'Password'),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      Text(_error!, style: t.bodyMedium?.copyWith(color: T.danger)),
                    ],
                    const SizedBox(height: 18),
                    FilledButton(
                      onPressed: _busy ? null : _signIn,
                      child: _busy
                          ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                          : const Text('Sign in'),
                    ),
                  ]),
                ),
              ),
              if (AppScope.of(context).info.demoLogins) ...[
                const SizedBox(height: 16),
                SectionCard(
                  color: T.sunSoft,
                  title: 'Judging or exploring?',
                  subtitle: 'This demo has two staff accounts so you can try the two-person rule.',
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    OutlinedButton.icon(
                      onPressed: _busy ? null : () => _demo('reviewer@tideover.app', 'tideover-review'),
                      icon: const Icon(Icons.person_outline_rounded),
                      label: const Text('Sign in as Sam (reviewer)'),
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: _busy ? null : () => _demo('admin@tideover.app', 'tideover-admin'),
                      icon: const Icon(Icons.admin_panel_settings_outlined),
                      label: const Text('Sign in as Avery (admin)'),
                    ),
                  ]),
                ),
              ],
            ]),
          ),
        ),
      ),
    );
  }
}
