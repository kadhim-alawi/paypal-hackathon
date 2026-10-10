import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/sse.dart';
import '../../theme.dart';
import '../../widgets/ui.dart';
import 'console_common.dart';
import 'dashboard_page.dart' show ActorIcon;

class CasePage extends StatefulWidget {
  const CasePage({super.key, required this.id});
  final String id;

  @override
  State<CasePage> createState() => _CasePageState();
}

class _CasePageState extends State<CasePage> with LiveLoader<CasePage, CaseDetail> {
  @override
  bool reloadOn(SseEvent event) {
    final d = event.data;
    return d['id'] == widget.id || d['applicationId'] == widget.id;
  }

  @override
  Future<CaseDetail> fetch(ApiClient api) async => CaseDetail(await api.get('/api/staff/cases/${widget.id}') as Map<String, dynamic>);

  @override
  Widget build(BuildContext context) {
    return buildLoaded(context, (c) {
      return LayoutBuilder(builder: (context, box) {
        final wide = box.maxWidth > 1000;
        final main = [
          _AiCaseFile(c: c),
          const SizedBox(height: 16),
          _RiskChecks(c: c),
          const SizedBox(height: 16),
          _Documents(c: c),
          const SizedBox(height: 16),
          _Transcript(c: c),
        ];
        final side = [
          if (c.decidable) ...[_DecisionPanel(c: c, onDone: load), const SizedBox(height: 16)],
          _PayoutPanel(c: c, onChanged: load),
          const SizedBox(height: 16),
          _ApplicantPanel(c: c),
          const SizedBox(height: 16),
          _Timeline(c: c),
        ];
        return RefreshIndicator(
          onRefresh: load,
          child: ListView(padding: const EdgeInsets.all(20), children: [
            _Header(c: c, onReassess: load),
            const SizedBox(height: 16),
            if (wide)
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(flex: 3, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: main)),
                const SizedBox(width: 16),
                Expanded(flex: 2, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: side)),
              ])
            else
              Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [...side.take(2), ...main, ...side.skip(2)]),
          ]),
        );
      });
    });
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.c, required this.onReassess});
  final CaseDetail c;
  final VoidCallback onReassess;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      IconButton(onPressed: () => context.go('/console/cases'), icon: const Icon(Icons.arrow_back_rounded)),
      const SizedBox(width: 4),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Text(c.publicRef, style: t.headlineMedium),
            StatusPill(c.status),
            if (c.language != 'en') Pill('Applicant writes in ${languageName(c.language)}', color: T.muted, icon: Icons.translate_rounded, dense: true),
          ]),
          const SizedBox(height: 4),
          Text(
            '${c.fundName} · ${c.categoryLabel ?? 'Uncategorized'} · requested ${moneySmart(c.amountRequestedCents)} · submitted ${timeAgo(c.submittedAt)}',
            style: t.bodyMedium?.copyWith(color: T.muted),
          ),
        ]),
      ),
      if (c.decidable)
        TextButton.icon(
          onPressed: () async {
            try {
              await AppScope.of(context).api.post('/api/staff/cases/${c.id}/reassess');
              if (context.mounted) showSnack(context, 'AI caseworker is re-reading the case…');
              onReassess();
            } on ApiException catch (e) {
              if (context.mounted) showSnack(context, e.message, error: true);
            }
          },
          icon: const Icon(Icons.refresh_rounded, size: 18),
          label: const Text('Re-run AI'),
        ),
    ]);
  }
}

class _AiCaseFile extends StatelessWidget {
  const _AiCaseFile({required this.c});
  final CaseDetail c;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final a = c.assessment;
    if (c.aiStatus == 'working') {
      return const SectionCard(title: 'AI case file', child: LoadingView(label: 'The AI caseworker is reading the request and documents…'));
    }
    if (a == null) {
      return const SectionCard(
        title: 'AI case file',
        child: Text('No AI assessment yet. The request will be reviewed by a person.'),
      );
    }
    return SectionCard(
      title: 'AI case file',
      subtitle: 'Prepared by ${a.model} ${timeAgo(a.createdAt)}. A recommendation, not a decision.',
      trailing: AiRecommendationChip(recommendation: a.recommendation, confidence: a.confidence),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(a.summary, style: t.bodyLarge),
        const SizedBox(height: 14),
        Row(children: [
          _metric(t, 'Recommended', a.recommendation == 'approve' ? moneySmart(a.recommendedAmountCents) : '—'),
          const SizedBox(width: 24),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Confidence', style: t.labelMedium?.copyWith(color: T.muted)),
              const SizedBox(height: 6),
              ClipRRect(
                borderRadius: T.r8,
                child: LinearProgressIndicator(
                  value: a.confidence,
                  minHeight: 8,
                  backgroundColor: T.paperDeep,
                  color: a.confidence >= 0.8 ? T.teal : (a.confidence >= 0.6 ? T.sun : T.coral),
                ),
              ),
            ]),
          ),
          const SizedBox(width: 12),
          Text('${(a.confidence * 100).round()}%', style: t.titleMedium),
        ]),
        if (a.reviewerNote.isNotEmpty) ...[
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: T.infoSoft, borderRadius: T.r12),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Icon(Icons.tips_and_updates_outlined, color: T.info, size: 18),
              const SizedBox(width: 8),
              Expanded(child: Text(a.reviewerNote, style: t.bodyMedium?.copyWith(color: T.inkSoft))),
            ]),
          ),
        ],
        const SizedBox(height: 16),
        Text('Fund policy check', style: t.titleSmall),
        const SizedBox(height: 6),
        for (final v in a.criteria) _CriterionRow(v: v, kind: c.criteria.where((x) => x.id == v.id).firstOrNull?.kind ?? 'required'),
        if (a.documentFindings.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text('From the documents', style: t.titleSmall),
          const SizedBox(height: 6),
          for (final f in a.documentFindings) _bullet(t, f),
        ],
        if (a.questionsForApplicant.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text('Questions the AI would ask', style: t.titleSmall),
          const SizedBox(height: 6),
          for (final q in a.questionsForApplicant) _bullet(t, q),
        ],
      ]),
    );
  }

  Widget _metric(TextTheme t, String label, String value) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: t.labelMedium?.copyWith(color: T.muted)),
        Text(value, style: t.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
      ]);

  Widget _bullet(TextTheme t, String s) => Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Padding(padding: EdgeInsets.only(top: 7), child: Icon(Icons.circle, size: 5, color: T.muted)),
          const SizedBox(width: 8),
          Expanded(child: Text(s, style: t.bodyMedium)),
        ]),
      );
}

class _CriterionRow extends StatelessWidget {
  const _CriterionRow({required this.v, required this.kind});
  final CriterionVerdict v;
  final String kind;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final disq = kind == 'disqualifying';
    // For a disqualifying criterion, "not met" is the good outcome.
    final good = disq ? v.verdict == 'not_met' : v.verdict == 'met';
    final bad = disq ? v.verdict == 'met' : v.verdict == 'not_met';
    final (icon, color) = good
        ? (Icons.check_circle_rounded, T.teal)
        : bad
            ? (kind == 'preferred' ? (Icons.remove_circle_outline_rounded, T.warn) : (Icons.cancel_rounded, T.danger))
            : (Icons.help_rounded, T.warn);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, color: color, size: 20),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text.rich(TextSpan(children: [
              TextSpan(text: disq ? 'Rule-out: ' : (kind == 'preferred' ? 'Preferred: ' : ''), style: const TextStyle(color: T.muted)),
              TextSpan(text: v.text),
            ]), style: t.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
            Text(v.evidence, style: t.bodySmall?.copyWith(color: T.inkSoft)),
          ]),
        ),
      ]),
    );
  }
}

class _RiskChecks extends StatelessWidget {
  const _RiskChecks({required this.c});
  final CaseDetail c;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final serious = c.riskFlags.where((f) => f.severity != 'info').toList();
    final info = c.riskFlags.where((f) => f.severity == 'info').toList();
    return SectionCard(
      title: 'Automated checks',
      subtitle: 'Deterministic rules: duplicates, reused documents, velocity, caps, identity. The AI can\'t override them.',
      trailing: RiskChip(level: c.riskLevel, count: c.riskCount),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (serious.isEmpty)
          Row(children: [
            const Icon(Icons.verified_user_rounded, color: T.teal),
            const SizedBox(width: 10),
            Expanded(child: Text('No duplicate requests, reused documents, velocity spikes or cap problems found.', style: t.bodyMedium)),
          ]),
        for (final f in [...serious, ...info])
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(
                f.severity == 'block' ? Icons.gpp_bad_rounded : (f.severity == 'warn' ? Icons.flag_rounded : Icons.info_outline_rounded),
                size: 20,
                color: f.severity == 'block' ? T.danger : (f.severity == 'warn' ? T.warn : T.muted),
              ),
              const SizedBox(width: 10),
              Expanded(child: Text(f.message, style: t.bodyMedium)),
            ]),
          ),
        if (c.assessment?.riskNotes.isNotEmpty == true) ...[
          const Divider(height: 24),
          Text('AI\'s read on the risks', style: t.titleSmall),
          const SizedBox(height: 6),
          for (final n in c.assessment!.riskNotes)
            Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('• $n', style: t.bodyMedium?.copyWith(color: T.inkSoft))),
        ],
      ]),
    );
  }
}

class _Documents extends StatelessWidget {
  const _Documents({required this.c});
  final CaseDetail c;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final services = AppScope.of(context);
    String url(String id) => services.api.uri('/api/staff/documents/$id/file', {'token': services.session.token ?? ''}).toString();
    return SectionCard(
      title: 'Documents',
      subtitle: c.documents.isEmpty ? 'The applicant didn\'t upload any.' : 'Read by AI; tap to inspect the original.',
      child: Column(children: [
        for (final d in c.documents)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              InkWell(
                onTap: d.isImage
                    ? () => showDialog<void>(
                          context: context,
                          builder: (_) => Dialog(
                            insetPadding: const EdgeInsets.all(16),
                            child: Stack(children: [
                              InteractiveViewer(maxScale: 5, child: Image.network(url(d.id))),
                              Positioned(
                                right: 8,
                                top: 8,
                                child: IconButton.filled(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close)),
                              ),
                            ]),
                          ),
                        )
                    : null,
                child: ClipRRect(
                  borderRadius: T.r12,
                  child: d.isImage
                      ? Image.network(url(d.id), width: 96, height: 120, fit: BoxFit.cover)
                      : Container(width: 96, height: 120, color: T.paperDeep, child: const Icon(Icons.picture_as_pdf_outlined, size: 36)),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(child: _Extraction(doc: d, t: t)),
            ]),
          ),
      ]),
    );
  }
}

class _Extraction extends StatelessWidget {
  const _Extraction({required this.doc, required this.t});
  final StaffDoc doc;
  final TextTheme t;

  @override
  Widget build(BuildContext context) {
    final x = doc.extraction;
    if (x == null) {
      return Text(doc.status == 'processing' ? 'Reading…' : 'Couldn\'t be analysed automatically: ${doc.filename}', style: t.bodyMedium);
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(child: Text(x.title, style: t.titleSmall)),
        if (x.amountCents != null) Pill(moneySmart(x.amountCents), color: T.tealDark, dense: true),
      ]),
      const SizedBox(height: 4),
      Text(x.summary, style: t.bodyMedium?.copyWith(color: T.inkSoft)),
      const SizedBox(height: 6),
      Wrap(spacing: 6, runSpacing: 4, children: [
        if (x.issuer != null) Pill(x.issuer!, color: T.muted, icon: Icons.business_rounded, dense: true),
        if (x.dueDate != null) Pill('Due ${x.dueDate}', color: T.coral, icon: Icons.event_rounded, dense: true),
        if (!x.legible) const Pill('Hard to read', color: T.warn, icon: Icons.blur_on_rounded, dense: true),
      ]),
      for (final n in x.consistencyNotes) Padding(padding: const EdgeInsets.only(top: 4), child: Text('✓ $n', style: t.bodySmall?.copyWith(color: T.tealDark))),
      for (final r in x.redFlags) Padding(padding: const EdgeInsets.only(top: 4), child: Text('⚑ $r', style: t.bodySmall?.copyWith(color: T.danger))),
    ]);
  }
}

class _Transcript extends StatelessWidget {
  const _Transcript({required this.c});
  final CaseDetail c;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final msgs = c.messages.where((m) => m.role != 'event').toList();
    return SectionCard(
      title: 'Conversation',
      subtitle: '${msgs.length} messages${c.language != 'en' ? ' in ${languageName(c.language)}' : ''}',
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: EdgeInsets.zero,
          title: Text('Show the full intake conversation', style: t.bodyMedium?.copyWith(color: T.teal, fontWeight: FontWeight.w600)),
          children: [
            for (final m in msgs)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SizedBox(
                    width: 84,
                    child: Text(m.role == 'user' ? 'Applicant' : 'Assistant',
                        style: t.labelMedium?.copyWith(color: m.role == 'user' ? T.coral : T.tealDark)),
                  ),
                  Expanded(child: SelectableText(m.content, style: t.bodyMedium)),
                ]),
              ),
          ],
        ),
      ),
    );
  }
}

class _DecisionPanel extends StatefulWidget {
  const _DecisionPanel({required this.c, required this.onDone});
  final CaseDetail c;
  final VoidCallback onDone;

  @override
  State<_DecisionPanel> createState() => _DecisionPanelState();
}

class _DecisionPanelState extends State<_DecisionPanel> {
  late final _amount = TextEditingController(text: _initial());
  bool _busy = false;

  String _initial() {
    final c = widget.c;
    final cents = (c.assessment?.recommendation == 'approve' ? c.assessment?.recommendedAmountCents : null) ??
        c.amountRecommendedCents ??
        c.amountRequestedCents ??
        0;
    return cents % 100 == 0 ? '${cents ~/ 100}' : (cents / 100).toStringAsFixed(2);
  }

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  int get _cents => ((double.tryParse(_amount.text.replaceAll(',', '')) ?? 0) * 100).round();

  Future<void> _run(Future<void> Function(ApiClient api) action, String done) async {
    setState(() => _busy = true);
    try {
      await action(AppScope.of(context).api);
      if (mounted) showSnack(context, done);
      widget.onDone();
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _approve() async {
    final c = widget.c;
    final dest = switch (c.payoutMethod) {
      'paypal_account' => 'their verified PayPal account',
      'venmo_phone' => 'their Venmo',
      'paypal_email' => 'PayPal (${c.payoutReceiver ?? 'email'})',
      _ => 'the payout destination they choose',
    };
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Approve ${moneySmart(_cents)}?'),
        content: Text(_needsSecond
            ? 'This amount needs two reviewers. Your approval will be recorded; the money is sent after a second person approves.'
            : 'Tideover will send ${moneySmart(_cents)} to $dest with PayPal Payouts right away.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(_needsSecond ? 'Record approval' : 'Approve & send')),
        ],
      ),
    );
    if (ok != true) return;
    await _run((api) async {
      final res = await api.post('/api/staff/cases/${c.id}/approve', body: {'amountCents': _cents}) as Map<String, dynamic>;
      if (res['status'] == 'pending_second_approval' && mounted) {
        showSnack(context, 'Approval ${res['approvals']} of ${res['required']} recorded. A second reviewer must approve.');
      }
    }, 'Approved');
  }

  bool get _needsSecond {
    final me = AppScope.of(context).session.user?.id;
    final approvals = widget.c.reviews.where((r) => r.decision == 'approve' && r.amountCents == _cents).map((r) => r.reviewerId).toSet();
    final required = _cents > widget.c.dualApprovalAboveCents ? 2 : 1;
    final after = {...approvals, me}.length;
    return after < required;
  }

  Future<void> _ask() async {
    final qs = widget.c.assessment?.questionsForApplicant ?? const [];
    final ctrl = TextEditingController(text: qs.isEmpty ? '' : qs.join('\n'));
    final text = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Ask the applicant'),
        content: SizedBox(
          width: 460,
          child: TextField(
            controller: ctrl,
            minLines: 3,
            maxLines: 6,
            decoration: const InputDecoration(hintText: 'One question per line. The AI translates them into the applicant\'s language.'),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, ctrl.text), child: const Text('Send')),
        ],
      ),
    );
    if (text == null || text.trim().isEmpty) return;
    final questions = text.split('\n').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
    await _run((api) => api.post('/api/staff/cases/${widget.c.id}/request-info', body: {'questions': questions}), 'Questions sent');
  }

  Future<void> _deny() async {
    final ctrl = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Decline this request'),
        content: SizedBox(
          width: 460,
          child: TextField(
            controller: ctrl,
            minLines: 3,
            maxLines: 5,
            decoration: const InputDecoration(hintText: 'Reason, in plain words. The applicant receives a kind message in their language, with 211 for other help.'),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.danger),
            onPressed: () => Navigator.pop(ctx, ctrl.text),
            child: const Text('Decline'),
          ),
        ],
      ),
    );
    if (reason == null || reason.trim().length < 3) return;
    await _run((api) => api.post('/api/staff/cases/${widget.c.id}/deny', body: {'reason': reason.trim()}), 'Declined');
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final c = widget.c;
    final cap = c.fundCategories.where((x) => x.key == c.category).firstOrNull;
    final approvals = c.reviews.where((r) => r.decision == 'approve').toList();
    return SectionCard(
      title: 'Your decision',
      color: T.surface,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        TextField(
          controller: _amount,
          onChanged: (_) => setState(() {}),
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          style: t.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
          decoration: InputDecoration(
            prefixText: '\$ ',
            labelText: 'Grant amount',
            helperText: cap == null ? null : 'Cap for ${cap.label.toLowerCase()}: ${money(cap.maxCents, whole: true)}',
          ),
        ),
        if (_cents > c.dualApprovalAboveCents) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: T.warnSoft, borderRadius: T.r12),
            child: Row(children: [
              const Icon(Icons.group_rounded, color: T.warn, size: 18),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Over ${money(c.dualApprovalAboveCents, whole: true)}: two reviewers must approve.'
                  '${approvals.isEmpty ? '' : ' Approved so far by ${approvals.map((r) => r.reviewerName).toSet().join(', ')}.'}',
                  style: t.bodySmall?.copyWith(color: T.inkSoft),
                ),
              ),
            ]),
          ),
        ],
        const SizedBox(height: 14),
        FilledButton.icon(
          onPressed: _busy || _cents <= 0 ? null : _approve,
          icon: const Icon(Icons.send_rounded),
          label: Text(_needsSecond ? 'Approve (1st of 2)' : 'Approve & send ${moneySmart(_cents)}'),
        ),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
            child: OutlinedButton.icon(onPressed: _busy ? null : _ask, icon: const Icon(Icons.help_outline_rounded, size: 18), label: const Text('Ask')),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(foregroundColor: T.danger),
              onPressed: _busy ? null : _deny,
              icon: const Icon(Icons.block_rounded, size: 18),
              label: const Text('Decline'),
            ),
          ),
        ]),
        const SizedBox(height: 10),
        Text('Money moves only after your approval, within the fund\'s caps and balance, through PayPal Payouts.',
            style: t.bodySmall, textAlign: TextAlign.center),
      ]),
    );
  }
}

class _PayoutPanel extends StatelessWidget {
  const _PayoutPanel({required this.c, required this.onChanged});
  final CaseDetail c;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return SectionCard(
      title: 'Payout',
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Icon(c.payoutMethod == 'venmo_phone' ? Icons.phone_iphone_rounded : Icons.account_balance_wallet_rounded,
              color: c.payoutMethod == 'venmo_phone' ? T.venmo : T.paypalLight),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                switch (c.payoutMethod) {
                  'paypal_account' => 'PayPal account (Log in with PayPal)',
                  'venmo_phone' => 'Venmo phone',
                  'paypal_email' => 'PayPal email',
                  _ => 'Not chosen yet',
                },
                style: t.titleSmall,
              ),
              if (c.payoutReceiver != null) Text(c.payoutReceiver!, style: t.bodySmall),
            ]),
          ),
          if (c.payoutVerified) const VerifiedBadge(label: 'Verified'),
        ]),
        for (final p in c.payouts) ...[
          const Divider(height: 24),
          Row(children: [
            StatusPill(p.status, dense: true),
            const SizedBox(width: 8),
            Text(moneySmart(p.amountCents), style: t.titleSmall),
            const Spacer(),
            if (p.feeCents != null) Text('fee ${money(p.feeCents)}', style: t.bodySmall),
          ]),
          const SizedBox(height: 6),
          if (p.paypalBatchId != null) SelectableText('PayPal batch ${p.paypalBatchId}', style: t.bodySmall),
          if (p.paypalTransactionId != null) SelectableText('Transaction ${p.paypalTransactionId}', style: t.bodySmall),
          if (p.errorMessage != null && p.status != 'success') Text(p.errorMessage!, style: t.bodySmall?.copyWith(color: T.danger)),
          if (p.status == 'processing')
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () async {
                  await AppScope.of(context).api.post('/api/staff/payouts/${p.id}/sync');
                  onChanged();
                },
                icon: const Icon(Icons.sync_rounded, size: 18),
                label: const Text('Check with PayPal'),
              ),
            ),
        ],
        if (c.status == 'payout_failed' || c.status == 'awaiting_funds') ...[
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () async {
              try {
                await AppScope.of(context).api.post('/api/staff/cases/${c.id}/retry-payout');
                if (context.mounted) showSnack(context, 'Retrying payout…');
                onChanged();
              } on ApiException catch (e) {
                if (context.mounted) showSnack(context, e.message, error: true);
              }
            },
            icon: const Icon(Icons.replay_rounded),
            label: const Text('Retry payout'),
          ),
        ],
      ]),
    );
  }
}

class _ApplicantPanel extends StatelessWidget {
  const _ApplicantPanel({required this.c});
  final CaseDetail c;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final f = c.facts;
    final rows = <(String, String?)>[
      ('Name', c.applicant['paypalName'] as String? ?? c.applicant['name'] as String? ?? c.firstName),
      ('Location', f['location'] as String?),
      ('Urgency', f['urgency'] == null ? null : titleCase(f['urgency'] as String)),
      ('Due', f['dueDate'] as String?),
      ('Payee', f['payeeType'] == 'vendor' ? 'Vendor: ${f['payeeName'] ?? ''}' : (f['payeeType'] == 'self' ? 'Applicant' : null)),
      ('Household', f['householdSize']?.toString()),
      ('Tried', f['otherSupportTried'] as String?),
      ('Context', f['circumstances'] as String?),
      ('Email', c.applicant['email'] as String? ?? c.applicant['paypalEmail'] as String?),
    ].where((r) => r.$2 != null && r.$2!.isNotEmpty).toList();
    return SectionCard(
      title: 'Applicant',
      child: Column(children: [
        for (final r in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SizedBox(width: 84, child: Text(r.$1, style: t.bodySmall)),
              Expanded(child: Text(r.$2!, style: t.bodyMedium)),
            ]),
          ),
        if (c.consentPublicStory) Align(alignment: Alignment.centerLeft, child: Pill('Agreed to an anonymous public story', color: T.muted, dense: true)),
      ]),
    );
  }
}

class _Timeline extends StatelessWidget {
  const _Timeline({required this.c});
  final CaseDetail c;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return SectionCard(
      title: 'Audit trail',
      subtitle: 'Append-only. Every AI output, decision and PayPal event.',
      child: Column(children: [
        for (final a in c.audit.reversed)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              ActorIcon(actorType: a.actorType),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(a.summary, style: t.bodyMedium),
                  Text('${a.actorName ?? titleCase(a.actorType)} · ${clock(a.createdAt)} · ${timeAgo(a.createdAt)}', style: t.bodySmall),
                ]),
              ),
            ]),
          ),
      ]),
    );
  }
}
