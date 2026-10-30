import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import '../../session_service.dart';

class WorkspaceApi {
  WorkspaceApi(this.sessions, {http.Client? client})
    : _client = client ?? http.Client();
  final SessionService sessions;
  final http.Client _client;

  Future<dynamic> request(
    String method,
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    final request = http.Request(
      method,
      Uri.parse('${sessions.apiBaseUrl}$path'),
    );
    request.headers.addAll({
      ...sessions.authorizationHeaders,
      'Content-Type': 'application/json',
    });

    if (body != null) request.body = jsonEncode(body);

    final response = await http.Response.fromStream(
      await _client.send(request),
    );

    if (response.statusCode >= 400) {
      final error = jsonDecode(response.body) as Map<String, dynamic>;
      throw Exception(
        error['error']?['message'] ?? 'The workspace operation failed.',
      );
    }

    return response.body.isEmpty ? null : jsonDecode(response.body);
  }

  Future<List<Map<String, dynamic>>> list(String path) async =>
      (await request('GET', path) as List).cast<Map<String, dynamic>>();
  Future<void> uploadAvatar(
    String id,
    Uint8List bytes,
    String contentType,
  ) async {
    final response = await _client.post(
      Uri.parse('${sessions.apiBaseUrl}/workspaces/$id/avatar'),
      headers: {...sessions.authorizationHeaders, 'Content-Type': contentType},
      body: bytes,
    );

    if (response.statusCode != 200) {
      throw Exception(
        'Could not upload the image. Choose a PNG, JPEG or WebP image smaller than 5 MB.',
      );
    }
  }

  void close() => _client.close();
}
