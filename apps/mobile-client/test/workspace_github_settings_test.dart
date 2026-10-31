import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:relay/features/workspace/workspace_api.dart';
import 'package:relay/features/workspace/workspace_github_settings.dart';
import 'package:relay/session_service.dart';

void main() {
  testWidgets('members see GitHub mappings without connection controls', (
    tester,
  ) async {
    final sessions = SessionService();
    final api = WorkspaceApi(
      sessions,
      client: MockClient(
        (request) async => http.Response(
          jsonEncode(
            request.url.path.endsWith('/environments')
                ? [
                    {
                      'id': 'shop',
                      'name': 'Candy Shop',
                      'baseUrl': 'https://academybugs.com/',
                    },
                  ]
                : {
                    'installations': [
                      {'id': 'app', 'githubId': 12345, 'accountLogin': 'Finn'},
                    ],
                    'repositories': [
                      {
                        'id': 'repo',
                        'githubId': 54321,
                        'installationId': 'app',
                        'fullName': 'ooo/candy-shop',
                        'defaultEnvironmentId': 'shop',
                      },
                    ],
                  },
          ),
          200,
        ),
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: WorkspaceGithubSettings(
              sessions: sessions,
              workspaceId: 'candy',
              admin: false,
              api: api,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('ooo/candy-shop'), findsOneWidget);
    expect(find.text('Candy Shop'), findsOneWidget);
    expect(find.text('Connect'), findsNothing);
    expect(find.text('Add repository'), findsNothing);
    sessions.close();
  });

  testWidgets('admins edit the repository environment in a side panel', (
    tester,
  ) async {
    final sessions = SessionService();
    Map<String, dynamic>? saved;
    final opened = <Uri>[];
    final api = WorkspaceApi(
      sessions,
      client: MockClient((request) async {
        if (request.method == 'POST') {
          saved = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response('{"id":"repo"}', 200);
        }
        if (request.url.path.endsWith('/installation-url')) {
          return http.Response(
            '{"url":"https://github.com/apps/relay-bmo/installations/new"}',
            200,
          );
        }
        if (request.url.path.endsWith('/settings-url')) {
          return http.Response(
            '{"url":"https://github.com/settings/installations/12345"}',
            200,
          );
        }
        final dynamic body = request.url.path.endsWith('/environments')
            ? [
                {
                  'id': 'shop',
                  'name': 'Candy Shop',
                  'baseUrl': 'https://academybugs.com/',
                },
              ]
            : request.url.path.endsWith('/repositories')
            ? [
                {'githubId': 54321, 'fullName': 'ooo/candy-shop'},
              ]
            : {
                'installations': [
                  {'id': 'app', 'githubId': 12345, 'accountLogin': 'Finn'},
                ],
                'repositories': [
                  {
                    'id': 'repo',
                    'githubId': 54321,
                    'installationId': 'app',
                    'fullName': 'ooo/candy-shop',
                    'defaultEnvironmentId': 'shop',
                  },
                ],
              };
        return http.Response(jsonEncode(body), 200);
      }),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: WorkspaceGithubSettings(
              sessions: sessions,
              workspaceId: 'candy',
              admin: true,
              api: api,
              openUrl: (url) async {
                opened.add(url);
                return true;
              },
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Install GitHub App'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Manage on GitHub'));
    await tester.pumpAndSettle();
    expect(opened.map((url) => url.toString()).toList(), [
      'https://github.com/apps/relay-bmo/installations/new',
      'https://github.com/settings/installations/12345',
    ]);
    await tester.ensureVisible(find.byType(PopupMenuButton<String>));
    await tester.tap(find.byType(PopupMenuButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Edit'));
    await tester.pumpAndSettle();
    expect(find.text('Approved environment'), findsOneWidget);
    await tester.tap(find.text('Save repository'));
    await tester.pumpAndSettle();
    expect(saved, {
      'installationId': 'app',
      'githubId': 54321,
      'environmentId': 'shop',
    });
    sessions.close();
  });
}
