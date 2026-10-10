import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_scope.dart';
import '../../theme.dart';
import '../../widgets/ui.dart';
import 'console_common.dart';

class ConsoleShell extends StatefulWidget {
  const ConsoleShell({super.key, required this.location, required this.child});
  final String location;
  final Widget child;

  @override
  State<ConsoleShell> createState() => _ConsoleShellState();
}

class _Dest {
  const _Dest(this.path, this.label, this.icon, this.selectedIcon);
  final String path;
  final String label;
  final IconData icon;
  final IconData selectedIcon;
}

const _dests = [
  _Dest('/console', 'Overview', Icons.space_dashboard_outlined, Icons.space_dashboard_rounded),
  _Dest('/console/cases', 'Cases', Icons.inbox_outlined, Icons.inbox_rounded),
  _Dest('/console/money', 'Money', Icons.account_balance_wallet_outlined, Icons.account_balance_wallet_rounded),
  _Dest('/console/copilot', 'Copilot', Icons.auto_awesome_outlined, Icons.auto_awesome_rounded),
  _Dest('/console/funds', 'Funds', Icons.tune_outlined, Icons.tune_rounded),
  _Dest('/console/audit', 'Audit', Icons.receipt_long_outlined, Icons.receipt_long_rounded),
];

class _ConsoleShellState extends State<ConsoleShell> {
  StaffEvents? _events;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _events ??= StaffEvents(AppScope.of(context));
  }

  @override
  void dispose() {
    _events?.dispose();
    super.dispose();
  }

  int get _index {
    final loc = widget.location;
    for (var i = _dests.length - 1; i >= 0; i--) {
      if (i == 0 ? loc == '/console' : loc.startsWith(_dests[i].path)) return i;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    final user = services.session.user;
    final wide = MediaQuery.sizeOf(context).width >= 900;
    final body = StaffEventsScope(events: _events!, child: widget.child);

    final account = PopupMenuButton<String>(
      tooltip: 'Account',
      onSelected: (v) async {
        if (v == 'out') {
          await services.session.signOut();
          if (context.mounted) context.go('/console/login');
        } else if (v == 'site') {
          context.go('/');
        }
      },
      itemBuilder: (_) => [
        PopupMenuItem(enabled: false, child: Text('${user?.name ?? ''} · ${user?.role ?? ''}')),
        const PopupMenuItem(value: 'site', child: Text('Public site')),
        const PopupMenuItem(value: 'out', child: Text('Sign out')),
      ],
      child: CircleAvatar(
        backgroundColor: T.tealSoft,
        child: Text((user?.name ?? '?').substring(0, 1), style: const TextStyle(color: T.tealDark, fontWeight: FontWeight.w800)),
      ),
    );

    if (wide) {
      return Scaffold(
        body: Column(children: [
          const ModeBanner(),
          Expanded(
            child: Row(children: [
              NavigationRail(
                selectedIndex: _index,
                labelType: NavigationRailLabelType.all,
                leading: Padding(
                  padding: const EdgeInsets.only(top: 12, bottom: 20),
                  child: InkWell(onTap: () => context.go('/'), child: const TideoverLogo(size: 34, wordmark: false)),
                ),
                trailing: Expanded(
                  child: Align(
                    alignment: Alignment.bottomCenter,
                    child: Padding(padding: const EdgeInsets.only(bottom: 20), child: account),
                  ),
                ),
                destinations: [
                  for (final d in _dests)
                    NavigationRailDestination(icon: Icon(d.icon), selectedIcon: Icon(d.selectedIcon), label: Text(d.label)),
                ],
                onDestinationSelected: (i) => context.go(_dests[i].path),
              ),
              const VerticalDivider(width: 1),
              Expanded(child: body),
            ]),
          ),
        ]),
      );
    }
    return Scaffold(
      appBar: AppBar(
        title: const TideoverLogo(size: 26),
        actions: [Padding(padding: const EdgeInsets.only(right: 12), child: account)],
      ),
      body: Column(children: [
        const ModeBanner(),
        Expanded(child: body),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index.clamp(0, 4),
        destinations: [
          for (final d in _dests.take(5)) NavigationDestination(icon: Icon(d.icon), selectedIcon: Icon(d.selectedIcon), label: d.label),
        ],
        onDestinationSelected: (i) => context.go(_dests[i].path),
      ),
    );
  }
}
