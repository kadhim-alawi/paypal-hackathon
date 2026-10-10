import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../theme.dart';
import '../../widgets/rich_message.dart';
import '../../widgets/ui.dart';

class AssistantAvatar extends StatelessWidget {
  const AssistantAvatar({super.key});
  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.only(top: 2),
        child: TideoverLogo(size: 28, wordmark: false),
      );
}

/// One message in the conversation.
class ChatBubble extends StatelessWidget {
  const ChatBubble({super.key, required this.message, this.streaming = false});
  final ChatMessage message;
  final bool streaming;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final mine = message.role == 'user';
    final special = message.ui;
    final celebrate = special == 'paid' || special == 'approved';
    final warning = special == 'payout_failed' || special == 'denied';
    final maxW = MediaQuery.sizeOf(context).width.clamp(0, 720) * 0.78;
    final bubble = Container(
      constraints: BoxConstraints(maxWidth: maxW.toDouble()),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      decoration: BoxDecoration(
        color: mine ? T.teal : (celebrate ? T.tealSoft : (warning ? T.dangerSoft : T.surface)),
        border: mine ? null : Border.all(color: celebrate ? T.teal.withValues(alpha: 0.35) : T.line),
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(18),
          topRight: const Radius.circular(18),
          bottomLeft: Radius.circular(mine ? 18 : 6),
          bottomRight: Radius.circular(mine ? 6 : 18),
        ),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        if (celebrate)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(special == 'paid' ? Icons.verified_rounded : Icons.check_circle_rounded, color: T.tealDark, size: 18),
              const SizedBox(width: 6),
              Text(special == 'paid' ? 'Money sent' : 'Approved', style: t.labelLarge?.copyWith(color: T.tealDark)),
            ]),
          ),
        if (message.content.isEmpty && streaming)
          const _TypingDots()
        else if (mine)
          SelectableText(
            message.content,
            style: t.bodyLarge?.copyWith(color: Colors.white, height: 1.45, fontSize: 15.5),
          )
        else
          RichMessage(message.content, style: t.bodyLarge!.copyWith(color: T.ink, height: 1.45, fontSize: 15.5)),
      ]),
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        mainAxisAlignment: mine ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!mine) ...[const AssistantAvatar(), const SizedBox(width: 8)],
          Flexible(child: bubble),
        ],
      ),
    );
  }
}

class _TypingDots extends StatefulWidget {
  const _TypingDots();
  @override
  State<_TypingDots> createState() => _TypingDotsState();
}

class _TypingDotsState extends State<_TypingDots> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 20,
        child: AnimatedBuilder(
          animation: _c,
          builder: (_, _) => Row(mainAxisSize: MainAxisSize.min, children: [
            for (var i = 0; i < 3; i++)
              Container(
                margin: const EdgeInsets.symmetric(horizontal: 2.5),
                width: 7,
                height: 7,
                decoration: BoxDecoration(
                  color: T.muted.withValues(alpha: 0.35 + 0.65 * (((_c.value * 3) - i) % 3 < 1 ? 1 : 0.2)),
                  shape: BoxShape.circle,
                ),
              ),
          ]),
        ),
      );
}

/// Small centered system notes and document cards.
class EventItem extends StatelessWidget {
  const EventItem({super.key, required this.message, this.thumbnailUrl});
  final ChatMessage message;
  final String? thumbnailUrl;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    switch (message.ui) {
      case 'request_document':
      case 'ready':
        return const SizedBox.shrink();
      case 'document':
        return _note(t, Icons.attach_file_rounded, message.content);
      case 'document_analyzed':
        final amount = message.meta['amountCents'];
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: T.surface, borderRadius: T.r16, border: Border.all(color: T.line)),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              ClipRRect(
                borderRadius: T.r8,
                child: thumbnailUrl == null
                    ? Container(width: 52, height: 64, color: T.paperDeep, child: const Icon(Icons.description_outlined, color: T.muted))
                    : Image.network(thumbnailUrl!, width: 52, height: 64, fit: BoxFit.cover,
                        errorBuilder: (_, _, _) =>
                            Container(width: 52, height: 64, color: T.paperDeep, child: const Icon(Icons.description_outlined, color: T.muted))),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    const Icon(Icons.document_scanner_rounded, size: 16, color: T.tealDark),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(AppScope.of(context).info.aiMode == 'claude' ? 'Document read by AI' : 'Document received',
                          style: t.labelMedium?.copyWith(color: T.tealDark)),
                    ),
                    if (amount is num) Pill(moneySmart(amount), color: T.tealDark, dense: true),
                  ]),
                  const SizedBox(height: 4),
                  Text(
                    (message.meta['title'] as String?) ?? 'Document',
                    style: t.titleSmall,
                  ),
                  if (message.meta['issuer'] is String)
                    Text(message.meta['issuer'] as String, style: t.bodySmall),
                ]),
              ),
            ]),
          ),
        );
      default:
        return _note(t, _iconFor(message.ui), message.content);
    }
  }

  IconData _iconFor(String? ui) => switch (ui) {
        'submitted' => Icons.send_rounded,
        'in_review' => Icons.visibility_outlined,
        'need_payout_destination' => Icons.account_balance_wallet_outlined,
        _ => Icons.info_outline_rounded,
      };

  Widget _note(TextTheme t, IconData icon, String text) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Center(
          child: Container(
            constraints: const BoxConstraints(maxWidth: 520),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(color: T.paperDeep, borderRadius: BorderRadius.circular(99)),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(icon, size: 15, color: T.muted),
              const SizedBox(width: 6),
              Flexible(child: Text(text, style: t.bodySmall?.copyWith(color: T.inkSoft), textAlign: TextAlign.center)),
            ]),
          ),
        ),
      );
}

/// Text box with voice input, attachments and send.
class Composer extends StatefulWidget {
  const Composer({super.key, required this.onSend, this.onAttach, this.enabled = true, this.busy = false, this.hint});
  final Future<void> Function(String text) onSend;
  final VoidCallback? onAttach;
  final bool enabled;
  final bool busy;
  final String? hint;

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  final _text = TextEditingController();
  final _focus = FocusNode();
  final _speech = SpeechToText();
  bool _speechReady = false;
  bool _listening = false;
  String _prefix = '';

  @override
  void dispose() {
    _text.dispose();
    _focus.dispose();
    _speech.cancel();
    super.dispose();
  }

  Future<void> _toggleMic() async {
    if (_listening) {
      await _speech.stop();
      setState(() => _listening = false);
      return;
    }
    if (!_speechReady) {
      _speechReady = await _speech.initialize(
        onStatus: (s) {
          if ((s == 'done' || s == 'notListening') && mounted) setState(() => _listening = false);
        },
        onError: (_) {
          if (mounted) setState(() => _listening = false);
        },
      );
    }
    if (!_speechReady) {
      if (mounted) showSnack(context, 'Voice input isn\'t available in this browser. You can type instead.');
      return;
    }
    _prefix = _text.text.trim().isEmpty ? '' : '${_text.text.trim()} ';
    setState(() => _listening = true);
    await _speech.listen(
      onResult: (r) {
        _text.text = '$_prefix${r.recognizedWords}';
        _text.selection = TextSelection.collapsed(offset: _text.text.length);
        setState(() {});
      },
      listenOptions: SpeechListenOptions(partialResults: true, listenMode: ListenMode.dictation, cancelOnError: true),
    );
  }

  Future<void> _send() async {
    final text = _text.text.trim();
    if (text.isEmpty || widget.busy) return;
    if (_listening) {
      await _speech.stop();
      _listening = false;
    }
    _text.clear();
    setState(() {});
    try {
      await widget.onSend(text);
    } catch (e) {
      _text.text = text;
      if (mounted) showSnack(context, '$e', error: true);
    }
    _focus.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    final hasText = _text.text.trim().isNotEmpty;
    return Container(
      decoration: const BoxDecoration(
        color: T.surface,
        border: Border(top: BorderSide(color: T.line)),
      ),
      padding: EdgeInsets.fromLTRB(12, 10, 12, 10 + MediaQuery.paddingOf(context).bottom),
      child: SafeArea(
        top: false,
        child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          if (widget.onAttach != null)
            IconButton(
              tooltip: 'Add a photo or document',
              onPressed: widget.enabled ? widget.onAttach : null,
              icon: const Icon(Icons.add_photo_alternate_outlined),
            ),
          Expanded(
            child: TextField(
              controller: _text,
              focusNode: _focus,
              enabled: widget.enabled,
              minLines: 1,
              maxLines: 5,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => _send(),
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: _listening ? 'Listening… speak in any language' : (widget.hint ?? 'Write in any language…'),
                fillColor: T.paper,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide.none),
                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide.none),
                focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: const BorderSide(color: T.teal)),
              ),
            ),
          ),
          const SizedBox(width: 6),
          if (!hasText)
            IconButton.filled(
              tooltip: _listening ? 'Stop' : 'Speak',
              style: IconButton.styleFrom(backgroundColor: _listening ? T.coral : T.tealSoft, foregroundColor: _listening ? Colors.white : T.tealDark),
              onPressed: widget.enabled ? _toggleMic : null,
              icon: Icon(_listening ? Icons.stop_rounded : Icons.mic_rounded),
            )
          else
            IconButton.filled(
              tooltip: 'Send',
              onPressed: widget.enabled && !widget.busy ? _send : null,
              icon: const Icon(Icons.arrow_upward_rounded),
            ),
        ]),
      ),
    );
  }
}
