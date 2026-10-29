import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:relay/features/workspace/workspace_api.dart';
import 'package:relay/features/workspace/workspace_selection.dart';
import 'package:relay/features/workspace/workspace_settings.dart';
import 'package:relay/session_service.dart';

void main() {
  testWidgets('accepts an email invitation and refreshes membership', (
    tester,
  ) async {
    final sessions = SessionService();
    var accepted = false;
    var refreshed = false;
    final api = WorkspaceApi(
      sessions,
      client: MockClient((request) async {
        if (request.method == 'POST') {
          expect(request.url.path, '/api/workspace-invitations/jake/response');
          expect(jsonDecode(request.body), {'accept': true});
          accepted = true;
          return http.Response('', 204);
        }
        return http.Response(
          jsonEncode(
            accepted
                ? []
                : [
                    {
                      'id': 'jake',
                      'email': 'jake@ooo.example',
                      'workspaceName': 'Candy Kingdom',
                    },
                  ],
          ),
          200,
        );
      }),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: WorkspaceSelection(
          sessions: sessions,
          workspaces: const [],
          name: 'Finn',
          api: api,
          onSelect: (_) {},
          onCreate: () {},
          onSignOut: () {},
          onRefresh: () async {
            refreshed = true;
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Candy Kingdom'), findsOneWidget);
    await tester.tap(find.text('Join workspace'));
    await tester.pumpAndSettle();
    expect(accepted, isTrue);
    expect(refreshed, isTrue);
    expect(find.text('Candy Kingdom'), findsNothing);
    sessions.close();
  });

  testWidgets('members can view environments but cannot manage them', (
    tester,
  ) async {
    final sessions = SessionService();
    final api = WorkspaceApi(
      sessions,
      client: MockClient((request) async {
        final data = request.url.path.endsWith('/members')
            ? [
                {'userId': 'jake', 'username': 'Jake', 'role': 'member'},
              ]
            : request.url.path.endsWith('/environments')
            ? [
                {
                  'id': 'shop',
                  'name': 'Candy Shop',
                  'baseUrl': 'https://academybugs.com/',
                },
              ]
            : [];
        return http.Response(jsonEncode(data), 200);
      }),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: WorkspaceSettings(
              sessions: sessions,
              workspace: const {
                'id': 'candy',
                'name': 'Candy Kingdom',
                'role': 'member',
              },
              api: api,
              onChanged: () async {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Jake'), findsNothing);
    await tester.tap(find.text('Members'));
    await tester.pumpAndSettle();
    expect(find.text('Jake'), findsOneWidget);
    expect(find.text('Candy Shop'), findsNothing);
    await tester.tap(find.text('Environments'));
    await tester.pumpAndSettle();
    expect(find.text('Candy Shop'), findsOneWidget);
    expect(find.text('Invite member'), findsNothing);
    expect(find.text('New environment'), findsNothing);
    sessions.close();
  });
  testWidgets(
    'owners cannot leave or edit their role and forms open in a panel',
    (tester) async {
      final sessions = SessionService();
      final api = WorkspaceApi(
        sessions,
        client: MockClient((request) async {
          final data = request.url.path.endsWith('/members')
              ? [
                  {
                    'userId': 'finn',
                    'username': 'Finn',
                    'role': 'admin',
                    'isOwner': true,
                  },
                ]
              : [];
          return http.Response(jsonEncode(data), 200);
        }),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: WorkspaceSettings(
                sessions: sessions,
                workspace: const {
                  'id': 'candy',
                  'name': 'Candy Kingdom',
                  'role': 'admin',
                  'isOwner': true,
                },
                api: api,
                onChanged: () async {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Members'));
      await tester.pumpAndSettle();
      expect(find.text('Owner'), findsOneWidget);
      expect(find.text('Edit'), findsNothing);
      expect(find.text('Leave workspace'), findsNothing);
      await tester.tap(find.text('Invite member'));
      await tester.pumpAndSettle();
      expect(find.text('E-mail'), findsOneWidget);
      await tester.tap(find.byTooltip('Close panel'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Environments'));
      await tester.pumpAndSettle();
      expect(find.text('Base URL'), findsNothing);
      await tester.tap(find.text('New environment'));
      await tester.pumpAndSettle();
      expect(find.text('Base URL'), findsOneWidget);
      await tester.tap(find.byTooltip('Close panel'));
      await tester.pumpAndSettle();
      sessions.close();
    },
  );
}
