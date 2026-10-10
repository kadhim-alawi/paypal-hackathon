import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/app_scope.dart';
import '../../core/sse.dart';
import '../../theme.dart';
import '../../widgets/ui.dart';

/// Live staff events (new cases, AI results, payouts, donations).
class StaffEvents extends ChangeNotifier {
  StaffEvents(this._services) {
    final token = _services.session.token;
    if (token != null) {
      _sse = openSse(_services.api.uri('/api/staff/events', {'token': token}), (e) {
        last = e;
        version++;
        notifyListeners();
      }, onStatus: (ok) {
        connected = ok;
        notifyListeners();
      });
    }
  }

  final AppServices _services;
  SseConnection? _sse;
  SseEvent? last;
  int version = 0;
  bool connected = false;

  @override
  void dispose() {
    _sse?.close();
    super.dispose();
  }
}

class StaffEventsScope extends InheritedNotifier<StaffEvents> {
  const StaffEventsScope({super.key, required StaffEvents events, required super.child}) : super(notifier: events);

  static StaffEvents of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<StaffEventsScope>()!.notifier!;
  static StaffEvents read(BuildContext context) =>
      context.getInheritedWidgetOfExactType<StaffEventsScope>()!.notifier!;
}

/// Loads data for a console page and reloads it when staff events arrive.
mixin LiveLoader<W extends StatefulWidget, D> on State<W> {
  D? data;
  Object? loadError;
  bool loading = false;
  StaffEvents? _events;
  int _seen = -1;
  Timer? _debounce;

  Future<D> fetch(ApiClient api);
  bool reloadOn(SseEvent event) => true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final events = StaffEventsScope.of(context);
    if (_events == null) {
      _events = events;
      _seen = events.version;
      load();
    } else if (events.version != _seen) {
      _seen = events.version;
      final e = events.last;
      if (e != null && reloadOn(e)) {
        _debounce?.cancel();
        _debounce = Timer(const Duration(milliseconds: 300), load);
      }
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> load() async {
    final services = AppScope.of(context);
    setState(() => loading = true);
    try {
      final d = await fetch(services.api);
      if (!mounted) return;
      setState(() {
        data = d;
        loadError = null;
      });
    } on ApiException catch (e) {
      if (e.status == 401) services.session.expire();
      if (mounted) setState(() => loadError = e);
    } catch (e) {
      if (mounted) setState(() => loadError = e);
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Widget buildLoaded(BuildContext context, Widget Function(D data) builder) {
    final d = data;
    if (d == null) {
      return loadError != null ? ErrorView(error: loadError!, onRetry: load) : const LoadingView();
    }
    return builder(d);
  }
}

class ConsolePageHeader extends StatelessWidget {
  const ConsolePageHeader({super.key, required this.title, this.subtitle, this.actions = const []});
  final String title;
  final String? subtitle;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: t.headlineMedium),
            if (subtitle != null) ...[const SizedBox(height: 4), Text(subtitle!, style: t.bodyMedium?.copyWith(color: T.muted))],
          ]),
        ),
        ...actions,
      ]),
    );
  }
}

String languageName(String code) => switch (code) {
      'en' => 'English',
      'es' => 'Spanish',
      'vi' => 'Vietnamese',
      'zh' => 'Chinese',
      'ar' => 'Arabic',
      'fr' => 'French',
      'pt' => 'Portuguese',
      'ko' => 'Korean',
      'tl' => 'Tagalog',
      'ru' => 'Russian',
      'so' => 'Somali',
      'ht' => 'Haitian Creole',
      _ => code.toUpperCase(),
    };
