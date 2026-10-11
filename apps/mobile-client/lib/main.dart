import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'session_service.dart';
import 'theme.dart';
import 'workspace_shell.dart';

void main() => runApp(const MyApp());

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Relay',
    theme: RelayTokens.theme,
    home: const SessionPage(),
  );
}

class SessionPage extends StatefulWidget {
  const SessionPage({super.key});
  @override
  State<SessionPage> createState() => _SessionPageState();
}

class _SessionPageState extends State<SessionPage> {
  final _sessions = SessionService();
  Map<String, dynamic>? _profile;
  bool _busy = false;
  String? _error;

  Future<void> _login() async {
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final profile = await _sessions.login();

      if (mounted) setState(() => _profile = profile);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not sign in. Please try again.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _logout() async {
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      await _sessions.logout();

      if (mounted) setState(() => _profile = null);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not sign out. Please try again.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _sessions.close();

    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final profile = _profile;

    if (profile != null) {
      return WorkspaceShell(
        profile: profile,
        onSignOut: _logout,
        busy: _busy,
        error: _error,
      );
    }

    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            padding: const EdgeInsets.symmetric(
              horizontal: RelayTokens.medium,
              vertical: RelayTokens.large,
            ),
            child: ConstrainedBox(
              constraints: BoxConstraints(
                minHeight: (constraints.maxHeight - RelayTokens.large * 2)
                    .clamp(0, double.infinity),
              ),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    maxWidth: RelayTokens.contentWidth,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Center(
                        child: Container(
                          width: 80,
                          height: 80,
                          decoration: BoxDecoration(
                            color: RelayTokens.logo,
                            borderRadius: BorderRadius.circular(
                              RelayTokens.radius,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: RelayTokens.medium),
                      const Text(
                        'RELAY',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: RelayTokens.primary,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 3,
                        ),
                      ),
                      const SizedBox(height: RelayTokens.small),
                      Text(
                        'Log in to Relay',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 32,
                          fontWeight: FontWeight.w600,
                          letterSpacing: -1,
                        ),
                      ),
                      const SizedBox(height: RelayTokens.large),
                      FilledButton(
                        style: FilledButton.styleFrom(
                          backgroundColor: RelayTokens.text,
                          foregroundColor: RelayTokens.buttonText,
                        ),
                        onPressed: _busy ? null : _login,
                        child: Wrap(
                          alignment: WrapAlignment.center,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          spacing: RelayTokens.small,
                          children: [
                            if (_busy) ...[
                              const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              ),
                            ] else
                              SvgPicture.asset(
                                'assets/github.svg',
                                width: 22,
                                height: 22,
                                excludeFromSemantics: true,
                              ),
                            Text(
                              _busy ? 'Connecting…' : 'Continue with GitHub',
                            ),
                          ],
                        ),
                      ),
                      if (_error != null)
                        Padding(
                          padding: const EdgeInsets.only(
                            top: RelayTokens.medium,
                          ),
                          child: Semantics(
                            liveRegion: true,
                            child: Text(
                              _error!,
                              textAlign: TextAlign.center,
                              style: const TextStyle(color: RelayTokens.error),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
