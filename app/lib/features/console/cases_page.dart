import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/sse.dart';
import '../../theme.dart';
import '../../widgets/ui.dart';
import 'console_common.dart';

const caseFilters = <String, (String, List<String>)>{
  'review': ('Needs decision', ['submitted', 'in_review', 'needs_info']),
  'funds': ('Awaiting funds', ['awaiting_funds']),
  'paying': ('Sending', ['approved', 'paying']),
  'problems': ('Attention', ['payout_failed', 'unclaimed']),
  'paid': ('Paid', ['paid']),
  'closed': ('Declined', ['denied', 'withdrawn']),
  'all': ('All', []),
};

class CasesPage extends StatefulWidget {
  const CasesPage({super.key, required this.filter});
  final String filter;

  @override
  State<CasesPage> createState() => _CasesPageState();
}

class _CasesPageState extends State<CasesPage> with LiveLoader<CasesPage, List<CaseSummary>> {
  final _q = TextEditingController();

  @override
  void didUpdateWidget(covariant CasesPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.filter != widget.filter) load();
  }

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  @override
  bool reloadOn(SseEvent event) => event.type.startsWith('case.') || event.type.startsWith('payout.');

  @override
  Future<List<CaseSummary>> fetch(ApiClient api) async {
    final statuses = (caseFilters[widget.filter] ?? caseFilters['review']!).$2;
    final res = await api.get('/api/staff/cases', query: {
      if (statuses.isNotEmpty) 'status': statuses.join(','),
      if (_q.text.trim().isNotEmpty) 'q': _q.text.trim(),
    }) as List;
    return res.cast<Map<String, dynamic>>().map(CaseSummary.new).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          ConsolePageHeader(
            title: 'Cases',
            subtitle: 'Every request arrives with an AI-prepared case file. You make the call.',
            actions: [
              SizedBox(
                width: 240,
                child: TextField(
                  controller: _q,
                  onSubmitted: (_) => load(),
                  decoration: InputDecoration(
                    isDense: true,
                    hintText: 'Search ref or need',
                    prefixIcon: const Icon(Icons.search_rounded, size: 20),
                    suffixIcon: _q.text.isEmpty
                        ? null
                        : IconButton(icon: const Icon(Icons.close_rounded, size: 18), onPressed: () {
                            _q.clear();
                            load();
                          }),
                  ),
                ),
              ),
            ],
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              for (final e in caseFilters.entries)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(e.value.$1),
                    selected: widget.filter == e.key,
                    onSelected: (_) => context.go('/console/cases?filter=${e.key}'),
                  ),
                ),
            ]),
          ),
          const SizedBox(height: 12),
        ]),
      ),
      Expanded(
        child: buildLoaded(context, (cases) {
          if (cases.isEmpty) {
            return const EmptyState(icon: Icons.inbox_outlined, title: 'Nothing here', message: 'New requests appear instantly.');
          }
          return RefreshIndicator(
            onRefresh: load,
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
              itemCount: cases.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (_, i) => CaseRow(c: cases[i]),
            ),
          );
        }),
      ),
    ]);
  }
}

class CaseRow extends StatelessWidget {
  const CaseRow({super.key, required this.c});
  final CaseSummary c;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final amount = c.amountApprovedCents ?? c.amountRecommendedCents ?? c.amountRequestedCents;
    return Material(
      color: T.surface,
      shape: const RoundedRectangleBorder(borderRadius: T.r16, side: BorderSide(color: T.line)),
      child: InkWell(
        borderRadius: T.r16,
        onTap: () => context.go('/console/cases/${c.id}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              StatusPill(c.status, dense: true),
              const SizedBox(width: 8),
              Text(c.publicRef, style: t.labelMedium?.copyWith(color: T.muted)),
              const Spacer(),
              Text(timeAgo(c.submittedAt ?? c.createdAt), style: t.bodySmall),
            ]),
            const SizedBox(height: 10),
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(
                    [c.categoryLabel ?? 'Uncategorized', if (c.firstName != null) c.firstName!].join(' · '),
                    style: t.titleMedium,
                  ),
                  if (c.needSummary != null) ...[
                    const SizedBox(height: 4),
                    Text(c.needSummary!, maxLines: 2, overflow: TextOverflow.ellipsis, style: t.bodyMedium?.copyWith(color: T.inkSoft)),
                  ],
                ]),
              ),
              const SizedBox(width: 12),
              Text(moneySmart(amount), style: t.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
            ]),
            const SizedBox(height: 12),
            Wrap(spacing: 6, runSpacing: 6, children: [
              if (c.aiStatus == 'working')
                const Pill('AI reviewing…', color: T.info, icon: Icons.auto_awesome_rounded, dense: true)
              else
                AiRecommendationChip(recommendation: c.aiRecommendation, confidence: c.aiConfidence, dense: true),
              RiskChip(level: c.riskLevel, count: c.riskCount, dense: true),
              if (c.payoutVerified) const VerifiedBadge(label: 'PayPal verified'),
              if (c.language != 'en') Pill(languageName(c.language), color: T.muted, icon: Icons.translate_rounded, dense: true),
              if (c.urgency == 'today') const Pill('Due today', color: T.coral, icon: Icons.priority_high_rounded, dense: true),
              if (c.minutesToCash != null) Pill('Paid in ${minutesLabel(c.minutesToCash)}', color: T.teal, icon: Icons.timer_outlined, dense: true),
            ]),
          ]),
        ),
      ),
    );
  }
}
