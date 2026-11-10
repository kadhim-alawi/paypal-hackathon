import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/api.dart';
import '../../core/config.dart';
import '../../core/l10n.dart';
import '../../core/links.dart';
import '../../core/models.dart';
import '../../core/sse.dart';

/// State for one applicant's private request page: the conversation (with a
/// live-streaming assistant reply), documents, payout setup and status.
class RequestController extends ChangeNotifier {
  RequestController({required this.api, required this.id, required this.token});

  final ApiClient api;
  final String id;
  final String token;

  RequestView? view;
  Object? error;
  bool sending = false;
  bool uploading = false;
  bool submitting = false;
  bool connected = false;

  /// Assistant reply currently streaming in (turnId → text so far).
  String? draftId;
  String draftText = '';

  /// Messages sent but not yet echoed back by the server.
  final List<ChatMessage> _pending = [];
  SseConnection? _sse;

  Map<String, String> get _auth => {'x-applicant-token': token};

  List<ChatMessage> get messages {
    final server = view?.messages ?? const <ChatMessage>[];
    final ids = server.map((m) => m.id).toSet();
    final pending = _pending.where((p) => !ids.contains(p.id) && !server.any((m) => m.role == 'user' && m.content == p.content && _recent(m))).toList();
    return [...server, ...pending];
  }

  bool _recent(ChatMessage m) => m.createdAt != null && DateTime.now().difference(m.createdAt!).inMinutes < 2;

  bool get assistantTyping => draftId != null;

  /// Labels follow the language the caseworker detected (English until then).
  Tr get tr => Tr(view?.language ?? Tr.deviceLanguage());

  Future<void> start() async {
    await refresh();
    _sse = openSse(api.uri('/api/applications/$id/events', {'token': token}), _onEvent, onStatus: (ok) {
      connected = ok;
      notifyListeners();
    });
  }

  Future<void> refresh() async {
    try {
      view = RequestView(await api.get('/api/applications/$id', headers: _auth) as Map<String, dynamic>);
      error = null;
    } catch (e) {
      error = e;
    }
    notifyListeners();
  }

  void _onEvent(SseEvent e) {
    switch (e.type) {
      case 'application.updated':
        view = RequestView(e.data);
      case 'message.created':
        final msg = ChatMessage.fromJson(e.data);
        final current = view;
        if (current != null && !current.messages.any((m) => m.id == msg.id)) {
          final raw = Map<String, dynamic>.from(current.raw);
          raw['messages'] = [...(raw['messages'] as List? ?? const []), e.data];
          view = RequestView(raw);
        }
        if (msg.id == draftId) {
          draftId = null;
          draftText = '';
        }
      case 'assistant.start':
        draftId = e.data['turnId'] as String?;
        draftText = '';
      case 'assistant.delta':
        if (e.data['turnId'] == draftId) draftText += (e.data['text'] as String? ?? '');
      case 'assistant.cancel':
        if (e.data['turnId'] == draftId) {
          draftId = null;
          draftText = '';
        }
      default:
        return;
    }
    notifyListeners();
  }

  Future<void> send(String text) async {
    final content = text.trim();
    if (content.isEmpty) return;
    final temp = ChatMessage(id: 'local-${DateTime.now().microsecondsSinceEpoch}', role: 'user', content: content, createdAt: DateTime.now());
    _pending.add(temp);
    sending = true;
    notifyListeners();
    try {
      await api.post('/api/applications/$id/messages', body: {'content': content}, headers: _auth);
      // The server has stored it. Load that copy, then drop the local echo; otherwise it resurfaces
      // at the bottom once it is older than the 2 minute window in [messages].
      await refresh();
      _pending.remove(temp);
    } catch (e) {
      _pending.remove(temp);
      rethrow;
    } finally {
      sending = false;
      notifyListeners();
    }
  }

  Future<void> upload(Uint8List bytes, String filename, String mimeType) async {
    uploading = true;
    notifyListeners();
    try {
      await api.upload('/api/applications/$id/documents', bytes: bytes, filename: filename, mimeType: mimeType, headers: _auth);
    } finally {
      uploading = false;
      notifyListeners();
    }
  }

  Future<void> setPayout(String method, String receiver) async {
    view = RequestView(
      await api.put('/api/applications/$id/payout', body: {'method': method, 'receiver': receiver}, headers: _auth) as Map<String, dynamic>,
    );
    notifyListeners();
  }

  Future<void> connectPayPal() async {
    final res = await api.get('/api/applications/$id/paypal/connect',
        headers: _auth, query: {'client': AppConfig.isWebOrigin ? 'web' : 'app'}) as Map<String, dynamic>;
    await openUrl(res['url'] as String);
  }

  Future<void> submit({required bool consent, String? category, int? amountCents, String? name, String? email}) async {
    submitting = true;
    notifyListeners();
    try {
      view = RequestView(await api.post('/api/applications/$id/submit',
          body: {
            'consentPublicStory': consent,
            'category': category,
            'amountCents': amountCents,
            'name': name,
            'email': email,
          },
          headers: _auth) as Map<String, dynamic>);
    } finally {
      submitting = false;
      notifyListeners();
    }
  }

  Future<void> withdraw() async {
    view = RequestView(await api.post('/api/applications/$id/withdraw', headers: _auth) as Map<String, dynamic>);
    notifyListeners();
  }

  String documentUrl(String docId) => api.uri('/api/applications/$id/documents/$docId', {'token': token}).toString();

  @override
  void dispose() {
    _sse?.close();
    super.dispose();
  }

  static bool isAuthError(Object? e) => e is ApiException && (e.status == 401 || e.status == 404);
}
