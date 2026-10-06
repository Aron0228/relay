import 'dart:convert';
import 'dart:io';

import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import 'package:http/http.dart' as http;

class SessionService {
  SessionService({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;
  String? _token;
  static const _configuredUrl = String.fromEnvironment('API_BASE_URL');
  final String _baseUrl = _configuredUrl.isNotEmpty
      ? _configuredUrl
      : Platform.isAndroid
      ? 'http://10.0.2.2:3000'
      : 'http://localhost:3000';

  Uri _url(String path) => Uri.parse('$_baseUrl/api/sessions/$path');

  Future<Map<String, dynamic>> login() async {
    final result = await FlutterWebAuth2.authenticate(
      url: _url(
        'login',
      ).replace(queryParameters: {'client': 'mobile'}).toString(),
      callbackUrlScheme: 'relay',
      options: const FlutterWebAuth2Options(preferEphemeral: true),
    );

    final callback = Uri.parse(result);
    final code = callback.queryParameters['exchange_code'];

    if (callback.scheme != 'relay' ||
        callback.host != 'auth' ||
        callback.path != '/callback' ||
        code == null ||
        code.isEmpty) {
      throw Exception('Invalid login callback');
    }

    final response = await _client.post(
      _url('exchange'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'exchangeCode': code}),
    );

    if (response.statusCode != 200) throw Exception('Login failed');

    _token =
        (jsonDecode(response.body) as Map<String, dynamic>)['token'] as String;

    return me();
  }

  Future<Map<String, dynamic>> me() async {
    final response = await _client.get(
      _url('me'),
      headers: {'Authorization': 'Bearer $_token'},
    );

    if (response.statusCode != 200) {
      _token = null;
      throw Exception('Could not load the session');
    }

    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  Future<void> logout() async {
    final response = await _client.post(
      _url('logout'),
      headers: {'Authorization': 'Bearer $_token'},
    );

    if (response.statusCode != 204) throw Exception('Logout failed');

    _token = null;
  }

  void close() => _client.close();
}
