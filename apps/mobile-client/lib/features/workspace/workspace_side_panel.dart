import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../theme.dart';

Future<T?> showWorkspaceSidePanel<T>({
  required BuildContext context,
  required String title,
  required WidgetBuilder builder,
}) => showGeneralDialog<T>(
  context: context,
  barrierDismissible: true,
  barrierLabel: 'Close panel',
  pageBuilder: (context, animation, secondaryAnimation) => Align(
    alignment: Alignment.centerRight,
    child: SizedBox(
      width: 440,
      height: double.infinity,
      child: Material(
        color: RelayTokens.surface,
        child: SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              24,
              24,
              24,
              24 + MediaQuery.viewInsetsOf(context).bottom,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        title,
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ),
                    IconButton(
                      style: ButtonStyle(
                        padding: const WidgetStatePropertyAll(EdgeInsets.zero),
                        alignment: Alignment.center,
                        foregroundColor: WidgetStateProperty.resolveWith(
                          (states) => states.contains(WidgetState.hovered)
                              ? RelayTokens.primary
                              : RelayTokens.text,
                        ),
                      ),
                      tooltip: 'Close panel',
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(LucideIcons.x),
                    ),
                  ],
                ),
                const SizedBox(height: 32),
                Expanded(child: SingleChildScrollView(child: builder(context))),
              ],
            ),
          ),
        ),
      ),
    ),
  ),
);
