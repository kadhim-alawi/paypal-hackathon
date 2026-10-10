import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../theme.dart';
import '../../widgets/ui.dart';
import 'console_common.dart';
import 'dashboard_page.dart' show ActorIcon;

class AuditPage extends StatefulWidget {
  const AuditPage({super.key});

  @override
  State<AuditPage> createState() => _AuditPageState();
}

class _AuditPageState extends State<AuditPage> with LiveLoader<AuditPage, List<AuditItem>> {
  String _actor = 'all';

  @override
  Future<List<AuditItem>> fetch(ApiClient api) async =>
      (await api.get('/api/staff/audit', query: {'limit': '300'}) as List).cast<Map<String, dynamic>>().map(AuditItem.new).toList();

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return buildLoaded(context, (items) {
      final shown = _actor == 'all' ? items : items.where((a) => a.actorType == _actor).toList();
      return ListView(padding: const EdgeInsets.all(20), children: [
        const ConsolePageHeader(
          title: 'Audit log',
          subtitle: 'Append-only record of every AI output, human decision and PayPal money event.',
        ),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final a in const ['all', 'ai', 'staff', 'paypal', 'applicant', 'donor', 'agent', 'system'])
            ChoiceChip(label: Text(a == 'all' ? 'Everything' : titleCase(a)), selected: _actor == a, onSelected: (_) => setState(() => _actor = a)),
        ]),
        const SizedBox(height: 14),
        SectionCard(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Column(children: [
            if (shown.isEmpty) const EmptyState(icon: Icons.receipt_long_outlined, title: 'No events'),
            for (final a in shown)
              InkWell(
                onTap: a.entityType == 'application' ? () => context.go('/console/cases/${a.entityId}') : null,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    ActorIcon(actorType: a.actorType),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(a.summary, style: t.bodyMedium),
                        const SizedBox(height: 2),
                        Text('${a.actorName ?? titleCase(a.actorType)} · ${a.action} · ${a.createdAt == null ? '' : '${clock(a.createdAt)}, ${timeAgo(a.createdAt)}'}',
                            style: t.bodySmall),
                      ]),
                    ),
                    if (a.entityType == 'application') const Icon(Icons.chevron_right_rounded, color: T.faint),
                  ]),
                ),
              ),
          ]),
        ),
      ]);
    });
  }
}
