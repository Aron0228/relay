import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay/features/execution/activity_timeline.dart';
import 'package:relay/features/execution/execution_api.dart';
import 'package:relay/features/execution/run_status.dart';

void main() {
  testWidgets(
    'renders public messages, observations and tool calls from saved events',
    (tester) async {
      final events = [
        RunEvent({
          'id': 'bmo-1',
          'sequence': '1',
          'type': 'agent.activity',
          'payload': {'kind': 'message', 'text': 'Finn checks the cart.'},
        }),
        RunEvent({
          'id': 'bmo-2',
          'sequence': '2',
          'type': 'agent.activity',
          'payload': {'kind': 'observation', 'text': 'The cart is empty.'},
        }),
        RunEvent({
          'id': 'bmo-3',
          'sequence': '3',
          'type': 'agent.tool_called',
          'payload': {
            'name': 'browserClick',
            'arguments': '{"name":"Add to cart","role":"button"}',
          },
        }),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: ActivityTimeline(events: events),
            ),
          ),
        ),
      );

      expect(find.text('Finn checks the cart.'), findsOneWidget);
      expect(find.text('The cart is empty.'), findsOneWidget);
      expect(find.text('Started · browserClick'), findsOneWidget);
      expect(find.textContaining('Verdict:'), findsNothing);
    },
  );

  testWidgets('distinguishes a completed execution from an AI verdict', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(home: RunStatusBadge(status: 'completed')),
    );

    expect(find.text('Completed'), findsOneWidget);
    expect(find.text('Passed'), findsNothing);
  });
}
