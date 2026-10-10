import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../theme.dart';
import '../../widgets/ui.dart';
import 'attach.dart';
import 'chat_widgets.dart';
import 'request_controller.dart';
import 'review_sheet.dart';

/// The applicant's private request page: conversation, documents, payout
/// setup and live status, all in one place.
class RequestPage extends StatefulWidget {
  const RequestPage({super.key, required this.id, this.tokenFromLink, this.paypalResult});
  final String id;
  final String? tokenFromLink;
  final String? paypalResult;

  @override
  State<RequestPage> createState() => _RequestPageState();
}

class _RequestPageState extends State<RequestPage> {
  RequestController? _c;
  final _scroll = ScrollController();
  int _lastCount = 0;
  bool _noToken = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_c != null || _noToken) return;
    final services = AppScope.of(context);
    var token = services.storage.applicantToken(widget.id);
    if (widget.tokenFromLink != null) {
      token = widget.tokenFromLink;
      services.storage.saveApplicantToken(widget.id, token!);
    }
    if (token == null) {
      _noToken = true;
      return;
    }
    final c = RequestController(api: services.api, id: widget.id, token: token)..addListener(_onChange);
    _c = c;
    c.start().then((_) {
      if (!mounted) return;
      final r = widget.paypalResult;
      if (r == 'connected') {
        showSnack(context, 'PayPal connected. Your money can arrive in minutes once approved.');
        if (c.view?.isIntake == true) ReviewSheet.show(context, c);
      } else if (r == 'cancelled' || r == 'error') {
        showSnack(context, r == 'error' ? 'We couldn\'t connect PayPal. Please try again.' : 'PayPal connection cancelled.', error: r == 'error');
      }
    });
  }

  void _onChange() {
    final count = (_c?.messages.length ?? 0) + (_c?.draftText.length ?? 0);
    if (count != _lastCount) {
      _lastCount = count;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) {
          _scroll.animateTo(_scroll.position.maxScrollExtent + 200,
              duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
        }
      });
    }
  }

  @override
  void dispose() {
    _c?.removeListener(_onChange);
    _c?.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _attach() async {
    final c = _c!;
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(
            leading: const Icon(Icons.photo_camera_outlined),
            title: const Text('Take a photo'),
            subtitle: const Text('Bills, estimates and notices work well'),
            onTap: () => Navigator.pop(ctx, 'camera'),
          ),
          ListTile(
            leading: const Icon(Icons.upload_file_rounded),
            title: const Text('Choose a photo or PDF'),
            onTap: () => Navigator.pop(ctx, 'file'),
          ),
          const SizedBox(height: 8),
        ]),
      ),
    );
    if (choice == null) return;
    try {
      final file = choice == 'camera' ? await takePhoto() : await pickDocument();
      if (file == null) return;
      await c.upload(file.bytes, file.name, file.mimeType);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } catch (e) {
      if (mounted) showSnack(context, 'Couldn\'t add that file: $e', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_noToken) return const _NoAccess();
    final c = _c!;
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final v = c.view;
        if (v == null) {
          return Scaffold(
            appBar: AppBar(),
            body: c.error == null
                ? const LoadingView(label: 'Opening your request…')
                : (RequestController.isAuthError(c.error) ? const _NoAccess(embedded: true) : ErrorView(error: c.error!, onRetry: c.refresh)),
          );
        }
        final wide = MediaQuery.sizeOf(context).width > 1040;
        final chat = _ChatColumn(controller: c, scroll: _scroll, onAttach: _attach, showHeader: !wide);
        return Scaffold(
          appBar: AppBar(
            leading: IconButton(icon: const Icon(Icons.arrow_back_rounded), onPressed: () => context.go('/f/${v.fundSlug}')),
            title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(v.fundName, style: Theme.of(context).textTheme.bodySmall, overflow: TextOverflow.ellipsis),
              Text(v.publicRef),
            ]),
            actions: [
              Padding(padding: const EdgeInsets.only(right: 4), child: StatusPill(v.status)),
              PopupMenuButton<String>(
                onSelected: (k) async {
                  if (k == 'link') {
                    final url = '${Uri.base.origin}/r/${v.id}?t=${c.token}';
                    await Clipboard.setData(ClipboardData(text: url));
                    if (context.mounted) showSnack(context, 'Private link copied. Anyone with it can see this request.');
                  } else if (k == 'withdraw') {
                    final ok = await showDialog<bool>(
                      context: context,
                      builder: (ctx) => AlertDialog(
                        title: const Text('Withdraw this request?'),
                        content: const Text('The fund will stop reviewing it. You can start a new one later.'),
                        actions: [
                          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep it')),
                          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Withdraw')),
                        ],
                      ),
                    );
                    if (ok == true) await c.withdraw();
                  }
                },
                itemBuilder: (_) => [
                  const PopupMenuItem(value: 'link', child: Text('Copy private link')),
                  if (!const ['paid', 'paying', 'denied', 'withdrawn', 'unclaimed'].contains(v.status))
                    const PopupMenuItem(value: 'withdraw', child: Text('Withdraw request')),
                ],
              ),
            ],
          ),
          body: wide
              ? Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Expanded(child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 760), child: chat))),
                  Container(
                    width: 380,
                    decoration: const BoxDecoration(color: T.surface, border: Border(left: BorderSide(color: T.line))),
                    child: _SidePanel(controller: c),
                  ),
                ])
              : chat,
        );
      },
    );
  }
}

class _ChatColumn extends StatelessWidget {
  const _ChatColumn({required this.controller, required this.scroll, required this.onAttach, required this.showHeader});
  final RequestController controller;
  final ScrollController scroll;
  final VoidCallback onAttach;
  final bool showHeader;

  @override
  Widget build(BuildContext context) {
    final c = controller;
    final v = c.view!;
    final msgs = c.messages;
    final docThumb = {for (final d in v.documents) d.id: d.isImage ? c.documentUrl(d.id) : null};
    final items = <Widget>[
      for (final m in msgs)
        m.role == 'event'
            ? EventItem(message: m, thumbnailUrl: docThumb[m.meta['documentId']])
            : ChatBubble(message: m),
      if (c.assistantTyping) ChatBubble(message: ChatMessage(id: 'draft', role: 'assistant', content: c.draftText), streaming: true),
      if (c.uploading)
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: Center(child: Pill('Uploading…', color: T.muted, icon: Icons.cloud_upload_outlined)),
        ),
    ];
    return Column(children: [
      if (showHeader && !v.isIntake)
        Padding(padding: const EdgeInsets.fromLTRB(12, 4, 12, 4), child: StatusCard(view: v, compact: true)),
      Expanded(
        child: ListView(
          controller: scroll,
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          children: items,
        ),
      ),
      if (v.documentRequest != null && !c.uploading) _UploadPrompt(request: v.documentRequest!, onAttach: onAttach),
      if (v.isIntake && v.readyToSubmit) _ReadyBar(controller: c),
      if (v.status == 'approved' && v.payoutMethod == null) _PayoutNeeded(controller: c),
      if (v.status == 'payout_failed') _PayoutNeeded(controller: c, failed: true),
      Composer(
        enabled: v.acceptsMessages,
        busy: c.sending,
        hint: v.acceptsMessages ? null : 'This request is closed',
        onAttach: onAttach,
        onSend: (text) => c.send(text),
      ),
    ]);
  }
}

class _UploadPrompt extends StatelessWidget {
  const _UploadPrompt({required this.request, required this.onAttach});
  final Map<String, dynamic> request;
  final VoidCallback onAttach;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: T.sunSoft, borderRadius: T.r16, border: Border.all(color: T.sun.withValues(alpha: 0.5))),
      child: Row(children: [
        const Icon(Icons.document_scanner_outlined, color: Color(0xFF7A5300)),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Add your ${request['kind']}', style: t.titleSmall),
            Text('A phone photo is fine. Our AI reads it for the reviewer.', style: t.bodySmall),
          ]),
        ),
        const SizedBox(width: 8),
        FilledButton.icon(
          style: FilledButton.styleFrom(minimumSize: const Size(0, 42)),
          onPressed: onAttach,
          icon: const Icon(Icons.photo_camera_outlined, size: 18),
          label: const Text('Add'),
        ),
      ]),
    );
  }
}

class _ReadyBar extends StatelessWidget {
  const _ReadyBar({required this.controller});
  final RequestController controller;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final v = controller.view!;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: T.teal, borderRadius: T.r16, boxShadow: T.shadow),
      child: Row(children: [
        const Icon(Icons.task_alt_rounded, color: Colors.white),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Your request is ready', style: t.titleSmall?.copyWith(color: Colors.white)),
            Text(
              [
                if (v.categoryLabel != null) v.categoryLabel!,
                if (v.amountRequestedCents != null) moneySmart(v.amountRequestedCents),
              ].join(' · '),
              style: t.bodySmall?.copyWith(color: Colors.white70),
            ),
          ]),
        ),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: T.tealDark, minimumSize: const Size(0, 42)),
          onPressed: () => ReviewSheet.show(context, controller),
          child: const Text('Review & submit'),
        ),
      ]),
    );
  }
}

class _PayoutNeeded extends StatelessWidget {
  const _PayoutNeeded({required this.controller, this.failed = false});
  final RequestController controller;
  final bool failed;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: failed ? T.dangerSoft : T.tealSoft, borderRadius: T.r16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(failed ? 'PayPal couldn\'t deliver the money' : 'Approved! Where should we send it?', style: t.titleSmall),
        const SizedBox(height: 10),
        PayoutPicker(controller: controller),
      ]),
    );
  }
}

/// Compact progress summary (top of the chat on phones, side panel on desktop).
class StatusCard extends StatelessWidget {
  const StatusCard({super.key, required this.view, this.compact = false});
  final RequestView view;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final paid = view.status == 'paid';
    return Container(
      padding: EdgeInsets.all(compact ? 12 : 16),
      decoration: BoxDecoration(
        color: paid ? T.teal : T.surface,
        borderRadius: T.r20,
        border: Border.all(color: paid ? T.teal : T.line),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (paid) ...[
          Row(children: [
            const Icon(Icons.verified_rounded, color: Colors.white, size: 28),
            const SizedBox(width: 10),
            Expanded(
              child: Text('${moneySmart(view.amountApprovedCents)} sent', style: t.headlineSmall?.copyWith(color: Colors.white)),
            ),
            if (view.minutesToCash != null)
              Pill('${minutesLabel(view.minutesToCash)} after you asked', color: Colors.white, background: Colors.white24, dense: true),
          ]),
          const SizedBox(height: 4),
          if (!compact)
            Text(view.payoutDisplay == null ? 'Delivered by PayPal.' : 'Delivered by PayPal to ${view.payoutDisplay}.',
                style: t.bodyMedium?.copyWith(color: Colors.white.withValues(alpha: 0.9))),
          SizedBox(height: compact ? 10 : 14),
        ],
        Row(children: [
          for (var i = 0; i < view.timeline.length; i++) ...[
            Expanded(child: _StepDot(step: view.timeline[i], onDark: paid)),
            if (i < view.timeline.length - 1)
              Container(
                width: 18,
                height: 2,
                margin: const EdgeInsets.only(bottom: 26),
                color: paid ? Colors.white54 : (view.timeline[i].state == 'done' ? T.teal : T.line),
              ),
          ],
        ]),
      ]),
    );
  }
}

class _StepDot extends StatelessWidget {
  const _StepDot({required this.step, required this.onDark});
  final TimelineStep step;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, icon) = switch (step.state) {
      'done' => (onDark ? Colors.white : T.teal, onDark ? T.teal : Colors.white, Icons.check_rounded),
      'current' => (T.sunSoft, const Color(0xFF7A5300), Icons.more_horiz_rounded),
      'failed' => (T.dangerSoft, T.danger, Icons.close_rounded),
      _ => (onDark ? Colors.white24 : T.paperDeep, onDark ? Colors.white : T.faint, Icons.circle_outlined),
    };
    return Column(children: [
      CircleAvatar(radius: 13, backgroundColor: bg, child: Icon(icon, size: 15, color: fg)),
      const SizedBox(height: 6),
      Text(step.label,
          textAlign: TextAlign.center,
          maxLines: 2,
          style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: onDark ? Colors.white : (step.state == 'todo' ? T.faint : T.inkSoft))),
    ]);
  }
}

class _SidePanel extends StatelessWidget {
  const _SidePanel({required this.controller});
  final RequestController controller;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final v = controller.view!;
    return ListView(padding: const EdgeInsets.all(20), children: [
      StatusCard(view: v),
      const SizedBox(height: 20),
      Text('Your request', style: t.titleSmall),
      const SizedBox(height: 8),
      _kv(t, 'For', v.categoryLabel ?? 'Not set yet'),
      _kv(t, 'Amount', v.amountRequestedCents == null ? 'Not set yet' : moneySmart(v.amountRequestedCents)),
      if (v.amountApprovedCents != null) _kv(t, 'Approved', moneySmart(v.amountApprovedCents)),
      if (v.location != null) _kv(t, 'Location', v.location!),
      const SizedBox(height: 16),
      Text('Documents', style: t.titleSmall),
      const SizedBox(height: 8),
      if (v.documents.isEmpty) Text('None yet. Use the photo button to add a bill or estimate.', style: t.bodySmall),
      for (final d in v.documents)
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: ClipRRect(
            borderRadius: T.r8,
            child: d.isImage
                ? Image.network(controller.documentUrl(d.id), width: 40, height: 48, fit: BoxFit.cover)
                : Container(width: 40, height: 48, color: T.paperDeep, child: const Icon(Icons.picture_as_pdf_outlined)),
          ),
          title: Text(d.filename, maxLines: 1, overflow: TextOverflow.ellipsis, style: t.bodyMedium),
          subtitle: Text(d.status == 'processing' ? 'Reading…' : (d.summary ?? ''), maxLines: 2, overflow: TextOverflow.ellipsis),
        ),
      const SizedBox(height: 16),
      Text('Payout', style: t.titleSmall),
      const SizedBox(height: 8),
      PayoutPicker(controller: controller),
      const SizedBox(height: 24),
      Text('What happens next', style: t.titleSmall),
      const SizedBox(height: 8),
      Text(
        'Tideover\'s AI caseworker prepares your request for a volunteer reviewer, who makes the decision. '
        'If approved, PayPal sends the money right away. You\'ll see every update here.',
        style: t.bodySmall?.copyWith(color: T.inkSoft),
      ),
    ]);
  }

  Widget _kv(TextTheme t, String k, String v) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(children: [
          SizedBox(width: 90, child: Text(k, style: t.bodySmall)),
          Expanded(child: Text(v, style: t.bodyMedium)),
        ]),
      );
}

class _NoAccess extends StatelessWidget {
  const _NoAccess({this.embedded = false});
  final bool embedded;

  @override
  Widget build(BuildContext context) {
    final body = EmptyState(
      icon: Icons.lock_outline_rounded,
      title: 'This request is private',
      message: 'It can only be opened on the device that started it, or with its private link.',
      action: FilledButton(onPressed: () => context.go('/'), child: const Text('Go to Tideover')),
    );
    return embedded ? body : Scaffold(appBar: AppBar(), body: Center(child: body));
  }
}
