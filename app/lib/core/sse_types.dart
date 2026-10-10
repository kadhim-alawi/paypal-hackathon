class SseEvent {
  SseEvent(this.type, this.data);
  final String type;
  final Map<String, dynamic> data;
}

typedef SseHandler = void Function(SseEvent event);

abstract class SseConnection {
  void close();
}

