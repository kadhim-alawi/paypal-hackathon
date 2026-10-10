import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/app_scope.dart';
import '../theme.dart';
import 'ui.dart';

class SiteHeader extends StatelessWidget implements PreferredSizeWidget {
  const SiteHeader({super.key, this.actions = const []});
  final List<Widget> actions;

  @override
  Size get preferredSize => Size.fromHeight(64 + ModeBanner.extent);

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width > 720;
    return Material(
      color: T.paper,
      child: SafeArea(
        bottom: false,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const ModeBanner(),
          SizedBox(
            height: 64,
            child: MaxWidth(
              child: Row(children: [
                InkWell(
                  onTap: () => context.go('/'),
                  borderRadius: T.r12,
                  child: const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: TideoverLogo(size: 30)),
                ),
                const Spacer(),
                ...actions,
                if (wide) ...[
                  TextButton(onPressed: () => context.go('/f/eastside'), child: const Text('Live fund')),
                  const SizedBox(width: 4),
                ],
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40), padding: const EdgeInsets.symmetric(horizontal: 14)),
                  onPressed: () => context.go('/console'),
                  icon: const Icon(Icons.dashboard_outlined, size: 18),
                  label: Text(wide ? 'Staff console' : 'Console'),
                ),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}

class SiteFooter extends StatelessWidget {
  const SiteFooter({super.key});

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final info = AppScope.of(context).info;
    return Container(
      color: T.ink,
      padding: const EdgeInsets.symmetric(vertical: 36),
      child: MaxWidth(
        child: Wrap(spacing: 40, runSpacing: 20, alignment: WrapAlignment.spaceBetween, children: [
          SizedBox(
            width: 360,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const TideoverLogo(size: 28, onDark: true),
              const SizedBox(height: 12),
              Text(
                'Open-source emergency cash for community funds. AI prepares, people decide, PayPal delivers.',
                style: t.bodyMedium?.copyWith(color: Colors.white70),
              ),
            ]),
          ),
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Built with', style: t.labelMedium?.copyWith(color: Colors.white54)),
            const SizedBox(height: 8),
            Text('PayPal Payouts · Orders v2 · Log in with PayPal\nWebhooks · Transaction Search · Agent Toolkit',
                style: t.bodySmall?.copyWith(color: Colors.white70, height: 1.6)),
            const SizedBox(height: 8),
            Text('Claude (${info.aiModel.isEmpty ? 'Anthropic' : info.aiModel}) · Flutter · MCP',
                style: t.bodySmall?.copyWith(color: Colors.white70)),
          ]),
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Need help right now?', style: t.labelMedium?.copyWith(color: Colors.white54)),
            const SizedBox(height: 8),
            Text('Call or text 988 (crisis) · 911 (emergency)\nDial 211 for local services',
                style: t.bodySmall?.copyWith(color: Colors.white70, height: 1.6)),
          ]),
        ]),
      ),
    );
  }
}
