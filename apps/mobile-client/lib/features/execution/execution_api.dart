import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../session_service.dart';

class TestRun {
  TestRun(this.data);
  final Map<String, dynamic> data;
  String get id => data['id'] as String;
  String get title => data['title'] as String;
  String get status => data['status'] as String;
  String get shortId => id.substring(0, 8);
  bool get active => status == 'queued' || status == 'running';
  bool get hasVideo => data['videoFile'] != null;
  bool get stopping => data['cancelRequested'] == true;
}

class RunEvent {
  RunEvent(this.data);
  final Map<String, dynamic> data;
  String get id => data['id'] as String;
  int get sequence => int.parse(data['sequence'].toString());
  String get type => data['type'] as String;
  Map<String, dynamic> get payload => data['payload'] as Map<String, dynamic>;
}

class ExecutionApi {
  ExecutionApi(this.sessions);
  final SessionService sessions;
  final http.Client _client = http.Client();

  Uri url(String path) => Uri.parse('${sessions.apiBaseUrl}/runs$path');

  Future<dynamic> _get(String path) async {
    final response = await _client.get(
      url(path),
      headers: sessions.authorizationHeaders,
    );

    if (response.statusCode != 200) {
      throw Exception('Could not load run data (${response.statusCode})');
    }

    return jsonDecode(response.body);
  }

  Future<({List<TestRun> items, String? cursor})> list({
    String scope = 'all',
    String search = '',
    String? before,
  }) async {
    final query = Uri(
      queryParameters: {
        'scope': scope,
        'search': search,
        'before': ?before,
        'workspaceId': ?sessions.workspaceId,
      },
    ).query;
    final data = await _get('?$query') as Map<String, dynamic>;

    return (
      items: (data['items'] as List)
          .map((item) => TestRun(item as Map<String, dynamic>))
          .toList(),
      cursor: data['nextCursor'] as String?,
    );
  }

  Future<TestRun> get(String id) async =>
      TestRun(await _get('/$id') as Map<String, dynamic>);
  Future<Map<String, dynamic>?> result(String id) async =>
      await _get('/$id/result') as Map<String, dynamic>?;

  Future<TestRun> create(String prompt, String environmentId) async {
    final response = await _client.post(
      url('/agent'),
      headers: {
        ...sessions.authorizationHeaders,
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'prompt': prompt,
        'workspaceId': sessions.workspaceId,
        'environmentId': environmentId,
      }),
    );

    if (response.statusCode != 202) {
      throw Exception(
        'Could not start the test. Check the approved target URL.',
      );
    }

    return TestRun(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> cancel(String id) async {
    final response = await _client.post(
      url('/$id/cancel'),
      headers: sessions.authorizationHeaders,
    );

    if (response.statusCode != 204) throw Exception('Could not stop the run');
  }

  Stream<RunEvent> activity(String id, int after, http.Client client) async* {
    final request = http.Request('GET', url('/$id/activity?after=$after'));
    request.headers.addAll(sessions.authorizationHeaders);
    final response = await client.send(request);

    if (response.statusCode != 200) {
      throw Exception('Activity stream unavailable');
    }

    await for (final line
        in response.stream
            .transform(utf8.decoder)
            .transform(const LineSplitter())) {
      if (line.startsWith('data: ')) {
        yield RunEvent(jsonDecode(line.substring(6)) as Map<String, dynamic>);
      }
    }
  }

  void close() => _client.close();
}
