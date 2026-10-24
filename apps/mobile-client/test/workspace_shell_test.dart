import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay/theme.dart';
import 'package:relay/workspace_shell.dart';

void main() {
  Widget shell(VoidCallback onSignOut) => MaterialApp(
    theme: RelayTokens.theme,
    home: WorkspaceShell(
      profile: const {'name': 'Finn the Human', 'email': 'finn@ooo.test'},
      onSignOut: onSignOut,
    ),
  );

  testWidgets('mobile drawer selects a page and exposes account sign-out', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var signedOut = false;
    await tester.pumpWidget(shell(() => signedOut = true));

    await tester.tap(find.byTooltip('Open menu'));
    await tester.pumpAndSettle();
    expect(find.text('Finn the Human'), findsOneWidget);
    await tester.tap(find.text('Runs'));
    await tester.pumpAndSettle();
    expect(find.text('Runs'), findsNWidgets(2));
    expect(find.text('Finn the Human'), findsNothing);

    await tester.tap(find.byTooltip('Open menu'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Account menu'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();
    expect(signedOut, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('desktop rail collapses and navigation search filters pages', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(shell(() {}));

    await tester.tap(find.byTooltip('Collapse sidebar'));
    await tester.pumpAndSettle();
    expect(find.text('Finn the Human'), findsNothing);
    expect(find.byTooltip('Expand sidebar'), findsOneWidget);

    await tester.tap(find.byTooltip('Search navigation'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'worker');
    await tester.pumpAndSettle();
    expect(find.text('Workers'), findsOneWidget);
    expect(find.text('Runs'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
