import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart' show MediaType;

import 'config.dart';

class ApiException implements Exception {
  ApiException(this.status, this.message, [this.code]);
  final int status;
  final String message;
  final String? code;

  @override
  String toString() => message;
}

/// Thin JSON client for the Tideover API.
class ApiClient {
  ApiClient({String? baseUrl, http.Client? client})
      : baseUrl = baseUrl ?? AppConfig.apiBase,
        _http = client ?? http.Client();

  final String baseUrl;
  final http.Client _http;

  /// Staff session token (console). Applicant calls pass their own header.
  String? staffToken;

  Uri uri(String path, [Map<String, String>? query]) {
    final u = Uri.parse('$baseUrl$path');
    return query == null ? u : u.replace(queryParameters: {...u.queryParameters, ...query});
  }

  Map<String, String> _headers(Map<String, String>? extra, {bool json = true}) => {
        if (json) 'Content-Type': 'application/json',
        'Accept': 'application/json',
        if (staffToken != null) 'Authorization': 'Bearer $staffToken',
        ...?extra,
      };

  Future<dynamic> get(String path, {Map<String, String>? headers, Map<String, String>? query}) async {
    final res = await _http.get(uri(path, query), headers: _headers(headers, json: false));
    return _decode(res);
  }

  Future<dynamic> post(String path, {Object? body, Map<String, String>? headers}) async {
    final res = await _http.post(uri(path), headers: _headers(headers), body: jsonEncode(body ?? {}));
    return _decode(res);
  }

  Future<dynamic> put(String path, {Object? body, Map<String, String>? headers}) async {
    final res = await _http.put(uri(path), headers: _headers(headers), body: jsonEncode(body ?? {}));
    return _decode(res);
  }

  Future<dynamic> upload(
    String path, {
    required Uint8List bytes,
    required String filename,
    required String mimeType,
    Map<String, String>? headers,
  }) async {
    final req = http.MultipartRequest('POST', uri(path))
      ..headers.addAll(_headers(headers, json: false))
      ..files.add(http.MultipartFile.fromBytes('file', bytes, filename: filename, contentType: _mediaType(mimeType)));
    final streamed = await _http.send(req);
    return _decode(await http.Response.fromStream(streamed));
  }

  dynamic _decode(http.Response res) {
    dynamic body;
    try {
      body = res.body.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      body = null;
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return body;
    final message = body is Map && body['message'] is String
        ? body['message'] as String
        : 'Request failed (${res.statusCode})';
    throw ApiException(res.statusCode, message, body is Map ? body['error'] as String? : null);
  }
}

MediaType _mediaType(String mime) {
  final parts = mime.split('/');
  return MediaType(parts.first, parts.length > 1 ? parts[1] : 'octet-stream');
}
