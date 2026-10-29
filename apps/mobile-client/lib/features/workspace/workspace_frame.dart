import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../theme.dart';

class WorkspaceFrame extends StatelessWidget {
  const WorkspaceFrame({
    super.key,
    required this.child,
    this.onBack,
    this.onSignOut,
    this.onRefresh,
  });
  final Widget child;
  final VoidCallback? onBack;
  final VoidCallback? onSignOut;
  final Future<void> Function()? onRefresh;

  @override
  Widget build(BuildContext context) {
    final scroll = SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(20, 40, 20, 64),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 780),
          child: SizedBox(width: double.infinity, child: child),
        ),
      ),
    );

    return Scaffold(
      body: SafeArea(
        child: Container(
          margin: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: RelayTokens.content,
            border: Border.all(color: RelayTokens.border),
            borderRadius: BorderRadius.circular(RelayTokens.radius),
          ),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                child: Row(
                  children: [
                    if (onBack != null)
                      TextButton.icon(
                        onPressed: onBack,
                        icon: const Icon(LucideIcons.chevronLeft, size: 16),
                        label: const Text('Back'),
                      )
                    else
                      const Padding(
                        padding: EdgeInsets.all(12),
                        child: Text(
                          'Relay',
                          style: TextStyle(color: RelayTokens.muted),
                        ),
                      ),
                    const Spacer(),
                    if (onSignOut != null)
                      TextButton(
                        onPressed: onSignOut,
                        child: const Text('Sign out'),
                      ),
                  ],
                ),
              ),
              Expanded(
                child: onRefresh == null
                    ? scroll
                    : RefreshIndicator(onRefresh: onRefresh!, child: scroll),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
